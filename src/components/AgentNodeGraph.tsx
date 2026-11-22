import React from 'react';
import {
  BookOpen,
  BrainCircuit,
  Database,
  FileSearch,
  Globe,
  Link2,
  Play,
  Sparkles,
} from 'lucide-react';
import type { AgentNodeId, AgentNodeStatus, LiveNodeState } from '../types/healthcare';

interface Props {
  nodeStates: Record<AgentNodeId, LiveNodeState>;
  isRunning: boolean;
}

interface NodeVisualSpec {
  id: AgentNodeId;
  x: number;
  y: number;
  bgClass: string;
  edgeColor: string;
  Icon: React.ElementType;
}

const NODE_SPECS: NodeVisualSpec[] = [
  {
    id: 'trigger',
    x: 84,
    y: 88,
    bgClass: 'bg-emerald-500 text-white',
    edgeColor: '#10b981',
    Icon: Play,
  },
  {
    id: 'orchestrator',
    x: 276,
    y: 190,
    bgClass: 'bg-[#173f66] text-white',
    edgeColor: '#38bdf8',
    Icon: BrainCircuit,
  },
  {
    id: 'google_search',
    x: 515,
    y: 52,
    bgClass: 'bg-teal-600 text-white',
    edgeColor: '#14b8a6',
    Icon: Globe,
  },
  {
    id: 'wikipedia',
    x: 515,
    y: 144,
    bgClass: 'bg-slate-700 text-white',
    edgeColor: '#94a3b8',
    Icon: BookOpen,
  },
  {
    id: 'pubmed',
    x: 515,
    y: 236,
    bgClass: 'bg-amber-500 text-white',
    edgeColor: '#f59e0b',
    Icon: FileSearch,
  },
  {
    id: 'url_context',
    x: 515,
    y: 328,
    bgClass: 'bg-emerald-600 text-white',
    edgeColor: '#10b981',
    Icon: Link2,
  },
  {
    id: 'synthesizer',
    x: 742,
    y: 190,
    bgClass: 'bg-[#173f66] text-white',
    edgeColor: '#38bdf8',
    Icon: Sparkles,
  },
  {
    id: 'memory_updater',
    x: 892,
    y: 190,
    bgClass: 'bg-teal-700 text-white',
    edgeColor: '#0f766e',
    Icon: Database,
  },
];

interface EdgeSpec {
  id: string;
  from: AgentNodeId;
  to: AgentNodeId;
  path: string;
  midX: number;
  midY: number;
  color: string;
}

const EDGES: EdgeSpec[] = [
  {
    id: 'trigger-orch',
    from: 'trigger',
    to: 'orchestrator',
    path: 'M 118 88 C 182 88, 178 190, 242 190',
    midX: 180,
    midY: 139,
    color: '#10b981',
  },
  {
    id: 'orch-google',
    from: 'orchestrator',
    to: 'google_search',
    path: 'M 310 177 C 392 177, 404 52, 481 52',
    midX: 396,
    midY: 114,
    color: '#0d9488',
  },
  {
    id: 'orch-wiki',
    from: 'orchestrator',
    to: 'wikipedia',
    path: 'M 310 185 C 392 185, 404 144, 481 144',
    midX: 396,
    midY: 164,
    color: '#334155',
  },
  {
    id: 'orch-pubmed',
    from: 'orchestrator',
    to: 'pubmed',
    path: 'M 310 195 C 392 195, 404 236, 481 236',
    midX: 396,
    midY: 215,
    color: '#d97706',
  },
  {
    id: 'orch-url',
    from: 'orchestrator',
    to: 'url_context',
    path: 'M 310 203 C 392 203, 404 328, 481 328',
    midX: 396,
    midY: 265,
    color: '#059669',
  },
  {
    id: 'google-synth',
    from: 'google_search',
    to: 'synthesizer',
    path: 'M 549 52 C 630 52, 634 177, 708 177',
    midX: 628,
    midY: 114,
    color: '#0d9488',
  },
  {
    id: 'wiki-synth',
    from: 'wikipedia',
    to: 'synthesizer',
    path: 'M 549 144 C 630 144, 634 185, 708 185',
    midX: 628,
    midY: 164,
    color: '#334155',
  },
  {
    id: 'pubmed-synth',
    from: 'pubmed',
    to: 'synthesizer',
    path: 'M 549 236 C 630 236, 634 195, 708 195',
    midX: 628,
    midY: 215,
    color: '#d97706',
  },
  {
    id: 'url-synth',
    from: 'url_context',
    to: 'synthesizer',
    path: 'M 549 328 C 630 328, 634 203, 708 203',
    midX: 628,
    midY: 265,
    color: '#059669',
  },
  {
    id: 'synth-memory',
    from: 'synthesizer',
    to: 'memory_updater',
    path: 'M 776 190 L 858 190',
    midX: 817,
    midY: 190,
    color: '#0f766e',
  },
];


function isEdgeActive(
  edge: EdgeSpec,
  nodeStates: Record<AgentNodeId, LiveNodeState>
): { flowing: boolean; completed: boolean; dimmed: boolean } {
  const fromStatus: AgentNodeStatus = nodeStates[edge.from]?.status || 'idle';
  const toStatus: AgentNodeStatus = nodeStates[edge.to]?.status || 'idle';

  if (toStatus === 'skipped' || fromStatus === 'skipped') {
    return { flowing: false, completed: false, dimmed: true };
  }
  if (toStatus === 'running' || (fromStatus === 'running' && toStatus === 'idle')) {
    return { flowing: true, completed: false, dimmed: false };
  }
  if (fromStatus === 'completed' && toStatus === 'completed') {
    return { flowing: false, completed: true, dimmed: false };
  }
  return { flowing: false, completed: false, dimmed: false };
}

export const AgentNodeGraph: React.FC<Props> = ({ nodeStates, isRunning }) => {
  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 pointer-events-none select-none flex items-center justify-center overflow-hidden transition-all duration-500 ease-out ${
        isRunning
          ? 'z-20 bg-[#090d16]/75 backdrop-blur-[2px]'
          : 'z-0 bg-transparent'
      }`}
      style={{
        backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div
        className={`w-full max-w-[1040px] px-6 transition-all duration-500 ease-out ${
          isRunning
            ? 'opacity-100 scale-105 drop-shadow-[0_0_28px_rgba(20,184,166,0.22)]'
            : 'opacity-25 scale-95'
        }`}
      >
        <div className="relative w-full mx-auto aspect-[960/400]">
          <svg viewBox="0 0 960 400" className="absolute inset-0 w-full h-full">
            {EDGES.map((edge) => {
              const { flowing, completed, dimmed } = isEdgeActive(edge, nodeStates);
              const stroke = dimmed
                ? '#1e293b'
                : flowing || completed
                ? edge.color
                : '#334155';

              return (
                <g key={edge.id}>
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={flowing ? 2.5 : completed ? 2 : 1.5}
                    strokeDasharray={dimmed ? '4 4' : flowing ? '6 5' : undefined}
                    className="transition-colors duration-200"
                  />
                  <circle
                    cx={edge.midX}
                    cy={edge.midY}
                    r={6}
                    fill="#090d16"
                    stroke={stroke}
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={edge.midX}
                    cy={edge.midY}
                    r={2}
                    fill={flowing || completed ? edge.color : '#64748b'}
                  />
                  {flowing && (
                    <circle r="4.5" fill={edge.color}>
                      <animateMotion dur="1.3s" repeatCount="indefinite" path={edge.path} />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>

          {NODE_SPECS.map((node) => {
            const state = nodeStates[node.id];
            const status = state?.status || 'idle';
            const Icon = node.Icon;

            const leftPct = (node.x / 960) * 100;
            const topPct = (node.y / 400) * 100;

            return (
              <div
                key={node.id}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              >
                <div
                  className={`relative w-14 h-14 rounded-[18px] flex items-center justify-center shadow-xs ${
                    node.bgClass
                  } ${status === 'skipped' ? 'opacity-40' : ''}`}
                >
                  <Icon
                    className={`w-6 h-6 ${
                      status === 'running' ? 'animate-pulse motion-reduce:animate-none' : ''
                    }`}
                  />
                  <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#090d16] border border-slate-600" />
                  <span className="absolute -right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#090d16] border border-slate-600" />
                  {status === 'running' && (
                    <span className="absolute -inset-1.5 rounded-[22px] border-2 border-teal-400/70 animate-ping motion-reduce:animate-none" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
