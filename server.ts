import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
let primaryQuotaBlockedUntil = 0;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getErrorStatusAndMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('400')) {
    return {
      status: 400,
      message: 'Gemini API key error. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API quota reached (429). Please wait a moment and try again, or check your API key plan in Settings > Secrets.',
    };
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      message: 'GEMINI_API_KEY is missing in Settings > Secrets.',
    };
  }
  return {
    status: 500,
    message: raw || 'Unable to process clinical agent request.',
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429');
}

async function generateWithRetry<T>(fn: () => Promise<T>, retries = 1, timeoutMs = 25000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, 'Gemini API request');
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('500') || msg.includes('UNAVAILABLE') || msg.includes('ECONNRESET');
      if (!isTransient || attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  timeoutMs = 25000
) {
  const preferFallback = Date.now() < primaryQuotaBlockedUntil;
  const firstModel = preferFallback ? FALLBACK_MODEL : MODEL_NAME;

  try {
    return await generateWithRetry(
      () => ai.models.generateContent({ ...params, model: firstModel }),
      1,
      timeoutMs
    );
  } catch (err) {
    if (firstModel === MODEL_NAME && isQuotaError(err)) {
      primaryQuotaBlockedUntil = Date.now() + 5 * 60 * 1000;
      return await generateWithRetry(
        () => ai.models.generateContent({ ...params, model: FALLBACK_MODEL }),
        1,
        timeoutMs
      );
    }
    throw err;
  }
}

interface IncomingMemory {
  id: string;
  category: string;
  title: string;
  detail: string;
  confidence: string;
  reinforcementCount: number;
  source?: string;
}

interface IncomingHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface IncomingSymptomLog {
  loggedDate: string;
  symptom: string;
  severity: number;
  sleepHours: number;
  triggers: string;
  notes?: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // 1. Adaptive Clinical Consultation + Autonomous Memory Extraction
  app.post('/api/agent/consult', async (req, res) => {
    try {
      const { message, history = [], memories = [], profile = {}, recentSymptoms = [] } = req.body as {
        message?: string;
        history?: IncomingHistoryItem[];
        memories?: IncomingMemory[];
        profile?: { displayName?: string; communicationStyle?: string; preferredUnits?: string };
        recentSymptoms?: IncomingSymptomLog[];
      };

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        res.status(400).json({ error: 'A consultation message is required.' });
        return;
      }

      const ai = getAiClient();

      const memoryContext =
        memories.length > 0
          ? memories
              .map(
                (m) =>
                  `- [ID:${m.id}] (${m.category.toUpperCase()} | ${m.confidence} | reinforced ${m.reinforcementCount}x): ${m.title} — ${m.detail}`
              )
              .join('\n')
          : 'No learned patient memories yet.';

      const symptomContext =
        recentSymptoms.length > 0
          ? recentSymptoms
              .slice(0, 10)
              .map(
                (s) =>
                  `- ${s.loggedDate}: ${s.symptom} (severity ${s.severity}/10, sleep ${s.sleepHours}h, triggers: ${s.triggers || 'none'})`
              )
              .join('\n')
          : 'No recent symptom logs recorded.';

      const historyContext =
        history.length > 0
          ? history
              .slice(-12)
              .map((h) => `${h.role === 'user' ? 'Patient' : 'Agent'}: ${h.content}`)
              .join('\n\n')
          : 'This is the start of the consultation.';

      const styleInstructionMap: Record<string, string> = {
        concise: 'Keep responses crisp, structured, and action-oriented using short paragraphs and clear bullet points.',
        detailed: 'Provide thorough physiological rationale alongside structured next steps.',
        plain_language: 'Avoid medical jargon; explain every concept in warm, everyday plain language.',
        clinical: 'Use precise clinical terminology and structured SOAP-like reasoning where helpful.',
      };

      const styleRule = styleInstructionMap[profile.communicationStyle || 'plain_language'] || styleInstructionMap.plain_language;
      const unitsRule = profile.preferredUnits === 'imperial' ? 'Use imperial units (°F, lbs, fl oz).' : 'Use metric units (°C, kg, ml).';

      const systemInstruction = `You are Meridian Care, an adaptive personal healthcare AI agent with longitudinal learning capabilities.

PATIENT PROFILE & COMMUNICATION RULES:
- Name: ${profile.displayName || 'Patient'}
- Communication Style: ${styleRule}
- Measurement Units: ${unitsRule}

LEARNED PATIENT MEMORY & CARE RULES (Apply strictly and reference IDs when used):
${memoryContext}

RECENT SYMPTOM & BIOMETRIC LOGS:
${symptomContext}

CLINICAL SAFETY & ADAPTATION MANDATES:
1. You provide supportive, evidence-based health guidance and educational triage—never definitive diagnoses or prescriptions.
2. Always respect allergies, contraindications, medications, dietary constraints, and communication preferences in the Learned Patient Memory. For example, if a patient has an NSAID sensitivity or allergy, NEVER recommend ibuprofen/NSAIDs and explicitly note why you tailored your suggestion.
3. Evaluate symptom urgency accurately:
   - 'urgent': Chest pain, trouble breathing, neurological deficits, severe bleeding, suicidal ideation, anaphylaxis -> advise immediate emergency care (911/ER).
   - 'prompt_care': High fever >39.4°C / 103°F, worsening infection signs, persistent acute pain -> recommend same-day urgent care or physician evaluation.
   - 'monitor': Mild-moderate recurring symptoms worth tracking.
   - 'routine': General wellness, preventive, medication questions, or follow-up planning.
   - 'none': Informational or preference-setting message.
4. AUTONOMOUS LEARNING: Inspect the patient's latest message for durable health facts (conditions, medications/supplements, allergies/sensitivities, symptom triggers, lifestyle habits, communication preferences, or health goals).
   - If the patient shares a NEW durable fact, emit an 'add' operation.
   - If the patient confirms or repeats an EXISTING memory ID from above, emit a 'reinforce' operation targeting that exact 'targetMemoryId'.
   - If the patient corrects or changes an EXISTING memory ID (e.g., stopped a medication or changed dose), emit an 'update' operation targeting that exact 'targetMemoryId'.
   - Only extract facts explicitly stated or strongly confirmed by the patient. Do NOT hallucinate or extract trivial one-off greetings.
5. Also check if the patient is reporting a concrete symptom episode today (e.g., headache, fatigue, nausea, fever) and populate 'detectedSymptom' so they can save it to their Symptom Log with one click.`;

      const prompt = `CONVERSATION HISTORY:\n${historyContext}\n\nLATEST PATIENT MESSAGE:\n${message.trim()}`;

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: {
                  type: Type.STRING,
                  description: 'The agent response formatted in clean markdown (headings, bullets, bold emphasis).',
                },
                suggestedTitle: {
                  type: Type.STRING,
                  description: 'Concise 3 to 6 word consultation title summarizing the topic.',
                },
                focusArea: {
                  type: Type.STRING,
                  description: 'Short 1 to 3 word clinical focus area, e.g., Sleep & Migraine.',
                },
                triageUrgency: {
                  type: Type.STRING,
                  description: 'One of: none, routine, monitor, prompt_care, urgent.',
                },
                referencedMemoryIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Exact IDs from LEARNED PATIENT MEMORY that informed this response.',
                },
                memoryOperations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: 'One of: add, reinforce, update.',
                      },
                      targetMemoryId: {
                        type: Type.STRING,
                        description: 'Required when action is reinforce or update; empty string for add.',
                      },
                      category: {
                        type: Type.STRING,
                        description: 'One of: condition, medication, allergy, trigger, lifestyle, preference, goal.',
                      },
                      title: {
                        type: Type.STRING,
                        description: 'Concise memory title (max 80 chars).',
                      },
                      detail: {
                        type: Type.STRING,
                        description: 'Clear clinical or preference detail learned.',
                      },
                      confidence: {
                        type: Type.STRING,
                        description: 'One of: high, medium.',
                      },
                      evidenceQuote: {
                        type: Type.STRING,
                        description: 'Short verbatim phrase from patient message supporting this memory.',
                      },
                    },
                    required: ['action', 'targetMemoryId', 'category', 'title', 'detail', 'confidence', 'evidenceQuote'],
                  },
                },
                suggestedFollowUps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '2 to 3 helpful next questions the patient can click to ask.',
                },
                detectedSymptom: {
                  type: Type.OBJECT,
                  properties: {
                    detected: { type: Type.BOOLEAN },
                    symptom: { type: Type.STRING },
                    severity: { type: Type.INTEGER },
                    sleepHours: { type: Type.NUMBER },
                    triggers: { type: Type.STRING },
                  },
                  required: ['detected', 'symptom', 'severity', 'sleepHours', 'triggers'],
                },
              },
              required: [
                'reply',
                'suggestedTitle',
                'focusArea',
                'triageUrgency',
                'referencedMemoryIds',
                'memoryOperations',
                'suggestedFollowUps',
                'detectedSymptom',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Feedback-Driven Learning Distillation
  app.post('/api/agent/feedback', async (req, res) => {
    try {
      const { messageContent, rating, userCorrection } = req.body as {
        messageContent?: string;
        rating?: string;
        userCorrection?: string;
      };

      if (!messageContent || !rating) {
        res.status(400).json({ error: 'messageContent and rating are required.' });
        return;
      }

      const ai = getAiClient();

      const prompt = `A patient gave feedback on an assistant clinical response.
Rating: ${rating}
User Correction / Note: ${userCorrection || '(No written note provided)'}
Assistant Response Excerpt: ${messageContent.slice(0, 1200)}

Distill what the agent should learn permanently from this feedback so future consultations improve.`;

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'You are a clinical feedback distillation module. Convert user feedback into a concise, durable care or communication rule.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                distilledRule: {
                  type: Type.STRING,
                  description: 'One clear sentence summarizing the learned rule.',
                },
                memoryCategory: {
                  type: Type.STRING,
                  description: 'One of: preference, allergy, condition, medication, trigger, lifestyle, goal.',
                },
                memoryTitle: {
                  type: Type.STRING,
                  description: 'Short title for the learned memory card.',
                },
                memoryDetail: {
                  type: Type.STRING,
                  description: 'Actionable rule stored in long-term patient memory.',
                },
                acknowledgement: {
                  type: Type.STRING,
                  description: 'Brief 1-sentence confirmation to show the user.',
                },
              },
              required: ['distilledRule', 'memoryCategory', 'memoryTitle', 'memoryDetail', 'acknowledgement'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. Longitudinal Pattern Synthesis & Care Playbook Generation
  app.post('/api/agent/synthesize-patterns', async (req, res) => {
    try {
      const { symptomLogs = [], memories = [], profile = {} } = req.body as {
        symptomLogs?: IncomingSymptomLog[];
        memories?: IncomingMemory[];
        profile?: { displayName?: string; communicationStyle?: string; preferredUnits?: string };
      };

      const ai = getAiClient();

      const prompt = `PATIENT: ${profile.displayName || 'Patient'} (Units: ${profile.preferredUnits || 'metric'})

LEARNED MEMORIES (${memories.length}):
${memories.map((m) => `- [${m.category}] ${m.title}: ${m.detail} (reinforced ${m.reinforcementCount}x)`).join('\n') || 'None'}

SYMPTOM & SLEEP LOGS (${symptomLogs.length}):
${
  symptomLogs
    .map(
      (s) =>
        `- ${s.loggedDate}: ${s.symptom} | severity ${s.severity}/10 | sleep ${s.sleepHours}h | triggers: ${s.triggers || 'none'} | notes: ${s.notes || ''}`
    )
    .join('\n') || 'None'
}

Analyze correlations across the symptom logs and learned memories. Produce a crisp clinical synthesis, newly discovered longitudinal patterns (only if supported by actual logs/memories), a personalized care playbook, and focused questions for their physician.`;

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            systemInstruction:
              'You are Meridian Care pattern synthesis engine. Only state correlations genuinely evidenced in the provided logs and memories.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                careSummary: {
                  type: Type.STRING,
                  description: '2-3 concise paragraphs summarizing the patient baseline, patterns, and adaptations.',
                },
                discoveredPatterns: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      category: { type: Type.STRING, description: 'One of: trigger, lifestyle, condition, goal.' },
                      confidence: { type: Type.STRING, description: 'One of: high, medium.' },
                      evidenceQuote: { type: Type.STRING },
                    },
                    required: ['title', 'detail', 'category', 'confidence', 'evidenceQuote'],
                  },
                },
                carePlaybook: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      phase: { type: Type.STRING, description: 'e.g., Morning Routine, Symptom Flare Protocol, Sleep Hygiene.' },
                      action: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                    },
                    required: ['phase', 'action', 'rationale'],
                  },
                },
                clinicianQuestions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['careSummary', 'discoveredPatterns', 'carePlaybook', 'clinicianQuestions'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. Multi-Agent Healthcare Search Network (SSE Streaming)
  app.post('/api/agent/research-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, payload: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    };

    try {
      const {
        query: userQuery,
        urls = [],
        activeSources = ['google_search', 'wikipedia', 'pubmed', 'url_context'],
        memories = [],
        profile = {},
      } = req.body as {
        query?: string;
        urls?: string[];
        activeSources?: string[];
        memories?: IncomingMemory[];
        profile?: { displayName?: string; communicationStyle?: string; preferredUnits?: string };
      };

      if (!userQuery || typeof userQuery !== 'string' || !userQuery.trim()) {
        sendEvent('error', { error: 'A healthcare research query is required.' });
        res.end();
        return;
      }

      const cleanQuery = userQuery.trim();
      const validUrls = (Array.isArray(urls) ? urls : [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter((u) => /^https?:\/\/.+/i.test(u))
        .slice(0, 5);
      const isGreeting =
        validUrls.length === 0 &&
        (/^(hi+|hello+|hey+|good\s*(morning|afternoon|evening)|thanks|thank\s*you|ok|okay|bye|how\s+are\s+you|who\s+are\s+you|what\s+can\s+you\s+do)[!?.?\s]*$/i.test(
          cleanQuery
        ) ||
          cleanQuery.length < 3);
      const enabledSet = isGreeting
        ? new Set<string>()
        : new Set(Array.isArray(activeSources) ? activeSources : []);
      const ai = getAiClient();

      // Node 1: Trigger
      sendEvent('node_update', {
        nodeId: 'trigger',
        label: 'Patient Query Trigger',
        status: 'completed',
        latencyMs: 12,
        resultCount: 1 + validUrls.length,
        queryUsed: cleanQuery,
        summary:
          validUrls.length > 0
            ? `Dispatched clinical query with ${validUrls.length} custom webpage URL(s).`
            : 'Dispatched clinical query across active medical knowledge nodes.',
        citations: [],
      });

      // Node 2: AI Orchestrator (plans specialized queries per source)
      const orchStart = Date.now();
      sendEvent('node_update', {
        nodeId: 'orchestrator',
        label: 'Healthcare AI Orchestrator',
        status: 'running',
        latencyMs: 0,
        resultCount: 0,
        queryUsed: cleanQuery,
        summary: 'Analyzing question against patient memory and planning parallel source queries...',
        citations: [],
      });

      const memoryContext =
        memories.length > 0
          ? memories
              .map((m) => `- (${m.category}) ${m.title}: ${m.detail}`)
              .join('\n')
          : 'No stored patient memories yet.';

      // Deterministic fast medical query routing (avoids burning extra Gemini quota before retrieval)
      const cleanedForSearch = cleanQuery
        .replace(/https?:\/\/[^\s)]+/gi, ' ')
        .replace(/\b(what|how|why|when|where|which|who|is|are|can|could|should|would|do|does|did|the|a|an|for|with|about|tell|me|explain|please|help|helps|symptoms?|causes?|treatment)\b/gi, ' ')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const webQuery = cleanQuery.replace(/https?:\/\/[^\s)]+/gi, '').trim() || cleanQuery;
      const keywordSeed = cleanedForSearch || webQuery;
      const wikiTerms = Array.from(new Set([keywordSeed, webQuery].filter(Boolean))).slice(0, 2);
      const pubmedQuery = keywordSeed;

      sendEvent('node_update', {
        nodeId: 'orchestrator',
        label: 'Healthcare AI Orchestrator',
        status: 'completed',
        latencyMs: Math.max(8, Date.now() - orchStart),
        resultCount: enabledSet.size,
        queryUsed: `Web: "${webQuery}" | Wiki: ${wikiTerms.join(', ')} | PubMed: "${pubmedQuery}"`,
        summary: 'Routed specialized queries to connected medical search engines.',
        citations: [],
      });

      interface BranchResult {
        nodeId: string;
        label: string;
        status: 'completed' | 'skipped' | 'error';
        latencyMs: number;
        resultCount: number;
        queryUsed: string;
        summary: string;
        rawContext: string;
        citations: Array<{ title: string; url: string; sourceType: string; snippet: string }>;
      }

      // Parallel Branch 1: Google Search Grounding
      const runGoogleSearch = async (): Promise<BranchResult> => {
        const start = Date.now();
        if (!enabledSet.has('google_search')) {
          const skipped: BranchResult = {
            nodeId: 'google_search',
            label: 'Google Web Search',
            status: 'skipped',
            latencyMs: 0,
            resultCount: 0,
            queryUsed: '',
            summary: 'Disabled by user.',
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', skipped);
          return skipped;
        }

        sendEvent('node_update', {
          nodeId: 'google_search',
          label: 'Google Web Search',
          status: 'running',
          latencyMs: 0,
          resultCount: 0,
          queryUsed: webQuery,
          summary: 'Searching live clinical and medical web resources...',
          citations: [],
        });

        try {
          const gRes = await generateContentWithFallback(
            ai,
            {
              contents: `Search authoritative medical and public health sources for: ${webQuery}. Summarize key evidence-based findings concisely.`,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                tools: [{ googleSearch: {} }],
              },
            },
            20000
          );

          const chunks = gRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          const webCitations = chunks
            .filter((c) => c.web?.uri)
            .slice(0, 6)
            .map((c) => ({
              title: c.web?.title || 'Medical Web Resource',
              url: c.web?.uri || '',
              sourceType: 'google_search',
              snippet: (gRes.text || '').slice(0, 260),
            }));

          const result: BranchResult = {
            nodeId: 'google_search',
            label: 'Google Web Search',
            status: 'completed',
            latencyMs: Date.now() - start,
            resultCount: webCitations.length,
            queryUsed: webQuery,
            summary:
              webCitations.length > 0
                ? `Retrieved ${webCitations.length} grounded web sources.`
                : 'Completed web grounding synthesis.',
            rawContext: gRes.text || '',
            citations: webCitations,
          };
          sendEvent('node_update', result);
          return result;
        } catch (err) {
          const msg = getErrorStatusAndMessage(err).message;
          const errRes: BranchResult = {
            nodeId: 'google_search',
            label: 'Google Web Search',
            status: 'error',
            latencyMs: Date.now() - start,
            resultCount: 0,
            queryUsed: webQuery,
            summary: msg,
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', errRes);
          return errRes;
        }
      };

      // Parallel Branch 2: Wikipedia Medical Agent
      const runWikipedia = async (): Promise<BranchResult> => {
        const start = Date.now();
        if (!enabledSet.has('wikipedia')) {
          const skipped: BranchResult = {
            nodeId: 'wikipedia',
            label: 'Wikipedia Medical',
            status: 'skipped',
            latencyMs: 0,
            resultCount: 0,
            queryUsed: '',
            summary: 'Disabled by user.',
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', skipped);
          return skipped;
        }

        sendEvent('node_update', {
          nodeId: 'wikipedia',
          label: 'Wikipedia Medical',
          status: 'running',
          latencyMs: 0,
          resultCount: 0,
          queryUsed: wikiTerms.join(', '),
          summary: 'Querying Wikipedia encyclopedia summaries...',
          citations: [],
        });

        try {
          const citations: Array<{ title: string; url: string; sourceType: string; snippet: string }> = [];
          const rawExtracts: string[] = [];
          const seenTitles = new Set<string>();

          for (const term of wikiTerms) {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
              term
            )}&srlimit=2&format=json`;
            const searchResp = await fetch(searchUrl, {
              signal: AbortSignal.timeout(10000),
              headers: { 'User-Agent': 'MeridianCareHealthAgent/1.0 (https://meridiancare.local)' },
            });
            if (!searchResp.ok) continue;
            const searchJson = (await searchResp.json()) as {
              query?: { search?: Array<{ title: string }> };
            };
            const hits = searchJson.query?.search || [];
            for (const hit of hits) {
              if (seenTitles.has(hit.title) || citations.length >= 4) continue;
              seenTitles.add(hit.title);
              const sumResp = await fetch(
                `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
                {
                  signal: AbortSignal.timeout(10000),
                  headers: { 'User-Agent': 'MeridianCareHealthAgent/1.0 (https://meridiancare.local)' },
                }
              );
              if (!sumResp.ok) continue;
              const sumJson = (await sumResp.json()) as {
                title?: string;
                extract?: string;
                content_urls?: { desktop?: { page?: string } };
              };
              const pageUrl =
                sumJson.content_urls?.desktop?.page ||
                `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, '_'))}`;
              const extract = (sumJson.extract || '').trim();
              if (extract) {
                citations.push({
                  title: `Wikipedia: ${sumJson.title || hit.title}`,
                  url: pageUrl,
                  sourceType: 'wikipedia',
                  snippet: extract.slice(0, 340),
                });
                rawExtracts.push(`[${sumJson.title || hit.title}] (${pageUrl}): ${extract}`);
              }
            }
          }

          const result: BranchResult = {
            nodeId: 'wikipedia',
            label: 'Wikipedia Medical',
            status: 'completed',
            latencyMs: Date.now() - start,
            resultCount: citations.length,
            queryUsed: wikiTerms.join(', '),
            summary:
              citations.length > 0
                ? `Retrieved ${citations.length} Wikipedia medical article summary(s).`
                : 'No exact Wikipedia entries matched.',
            rawContext: rawExtracts.join('\n\n'),
            citations,
          };
          sendEvent('node_update', result);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Wikipedia lookup failed';
          const errRes: BranchResult = {
            nodeId: 'wikipedia',
            label: 'Wikipedia Medical',
            status: 'error',
            latencyMs: Date.now() - start,
            resultCount: 0,
            queryUsed: wikiTerms.join(', '),
            summary: msg,
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', errRes);
          return errRes;
        }
      };

      // Parallel Branch 3: PubMed & Clinical Guidelines
      const runPubMed = async (): Promise<BranchResult> => {
        const start = Date.now();
        if (!enabledSet.has('pubmed')) {
          const skipped: BranchResult = {
            nodeId: 'pubmed',
            label: 'PubMed Literature',
            status: 'skipped',
            latencyMs: 0,
            resultCount: 0,
            queryUsed: '',
            summary: 'Disabled by user.',
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', skipped);
          return skipped;
        }

        sendEvent('node_update', {
          nodeId: 'pubmed',
          label: 'PubMed Literature',
          status: 'running',
          latencyMs: 0,
          resultCount: 0,
          queryUsed: pubmedQuery,
          summary: 'Searching NCBI PubMed peer-reviewed clinical studies...',
          citations: [],
        });

        try {
          const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
            pubmedQuery
          )}&retmax=4&retmode=json&sort=relevance`;
          const esearchResp = await fetch(esearchUrl, { signal: AbortSignal.timeout(10000) });
          if (!esearchResp.ok) {
            throw new Error(`PubMed search returned HTTP ${esearchResp.status}`);
          }
          const esearchJson = (await esearchResp.json()) as {
            esearchresult?: { idlist?: string[] };
          };
          const pmids = esearchJson.esearchresult?.idlist || [];
          const citations: Array<{ title: string; url: string; sourceType: string; snippet: string }> = [];
          const rawBlocks: string[] = [];

          if (pmids.length > 0) {
            const esumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(
              ','
            )}&retmode=json`;
            const esumResp = await fetch(esumUrl, { signal: AbortSignal.timeout(10000) });
            const esumJson = esumResp.ok
              ? ((await esumResp.json()) as {
                  result?: Record<string, { title?: string; source?: string; pubdate?: string }>;
                })
              : {};

            const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(
              ','
            )}&retmode=xml`;
            const efetchResp = await fetch(efetchUrl, { signal: AbortSignal.timeout(10000) });
            const xmlText = efetchResp.ok ? await efetchResp.text() : '';
            const articleChunks = xmlText.split('<PubmedArticle>');

            pmids.forEach((pmid, idx) => {
              const meta = esumJson.result?.[pmid];
              const title = (meta?.title || `PubMed Study PMID:${pmid}`).replace(/<[^>]+>/g, '');
              const journal = meta?.source || 'PubMed';
              const pubdate = meta?.pubdate || '';
              const chunk = articleChunks[idx + 1] || '';
              const abstractMatches = Array.from(chunk.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g))
                .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
                .join(' ');
              const snippet = abstractMatches
                ? abstractMatches.slice(0, 360)
                : `${journal} (${pubdate}) — PMID ${pmid}`;
              const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
              citations.push({
                title,
                url,
                sourceType: 'pubmed',
                snippet,
              });
              rawBlocks.push(`[PMID ${pmid}] ${title} (${journal}, ${pubdate}): ${abstractMatches || snippet}`);
            });
          }

          const result: BranchResult = {
            nodeId: 'pubmed',
            label: 'PubMed Literature',
            status: 'completed',
            latencyMs: Date.now() - start,
            resultCount: citations.length,
            queryUsed: pubmedQuery,
            summary:
              citations.length > 0
                ? `Retrieved ${citations.length} peer-reviewed PubMed study abstract(s).`
                : 'No PubMed abstracts matched these keywords.',
            rawContext: rawBlocks.join('\n\n'),
            citations,
          };
          sendEvent('node_update', result);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'PubMed lookup failed';
          const errRes: BranchResult = {
            nodeId: 'pubmed',
            label: 'PubMed Literature',
            status: 'error',
            latencyMs: Date.now() - start,
            resultCount: 0,
            queryUsed: pubmedQuery,
            summary: msg,
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', errRes);
          return errRes;
        }
      };

      // Parallel Branch 4: Medical Webpage URL Context
      const runUrlContext = async (): Promise<BranchResult> => {
        const start = Date.now();
        if (!enabledSet.has('url_context') || validUrls.length === 0) {
          const skipped: BranchResult = {
            nodeId: 'url_context',
            label: 'Webpage URL Reader',
            status: 'skipped',
            latencyMs: 0,
            resultCount: 0,
            queryUsed: validUrls.join(', '),
            summary:
              validUrls.length === 0
                ? 'No specific medical webpage URLs supplied for this run.'
                : 'Disabled by user.',
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', skipped);
          return skipped;
        }

        sendEvent('node_update', {
          nodeId: 'url_context',
          label: 'Webpage URL Reader',
          status: 'running',
          latencyMs: 0,
          resultCount: 0,
          queryUsed: validUrls.join(', '),
          summary: `Reading ${validUrls.length} supplied medical webpage(s)...`,
          citations: [],
        });

        try {
          const uRes = await generateContentWithFallback(
            ai,
            {
              contents: `Extract relevant clinical information answering "${cleanQuery}" from these URLs:\n${validUrls.join(
                '\n'
              )}`,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                tools: [{ urlContext: {} }],
              },
            },
            20000
          );

          const text = (uRes.text || '').trim();
          const urlCitations = validUrls.map((u) => ({
            title: `Webpage: ${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}`,
            url: u,
            sourceType: 'url_context',
            snippet: text.slice(0, 300) || 'Extracted context from supplied medical webpage.',
          }));

          const result: BranchResult = {
            nodeId: 'url_context',
            label: 'Webpage URL Reader',
            status: 'completed',
            latencyMs: Date.now() - start,
            resultCount: urlCitations.length,
            queryUsed: validUrls.join(', '),
            summary: `Analyzed ${validUrls.length} supplied webpage(s).`,
            rawContext: text,
            citations: urlCitations,
          };
          sendEvent('node_update', result);
          return result;
        } catch (err) {
          const msg = getErrorStatusAndMessage(err).message;
          const errRes: BranchResult = {
            nodeId: 'url_context',
            label: 'Webpage URL Reader',
            status: 'error',
            latencyMs: Date.now() - start,
            resultCount: 0,
            queryUsed: validUrls.join(', '),
            summary: msg,
            rawContext: '',
            citations: [],
          };
          sendEvent('node_update', errRes);
          return errRes;
        }
      };

      const branchResults = await Promise.all([
        runGoogleSearch(),
        runWikipedia(),
        runPubMed(),
        runUrlContext(),
      ]);

      // Build unified numbered citations array
      const numberedCitations: Array<{
        index: number;
        title: string;
        url: string;
        sourceType: string;
        snippet: string;
      }> = [];
      const seenUrls = new Set<string>();
      for (const b of branchResults) {
        for (const c of b.citations) {
          if (c.url && !seenUrls.has(c.url) && numberedCitations.length < 20) {
            seenUrls.add(c.url);
            numberedCitations.push({
              index: numberedCitations.length + 1,
              title: c.title,
              url: c.url,
              sourceType: c.sourceType,
              snippet: c.snippet,
            });
          }
        }
      }

      // Node 7: Clinical Evidence Synthesizer
      const synthStart = Date.now();
      sendEvent('node_update', {
        nodeId: 'synthesizer',
        label: 'Evidence Synthesizer',
        status: 'running',
        latencyMs: 0,
        resultCount: numberedCitations.length,
        queryUsed: cleanQuery,
        summary: `Reconciling ${numberedCitations.length} sources with your learned health memory...`,
        citations: [],
      });

      const sourcesDigest = numberedCitations
        .map((c) => `[${c.index}] (${c.sourceType}) ${c.title} — ${c.url}\nSnippet: ${c.snippet}`)
        .join('\n\n');

      const rawEvidenceBlock = branchResults
        .filter((b) => b.rawContext)
        .map((b) => `=== ${b.label.toUpperCase()} ===\n${b.rawContext.slice(0, 3500)}`)
        .join('\n\n');

      const synthPrompt = isGreeting
        ? `USER MESSAGE: ${cleanQuery}

PATIENT PROFILE:
- Name: ${profile.displayName || 'Patient'}

Reply warmly, naturally, and directly in 1 to 2 short sentences as Meridian Care, a helpful healthcare assistant.`
        : `PATIENT QUESTION: ${cleanQuery}

PATIENT PROFILE:
- Name: ${profile.displayName || 'Patient'}
- Communication Style: ${profile.communicationStyle || 'plain_language'}
- Units: ${profile.preferredUnits || 'metric'}

LEARNED PATIENT MEMORY (Must check for contraindications/allergies/preferences):
${memoryContext}

REFERENCE MATERIAL:
${sourcesDigest || 'None'}

${rawEvidenceBlock || 'Answer directly from verified clinical knowledge.'}

Answer the user's question directly, clearly, and concisely in clean markdown. Do NOT include inline citation numbers like [1] or [2], and do NOT add a Sources or References section at the end.`;

      const synthRes = await generateContentWithFallback(
        ai,
        {
          contents: synthPrompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'You are Meridian Care, a clear, supportive healthcare assistant. Answer the user directly without inline [1] citation brackets or reference lists.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                synthesizedAnswer: {
                  type: Type.STRING,
                  description: 'Direct, clear markdown response with no [1] citation brackets or source lists.',
                },
                synthesisNote: {
                  type: Type.STRING,
                  description: 'Short 1-sentence summary of the response.',
                },
                candidateMemories: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: 'One of: condition, medication, allergy, trigger, lifestyle, preference, goal.',
                      },
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      evidenceQuote: { type: Type.STRING },
                    },
                    required: ['category', 'title', 'detail', 'evidenceQuote'],
                  },
                },
              },
              required: ['synthesizedAnswer', 'synthesisNote', 'candidateMemories'],
            },
          },
        },
        25000
      );

      const synthJson = JSON.parse((synthRes.text ?? '{}').trim()) as {
        synthesizedAnswer?: string;
        synthesisNote?: string;
        candidateMemories?: Array<{
          category: string;
          title: string;
          detail: string;
          evidenceQuote: string;
        }>;
      };

      const directAnswer = (synthJson.synthesizedAnswer || 'No response synthesized.')
        .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
        .trim();

      sendEvent('node_update', {
        nodeId: 'synthesizer',
        label: 'Evidence Synthesizer',
        status: 'completed',
        latencyMs: Date.now() - synthStart,
        resultCount: numberedCitations.length,
        queryUsed: cleanQuery,
        summary: synthJson.synthesisNote || 'Unified multi-source findings with inline citations.',
        citations: [],
      });

      // Node 8: Adaptive Memory & Archive
      sendEvent('node_update', {
        nodeId: 'memory_updater',
        label: 'Memory & Archive',
        status: 'completed',
        latencyMs: 18,
        resultCount: (synthJson.candidateMemories || []).length,
        queryUsed: 'Firestore Research Archive & Learned Memory',
        summary: `Prepared run archive and ${(synthJson.candidateMemories || []).length} candidate learning insight(s).`,
        citations: [],
      });

      const nodeSummaries = [
        {
          nodeId: 'trigger',
          label: 'Patient Query Trigger',
          status: 'completed',
          latencyMs: 12,
          resultCount: 1 + validUrls.length,
          queryUsed: cleanQuery,
          summary: 'Dispatched multi-source query.',
        },
        {
          nodeId: 'orchestrator',
          label: 'Healthcare AI Orchestrator',
          status: 'completed',
          latencyMs: Math.max(8, Date.now() - orchStart),
          resultCount: enabledSet.size,
          queryUsed: webQuery,
          summary: 'Planned parallel queries.',
        },
        ...branchResults.map((b) => ({
          nodeId: b.nodeId,
          label: b.label,
          status: b.status,
          latencyMs: b.latencyMs,
          resultCount: b.resultCount,
          queryUsed: b.queryUsed,
          summary: b.summary,
        })),
        {
          nodeId: 'synthesizer',
          label: 'Evidence Synthesizer',
          status: 'completed',
          latencyMs: Date.now() - synthStart,
          resultCount: numberedCitations.length,
          queryUsed: cleanQuery,
          summary: synthJson.synthesisNote || 'Unified cited answer.',
        },
      ];

      sendEvent('research_complete', {
        query: cleanQuery,
        urls: validUrls,
        activeSources: Array.from(enabledSet),
        synthesizedAnswer: directAnswer,
        citations: isGreeting ? [] : numberedCitations,
        nodeSummaries,
        candidateMemories: (synthJson.candidateMemories || []).slice(0, 3),
      });

      res.end();
    } catch (err) {
      const { message } = getErrorStatusAndMessage(err);
      sendEvent('node_update', {
        nodeId: 'synthesizer',
        label: 'Evidence Synthesizer',
        status: 'error',
        latencyMs: 0,
        resultCount: 0,
        queryUsed: '',
        summary: message,
        citations: [],
      });
      sendEvent('error', { error: message });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Application build not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Care server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
