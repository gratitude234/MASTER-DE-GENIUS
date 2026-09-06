# M3 implementation notes — Persisted Practice Engine

M3 turns the M2 provider boundary into a real student practice workflow.

## What is implemented

### Persisted practice sessions

New tables:

- `practice_sessions`
- `practice_session_questions`
- `practice_answers`

A practice session freezes its question set at creation time. Refreshing or resuming the session does not ask the provider for a new random batch.

Each frozen item stores:

- provider/source reference
- optional internal question ID
- **answer-free student snapshot**
- server-only correct option key
- server-only explanation
- fixed position in the session

This supports the internal PostgreSQL provider today and external ALOC/SDash-style adapters later without changing the practice engine.

### Atomic database functions

M3 adds service-role-only PostgreSQL functions:

- `create_practice_session(...)`
- `save_practice_answer(...)`
- `complete_practice_session(...)`

Session creation and question freezing happen inside one database transaction.

Answer saving evaluates the selected option on the server and updates session counters atomically.

Practice mode locks the first submitted answer because correctness is revealed immediately. Timed mode allows changing an answer until the session is completed or time expires.

### Answer-key security

The browser never receives the raw frozen question row.

`student_snapshot` is created from `StudentQuestion`, which already removes:

- `correctOptionKey`
- `explanation`

The correct key and explanation live in separate server-only columns. The M3 tables have RLS enabled and no browser-facing policies/grants. All access goes through authenticated Next.js endpoints plus the service-role server boundary.

In **Practice mode**, the answer endpoint returns correctness + explanation only after that question has been saved.

In **Timed mode**, the answer endpoint intentionally withholds correctness and explanations until the session is completed.

### Practice setup -> real session

`/practice` now creates a persisted session through:

`POST /api/practice/sessions`

The server validates:

- authenticated/onboarded user
- subject belongs to the student's current exam preference
- topic belongs to the selected subject
- count
- mode
- difficulty
- year

The configured question provider then generates the question set.

If the provider returns fewer questions than requested, the session uses the available set and records both `requested_count` and actual `question_count`.

If it returns none, the UI receives a clean inventory error instead of creating an empty session.

### Real practice runner

New route:

`/practice/session/[sessionId]`

The mobile-first runner includes:

- frozen/resumable question set
- progress indicator
- previous/next navigation
- large touch-friendly answer targets
- long-passage rendering
- image/diagram asset rendering
- Practice vs Timed mode label
- save-state UI
- immediate feedback in Practice mode
- restrained correct/incorrect styling
- explanation/topic/difficulty feedback
- session completion summary

### Autosave + local resilience

Selecting an option:

1. updates local UI immediately;
2. writes the selection to a per-session browser backup;
3. saves to the server automatically;
4. changes `Saving` -> `Saved` on success.

If the request fails, the UI shows `Saved on device` and keeps the selection locally. Pending answers retry when the browser reports that it is online again.

This is intentionally a lightweight M3 resilience layer. The full PWA/IndexedDB queue, durable offline exam engine and conflict-reconciliation strategy remain for the dedicated offline milestone.

### Timed practice

Timed practice currently assigns **60 seconds per delivered question**.

The authoritative expiry timestamp is created by PostgreSQL. The browser only renders the countdown from that server-generated timestamp.

When time reaches zero, the client completes the session. The answer-saving function also rejects late answers server-side, so changing the browser clock does not extend the session.

### Resume

`/practice` checks for the most recently updated in-progress session and displays a **Resume session** card with:

- subject
- mode
- answered count
- total question count

## API routes

- `POST /api/practice/sessions`
- `PUT /api/practice/sessions/[sessionId]/answers`
- `POST /api/practice/sessions/[sessionId]/complete`

## Migration

Apply:

`supabase/migrations/202609060005_m3_practice_engine.sql`

After the previous M1/M2 migrations.

## Local content note

The optional `supabase/seed.sql` still contains only a very small original demonstration inventory. With `QUESTION_PROVIDER=internal`, requesting 20 questions may therefore produce a smaller session locally. That is intentional; M3 handles insufficient inventory without duplicating questions.

Real provider integration or a larger licensed/internal content bank comes next.

## Deferred

M3 does **not** yet implement:

- real ALOC/SDash adapter
- full IndexedDB/service-worker offline architecture
- bookmarks/mistake-bank writes from practice
- topic mastery analytics
- full mock-exam engine
- exam result model
- admin content UI

Those build on the persisted session history introduced here.
