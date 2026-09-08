# MASTER AI question explanations

## What this release adds

- Intent-driven **Explain better** and **Why was I wrong?** actions.
- Immediate availability after verified feedback in normal practice.
- Availability from completed practice and submitted mock result review.
- Server rejection during active timed practice and active mocks.
- Gemini structured JSON output with a verified-answer grounding prompt.
- A PostgreSQL-backed two-request burst limiter and atomic daily allowance.
- A PostgreSQL generation claim so concurrent duplicate clicks purchase one generation.
- A 48-hour shared cache addressed only by SHA-256 hashes.
- A server-only usage ledger with tokens, latency, cache status and error category.

Gemini does not grade questions or calculate scores. Correct answers are loaded from the owned frozen session only after the server has verified the session state.

## Deployment

Apply this migration after the previously supplied migrations:

```text
supabase/migrations/20260908040000_ai_question_explanations.sql
```

Configure these server-only Vercel environment variables:

```env
AI_EXPLANATIONS_ENABLED=true
GEMINI_API_KEY=your_private_key
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=12000
RATE_LIMIT_AI_EXPLANATION_BURST=2
RATE_LIMIT_AI_EXPLANATION_PER_HOUR=120
```

Do not prefix any of these values with `NEXT_PUBLIC_`. Redeploy after changing environment variables.

Before enabling the feature for students, run one deliberate synthetic probe:

```bash
npm run gemini:probe -- --confirm-spend
```

The probe spends one Gemini request and reports only model, token counts, duration and which structured fields were present. It never prints the prompt, generated explanation, answer, API key or student data.

## Deliberate v1 limits

- No automatic Gemini call is made when a student answers or navigates.
- Image and diagram questions do not show AI actions yet because the v1 prompt is text-only.
- Unanswered questions cannot be explained.
- The daily allowance is a plan entitlement as of M9: three generated explanations a day on Free, twenty on Master. Cache hits still do not spend it.
- `AI_EXPLANATIONS_DAILY_LIMIT` was removed in M9. The allowance now lives with the other plan limits in `features/billing/plans.ts`, so the pricing page and the enforced limit cannot disagree. See [monetization notes](MONETIZATION-NOTES.md).
- Cache retention is capped at 48 hours while ALOC derivative-content licensing is clarified.
