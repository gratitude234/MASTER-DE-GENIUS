# ALOC Station foundation

This change adds ALOC Station as a separate, opt-in provider. Legacy ALOC and
the internal bank remain available; no production provider is switched by the
code change itself.

## Configure locally

Add these server-only values to `.env.local`:

```text
ALOC_STATION_API_KEY=your_unmasked_dashboard_key
ALOC_STATION_BASE_URL=https://dev.aloc.com.ng/api/v1
```

Never prefix the key with `NEXT_PUBLIC_`. To select Station after its contract
has been verified, set `QUESTION_PROVIDER=aloc_station`.

## Controlled credit probe

The probe deliberately performs four documented calls: a 10-question JAMB L1
request, a 40-question JAMB assessment, a 50-question WAEC assessment, and a
10-question NECO L1 request. It never prints question content, answers, or the
key, and refuses to run without explicit confirmation.

```bash
npm run aloc-station:probe -- --confirm-spend
```

Use the returned credit ledger to decide whether Station bills assessment
assembly per request or per returned question. Do not enable WAEC/NECO in the UI
until their live inventory and answer-key contract pass this verification.

## Usage storage

Apply `supabase/migrations/20260907220013_external_api_usage.sql` before setting
`QUESTION_PROVIDER=aloc_station`. It creates a service-role-only usage ledger
containing endpoint, feature, exam, subject, counts, HTTP outcome, latency and
the provider credit headers. It stores no user id, API key, question content,
answer, or student data.

Free ALOC Station accounts are for non-commercial evaluation and require
attribution. The application must not be launched commercially on a free key.
Station's standard terms also limit operational caching to 48 hours; the
existing long-lived result snapshots need a separate retention/licensing change
before Station can be treated as production-ready.
