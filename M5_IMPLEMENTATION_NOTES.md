# M5 — Results and revision loop

Implemented on top of the recovered M4 archive.

## Delivered

- Real `/progress` history with separate mock and practice results and pagination.
- `/progress/results/[kind]/[id]` for completed attempts only.
- Grading against frozen answer keys; correct, incorrect and unanswered counts; subject and topic breakdowns.
- JAMB mock estimate: each of four subjects contributes 100 points; sum before rounding. Explicitly labelled an estimate, not an official JAMB score. Other results use raw correct/total marks.
- Current target comparison, session elapsed time capped at expiry, small-sample labels, honest empty states.
- Answer review filters for subject, topic, outcome and flags; passages, illustrations, selected/correct options and explanations, including unanswered questions.
- Mistake bank from completed mock/practice history. Wrong and unanswered questions enter; two separate consecutive successful completions mark mastered; another miss reopens them.
- Stable provider/exam/subject question identity and replay deduplication prevent refreshes or duplicate history entries from advancing mastery.
- Focused revision through `POST /api/progress/practice`: up to 20 owned frozen questions, missed first for weak-topic revision. Mistake revision selects active mistakes within one subject/exam. No provider request is needed.
- Home now displays real latest scores, recommendations and mistake counts; removed the illustrative readiness, countdown and score data from its rendered output.
- Existing completion screens link directly to results; reopening completed runner routes redirects to results.
- Loading/error states and phone-friendly stacked layouts with labelled controls.

## Persistence and security

No new migration is needed. M3/M4 already persist frozen question snapshots, answer keys, answers and final counts. M5 derives detailed results and mastery from those records; it does not introduce duplicate aggregate tables or materialised analytics. Existing finalisation RPCs still own answer locking and persisted counts.

All result services are server-only. A query restricted to the authenticated owner and final status must succeed before answer keys are read. Revision reconstructs its payload on the server from owned records; clients submit only selection criteria. Questions from active attempts are not reviewable through results. Public question-delivery payloads still omit keys and explanations.

History reads are explicitly paginated and concurrent result loads are capped at four. This implementation replays the entire completed history for mistake state. For very long histories, an indexed event ledger or incremental aggregates should replace this read-time replay; UI pagination alone does not reduce that server work. No production-scale load testing is claimed.

## Dependency/build repairs

Full installation succeeded in this environment, unlike earlier milestones. Fixed the old Supabase SSR/client type compatibility by updating SSR and pinning the installed client version. Updated Next.js and its ESLint config to 15.5.25 after the old package reported a security deprecation. Includes a reproducible package-lock.json. Fixed pre-existing lint issues. Use Node 22.15+ (Node 24 recommended for the included tests).

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings/errors.
- `npm run build`: passed; all new routes compiled.
- `npm test`: 13 passed. Covers weighting, empty results, unanswered handling, topic scoping, question identity, mastery replay and reopening, owner/final-status gates, invalid IDs, frozen answer grading, expiry duration, and revision payload construction.

Service tests use a mocked database boundary. No live Supabase credentials were available; live database integration, authenticated browser flows, mobile visual verification and production load testing have not been run. This is an implemented and compiled source release, not a claim of live deployment.

No official exam grading formula is asserted. Topic percentages describe observed attempts, not a validated readiness/mastery model. Time per individual question was not recorded in M4 and is not fabricated. Focused revision repeats saved questions rather than claiming to fetch unseen ones. The inherited local backup/timer implementation has not been redesigned in M5.

## Run locally

1. `npm ci`
2. Copy `.env.example` to `.env.local` and fill in your own Supabase values.
3. Apply existing migrations through M4 to the intended project if not already applied.
4. `npm test && npm run typecheck && npm run lint && npm run build`
5. `npm run dev`

Live acceptance: finish a practice session; open results; review an unanswered item; start revision; complete it twice; confirm mastery; miss it again and confirm reopening. Finish a four-subject mock and verify subject weights and review filters. Try another account's result ID and an active attempt ID: neither should return a result. Refresh completed results and verify mastery stays unchanged.
