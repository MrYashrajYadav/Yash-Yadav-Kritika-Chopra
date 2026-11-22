import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  FIELD_LIMITS,
  type CommunicationStyle,
  type Consultation,
  type ConsultationMessage,
  type FeedbackEvent,
  type FeedbackRating,
  type LearnedMemory,
  type MemoryCategory,
  type MemoryConfidence,
  type MemoryOperation,
  type MemorySource,
  type MemoryStatus,
  type PatientProfile,
  type PreferredUnits,
  type ResearchCitation,
  type ResearchNodeSummary,
  type ResearchRun,
  type SearchSourceType,
  type SymptomLog,
  type TriageUrgency,
} from '../types/healthcare';

function clip(value: string | undefined | null, maxLen: number, fallback = ''): string {
  const trimmed = (value ?? '').trim();
  const str = trimmed.length > 0 ? trimmed : fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'condition',
  'medication',
  'allergy',
  'trigger',
  'lifestyle',
  'preference',
  'goal',
]);

function normalizeCategory(cat: string): MemoryCategory {
  return VALID_CATEGORIES.has(cat as MemoryCategory) ? (cat as MemoryCategory) : 'lifestyle';
}

export async function ensurePatientProfile(user: User): Promise<void> {
  const uid = user.uid;
  const profilePath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  try {
    const profileRef = doc(db, 'users', uid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      const displayName = clip(user.displayName || user.email?.split('@')[0] || 'Patient', FIELD_LIMITS.displayNameMax, 'Patient');
      await setDoc(profileRef, {
        userId: uid,
        displayName,
        communicationStyle: 'plain_language',
        preferredUnits: 'metric',
        careSummary:
          'Your clinical memory is active. As you discuss symptoms, medications, allergies, and care preferences, Meridian Care will learn and adapt to your profile.',
        learningCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, profilePath);
  }

  try {
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    const privSnap = await getDoc(privateRef);
    if (!privSnap.exists() && user.email) {
      await setDoc(privateRef, {
        userId: uid,
        email: clip(user.email, 254),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }
}

export function subscribeProfile(uid: string, onData: (profile: PatientProfile | null) => void) {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as PatientProfile);
      } else {
        onData(null);
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export async function updatePatientPreferences(
  uid: string,
  updates: {
    displayName: string;
    communicationStyle: CommunicationStyle;
    preferredUnits: PreferredUnits;
  }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: clip(updates.displayName, FIELD_LIMITS.displayNameMax, 'Patient'),
      communicationStyle: updates.communicationStyle,
      preferredUnits: updates.preferredUnits,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updatePatientCareSummary(
  uid: string,
  careSummary: string,
  learningCount: number
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      careSummary: clip(careSummary, FIELD_LIMITS.careSummaryMax),
      learningCount: Math.max(0, Math.min(1000000, Math.round(learningCount))),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeMemories(uid: string, onData: (memories: LearnedMemory[]) => void) {
  const path = `users/${uid}/memories`;
  const q = query(collection(db, 'users', uid, 'memories'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<LearnedMemory, 'id'>) }))
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createManualMemory(
  uid: string,
  input: {
    category: MemoryCategory;
    title: string;
    detail: string;
    source?: MemorySource;
    confidence?: MemoryConfidence;
    evidenceQuote?: string;
  }
): Promise<string> {
  const memoryId = makeDocId('mem');
  const path = `users/${uid}/memories/${memoryId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'memories', memoryId), {
      userId: uid,
      category: normalizeCategory(input.category),
      title: clip(input.title, FIELD_LIMITS.memoryTitleMax, 'Health Note'),
      detail: clip(input.detail, FIELD_LIMITS.memoryDetailMax, 'User noted preference'),
      source: input.source || 'user_taught',
      confidence: input.confidence || 'verified',
      status: 'active',
      reinforcementCount: 1,
      evidenceQuote: clip(input.evidenceQuote || 'Added directly by patient', FIELD_LIMITS.evidenceQuoteMax),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return memoryId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function applyMemoryOperations(
  uid: string,
  operations: MemoryOperation[],
  existingMemories: LearnedMemory[]
): Promise<string[]> {
  const affectedIds: string[] = [];

  for (const op of operations.slice(0, 8)) {
    const existing = op.targetMemoryId
      ? existingMemories.find((m) => m.id === op.targetMemoryId)
      : existingMemories.find((m) => m.title.toLowerCase() === op.title.toLowerCase() && m.status === 'active');

    if ((op.action === 'reinforce' || op.action === 'update') && existing) {
      const path = `users/${uid}/memories/${existing.id}`;
      try {
        await updateDoc(doc(db, 'users', uid, 'memories', existing.id), {
          detail: clip(op.detail || existing.detail, FIELD_LIMITS.memoryDetailMax, existing.detail),
          confidence: existing.confidence === 'verified' ? 'verified' : op.confidence === 'high' ? 'high' : existing.confidence,
          reinforcementCount: Math.min(10000, (existing.reinforcementCount || 1) + 1),
          evidenceQuote: clip(op.evidenceQuote || existing.evidenceQuote, FIELD_LIMITS.evidenceQuoteMax),
          updatedAt: serverTimestamp(),
        });
        affectedIds.push(existing.id);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else if (op.title.trim() && op.detail.trim()) {
      const memoryId = makeDocId('mem');
      const path = `users/${uid}/memories/${memoryId}`;
      try {
        await setDoc(doc(db, 'users', uid, 'memories', memoryId), {
          userId: uid,
          category: normalizeCategory(op.category),
          title: clip(op.title, FIELD_LIMITS.memoryTitleMax),
          detail: clip(op.detail, FIELD_LIMITS.memoryDetailMax),
          source: 'auto_learned',
          confidence: op.confidence === 'high' ? 'high' : 'medium',
          status: 'active',
          reinforcementCount: 1,
          evidenceQuote: clip(op.evidenceQuote, FIELD_LIMITS.evidenceQuoteMax),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        affectedIds.push(memoryId);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    }
  }

  return affectedIds;
}

export async function updateMemoryManual(
  uid: string,
  memoryId: string,
  patch: {
    title: string;
    detail: string;
    category: MemoryCategory;
    confidence: MemoryConfidence;
  }
): Promise<void> {
  const path = `users/${uid}/memories/${memoryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'memories', memoryId), {
      title: clip(patch.title, FIELD_LIMITS.memoryTitleMax, 'Health Note'),
      detail: clip(patch.detail, FIELD_LIMITS.memoryDetailMax, 'Updated detail'),
      category: normalizeCategory(patch.category),
      confidence: patch.confidence,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleMemoryArchive(uid: string, memoryId: string, status: MemoryStatus): Promise<void> {
  const path = `users/${uid}/memories/${memoryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'memories', memoryId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteMemory(uid: string, memoryId: string): Promise<void> {
  const path = `users/${uid}/memories/${memoryId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'memories', memoryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeConsultations(uid: string, onData: (items: Consultation[]) => void) {
  const path = `users/${uid}/consultations`;
  const q = query(collection(db, 'users', uid, 'consultations'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Consultation, 'id'>) }))
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createConsultation(uid: string, title: string, focusArea = 'General Care'): Promise<string> {
  const consultationId = makeDocId('con');
  const path = `users/${uid}/consultations/${consultationId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'consultations', consultationId), {
      userId: uid,
      title: clip(title, FIELD_LIMITS.consultationTitleMax, 'New Consultation'),
      focusArea: clip(focusArea, FIELD_LIMITS.focusAreaMax, 'General Care'),
      status: 'active',
      messageCount: 0,
      lastMessagePreview: 'Consultation started',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return consultationId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateConsultationMeta(
  uid: string,
  consultationId: string,
  patch: {
    title: string;
    focusArea: string;
    messageCount: number;
    lastMessagePreview: string;
  }
): Promise<void> {
  const path = `users/${uid}/consultations/${consultationId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'consultations', consultationId), {
      title: clip(patch.title, FIELD_LIMITS.consultationTitleMax, 'Consultation'),
      focusArea: clip(patch.focusArea, FIELD_LIMITS.focusAreaMax, 'General Care'),
      messageCount: Math.max(0, Math.min(10000, patch.messageCount)),
      lastMessagePreview: clip(patch.lastMessagePreview, FIELD_LIMITS.messagePreviewMax),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function resolveConsultation(uid: string, consultationId: string): Promise<void> {
  const path = `users/${uid}/consultations/${consultationId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'consultations', consultationId), {
      status: 'resolved',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteConsultationWithMessages(uid: string, consultationId: string): Promise<void> {
  const msgsPath = `users/${uid}/consultations/${consultationId}/messages`;
  try {
    const q = query(
      collection(db, 'users', uid, 'consultations', consultationId, 'messages'),
      where('userId', '==', uid)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, msgsPath);
  }

  const consultPath = `users/${uid}/consultations/${consultationId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'consultations', consultationId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, consultPath);
  }
}

export function subscribeMessages(
  uid: string,
  consultationId: string,
  onData: (messages: ConsultationMessage[]) => void
) {
  const path = `users/${uid}/consultations/${consultationId}/messages`;
  const q = query(
    collection(db, 'users', uid, 'consultations', consultationId, 'messages'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ConsultationMessage, 'id'>) }))
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function addConsultationMessage(
  uid: string,
  consultationId: string,
  msg: {
    role: 'user' | 'assistant';
    content: string;
    triageUrgency: TriageUrgency;
    referencedMemoryIds: string[];
    learnedMemoryIds: string[];
  }
): Promise<string> {
  const messageId = makeDocId('msg');
  const path = `users/${uid}/consultations/${consultationId}/messages/${messageId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'consultations', consultationId, 'messages', messageId), {
      userId: uid,
      consultationId,
      role: msg.role,
      content: clip(msg.content, FIELD_LIMITS.messageContentMax, '...'),
      triageUrgency: msg.triageUrgency,
      referencedMemoryIds: msg.referencedMemoryIds.filter((id) => id.length > 0 && id.length <= 128).slice(0, FIELD_LIMITS.maxMemoryRefs),
      learnedMemoryIds: msg.learnedMemoryIds.filter((id) => id.length > 0 && id.length <= 128).slice(0, FIELD_LIMITS.maxMemoryRefs),
      feedbackRating: 'none',
      feedbackNote: '',
      createdAt: serverTimestamp(),
    });
    return messageId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateMessageFeedback(
  uid: string,
  consultationId: string,
  messageId: string,
  rating: FeedbackRating,
  note: string
): Promise<void> {
  const path = `users/${uid}/consultations/${consultationId}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'consultations', consultationId, 'messages', messageId), {
      feedbackRating: rating,
      feedbackNote: clip(note, FIELD_LIMITS.feedbackNoteMax),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeSymptomLogs(uid: string, onData: (logs: SymptomLog[]) => void) {
  const path = `users/${uid}/symptomLogs`;
  const q = query(collection(db, 'users', uid, 'symptomLogs'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SymptomLog, 'id'>) }))
        .sort((a, b) => b.loggedDate.localeCompare(a.loggedDate));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createSymptomLog(
  uid: string,
  input: {
    symptom: string;
    severity: number;
    sleepHours: number;
    triggers: string;
    notes: string;
    loggedDate: string;
  }
): Promise<string> {
  const logId = makeDocId('log');
  const path = `users/${uid}/symptomLogs/${logId}`;
  const safeDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.loggedDate)
    ? input.loggedDate
    : new Date().toISOString().slice(0, 10);

  try {
    await setDoc(doc(db, 'users', uid, 'symptomLogs', logId), {
      userId: uid,
      symptom: clip(input.symptom, FIELD_LIMITS.symptomMax, 'General symptom'),
      severity: Math.max(1, Math.min(10, Math.round(input.severity))),
      sleepHours: Math.max(0, Math.min(24, Number(input.sleepHours) || 0)),
      triggers: clip(input.triggers, FIELD_LIMITS.triggersMax),
      notes: clip(input.notes, FIELD_LIMITS.notesMax),
      loggedDate: safeDate,
      createdAt: serverTimestamp(),
    });
    return logId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteSymptomLog(uid: string, logId: string): Promise<void> {
  const path = `users/${uid}/symptomLogs/${logId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'symptomLogs', logId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeFeedbackEvents(uid: string, onData: (events: FeedbackEvent[]) => void) {
  const path = `users/${uid}/feedbackEvents`;
  const q = query(collection(db, 'users', uid, 'feedbackEvents'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<FeedbackEvent, 'id'>) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createFeedbackEvent(
  uid: string,
  input: {
    consultationId: string;
    messageId: string;
    rating: 'helpful' | 'corrected' | 'inaccurate';
    userCorrection: string;
    distilledRule: string;
  }
): Promise<string> {
  const feedbackId = makeDocId('fb');
  const path = `users/${uid}/feedbackEvents/${feedbackId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'feedbackEvents', feedbackId), {
      userId: uid,
      consultationId: input.consultationId,
      messageId: input.messageId,
      rating: input.rating,
      userCorrection: clip(input.userCorrection, FIELD_LIMITS.userCorrectionMax),
      distilledRule: clip(input.distilledRule, FIELD_LIMITS.distilledRuleMax),
      createdAt: serverTimestamp(),
    });
    return feedbackId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeResearchRuns(uid: string, onData: (runs: ResearchRun[]) => void) {
  const path = `users/${uid}/researchRuns`;
  const q = query(collection(db, 'users', uid, 'researchRuns'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ResearchRun, 'id'>) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createResearchRun(
  uid: string,
  input: {
    query: string;
    urls: string[];
    activeSources: SearchSourceType[];
    synthesizedAnswer: string;
    citations: ResearchCitation[];
    nodeSummaries: ResearchNodeSummary[];
    savedToMemory?: boolean;
  }
): Promise<string> {
  const runId = makeDocId('res');
  const path = `users/${uid}/researchRuns/${runId}`;
  try {
    const cleanUrls = input.urls.map((u) => clip(u, 500)).filter(Boolean).slice(0, 5);
    const cleanSources = input.activeSources.map((s) => clip(s, 32)).filter(Boolean).slice(0, 4);
    const cleanCitations = input.citations.slice(0, 24).map((c, idx) => ({
      index: Math.round(c.index || idx + 1),
      title: clip(c.title, 300, 'Source'),
      url: clip(c.url, 1000, 'https://www.google.com'),
      sourceType: c.sourceType,
      snippet: clip(c.snippet, 1000),
    }));
    const cleanNodes = input.nodeSummaries.slice(0, 8).map((n) => ({
      nodeId: clip(n.nodeId, 64),
      label: clip(n.label, 120),
      status: n.status,
      latencyMs: Math.max(0, Math.round(n.latencyMs)),
      resultCount: Math.max(0, Math.round(n.resultCount)),
      queryUsed: clip(n.queryUsed, 400),
      summary: clip(n.summary, 600),
    }));

    await setDoc(doc(db, 'users', uid, 'researchRuns', runId), {
      userId: uid,
      query: clip(input.query, 1000, 'Healthcare research query'),
      urls: cleanUrls,
      activeSources: cleanSources,
      synthesizedAnswer: clip(input.synthesizedAnswer, 14000, 'No synthesis generated.'),
      citations: cleanCitations,
      nodeSummaries: cleanNodes,
      savedToMemory: Boolean(input.savedToMemory),
      createdAt: serverTimestamp(),
    });
    return runId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function markResearchRunSaved(uid: string, runId: string): Promise<void> {
  const path = `users/${uid}/researchRuns/${runId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'researchRuns', runId), {
      savedToMemory: true,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteResearchRun(uid: string, runId: string): Promise<void> {
  const path = `users/${uid}/researchRuns/${runId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'researchRuns', runId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

