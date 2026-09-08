# M9 — Paystack monetization, Free and Master entitlements

> **Apply `supabase/migrations/20260908060000_m9_billing_and_entitlements.sql` before deploying this
> release.** Without it, `/pricing`, `/billing`, checkout, the webhook and every practice, mock and
> AI-generation quota call a table and a function that do not exist. Practice and mock creation fail
> closed, so students would be locked out of session creation entirely until the migration lands.

This release introduces the first paid product: a permanent Free tier and a Master tier bought as a
one-time Paystack payment for a fixed number of days. There is no automatic renewal, no stored card
and no subscription in this pass.

---

## 1. Files changed

### New — billing authority (`features/billing/`)

| File | Responsibility |
| --- | --- |
| `plans.ts` | The single source of truth for plan slugs, prices, durations and per-tier limits. Shared by server and client. |
| `entitlements.ts` | Resolves the current tier, expiry and limits; produces the safe billing summary. Request-level cached. |
| `quota.ts` | Reserve / commit / release for the plan-limited product capabilities. |
| `limit-notice.ts` | The student-facing copy for every limit, shared by the routes and the components that render their responses. |
| `api.ts` | Builds the `402 PLAN_LIMIT` response. |
| `paystack.ts` | Server-only Paystack surface: signature verification, initialize, verify, reference generation, environment resolution. |
| `checkout.ts` | Checkout orchestration with injected side effects. |
| `webhook.ts` | Event processing and every verification rule, with injected side effects. |
| `reconcile.ts` | Server-side reconciliation of a browser callback. |

### New — routes and pages

- `app/api/billing/checkout/route.ts`
- `app/api/billing/webhook/paystack/route.ts`
- `app/api/billing/verify/route.ts`
- `app/(student)/pricing/{page,loading,error}.tsx`
- `app/(student)/billing/{page,loading,error}.tsx`
- `app/(student)/billing/callback/{page,loading,error}.tsx`

### New — components (`components/billing/`)

`plan-comparison.ts`, `pricing-plans.tsx`, `checkout-button.tsx`, `current-plan-card.tsx`,
`payment-history.tsx`, `payment-status.tsx`, `upgrade-prompt.tsx`

### Modified

| File | Change |
| --- | --- |
| `app/api/practice/sessions/route.ts` | Reserves the practice allowance after the abuse limiter, commits on success, releases on duplicate/failure. |
| `app/api/exam/attempts/route.ts` | Same, for mock attempts; a *resumed* attempt releases rather than commits. |
| `features/ai/service.ts` | Daily generation limit now resolved from the entitlement; a limit refusal returns a structured `PLAN_LIMIT` notice. |
| `features/ai/config.ts` | `aiDailyLimit()` removed — the allowance is a plan limit, not an environment variable. |
| `app/api/ai/question-explanation/route.ts` | Passes the structured limit notice through to the browser. |
| `lib/rate-limit.ts` | Added `billingCheckout` and `billingVerify` policies. |
| `components/ai/question-explanation.tsx` | Renders the upgrade panel instead of an error band when the allowance is reached. |
| `components/practice/practice-setup.tsx`, `components/exam/mock-exam-setup.tsx` | Same treatment for their limits. |
| `components/app-shell/student-navigation.tsx` | "Plan & Billing" in the desktop rail. |
| `app/(student)/me/page.tsx` | Plan card — the mobile route to billing, since the tab bar has no sixth slot. |
| `types/database.ts` | Types for the seven new tables and eleven new RPCs. |
| `.env.example` | Paystack placeholders; `AI_EXPLANATIONS_DAILY_LIMIT` removed. |
| `tests/engine-manifest.json`, `tests/engine-guard.test.mjs` | Re-recorded, and extended to guard the billing authority. |
| `tests/ai-explanations.test.mjs` | Added the `next/link` stub the AI panel now needs. |

### New tests

`tests/billing-database.test.mjs` (38), `tests/billing-service.test.mjs` (64),
`tests/billing-enforcement.test.mjs` (17).

---

## 2. Migrations

Two migrations, applied in this order after `20260908040000_ai_question_explanations.sql`:

```text
supabase/migrations/20260908060000_m9_billing_and_entitlements.sql
supabase/migrations/20260908080000_m9a_webhook_claim_lease.sql
```

**M9a is a repair.** M9 reached the production project from a copy taken before its webhook
idempotency gate was corrected (see §6a), so that database has `billing_webhook_events` without
`claim_expires_at`, the superseded four-argument `record_billing_webhook_event`, and no
`release_billing_webhook_event`. M9a brings it to the shape a fresh environment gets.

M9a is idempotent and safe on both shapes: `add column if not exists`, a `drop function if exists`
naming only the superseded overload by its exact signature, and `create or replace` for the two
functions. It never drops a table and never deletes a payment.

A fresh environment simply runs both in order and ends in the same state —
`tests/billing-migration-repair.test.mjs` asserts that the drifted-then-repaired path and the
fresh path converge exactly.

## 3. Tables and RPCs

### Tables

| Table | Purpose |
| --- | --- |
| `billing_plans` | Authoritative price/duration catalogue, seeded with the four plans. A partial unique index allows exactly one "Most Popular". |
| `payment_transactions` | The ledger. `reference` is unique; a check constraint makes `status='success'` impossible without `applied_at` and `entitlement_expires_at`. Rows are never deleted. |
| `user_entitlements` | Current access, one row per student. |
| `entitlement_events` | Append-only audit of every grant and extension. |
| `billing_webhook_events` | Sanitized idempotency log, unique on `(provider, event_id)`. The claim is a **lease**: it only blocks future deliveries once `processed_at` records a terminal decision. |
| `product_usage_windows` | Per-student lock anchor that serialises quota reservations. |
| `product_usage_reservations` | Reserved / committed units of a plan-limited capability. |

### RPCs (all `security definer`, `search_path = ''`, `service_role` only)

| Function | Purpose |
| --- | --- |
| `open_billing_checkout` | Prices from the catalogue and creates — or reuses — a pending payment. |
| `attach_billing_authorization_url` | Stores the checkout link against the reference. |
| `apply_successful_payment` | **The atomic grant.** Locks the payment row, re-verifies amount/currency/environment, locks the entitlement, extends from `greatest(expiry, now())`, marks the payment successful and writes the audit event. |
| `mark_billing_payment_unsuccessful` | Records a failed/abandoned/reversed outcome. Refuses to demote an applied payment. |
| `current_billing_entitlement` | Tier with expiry already resolved. |
| `reserve_product_quota` / `commit_product_quota` / `release_product_quota` | The quota lifecycle. |
| `record_billing_webhook_event` | Idempotency gate. Distinguishes *already decided* (never rerun), *in flight* (leased by another instance) and *stale or released* (re-claimable). |
| `finish_billing_webhook_event` | Records a terminal decision. After this the delivery never runs again. |
| `release_billing_webhook_event` | Hands an unfinished claim back after a retryable failure, so Paystack’s next delivery of the same event is processed rather than dismissed as a duplicate. |

## 4. Plans and limits

| Slug | Name | Price | kobo | Access |
| --- | --- | ---: | ---: | ---: |
| `free` | Free | ₦0 | 0 | Permanent |
| `master_30` | Master Monthly | ₦1,500 | 150000 | 30 days |
| `master_90` | Master Exam Pass — **Most Popular** | ₦3,500 | 350000 | 90 days |
| `master_180` | Master Season Pass | ₦5,500 | 550000 | 180 days |

| Capability | Free | Master | Enforced |
| --- | ---: | ---: | --- |
| Practice sessions created | 20 / day | 200 / day | ✅ `product_usage_reservations` |
| Full mock attempts | 1 / calendar month | 3 / day | ✅ `product_usage_reservations` |
| Newly generated AI explanations | 3 / day | 20 / day | ✅ `consume_ai_daily_quota` |
| Cached AI explanations | Unlimited | Unlimited | Cache hit returns before the quota is consulted |
| Scores, correct answers, standard explanations | Included | Included | Never gated |
| Result history, mistake review, revision | Included | Included | **Deferred — see §20** |

Windows are UTC. Daily resets at `00:00Z`; the Free monthly mock resets on the first of the month.

## 5. Checkout flow

1. Browser POSTs `{ planSlug }` to `/api/billing/checkout`. Nothing else in the body is read.
2. The route authenticates via Supabase server-side and reads the email from the session.
3. `RATE_LIMITS.billingCheckout` (PostgreSQL token bucket) bounds repeated initialization.
4. `resolveCheckoutPlan` rejects `free`, unknown and non-purchasable slugs.
5. `open_billing_checkout` prices the plan from `billing_plans` and writes a **pending payment row
   before Paystack is contacted**, so a webhook always has something to resolve against.
6. A pending checkout for the same user and plan created in the last 15 minutes is reused, so a
   double-tapped Pay button resolves to one Paystack transaction.
7. Paystack `/transaction/initialize` is called with the server amount, `NGN`, the generated
   reference and a callback URL built from `NEXT_PUBLIC_APP_URL` — never the request `Host`.
8. The authorization URL is stored and returned. The secret key and the full provider response never
   leave the server.

References are `mdg_<base36 time>_<16 random bytes>` from `crypto.randomBytes` — unguessable, so the
verification endpoint cannot be enumerated.

## 6. Webhook verification

`POST /api/billing/webhook/paystack`, Node runtime, no session.

1. `await request.text()` — the raw bytes.
2. HMAC SHA-512 over those bytes with `PAYSTACK_SECRET_KEY`, compared with `timingSafeEqual`.
3. Invalid → `401`, no detail, nothing parsed. `JSON.parse` runs only after verification.
4. The event is claimed through `record_billing_webhook_event`; a delivery that already reached a
   decision stops here, and one still leased by another instance stops too.
5. Unsupported events are acknowledged and ignored.
6. For `charge.success`, the transaction is **verified against Paystack's own API**. The body is a
   trigger, never evidence — the amount applied is always the verified one.
7. Rejected before the entitlement is touched: reference mismatch, non-successful upstream status,
   non-NGN currency, environment mismatch.
8. `apply_successful_payment` re-checks amount, currency and environment under the payment row's
   lock, then grants atomically.

Three answers: `retry` → **503** (nothing decided, claim released, please redeliver); `rejected` →
**400** (decided and permanently refused — a mismatched amount should surface as a failed delivery in
the Paystack dashboard); everything else → **200**, so a permanent condition does not become a
permanent retry loop.

**Never stored:** signatures, raw payloads, card data, authorization codes, customer records. Only
the reference, the provider transaction id, a status string and timestamps.

## 6a. Pre-approval verification findings

Verified empirically before sign-off. Two defects were found in the idempotency gate and fixed.

**Fixed — a transient failure permanently lost the payment.** The claim was marked on the first
delivery regardless of outcome, so a delivery that failed for a retryable reason (Paystack's verify
API unreachable) was answered non-2xx *and* its retry was then dismissed as a duplicate. One brief
outage meant a student paid and never got access. The claim is now a lease, released on a retryable
failure; `tests/billing-service.test.mjs` carries a regression test that fails if it comes back.

**Fixed — a failed gate acknowledged an unprocessed delivery.** When `record_billing_webhook_event`
itself errored, the code returned `isNew: false`, which the route mapped to `200`. Paystack would
stop retrying an event that nothing had processed. It now reports `unavailable`, and the route
answers `503`.

**Verified sound, unchanged:**

- **`event_id` derivation** — `${event}:${data.id}`, falling back to `${event}:${reference}` when a
  payload carries no id, truncated to 200 characters. The event type is the prefix, so every event
  type about one transaction gets its own key and none can collide.
- **RPC hardening** — all eleven billing functions are `SECURITY DEFINER` with `search_path = ''`,
  `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`.
  Every branch was exercised with a decoy `evil` schema first in the caller's search path: all
  resolved to `public`, the decoy's one-kobo plan row was ignored in favour of the real catalogue,
  and nothing was written to the decoy.
- **Ownership** — the beneficiary is never supplied by any caller. `apply_successful_payment` takes
  no user parameter: it resolves the payment by the locally generated CSPRNG reference and credits
  that row's own `user_id`, written server-side from the authenticated session at initialization.
  Provider metadata, `customer.email` and `plan` are dropped during parsing and can never redirect a
  grant.

## 7. Idempotency and concurrency

| Race | Guarantee |
| --- | --- |
| Paystack redelivers the same event | `billing_webhook_events` unique `(provider, event_id)` — once the first reached a terminal decision, the second never reaches processing. |
| Paystack’s verify API is down for one delivery | The claim is **released**, not finished, so the retry runs and the payment still activates. A transient outage must not cost a student their access. |
| The idempotency gate itself is unreachable | Nothing is claimed and nothing runs, so the route answers `503` rather than acknowledging a delivery it never processed. |
| A claim is abandoned mid-flight | It lapses on a 300-second lease and the next delivery re-claims it. |
| Several event types about one transaction | The event type is part of `event_id` (`charge.success:4242` vs `charge.failed:4242`), so they coexist without colliding — and each is still deduplicated on its own. |
| Webhook races the browser callback | Both call `apply_successful_payment`, which takes `FOR UPDATE` on the payment row. The loser blocks, re-reads the committed row, sees `success` and returns `already_applied`. |
| The same reference applied twice | Impossible: the status check runs under the row lock. Exactly one `entitlement_events` row per payment. |
| Two clicks on Pay | Client disables during the request; `open_billing_checkout` serialises on the entitlement row and hands the second caller the first one's checkout. |
| Concurrent quota consumption across instances | `reserve_product_quota` locks the window row before counting. 40 concurrent reservations against a limit of 20 yield exactly 20. |
| A request dies mid-creation | The reservation expires on its 120-second lease and is reclaimed inside the next reservation's lock. |

## 8. Expiration and renewal

- Expiry is resolved **at read time**, in `current_billing_entitlement` and in `resolveEntitlement`.
  There is no downgrade job, no cron and no window where a stale row still authorizes Master.
- The stored `tier` stays `master` after expiry; only the resolved answer changes. The past expiry is
  still reported so the billing page can explain what happened.
- Renewal extends from `greatest(coalesce(expires_at, now()), now())`:
  - **Early renewal** stacks the new days on the existing expiry — no paid day is lost.
  - **Lapsed renewal** starts from today, never back-dated into a window the student could not use.
- Payment history is never deleted when access expires.

## 9. Refund and reversal policy

`refund.processed`, `refund.failed` and `charge.dispute.create` are **recorded and left for a human**.
Access already granted is never revoked automatically, and `mark_billing_payment_unsuccessful`
refuses to demote an applied payment.

The failure modes are asymmetric: wrongly revoking cuts off a student who paid, mid-preparation;
a delayed manual revocation costs one subscription. Paystack's event contract for these has not been
verified end to end here, so the conservative side is the one that does not strand a student. A
non-successful transaction never grants access in the first place.

## 10. Environment variables

```env
PAYSTACK_SECRET_KEY=sk_test_YOUR_KEY
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_YOUR_KEY
NEXT_PUBLIC_APP_URL=https://your-app.example
```

`PAYSTACK_SECRET_KEY` is server-only — never prefix it with `NEXT_PUBLIC_`. Its prefix also decides
which Paystack world this deployment settles against (`sk_test_` → test, `sk_live_` → live), so the
environment cannot disagree with itself.

Optional: `RATE_LIMIT_BILLING_CHECKOUT_BURST` (5), `RATE_LIMIT_BILLING_CHECKOUT_PER_HOUR` (20),
`RATE_LIMIT_BILLING_VERIFY_BURST` (12), `RATE_LIMIT_BILLING_VERIFY_PER_HOUR` (120).

**Removed:** `AI_EXPLANATIONS_DAILY_LIMIT`. The allowance is now a plan limit in
`features/billing/plans.ts`.

## 11. Paystack dashboard setup

Not performed — no dashboard was configured and no live secret exists in this repository.

1. Create a Paystack account and stay in **Test mode**.
2. Settings → API Keys & Webhooks: copy the **test** secret and public keys.
3. Put them in `.env.local` (git-ignored) and in the Vercel project's environment variables.
4. Set `NEXT_PUBLIC_APP_URL` to the deployed origin.
5. Add the webhook URL below and save.
6. Confirm the account's default currency includes **NGN**.

## 12. Webhook URL

```text
https://<your-domain>/api/billing/webhook/paystack
```

Paystack cannot reach `localhost`. For local delivery, tunnel (`ngrok http 3000`) and register the
tunnel URL — or simply rely on the callback page, which reconciles through the same locked function
and will activate access without a webhook.

## 13. Local test procedure

```bash
npm install
npm test                  # includes the three new billing suites
npm run typecheck
npm run lint
npm run build
```

With test keys configured:

1. `npm run dev`, sign in, open `/pricing`.
2. Choose a plan → Paystack test checkout. Use Paystack's published test card.
3. You land on `/billing/callback?reference=…`. It shows **Confirming** and polls `/api/billing/verify`,
   which verifies server-side and applies through `apply_successful_payment`.
4. `/billing` shows the plan, the expiry and the payment.
5. Buy again while active — the expiry extends by the new plan's days rather than resetting.

The automated suite mocks every Paystack call and spends nothing.

## 14. Deployment order

1. **Apply both migrations, in order** (`supabase db push`, or paste each into the SQL editor):
   `20260908060000_m9_billing_and_entitlements.sql`, then
   `20260908080000_m9a_webhook_claim_lease.sql`. This is a strict prerequisite. Neither M9 nor any
   other versioned migration here is re-runnable — they use bare `create table`, so a second run
   fails on the first statement. M9a is the exception and is safe to re-run.
2. Set `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` and `NEXT_PUBLIC_APP_URL` in Vercel.
3. Deploy.
4. Register the webhook URL in the Paystack dashboard.
5. Verify with one test-mode payment before switching to live keys.

Deploying before step 1 breaks practice creation, mock creation and billing: the quota calls fail
closed, so students cannot start sessions.

## 15–18. Validation results

| Check | Result |
| --- | --- |
| `npm test` | **410 passed, 0 failed** — 290 before this release, plus 38 database + 64 service + 17 enforcement tests and 1 new engine-guard coverage assertion |
| `npm run typecheck` | **Clean** |
| `npm run lint` | **Clean**, 0 errors 0 warnings |
| `npm run build` | **Succeeded**, 23 pages, no warnings |

Locally verified over HTTP against a running dev server:

- `/pricing`, `/billing`, `/billing/callback` compile and redirect unauthenticated visitors to `/login`.
- `POST /api/billing/checkout` and `/api/billing/verify` return `401` without a session.
- `POST /api/billing/webhook/paystack` with a forged signature and with no signature header both
  return `401`; the server log records `webhook signature rejected` with no secret, signature or
  payload.

No live Paystack transaction was performed. No migration was applied to a remote database.

## 19. Engine-manifest changes

Five guarded files legitimately changed and were re-recorded after review:

`features/ai/config.ts`, `features/ai/service.ts`, `app/api/ai/question-explanation/route.ts`,
`app/api/practice/sessions/route.ts`, `app/api/exam/attempts/route.ts`

Fourteen files were **added** to the guard — nothing was removed or excluded to make it pass:

`features/billing/{plans,entitlements,quota,limit-notice,api,paystack,checkout,webhook,reconcile}.ts`,
`app/api/billing/{checkout,verify}/route.ts`, `app/api/billing/webhook/paystack/route.ts`,
`lib/rate-limit.ts`, and the M9 migration.

`tests/engine-guard.test.mjs` gained a second coverage assertion requiring the billing authority and
the Paystack surface to stay guarded. The manifest is 62 entries. Three of them —
`features/billing/webhook.ts`, `app/api/billing/webhook/paystack/route.ts` and the migration — were
re-recorded again after the pre-approval fixes in §6a.

## 20. Remaining limitations

1. **History, mistake review and revision are not restricted.** The spec's table marks these
   "recent/basic" and "limited" on Free. Implementing them would mean reworking `features/results`,
   the progress dashboard and the mistake bank, which the spec explicitly says not to do in this
   pass. Free students currently get all three in full, and the pricing table says so honestly.
2. **The recommended AI upgrade sentence was adjusted.** The specified copy ended "…complete mistake
   review and advanced revision tools", but because of (1) those are not Master features today.
   Shipping that line would promise a paying student something they already have. The message keeps
   its shape and the real differentiator — "up to 20 personalized explanations daily" — and names the
   two limits Master genuinely raises. `tests/billing-service.test.mjs` fails if the original wording
   returns without the gating behind it. **Restore it in the same change that gates mistake review.**
3. **No automatic renewal.** All three paid products are one-time purchases. The UI never claims
   otherwise; "Master Monthly" means 30 days bought once.
4. **Refunds and chargebacks are manual.** See §9.
5. **Not implemented, as instructed:** the founders' 70/30 split, school plans, referrals, coupons,
   gifting, family plans, affiliate commissions, lifetime access.
6. **Quota rows accumulate.** `product_usage_reservations` keeps one committed row per created
   session. At 200/day on Master that is bounded and cheap, but a periodic purge of windows older
   than a couple of months is worth adding before scale.
7. **Webhook events are never pruned.** Same consideration.
8. **The callback polls up to 8 times over ~20 seconds** before offering a manual retry. A payment
   still settling after that resolves on the next visit to `/billing`.
9. **Paystack is not configured anywhere.** With no `PAYSTACK_SECRET_KEY`, checkout returns a clear
   "payments are not available on this deployment yet" and the webhook acknowledges without acting.
