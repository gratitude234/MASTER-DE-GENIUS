# M1 — Auth, Profile & Onboarding

Implemented:

- Supabase SQL schema for profiles, exam catalogue and student preferences
- RLS policies for all M1 tables
- auth.users → profiles trigger
- atomic `complete_jamb_onboarding(...)` RPC with JAMB validation
- JAMB/WAEC/NECO/Post-UTME/School exam catalogue seed
- initial JAMB subject catalogue seed
- typed Supabase browser/server/middleware clients
- sign up, email confirmation callback, login, sign out
- forgot/reset-password flow
- protected student and exam routes
- three-step JAMB onboarding
- exactly four JAMB subjects with compulsory Use of English
- exam year, target score, intended course and study intensity
- live student profile page backed by Supabase
- Home greeting/exam label now use the stored student profile

## Apply migrations

With Supabase CLI linked to the intended project:

```bash
supabase db push
```

Or apply the two files under `supabase/migrations/` through the Supabase SQL/migration workflow.

## Auth configuration

Add local and production callback URLs in Supabase Auth URL configuration, including:

- `http://localhost:3000/auth/callback`
- your production `/auth/callback`

Email confirmation can remain enabled. The signup flow handles both confirmation-enabled and immediate-session configurations.

## Intentionally deferred

- question/topic tables and provider integration (M2/M3)
- actual practice sessions
- real exam attempts/grading
- real readiness/analytics values
- IndexedDB/offline answer queue
- service worker implementation
