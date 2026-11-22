import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { AgentNodeGraph } from './AgentNodeGraph';
import { MarkdownProse } from './MarkdownProse';
import type {
  AgentNodeId,
  LiveNodeState,
  ResearchCitation,
  ResearchNodeSummary,
  SearchSourceType,
} from '../types/healthcare';

const STORAGE_KEY = 'meridian_chat_turns_v1';

interface ChatTurn {
  id: string;
  query: string;
  answer: string;
  citations: ResearchCitation[];
  nodeSummaries?: ResearchNodeSummary[];
}

const ALL_SOURCES: SearchSourceType[] = [
  'google_search',
  'wikipedia',
  'pubmed',
  'url_context',
];

function createInitialNodeStates(): Record<AgentNodeId, LiveNodeState> {
  return {
    trigger: {
      nodeId: 'trigger',
      label: 'Patient Query Trigger',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Awaiting message.',
      citations: [],
    },
    orchestrator: {
      nodeId: 'orchestrator',
      label: 'Healthcare AI Orchestrator',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Plans and dispatches parallel search queries.',
      citations: [],
    },
    google_search: {
      nodeId: 'google_search',
      label: 'Google Web Search',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Searches clinical guidelines and authoritative health pages.',
      citations: [],
    },
    wikipedia: {
      nodeId: 'wikipedia',
      label: 'Wikipedia Medical',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Retrieves encyclopedic disease and pharmacology summaries.',
      citations: [],
    },
    pubmed: {
      nodeId: 'pubmed',
      label: 'PubMed Literature',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Queries peer-reviewed biomedical abstracts.',
      citations: [],
    },
    url_context: {
      nodeId: 'url_context',
      label: 'Webpage URL Reader',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Reads any medical webpage URLs pasted into your message.',
      citations: [],
    },
    synthesizer: {
      nodeId: 'synthesizer',
      label: 'Evidence Synthesizer',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Combines retrieved sources into one cited clinical answer.',
      citations: [],
    },
    memory_updater: {
      nodeId: 'memory_updater',
      label: 'Result Archive',
      status: 'idle',
      latencyMs: 0,
      resultCount: 0,
      queryUsed: '',
      summary: 'Saves conversation turns and verified citations.',
      citations: [],
    },
  };
}

export const ResearchNetworkView: React.FC = () => {
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<{ query: string; error: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? (parsed as ChatTurn[]) : [];
    } catch {
      return [];
    }
  });

  const [nodeStates, setNodeStates] = useState<Record<AgentNodeId, LiveNodeState>>(
    createInitialNodeStates
  );

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-50)));
    } catch {
      // Ignore storage quota errors
    }
  }, [turns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, pendingQuery]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanQuery = input.trim();
    if (!cleanQuery || isRunning) return;

    const urlMatches = cleanQuery.match(/https?:\/\/[^\s)]+/gi) || [];
    const parsedUrls = Array.from(new Set(urlMatches)).slice(0, 5);

    setInput('');
    setPendingQuery(cleanQuery);
    setFailedTurn(null);
    setIsRunning(true);
    setErrorMsg(null);
    setNodeStates(createInitialNodeStates());

    try {
      const response = await fetch('/api/agent/research-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cleanQuery,
          urls: parsedUrls,
          activeSources: ALL_SOURCES,
          memories: [],
          profile: {
            displayName: 'User',
            communicationStyle: 'plain_language',
            preferredUnits: 'metric',
          },
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect to the multi-agent search stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedComplete = false;

      const processFrame = async (frame: string) => {
        const lines = frame.split('\n');
        let eventName = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr += line.slice(5).trim();
          }
        }
        if (!dataStr) return;

        const payload = JSON.parse(dataStr);

        if (eventName === 'node_update') {
          const update = payload as LiveNodeState;
          setNodeStates((prev) => ({
            ...prev,
            [update.nodeId]: update,
          }));
        } else if (eventName === 'error') {
          throw new Error((payload as { error?: string }).error || 'Search stream error');
        } else if (eventName === 'research_complete') {
          receivedComplete = true;
          const result = payload as {
            query: string;
            urls: string[];
            activeSources: SearchSourceType[];
            synthesizedAnswer: string;
            citations: ResearchCitation[];
            nodeSummaries: ResearchNodeSummary[];
          };

          setTurns((prev) => [
            ...prev,
            {
              id: `turn_${Date.now()}`,
              query: result.query,
              answer: result.synthesizedAnswer,
              citations: result.citations,
              nodeSummaries: result.nodeSummaries,
            },
          ]);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            await processFrame(buffer);
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
          await processFrame(frame);
        }
      }

      if (!receivedComplete) {
        throw new Error('The chat search stream ended before completing. Please try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete healthcare search.';
      setErrorMsg(msg);
      setFailedTurn({ query: cleanQuery, error: msg });
      setNodeStates((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next) as AgentNodeId[]) {
          if (next[key].status === 'running') {
            next[key] = { ...next[key], status: 'error', summary: msg };
          }
        }
        return next;
      });
    } finally {
      setPendingQuery(null);
      setIsRunning(false);
    }
  };

  return (
    <div className="relative max-w-[820px] w-full mx-auto px-4 sm:px-6 flex-1 flex flex-col">
      {/* Background: Animated Multi-Agent Node Network */}
      <AgentNodeGraph nodeStates={nodeStates} isRunning={isRunning} />

      {/* Foreground: Single-Page Chat Conversation */}
      <div className="relative z-10 flex-1 py-8 space-y-8">
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-4">
            {/* User Message */}
            <div className="flex justify-end">
              <div className="max-w-[82%] bg-white/5 border border-slate-700/70 text-slate-100 px-4 py-2.5 rounded-2xl text-sm leading-relaxed">
                {turn.query}
              </div>
            </div>

            {/* Assistant Direct Answer */}
            <div className="bg-transparent px-1 py-2">
              <MarkdownProse content={turn.answer.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')} />
            </div>
          </div>
        ))}

        {pendingQuery && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <div className="max-w-[82%] bg-white/5 border border-slate-700/70 text-slate-100 px-4 py-2.5 rounded-2xl text-sm leading-relaxed">
                {pendingQuery}
              </div>
            </div>
            <div className="inline-block px-1 py-1 text-sm text-slate-300 font-medium">
              Searching...
            </div>
          </div>
        )}
        {failedTurn && !pendingQuery && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <div className="max-w-[82%] bg-white/5 border border-slate-700/70 text-slate-100 px-4 py-2.5 rounded-2xl text-sm leading-relaxed">
                {failedTurn.query}
              </div>
            </div>
            <div className="bg-rose-950/60 border border-rose-800/70 rounded-2xl px-4 py-3 text-sm text-rose-200">
              {failedTurn.error}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Bottom: Sticky Transparent Chat Message Input */}
      <div className="sticky bottom-0 z-30 pb-5 pt-2">
        {errorMsg && !failedTurn && (
          <div className="mb-3 px-4 py-2 bg-rose-950/60 border border-rose-800/70 rounded-lg text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="bg-transparent border border-slate-700/80 rounded-2xl p-2 flex items-end gap-2"
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
            placeholder="Ask a healthcare question..."
            className="flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || isRunning}
            aria-label="Send message"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-40 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <span>Send</span>
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
