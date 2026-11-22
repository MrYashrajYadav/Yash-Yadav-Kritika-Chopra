import type { Timestamp } from 'firebase/firestore';

export type CommunicationStyle = 'concise' | 'detailed' | 'plain_language' | 'clinical';
export type PreferredUnits = 'metric' | 'imperial';

export type MemoryCategory =
  | 'condition'
  | 'medication'
  | 'allergy'
  | 'trigger'
  | 'lifestyle'
  | 'preference'
  | 'goal';

export type MemorySource = 'auto_learned' | 'feedback_rule' | 'user_taught' | 'pattern_synthesis';
export type MemoryConfidence = 'high' | 'medium' | 'verified';
export type MemoryStatus = 'active' | 'archived';

export type TriageUrgency = 'none' | 'routine' | 'monitor' | 'prompt_care' | 'urgent';
export type FeedbackRating = 'none' | 'helpful' | 'corrected' | 'inaccurate';

export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export const FIELD_LIMITS = {
  displayNameMax: 120,
  careSummaryMax: 4000,
  memoryTitleMax: 160,
  memoryDetailMax: 1000,
  evidenceQuoteMax: 400,
  consultationTitleMax: 160,
  focusAreaMax: 80,
  messagePreviewMax: 240,
  messageContentMax: 12000,
  feedbackNoteMax: 600,
  symptomMax: 160,
  triggersMax: 400,
  notesMax: 1000,
  userCorrectionMax: 1000,
  distilledRuleMax: 500,
  maxMemoryRefs: 20,
} as const;

export interface PatientProfile {
  userId: string;
  displayName: string;
  communicationStyle: CommunicationStyle;
  preferredUnits: PreferredUnits;
  careSummary: string;
  learningCount: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LearnedMemory {
  id: string;
  userId: string;
  category: MemoryCategory;
  title: string;
  detail: string;
  source: MemorySource;
  confidence: MemoryConfidence;
  status: MemoryStatus;
  reinforcementCount: number;
  evidenceQuote: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Consultation {
  id: string;
  userId: string;
  title: string;
  focusArea: string;
  status: 'active' | 'resolved';
  messageCount: number;
  lastMessagePreview: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ConsultationMessage {
  id: string;
  userId: string;
  consultationId: string;
  role: 'user' | 'assistant';
  content: string;
  triageUrgency: TriageUrgency;
  referencedMemoryIds: string[];
  learnedMemoryIds: string[];
  feedbackRating: FeedbackRating;
  feedbackNote: string;
  createdAt?: Timestamp;
}

export interface SymptomLog {
  id: string;
  userId: string;
  symptom: string;
  severity: number;
  sleepHours: number;
  triggers: string;
  notes: string;
  loggedDate: string;
  createdAt?: Timestamp;
}

export interface FeedbackEvent {
  id: string;
  userId: string;
  consultationId: string;
  messageId: string;
  rating: 'helpful' | 'corrected' | 'inaccurate';
  userCorrection: string;
  distilledRule: string;
  createdAt?: Timestamp;
}

export interface MemoryOperation {
  action: 'add' | 'reinforce' | 'update';
  targetMemoryId: string;
  category: MemoryCategory;
  title: string;
  detail: string;
  confidence: 'high' | 'medium';
  evidenceQuote: string;
}

export interface DetectedSymptom {
  detected: boolean;
  symptom: string;
  severity: number;
  sleepHours: number;
  triggers: string;
}

export interface ConsultApiResponse {
  reply: string;
  suggestedTitle: string;
  focusArea: string;
  triageUrgency: TriageUrgency;
  referencedMemoryIds: string[];
  memoryOperations: MemoryOperation[];
  suggestedFollowUps: string[];
  detectedSymptom: DetectedSymptom;
}

export interface FeedbackApiResponse {
  distilledRule: string;
  memoryCategory: MemoryCategory;
  memoryTitle: string;
  memoryDetail: string;
  acknowledgement: string;
}

export interface CarePlaybookItem {
  phase: string;
  action: string;
  rationale: string;
}

export interface SynthesizeApiResponse {
  careSummary: string;
  discoveredPatterns: Array<{
    title: string;
    detail: string;
    category: 'trigger' | 'lifestyle' | 'condition' | 'goal';
    confidence: 'high' | 'medium';
    evidenceQuote: string;
  }>;
  carePlaybook: CarePlaybookItem[];
  clinicianQuestions: string[];
}

export type SearchSourceType = 'google_search' | 'wikipedia' | 'pubmed' | 'url_context';

export type AgentNodeId =
  | 'trigger'
  | 'orchestrator'
  | 'google_search'
  | 'wikipedia'
  | 'pubmed'
  | 'url_context'
  | 'synthesizer'
  | 'memory_updater';

export type AgentNodeStatus = 'idle' | 'running' | 'completed' | 'skipped' | 'error';

export interface ResearchCitation {
  index: number;
  title: string;
  url: string;
  sourceType: SearchSourceType;
  snippet: string;
}

export interface ResearchNodeSummary {
  nodeId: AgentNodeId;
  label: string;
  status: 'completed' | 'skipped' | 'error';
  latencyMs: number;
  resultCount: number;
  queryUsed: string;
  summary: string;
}

export interface LiveNodeState {
  nodeId: AgentNodeId;
  label: string;
  status: AgentNodeStatus;
  latencyMs: number;
  resultCount: number;
  queryUsed: string;
  summary: string;
  citations: ResearchCitation[];
  errorMessage?: string;
}

export interface CandidateResearchMemory {
  category: MemoryCategory;
  title: string;
  detail: string;
  evidenceQuote: string;
}

export interface ResearchRun {
  id: string;
  userId: string;
  query: string;
  urls: string[];
  activeSources: SearchSourceType[];
  synthesizedAnswer: string;
  citations: ResearchCitation[];
  nodeSummaries: ResearchNodeSummary[];
  savedToMemory: boolean;
  createdAt?: Timestamp;
}

