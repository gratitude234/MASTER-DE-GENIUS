# ALOC Station foundation

ALOC Station is the provider required for the verified WAEC activation. Legacy
ALOC and the internal bank remain available as rollback options; provider
selection stays environment-controlled.

## Configure locally

Add these server-only values to `.env.local`:

```text
ALOC_STATION_API_KEY=your_unmasked_dashboard_key
ALOC_STATION_BASE_URL=https://dev.aloc.com.ng/api/v1
```

Never prefix the key with `NEXT_PUBLIC_`. Set `QUESTION_PROVIDER=aloc_station`
in every environment where WAEC should be selectable.

## Zero-credit catalogue check

```bash
npm run aloc-station:catalog
```

This reads only Station subject metadata, reports zero-credit usage, and prints
no questions, answers, key, or student data. The application itself uses the
verified allow-list from the migration/provider mapping rather than calling
Station metadata on every page load.

## Controlled credit probe

The probe deliberately performs four documented calls: a 10-question JAMB L1
request, a 40-question JAMB assessment, a 50-question WAEC assessment, and a
10-question NECO Government L1 request. It never prints question content, answers, or the
key, and refuses to run without explicit confirmation.

```bash
npm run aloc-station:probe -- --confirm-spend
```

The 2026-09-08 verification established one credit per successful request,
verified JAMB and WAEC answer keys, and showed that the WAEC 50-question preset
may return fewer than 50 questions. MASTER therefore exposes the actual returned
count and derives its timer from that count. NECO remains unavailable as a full
product because Station currently advertises only three NECO subjects.

## Usage storage

Apply `supabase/migrations/20260907220013_external_api_usage.sql` and
`supabase/migrations/20260908023000_activate_waec_onboarding.sql` before setting
`QUESTION_PROVIDER=aloc_station`. They create a service-role-only usage ledger
containing endpoint, feature, exam, subject, counts, HTTP outcome, latency and
the provider credit headers. It stores no user id, API key, question content,
answer, or student data.

Free ALOC Station accounts are for non-commercial evaluation and require
attribution. The application must not be launched commercially on a free key.
Station's standard terms also limit operational caching to 48 hours; the
existing long-lived result snapshots need a separate retention/licensing change
before Station can be treated as production-ready.
