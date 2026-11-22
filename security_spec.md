# Security Specification — Meridian Care

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document under `/users/{userId}` and its subcollections (`private`, `memories`, `consultations`, `messages`, `symptomLogs`, `feedbackEvents`) can only be read or written when `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Identity Integrity**: Incoming `userId` on every created/updated document must equal `request.auth.uid`, and `userId` and `createdAt` are immutable after creation.
3. **PII Isolation**: User email is isolated in `/users/{userId}/private/info` (`allow list: if false`). Blanket reads/lists across `/users` are forbidden.
4. **Master Gate on Consultation Messages**: A `ConsultationMessage` can only be created when the parent consultation `/users/{userId}/consultations/{consultationId}` exists, belongs to `request.auth.uid`, and has `status == 'active'`.
5. **Terminal State Locking**: Once a `Consultation` transitions to `status == 'resolved'`, no further updates to the consultation or new messages in that consultation are permitted.
6. **Temporal & Volumetric Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`. Every string and list enforces strict length and regex bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Cross-Tenant Profile Read/Write**: User B attempts to read or update `/users/userA`. -> `PERMISSION_DENIED`
2. **Unverified Email Spoofing**: Authenticated user with `email_verified: false` attempts to create a `LearnedMemory`. -> `PERMISSION_DENIED`
3. **Identity Spoofing in Payload**: User A creates `/users/userA/memories/m1` with `userId: "userB"`. -> `PERMISSION_DENIED`
4. **Ghost Field / Shadow Update**: User A sends `{ ..., isDoctorVerified: true }` on `LearnedMemory` create or update. -> `PERMISSION_DENIED`
5. **Document ID Poisoning**: User A writes to `/users/userA/memories/bad..id$with/chars` or >128 chars. -> `PERMISSION_DENIED`
6. **Client Timestamp Forgery**: User A sets `createdAt` to a backdated timestamp instead of `request.time`. -> `PERMISSION_DENIED`
7. **Immutable Field Tampering**: User A updates `createdAt` or `userId` on an existing `LearnedMemory`. -> `PERMISSION_DENIED`
8. **Orphaned Message Creation**: User A writes a `ConsultationMessage` under a nonexistent `consultationId`. -> `PERMISSION_DENIED`
9. **Terminal State Bypass**: User A attempts to edit a `Consultation` or add a `ConsultationMessage` after `status == 'resolved'`. -> `PERMISSION_DENIED`
10. **Array Bomb / Type Poisoning**: User A submits `referencedMemoryIds` with 25 items or non-string first element `[123]`. -> `PERMISSION_DENIED`
11. **Severity Out-of-Bounds**: User A logs a `SymptomLog` with `severity: 99` or `sleepHours: 40`. -> `PERMISSION_DENIED`
12. **Blanket Collection Scraping**: User A attempts `list` on `/users` or `/users/userB/memories`. -> `PERMISSION_DENIED`
