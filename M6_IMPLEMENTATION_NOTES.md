# M6 — Offline reliability and PWA

This release extends the M5 codebase. Real question-provider integration remains the next milestone.

## What changed

Both runners now use a shared IndexedDB-backed queue. A selection is written to device storage before it is sent to the server; the save indicator does not claim a successful local save until the transaction completes. Frozen student-safe questions, passages, answers, pending mutation IDs, cursor position and timer anchors are stored per user/session. Existing M3/M4 localStorage backups are migrated on an authenticated resume of that session.

The queue serialises network requests and acknowledges an exact mutation ID. New choices made while an older request is in flight remain intact. Lost acknowledgements can be retried without applying the same change twice. Reconnect, visibility and periodic retries cover intermittent failures without relying solely on the browser's online event.

A database revision check rejects stale writes across devices. Conflicts retain the local answer and pause automatic retries; the student can explicitly keep this device's choices against a freshly read server revision. One Web Lock per session prevents two tabs from editing it simultaneously. Browsers without Web Locks cannot enter this durable editing mode.

Manual submission waits for outstanding durable writes and server acknowledgements. Practice no longer completes before pending answers. Timed automatic submission retries on failure. Unconfirmed changes are retained with a notice after completion rather than silently deleted. Server deadline checks prevent an incorrect client clock from automatically submitting an attempt early. The timer uses a monotonic anchor and server calibration; offline device time is not treated as proof that a late answer was completed before the deadline.

The installable manifest includes regular/maskable PNG icons and an Apple touch icon. A production service worker precaches the public `/offline` shell and its application assets, with a unique cache version for each build. Navigation failures/server errors can fall back to the shell, where saved sessions can be reopened. It never caches authenticated page HTML, RSC data or API responses. Known question images are cached separately on a best-effort CORS-enabled basis; uncached images and unrevealed explanations still need a connection.

Worker updates do not call `skipWaiting` or force a page reload. The UI asks students to finish their session, close all app tabs and reopen for an update. Sign-out clears saved sessions and question media, asks before removing unsynced answers, and tells other tabs to stop. Storage writes check the current owner atomically, preventing stale tabs from repopulating data after sign-out/account change. Storage failures block editing with an honest message and a retry option that retains the in-memory choice.

## Required migration

Apply `supabase/migrations/20260906021235_m6_durable_response_revisions.sql` after the existing M1–M4 migrations, before running the new app.

It adds the service-only `response_revisions` table and `save_response_v2` RPC. RLS is enabled; anonymous/authenticated roles have no table or function access. The RPC verifies session ownership, locks the same parent row as existing save/finalisation functions, checks the expected revision, and atomically writes the original answer plus its retry receipt. Public save endpoints derive the user from authentication and require revision metadata.

Old open clients must reload after deployment to use the new save protocol. Their legacy pending backups are migrated when their owned attempt is reopened.

## Verification

- TypeScript, ESLint and production build passed.
- `npm test`: 25 tests passed; all browser recovery groups passed.
- Automated unit/service/database suite covers grading plus queue persistence, lost acknowledgements, in-flight changes, concurrent flushes, conflict preservation, storage failure/recovery, account isolation, clock recalibration and automatic-expiry guards.
- PGlite executes the actual M1–M6 migrations and both practice/exam revision RPC branches. Tests cover ownership denial, exact retry replay, stale-write rejection, cleared answers, flags, deadline rejection, finalisation and restricted grants.
- Chromium browser tests exercise the production offline shell and actual runners with intercepted API fixtures. They cover offline selection/flags, hard navigation fallback, reload, close/reopen, cursor restoration, one editing tab, syncing before submit, failed expiry retry, practice feedback locking and completion, cache boundaries, and waiting service-worker updates.
- Layout overflow checks cover 360, 390, 430 and 1280px; the 390px exam view was visually inspected.

These tests do not represent a live authenticated Supabase deployment. Production Supabase credentials were not provided. PGlite approximates the PostgreSQL database boundary; browser save responses are fixtures. Actual Android/iPhone installation and long-running physical-device suspension are not verified here.

## Commands

Use Node 22.15+ (Node 24 recommended).

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

Set `.env.local` from `.env.example` with your own Supabase settings for live use. The PWA worker is deliberately disabled under `npm run dev`; test the production build for offline behaviour. HTTPS is required outside localhost.

Browser tests:

```sh
npx playwright install chromium
TEST_START_SERVER=1 TEST_BASE_URL=http://127.0.0.1:3000 npm run test:browser
```

Alternatively start the app separately and omit `TEST_START_SERVER`. `CHROMIUM_PATH` can point to an existing Chromium executable. Browser screenshots are temporary verification output outside the source tree. Database tests use an in-memory PGlite instance and do not touch a live project.

## Product limits

- Timed answers must reach the server before expiry. No arbitrary grace period or client-supplied timestamp is trusted. Offline answers arriving late cannot count, and the UI explains this.
- A student must first open the app/session online so its shell and paper can be saved. New question sets and authentication cannot start fully offline.
- Retry occurs while the app is open/resumed; this release does not promise background delivery after the browser is terminated.
- Device storage can be evicted by the browser or removed by the user. Only server-confirmed saves survive loss of local storage. Anyone sharing the same browser can access its saved offline sessions; remove them or sign out before sharing it.
- All local question data remains student-safe: active exam keys and unrevealed timed feedback are not sent to the browser. Feedback already revealed in learning mode may be retained locally.
- M5 still derives mastery by replaying completed history; production-scale analytics optimisation remains separate from this milestone.
