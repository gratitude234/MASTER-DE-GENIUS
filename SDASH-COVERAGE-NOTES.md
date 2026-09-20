# WAEC subject coverage — SdashAPI

WAEC grew from **11 to 15 verified subjects** by adding a second question
provider for four science subjects, without replacing ALOC Station and without
a second question architecture.

## Why a second provider

ALOC Station's zero-credit `/subjects` discovery endpoint reports which exams it
holds inventory for per subject. For the sciences it reports **JAMB only**:

| Subject     | Station exams |
|-------------|---------------|
| biology     | jamb          |
| chemistry   | jamb          |
| physics     | jamb          |
| agriculture | not listed    |

So WAEC Biology, Chemistry, Physics and Agricultural Science could not be
offered at all. That is the root cause of the 11-subject ceiling — not a bug in
the product, and not something a different query to Station would fix.

SdashAPI holds WASSCE inventory for all four. Verified live against the Sandbox
credential:

| MASTER slug            | Sdash `subject` | HTTP | `examtype` | `examyear` |
|------------------------|-----------------|------|------------|------------|
| `biology`              | `biology`       | 200  | WASSCE     | 2018       |
| `chemistry`            | `chemistry`     | 200  | WASSCE     | 2012       |
| `physics`              | `physics`       | 200  | WASSCE     | 2025       |
| `agricultural-science` | `agriculture`   | 200  | WASSCE     | 2025       |

## What is deliberately NOT enabled

| Subject              | Why                                                                 |
|----------------------|---------------------------------------------------------------------|
| English Language     | `type=wassce&subject=english` → **HTTP 403**, "This subject is not available for Sandbox testing. Please upgrade to a paid plan to access English." That is a plan restriction, not usable inventory. |
| Further Mathematics  | Absent from the Sdash subject catalogue. No verified source exists.  |
| JAMB via Sdash       | Out of scope. JAMB routing must not change; ALOC Station serves it.  |
| NECO via Sdash       | Out of scope.                                                        |

Both withheld subjects are recorded in
`features/questions/providers/sdash/mapping.ts` under `WITHHELD`, with their
evidence, so the reason survives longer than this file. A withheld subject is
treated exactly like an unmapped one: no request is ever sent for it.

## Provider routing

One authority: `features/questions/routing.ts`.

```
resolveQuestionProviderId(examBody, subjectSlug, explicitProviderId?)

  1. explicit override, when a caller deliberately supplies one
  2. verified exam+subject rule   (WAEC biology/chemistry/physics/agricultural-science → sdash)
  3. QUESTION_PROVIDER, the deployment default  (currently aloc_station)
```

`QUESTION_PROVIDER` is **not** deleted or demoted: it remains the answer for all
of JAMB and for the other eleven WAEC subjects, so nothing that worked before
this release resolves differently. `QUESTION_PROVIDER=sdash` is not a supported
configuration — Sdash maps four subjects of one exam.

Precedence 1 exists so the admin diagnostics panel and the provider probes can
still ask "what would ALOC Station do with WAEC Biology?" and get an honest
answer (it would refuse).

**There is no fallback between providers.** If WAEC Biology resolves to Sdash,
the whole subject session comes from Sdash; a top-up round asks Sdash again. A
shortage is reported honestly rather than filled from another source.

## Availability and UI gating

`isSubjectAvailable(examBody, subjectSlug)` now asks the *resolved* provider two
questions, both of which must pass:

- `supportsSubject` — is this subject mapped? (omitted ⇒ whole catalogue)
- `isConfigured` — does this deployment hold the credentials? (omitted ⇒ assume yes)

Only the Sdash adapter declares `isConfigured`, because it is reached through
routing rather than by someone choosing it. **Without `SDASH_API_KEY`, the four
Sdash-backed WAEC subjects disappear from onboarding and Practice** instead of
being offered and then failing. The ALOC adapters deliberately keep their old
behaviour: a deployment that names one in `QUESTION_PROVIDER` and forgets its key
gets a loud session failure, not a silently empty catalogue.

Both checks are pure lookups. No network call happens on a catalogue render, and
no provider call happens from a client component.

## Route-aware filter capabilities

Practice capabilities used to be a property of the deployment. They are now
resolved per subject (`getPracticeFilterCapabilitiesBySubject`), because one
WAEC screen can hold two providers:

| Subject               | Provider     | Year | Topic | Difficulty |
|-----------------------|--------------|------|-------|------------|
| WAEC Mathematics      | ALOC Station | yes  | no    | no         |
| WAEC Physics (sandbox)| Sdash        | no   | no    | no         |
| WAEC Physics (paid)   | Sdash        | yes  | no    | no         |

Selecting a different subject resets the year, topic and difficulty choices, so
a filter is never carried into a subject that cannot honour it. A filter the
resolved provider cannot honour raises
`QuestionProviderUnsupportedFilterError` **before** the session is frozen — it is
never silently dropped.

## Problem 1 integrity

Sdash flows through the identical pipeline, with no provider-specific shortcut:

- the adapter reuses the shared text cleaner, option/answer resolver and
  instruction-versus-passage classifier from `providers/aloc/normalize.ts`
  rather than carrying a second copy of those rules;
- `checkQuestionIntegrity` runs in `assembleDeliverableQuestions`, the one
  entry point Practice and Mock share, so a Sdash question that says
  "According to the diagram above…" with no image is rejected and replaced
  exactly like an ALOC one;
- nothing is ever repaired or invented: a missing instruction, passage, image,
  explanation, topic or difficulty stays absent, and the integrity validator
  decides whether the question is still deliverable.

Sdash-specific structural rejections (individual records, never a whole batch):
`missing_id`, `empty_prompt`, `too_few_options`, `duplicate_option_key`,
`unresolved_answer`, `invalid_structure`, and `exam_mismatch` — the last guards
against a `type=wassce` request being answered with a UTME record.

## Transport

- `GET {SDASH_BASE_URL}/q?subject=…&type=wassce&year=…&limit=N`
- `AccessToken` **header**. Never `?token=`, never a log line, never a snapshot.
- `limit` 1–50 per the V1 contract; a 20-question session is one call, an
  80-question one is two. Never one call per question.
- 10s timeout, 3 attempts, exponential backoff with jitter. Bounded: at most
  8 upstream calls per provider invocation, and the service allows at most
  3 provider invocations per session.
- Error mapping: 401 → auth; 403 + plan wording → unsupported filter; 403
  otherwise → auth; 429 → rate limit; 5xx → unavailable; **404 → empty result**,
  because "no question matched these filters" is a shortage, not a failure.
- Every attempt writes one `external_api_usage` row: provider, endpoint, exam,
  subject, counts, HTTP status, outcome, duration, and credits when the response
  carries them (null when it does not — never invented). No secret, no question
  text, no answer, no student identity.

## Sandbox vs production

The credential this work was built and verified against is a **Sandbox** one:
2,000 credits, JAMB/WAEC data, V1 only, restricted subject inventory, and **one
examination year per subject**.

The adapter is production-capable. The *plan* is not a production plan, and the
two must not be confused.

`SDASH_SANDBOX` defaults to `true`, which turns the year capability off for the
four routed subjects. A deployment that forgets to set it loses a filter rather
than serving a broken session. It is a deployment setting, not something
detected from a student request, and no plan assumption is written into question
data.

### Stage 1 — verification (this release)

Run with `SDASH_SANDBOX=true` on **Preview/staging or a controlled test
deployment**. That is what the Sandbox plan is for.

**Do not roll the four Sdash-backed subjects out broadly to students on the
Sandbox plan.** 2,000 credits is roughly a hundred 20-question sessions in
total, one year of past questions per subject, and no quota headroom — students
would hit an empty or repetitive pool, and the credits would be gone. Limit
Stage 1 to internal accounts or a small pilot.

### Stage 2 — transition to production Sdash

A separate, deliberate step. Nothing in the code changes:

1. Buy a paid/approved Sdash plan.
2. Replace `SDASH_API_KEY` with the production key and set
   `SDASH_SANDBOX=false`, in the production environment only.
3. **Redeploy** — environment variables are read at deploy time, so a value
   changed in the dashboard has no effect until a new deployment starts.
4. Re-run `npm run sdash:probe -- --confirm-spend` against the production key
   to confirm the four mappings, then confirm year filtering behaves on a paid
   plan before relying on the restored year control.
5. Confirm on `/admin/system` that Sdash reads *configured: yes* and that the
   note no longer says "Sandbox plan assumed".
6. Only then open the four subjects to all students.

### Also gated behind a production plan

- **English Language** — re-probe it; if it returns 200, move `use-of-english`
  out of `WITHHELD` in the Sdash mapping, add the routing rule, and add the
  catalogue row in a new migration. Not before.
- **Credit headroom** — watch `/admin/system`; the ledger records
  `credits_remaining` whenever Sdash returns it, and `null` when it does not.

## Local setup

`.env.local` (git-ignored — never commit it):

```
SDASH_API_KEY=<your sandbox key>
SDASH_BASE_URL=https://sdashapi.com/api/v1
SDASH_SANDBOX=true
```

`npm run sdash:probe -- --confirm-spend` makes **exactly four** requests with
`limit=1` — one per approved subject — prints structural facts only, and reports
what it spent. It refuses to run without the flag. It is deliberately not part
of `npm test`: the normal suite mocks transport and never spends credits.

## Deployment

Order matters, and it is one order, not a choice. **Code first, catalogue
second**, so the database never advertises a subject the deployed code cannot
route.

1. **Configure the environment** — set `SDASH_API_KEY`, `SDASH_BASE_URL` and
   `SDASH_SANDBOX=true` as server-only variables (never `NEXT_PUBLIC_`). Do this
   *before* the deployment starts: with Vercel auto-deploy, a push builds
   immediately, and variables added afterwards are not in that build.
2. **Deploy the code.** Leave `QUESTION_PROVIDER=aloc_station`;
   `QUESTION_PROVIDER=sdash` is not a supported configuration. At this point
   routing and the Sdash adapter exist but no WAEC catalogue row points at them,
   so nothing changes for students.
3. **Verify the deployment is healthy** — `/admin/system` shows Sdash as
   *implemented*, *configured: yes*, with the four routed subjects under
   Coverage; the existing eleven WAEC subjects and all of JAMB still work.
4. **Apply the migration**
   (`20260920090000_waec_science_subject_coverage.sql`). The four subjects
   become selectable, and the code that serves them is already live.
5. **Smoke-test** — onboard a WAEC account, select Biology, run a 20-question
   practice to completion, check the result, review and mistake bank. Repeat for
   Physics. Confirm the year control is absent on those subjects and present on
   Mathematics.

Steps 4 and 5 are the point of no return for students; steps 1–3 are invisible
to them and safe to sit on.

## Rollback

**Environment changes require a new deployment.** Unsetting a variable in a
hosting dashboard does not affect the running deployment — the value was read
when that build was made.

**Fast rollback — disable the provider (keeps the catalogue):**

1. Remove or blank `SDASH_API_KEY` (or otherwise disable the Sdash
   configuration) in the environment.
2. **Redeploy.**
3. On the new deployment, `isConfigured` returns false, so resolved-provider
   availability hides the four Sdash-backed subjects from onboarding and
   Practice. The other eleven WAEC subjects and all of JAMB are untouched.

Frozen sessions are unaffected either way: a snapshot is self-contained, so a
student mid-session keeps their questions, and completed results, reviews and
mistake-bank entries stay readable.

**Code rollback:** revert the commit and redeploy. `QUESTION_PROVIDER` resumes
serving everything exactly as before, and the catalogue rows become unreachable
rather than broken — `isSubjectAvailable` returns false for them under the old
code, so they are hidden.

**Catalogue rollback** — only if the rows must actually go. Forward-only, in a
new migration:

```sql
delete from public.exam_subjects
using public.exam_bodies e, public.subjects s
where exam_subjects.exam_body_id = e.id and e.code = 'waec'
  and exam_subjects.subject_id = s.id
  and s.slug in ('biology','chemistry','physics','agricultural-science');
```

A student who already selected one keeps their `student_subject_preferences`
row; it would fail catalogue validation on their next edit. Prefer the fast
rollback unless the rows genuinely have to be removed.

## Database

`supabase/migrations/20260920090000_waec_science_subject_coverage.sql` is
forward-only and idempotent. It adds **four `exam_subjects` relationships** for
WAEC and nothing else — the four subject rows already exist from the M1
catalogue seed. No subject is marked compulsory, so every stored WAEC selection
stays valid and students can add the new subjects by editing their preparation.

Final WAEC catalogue (15):

| # | Subject | Provider |
|---|---------|----------|
| 1 | Mathematics | ALOC Station |
| 2 | Biology | Sdash |
| 3 | Chemistry | Sdash |
| 4 | Physics | Sdash |
| 5 | Agricultural Science | Sdash |
| 6 | Economics | ALOC Station |
| 7 | Government | ALOC Station |
| 8 | Commerce | ALOC Station |
| 9 | Literature in English | ALOC Station |
| 10 | Principles of Accounts | ALOC Station |
| 11 | Geography | ALOC Station |
| 12 | Christian Religious Studies | ALOC Station |
| 13 | Civic Education | ALOC Station |
| 14 | History | ALOC Station |
| 15 | Insurance | ALOC Station |

The sciences sit behind Mathematics so a science candidate does not scroll past
eleven commercial and arts subjects. JAMB's catalogue is untouched.
