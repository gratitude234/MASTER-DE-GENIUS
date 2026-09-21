# Free plan v2 — Free-to-Master conversion

> **Apply `supabase/migrations/20260921100000_free_plan_conversion_quotas.sql` before deploying
> this release.** Free practice creation, Free answers and the usage summary call functions it
> creates. It is additive and safe to re-run. Read alongside [MONETIZATION-NOTES.md](MONETIZATION-NOTES.md).

## 1. Policy

| | Free | Master (unchanged) |
| --- | --- | --- |
| Practice | **4 questions / day** | 200 sessions / day |
| Full mocks | **2 / calendar month** | 3 / day |
| New MASTER AI explanations | **2 / day** | 20 / day |

All allowances are **account-wide** — never per subject, exam body, device, browser or session —
and reset on the **Africa/Lagos (WAT, UTC+1, no DST)** calendar: days at 00:00 WAT (23:00Z),
months on the 1st at 00:00 WAT. This replaced UTC for *every* quota, Master's included (a shift of
one hour; no allowance was reduced).

Free keeps: results and scores, correct-answer review, standard explanations, result history,
mistake bank reading, progress, billing and payment history, Need Help, Request a Class,
WhatsApp/contact, Explore Classes, onboarding and multi-exam setup.

## 2. Source of truth

`features/billing/plans.ts` → `TIER_LIMITS`. Nothing else holds a number.

```ts
free:   { practice: { unit: "question", perDay: 4 }, mockAttempts: 2, mockAttemptWindow: "month", aiExplanationsPerDay: 2 }
master: { practice: { unit: "session",  perDay: 200 }, mockAttempts: 3, mockAttemptWindow: "day",   aiExplanationsPerDay: 20 }
```

`practiceSessionsPerDay` is gone. `practice.unit` decides the mechanism: every route branches on the
unit, never on the tier name. Copy is written once in `features/billing/copy.ts`; prices are only
ever read from `BILLING_PLANS`.

## 3. Exact consumption semantics

### Practice (Free)

**One practice question is used** when the student submits the *first* answer to a question in a
practice session — or finishes that session with the question held and unanswered (see "holds").

- Charged in the same database transaction as the answer (`save_metered_practice_response`): a
  refused charge writes no answer; a refused answer (time up, session finished, stale revision,
  not their session) charges nothing.
- Never charged for: opening setup or a session, refreshing, retries of the same mutation, a second
  tap, changing a timed answer, reviewing, results, the mistake bank, stored explanations, mock
  questions, admin actions, or a question answered before this release.
- **Holds.** A Free session is built by `create_metered_practice_session`, which refuses (under a
  per-student lock) any paper larger than `available`, and marks each question `held`. A held
  question is part of the allowance already, so it is always answerable. A new session can be at
  most `available = limit − used − waiting` questions, so a Free browser never receives more new
  questions than the student may answer.
- **Finishing early.** Held questions left unanswered when the session is finished still count:
  finishing reveals every answer and explanation in the results, so releasing them would make
  "start, finish, read the answers, repeat" an unlimited free engine. The runner says so before the
  student taps Finish.
- **Carried questions.** Held questions from an earlier day in a live session stay answerable and
  reserve today's allowance (they move to today's window when answered).
- **Revision** (practising from results or the mistake bank) creates a genuinely new attempt, so it
  is sized to `available` and held like any other Free session. Reading never counts.
- **Past Questions** is the same endpoint (`/api/practice/sessions` with a year), so it shares the
  one allowance. JAMB and WAEC share it too.

Student-facing numbers (`practice_question_allowance`): `used` (answered + finished-unanswered
today), `waiting` (held, still answerable), `remaining = 4 − used`, `available = remaining − waiting`.

### Legacy and Master-era sessions

A session built before this release (or while the student had Master) holds nothing. For a Free
student its unanswered questions are charged at answer time from today's allowance. When the
session is loaded (`loadPracticeSessionForUser`, used by the session page *and* the offline copy),
only the first `available` unheld unanswered questions are delivered; the rest are replaced on the
server with an empty placeholder (`locked: true`) — the stem, options, passage and media never reach
the browser. Answered questions are always shown. Nothing is mutated: the frozen snapshot, answers
and score are untouched; tomorrow's allowance or Master delivers more.

### Mocks

A mock counts once, when a **new attempt is created** (`POST /api/exam/attempts` → the attempt is
created `in_progress` and the timer starts). Reserve before the paper is built, commit only for a
new attempt, release for a resume, a duplicate or a failure. Resume, refresh, reconnect and
duplicate starts never count, and **a student with 0 left can always resume the attempt already in
progress** (fixed in this release: the refusal path now checks for a live attempt first).

### MASTER AI

Charged only when a **new** explanation is generated (`consume_ai_daily_quota`, before the provider
call). Never charged for a cache hit, a retry after success (cache hit), a request while the same
explanation is generating (409), or an explanation the student already received — a per-student
receipt (`ai_explanation_receipts`) makes regeneration after the 48-hour cache expiry free for them.
A failed generation is refunded (`refund_ai_daily_quota`) only if it was charged.

## 4. Concurrency and idempotency

| Race | Guarantee |
| --- | --- |
| Two tabs answer the last free question | Both serialise on the per-student ledger row lock; exactly one is charged, the other gets 402 and no answer is written. |
| Two tabs start sessions for the last questions | Same lock in `create_metered_practice_session`; one paper is built. |
| Replayed / retried answer | Question already answered → no charge; `save_response_v2` returns the stored receipt. |
| Midnight between two requests | The ledger lock is per account, not per day. |
| Last Free mock | `reserve_product_quota` window lock; exactly one reservation. |
| Last AI explanation | `consume_ai_daily_quota` is one conditional upsert. |
| Offline queue receives 402 | `DurableQueue` drops that answer, reverts it to unanswered and keeps draining; "Finish" is never blocked. |

Lock order on every metered path: ledger anchor, then the session row (inside `save_response_v2`).

## 5. Where "Upgrade to Master" appears

All go to **`/pricing?source=<source>#plans`** — the plan cards — through one component,
`components/billing/upgrade-link.tsx`.

| Location | Source |
| --- | --- |
| Desktop rail (Free plan card above the exam card) | `nav` |
| Phone strip above every major page (hidden in a running session and on /pricing, /billing) | `nav_mobile` |
| Home: Free Plan card near the top | `dashboard` |
| Practice setup / runner: 1 left, exhausted, locked question | `practice_one_remaining`, `practice_exhausted` |
| Mock setup: 1 left, exhausted | `mock_one_remaining`, `mock_exhausted` |
| MASTER AI panel: 1 left, exhausted | `ai_one_remaining`, `ai_exhausted` |
| Results page (after the result) | `results` |
| Mistake bank (one quiet line) | `mistakes` |
| Profile plan card / Billing current-plan card | `me`, `billing` |

Master students see no sales prompt: the rail shows "Master plan · Access until …".

After a Paystack payment settles on the callback page, `router.refresh()` re-renders the shell so the
prompt disappears without a sign-out. Every route resolves the entitlement per request, so Master
limits apply on the very next request.

## 6. Analytics

Vendor-neutral seam (`features/analytics/events.ts`), no new vendor: `upgrade_cta_clicked`
`{source}`, `upgrade_pricing_viewed` `{source}`, `upgrade_checkout_started` `{plan, source}`.
`source` is validated against a fixed list (`parseUpgradeSource`); nothing personal is sent. The
checkout request body is unchanged (`{ planSlug }`).

## 7. Database changes (`20260921100000_free_plan_conversion_quotas.sql`)

- `practice_question_usage` — the Free ledger; PK `session_question_id` (charged at most once);
  states `held` / `used`; RLS on, no browser grants, no FK to session tables (history outlives them).
- `ai_explanation_receipts` — `(user_id, cache_key)`; hashed keys only.
- `product_usage_windows` capability check widened to `practice_question` (per-account lock anchor).
- New `SECURITY DEFINER`, `search_path=''`, service-role-only functions: `product_quota_day`,
  `practice_question_allowance`, `create_metered_practice_session`, `save_metered_practice_response`,
  `product_quota_usage`, `ai_quota_usage` (+ internal helpers).
- `consume_ai_daily_quota` / `refund_ai_daily_quota` redefined with **the same signatures**, counting
  on the Lagos day. `create_practice_session`, `save_response_v2`, `save_practice_answer`,
  `complete_practice_session` and every exam function are unchanged.

## 8. Deployment order

1. Apply the migration (`supabase db push`, or paste it into the SQL editor). It is safe on a live
   database and safe to re-run.
2. Deploy the application.
3. Smoke test with a Free account: dashboard shows 4/2/2; start a 4-question session; answer; a 5th is
   refused. With a Master account: no prompts, practice sizes 10–40.

Deploying the app first would fail Free session creation and Free answers (the new functions are
missing) — the refusal is fail-closed. Deploying the migration first is harmless: the old app never
calls the new functions, and the two redefined AI functions keep their contract.

## 9. Rollback

**Configuration rollback (preferred, no data change).** Restore the previous Free limits in
`features/billing/plans.ts`:

```ts
free: { practice: { unit: "session", perDay: 20 }, mockAttempts: 1, mockAttemptWindow: "month", aiExplanationsPerDay: 3 },
```

and redeploy. With `unit: "session"` every practice route takes the old session-reservation path;
no metered function is called, no question is gated, and the ledger simply stops growing. Usage
history, entitlements, payments, active practice sessions and active mocks are untouched. Two
effects to know:

- Windows stay on WAT (the old app was UTC). If UTC is required, revert `quotaWindow` in
  `features/billing/quota.ts` and restore the M9b bodies of the two AI functions (their original
  text is in `20260908040000_ai_question_explanations.sql` / `20260908090000_m9b_ai_quota_refund.sql`).
- A Free student who used 2 mocks this month would have 0 left under a 1-mock rollback until the
  month turns; nothing is lost.

**Full code rollback.** Revert the release commit and redeploy. The migration can stay applied —
nothing in it runs unless called. Only if the objects must be removed:

```sql
drop function if exists public.save_metered_practice_response(uuid,uuid,uuid,text,integer,uuid,text,integer);
drop function if exists public.create_metered_practice_session(uuid,uuid,uuid,uuid,public.practice_mode,public.question_difficulty,integer,integer,text,integer,jsonb,text,integer);
drop function if exists public.practice_question_allowance(uuid,text,integer);
drop function if exists public.product_quota_usage(uuid,text,text);
drop function if exists public.ai_quota_usage(uuid,text);
-- keep practice_question_usage and ai_explanation_receipts: they are usage history.
```

Do not drop `product_quota_day` without first restoring the old AI function bodies — they call it.

## 10. Known limitations

- A legacy (pre-release) Free session can still be **finished**, and its results show every
  question's answer, including locked ones. Those papers were issued under the old plan; blocking
  their completion would strand results. New Free sessions cannot do this (everything they contain
  is held and counted).
- Each legacy session reveals up to today's `available` unanswered questions on load, so a student
  with several legacy sessions can see that many per session (bounded; no new legacy sessions can
  be created).
- PGlite runs the database tests on one connection: races are proven atomic per call; the row-lock
  ordering is asserted structurally. Run the concurrency cases against a real Postgres before scale.
- The analytics sink is still not installed (existing seam); events are no-ops until it is.
- Copy uses the app's typographic apostrophe (’) — wording matches the product brief exactly.
