# M4 implementation notes — Full Mock / CBT Exam Engine

M4 replaces the mock-exam preview with a real persisted multi-subject CBT engine.

## What is implemented

### Configurable full-mock blueprint

New tables:

- `exam_blueprints`
- `exam_blueprint_subject_overrides`

The JAMB full mock is seeded as data rather than hard-coded into the client:

- 4 selected subjects
- 2 hours (`7200` seconds)
- default 40 questions per subject
- Use of English override: 60 questions

That yields a 180-question paper for the current JAMB blueprint. If official conditions change later, the blueprint can be migrated without rewriting the exam runner.

### Persisted exam attempts

New tables:

- `exam_attempts`
- `exam_attempt_subjects`
- `exam_attempt_questions`
- `exam_attempt_answers`

The complete paper is generated once and frozen at exam creation. Refreshing, navigating away, closing the browser and resuming all load the same question IDs/order.

Each frozen question keeps:

- provider/source reference
- optional internal question ID
- answer-free `StudentQuestion` snapshot
- server-only correct option key
- server-only explanation
- stable subject position
- stable overall position

The browser never receives the answer key while an exam is active.

### One active mock at a time

A partial unique index prevents duplicate live attempts for one student/exam body.

The API also checks for an existing active attempt first. A double tap/racing request resolves to the existing attempt instead of creating two papers.

### Strict full-paper inventory

Unlike Practice mode, a full mock does **not** silently shrink when the configured provider lacks questions.

For each selected subject the provider must return exactly the blueprint count. Otherwise creation fails with a clean `INVENTORY_SHORTAGE` response showing the subject and available/required counts.

This is deliberate: a 4-question local seed must never masquerade as a 180-question JAMB full mock.

### Atomic database functions

M4 adds service-role-only PostgreSQL functions:

- `create_exam_attempt(...)`
- `save_exam_response(...)`
- `submit_exam_attempt(...)`

`create_exam_attempt` freezes the complete multi-subject paper in one transaction.

`save_exam_response` atomically stores both:

- selected answer (including clearing an answer)
- flag-for-review state

and updates attempt + subject counters.

`submit_exam_attempt` is idempotent and locks the final counters. If authoritative time has already elapsed, the submission reason is forced to `time_expired`.

### Server-authoritative timer

PostgreSQL writes:

- `started_at`
- `expires_at`

The browser only renders the countdown from `expires_at`.

The answer-saving function rejects writes after server expiry, so changing a phone clock cannot extend the paper.

Loading an expired in-progress attempt causes the server to submit it automatically before returning the attempt.

### Mobile-first CBT runner

`/exam/[attemptId]` is now a real full-screen exam application with no normal student bottom navigation.

Implemented:

- compact mobile exam header
- always-visible countdown
- save state
- online/offline state
- horizontally scrollable subject tabs
- per-subject answered counts
- large A/B/C/D/E touch targets
- clear answer
- flag for review
- previous / next
- mobile question navigator bottom sheet
- persistent desktop navigator
- answered / unanswered / current / flagged states
- long-passage viewer
- image/diagram/graph asset rendering
- submission review sheet
- per-subject answer summary
- Review Unanswered
- Review Flagged
- final irreversible submit
- automatic time-expiry submission

### Autosave + local retry queue

Every answer/flag action updates the UI immediately and enters a per-attempt local pending queue.

The queue:

1. sends changes to the server automatically;
2. removes an item only when that exact state is acknowledged;
3. preserves newer rapid changes made while an older request is in-flight;
4. stores unsynced state in localStorage;
5. restores and retries it after refresh/reconnect.

The exam header communicates:

- Saving…
- Syncing…
- ✓ Saved
- Saved on device
- Online / Offline

This is stronger than the M3 practice fallback, but it is still not the final service-worker/IndexedDB offline examination architecture.

### Resume

Resume is surfaced in two places:

- `/mock`
- student Home

The active-attempt card shows answered count, flagged count and remaining time.

### Submission

Before final submission the student sees:

- answered
- unanswered
- flagged
- subject-by-subject progress
- Review Unanswered
- Review Flagged

A manual submission is blocked while unsynced local changes remain. Expiry submission cannot wait indefinitely and is server-authoritative.

After submission M4 shows a locked submission receipt only. Correct answers, scoring interpretation, subject/topic analytics and mistake review are intentionally left for M5.

## API routes

- `POST /api/exam/attempts`
- `PUT /api/exam/attempts/[attemptId]/response`
- `POST /api/exam/attempts/[attemptId]/submit`

## Migration

Apply after M3:

`supabase/migrations/202609060006_m4_mock_exam_engine.sql`

## Local content note

The optional internal seed contains only a handful of original demo questions. Therefore a full mock will correctly return an inventory shortage while `QUESTION_PROVIDER=internal` unless the internal bank is populated.

That is expected. M4 is the exam engine; connecting a sufficiently large licensed/API-backed inventory is a separate content-provider task.

## Security decisions

Assessment-sensitive attempt tables have RLS enabled and direct `anon`/`authenticated` access revoked.

All question/answer state is served through authenticated Next.js routes and the server-only service-role boundary.

Correct option keys and explanations are never serialized into the active CBT payload.

## Deferred to M5+

- scaled/result scoring UI
- subject result pages
- topic performance
- answer review with explanations
- automatic mistake-bank writes
- mastery/readiness analytics
- durable IndexedDB + service-worker offline exam protocol
- external ALOC/SDash provider adapter
- admin attempt monitoring/content management
