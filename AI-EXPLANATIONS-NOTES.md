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
GEMINI_MODEL=gemini-3.5-flash-lite
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

## Model selection — read this before changing GEMINI_MODEL

The default is `gemini-3.5-flash-lite`. Lite is a deliberate choice: an
explanation here is a short, grounded rewrite of an answer the server has
already verified, not open-ended reasoning, and the lite tier has the more
generous request allowance.

**The whole `gemini-2.5` family is retired for new API keys** — `2.5-flash` and
`2.5-flash-lite` both return 404. They still appear in `models.list`, so listing
a model is not proof a key may call it; the rejection only happens at generation
time:

```text
404 This model models/gemini-2.5-flash is no longer available to new users.
```

That reached students as `GENERATION_FAILED` with nothing in the deployment log,
because the provider's reason was recorded only in `ai_usage`. The category and
a sanitized reason are now both logged.

### Verified against a live key

| Model | Result | Output tokens | Latency |
| --- | --- | ---: | ---: |
| `gemini-3.5-flash-lite` | works — **default** | 130 | 2.3s |
| `gemini-flash-lite-latest` | works (floating alias) | 130 | 1.9s |
| `gemini-3.1-flash-lite` | works | 161 | 2.9s |
| `gemini-3.6-flash` | works | 134 | 4.2s |
| `gemini-3.8-flash` | works | 148 | 4.0s |
| `gemini-2.5-flash` | **404 — retired** | — | — |
| `gemini-2.5-flash-lite` | **404 — retired** | — | — |

Every working model returned all four structured fields. That is a check of
shape, not of teaching quality — compare a few real explanations before changing
tiers.

A pinned version is preferred over the `-latest` alias. The alias would have
survived this retirement on its own, but it can also change the model underneath
a prompt tuned for structured output, and it makes `seed` non-reproducible. A
pinned model that is retired now fails loudly in the log with its own name in the
message, which is the trade this codebase takes.

Re-check any candidate before switching. It spends one request on a synthetic
question and prints no student data:

```bash
GEMINI_MODEL=<candidate> npm run gemini:probe -- --confirm-spend
```

### Latency

Observed 1.9s to 4.2s across models, but a full-flash probe once took 45s.
`GEMINI_TIMEOUT_MS` is per attempt and the SDK retries once, so worst-case wall
time is roughly twice the timeout plus backoff. Keep that under the deployment's
function duration limit.

### Failed generations

A failure now returns the student's daily allowance
(`refund_ai_daily_quota`). Before that, three failures left a student told they
had used three explanations they never received.

## Deliberate v1 limits

- No automatic Gemini call is made when a student answers or navigates.
- Image and diagram questions do not show AI actions yet because the v1 prompt is text-only.
- Unanswered questions cannot be explained.
- The daily allowance is a plan entitlement as of M9: three generated explanations a day on Free, twenty on Master. Cache hits still do not spend it.
- `AI_EXPLANATIONS_DAILY_LIMIT` was removed in M9. The allowance now lives with the other plan limits in `features/billing/plans.ts`, so the pricing page and the enforced limit cannot disagree. See [monetization notes](MONETIZATION-NOTES.md).
- Cache retention is capped at 48 hours while ALOC derivative-content licensing is clarified.
