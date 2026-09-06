# M2 implementation notes — Question architecture + provider boundary

M2 turns the M1 student/exam preference foundation into a provider-agnostic content system.

## Added database architecture

- `topics`
- `question_passages`
- `questions`
- `question_options`
- `question_assets`
- `question_provider_subject_mappings`
- `question_provider_topic_mappings`
- question difficulty/status/kind/asset enums
- active-question lookup indexes
- provider external-ID uniqueness
- topic and provider-mapping timestamps

Questions are linked through `exam_bodies -> exam_subjects -> subjects -> topics`, so a question cannot be assigned to a subject that is not configured for its exam body.

## Answer-key security

Raw question tables have RLS enabled with **no authenticated student SELECT policy**. Students can browse the active topic taxonomy, but question delivery is intended to go through the server-side provider/service boundary.

`CanonicalQuestion` contains `correctOptionKey` and `explanation` on the server. `StudentQuestion` deliberately strips both before delivery. This prevents the future CBT client from receiving an answer key in its initial JSON payload.

A service-role Supabase client now exists at `lib/supabase/admin.ts`. It is `server-only`, requires `SUPABASE_SERVICE_ROLE_KEY`, and must never be imported into client components.

## Content immutability

Active questions cannot have options/assets edited in place. A content editor must first move the question out of `active`. Shared passages referenced by active questions are also protected. Activation checks that a valid option set exists and the configured correct option key is present.

This prevents an active exam item changing underneath a running exam session.

## Provider boundary

The initial provider interface lives under `features/questions/providers/`.

Implemented now:

- `internal` — canonical PostgreSQL question store

Reserved for later adapters:

- `aloc`
- `sdash`

`QUESTION_PROVIDER=internal` selects the active provider. New adapters map provider-specific payloads into `CanonicalQuestion`; the rest of the application should not depend on their response shape.

Provider-specific subject/topic identifiers are stored in mapping tables instead of leaking into the core product model.

## Practice UI

`/practice` now loads the signed-in student's selected subjects and M2 topic taxonomy from Supabase and renders a mobile-first practice setup:

- subject
- topic
- 10 / 20 / 30 / 40 question counts
- Practice / Timed mode
- advanced year/difficulty controls
- quick-practice shortcut

`/practice/session` currently stops at the M2 boundary and shows the normalized request. M3 will create a persisted practice session and deliver real student-safe questions through the provider service.

## Starter topic taxonomy

Migration `202609060004_m2_seed_jamb_topics.sql` seeds a product-level starter taxonomy for the default English/Mathematics/Physics/Chemistry experience. It is deliberately not described as a verbatim official JAMB syllabus. Reconcile labels/mappings with the active official syllabus and chosen provider before launch.

## Local seed content

`supabase/seed.sql` contains four original demonstration questions (one per initial subject). They are not labelled as historical exam questions and exist only to exercise the internal provider locally.

## New environment variables

```env
SUPABASE_SERVICE_ROLE_KEY=...
QUESTION_PROVIDER=internal
ALOC_API_KEY=
SDASH_API_KEY=
```

Only `SUPABASE_SERVICE_ROLE_KEY` is needed by the internal server-side provider. The external provider keys are placeholders for the next integration milestone.

## M3 target

M3 should implement the actual practice-session engine:

1. validate requested subject/topic against the student's preferences;
2. generate a session through `fetchCanonicalQuestions()`;
3. persist/freeze question snapshots server-side;
4. send only `StudentQuestion` payloads to the browser;
5. autosave answers;
6. reveal correctness/explanation only after an answer in Practice mode;
7. grade Timed mode only at submission;
8. handle insufficient provider inventory cleanly.
