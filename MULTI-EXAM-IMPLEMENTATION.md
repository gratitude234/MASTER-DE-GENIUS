# Multi-Exam Preparation — implementation report

## 1. Architecture

One account can maintain active JAMB and WAEC preparations. Each preference owns its year, target, course, intensity and subject links. `is_primary` now represents the default workspace. An account-bound, HTTP-only session cookie represents the temporary active workspace. Explicit practice and tutoring context takes precedence over the cookie; the default is the fallback. Missing preferences lead to setup. Unsupported or unowned explicit exams are rejected.

The shared domain lives in `features/exam-context/`. Its database reads fetch all active preferences together and are memoized within a React render request. No global state library or duplicated subscription model was added. Additional exam bodies can use the same relational model when their catalogues and engines are ready; NECO remains unavailable.

## 2. Database

Migration: `supabase/migrations/20260915055639_multi_exam_preparation.sql`.

- Adds `student_exam_preferences.is_active`, preserving the existing `(user_id, exam_body_id, exam_year)` uniqueness.
- Adds one-active-preference-per-account-and-exam partial uniqueness.
- Retains the one-default-per-account index and requires the default to be active.
- Archives superseded years deterministically, preferring the existing default; no historical attempts, results or old subject links are deleted.
- Repairs existing accounts that have preferences but no default.
- Adds `save_exam_preparations(jsonb, text)`: one transaction for both configurations and the chosen default. A profile-row lock serializes concurrent configuration saves. Any invalid configuration rolls back the entire save.
- Updates the existing onboarding RPC with the same lock, required-field checks and year archival. Retains the legacy JAMB RPC as a validated wrapper.
- Retains owner-only SELECT policies. Removes direct client preference/subject mutation policies so writes go through validated RPCs. Anonymous roles cannot call the new save RPC.
- Updates admin exam counts to count active preparations and student exam filters to match any active preparation. Students preparing for both are counted in each exam category; those categories should not be summed as distinct students.

Apply the migration before deploying the new application. Existing installations must already have the preceding migrations. The new migration is tracked and applied once using normal Supabase migration history. It has been exercised against PostgreSQL via PGlite, not applied to a remote database.

## 3. Student experience

Onboarding offers multi-select exam cards and separate subject, year, target, course and intensity controls. At least one exam is required. Dual-exam students explicitly choose the default. Existing settings prefill both configurations; existing preparations remain selected because removal is intentionally unavailable.

The student shell displays the current exam and provides a switcher for dual-exam students. Switching saves the temporary context and takes the student to the chosen exam's home page without changing the default. The switcher is hidden in frozen sessions and historical result views. Profile lists all preparations, marks the default and links to configuration editing/addition. Home identifies dual-exam preparation while showing only the active exam's recommendations and learning figures.

## 4. Services and audit findings

| Area | Previous assumption / finding | Implemented behavior |
| --- | --- | --- |
| Onboarding | Saved one exam and loaded only primary | Atomic multi-exam save; bounded reads of all active configurations and subject links |
| Profile / shell | Loaded primary for every workspace | Shared active resolver; full list in management |
| Practice catalogue | Loaded primary preference | Active preference owns catalogue and subject selection |
| Practice creation | Inferred primary, omitted exam from duplicate key | Explicit validated exam in UI/API, ownership checks, exam in creation fingerprint |
| Resume | Latest active practice could belong to another exam | Resume lookup filters active exam |
| Mock / timed | Mock service loaded primary | JAMB mock service explicitly resolves owned JAMB; WAEC workspace retains timed subject practice |
| Progress | Aggregated all exams by subject slug | Filter history by active exam before all summaries, subjects and tutoring recommendations |
| Mistake bank | All history; revision chose an exam from available mistakes | Active-exam history and explicit revision exam; original-result revision retains original exam |
| Home recommendations | Recommendations already accepted exam IDs; mistake count was global | Active exam drives existing recommendation functions and mistake count |
| Results | Target lookup also required primary | Uses result exam identity, preferring active/latest matching preference |
| AI explanations | Already uses actual frozen question exam context | Preserved; no change to AI generation, answer authority or caches |
| Master Classes | Deep-link exam ignored by page | Explicit linked exam resolves the class catalogue and recommendation; lead creation verifies active ownership; request history labels exam |
| Admin | Default-only preparation; some academic aggregates crossed exams | All active preparations/subjects, per-exam academic summaries, default-marked list and any-active-exam filtering |
| Product events | Existing provider requests, sessions and leads already hold exam context | Preserved event schemas; no new analytics transport; practice identity now distinguishes exams |
| Billing | Account-scoped entitlement and quota system | Unchanged account limits and subscription/payment authority |
| RLS / RPCs | Owner writes could bypass configuration validation | Reads remain owner-only; configuration mutations use authenticated, locked RPCs |
| Offline / grading | Frozen attempt identity authoritative | Timer, answer queue, recovery and grading code unchanged |

The remaining primary-only query in admin detail intentionally supplies the explicitly labelled **default preparation** section. It is supplemented by all-preparation views and is not an access gate. No exam type named `both` was introduced.

## 5. Admin

Student lists show all active exam/year labels and identify the default. Filtering by WAEC includes students whose default is JAMB. Detail pages show subjects, targets, question totals, accuracy and mistakes separately for each exam. The existing default-exam detail remains for continuity. RBAC and audit logging are preserved; no new administrative mutation endpoint was introduced.

## 6. Compatibility

Existing users keep their profiles and onboarding-completed flag. Existing defaults are retained, and single-exam users continue to use that exam. Old practice callers that omit an exam resolve an owned active/default context before creation and idempotency calculation. Frozen attempts, historical result revision, subscriptions, quotas and payments retain their existing identity. Password login and sign-out clear the temporary exam cookie.

## 7. Security

The server resolves requested exams against the account's active preferences, checks active catalogue entries and validates selected subjects before contacting a question provider. Both onboarding configurations are checked inside SQL, including exam support, year and target bounds, subject count, uniqueness, compulsory subjects and catalogue membership. The client cannot choose another user ID. Answer-key separation, service-role isolation, quota reservation/refund and existing admin permissions remain intact.

## 8. Verification

213 checks passed across the two offline verification groups:

- 136 checks: new multi-exam domain, database, rendered UI and practice-service tests; existing onboarding, authentication, admin logic, grading, home, progress, result authority, practice UI and billing enforcement tests.
- 77 checks: admin/database permissions, billing database behavior, offline database/queue behavior, timed answer protection and engine integrity guards.
- The migration tests also passed again after adding the missing-default repair.
- TypeScript, ESLint and the final production build all passed.

Reproduce the verified offline groups with `npm run test:offline`. The new test command uses explicit test files that use local databases or mocked service boundaries. No real AI provider is contacted by those groups.

New tests: `multi-exam.test.mjs`, `multi-exam-practice.test.mjs`, `multi-exam-ui.test.mjs`. Existing rendering/auth/API test fixtures were updated for the new dependencies; their assertions were retained. The engine hash manifest was updated for the eight reviewed scope-related changes, retaining all guarded files. Billing, timer, grading and offline engine implementations were not changed.

The original full `npm test` attempt was blocked by automatic approval review because the full suite may contact Gemini with prompts or project-derived data. It was not retried through a bypass. The explicitly offline groups were run instead. This report does not claim that the entire API-connected suite passed.

## 9. Limitations and deployment checks

- Exam removal is intentionally unavailable. Editing a year archives the previous preference; it does not delete academic history.
- There is one active year per exam. Multiple simultaneous years of the same exam are not a UI feature.
- WAEC retains the existing verified subject catalogue and objective/timed engine; this does not add unverified Physics/English coverage or a full WAEC mock blueprint.
- The switcher opens Home after changing exam. Result pages retain their own attempt context. A class deep link uses its explicit exam without overwriting the student's temporary/default workspace.
- No remote database credentials or authenticated student browser session were provided. Live sign-in, provider requests, Paystack flows and mobile browser interaction still need a staging acceptance pass. Rendered UI tests do not replace that live pass.
- The existing result model does not snapshot a historical target. Result target display uses the active/latest preference for that result's exam body.
- The existing `loadHistory` implementation still loads graded attempts in bounded batches. This enhancement reuses it; it does not rebuild historical analytics storage.
- No production deployment or remote database advisor run was performed.

Recommended staging acceptance: apply the migration, sign in as an existing JAMB student, add WAEC, switch both ways, complete one session in each exam, confirm distinct progress/mistakes and a single shared quota, open an old result and its tutoring link, then inspect both preparations from an appropriately authorized admin account.
