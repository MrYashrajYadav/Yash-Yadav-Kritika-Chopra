import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardPlus,
  Globe,
  Info,
  MessageSquarePlus,
  PanelLeft,
  PencilLine,
  ShieldAlert,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { MarkdownProse } from './MarkdownProse';
import type {
  ConsultApiResponse,
  Consultation,
  ConsultationMessage,
  DetectedSymptom,
  FeedbackApiResponse,
  LearnedMemory,
  PatientProfile,
  SymptomLog,
  TriageUrgency,
} from '../types/healthcare';
import {
  addConsultationMessage,
  applyMemoryOperations,
  createConsultation,
  createFeedbackEvent,
  createManualMemory,
  createSymptomLog,
  deleteConsultationWithMessages,
  resolveConsultation,
  updateConsultationMeta,
  updateMessageFeedback,
  updatePatientCareSummary,
} from '../lib/firestoreService';

interface Props {
  uid: string;
  profile: PatientProfile | null;
  memories: LearnedMemory[];
  consultations: Consultation[];
  activeConsultationId: string | null;
  onSelectConsultation: (id: string | null) => void;
  messages: ConsultationMessage[];
  symptomLogs: SymptomLog[];
  onNavigateTab: (tab: 'consultation' | 'research' | 'memory' | 'symptoms' | 'playbook') => void;
  onOpenResearch?: (query: string) => void;
}

const STARTER_PROMPTS = [
  'I have had tension headaches around 4pm the last three days after poor sleep.',
  'I take Vitamin D3 2000 IU daily and ibuprofen upsets my stomach—please remember this.',
  'Explain all future advice in plain language with a short 3-step action plan.',
  'What preventive questions should I prepare for my annual physical?',
];

const TRIAGE_LABELS: Record<TriageUrgency, { label: string; colorClass: string; Icon: React.ElementType }> = {
  none: { label: 'Informational', colorClass: 'text-slate-500', Icon: Info },
  routine: { label: 'Routine Guidance', colorClass: 'text-teal-700', Icon: CheckCircle2 },
  monitor: { label: 'Monitor Symptoms', colorClass: 'text-amber-700', Icon: AlertCircle },
  prompt_care: { label: 'Prompt Care Recommended', colorClass: 'text-amber-700', Icon: AlertTriangle },
  urgent: { label: 'Urgent Medical Attention', colorClass: 'text-rose-700', Icon: ShieldAlert },
};

export const ConsultationWorkspace: React.FC<Props> = ({
  uid,
  profile,
  memories,
  consultations,
  activeConsultationId,
  onSelectConsultation,
  messages,
  symptomLogs,
  onNavigateTab,
  onOpenResearch,
}) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [detectedSymptomByMsg, setDetectedSymptomByMsg] = useState<Record<string, DetectedSymptom>>({});
  const [savedSymptomMsgIds, setSavedSymptomMsgIds] = useState<Record<string, boolean>>({});
  const [correctingMsgId, setCorrectingMsgId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<Record<string, string>>({});
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeMemories = useMemo(() => memories.filter((m) => m.status === 'active'), [memories]);
  const memoryMap = useMemo(() => {
    const map = new Map<string, LearnedMemory>();
    for (const m of memories) {
      map.set(m.id, m);
    }
    return map;
  }, [memories]);

  const activeConsultation = useMemo(
    () => consultations.find((c) => c.id === activeConsultationId) || null,
    [consultations, activeConsultationId]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending]);

  const handleNewConsultation = async () => {
    setErrorMsg(null);
    setFollowUps([]);
    const newId = await createConsultation(uid, 'New Clinical Consultation', 'General Care');
    onSelectConsultation(newId);
    setMobileRailOpen(false);
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isSending) return;

    setErrorMsg(null);
    setIsSending(true);
    if (!overrideText) setInput('');

    try {
      let targetConsultId = activeConsultationId;
      let currentTitle = activeConsultation?.title || 'New Clinical Consultation';
      let currentFocus = activeConsultation?.focusArea || 'General Care';
      let currentCount = activeConsultation?.messageCount || 0;

      if (!targetConsultId || activeConsultation?.status === 'resolved') {
        targetConsultId = await createConsultation(uid, text.slice(0, 60), 'General Care');
        onSelectConsultation(targetConsultId);
        currentTitle = text.slice(0, 60);
        currentFocus = 'General Care';
        currentCount = 0;
      }

      await addConsultationMessage(uid, targetConsultId, {
        role: 'user',
        content: text,
        triageUrgency: 'none',
        referencedMemoryIds: [],
        learnedMemoryIds: [],
      });

      const historyPayload = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/agent/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          memories: activeMemories.map((m) => ({
            id: m.id,
            category: m.category,
            title: m.title,
            detail: m.detail,
            confidence: m.confidence,
            reinforcementCount: m.reinforcementCount,
          })),
          profile: {
            displayName: profile?.displayName || 'Patient',
            communicationStyle: profile?.communicationStyle || 'plain_language',
            preferredUnits: profile?.preferredUnits || 'metric',
          },
          recentSymptoms: symptomLogs.slice(0, 8).map((s) => ({
            loggedDate: s.loggedDate,
            symptom: s.symptom,
            severity: s.severity,
            sleepHours: s.sleepHours,
            triggers: s.triggers,
          })),
        }),
      });

      const data = (await res.json()) as ConsultApiResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Agent consultation failed.');
      }

      const learnedIds =
        data.memoryOperations && data.memoryOperations.length > 0
          ? await applyMemoryOperations(uid, data.memoryOperations, activeMemories)
          : [];

      const validReferencedIds = (data.referencedMemoryIds || []).filter((id) => memoryMap.has(id));

      const assistantMsgId = await addConsultationMessage(uid, targetConsultId, {
        role: 'assistant',
        content: data.reply || 'I have reviewed your update.',
        triageUrgency: data.triageUrgency || 'routine',
        referencedMemoryIds: validReferencedIds,
        learnedMemoryIds: learnedIds,
      });

      if (data.detectedSymptom?.detected) {
        setDetectedSymptomByMsg((prev) => ({
          ...prev,
          [assistantMsgId]: data.detectedSymptom,
        }));
      }

      setFollowUps(Array.isArray(data.suggestedFollowUps) ? data.suggestedFollowUps.slice(0, 3) : []);

      const nextTitle =
        currentCount === 0 && data.suggestedTitle ? data.suggestedTitle : currentTitle;
      const nextFocus = data.focusArea || currentFocus;

      await updateConsultationMeta(uid, targetConsultId, {
        title: nextTitle,
        focusArea: nextFocus,
        messageCount: currentCount + 2,
        lastMessagePreview: (data.reply || text).replace(/\s+/g, ' ').slice(0, 140),
      });

      if (learnedIds.length > 0 && profile) {
        await updatePatientCareSummary(uid, profile.careSummary, (profile.learningCount || 0) + learnedIds.length);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send message.');
    } finally {
      setIsSending(false);
    }
  };

  const handleHelpful = async (msg: ConsultationMessage) => {
    if (!activeConsultationId || feedbackSubmittingId) return;
    setFeedbackSubmittingId(msg.id);
    try {
      await updateMessageFeedback(uid, activeConsultationId, msg.id, 'helpful', 'Marked helpful by patient');
      await createFeedbackEvent(uid, {
        consultationId: activeConsultationId,
        messageId: msg.id,
        rating: 'helpful',
        userCorrection: 'Confirmed guidance style and clinical relevance were helpful.',
        distilledRule: 'Reinforced current clinical explanation structure and tone.',
      });
      if (profile) {
        await updatePatientCareSummary(uid, profile.careSummary, (profile.learningCount || 0) + 1);
      }
      setFeedbackBanner((prev) => ({
        ...prev,
        [msg.id]: 'Positive feedback recorded—agent style reinforced.',
      }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save feedback.');
    } finally {
      setFeedbackSubmittingId(null);
    }
  };

  const handleSubmitCorrection = async (msg: ConsultationMessage) => {
    const note = correctionText.trim();
    if (!note || !activeConsultationId || feedbackSubmittingId) return;
    setFeedbackSubmittingId(msg.id);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/agent/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageContent: msg.content,
          rating: 'corrected',
          userCorrection: note,
        }),
      });
      const data = (await res.json()) as FeedbackApiResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not process correction.');
      }

      await updateMessageFeedback(uid, activeConsultationId, msg.id, 'corrected', note);
      await createManualMemory(uid, {
        category: data.memoryCategory || 'preference',
        title: data.memoryTitle || 'Patient Care Correction',
        detail: data.memoryDetail || data.distilledRule,
        source: 'feedback_rule',
        confidence: 'verified',
        evidenceQuote: note,
      });
      await createFeedbackEvent(uid, {
        consultationId: activeConsultationId,
        messageId: msg.id,
        rating: 'corrected',
        userCorrection: note,
        distilledRule: data.distilledRule,
      });
      if (profile) {
        await updatePatientCareSummary(uid, profile.careSummary, (profile.learningCount || 0) + 1);
      }

      setFeedbackBanner((prev) => ({
        ...prev,
        [msg.id]: `Learned rule: ${data.distilledRule}`,
      }));
      setCorrectingMsgId(null);
      setCorrectionText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save correction.');
    } finally {
      setFeedbackSubmittingId(null);
    }
  };

  const handleSaveDetectedSymptom = async (msgId: string, detected: DetectedSymptom) => {
    try {
      await createSymptomLog(uid, {
        symptom: detected.symptom || 'Reported symptom',
        severity: detected.severity || 5,
        sleepHours: detected.sleepHours || 7,
        triggers: detected.triggers || '',
        notes: 'Logged from consultation',
        loggedDate: new Date().toISOString().slice(0, 10),
      });
      setSavedSymptomMsgIds((prev) => ({ ...prev, [msgId]: true }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save symptom log.');
    }
  };

  const isResolved = activeConsultation?.status === 'resolved';

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col lg:flex-row min-h-[calc(100vh-140px)]">
        {/* Left Rail: Consultations & Active Memory Context */}
        <aside
          className={`${
            mobileRailOpen ? 'block' : 'hidden'
          } lg:block w-full lg:w-[300px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/70 flex flex-col`}
        >
          <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold font-display text-slate-900">Consultations</h2>
            <button
              type="button"
              onClick={handleNewConsultation}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-200/80 max-h-[320px] lg:max-h-[420px]">
            {consultations.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 leading-relaxed">
                Start your first consultation to begin building your clinical memory.
              </div>
            ) : (
              consultations.map((c) => {
                const selected = c.id === activeConsultationId;
                return (
                  <div
                    key={c.id}
                    className={`group px-4 py-3 flex items-start justify-between gap-2 transition-colors ${
                      selected ? 'bg-white' : 'hover:bg-white/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectConsultation(c.id);
                        setMobileRailOpen(false);
                      }}
                      className="text-left min-w-0 flex-1"
                    >
                      <p
                        className={`text-sm font-medium truncate ${
                          selected ? 'text-teal-800' : 'text-slate-800'
                        }`}
                      >
                        {c.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {c.focusArea} · <span className="font-mono">{c.messageCount}</span> msgs ·{' '}
                        {c.status === 'resolved' ? 'Resolved' : 'Active'}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete consultation ${c.title}`}
                      onClick={() => {
                        void deleteConsultationWithMessages(uid, c.id);
                        if (selected) onSelectConsultation(null);
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Active Memory Context Strip */}
          <div className="border-t border-slate-200 p-4 bg-white">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-semibold font-display text-slate-900">
                Active Memory ({activeMemories.length})
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('memory')}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline whitespace-nowrap shrink-0"
              >
                Inspect All
              </button>
            </div>
            {activeMemories.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                No learned facts yet. Mention allergies, medications, or care preferences to teach the agent.
              </p>
            ) : (
              <ul className="space-y-2">
                {activeMemories.slice(0, 5).map((mem) => (
                  <li key={mem.id} className="text-xs text-slate-700 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                    <p className="font-medium text-slate-900 truncate">{mem.title}</p>
                    <p className="text-slate-500 truncate">
                      {mem.category} · <span className="font-mono">{mem.reinforcementCount}×</span> reinforced
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Main Consultation Stage */}
        <section className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Stage Top Bar */}
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileRailOpen((v) => !v)}
                className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
                aria-label="Toggle consultations list"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base font-semibold font-display text-slate-900 truncate">
                  {activeConsultation ? activeConsultation.title : 'Adaptive Clinical Consultation'}
                </h1>
                <p className="text-xs text-slate-500 truncate">
                  {activeConsultation
                    ? `${activeConsultation.focusArea} · ${
                        isResolved ? 'Archived Resolution' : 'Active Session'
                      }`
                    : `Guided by ${activeMemories.length} learned memories · ${
                        profile?.learningCount ?? 0
                      } learning cycles`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenResearch && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenResearch(
                      activeConsultation?.title && activeConsultation.title !== 'New Clinical Consultation'
                        ? activeConsultation.title
                        : ''
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Research Network
                </button>
              )}

              {activeConsultation && activeConsultation.status === 'active' && (
                <button
                  type="button"
                  onClick={() => resolveConsultation(uid, activeConsultation.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5 text-teal-700" />
                  Mark Resolved
                </button>
              )}
            </div>
          </div>

          {/* Messages Viewport */}
          <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-6 space-y-6">
            {messages.length === 0 ? (
              <div className="max-w-2xl mx-auto py-8">
                <p className="text-xs font-medium text-teal-700 mb-2">
                  Clinical Learning Agent · Ready
                </p>
                <h2 className="text-2xl font-semibold font-display text-slate-900 mb-2">
                  How can Meridian Care assist you today, {profile?.displayName || 'there'}?
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Share symptoms, medication questions, or care preferences. Every consultation automatically updates
                  your persistent health memory and adapts future guidance.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSend(prompt)}
                      className="text-left p-4 border border-slate-200 hover:border-teal-600/60 hover:bg-slate-50/70 rounded-xl transition-colors"
                    >
                      <p className="text-sm text-slate-800 leading-snug">{prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[78%] bg-slate-100 text-slate-900 px-4 py-3 rounded-xl text-[15px] leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                const triage = TRIAGE_LABELS[msg.triageUrgency || 'routine'] || TRIAGE_LABELS.routine;
                const TriageIcon = triage.Icon;
                const referenced = (msg.referencedMemoryIds || [])
                  .map((id) => memoryMap.get(id))
                  .filter((m): m is LearnedMemory => Boolean(m));
                const newlyLearned = (msg.learnedMemoryIds || [])
                  .map((id) => memoryMap.get(id))
                  .filter((m): m is LearnedMemory => Boolean(m));
                const detectedSymptom = detectedSymptomByMsg[msg.id];
                const isSymptomSaved = savedSymptomMsgIds[msg.id];

                return (
                  <div key={msg.id} className="max-w-3xl border border-slate-200 rounded-xl bg-white p-5">
                    {/* Metadata Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900">Meridian Care</span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className={`inline-flex items-center gap-1 font-medium ${triage.colorClass}`}>
                          <TriageIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{triage.label}</span>
                        </span>
                      </div>
                      {msg.feedbackRating !== 'none' && (
                        <span className="text-xs text-slate-500">
                          Feedback: {msg.feedbackRating === 'helpful' ? 'Helpful' : 'Rule Learned'}
                        </span>
                      )}
                    </div>

                    <MarkdownProse content={msg.content} />

                    {/* Memory Influence & Learning Provenance */}
                    {(referenced.length > 0 || newlyLearned.length > 0) && (
                      <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                        {referenced.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium text-slate-700 inline-flex items-center gap-1">
                              <BookOpen className="w-3.5 h-3.5 text-teal-700" />
                              Adapted from memory:
                            </span>
                            {referenced.map((m, idx) => (
                              <React.Fragment key={m.id}>
                                <button
                                  type="button"
                                  onClick={() => onNavigateTab('memory')}
                                  className="text-teal-700 hover:underline text-left"
                                >
                                  {m.title}
                                </button>
                                {idx < referenced.length - 1 && (
                                  <span className="text-slate-300" aria-hidden="true">
                                    ·
                                  </span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                        {newlyLearned.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium text-emerald-700 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Learned &amp; persisted:
                            </span>
                            {newlyLearned.map((m, idx) => (
                              <React.Fragment key={m.id}>
                                <button
                                  type="button"
                                  onClick={() => onNavigateTab('memory')}
                                  className="text-slate-800 hover:underline text-left font-medium"
                                >
                                  {m.title} ({m.reinforcementCount}×)
                                </button>
                                {idx < newlyLearned.length - 1 && (
                                  <span className="text-slate-300" aria-hidden="true">
                                    ·
                                  </span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* One-Click Detected Symptom Check-In */}
                    {detectedSymptom?.detected && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-slate-600">
                          Detected symptom episode: <span className="font-medium text-slate-900">{detectedSymptom.symptom}</span>{' '}
                          (severity <span className="font-mono">{detectedSymptom.severity}/10</span> · sleep{' '}
                          <span className="font-mono">{detectedSymptom.sleepHours}h</span>)
                        </p>
                        <button
                          type="button"
                          disabled={isSymptomSaved}
                          onClick={() => void handleSaveDetectedSymptom(msg.id, detectedSymptom)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:text-emerald-700 disabled:border-emerald-200 disabled:bg-emerald-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          <ClipboardPlus className="w-3.5 h-3.5" />
                          {isSymptomSaved ? 'Saved to Symptom Log' : 'Log Symptom Episode'}
                        </button>
                      </div>
                    )}

                    {/* Learning Feedback Loop */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={feedbackSubmittingId === msg.id || msg.feedbackRating === 'helpful'}
                        onClick={() => void handleHelpful(msg)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                          msg.feedbackRating === 'helpful'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        {msg.feedbackRating === 'helpful' ? 'Helpful' : 'Helpful'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCorrectingMsgId((cur) => (cur === msg.id ? null : msg.id));
                          setCorrectionText('');
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <PencilLine className="w-3.5 h-3.5" />
                        Correct / Teach Rule
                      </button>

                      {feedbackBanner[msg.id] && (
                        <span className="text-xs text-teal-700 font-medium">{feedbackBanner[msg.id]}</span>
                      )}
                    </div>

                    {correctingMsgId === msg.id && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Tell Meridian Care what to remember or adjust permanently:
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={correctionText}
                            onChange={(e) => setCorrectionText(e.target.value)}
                            placeholder="e.g., Avoid dairy recommendations—I am lactose intolerant, or keep steps under 3 bullets."
                            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                          />
                          <button
                            type="button"
                            disabled={!correctionText.trim() || feedbackSubmittingId === msg.id}
                            onClick={() => void handleSubmitCorrection(msg)}
                            className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            {feedbackSubmittingId === msg.id ? 'Distilling...' : 'Teach Rule'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {isSending && (
              <div className="max-w-3xl border border-slate-200 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
                Reviewing your {activeMemories.length} learned memories and formulating personalized guidance...
              </div>
            )}

            {followUps.length > 0 && !isSending && !isResolved && (
              <div className="max-w-3xl flex flex-wrap gap-2">
                {followUps.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void handleSend(q)}
                    className="px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50/70 hover:bg-teal-100/80 border border-teal-200 rounded-lg transition-colors text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Error Notice */}
          {errorMsg && (
            <div className="mx-5 mb-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center justify-between gap-3">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="font-medium underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Composer */}
          <div className="p-4 lg:p-5 border-t border-slate-200 bg-slate-50/60">
            {isResolved ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                <span>This consultation is archived as resolved.</span>
                <button
                  type="button"
                  onClick={handleNewConsultation}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Start New Consultation
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
                className="flex items-end gap-3"
              >
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Describe symptoms, ask about medications, or state a care preference..."
                  className="flex-1 resize-none bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isSending}
                  aria-label="Send message"
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Send</span>
                  <ArrowUp className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
