# MASTER@DE'GENIUS Architecture Audit

**Date:** 2026-09-07
**Branch:** `main` @ `210a4b1`
**Scope:** question pipeline, ALOC integration, CBT session engine, database, security, performance, reliability
**Method:** full-repository trace. Every claim below is anchored to a file and line that was read. `npm test` (221 pass / 0 fail), `npm run typecheck` and `npm run lint` were executed and all pass. No code, migration, credential or production data was modified.

---

## 1. Executive Summary

### Score: **7 / 10**

This is a considerably better codebase than the brief anticipated. The two failure modes the audit was commissioned to find — **an ALOC token reaching the browser**, and **one ALOC request per question navigation** — do **not** exist. Both were engineered against deliberately, and there is documentation and test coverage proving it.

What is genuinely missing is the *economic* layer around the provider: there is no cache, no usage ledger, no rate limit, and no internal question bank. Every practice session and every mock exam spends fresh ALOC quota, forever, for content the platform has already paid to fetch — sometimes minutes earlier, for the same subject, for a different student.

#### Biggest strengths

1. **ALOC is already server-only and abstracted.** `features/questions/providers/aloc/*` are `import "server-only"` modules behind a `QuestionProvider` interface. A grep of the compiled client bundle (`.next/static`) for `aloc` / `AccessToken` returns nothing. The target architecture's sections **A**, **B** and **C** are already built.
2. **Batching is already correct.** `ALOC_BATCH_LIMIT = 40` (`features/questions/providers/aloc/index.ts:17`). A 60-question English paper is assembled in 2–3 calls, not 60. Navigation makes zero provider calls.
3. **The exam session is a frozen, database-resident snapshot.** `exam_attempt_questions.student_snapshot` holds an answer-free copy of every question at attempt creation. Refresh cannot regenerate a paper; ordering cannot drift.
4. **Scoring is server-authoritative and the client is never trusted.** Correctness is computed inside `save_exam_response` / `save_practice_answer` (PL/pgSQL, `security definer`) and re-derived from scratch at submission.
5. **The offline/autosave engine is production-grade.** Durable IndexedDB queue, per-answer optimistic concurrency (`expectedRevision`), idempotency receipts keyed by `mutation_id`, a monotonic clock resistant to device clock tampering, and a Web Locks single-editor guard.
6. **Assessment tables have no browser-facing grants at all.** `revoke all ... from anon, authenticated` plus RLS on every session table. There is no path from a student's Supabase session to an answer key.

#### Biggest risks

| # | Risk | Severity |
|---|---|---|
| 1 | `POST /api/practice/sessions` has **no rate limit and no session cap**. One authenticated account can burn the entire ALOC quota in minutes and deny question delivery to every student. | **CRITICAL** |
| 2 | **No provider cache of any kind.** Identical requests re-spend quota indefinitely. Quota consumption scales with sessions started, not with unique content needed. | **HIGH** |
| 3 | **No usage tracking.** "How many ALOC requests did we make today?" and "Which feature spent them?" cannot be answered from anything but unstructured `console.info` lines. | **HIGH** |
| 4 | A mock exam that fails on its 4th subject has already **spent quota on the other three** and discards it. | **HIGH** |
| 5 | `PracticeSessionView.correctCount` is serialized to the browser **during an in-progress timed session**, where feedback is deliberately withheld — a reload-per-question answer oracle. | **HIGH** |
| 6 | `loadHistory()` loads and re-grades **every completed attempt** on `/home`, `/practice` and `/progress`. Unbounded N+1. | **HIGH** |
| 7 | ALOC's terms of use are **not recorded anywhere in the repository**. Any caching or ingestion work needs a business/legal decision first. | **BLOCKER (non-technical)** |

#### Why 7 and not 9

The architecture is right. The operations around it are absent. A platform serving many concurrent Nigerian students on a metered third-party question API needs to know what it is spending and be able to stop spending it — and right now it can do neither. Deduct further for one live answer-key leak (#5) and one page-load cost curve (#6) that will fail at scale.

---

## 2. Current Architecture

```
                         +--------------------------------------+
  BROWSER                |  ExamAttemptRunner / PracticeRunner  |
  (never sees ALOC,      |  useOfflineSession -> DurableQueue   |
   never sees a key)     |  IndexedDB "mdg-offline-v1"          |
                         |  Web Locks . SessionClock            |
                         +----------------+---------------------+
                                          | fetch()  .  4 endpoints only
                                          |  POST /api/exam/attempts
                                          |  POST /api/practice/sessions
                                          |  PUT  /api/{exam,practice}/../response
                                          |  POST /api/../{submit,complete}
  -------------------------------------------------------------------------
                                          v
  NEXT.JS SERVER          +----------------------------------+
  (Node runtime)          |  Route handlers                  |
                          |  requireApiUser() -> Supabase SSR|
                          +--------------+-------------------+
                                         v
                          +----------------------------------+
                          |  features/exams/service.ts       |
                          |  features/practice/service.ts    |
                          |  features/results/service.ts     |
                          +--------+---------------+---------+
                                   |               |
                    +--------------v--+        +---v------------------+
                    | questions/      |        | lib/supabase/admin   |
                    |   service.ts    |        | (SERVICE ROLE key)   |
                    |  . validate     |        +---+------------------+
                    |  . capability   |            |
                    |    gate         |            | rpc() only
                    +--------+--------+            |
                             v                     v
              +----------------------+   +-------------------------------+
              | providers/index.ts   |   |  SUPABASE / POSTGRES          |
              | QUESTION_PROVIDER    |   |  create_exam_attempt()        |
              +---+--------------+---+   |  create_practice_session()    |
                  |              |       |  save_response_v2()           |
       +----------v---+   +------v-----+ |  submit_exam_attempt()        |
       | Internal     |   | ALOC       | |  complete_practice_session()  |
       | Provider     |   | Provider   | |                               |
       | (Postgres)   |   | batch <=40 | |  exam_attempt_questions       |
       +------+-------+   | <=8 req/sub| |    .student_snapshot  (jsonb) |
              |           +------+-----+ |    .correct_option_key  <-- never
              |                  |       |       leaves the server        |
              +------------------+------>+-------------------------------+
                                 |
                                 v  * ONLY at session creation. Never on
                    +------------------------+   Next / Previous / Submit.
                    |  transport.ts          |  * NO CACHE between these
                    |  header AccessToken    |    two boxes.
                    |  10s timeout . 3 tries |  * NO usage ledger.
                    +------------+-----------+  * NO rate limit upstream.
                                 v
                    ==========================
                    ||  questions.aloc.com.ng ||
                    ||  /api/v2/q  .  /q/{n}  ||
                    ==========================
```

**The critical structural fact:** the arrow into ALOC fires **once per session creation**, and the arrow into `student_snapshot` is what every subsequent page load, refresh, resume and navigation reads from. That is the correct shape. What is missing is anything *between* the Question Service and ALOC.

---

## 3. Current Exam Flow

Traced end to end for a JAMB full mock.

| # | Step | What actually happens | ALOC calls |
|---|---|---|---|
| 1 | Student opens `/mock` | `app/(student)/mock/page.tsx:9` → `loadMockExamSetupForUser()`. Reads preference, blueprint (`full_mock`, 7200s, 4 subjects, 40 default / 60 English override), the 4 chosen subjects, then `isSubjectAvailable()` per subject — a pure in-memory mapping lookup. | **0** |
| 2 | Student ticks consent, presses **Begin Full Mock** | `components/exam/mock-exam-setup.tsx:59` → `POST /api/exam/attempts`. Button is disabled while `starting`, when a subject is unavailable, and when an active attempt exists. | 0 |
| 3 | Server builds the paper | `createMockExamAttemptForUser()` (`features/exams/service.ts:179`). Re-runs setup; **if an active attempt exists it returns that id early — no fetch** (`:181`). Otherwise `Promise.all` over 4 subjects → `fetchCanonicalQuestions()` each. | **≈5–6** (English 60 → 2–3 calls; other three 40 → 1 each) |
| 4 | Shortage check | Per subject, `questions.length !== subject.questionCount` throws `MOCK_INVENTORY_SHORTAGE|…` (`:194`). **This runs after all four subjects have already been fetched.** | — |
| 5 | Paper frozen | `rpc("create_exam_attempt", …)` — one transaction inserting `exam_attempts` (status `in_progress`, `started_at = now()`, `expires_at = now() + 7200s`), 4 `exam_attempt_subjects`, 180 `exam_attempt_questions` each carrying `student_snapshot` (answer-free), `correct_option_key` and `explanation`. | 0 |
| 6 | Redirect to `/exam/{id}` | `app/exam/[attemptId]/page.tsx` (`force-dynamic`) → `loadExamAttemptForUser()` reads the frozen rows, ordered by `overall_position`. Auto-submits first if `expires_at` has passed (`features/exams/service.ts:251`). | **0** |
| 7 | Runner mounts | `useOfflineSession("exam", attempt)` acquires a Web Lock, claims device ownership, reads/creates the IndexedDB record, migrates legacy `localStorage` answers, starts a 10s checkpoint heartbeat, posts asset URLs to the service worker. | 0 |
| 8 | **Question appears** | Rendered from `initialAttempt.subjects[i].questions[j].question` — already in memory. | **0** |
| 9 | **Student clicks Next / Previous** | `goNext()` / `goPrevious()` → `jumpTo()` → `sync.setCursor()`. Writes the cursor to IndexedDB. **No network request at all**, let alone an ALOC one. | **0** |
| 10 | Student selects an option | `DurableQueue.select()`: durable IndexedDB write **first**, then `PUT …/response` with `expectedRevision` + `mutationId`. Server evaluates correctness and updates three counter tiers. | **0** |
| 11 | Student refreshes mid-exam | RSC re-reads the same frozen rows. IndexedDB record is reconciled against server truth, pending changes preserved. Timer continues from `expires_at`. **Same paper, same order.** | **0** |
| 12 | Student submits | `finish()` drains the queue → `POST …/submit`. `submit_exam_attempt()` locks the row `FOR UPDATE`, recomputes every counter from `exam_attempt_answers`, forces `reason = time_expired` if `now() >= expires_at`. Idempotent. | **0** |
| 13 | Timer expires | Client `finish(true)` with 10s retry; **and** the server independently auto-submits on the next load. `checkAutomaticExpiry()` refuses a client-claimed expiry the server disagrees with (`CLOCK_RESYNC`). | 0 |
| 14 | Student restarts / starts another mock | `exam_attempts_one_active_per_exam_idx` (partial unique index) blocks a second live attempt; the service resumes instead. **A restart costs nothing.** After submission, a new mock is a full ~6-call fetch again. | 0 or ≈6 |
| 15 | Revision session from the mistake bank | `startRevision()` (`features/results/service.ts:91`) reuses **already-frozen snapshots** with `p_provider: "revision"`. | **0** — excellent |

**Practice flow** is the same shape: `POST /api/practice/sessions` → one `fetchCanonicalQuestions` (count 1–40 → normally **1** ALOC call) → `create_practice_session` freezes the set → runner reads from memory. Practice mode reveals feedback per answer; timed mode withholds it until completion (`features/practice/service.ts:196`).

### Direct answer to the brief's core question

> *"I specifically want to know whether clicking through questions causes additional external API requests."*

**No.** Next, Previous, jump-to-question, flag, answer, refresh, resume, submit and restart trigger **zero** ALOC requests. The only two code paths that can reach ALOC are `createMockExamAttemptForUser` and `createPracticeSessionForUser`, both at session creation. Verified by reading every call site of `fetchCanonicalQuestions` (2 total) and every client-side `fetch()` (4 total).

---

## 4. ALOC Usage Audit

### Every ALOC-related file in the repository

| File | Purpose | Endpoint | Side | When it fires | Questions per call | Duplicate-request risk |
|---|---|---|---|---|---|---|
| `features/questions/providers/aloc/transport.ts` | HTTP layer: auth header, 10s `AbortController` timeout, 3 bounded attempts, `Retry-After`, exponential backoff + jitter, status classification, log line | builds `{BASE}/q` and `{BASE}/q/{n}` | **Server** (`import "server-only"`, line 1) | Only when `AlocQuestionProvider.request()` calls it | n/a (transport) | Retries are bounded at `MAX_ATTEMPTS = 3`; auth errors are never retried (`:149`) |
| `features/questions/providers/aloc/index.ts` | `AlocQuestionProvider`: batching loop, dedupe, capability guards, barren-round cutoff | `/q/{n}` when n>1, `/q` when n=1 (`:146`) | **Server** | `fetchCanonicalQuestions()` only | `min(remaining, 40)` | Bounded by `MAX_UPSTREAM_REQUESTS = 8` and `MAX_BARREN_ROUNDS = 2` |
| `features/questions/providers/aloc/normalize.ts` | Raw ALOC record → `CanonicalQuestion`; HTML strip, entity decode, option-key normalisation, answer-key resolution, passage rules | — | Pure (no `server-only` marker, but holds no secrets) | Per record | — | None |
| `features/questions/providers/aloc/mapping.ts` | Internal slug → ALOC subject; exam-body mapping; `QUARANTINED` table | — | Pure (no `server-only` marker, no secrets) | Per request | — | None; unmapped subjects **never reach the network** (asserted by test) |
| `features/questions/providers/index.ts` | Provider registry; reads `QUESTION_PROVIDER` | — | **Server** (`import "server-only"`) | Module load + per resolve | — | Providers are singletons instantiated at import |
| `features/questions/service.ts` | Validation, capability gate, `toStudentQuestions` boundary | — | **Server** | Every session creation | count 1–100 | Single entry point — good |
| `features/exams/service.ts:186-212` | Mock: `Promise.all` over 4 subjects | via service | **Server** | `POST /api/exam/attempts` | 40 / 40 / 40 / 60 | **Yes** — see HIGH-2 below |
| `features/practice/service.ts:115-125` | Practice: one query | via service | **Server** | `POST /api/practice/sessions` | 1–40 | **Yes** — see CRITICAL-1 below |
| `scripts/aloc-smoke.mjs` | Manual live diagnostics; `--verify-subjects` probes all 14 mappings + quarantine candidates | `/q`, `/q/{n}` | **Server, manual only** | `npm run aloc:smoke` | 1 per subject | Developer-invoked; not in any build |
| `scripts/alias-hook.mjs` | Node loader so scripts/tests can import the app's TS | — | Tooling | — | — | — |
| `tests/aloc-transport.test.mjs` | 15 timeout / retry / secret-leak tests | stubbed `fetch` | Test | `npm test` | — | Never hits the network |
| `tests/aloc-provider.test.mjs` | 12 batching / dedupe / registry tests | stubbed `fetch` | Test | `npm test` | — | Never hits the network |
| `tests/aloc-normalize.test.mjs` | 20 normalisation and security tests | — | Test | `npm test` | — | — |
| `tests/aloc-subject-availability.test.mjs` | 9 quarantine regression tests | stubbed | Test | `npm test` | — | — |
| `.env.example`, `.env.local` | `ALOC_ACCESS_TOKEN`, `ALOC_BASE_URL`, `QUESTION_PROVIDER` (names only — values not reproduced here) | — | Server env | — | — | `.env.local` is git-ignored and **not tracked** (`git ls-files` confirms) |

### Token handling

- Read **once**, in `requireAlocConfig()` (`transport.ts:29`), from `process.env.ALOC_ACCESS_TOKEN`.
- Sent as the `AccessToken` request header (`transport.ts:127`). Never in a query string, so it cannot land in an access log or a `Referer`.
- **Never logged.** `logCall()` (`transport.ts:88`) receives path, subject, exam type, attempt, status, duration and outcome — no token, no URL, no query string. A test asserts this.
- Upstream response bodies are never echoed to the student; error text is deliberately suppressed because ALOC returns raw Laravel stack traces containing server paths (documented in `M7_IMPLEMENTATION_NOTES.md` Finding 1).
- **Verified absent from the client bundle**: `grep -rl "aloc\|AccessToken" .next/static` returns nothing.
- No `NEXT_PUBLIC_` variable holds any secret. The only `NEXT_PUBLIC_` values are the Supabase URL, the publishable (anon) key and the app URL — all correct to expose.

### Multiple / dead ALOC implementations

**There is exactly one implementation.** No abandoned adapter, no duplicated fetch logic, no legacy client-side ALOC call. `SDASH_API_KEY` is a documented, deliberately unimplemented placeholder — `getQuestionProvider("sdash")` throws by design and a test asserts it. The mapping module's `QUARANTINED` table is a live safety mechanism, not dead code.

---

## 5. ALOC Quota Risk

### What one "ALOC request" means to this application

One HTTP GET to `{ALOC_BASE_URL}/q/{n}` (or `/q` when n is 1), carrying `subject`, `type` and optionally `year`. `n` is capped at **40** (`ALOC_BATCH_LIMIT`). One response yields up to `n` questions.

Retries **do** consume additional upstream requests — up to 3 attempts per logical call — but only on 429/5xx/timeout, never on auth or client errors.

### Requests per user action (measured against the code, corroborated by the live runs recorded in `M7_IMPLEMENTATION_NOTES.md`)

| Action | Requests |
|---|---|
| Practice, 10–40 questions | **1** (occasionally 2–3 if upstream returns duplicates) |
| Practice, 1 question | 1 (via `/q`) |
| Full JAMB mock (40/40/40/60) | **≈5–6** |
| Revision from mistakes | **0** |
| Any navigation, answer, flag, refresh, resume, submit | **0** |
| Resuming an active mock | **0** |

**Verdict on the brief's HIGH-PRIORITY question:** the application is **not** consuming one external request per question. It is already batching efficiently — `min(remaining, 40)` per call, with duplicate collapsing across rounds and an early stop when the pool is exhausted. This is the correct design and should not be changed.

### Where quota is nonetheless being wasted

#### CRITICAL — Unbounded, unauthenticated-by-quota session creation

`POST /api/practice/sessions` (`app/api/practice/sessions/route.ts`) checks authentication and validates input, then goes straight to the provider. There is **no rate limit, no per-user session cap, no concurrency guard, and no limit on abandoned in-progress sessions**. Unlike mock exams — which are protected by `exam_attempts_one_active_per_exam_idx` — `practice_sessions` has no such constraint.

A single logged-in student (or a stolen/shared account, or a script) can issue `POST /api/practice/sessions {count: 40}` in a loop and spend one ALOC request per iteration. At a modest 10 req/s that is 36,000 requests an hour. When the quota is exhausted, `QuestionProviderRateLimitError` surfaces to *every* student as "Questions are busy right now" — a full denial of the platform's core function.

Double-clicking **Start** is a milder version of the same gap: the client `starting` flag is the only guard, so a slow network plus an impatient tap creates two sessions and spends two requests.

**Fix direction:** per-user token bucket on both creation endpoints; a cap on concurrent `in_progress` practice sessions (mirroring the mock's partial unique index); a global daily provider budget with a circuit breaker.

#### HIGH — No cache, so identical content is re-purchased forever

`fetchCanonicalQuestions` → provider → HTTP, with nothing in between. Two students starting Physics practice one minute apart cost two requests. The same student practising Physics five times costs five. ALOC returns *randomly selected* questions, so across a cohort the same question rows are re-fetched, re-normalised and re-frozen into `student_snapshot` hundreds of times.

Quota consumption today scales with **sessions started**. It should scale with **unique content needed**, which is a far smaller and slower-growing number.

#### HIGH — Mock shortage discards work already paid for

`features/exams/service.ts:186-212`: all four subjects are fetched concurrently, *then* each is checked for shortfall (`:194`). If Chemistry can only supply 37 of 40, the whole attempt throws `MOCK_INVENTORY_SHORTAGE` and the ~5 requests already spent on English, Mathematics and Physics are discarded. The student retries; the platform pays again. With no cache this is a repeatable drain — and per-subject inventory beyond English is explicitly documented as unmeasured.

#### HIGH — No usage ledger

Observability is `console.info` in `transport.ts:89` and `index.ts:127`. There is no `external_api_usage` table, no counters, no per-feature attribution, no daily/monthly totals, no failure rate, and no alerting. None of the seven questions in the brief's section K can be answered today. This also means quota exhaustion will be discovered by students, not by the team.

#### MEDIUM — Per-session ceilings are generous and uncoordinated

`MAX_UPSTREAM_REQUESTS = 8` is **per subject**. A single mock creation can therefore issue up to 32 upstream requests in its worst case, and nothing coordinates budgets across concurrent users. There is no global ceiling.

#### MEDIUM — Barren rounds spend requests to gain nothing

`MAX_BARREN_ROUNDS = 2` (`index.ts:27`) permits two consecutive requests that add zero new questions before stopping. Correct as a safety valve, but with no cache and no inventory knowledge it fires often on thin subjects, and its cost compounds under retry.

#### MEDIUM — `excludeSourceIds` is available but never used

`QuestionQuery.excludeSourceIds` is implemented in both providers, but neither `createPracticeSessionForUser` nor `createMockExamAttemptForUser` populates it. Students are therefore re-served questions they have already seen — worse learning outcomes *and* wasted requests, since duplicates get discarded and trigger top-up rounds.

#### LOW — `/q` vs `/q/{n}` for n = 1

Cosmetic; both are one request.

#### LOW — `QUESTION_PROVIDER` is read without `.trim()`

`providers/index.ts:15` reads `process.env.QUESTION_PROVIDER ?? "internal"`, while `features/exams/service.ts:158` and `features/practice/service.ts:113` both use `?.trim() || "internal"`. A trailing space in the deployed env var would make the registry throw "not implemented in this build" while the exam service still believed the provider was live. Harmless today, confusing when it happens.

### Licensing — flagged as a business decision, not a technical one

**Nothing in this repository records ALOC's terms of use, retention rights, or redistribution permissions.** `M7_IMPLEMENTATION_NOTES.md` states "No database mirroring" as an implementation fact, not as a licence conclusion, and notes the legacy API is scheduled for shutdown roughly a year out.

The current behaviour is defensible: questions are frozen only into per-attempt session snapshots, which is ordinary operational record-keeping for an assessment product. **A shared, cross-user question cache is a materially different act** and may or may not be permitted.

**This must be resolved before Phase 4.** The technical recommendation below is deliberately built so that retention is a configurable policy (TTL, scope, purge) rather than an assumption baked into the schema.
---

## 6. Database Audit

### Current schema (23 tables across 7 migrations)

```
  IDENTITY / CATALOGUE  (M1)
  profiles ──1:1── auth.users
  exam_bodies ──< exam_subjects >── subjects
                                       |
  student_exam_preferences ──< student_subject_preferences
     (unique partial: one primary per user)

  QUESTION BANK  (M2)                        [essentially empty in production]
  subjects ──< topics
  exam_subjects ──< question_passages
  questions ──< question_options            (unique: question_id, option_key)
            ──< question_assets
            ──> topics        (composite FK: topic_id + subject_id)
            ──> question_passages (composite FK: passage_id + subject_id)
  question_provider_subject_mappings        [DEAD - never read by code]
  question_provider_topic_mappings          [DEAD - never read by code]

  PRACTICE ENGINE  (M3)
  practice_sessions ──< practice_session_questions ──< practice_answers
       |                    .student_snapshot  jsonb
       |                    .correct_option_key      <- server-only
       |                    .explanation             <- server-only
       +-- mode, difficulty, year_filter, status, expires_at

  MOCK EXAM ENGINE  (M4)
  exam_blueprints ──< exam_blueprint_subject_overrides
  exam_attempts ──< exam_attempt_subjects ──< exam_attempt_questions
       |                                          .student_snapshot  jsonb
       |                                          .correct_option_key
       +──< exam_attempt_answers
       (unique partial: one active attempt per user+exam_body)

  DURABILITY  (M6)
  response_revisions  PK(user_id, kind, session_id, question_id)
       .revision, .mutation_id, .receipt jsonb
```

### What is well designed

- **Composite foreign keys enforce real invariants.** `questions(topic_id, subject_id) → topics(id, subject_id)` makes it structurally impossible to attach a question to a topic from another subject. Same pattern for passages and for `(exam_body_id, subject_id) → exam_subjects`. This is unusually careful modelling.
- **Question immutability is enforced by triggers, not convention.** `guard_active_question_child_mutation()` and `validate_question_activation()` prevent editing an active question's options or answer key, and prevent activating a question that has fewer than two options or an answer key with no matching option.
- **Partial unique indexes carry business rules**: one primary exam preference per user; one active attempt per user per exam body.
- **Check constraints are genuinely load-bearing**: `answered_count <= total_questions`, `correct_count <= answered_count`, timed-mode implies `expires_at IS NOT NULL`, submitted implies `submitted_at IS NOT NULL`.
- **`source_provider` + `source_question_id` provenance exists on every question-bearing table**, with a partial unique index on `questions(source_provider, source_question_id)`.

### Weaknesses

#### Duplicated question content at scale — the main scaling concern

`student_snapshot jsonb` stores the **complete** question — prompt, all options, passage body, assets — once per question per attempt.

A 180-question JAMB mock at roughly 1.5 KB per snapshot is ~270 KB per attempt. 10,000 students taking two mocks each is ~5.4 GB of `exam_attempt_questions`, the overwhelming majority of it the *same* few thousand ALOC questions repeated. Passage bodies are the worst case: a comprehension passage is duplicated into every question that quotes it, in every attempt.

This is the right call *today* — it is what makes the paper immutable and offline-capable, and it must not be removed. But at scale the snapshot should become a **reference plus a small override** once a real question bank exists, with the full copy retained only while the attempt is live.

#### Redundant unique indexes (two tables)

```sql
-- practice_answers
unique (session_question_id)              -- sufficient
unique (session_id, session_question_id)  -- redundant superset
-- exam_attempt_answers
unique (attempt_question_id)              -- sufficient
unique (attempt_id, attempt_question_id)  -- redundant superset
```
Since `session_question_id` is already unique, the two-column constraint can never reject a row the single-column one accepts. Two extra B-trees maintained on the hottest write path in the product (every answer save).

#### Missing indexes

| Table | Missing | Why it matters |
|---|---|---|
| `practice_session_questions` | `internal_question_id` | FK with `ON DELETE SET NULL`; deleting a bank question triggers a sequential scan |
| `exam_attempt_questions` | `internal_question_id` | same |
| `questions` | `passage_id` | FK with `ON DELETE RESTRICT`; passage deletes scan |
| `exam_attempts` | `(user_id, status, id)` | `loadHistory` filters `user_id + status` and orders by `id`; the existing `(user_id, status, updated_at desc)` index cannot serve that ordering |
| `practice_sessions` | `(user_id, status, id)` | same |
| `question_assets` | — | fine (`question_id, display_order`) |

#### Dead schema

- `question_provider_subject_mappings` and `question_provider_topic_mappings` are fully specified, indexed, trigger-equipped — and **never read by any application code**. The provider mapping lives in `features/questions/providers/aloc/mapping.ts` instead. Two competing sources of truth for the same concept, one of them permanently empty.
- `question_catalog_counts(text)` RPC is defined, secured and typed in `types/database.ts:722` — **never called**.
- `exam_attempt_status = 'created'` is unreachable: `create_exam_attempt` inserts `'in_progress'` directly. The status value and the check-constraint branch guarding it are dead.
- `types/domain.ts` exports `Question`, `Subject`, `ExamAttempt` and `AttemptAnswer` — superseded by `CanonicalQuestion` / `ExamAttemptView` and imported by nothing.

#### Questionable JSON usage

- `source_metadata jsonb not null default '{}'` on `questions` and `question_passages` is always `{}` — the ALOC adapter discards provider metadata rather than persisting it. Target requirement **I** asks for `provider_metadata`; the column exists but is never populated.
- `response_revisions.receipt jsonb` stores the entire RPC return payload, which for practice **includes `correct_option_key` and `explanation`**. This is correct and safe (service-role only, and `savePracticeAnswerForUser` re-maps to a whitelist before responding), but it is worth knowing that answer keys live in that table.

#### Weak / partial constraints

- `practice_sessions` has **no** equivalent of the mock's one-active-attempt index. Unlimited concurrent in-progress practice sessions per user — the enabling condition for CRITICAL-1.
- `source_provider` is free-form `text` everywhere. Values `internal`, `aloc` and `revision` are all in use with no enum or check constraint. A typo silently creates a fourth provider.
- No `ON DELETE` policy review for `internal_question_id`: `SET NULL` silently severs provenance when a bank question is removed.

#### Normalisation

Broadly good. `exam_attempt_subjects.{answered,flagged,correct}_count` and `exam_attempts.{answered,flagged,correct}_count` are denormalised counters, but they are **recomputed from source** inside the RPCs under `FOR UPDATE`, never incremented, so they cannot drift. That is the correct trade.

---

## 7. Exam Session Audit

| Question from the brief | Answer | Evidence |
|---|---|---|
| Questions fetched before the test starts? | **Yes.** The entire paper is fetched and frozen before the attempt row exists. | `features/exams/service.ts:186-223` |
| Fetched progressively? | No — and correctly so. | — |
| Stored in memory? | Yes, as the RSC prop `initialAttempt`. | `app/exam/[attemptId]/page.tsx:15` |
| Stored in localStorage? | No. **IndexedDB** (`mdg-offline-v1`), with a `localStorage` migration path for legacy records that then deletes the old key. | `features/offline/storage.ts`, `use-session.ts:67-89` |
| Stored in the database? | **Yes** — the authoritative copy. | `exam_attempt_questions` |
| Does refresh destroy the session? | **No.** RSC re-reads the frozen rows. | `loadExamAttemptForUser` |
| Can a student resume? | **Yes**, on the same device (IndexedDB + server) or a different one (server only). Mock Setup surfaces a "Resume exam" card. | `mock-exam-setup.tsx:91-113` |
| Answers saved immediately? | **Yes** — durable local write first, then network. | `queue.ts:23-30` |
| Autosave implemented? | **Yes**, event-driven on selection, plus a 10s checkpoint heartbeat, plus flush on `online` and on `visibilitychange`. Not a polling loop. | `use-session.ts:104-124` |
| Timer durable? | **Yes.** `expires_at` is set server-side. The client clock is monotonic and resyncs from `/api/time` and from every save receipt. The server independently auto-submits and rejects a client-claimed expiry it disagrees with. | `clock.ts`, `offline/server.ts:17` |
| Can the same exam regenerate after refresh? | **No.** Two independent guards: the frozen rows, and `exam_attempts_one_active_per_exam_idx`. | M4 migration `:97` |
| Can ordering change during an attempt? | **No.** `unique (attempt_id, overall_position)` and `unique (attempt_subject_id, subject_position)`; reads are explicitly ordered. | M4 migration `:139-140` |

### Autosave debouncing — a nuance worth stating

The brief asks that autosave "not spam the database on every insignificant UI event". Current behaviour:

- **Answer/flag changes** send one request each, immediately. There is no debounce. A student rapidly toggling A→B→C→D issues four `PUT`s. This is *deliberate and correct* for a high-stakes exam — losing an answer is worse than an extra request — and `DurableQueue` serialises to one in-flight request per session, collapsing superseded mutations via `mutationId` comparison (`queue.ts:47-55`). So the burst is bounded, not amplified.
- **Cursor movement** (Next/Previous) writes only to IndexedDB, never to the network (`use-session.ts:143-147`). Correct.
- **The 10s heartbeat** writes to IndexedDB and only flushes when `pending` is non-empty. Correct.

No change needed here.

### The one latent fragility

`useOfflineSession`'s initialisation effect lists `view` in its dependency array (`use-session.ts:131`). `view` is an RSC-provided object, so a new identity would tear down and re-run initialisation — releasing and re-acquiring the Web Lock, re-reading IndexedDB, rebuilding the queue.

Today this cannot happen: nothing calls `router.refresh()` anywhere in the codebase (verified by grep), and the runners navigate with `router.push` only. **It would still not cause an ALOC request** — the RSC re-reads the frozen database rows. But it is a trap for the next person who adds a refresh, and deserves a comment or a stable-identity guard.

---

## 8. Security Audit

No secret values appear below — only variable names and file locations.

### Findings

#### HIGH — Answer oracle in timed practice via `correctCount`

`loadPracticeSessionForUser` returns `correctCount: typedSession.correct_count` **unconditionally** (`features/practice/service.ts:233`), even while a **timed** session is in progress — the exact mode where `revealFeedback` is false (`:196`) and feedback is deliberately withheld.

The value is not rendered by `PracticeSessionRunner`, but it is serialized into the RSC payload delivered to the browser, and `useOfflineSession` then writes the whole `view` into IndexedDB (`use-session.ts:63-65`). Both are trivially readable.

Exploit: answer Q1, reload, read `correctCount`. If it incremented, the answer was right. Repeat per question. That is a complete answer key for a graded, timed session, obtained without touching a single protected table.

Mock exams are **not** affected — `ExamAttemptView` carries no `correctCount`.

**Fix:** gate it exactly as `feedback` is gated — `correctCount: revealFeedback ? typedSession.correct_count : 0` (or omit the field entirely until completion).

#### MEDIUM — No rate limiting anywhere

No limiter on any route. Two categories of exposure:

- **Quota**: `POST /api/practice/sessions` and `POST /api/exam/attempts` spend money per call (CRITICAL-1 above).
- **Compute**: `POST /api/progress/practice` calls `startRevision` → `loadHistory`, which loads and re-grades a user's entire history. For a heavy user that is hundreds of queries per request, repeatable at will.

#### MEDIUM — Service role used for reads that the user's own RLS context could serve

Every service module uses `createAdminClient()` (service role, RLS bypassed) and enforces ownership manually via `.eq("user_id", userId)`. It is applied consistently and correctly everywhere I traced — `loadExamAttemptForUser`, `loadPracticeSessionForUser`, `loadResult`, `getRevisions`, `checkAutomaticExpiry` all filter by user. But the safety property is "every author remembered the filter", not "the database enforces it".

The one place that already does it properly is `features/questions/catalog.ts`, which uses the **user-scoped** client. That is the pattern to extend.

Note this is a deliberate, documented architecture choice — the M3/M4 migrations `revoke all ... from anon, authenticated` precisely so assessment data can only be reached through server code. It is defensible; it just concentrates all authorization into application code.

#### LOW — `normalize.ts` and `mapping.ts` lack the `server-only` marker

Every other module in the question pipeline carries `import "server-only"`. These two do not. They contain no secrets and importing them client-side would leak nothing today, but the marker is what prevents a future edit from accidentally pulling the transport in behind them.

#### LOW — `/offline` is excluded from middleware

`middleware.ts:10` excludes `offline` from the matcher, so `/offline` renders unauthenticated. `OfflineLauncher` gates on the IndexedDB `owner` record rather than a session. This is intentional (offline resume must work without a network round trip) and the page itself warns that anyone using the browser can reach saved sessions. Acceptable — worth a conscious sign-off.

### Where the code is already correct

| Concern from the brief | Status |
|---|---|
| ALOC token exposed client-side | **Clean.** Server-only modules; absent from `.next/static`; never logged; sent as a header, not a query param |
| Secrets committed to git | **Clean.** `git ls-files` shows only `.env.example` (placeholders); `.env.local` is git-ignored |
| `NEXT_PUBLIC_` containing secrets | **Clean.** Only Supabase URL, publishable key, app URL |
| Direct provider requests from the browser | **Clean.** Four client `fetch()` calls exist, all to same-origin `/api/*` |
| Insecure Supabase queries | **Clean** in the paths traced; ownership filtered everywhere |
| RLS problems | **Clean.** RLS enabled on all 23 tables; assessment tables additionally `revoke all` from `anon`/`authenticated`; the only authenticated read policy is `topics_read_active` |
| Service role exposure | **Clean.** `lib/supabase/admin.ts` is `import "server-only"` and reads `SUPABASE_SECRET_KEY` (never `NEXT_PUBLIC_`) |
| API routes without authorization | **Clean.** All 8 mutating routes call `requireApiUser`/`requireExamApiUser` first. `/api/time` is unauthenticated and returns only `Date.now()` |
| Students manipulating scores | **Clean.** The client sends only `{questionId, selectedOptionKey, isFlagged, expectedRevision, mutationId}`. Correctness is computed in PL/pgSQL against `correct_option_key`; submission recomputes every counter from source rows |
| Answers exposed before submission | **Clean for mocks** (`toStudentQuestion` strips `correctOptionKey` and `explanation` at the server boundary, and `create_exam_attempt` stores them in separate columns). **One leak for timed practice** — see HIGH above |
| Results trusted from the browser | **Clean.** `submit_exam_attempt` ignores every client-supplied count. `checkAutomaticExpiry` refuses a client-claimed expiry the server disagrees with |
| Idempotency / replay | **Clean.** `save_response_v2` returns the stored receipt for a repeated `mutation_id` without re-evaluating or re-writing |

---

## 9. Performance Audit

#### HIGH — `loadHistory()` is an unbounded N+1 on three hot pages

`features/results/service.ts:62`. For every completed exam attempt and practice session a user has ever finished, it calls `loadResult()`, which issues **4 queries** (session row, exam body, questions, answers), loads every `student_snapshot`, and **re-grades the entire result from scratch** in JavaScript.

Concurrency is bounded to 4, but total work is not bounded at all. A student with 200 completed sessions triggers ~800 queries and re-grades ~8,000 questions **on every render** of `/home`, `/practice` (practice tab) and `/progress`. `/progress/mistakes` does the same and then replays the whole history through `mistakeBank()`.

There is no caching, no pagination for the aggregate views, and no materialisation. `/home` is the app's landing page after login.

**Fix direction:** persist per-attempt aggregates (score, per-subject and per-topic breakdowns) at submission time, and have the dashboards read those rows. `loadResult()` stays as-is for the single-result review page, where loading everything is exactly right.

#### MEDIUM — `InternalQuestionProvider` randomisation is biased and gets worse as the bank grows

`features/questions/providers/internal.ts:79-99`:

```ts
const candidateLimit = Math.min(Math.max(query.count * 5, query.count), 250);
let questionQuery = supabase.from("questions").select("*") /* … */ .limit(candidateLimit);
// …then shuffled(eligibleRows).slice(0, query.count)
```

There is **no `ORDER BY`**. Postgres returns whatever the plan produces, which for a stable table is effectively the same rows every time. The shuffle then randomises *within a fixed window of at most 250 rows*. Once the bank exceeds 250 questions for a subject, the remainder becomes unreachable — students would see the same pool forever, and `excludeSourceIds` could not rescue them.

Also `select("*")` pulls `explanation`, `review_notes` and `source_metadata` for up to 250 candidate rows when only ~40 are used.

**Fix direction:** randomise in the database (`ORDER BY random()` with an index-friendly variant, or `TABLESAMPLE`, or a stored `random_key` column with a cursor), and select only the columns needed for candidacy.

#### MEDIUM — Mock creation issues ~28 database round trips before it starts

`InternalQuestionProvider.fetchQuestions` performs up to 7 round trips per call (exam body, subject, topic, questions, then a `Promise.all` of options/assets/topics, then passages). Multiplied by 4 subjects that is ~28 for a mock, on top of the setup queries. The exam-body and subject lookups are identical across all four subjects and are re-resolved each time.

#### MEDIUM — Large client payloads on the exam route

A 180-question mock ships every `student_snapshot` in the RSC payload — roughly 250–350 KB before compression, all of it rendered into a single client component tree. On the 3G/4G connections much of the target audience uses, that is a slow first paint on the most time-sensitive screen in the product. No virtualisation; all 180 navigator buttons render at once.

#### MEDIUM — Duplicated grading work

`recommendPractice`, `latestMockSummary`, `mistakeBank` and `summarise` each traverse the *same* fully-graded history array. `app/(student)/home/page.tsx` calls three of them per render. Cheap individually, but they sit on top of the N+1 above, so the cost multiplies.

#### LOW — `subjectStats` recomputes on every answer

`exam-attempt-runner.tsx` memoises `subjectStats` on `[initialAttempt.subjects, responses]`, so every keystroke-equivalent answer change re-walks all 180 questions. Trivial at this size; worth knowing if question counts grow.

#### LOW — No caching directives on RSC data reads

`/mock` and `/exam/[attemptId]` are `force-dynamic` (correct). `/home`, `/practice` and `/progress` are dynamic by consequence of `cookies()`, with no `unstable_cache` or tag-based revalidation on the expensive aggregate reads.

#### Bundle

No CBT-specific bundle problem. Dependencies are lean (`clsx`, `tailwind-merge`, `lucide-react`, Supabase). No charting library, no date library, no state manager. `lucide-react` icons are imported individually. Nothing to fix.

---

## 10. Reliability Audit

| Failure scenario | Current handling | Gap |
|---|---|---|
| ALOC times out | 10s `AbortController`, up to 3 attempts, exponential backoff + jitter | None |
| ALOC 429 | `Retry-After` honoured (capped 60s), else backoff; typed `QuestionProviderRateLimitError` → HTTP 503 with a student-safe message | **No circuit breaker.** Every subsequent student keeps retrying into an exhausted quota |
| ALOC 5xx | Retried within the 3-attempt budget, then `QuestionProviderUnavailableError` | None |
| ALOC token rejected | Never retried; explicit `QuestionProviderAuthError`; classification reads both HTTP status and body code because the legacy API is inconsistent | **No alerting.** A revoked token surfaces as a generic student-facing error |
| ALOC returns HTML/Laravel stack trace with HTTP 200 | Treated as failure (`transport.ts:143` requires `body.data !== undefined`); body never echoed because it leaks server paths | None — genuinely well handled |
| Malformed question record | Discarded with a typed reason; **never crashes the batch**; discard counts logged | None |
| Question with no resolvable answer | Discarded rather than guessed — "no question is ever graded on a guessed key" | None |
| Incomplete option set (<2) | Discarded by `normalizeOptions`; internal provider throws on an invalid active question; DB trigger prevents activating one | None |
| Not enough questions for a mock | `MOCK_INVENTORY_SHORTAGE` → HTTP 409 naming the subject and the shortfall; never padded with duplicates | Quota already spent on the other subjects is wasted |
| Provider down entirely | Session creation fails with a student-safe message | **No fallback.** With `QUESTION_PROVIDER=aloc` there is no automatic degradation to the internal bank — the platform simply cannot start a session |
| Duplicate / double-submitted request | `save_response_v2` returns the stored receipt for a repeated `mutation_id`; `submit_exam_attempt` and `complete_practice_session` return the existing receipt when already final | Session *creation* is not idempotent for practice |
| Interrupted exam (crash, battery, tab close) | Durable IndexedDB write precedes every network send; `beforeunload` guard; 10s checkpoint; resume from server or device | None — this is excellent |
| Two tabs on the same session | Web Locks exclusive lock; second tab shown a clear message. **No unsafe fallback** if Web Locks is unavailable | None |
| Different user on a shared device | `claimOwner` clears all stored sessions and purges the media cache on owner change; `BroadcastChannel` stops the queue on sign-out | None |
| Device clock tampering | `SessionClock` is monotonic; resyncs from `/api/time` and from every save receipt; `checkAutomaticExpiry` refuses a client-claimed expiry the server disagrees with | None |
| Database outage | Every RPC error propagates to a typed HTTP response; the runner keeps answers locally and retries | Errors surface raw `error.message` in the generic 400 branch of `examErrorResponse`/`practiceErrorResponse` — could leak schema detail |
| Storage quota exceeded / IndexedDB blocked | Explicit `STORAGE` code, `retryStorage()` action, "keep this screen open" guidance | None |
| Service worker update mid-exam | Deliberately **no** `skipWaiting`; the worker activates only after all tabs close | None — exactly right |

### The two structural reliability gaps

1. **No circuit breaker.** When ALOC is down or the quota is exhausted, every student's session attempt still costs up to 3 upstream attempts per logical call. Failure amplifies load on an already-failing dependency.
2. **No provider fallback.** `getQuestionProvider` resolves exactly one provider from an env var. There is no "prefer internal, fall back to ALOC" composition — which is precisely what target requirement **H** asks for and what would turn an ALOC outage from an outage into a degradation.
---

## 11. Target Architecture Comparison

| Ref | Requirement | Status | Explanation |
|---|---|---|---|
| **A** | ALOC server-side only | ✅ | `import "server-only"` on the provider, transport and registry. Token read only in `requireAlocConfig()`, sent as a header, never logged. Verified absent from `.next/static`. The browser talks to four same-origin `/api/*` endpoints and nothing else. |
| **B** | Question provider abstraction | ✅ | `QuestionProvider` interface (`providers/types.ts`) with `fetchQuestions` + optional `supportsSubject`; `InternalQuestionProvider` and `AlocQuestionProvider` implement it; `getQuestionProvider()` resolves by env var; `sdash` is a reserved, deliberately-throwing slot. Your brief's method list (`getSubjects`, `getYears`, `getQuestion`, `healthCheck`) is *not* implemented — see the note below. |
| **C** | Normalised internal format | ✅ | `CanonicalQuestion` carries `id`, `source{provider, providerQuestionId, internalQuestionId}`, `examBody`, `subject`, `topic`, `year`, `prompt`, `passage`, `assets`, `options`, `correctOptionKey`, `explanation`, `difficulty`. Raw ALOC shapes never escape `providers/aloc/`. `StudentQuestion` is a compile-time-enforced `Omit` of the two sensitive fields. |
| **D** | Batch fetching | ✅ | `ALOC_BATCH_LIMIT = 40`; `min(remaining, 40)` per call; 60-question English paper in 2–3 calls; navigation makes zero calls. Asserted by `tests/aloc-provider.test.mjs`. |
| **E** | Exam session snapshot | ✅ | `exam_attempts` / `exam_attempt_subjects` / `exam_attempt_questions` with `student_snapshot`, positional unique constraints, and a partial unique index preventing a second live attempt. Refresh cannot regenerate; ordering cannot drift. |
| **F** | Answer autosave | ✅ | `exam_attempt_answers` / `practice_answers` with `selected_option_key`, `is_flagged`, `answered_at`, `updated_at`. Durable-local-first, single in-flight request, superseded mutations collapsed. Cursor movement never touches the network. Debouncing is deliberately absent on answer saves and that is the right call. |
| **G** | Provider cache | ❌ | **Nothing exists.** `fetchCanonicalQuestions` goes straight to the provider. No request dedupe, no TTL cache, no negative cache for known-empty queries. The separation the brief asks for — operational caching vs permanent ingestion — is not modelled because neither exists. |
| **H** | Internal question bank | ⚠️ | The **schema** is complete and well designed (`questions`, `question_options`, `question_assets`, `question_passages`, provenance, activation triggers) and `InternalQuestionProvider` reads it. But it is **effectively empty** — only `supabase/seed.sql` demo rows — and there is **no composition**: `getQuestionProvider` returns exactly one provider. "Prefer internal, fill gaps externally" does not exist. |
| **I** | Question source tracking | ⚠️ | `source_provider` and `source_question_id` are present on `questions`, `practice_session_questions` and `exam_attempt_questions`, with a partial unique index; `questionIdentity()` uses provenance to dedupe the mistake bank across attempts. **But** `source_metadata jsonb` is always `{}` — no provider metadata is ever persisted — and `source_provider` is unconstrained free text (`internal` / `aloc` / `revision` in use). |
| **J** | External request control | ⚠️ | **Present:** 10s timeout, `MAX_ATTEMPTS = 3`, exponential backoff with jitter, `Retry-After`, non-retryable auth classification, `MAX_UPSTREAM_REQUESTS`, `MAX_BARREN_ROUNDS`, structured log lines, typed error taxonomy. **Missing:** request deduplication, server-side caching, quota monitoring, provider health status, circuit breaker, graceful fallback. |
| **K** | Quota tracking | ❌ | **Nothing exists.** No `external_api_usage` table, no counters, no per-feature attribution, no daily/monthly aggregates, no failure-rate tracking. Only `console.info`. None of the seven questions in your brief can be answered today. |
| **L** | Server-side scoring | ✅ | Correctness computed in `save_exam_response` / `save_practice_answer`; `submit_exam_attempt` recomputes every counter from `exam_attempt_answers` under `FOR UPDATE`; `loadResult` re-grades from stored `correct_option_key`. The client sends only a selection and never a score. |
| **M** | Answer security | ⚠️ | Mocks: **correct**. `toStudentQuestion` strips the key at the server boundary; the RPC stores it in a separate column; feedback is never returned during an attempt. Practice mode reveals feedback after answering, which is the intended product behaviour. **Timed practice leaks `correctCount`** to the browser mid-session (Section 8, HIGH). |

### On the `QuestionProvider` method list

Your brief proposes `getQuestions / getSubjects / getYears / getQuestion / normalizeQuestion / healthCheck`. The current interface has `fetchQuestions` + `supportsSubject`, with normalisation as a module-level function inside the adapter.

**My recommendation: do not expand the interface to match the sketch.** `getSubjects`/`getYears` would require a live ALOC call to answer questions that a static mapping and the student's own preference already answer for free — that *adds* quota consumption. `getQuestion` (single) has no caller. `normalizeQuestion` is correctly an adapter-internal concern; exposing it invites callers to hold raw provider shapes.

The one method worth adding is **`healthCheck()`**, because target **J** genuinely needs a provider health signal. Add that; leave the rest. This is the "cleanest practical version" the brief asks for — the abstraction is already right-sized, and growing it would be abstraction for its own sake.

### Product modes (Part 4)

| Mode | Status |
|---|---|
| **1. Practice** | ✅ Subject, count (1–40), mode, immediate feedback, explanations. ⚠️ **Topic and difficulty are unavailable while ALOC is active** — correctly *hidden* rather than ignored, via `getPracticeFilterCapabilities()`. Year is supported. |
| **2. Mock CBT** | ✅ Complete. Fixed set, stable ordering, server timer, autosave, navigation grid with answered/flagged legend, submit confirmation sheet, server-side scoring, per-subject and per-topic results analysis. |
| **3. Past Questions** | ⚠️ Implemented as a **tab on Practice Setup** (`?mode=past`) that swaps the topic/difficulty filters for a year picker, then creates a normal practice session. The brief's "Exam → Year → Subject → browse" *browsing* flow does not exist — there is no way to page through a year's questions without starting a session. Reasonable for now; note the gap. |
| **4. Future adaptive practice** | ✅ **Nothing implemented, and nothing blocking it.** `mistakeBank()` already tracks per-question failure counts, correct streaks and a `mastered` flag with a spaced-repetition-shaped rule (`streak >= 2`). `recommendPractice()` already detects weak topics. `breakdown()` already aggregates by subject and topic. Provenance via `questionIdentity()` already links the same question across attempts. The data model will support difficulty tracking and spaced repetition without restructuring. |

---

## 12. Recommended Target Architecture

```
  BROWSER  (unchanged - already correct)
      |  4 same-origin endpoints. Never a provider credential.
      v
  ============================ NEXT.JS SERVER ============================

  Route handlers
      |
      +--> [NEW] rate limit + quota guard     <-- fixes CRITICAL-1
      |         . per-user token bucket on session creation
      |         . cap on concurrent in_progress practice sessions
      |         . global daily provider budget -> 429 before spending
      v
  features/{exams,practice}/service.ts        (largely unchanged)
      v
  features/questions/service.ts               <-- becomes the policy layer
      |
      +--> [NEW] in-flight request dedupe (per-process keyed promise map)
      |
      +--> [NEW] QuestionSourceResolver
      |          1. internal bank        (free, preferred)
      |          2. operational cache    (free, TTL-bounded)
      |          3. external provider    (costs quota)
      |          + graceful degradation when 3 is unavailable
      v
  +---------------------+   +---------------------------+   +---------------+
  | InternalProvider    |   | [NEW] ProviderCache       |   | AlocProvider  |
  | reads public.       |   | question_cache table      |   | UNCHANGED     |
  | questions           |   | . cache_key, provider     |   | + healthCheck |
  |                     |   | . expires_at (TTL policy) |   |               |
  | [FIX] randomise in  |   | . purgeable by policy     |   |               |
  |  DB, not in a 250-  |   | . NOT an ingestion path   |   |               |
  |  row window         |   +-------------+-------------+   +-------+-------+
  +----------+----------+                 |                         |
             |                            |                         |
             v                            v                         v
  +--------------------------------------------------------------------+
  |  POSTGRES / SUPABASE                                                |
  |                                                                     |
  |  questions, question_options, ...      <- internal bank (unchanged) |
  |  question_cache                        <- [NEW] TTL, purgeable      |
  |  external_api_usage                    <- [NEW] the quota ledger    |
  |  provider_health                       <- [NEW] circuit state       |
  |  attempt_results                       <- [NEW] fixes the N+1       |
  |                                                                     |
  |  exam_attempt_questions.student_snapshot   (UNCHANGED - the frozen  |
  |  practice_session_questions.student_snapshot  paper stays frozen)   |
  +--------------------------------------------------------------------+
             |
             v  every external call is written to the ledger,
                whether it succeeded, failed, or was served from cache
  ==================================
  ||  questions.aloc.com.ng        ||
  ==================================
```

Three properties this preserves deliberately:

1. **The frozen snapshot is untouched.** Caching sits *before* the snapshot, never replaces it. An attempt's paper is still immutable and still fully self-contained.
2. **Retention is policy, not structure.** `question_cache` carries an explicit `expires_at` and a purge path, so an unfavourable licence answer is a configuration change, not a migration.
3. **No new infrastructure.** No Redis, no queue, no microservice. Postgres and Next.js, as the brief asks. In-process dedupe covers the thundering-herd case; the database covers everything durable.

---

## 13. Recommended Database Changes

*Recommendations only. No migration has been written.*

### New tables

```sql
-- Target K: the quota ledger. One row per external call attempt.
-- Deliberately carries no user id and no answer content.
create table public.external_api_usage (
  id            bigserial primary key,
  provider      text        not null,          -- 'aloc'
  endpoint      text        not null,          -- '/q/40'  (path only, never the query string)
  feature       text        not null,          -- 'mock_create' | 'practice_create' | 'smoke'
  exam_type     text,
  subject_code  text,
  request_type  text        not null,          -- 'batch' | 'single' | 'health'
  attempt       smallint    not null default 1,
  question_count integer    not null default 0, -- returned, not requested
  unique_count  integer     not null default 0, -- kept after dedupe
  status        text        not null,          -- 'ok' | 'retry' | 'failed' | 'rate_limited' | 'cache_hit'
  http_status   integer,
  duration_ms   integer     not null,
  created_at    timestamptz not null default now()
);
create index external_api_usage_provider_day_idx
  on public.external_api_usage (provider, created_at desc);
create index external_api_usage_feature_idx
  on public.external_api_usage (feature, created_at desc);
```

```sql
-- Target G: operational cache. Separate from the internal bank on purpose.
-- Retention is a policy value, so an unfavourable licence answer is a config change.
create table public.question_cache (
  cache_key     text        primary key,       -- hash(provider|exam|subject|year)
  provider      text        not null,
  exam_type     text        not null,
  subject_code  text        not null,
  year          integer,
  payload       jsonb       not null,          -- normalized CanonicalQuestion[]
  question_count integer    not null,
  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz not null,          -- REQUIRED. no indefinite retention
  hit_count     integer     not null default 0
);
create index question_cache_expiry_idx on public.question_cache (expires_at);
create index question_cache_lookup_idx
  on public.question_cache (provider, exam_type, subject_code, year);
```

```sql
-- Target J: provider health / circuit breaker state.
create table public.provider_health (
  provider           text        primary key,
  status             text        not null default 'healthy',  -- healthy|degraded|down
  consecutive_failures integer   not null default 0,
  opened_at          timestamptz,               -- circuit opened
  retry_after        timestamptz,
  last_success_at    timestamptz,
  last_error         text,                      -- classification only, never a body
  updated_at         timestamptz not null default now()
);
```

```sql
-- Fixes the loadHistory N+1. Written once at submission, read by every dashboard.
create table public.attempt_results (
  kind          text        not null check (kind in ('exam','practice')),
  result_id     uuid        not null,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  exam_body_id  uuid        not null references public.exam_bodies(id) on delete restrict,
  completed_at  timestamptz not null,
  total         integer     not null,
  correct       integer     not null,
  unanswered    integer     not null,
  score         integer     not null,
  maximum       integer     not null,
  scaled        boolean     not null,
  elapsed_seconds integer   not null,
  subject_breakdown jsonb   not null,           -- Breakdown[]
  topic_breakdown   jsonb   not null,
  primary key (kind, result_id)
);
create index attempt_results_user_idx
  on public.attempt_results (user_id, completed_at desc);
```

### New columns

| Table | Column | Why |
|---|---|---|
| `questions` | `source_metadata` — start **populating** it | Target I asks for `provider_metadata`; the column exists and is always `{}` |
| `practice_session_questions` | `cache_key text` | Trace which cached fetch produced a frozen question — debugging and provider migration |
| `exam_attempt_questions` | `cache_key text` | same |

### New indexes

```sql
create index practice_session_questions_internal_q_idx
  on public.practice_session_questions (internal_question_id)
  where internal_question_id is not null;
create index exam_attempt_questions_internal_q_idx
  on public.exam_attempt_questions (internal_question_id)
  where internal_question_id is not null;
create index questions_passage_idx
  on public.questions (passage_id) where passage_id is not null;
create index exam_attempts_user_status_id_idx
  on public.exam_attempts (user_id, status, id);
create index practice_sessions_user_status_id_idx
  on public.practice_sessions (user_id, status, id);
```

### New constraints

```sql
-- Closes CRITICAL-1 at the database level, mirroring the mock's guard.
create unique index practice_sessions_one_active_per_user_idx
  on public.practice_sessions (user_id)
  where status = 'in_progress';
--   ^ If the product wants N concurrent sessions, use a counting trigger instead.
--     The point is that "unlimited" must stop being the answer.

-- Constrain provenance so a typo cannot invent a provider.
alter table public.questions
  add constraint questions_source_provider_known
  check (source_provider in ('internal','aloc','sdash','revision'));
```

### Drops to consider (only after confirming nothing depends on them)

- `question_provider_subject_mappings`, `question_provider_topic_mappings` — never read; the mapping lives in `mapping.ts`. **Either** delete them **or** migrate `mapping.ts` to read from them. Two sources of truth is the actual problem.
- `question_catalog_counts(text)` — defined, secured, never called.
- The redundant `unique (session_id, session_question_id)` and `unique (attempt_id, attempt_question_id)` indexes.
- `exam_attempt_status = 'created'` — unreachable.

---

## 14. Files That Need To Change

Real paths from this repository.

### Phase 1 — Security and ALOC request control

| Path | Action |
|---|---|
| `features/practice/service.ts` | **FIX** — gate `correctCount` on `revealFeedback` (line 233). *Answer-key leak.* |
| `lib/rate-limit.ts` | **CREATE** — per-user token bucket, Postgres-backed |
| `app/api/practice/sessions/route.ts` | **REFACTOR** — apply rate limit before calling the service |
| `app/api/exam/attempts/route.ts` | **REFACTOR** — same |
| `app/api/progress/practice/route.ts` | **REFACTOR** — same (protects `loadHistory`) |
| `features/questions/providers/aloc/normalize.ts` | **REFACTOR** — add `import "server-only"` |
| `features/questions/providers/aloc/mapping.ts` | **REFACTOR** — same |
| `features/questions/providers/index.ts` | **REFACTOR** — `.trim()` the env var, matching the two services |
| `tests/practice-answer-security.test.mjs` | **CREATE** — assert `correctCount` is withheld for in-progress timed sessions |
| `tests/rate-limit.test.mjs` | **CREATE** |

### Phase 2 — Provider service architecture

| Path | Action |
|---|---|
| `features/questions/providers/types.ts` | **REFACTOR** — add optional `healthCheck()` |
| `features/questions/providers/aloc/index.ts` | **REFACTOR** — implement `healthCheck()`; **do not touch the batching loop** |
| `features/questions/resolver.ts` | **CREATE** — internal → cache → external composition with degradation |
| `features/questions/service.ts` | **REFACTOR** — route through the resolver; add in-flight dedupe |
| `features/questions/providers/internal.ts` | **REFACTOR** — fix randomisation (Section 9); narrow `select("*")` |
| `features/exams/service.ts` | **REFACTOR** — populate `excludeSourceIds`; check availability *before* fetching all four subjects |
| `features/practice/service.ts` | **REFACTOR** — populate `excludeSourceIds` from recent sessions |
| `tests/question-resolver.test.mjs` | **CREATE** |
| `tests/internal-provider.test.mjs` | **CREATE** — regression for the randomisation window |

### Phase 3 — Exam session persistence

Already correct. **No changes.** The only touch is the optional stable-identity guard on `use-session.ts:131`, and that is a comment-first change.

### Phase 4 — Question caching *(gated on the licence decision)*

| Path | Action |
|---|---|
| `supabase/migrations/<ts>_m8_question_cache.sql` | **CREATE** — `question_cache` |
| `features/questions/cache.ts` | **CREATE** — get/put/purge with an explicit TTL policy |
| `features/questions/resolver.ts` | **REFACTOR** — wire the cache in |
| `types/database.ts` | **REFACTOR** — regenerate |
| `scripts/purge-question-cache.mjs` | **CREATE** — retention enforcement |
| `tests/question-cache.test.mjs` | **CREATE** — must assert expiry is enforced |

### Phase 5 — Server-side scoring

Already correct. **No changes.** Add characterisation tests only:

| Path | Action |
|---|---|
| `tests/scoring-authority.test.mjs` | **CREATE** — assert a forged client payload cannot influence a score |

### Phase 6 — Usage analytics

| Path | Action |
|---|---|
| `supabase/migrations/<ts>_m8_provider_usage.sql` | **CREATE** — `external_api_usage`, `provider_health` |
| `features/questions/usage.ts` | **CREATE** — ledger writer (fire-and-forget, never blocks a student) |
| `features/questions/providers/aloc/transport.ts` | **REFACTOR** — call the ledger alongside `logCall` |
| `features/questions/service.ts` | **REFACTOR** — pass a `feature` tag through the query |
| `features/questions/types.ts` | **REFACTOR** — add `feature` to `QuestionQuery` |
| `app/api/admin/provider-usage/route.ts` | **CREATE** — read-only, admin-gated |
| `tests/provider-usage.test.mjs` | **CREATE** |

### Phase 7 — Cleanup, performance and tests

| Path | Action |
|---|---|
| `supabase/migrations/<ts>_m8_attempt_results.sql` | **CREATE** — `attempt_results` + indexes + constraints from Section 13 |
| `features/results/service.ts` | **REFACTOR** — write aggregates at submission; dashboards read `attempt_results` |
| `app/(student)/home/page.tsx` | **REFACTOR** — read aggregates, not `loadHistory` |
| `app/(student)/progress/page.tsx` | **REFACTOR** — same |
| `app/(student)/progress/mistakes/page.tsx` | **REFACTOR** — same |
| `app/(student)/practice/page.tsx` | **REFACTOR** — same |
| `types/domain.ts` | **REFACTOR** — remove dead `Question`, `Subject`, `ExamAttempt`, `AttemptAnswer` |
| `supabase/migrations/<ts>_m8_schema_cleanup.sql` | **CREATE** — drop dead tables/RPC/indexes |
| `tests/engine-manifest.json` | **RE-RECORD** — see the warning below |

---

## 15. Implementation Plan

### ⚠️ Read this before touching anything

`tests/engine-guard.test.mjs` SHA-256 hashes **33 engine files** and fails the suite if any of them changes. It covers `features/offline/*`, `features/exams/*`, `features/practice/*`, `features/results/grading.ts`, `features/questions/*` (including all four ALOC modules) and every API route.

Almost every refactor below touches a guarded file. The manifest must be **re-recorded in the same commit as the reviewed change** — never weakened, never deleted. Build that step into each phase's definition of done.

---

### Phase 1 — Security and ALOC request control

**Goal:** stop the answer leak and make quota exhaustion impossible from a single account.

- **Files:** `features/practice/service.ts`, the three POST routes, `lib/rate-limit.ts` (new), `providers/index.ts`, the two ALOC pure modules
- **Database:** none required for the leak fix. Optionally `practice_sessions_one_active_per_user_idx`
- **Risks:** a rate limit that is too tight blocks legitimate students, especially on shared/NAT'd connections common in Nigerian cyber cafés. Key on `user_id`, never on IP. Start generous (e.g. 20 session creations/hour), log rejections for a week, then tighten
- **Tests:** timed-practice payload withholds `correctCount`; practice mode still reveals feedback; completed session still returns the real count; limiter allows normal use and blocks a burst
- **Backwards compatibility:** `correctCount` becomes `0` mid-timed-session. No UI reads it, so nothing visibly changes. The `PracticeSessionView` type is unchanged
- **Ship independently. Do this first — it is the only phase with a live security finding.**

### Phase 2 — Provider service architecture

**Goal:** one place decides where a question comes from, and unseen-question selection stops wasting requests.

- **Files:** `providers/types.ts`, `providers/aloc/index.ts` (health check only), `providers/internal.ts`, `questions/service.ts`, `questions/resolver.ts` (new), both engine services
- **Database:** none
- **Risks:** *Highest-risk phase.* Changing `internal.ts` randomisation alters which questions students receive. `excludeSourceIds` can push a thin subject into a false shortage — cap the exclusion list (e.g. the last 200 seen ids) and degrade to allowing repeats rather than failing session creation
- **Tests:** resolver prefers internal, falls back correctly, degrades when both fail; randomisation reaches beyond 250 rows; exclusion never causes a false shortage
- **Backwards compatibility:** `QUESTION_PROVIDER` must keep working exactly as it does today so the internal-only path stays available as an escape hatch
- **Do not touch the ALOC batching loop.** It is correct and tested.

### Phase 3 — Exam session persistence

**Already complete.** Nothing to do. Formally verify by manual browser test, since `M7_IMPLEMENTATION_NOTES.md` records that the Practice and Mock flows have **never been exercised end to end in a browser** against a live Supabase project. That gap should be closed before any of this ships.

### Phase 4 — Question caching *(BLOCKED on a business decision)*

**Do not start until someone with authority confirms ALOC's terms permit temporary shared caching.**

- **Files:** `questions/cache.ts` (new), `questions/resolver.ts`, one migration, `types/database.ts`, a purge script
- **Database:** `question_cache` with a **mandatory** `expires_at`
- **Risks:** a stale cache serves withdrawn or corrected questions. Cap TTL conservatively (hours, not weeks) and make purge a one-command operation. Cache the *normalised* payload, never the raw provider body
- **Tests:** expiry is enforced on read as well as by the purge job; a cache hit writes a `cache_hit` ledger row; purge removes everything for a provider
- **Backwards compatibility:** cache misses must behave exactly as today. Ship behind a flag (`QUESTION_CACHE_TTL_SECONDS=0` disables it)
- **Expected impact:** this is the phase that changes the quota curve from "per session started" to "per unique content needed"

### Phase 5 — Server-side scoring

**Already complete.** Add adversarial characterisation tests so a future refactor cannot silently move authority to the client.

### Phase 6 — Usage analytics

- **Files:** `questions/usage.ts` (new), `providers/aloc/transport.ts`, `questions/service.ts`, `questions/types.ts`, one migration, an admin route
- **Database:** `external_api_usage`, `provider_health`
- **Risks:** a ledger write that blocks a student's session creation converts an observability feature into an availability risk. **Fire-and-forget with a catch, never awaited on the critical path.** Never log tokens, user ids, question text or answer keys
- **Tests:** every transport outcome (`ok`/`retry`/`failed`/`rate_limited`) writes exactly one row; a ledger failure never fails the request; no secret appears in any row
- **Backwards compatibility:** purely additive
- **After this phase, all seven of your section-K questions become answerable.**

### Phase 7 — Cleanup, performance and tests

- **Files:** `features/results/service.ts`, the four dashboard pages, `types/domain.ts`, two migrations
- **Database:** `attempt_results`; the new indexes and constraints; the dead-schema drops
- **Risks:** the aggregate table must be backfilled for existing completed attempts before the dashboards switch over, or history silently disappears. Backfill first, dual-read second, switch third, drop the old path last
- **Tests:** aggregates match `loadResult()` exactly for a set of known attempts; backfill is idempotent
- **Backwards compatibility:** keep `loadResult()` unchanged for the single-result review page — it is correct there

---

## 16. What Should NOT Be Changed

These are the parts of the system that are already right. Changing them will make the product worse.

1. **The entire offline/session engine** — `features/offline/use-session.ts`, `queue.ts`, `storage.ts`, `clock.ts`. Durable-write-before-send, single in-flight request with superseded-mutation collapsing, `expectedRevision` optimistic concurrency, `mutation_id` idempotency receipts, the monotonic clock, the Web Locks single-editor guard with **no unsafe fallback**, owner-change cache purging, `BroadcastChannel` sign-out propagation. This is the strongest code in the repository. Your own `Remediation-Spec.md` already says "do not touch this logic" — that assessment is correct.

2. **The ALOC batching loop** (`providers/aloc/index.ts:96-124`). `min(remaining, 40)`, cross-round dedupe, barren-round cutoff, hard request ceiling, shortage reported honestly rather than padded with duplicates. This is exactly what the brief asks for and it is already here.

3. **The ALOC transport's error classification** (`transport.ts:139-185`). Reading both the HTTP status and the body code because the legacy API is inconsistent; treating a 200 without `data` as a failure; refusing to echo upstream bodies because they contain Laravel stack traces with server paths. Every one of those lines exists because of a real observed failure.

4. **The normaliser's refusal to guess** (`normalize.ts:152-164`). Answer keys resolve by letter, then by an *unambiguous* text match, then the question is discarded. No question is ever graded on a guessed key. Do not "improve" this with fuzzy matching.

5. **The subject quarantine mechanism** (`mapping.ts:66-72`). An unverified upstream identifier is held in a separate table, never sent, never offered, and probeable only through the smoke script. This is a genuinely good pattern for managing an under-documented third-party API.

6. **The `StudentQuestion` type boundary.** `Omit<CanonicalQuestion, "correctOptionKey" | "explanation">` makes leaking an answer key a compile error rather than a code-review question. Keep it, and route any new question-bearing payload through `toStudentQuestion()`.

7. **The database's composite foreign keys and activation triggers.** `(topic_id, subject_id) → topics(id, subject_id)`, the immutability guards on active questions, and the option-set validation on activation. These make whole classes of data corruption structurally impossible.

8. **Server-authoritative timing and submission.** `expires_at` set server-side, `checkAutomaticExpiry` refusing a client-claimed expiry, `submit_exam_attempt` forcing `time_expired` when `now() >= expires_at`, and recomputing every counter under `FOR UPDATE`.

9. **The service worker's refusal to `skipWaiting`** (`public/sw.js:13`). A worker update mid-exam would be catastrophic; the comment says exactly that and the code honours it.

10. **The capability-gating UI pattern.** Practice Setup hides the topic and difficulty controls when the active provider cannot honour them, rather than accepting a filter and ignoring it. A student never sees unrelated questions under a label they chose. Both the server gate and the UI gate should stay — the redundancy is the point.

11. **`tests/engine-guard.test.mjs`.** It will be an obstacle during this work. That is its job. Re-record the manifest alongside reviewed changes; never weaken or delete the test.

---

## Appendix — Verification performed

| Check | Result |
|---|---|
| `npm test` | **221 passed, 0 failed** |
| `npm run typecheck` | Passed, no output |
| `npm run lint` | Passed, no output |
| `grep -rl "aloc\|AccessToken" .next/static` | **No matches** — no provider identifier in the client bundle |
| `git ls-files \| grep -i env` | `.env.example` only — no secret file is tracked |
| Call sites of `fetchCanonicalQuestions` | **2** — both at session creation |
| Client-side `fetch()` calls | **4** — all same-origin `/api/*` |
| `router.refresh()` / `revalidateTag` occurrences | **0** / **0** |
| Duplicate or dead ALOC implementations | **None found** |

No code was modified, no migration was written, no package was installed, nothing was deleted, no credential was rotated, and no external endpoint was called.

**Awaiting approval before implementation.**
