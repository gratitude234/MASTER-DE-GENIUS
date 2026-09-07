# MASTER@DE'GENIUS — Phase 0 + Phase 1 Report

**Date:** 2026-09-07
**Scope delivered:** Phase 0 baseline verification, Phase 1A answer-leak fix, Phase 1B quota protection, small hardening items.
**Not started:** Phases 2, 4, 6, 7. No cache, no provider composition, no internal-bank fallback, no usage analytics, no `attempt_results`, no schema cleanup, no dashboard refactors.

---

## ⚠️ Two things to action before anything else

### 1. The live ALOC token is dead

```
GET /q?subject=chemistry&type=utme   -> HTTP 406
     body: { "status": 406, "error": "Access token not valid or deactivated" }
GET /q/2?subject=mathematics&type=utme -> HTTP 406  (identical)
```

Reproduced against the real vendor with the token in `.env.local`, across two endpoints and two subjects. `M7_IMPLEMENTATION_NOTES.md` records this token as verified-working on 2026-09-06, so it has been deactivated or expired since.

Combined with `public.questions` holding **0 rows**, the platform currently cannot build any session from any provider against your live project. This is independent of my changes and predates them.

### 2. The migration must be applied before this code is deployed

You chose to apply it yourself. Until `supabase/migrations/20260907000001_m8_rate_limit_and_creation_claims.sql` is applied, the rate limiter **fails closed** and both creation endpoints return HTTP 429. That is the correct design (see §5) but it means:

```bash
supabase db push          # or paste the file into the SQL editor
```

**must land before or with the deploy, not after.** Nothing else in Phase 1 depends on it.

---

## 1. Exact files changed

### Created

| File | Purpose |
|---|---|
| `lib/rate-limit.ts` | Postgres-backed token-bucket limiter, policies, 429 builder |
| `lib/creation-claim.ts` | Duplicate-creation suppression around session creation |
| `supabase/migrations/20260907000001_m8_rate_limit_and_creation_claims.sql` | The only migration added |
| `tests/rate-limit.test.mjs` | 16 tests: limiter + claims + privilege boundary, on real Postgres |
| `tests/practice-answer-security.test.mjs` | 8 tests: A–E from the brief, plus two extra |

### Modified

| File | Change |
|---|---|
| `features/practice/service.ts` | `correctCount` gated on `revealFeedback` (Phase 1A) |
| `features/practice/types.ts` | `correctCount: number` → `number \| null`, documented |
| `app/api/practice/sessions/route.ts` | Rate limit + creation claim before the provider is contacted |
| `app/api/exam/attempts/route.ts` | Rate limit + creation claim before the provider is contacted |
| `app/api/progress/practice/route.ts` | Rate limit (protects `loadHistory`, not provider quota) |
| `features/questions/providers/index.ts` | `.trim()` on `QUESTION_PROVIDER` |
| `features/questions/providers/aloc/normalize.ts` | `import "server-only"` |
| `features/questions/providers/aloc/mapping.ts` | `import "server-only"` |
| `tests/engine-manifest.json` | Re-recorded for the 8 reviewed engine files above |
| `public/sw.js` | Build artefact only — `postbuild` stamps the new `BUILD_ID` |

**Nothing else was touched.** `features/offline/{use-session,queue,storage,clock}.ts`, the ALOC batching loop, `providers/aloc/transport.ts`, the `StudentQuestion` boundary, the scoring RPCs, the frozen snapshots, the server-authoritative timer, service-worker activation and the subject quarantine are all byte-identical.

> **Note on the working tree:** the repo had substantial uncommitted UI-remediation work before I started (91 entries in `git status`). A raw `git diff` mixes that with my changes. The table above is only mine.

---

## 2. Migration / RPC added

One migration, additive only. It creates nothing that existing tables or data depend on, and drops nothing.

**Tables**

- `public.rate_limit_buckets` — `bucket_key` PK, `tokens numeric`, `updated_at`
- `public.session_creation_claims` — PK `(user_id, kind, fingerprint)`, `session_id uuid`, `claimed_at`

Both: RLS enabled, `revoke all from public, anon, authenticated`, `grant` to `service_role` only.

**Functions** (all `security definer`, `set search_path = ''`, service-role execute only)

- `consume_rate_limit(p_key, p_capacity, p_refill_per_second, p_cost default 1)` → `(allowed, remaining, retry_after_seconds)`
- `claim_session_creation(p_user_id, p_kind, p_fingerprint, p_inflight_seconds default 90, p_duplicate_seconds default 10)` → `(outcome, session_id)`
- `settle_session_creation(p_user_id, p_kind, p_fingerprint, p_session_id default null)` → `void`

**To reverse:** drop the two tables and three functions. Nothing else references them.

### Resolving the audit's inconsistency

The audit said "Postgres-backed" in one place and "no database change required" in another. **The audit was wrong on the second point, and the brief was right to flag it.**

A limiter with no shared state cannot work here. Vercel runs many instances; an in-memory `Map` would be per-instance, reset on every cold start, and would let N instances each grant a full budget. Correctness requires shared, atomic state, and Postgres is the only store this app already has. Hence the migration.

---

## 3. Rate-limit algorithm

**Token bucket with lazy refill, evaluated inside one Postgres function.**

1. `INSERT ... ON CONFLICT DO NOTHING` creates the bucket at full capacity if absent.
2. `SELECT ... FOR UPDATE` locks that bucket row.
3. Refill: `tokens = least(capacity, tokens + elapsed_seconds × refill_per_second)`.
4. If `tokens >= cost` → deduct, `allowed = true`.
5. Otherwise → `allowed = false`, `retry_after_seconds = ceil((cost − tokens) / refill_per_second)`.

Chosen over a fixed window because a fixed window lets a student burn the whole budget in the last second of one window and again in the first second of the next. A token bucket gives a genuine burst allowance *and* a sustained ceiling, which matches how students actually work — several sessions in a study block, then nothing for hours.

**A rejected call still writes back the refilled balance and advances `updated_at`.** Deliberate: it records time that genuinely passed without granting anything, so hammering the endpoint neither stalls the refill nor extends the caller's own lockout. There is a test for exactly this.

---

## 4. Default limits

Every value is env-overridable; nothing is a magic number at a call site.

| Policy | Burst | Sustained | Env vars |
|---|---|---|---|
| `practice_create` | **12** | **30 / hour** | `RATE_LIMIT_PRACTICE_BURST`, `RATE_LIMIT_PRACTICE_PER_HOUR` |
| `mock_create` | **3** | **6 / hour** | `RATE_LIMIT_MOCK_BURST`, `RATE_LIMIT_MOCK_PER_HOUR` |
| `revision_create` | **10** | **40 / hour** | `RATE_LIMIT_REVISION_BURST`, `RATE_LIMIT_REVISION_PER_HOUR` |

Deliberately generous. These exist to stop a runaway script exhausting the shared provider quota, not to ration studying. A student doing 12 practice sessions back-to-back never sees a 429; a mock is limited harder because it costs ~6 upstream requests and runs for two hours, so 3 in a burst is already beyond any real use.

**Keyed by `user_id`, never by IP** — bucket key is `"{policy}:{userId}"`. Nigerian students routinely share an address through university Wi-Fi, cyber cafés, school networks and carrier-grade NAT; an IP-keyed limiter would lock out a whole campus because of one heavy user. A test asserts two users cannot affect each other's bucket.

### Not rate limited

Next, Previous, cursor movement, answer autosave, flag changes, exam submit, practice complete. None spend provider quota, and throttling an answer save would risk a student's work. Untouched.

---

## 5. How atomicity and concurrency are guaranteed

The entire read-modify-write happens **inside one `security definer` PL/pgSQL function**, and the bucket row is held under `SELECT ... FOR UPDATE` for the duration. Concurrent callers for the same key serialise on that row lock, so two simultaneous requests cannot both spend the last token. There is no application-side read-then-write window to lose.

Bucket creation is race-free via `INSERT ... ON CONFLICT DO NOTHING` followed by the locking select — a caller that loses the insert simply locks the winner's row.

**Proven, not assumed.** `tests/rate-limit.test.mjs` runs every migration into an in-process real Postgres (PGlite, the pattern already used by `tests/offline-database.test.mjs`) and fires 40 interleaved `consume_rate_limit` calls with `Promise.all`:

```
✔ concurrent consumers cannot spend the same token twice
    exactly 12 of 40 allowed (= the configured burst)
    bucket drained below 1 token, never negative
```

Because this is genuine Postgres, the `FOR UPDATE` semantics under test are the same ones production will use.

**Failure policy — deliberately different for the two mechanisms:**

- **Limiter fails closed.** If it cannot reach the database, neither can session creation — same client, same database — so refusing adds no new outage, while failing open would remove the quota guard exactly when the system is already unhealthy.
- **Claim fails open.** It exists only to avoid buying the same questions twice. Refusing a student's session because a bookkeeping row was briefly unavailable would trade a rare, bounded cost for a visible outage. The limiter still bounds total spend.

---

## 6. How duplicate practice creation is prevented

I inspected the practice UX first, as asked. `components/practice/practice-setup.tsx:151` guards only with a client `starting` boolean — per-tab, and gone on reload. Meanwhile `createPracticeSessionForUser` contacts the provider *before* the session row exists, so there is a multi-second window in which a double-tap, a retried POST, or a second tab each buys its own batch of questions.

**The rule implemented is the smallest one that closes that window:**

A claim is taken on `(user_id, kind, fingerprint)` **before** the provider is contacted, where `fingerprint` is a SHA-256 of the request shape (subject, topic, count, mode, difficulty, year). Three outcomes:

| Outcome | Meaning | Response |
|---|---|---|
| `claimed` | This caller owns the creation | proceeds |
| `in_progress` | Identical request still building (< 90s) | `409` + `Retry-After: 3` |
| `duplicate` | Identical request succeeded < 10s ago | `200` with the first session's id |

**What it deliberately does not do:** it is *not* "one practice session at a time". The brief warned against that and it would be wrong — a student may legitimately run several sessions, and may repeat an identical setup later. Only an identical request *in flight*, or *within 10 seconds* of one succeeding, is treated as accidental. A student who finishes a 10-question Physics set and immediately starts another identical one gets a genuinely new session; there is a test for that.

Both windows are tunable, and a failed creation releases its claim immediately so a student who hit a provider error can retry at once.

**Mock exams:** the existing `exam_attempts_one_active_per_exam_idx` partial unique index is preserved and still does the real work. The claim only closes the pre-provider window, because that index is reached *after* all four subjects have been fetched — so two concurrent submits would previously spend two full papers' worth of quota before one lost. A test asserts the one-active-mock guarantee is unchanged.

---

## 7. Before / after timed-practice payload

`features/practice/service.ts` already computed `revealFeedback = mode === "practice" || status === "completed"` and used it to withhold per-question `feedback`. The running `correctCount` was sent regardless — an answer key in aggregate.

```diff
- correctCount: typedSession.correct_count,
+ correctCount: revealFeedback ? typedSession.correct_count : null,
```

| Session state | Before | After |
|---|---|---|
| Practice, in progress | real count | **real count** (unchanged — feedback is the product) |
| **Timed, in progress** | **real count — leaked** | **`null`** |
| Timed, completed | real count | real count |
| Practice, completed | real count | real count |
| Mock exam (any state) | no such field | no such field (unchanged) |

**The oracle, before:** answer Q1 → reload → read `correctCount`. Incremented means correct. Repeat per question for the full key, during a graded timed session.

**After:** every in-progress timed payload carries `null`, so a correct answer and an incorrect one produce byte-identical payloads. Test B asserts exactly that indistinguishability; test C walks a four-step answer-and-reload sequence and asserts the count stays `null` at every step.

`null` rather than `0` because a completed session that genuinely scored zero must remain distinguishable from a withheld count — test D2 pins this. The type became `number | null` and is documented.

**This protects the payload, not the render.** The assertions call the service and inspect what it returns; no test relies on the UI ignoring a field. As it happens `PracticeSessionRunner` never read `initialSession.correctCount` — it reads `completion.correctCount` from the completion receipt, which is unaffected — so there is no visible UI change.

---

## 8. Test results

```
npm test
ℹ tests 245     ℹ pass 245     ℹ fail 0
```

Baseline before this work was **221**. The 24 added are the new limiter and answer-security suites.

The brief's 10 required areas, all covered and passing:

| # | Required | Test |
|---|---|---|
| 1 | timed-practice `correctCount` security | `B`, `C` |
| 2 | normal-practice feedback regression | `A` |
| 3 | limiter normal usage | `a student working normally is never rate limited` |
| 4 | limiter burst rejection | `a runaway script is cut off after the burst and told when to return` |
| 5 | limiter concurrency / race | `concurrent consumers cannot spend the same token twice` (40 interleaved) |
| 6 | duplicate practice creation | `a double-submitted practice request does not buy two batches of questions` |
| 7 | mock active-attempt intact | `the one-active-mock-per-exam guarantee is unchanged` |
| 8 | limiter failure leaks no secrets | `a limiter failure is refused without leaking internals to the student` |
| 9 | ALOC batching tests still pass | all 4 `aloc-*.test.mjs` suites pass unchanged |
| 10 | offline/session tests still pass | `offline-database`, `offline-queue`, `engine-guard` pass |

Extra beyond the brief: per-user bucket isolation, independent practice/mock budgets, refill cannot be stalled by hammering, invalid-parameter rejection, `null` vs real-zero distinction, exam view carries no correctness field, snapshot carries no answer key in any mode, claims are per-kind, stale claims expire, failed creations release immediately, and neither new table nor RPC is reachable by a signed-in browser session.

---

## 9. Typecheck

```
npm run typecheck   →  clean, no output
```

## 10. Lint

```
npm run lint        →  clean, no output, zero warnings
```

No rule disabled, no `@ts-expect-error`, no `any` introduced.

## 11. Build

```
npm run build       →  ✓ Compiled successfully in 9.2s
                       ✓ Linting and checking validity of types
                       ✓ Generating static pages (20/20)
                       postbuild: version-worker stamped the new BUILD_ID
```

---

## 12. Engine-manifest changes

`tests/engine-guard.test.mjs` remains enabled, unmodified and unweakened. No file was excluded to make it pass.

Eight guarded files legitimately changed, and the manifest was re-recorded **after** the changes were complete, in the same working state:

```
features/practice/service.ts
features/practice/types.ts
features/questions/providers/index.ts
features/questions/providers/aloc/normalize.ts
features/questions/providers/aloc/mapping.ts
app/api/practice/sessions/route.ts
app/api/exam/attempts/route.ts
app/api/progress/practice/route.ts
```

Manifest still holds **33** entries — no file was added to or removed from the guard's coverage. Independently re-verified: all 8 recorded hashes match the current file contents, 0 mismatches.

---

## 13. Backwards-compatibility concerns

| # | Concern | Assessment |
|---|---|---|
| 1 | **`correctCount` is now `number \| null`** | Type-level breaking change for any consumer. In-repo there is none — nothing read `PracticeSessionView.correctCount`. Typecheck confirms. |
| 2 | **`OfflineRecord.view` in IndexedDB** | A session stored before this change holds a numeric `correctCount`; after, `null`. Nothing reads it, `version` is unchanged, and no migration is needed. |
| 3 | **New 429 responses** | Clients already surface `payload.error`, so a 429 renders as a readable message. No client change required. |
| 4 | **New 409 `CREATION_IN_PROGRESS`** | Same. Currently shown as an error message rather than an auto-retry — acceptable, and a UX polish item if you want it smoother. |
| 5 | **Practice `duplicate` returns 200, not 201** | `practice-setup.tsx` checks `!response.ok \|\| !payload.sessionId`, so a 200 with a `sessionId` navigates correctly. `questionCount` is `null` in this response; nothing reads it on that path. |
| 6 | **Limiter fails closed without the migration** | The deploy-order issue in the banner. This is the one real operational risk. |
| 7 | **`import "server-only"` in two ALOC modules** | Node-based tests import them directly and still pass; the package only throws in a client bundle. |
| 8 | **`QUESTION_PROVIDER` trimming** | Strictly more permissive — a value that worked before still works. |
| 9 | **`public/sw.js` build-id churn** | `postbuild` rewrites it on every build; it will always show as modified after a build. Pre-existing behaviour. |

---

## 14. Unresolved issues

1. **Browser re-verification after the change was not run.** You chose to apply the migration yourself, and the limiter fails closed without it, so session creation returns 429 and the post-change scenarios cannot execute. **The pre-change Phase 0 baseline in the appendix is real and complete.** Re-run `ONLY=1,2,3` once the migration is applied — I can drive it if you want.
2. **The ALOC token is deactivated.** Blocks all live question fetching. Vendor-side; needs a new token.
3. **`public.questions` is empty (0 rows).** There is no internal fallback, so an ALOC outage is a total outage. Phase 2's composition work is what fixes this.
4. **No cleanup job for the two new tables.** `rate_limit_buckets` and `session_creation_claims` accumulate one row per user per policy / per request shape. Both are indexed on their timestamp for exactly this, but no purge is scheduled. Low urgency, trivial cron later.
5. **`claim_session_creation`'s "just inserted" check compares `claimed_at = v_now`.** Correct because `clock_timestamp()` is distinct per statement, but it is subtle; a dedicated boolean from the insert would be plainer. Behaviour is test-covered.
6. **Phase 1 does not fix the audit's HIGH-6** (`loadHistory` N+1). The revision endpoint is now rate limited, which caps the abuse, but `/home`, `/practice` and `/progress` still re-grade full history on every render. That is Phase 7.
7. **A dedicated test account now exists in your Supabase**, with its Phase 0 assessment records:
   `phase0.baseline@masterdegenius.test` (user `538f079d-…`), 3 practice sessions and 1 submitted mock. Say the word and I'll delete it; I left it so you can re-run the browser scenarios.

---

## Appendix — Phase 0 baseline (measured, pre-change)

**Environment:** live Supabase (all 7 migrations applied, reachable), production build via `next build && next start`, real application code, real ALOC adapter.

**One substitution, clearly stated:** the ALOC *vendor host* was replaced by a local stub, because the real token is deactivated (§ banner). Every line of MASTER@DE'GENIUS's own adapter — `transport.ts`, `normalize.ts`, `mapping.ts`, the batching loop — ran unmodified against it, and upstream requests were counted at the stub. **No browser result below is fabricated;** each row is a Playwright action against the running app. What this cannot prove is the live vendor's availability.

### Scenario 1 — Practice

| ALOC calls | Step | Observed |
|---|---|---|
| **1** | create session (10 q) | session created, 4 options rendered |
| 0 | answer Q1 | immediate feedback `"Correct"` |
| 0 | — | answer locks after feedback (options disabled) |
| **0** | **click Next** | advanced to Q2 |
| 0 | answer Q2 | feedback shown |
| **0** | **click Previous** | back on Q1, prior answer still selected |
| **0** | **refresh browser** | same URL, session resumed, answer persisted |
| 0 | answer remaining | walked to final question |
| 0 | complete session | score panel `"10 / 10"` |
| 0 | verify result page | `"JAMB Practice"` |

### Scenario 2 — Timed practice

| ALOC calls | Step | Observed |
|---|---|---|
| **1** | create timed session (10 q) | timer reads `09:56` |
| 0 | answer 3 questions | **0 feedback blocks visible** (correct for timed mode) |
| **0** | **refresh browser** | timer `09:56 → 09:45` — **kept running server-side** |
| 0 | — | answers persisted across reload |
| 0 | complete session | score panel `"9 / 10"` |

### Scenario 3 — Full mock CBT

| ALOC calls | Step | Observed |
|---|---|---|
| **5** | **CREATE MOCK (180 questions)** | attempt created |
| 2 | ↳ english | `/api/v2/q/40` + `/api/v2/q/20` |
| 1 | ↳ mathematics | `/api/v2/q/40` |
| 1 | ↳ physics | `/api/v2/q/40` |
| 1 | ↳ chemistry | `/api/v2/q/40` |
| **0** | answer 3 questions | autosaved |
| **0** | **Previous then Next** | cursor moved |
| **0** | switch subject tab | moved to 3rd subject |
| **0** | jump via question navigator | jumped to question 12 |
| **0** | **refresh browser** | same attempt resumed, answers persisted |
| **0** | leave and resume via /mock | **same attempt id** |
| **0** | **submit exam** | `"2 of 180 questions were answered."` |
| 0 | verify result page | result rendered |

### Confirmed

```
Total upstream ALOC requests for all three complete scenarios:  6
  practice:create  1
  timed:create     1
  mock:create      5
  everything else  0
```

- Next → **0**  ·  Previous → **0**  ·  answering → **0**  ·  refresh → **0**  ·  submit → **0**
- **Only session creation reaches ALOC.** Confirmed by measurement, not by reading code.
- No browser console errors, no page errors.

### Database verification of the same run

- `exam_attempts`: 1 submitted, `total_questions=180`, **180 frozen `exam_attempt_questions` rows**
- **Grading correct: 0 mismatches** across 20 answered questions — `is_correct` always equalled `selected == correct_option_key`
- **`student_snapshot` keys:** `id, year, topic, assets, prompt, source, options, passage, subject, examBody, difficulty` — **no `correctOptionKey`, no `explanation`.** The `StudentQuestion` boundary holds in real stored data.

Two apparent anomalies were investigated and both were artefacts of my test script, not application defects:

- *"3 answered but only 2 recorded"* — my selector's first click landed on the **flag** button (`selected_option_key: null, is_flagged: true`). Incidentally proved flagging works and that `save_exam_response` stores a flag with a null selection.
- *"10/10 correct from random clicking"* — my stub assigns answers on an `n % 4` cycle and my click loop used `i % 4`; the two aligned. Per-question DB inspection confirmed grading is sound.

One dev-server-only failure was also excluded: Next.js dev mode lost a compiled route from its webpack registry (`Cannot find module for page: …/complete/route`). It did not reproduce on the production build, and all 10 answer saves had already returned HTTP 200.
