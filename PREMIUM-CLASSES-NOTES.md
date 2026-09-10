# Premium Classes, Academic Support and Site-Wide Contact — Phase 1

## Existing architecture found

Master De Genius is a Next.js 15 App Router application using TypeScript, React 19, Tailwind, Supabase SSR, server-only service modules, hand-maintained Supabase database types, SQL migrations with RLS, and `node:test`. Student routes share `app/(student)/layout.tsx` and `StudentShell`; live full mocks use the separate `app/exam` layout. Completed attempts are converted into provider-neutral `LearningResult` values by `features/results/service.ts`. The existing weak-performance threshold is 70% in `features/home/recommendation.ts`. Abuse protection uses an atomic Postgres token bucket through `lib/rate-limit.ts`.

There was no admin-role store, CRM, support system, contact configuration, or analytics event infrastructure. Phase 1 therefore adds a minimal database admin allowlist and does not introduce an analytics vendor.

## What was implemented

- A student-facing **Master Classes** area at `/classes`.
- A public Premium Classes page at `/premium-classes`.
- A permanent **Need Help?** floating control and accessible support sheet.
- Contextual tutoring prompts on Home, Progress, Results, and Mistake Bank.
- A provider-independent recommendation service.
- A request-class flow with known profile and academic context prefilled.
- Recent request history with student-friendly status labels.
- A server-authorized admin CRM at `/admin/classes`.
- Safe student and admin WhatsApp click-to-chat links.
- Optional, separate WhatsApp/email promotional consent evidence.
- Rate limiting and atomic 24-hour duplicate suppression.
- Automated tests for recommendation priority, visibility, context preservation, validation, WhatsApp privacy, RLS posture, deduplication, and admin authorization order.

## Permanent CTA behaviour

`components/support/support-hub.tsx` is mounted once by `StudentShell`, rather than copied into pages. It uses the existing native-dialog `Sheet`, which supplies focus trapping, focus restoration, Escape handling, an accessible title, backdrop dismissal, and a mobile bottom-sheet/desktop-dialog presentation.

On mobile, the button sits above `--nav-clearance`, including the safe-area inset. On desktop it sits at the lower-right edge. The panel offers:

1. Request a Premium Class.
2. Talk to Academic Support on WhatsApp.
3. Get platform/account support on WhatsApp.
4. Explore Master Classes.

The app remains the primary experience: the control is called **Need Help?**, not “WhatsApp Us”, and class requests stay inside Master De Genius.

URL context (`examType`, `subjectSlug`, `subjectName`, `topic`) is used only to shorten the request flow. It never puts scores, answers, detailed performance, or private profile data into WhatsApp URLs. Unauthenticated visitors receive no personalised recommendation.

## Where the CTA appears and is suppressed

It appears throughout the shared student shell: dashboard, practice setup, results, progress, mistake bank, classes, billing and profile/account routes. It also appears on authentication pages and the public Premium Classes page.

`features/support/visibility.ts` suppresses it on:

- `/exam/*` — active full mock/CBT routes.
- `/practice/session/*` — all live practice sessions, including timed sessions.
- `/admin/*` — CRM workspaces.

The conservative suppression of every live practice session avoids overlap with question controls and removes any accidental navigation path during an assessment. It returns automatically on result/submission routes.

## Recommendation logic

`features/classes/recommendation.ts` receives already-loaded `LearningResult[]` values. It does not query or import ALOC, ALOC Station, SDash, or any question provider. Priority is:

1. An unmastered question in the same categorised topic missed at least twice.
2. The weakest aggregated topic below the existing 70% threshold, with at least three observed questions.
3. The weakest aggregated subject below 70%, with at least three observed questions.
4. No personalised recommendation.

All aggregation happens inside a single exam body. When a preference is supplied it selects the body; otherwise the most recent result does. Mixing them would let a WAEC topic be recommended under a JAMB heading for any student who practises both.

Percentages are calculated only from completed, graded Master De Genius results. Repeated-mistake recommendations do not invent an accuracy percentage. Copy is supportive and avoids failure-based language.

## Database migration

`supabase/migrations/202609100001_premium_classes_and_support.sql` adds:

- `premium_class_leads`
- `marketing_consents`
- `app_admins`
- enums for class type, source, status, recommendation reason, contact method and marketing channel
- CRM, student-history and duplicate lookup indexes
- `create_premium_class_lead(...)`, a service-role-only RPC

The lead lifecycle is `new → contacted → interested/follow_up → enrolled`, with `not_interested` and `closed` terminal alternatives. Timestamps record contact, enrolment and closure.

The creation RPC takes a transaction-scoped advisory lock for the user/fingerprint pair. An effectively identical open request within 24 hours returns the existing lead instead of inserting another row, including under concurrent requests.

General academic, account and platform questions route intentionally to user-initiated WhatsApp in Phase 1. They are not forced into the paid-class CRM. A future `support_requests` domain can be added behind the support-panel options without changing the panel UI.

## Security and RLS

- Browser roles have `SELECT` only on their own `premium_class_leads` rows through RLS, and only on a **column-level grant**. RLS alone would still have let a signed-in student read their own `admin_notes`, `assigned_to` and `fingerprint` straight from PostgREST with the publishable key, because the grant was table-wide. CRM columns and internal lifecycle timestamps are now withheld from the `authenticated` role by the database itself.
- Students cannot insert or update leads directly, change CRM status, assign staff, or edit notes.
- Student history queries also select an explicit safe column list, so the application and the database agree rather than the application being the only guard.
- `marketing_consents` is readable only by its owner and writable only through server code.
- `app_admins` is completely unavailable to public/anonymous/authenticated browser roles.
- Lead creation and CRM mutation use the service-role client only after server-side user authentication; CRM mutation also verifies membership in `app_admins`.
- Lead IDs are validated as UUIDs and every update includes an exact ID predicate.
- Request strings are bounded and control characters removed; enums, email, phone, subject slugs and accuracy are validated.
- Subject names are resolved from Master De Genius database records, not trusted from browser input.
- `class_lead_create` uses the existing database-backed rate limiter (default burst 3, sustained 10/hour per authenticated student).
- UI submissions are disabled while pending.

Submitting a specific request permits contact only about that request. Promotional WhatsApp and email checkboxes are separate, not pre-checked, and record independent `granted_at` timestamps. The schema includes `revoked_at` and is ready for a future preference/revocation UI.

## Admin CRM

`/admin/classes` requires both a valid Supabase session and an `app_admins` record. It provides:

- status summary counts, taken as exact `head` counts per status so they stay correct at any volume and never download student contact details to render a number
- filters for status, exam, subject, class type and start date
- name/email/phone search
- lead details, source and recommendation context
- internal notes
- lifecycle status updates
- pagination at 50 leads per page, with the exact filtered total shown
- explicit **Message on WhatsApp** action with a short, non-sensitive template

There is no query-string admin bypass and no automated outbound message.

To authorize an existing Supabase user, run this once with the correct auth user UUID:

```sql
insert into public.app_admins (user_id)
values ('YOUR-AUTH-USER-UUID')
on conflict (user_id) do nothing;
```

## WhatsApp configuration

Set this in local development and in Vercel for every deployed environment:

```text
NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER=2348012345678
```

Use international format with digits only and no `+`, spaces or punctuation. A missing/invalid value safely hides the chat action and leaves the in-app class flow working. WhatsApp is opened with a prefilled message, but the student/admin must intentionally send it.

Optional limiter overrides:

```text
RATE_LIMIT_CLASS_LEAD_BURST=3
RATE_LIMIT_CLASS_LEAD_PER_HOUR=10
```

## Manual Supabase and Vercel steps

1. Back up the target database using the normal project procedure.
2. Apply all pending Supabase migrations, including `202609100001_premium_classes_and_support.sql`.
3. Regenerate database types if the project later switches from the hand-maintained type file to Supabase CLI generation; the checked-in `types/database.ts` is already updated.
4. Insert the authorized admin user UUID into `public.app_admins` using the SQL above.
5. Add `NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER` to Vercel Preview and Production environments.
6. Add limiter overrides only if the defaults need changing.
7. Redeploy so the public environment value is included in the client bundle.
8. Smoke-test: submit one class request, confirm it appears in `/classes`, sign in as the authorized admin, update it in `/admin/classes`, and open both WhatsApp actions without sending.

## Testing

`tests/premium-classes.test.mjs` covers:

- repeated mistakes outranking weak-topic accuracy
- weak-topic recommendations and minimum sample size
- no recommendation for insufficient history
- no provider coupling
- CTA eligibility and live-assessment suppression
- subject/topic/source context retention
- input and enum rejection
- opt-in consent defaults
- safe WhatsApp number/copy and absence of sensitive performance data
- RLS/revoke/service-role-only migration posture
- atomic 24-hour duplicate mechanism
- student history excluding admin notes
- admin authorization before mutation
- column-level denial of CRM columns to the browser role
- exam-body scoping of recommendations
- summary counts that do not depend on the current page
- the analytics seam never throwing into the UI, and no vendor being added

The standard project commands remain:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

All four were run against the finished implementation and pass: 460 tests, no type errors, no lint findings, and a successful production build.

## Known Phase 1 limitations

- General support is user-initiated WhatsApp only; there is no ticket inbox yet.
- Admin allowlisting is performed through SQL; no admin user-management UI is included.
- The CRM intentionally stops at enrolment and records no class schedule or payment.
- No automated WhatsApp/email outreach is performed, even when consent exists.
- The repository has no analytics vendor, and Premium Classes was not a good reason to add one. `features/analytics/events.ts` is a vendor-neutral seam instead: the named events fire from the support hub, recommendation cards, request flow and CRM, and route to a sink that is not installed yet. Installing one is a single `setAnalyticsSink` call in a client provider, with no call site changed. Until then the events are recorded but discarded.
- Public visitors create an account before submitting a stored class lead, which keeps ownership and request history unambiguous.

## Phase 2 recommendations (documentation only)

- Tutor accounts, profiles, subject specialisms and assignment.
- Availability, booking slots, cohort/group capacity and attendance.
- Paystack class payments, bundles and bootcamp cohorts.
- Zoom/Google Meet links, reminders and class recordings.
- WhatsApp Business API and email support for explicitly consented outreach.
- Support tickets, a support inbox and in-app academic adviser chat.
- An AI academic support assistant with strict answer/privacy boundaries.
- Tutor performance, response-time and tutoring-conversion analytics.
- A promotional-preference centre for reviewing and revoking consent.
- Installing a real analytics sink behind `setAnalyticsSink` to answer which pages drive support requests and which CTAs convert.
