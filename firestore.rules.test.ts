/**
 * Security test suite specification for Meridian Care Firestore Rules.
 * Verifies the "Dirty Dozen" adversarial payloads against expected PERMISSION_DENIED outcomes.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-tenant profile read',
    operation: 'get',
    path: '/users/userA',
    auth: { uid: 'userB', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email memory creation',
    operation: 'create',
    path: '/users/userA/memories/mem1',
    auth: { uid: 'userA', emailVerified: false },
    payload: { userId: 'userA', category: 'allergy', title: 'Penicillin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity spoofing in userId field',
    operation: 'create',
    path: '/users/userA/memories/mem2',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userB', category: 'allergy', title: 'Peanuts' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow update with ghost field',
    operation: 'update',
    path: '/users/userA/memories/mem1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { isClinicianApproved: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Path ID poisoning',
    operation: 'create',
    path: '/users/userA/memories/invalid$id!#',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userA', category: 'goal', title: 'Sleep 8h' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Backdated client timestamp forgery',
    operation: 'create',
    path: '/users/userA/symptomLogs/log1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userA', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable createdAt tampering on update',
    operation: 'update',
    path: '/users/userA/memories/mem1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { createdAt: '2022-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Orphaned message on missing consultation',
    operation: 'create',
    path: '/users/userA/consultations/nonexistent/messages/msg1',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userA', consultationId: 'nonexistent', role: 'user', content: 'Hello' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal state bypass on resolved consultation',
    operation: 'update',
    path: '/users/userA/consultations/resolvedConsult',
    auth: { uid: 'userA', emailVerified: true },
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Array type poisoning on referencedMemoryIds',
    operation: 'create',
    path: '/users/userA/consultations/c1/messages/msg2',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userA', consultationId: 'c1', referencedMemoryIds: [12345] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Out-of-bounds symptom severity',
    operation: 'create',
    path: '/users/userA/symptomLogs/log2',
    auth: { uid: 'userA', emailVerified: true },
    payload: { userId: 'userA', symptom: 'Headache', severity: 99, sleepHours: 7 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket collection list scraping on /users',
    operation: 'list',
    path: '/users',
    auth: { uid: 'userA', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
];
