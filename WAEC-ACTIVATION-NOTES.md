# WAEC activation

## Deploy in this order

1. Apply all pending Supabase migrations, including:
   - `20260907220013_external_api_usage.sql`
   - `20260908023000_activate_waec_onboarding.sql`
2. Set these server-only Vercel environment variables:

   ```text
   QUESTION_PROVIDER=aloc_station
   ALOC_STATION_API_KEY=your_unmasked_key
   ALOC_STATION_BASE_URL=https://dev.aloc.com.ng/api/v1
   ```

3. Redeploy after both the migration and environment-variable changes are live.

Never prefix the Station key with `NEXT_PUBLIC_`. The release archive excludes
`.env.local` so local and production secrets are not redistributed.

## What is active

- JAMB keeps its existing four-subject onboarding, `/400` goal and full mock.
- WAEC is selectable for new users and from Profile → Change exam setup.
- WAEC offers verified objective practice, past questions and timed single-subject sessions.
- WAEC goals use percentages rather than the JAMB `/400` scale.
- If Station returns fewer verified questions than requested, the session states
  the shortage and derives its timer and score from the actual count.

## Current provider limitation

NECO remains unavailable as a complete product. Station discovery currently
lists NECO inventory only for Civic Education, Commerce and Government. The UI
states that coverage is limited instead of offering a broken examination flow.

Run `npm run aloc-station:catalog` at any time to recheck the zero-credit Station
catalogue without printing question content, answers, credentials or student data.
