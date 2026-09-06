# M0 Implementation Notes

## Architecture decisions

- Student product is mobile-first; 360–430px is the primary design target.
- Mobile navigation is fixed to Home / Practice / Mock / Progress / Me.
- Desktop changes at Tailwind `lg` (1024px) to a grouped sidebar.
- Active CBT lives at `/exam/[attemptId]` outside the student shell so no normal bottom nav/sidebar appears during an exam.
- Question/content provider integrations will sit behind internal types and services; UI will not call third-party question APIs directly.
- `AttemptStatus` is explicit: `created | in_progress | submitted | expired | abandoned`.
- Supabase browser/server/middleware clients are separated; service-role credentials are deliberately absent from browser configuration.
- PWA manifest is present, but service worker / offline persistence is intentionally deferred until the attempt engine exists.

## Verification in this environment

The source tree has been generated and manually inspected. This execution environment has Node and TypeScript but no project `node_modules`, and outbound npm access is unavailable, so a true Next.js install/build cannot be executed here yet. The repository is prepared for `npm install`, `npm run lint`, `npm run typecheck`, and `npm run build` in an environment with package access.
