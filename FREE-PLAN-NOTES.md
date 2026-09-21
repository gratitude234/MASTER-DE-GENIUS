# The Free plan — quotas, conversion and the student dashboard

> **No migration accompanies this release, and none is required.** Practice now counts new sessions
> through `reserve_product_quota`, which has existed since
> `20260908060000_m9_billing_and_entitlements.sql`, and the usage summary reads
> `product_quota_usage` / `ai_quota_usage` from
> `20260921100000_free_plan_conversion_quotas.sql`. Both are already applied anywhere that ran the
> previous release. Read alongside [MONETIZATION-NOTES.md](MONETIZATION-NOTES.md).

This supersedes the short-lived per-question Free meter ("4 practice questions a day"), which is
**cancelled**. Nothing in the product counts practice questions any more.

## 1. Policy

| | Free | Master (unchanged) |
| --- | --- | --- |
| Practice | **1 new session / day**, up to **20 questions** | 200 sessions / day, up to 40 questions |
| Full mocks | **2 / calendar month** | 3 / day |
| New MASTER AI explanations | **2 / day** | 20 / day |

All allowances are **account-wide** — never per subject, exam body, device, browser, tab or
session — and reset on the **Africa/Lagos (WAT, UTC+1, no DST)** calendar: days at 00:00 WAT
(23:00Z), months on the 1st at 00:00 WAT. A student preparing for both JAMB and WAEC gets one
practice session a day, not two.

Free keeps: account and profile, onboarding, exam and subject selection, the dashboard, results and
scores, correct-answer review, standard explanations, result history, the mistake bank, progress,
billing and payment history, Need Help, Request a Class, WhatsApp/contact, Explore Classes, and
previously generated explanations.

## 2. Source of truth

`features/billing/plans.ts` → `TIER_LIMITS`. Nothing else in the product holds a plan number.

```ts
free:   { practice: { sessionsPerDay: 1,   maxQuestionsPerSession: 20 }, mockAttempts: 2, mockAttemptWindow: "month", aiExplanationsPerDay: 2 }
master: { practice: { sessionsPerDay: 200, maxQuestionsPerSession: 40 }, mockAttempts: 3, mockAttemptWindow: "day",   aiExplanationsPerDay: 20 }
```

`PRACTICE_MAX_QUESTIONS` (40) is *derived* from that table and is the only ceiling request
validation knows; the student's own ceiling is their plan's `maxQuestionsPerSession`, applied on the
server. `practice.unit` and `practice.perDay` are gone, and no route branches on a tier name.

Copy is written once in `features/billing/copy.ts`; prices are only ever read from `BILLING_PLANS`.

## 3. Exact consumption semantics

### Practice — when today's session is used

**One practice session is used when a new session row is successfully created**, and at no other
moment. The allowance is reserved in `app/api/practice/sessions/route.ts` *before* the question
provider is contacted, and **committed only once `createPracticeSessionForUser` has returned a
session id**.

It is **not** used for:

- opening the Practice setup page, or changing subject, topic, year or difficulty;
- a failed creation (provider outage, no matching questions, a database error) — the reservation is
  released immediately, so the student can retry at once;
- a duplicate or retried POST — `claimCreation` returns the first session and the second
  reservation is released;
- **resuming** a session, refreshing, closing the browser and returning, or opening it on a second
  device;
- answering, re-answering, or submitting;
- finishing the session;
- viewing the result, reviewing answers, or reading the mistake bank;
- a request the abuse limiter rejects — that runs first and costs no product quota.

**Answering is never metered, on any tier.** `savePracticeAnswerForUser` takes no meter and calls
the unchanged `save_response_v2`. A student who started a session always finishes it — across a
refresh, a reconnect, a second device, and midnight.

**Opening a session is never gated.** `loadPracticeSessionForUser` delivers the whole paper. The
per-question delivery gate (`lockBeyondAllowance`, `locked`, `held`) is deleted.

**Session size.** The server clamps `count` to the plan's `maxQuestionsPerSession` before any
question is fetched, so a crafted `count: 40` from a Free browser builds the 20 the plan allows
rather than being refused. The setup screen only offers sizes the plan can build — 10 and 20 on
Free, 10/20/30/40 on Master.

**Every entry point shares the one allowance.** Practice, Past Questions (`/api/practice/sessions`
with a year) and revision (`/api/progress/practice`, from a result or the mistake bank) all reserve
the same `practice_session` capability for the same day.

### Active and completed session behaviour

When the day is spent, the refusal depends on whether the session is still open —
`getActivePracticeSessionForUser` answers that account-wide, ignoring expired sessions:

| State | Message | Primary action | Secondary |
| --- | --- | --- | --- |
| Session in progress | "Today's practice session is already in progress." | **Resume session** | Upgrade to Master |
| Session finished | "You've used today's free practice session." | **Upgrade to Master** | — |

Both are `402 PLAN_LIMIT`. The in-progress body carries `limit.resumeSessionId` and
`activeSession`, so the browser can offer Resume without a second request, and the upgrade source is
`practice_session_in_progress` rather than `practice_exhausted`. The student is **never** blocked
from finishing a session they have started.

### Mocks

A mock counts once, when a **new attempt is created** (`POST /api/exam/attempts` → the attempt is
created `in_progress` and the timer starts). Reserve before the paper is built; commit only for a
new attempt; release for a resume, a duplicate or a failure. Visiting Mock, the setup page,
refreshing, reconnecting, and opening a result or review never count, and **a student with 0 left
can always resume the attempt already in progress**. Unchanged by this release.

### MASTER AI

Charged only when a **new** explanation is generated (`consume_ai_daily_quota`, before the provider
call). Never charged for a cache hit, a retry after success (cache hit), a request while the same
explanation is generating (409), or an explanation the student already received — a per-student
receipt (`ai_explanation_receipts`) makes regeneration after the 48-hour cache expiry free for them.
A failed generation is refunded (`refund_ai_daily_quota`) only if it was charged. Unchanged by this
release.

## 4. Concurrency and idempotency

Every limit is enforced server-side; the client UI is not security. `reserve_product_quota` takes a
`for update` row lock on the student's `(user_id, capability, window_key)` anchor **before** it
counts, so concurrent requests landing on different serverless instances serialise there.

| Race | Guarantee |
| --- | --- |
| Two tabs start a practice session | Exactly one reservation is allowed; the other gets 402 with the in-progress or exhausted state. |
| A tab on Practice and a tab on the mistake bank | Same capability, same lock — one session, not two. |
| Replayed / double-submitted create | `claimCreation` returns the first session; the second reservation is released. |
| Provider fails mid-create | Reservation released; the day is immediately available again. |
| Process dies between reserve and create | The 120-second lease expires and the reservation stops counting. |
| Midnight between two requests | The window key is the Lagos day; the lock is per account, not per day. |
| Second vs third Free mock | Same window lock; exactly one reservation. |
| Last AI explanation | `consume_ai_daily_quota` is one conditional upsert. |

`tests/free-plan-quota-database.test.mjs` proves these against the real migrations in PGlite; the
route tests prove no handler has a path around the lock.

## 5. Authoritative usage summary

`features/billing/usage.ts` → `getUsageSummary(userId)` is the one view model every screen reads:

```ts
{
  tier, isMaster, masterUntil,
  practice: { limit, used, remaining, resetAt, window: "day",
              maxQuestionsPerSession, activeSession },
  mocks:    { limit, used, remaining, resetAt, window },
  aiExplanations: { limit, used, remaining, resetAt, window: "day" },
}
```

Counts come from `product_quota_usage` and `ai_quota_usage` — read-only functions over the same
reservations the routes enforce against. **No component computes a quota.** A count that cannot be
read is `null`, and the screen then shows the allowance without claiming what is left of it
("Up to 1 session a day"), never a guess and never a zero.

`activeSession` comes from `features/practice/active-session.ts`: an account-wide read of the
student's unfinished, unexpired practice session. It is what turns "used" into "in progress".

## 6. Legacy and active-session compatibility

- **Completed sessions are never touched.** No row is deleted, rewritten or re-scored.
- **A session created under the old per-question plan opens in full.** Its
  `practice_question_usage` rows still exist and are simply never read. Every question in it is
  delivered and answerable, and finishing it produces the result it always would have.
- **Resuming a legacy session does not consume a session**, and holding one does not consume today's
  allowance either — an old paper and today's slot are independent.
- Sessions built under the old plan were sized to at most four questions for a Free student, so this
  is more generous than the plan they were issued under, and bounded: no new ones can be created.
- `practice_question_usage` and `ai_explanation_receipts` are retained as usage history. The
  per-question SQL functions are retained, unused, and still unreachable from browser roles.

## 7. Where "Upgrade to Master" appears

All go to **`/pricing?source=<source>#plans`** — the plan cards — through one component,
`components/billing/upgrade-link.tsx`. No component hard-codes a `/pricing` link.

| Location | Source |
| --- | --- |
| Desktop rail (Free plan card above the exam card) | `nav` |
| Phone strip above every major page (hidden on /home, in a running session, on /pricing and /billing) | `nav_mobile` |
| **Dashboard header, beside the welcome** | `dashboard` |
| **Dashboard compact Free plan card** | `dashboard` |
| Practice setup: exhausted | `practice_exhausted` |
| Practice setup / refusal: today's session still running | `practice_session_in_progress` |
| Mock setup: 1 left, exhausted | `mock_one_remaining`, `mock_exhausted` |
| MASTER AI panel: 1 left, exhausted | `ai_one_remaining`, `ai_exhausted` |
| Results page | `results` |
| Mistake bank (one quiet line) | `mistakes` |
| Profile plan card / Billing current-plan card | `me`, `billing` |

The dashboard shows **exactly two**: the header button and the one in the compact plan card. The
phone strip stands down on `/home` precisely so there is no third. Master students see no sales
prompt anywhere — the header shows "Master · until <date>" instead.

`practice_one_remaining` is removed from `UPGRADE_SOURCES`; nothing emits it.

## 8. The dashboard

**Before**, top to bottom: phone upgrade strip → welcome → full-width Free Plan panel with its own
price line → active exam card → dark full-bleed recommendation hero → quick actions → tutoring card
→ Latest Mock card + Mistakes Ready card → Subject Performance card + Weak Areas card → saved
sessions. Three upgrade prompts and four statistics cards, with the student's own unfinished exam
below two of them.

**After**, the agreed priority:

1. **Header** — "Welcome back, <name>", the exam label, a small `Free plan` badge, and one
   `Upgrade to Master` (or the Master status). No second banner beneath it.
2. **Resume active work** — `ResumeCard`, only when there is unfinished work. One item, chosen by
   `features/home/resume.ts`: a running mock outranks a practice session, because the mock is timed
   and expires. Never two resume cards for one session.
3. **Continue learning** — one `ContinueLearningCard` from the existing `recommendPractice`, or
   nothing. A student with no history gets a single-line `StartPracticeCard` instead.
4. **Quick actions** — a 2×2 phone grid: Practice · Full Mock (Timed Subject on WAEC) ·
   Past Questions · Mistakes, each straight to its destination.
5. **Compact Free plan usage** — three rows and one button. Practice reads as a state
   ("1 practice session available today" / "Session in progress" / "Today's session used"), with a
   Resume link when there is something to resume. Free only.
6. **Progress** — one `ProgressSummaryCard` combining the latest mock, mistakes to review and the
   weakest subject, with "View progress". A metric with no data is omitted, never shown as a zero.
7. **Tutoring / support** — below everything a student studies with, and only when there is a real
   recommendation.

**Components removed**, consolidated into the above: `components/home/active-exam-card.tsx`,
`recommended-practice-card.tsx`, `latest-mock-card.tsx`, `mistakes-card.tsx`, `weak-areas-card.tsx`.
`subject-performance.tsx` stays — `/progress` still uses it.

**Mobile.** Single column, the shell's 16px gutters, no horizontal overflow, no hover-only
interaction, `min-h-11` tap targets, one `<h1>` with `<h2>` section headings, and `aria-label`s on
the regions that have no visible title.

## 9. Analytics

Vendor-neutral seam (`features/analytics/events.ts`), no new vendor: `upgrade_cta_clicked`
`{source}`, `upgrade_pricing_viewed` `{source}`, `upgrade_checkout_started` `{plan, source}`.
`source` is validated against `UPGRADE_SOURCES` (`parseUpgradeSource`); nothing personal is sent.

## 10. Deployment

1. **Deploy the application.** There is no migration step.
2. Smoke test on a Free account: the dashboard reads "1 practice session available today",
   "2 of 2 remaining this month" and "2 of 2 remaining today"; starting a 20-question session flips
   Practice to "Session in progress" with a Resume link; a second new session is refused with the
   Resume card; finishing it flips Practice to "Today's session used". On Master: no prompts,
   practice sizes 10–40.

If the previous release's migration (`20260921100000_free_plan_conversion_quotas.sql`) has somehow
not been applied, apply it first — `product_quota_usage` and `ai_quota_usage` come from it. Without
them the usage summary fails soft, showing "Up to …" rather than live counts; enforcement is
unaffected, because that goes through `reserve_product_quota`.

## 11. Rollback

**Configuration rollback (preferred; no data change, no schema change).** Raise the Free numbers in
`features/billing/plans.ts`:

```ts
free: { practice: { sessionsPerDay: 3, maxQuestionsPerSession: 40 }, mockAttempts: 2, mockAttemptWindow: "month", aiExplanationsPerDay: 2 },
```

and redeploy. Nothing branches on a tier name or a counting unit, so every screen, message and
refusal follows the new numbers with no other change — `tests/free-plan-ui.test.mjs` asserts exactly
this. Usage history, entitlements, payments, active sessions and active mocks are untouched.

**Full code rollback.** Revert the release commit and redeploy. The previous release's metered
functions were never dropped, so the per-question plan resumes immediately. Two things to know:
sessions created while this release was live hold nothing in `practice_question_usage`, so the old
build treats them as legacy papers — it delivers up to that day's `available` unanswered questions
per session, which is the behaviour it was written for; and `product_usage_reservations` will hold
`practice_session` rows for Free students, which the old build ignores.

## 12. Known limitations

- A legacy Free session from the per-question era can now be answered in full rather than four
  questions a day. Those papers were at most four questions each, so the exposure is small and
  bounded — no new ones can be created.
- `getActivePracticeSessionForUser` reads the five most recently updated in-progress sessions and
  takes the first unexpired one. A student holding more than five simultaneously expired sessions
  would see "used" rather than "in progress"; they can still resume from Practice, whose own resume
  card is unaffected.
- PGlite runs the database tests on one connection: races are proven atomic per call, and the
  row-lock ordering is asserted structurally. Run the concurrency cases against a real Postgres
  before scale.
- The analytics sink is still not installed (existing seam); events are no-ops until it is.
- The dashboard's progress card shows one subject — the weakest in the latest attempt. The full
  per-subject breakdown is one tap away on `/progress`, where it always was.
- Copy uses the app's typographic apostrophe (’) — wording matches the product brief exactly.
