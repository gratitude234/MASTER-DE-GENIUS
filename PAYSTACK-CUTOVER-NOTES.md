# M9c — MASTER's own Paystack business: reversal handling, stuck-payment recovery, key cutover

> **No migration.** Nothing here changes the schema. `payment_transactions.status` already allowed
> `reversed`, `mark_billing_payment_unsuccessful` already accepted it, and `user_entitlements`
> remains the only entitlement authority. This is application wiring plus one operator script.

MASTER@DE'GENIUS now has its **own live Paystack business**. The webhook serves exactly one
business, decides MASTER billing events, and forwards nothing anywhere.

An earlier draft of this release routed a temporarily shared Paystack business between two products.
That is no longer needed and has been **removed entirely** rather than left switched off — one fewer
thing that can be enabled by accident. What remains are the two fixes that were worth keeping.

Read alongside `MONETIZATION-NOTES.md` (M9), which this does not replace.

---

## 1. Root cause — why students paid and stayed on Free

**(a) The live Paystack business had no webhook configured.** MASTER therefore never received
`charge.success` deliveries at all, and every payment settled only through the browser callback —
the path a student skips by closing the tab, losing signal, or being bounced by a bank app that does
not return cleanly. Those payments stayed `pending` locally for ever, because nothing else was ever
going to close them. Configuring MASTER's own Live Webhook URL (Phase B, step 5) is what fixes this,
and it is the single most important step in this document.

**(b) `reversed` fell through the non-success path.** `reconcilePayment()` handled a *stored*
`reversed` row, and handled verified `failed` and `abandoned`, but a payment still `pending` locally
and verified upstream as `reversed` matched none of those branches and landed in the generic "still
settling" answer. The row stayed `pending`, the student kept seeing **Confirming your payment**, and
no further Paystack event was ever coming. The webhook had the mirror defect: it filed a verified
reversal as `failed`, which is a different fact.

**(c) There was no way back from a stuck `pending` row.** The callback page polls eight times then
stops. Nothing on the billing page offered a re-check.

None of these is a hole in the security model — no payment activated that should not have. All three
are ways a payment that *should* have activated did not.

---

## 2. Files removed

| File | Why |
| --- | --- |
| `features/billing/shared-business.ts` | The cross-product router: mode flag, destination validation, SSRF guards, forwarding, partner retry mapping. Obsolete. |
| `tests/billing-shared-business.test.mjs` | Existed only to prove forwarding. Its MASTER-side coverage was rewritten into `tests/billing-webhook-route.test.mjs`. |
| `PAYSTACK-SHARED-BUSINESS-NOTES.md` | Superseded by this document. |

Reverted to their original state, with no trace of the partner configuration:
`features/admin/system.ts`, `app/admin/system/page.tsx`, `.env.example`.

## 3. Files retained and modified

| File | Change |
| --- | --- |
| `features/billing/paystack.ts` | The `mdg_` namespace is declared once, beside `generatePaymentReference()`, and exposed as `isMasterPaymentReference()`. |
| `features/billing/webhook.ts` | `unsuccessfulStatusFor()`; a verified reversal is stored as `reversed`; a reference outside the namespace is ignored before any verification call. |
| `features/billing/reconcile.ts` | A pending payment verified as `reversed` is closed rather than left pending. |
| `features/billing/entitlements.ts` | `markRecoverablePayments()` bounds which pending payments the billing page may offer a re-check. |
| `components/billing/payment-recheck.tsx` | **New.** The student-initiated re-check. |
| `components/billing/payment-history.tsx` | Renders the re-check on those payments only. |
| `app/api/billing/webhook/paystack/route.ts` | Back to MASTER-only. The only change from the original is a doc comment stating that it serves one business and proxies nothing. |
| `scripts/reconcile-pending-payments.mjs` | **New.** The one-time pre-rotation operator tool. |
| `package.json` | `npm run billing:pending`. |
| `tests/billing-webhook-route.test.mjs`, `tests/billing-recovery.test.mjs`, `tests/billing-pending-script.test.mjs` | **New.** |
| `tests/billing-service.test.mjs`, `tests/billing-database.test.mjs` | Reversal, namespace and re-check coverage. |
| `tests/engine-manifest.json` | Re-recorded for the changed guarded files; the removed module's entry deleted. |

**Confirmation: shared-business forwarding is gone.** A test asserts
`features/billing/shared-business.ts` does not exist, that the route contains no forwarding call and
makes no `fetch()` of its own, and that none of the billing modules, the admin surface or
`.env.example` mentions the partner or its configuration.

---

## 4. The webhook, in its final form

1. Read the exact raw request body.
2. Verify `x-paystack-signature` (HMAC SHA-512, constant-time compare) against those exact bytes.
3. Parse — never before step 2.
4. Claim the delivery in `billing_webhook_events` (idempotency lease).
5. Refuse any reference outside the `mdg_` namespace, before spending a Paystack call.
6. Verify the transaction server-to-server against Paystack's own API.
7. Check reference match, status, NGN, and test/live environment.
8. Apply through `apply_successful_payment`, which re-checks amount, currency and environment under
   the payment row's lock.

No proxying, no forwarding, no SSRF surface, no partner dependency. **A valid Paystack signature
alone still grants nobody anything** — the signature proves the message came from Paystack, not that
money moved, and not whose account it belongs to.

Responses: `retry` → 503 (claim released, Paystack redelivers); `rejected` → 400 (decided and
permanently refused, visible as a failed delivery in the dashboard); everything else → 200.

## 5. Reference safety

`open_billing_checkout` is the only insert into `payment_transactions`, and it is always handed a
reference from `generatePaymentReference()`. "Starts with `mdg_`" is therefore a true invariant of
every payment row, not a convention — admin Master grants touch `user_entitlements` only and never
create a payment row.

`isMasterPaymentReference()` is a **defensive invariant, not the control**. The control is still
`apply_successful_payment` answering `not_found`. The gate only stops a dashboard-initiated
transaction (a payment link, an invoice, a manual charge) from spending a Paystack verification call
to reach the same answer, and states the rule in one readable place. A hand-written `mdg_` reference
gets past the gate and is refused by the database, which is exactly the intended division.

`/api/billing/verify` deliberately did **not** gain the same gate: its lookup is already scoped by
`user_id`, which is the stronger control and returns `unknown` for any reference without a matching
row — the same answer an invented reference gets, so it cannot be used to probe which references
exist.

## 6. The `reversed` fix (retained)

`unsuccessfulStatusFor(verifiedStatus)` is the one mapping from a verified upstream status to the
local status that closes the row:

```
abandoned → abandoned      reversed → reversed      everything else → failed
```

- **Webhook:** a signed `charge.success` verifying as `reversed` is recorded as `reversed` with
  detail `not_successful_upstream_reversed`, reaches a terminal `ignored` outcome, and grants
  nothing.
- **Callback and re-check:** a locally `pending` payment verified as `reversed` is closed through
  `mark_billing_payment_unsuccessful(p_status => 'reversed')` instead of falling into the "still
  settling" branch. The student sees the same unsuccessful screen a stored `reversed` row has always
  produced; the ledger and payment history show **Reversed**.

**Unchanged:** an already-successful payment is never demoted. `mark_billing_payment_unsuccessful`
only ever moves a `pending` row, and the webhook still files `refund.processed`, `refund.failed` and
`charge.dispute.create` as `*_recorded_for_manual_review`. Automatically revoking a paying student's
access mid-preparation remains the worse failure.

## 7. Stuck-payment recovery (retained)

- `getBillingSummary()` marks a payment `recoverable` when it is `pending`, created within
  **14 days**, and among the **three** most recent such payments. Everything else is `false`.
- Those payments — and only those — render **Check this payment** on the billing page.
- The button POSTs `{ reference }` to the existing `/api/billing/verify`, which already
  authenticates the student, enforces `RATE_LIMITS.billingVerify` (12 burst / 120 per hour), scopes
  the lookup to `user_id`, verifies server-to-server with Paystack, re-checks currency and
  environment, and applies through `apply_successful_payment`.

Deliberately not done: no verification on page load, no background sweep, no endpoint that accepts an
arbitrary reference and grants on it. A pending row is a question, never an answer.

---

## 8. Legacy pending-payment reconciliation, before the key rotation

**The problem.** A transaction can only be verified by the Paystack business that created it. MASTER
opened some transactions under the old business's secret. The moment `PAYSTACK_SECRET_KEY` becomes
MASTER's own key, those references become unverifiable by this application for ever — they would
have to be read out of the old dashboard and settled by hand.

**The tool.** `scripts/reconcile-pending-payments.mjs`, run **while the old key is still
configured**.

```bash
# report only — nothing is changed
npm run billing:pending

# settle the rows the report resolved
npm run billing:pending -- --apply

# optional bounds
npm run billing:pending -- --apply --limit=100 --since-days=120
```

It owns no payment logic. Reporting asks Paystack the same read-only question the callback asks;
applying calls `reconcilePayment()` — the same function the student's own re-check uses, with the
same ownership scoping, amount, currency and environment checks and the same
`apply_successful_payment`. A test asserts the script contains no `.rpc(` call and no direct write to
the ledger, so a second implementation of "did this payment succeed?" cannot creep in.

| Property | Behaviour |
| --- | --- |
| Default mode | **Report only.** Nothing is changed without `--apply`. |
| Scope | `status = 'pending'` **and** `reference LIKE 'mdg_%'` — only rows this application created. |
| Bounds | `--limit` default 50, capped at 200; `--since-days` default 90, capped at 365. Bad or missing values fall back rather than widening. |
| Resolution | Only `success`, `failed`, `abandoned`, `reversed` resolve a row. Anything else — including an unreachable provider — leaves it pending and is listed for a human. |
| Output per row | reference · previous status · what Paystack says · what it becomes · whether an entitlement was applied. |
| Secrets | The Paystack **mode** (`live`/`test`) is printed. No key, ever. |
| Re-runnable | Yes. Application is idempotent and settled rows are skipped. |

It never marks a row successful without authoritative verification, never stores the old secret
anywhere, and introduces no second permanent Paystack key into the runtime.

---

## 9. Final environment variables

No shared-business flag. No partner variables. Nothing new is required.

```
PAYSTACK_SECRET_KEY=<MASTER live secret key>          # server-only, never NEXT_PUBLIC_
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=<MASTER live public key>
NEXT_PUBLIC_APP_URL=https://www.masterdegenius.com.ng
```

MASTER Paystack business → **Live Webhook URL**:

```
https://www.masterdegenius.com.ng/api/billing/webhook/paystack
```

The key prefix (`sk_live_` vs `sk_test_`) decides which Paystack world the deployment settles
against, and the verified transaction's `domain` is checked against it — so a live event can never
activate a transaction opened with test keys, or the reverse.

---

## 10. Deployment — operator checklist

### PHASE A — before key rotation (**stop at the end and wait for approval**)

1. **Confirm production still holds the old live key.** Admin → System → Payments should show
   *Paystack secret key set: Yes* and *Paystack mode: Live*. Do not change any key yet.
2. **List the pending rows.** Admin → Payments, filter to `pending`. Or run the report:
   ```bash
   npm run billing:pending
   ```
3. **Reconcile them against the old key.**
   ```bash
   npm run billing:pending -- --apply
   ```
4. **Review what remains.** The script prints a *Still pending* list. Re-run after a few minutes;
   genuinely undecided transactions may settle on their own.
5. **Stop.** Do not switch keys until the remaining list is empty or you have accepted it. Anything
   still pending at rotation must be settled by hand from the old dashboard.

### PHASE B — MASTER key cutover

1. Obtain MASTER's **Live Public Key** from the MASTER Paystack business.
2. Obtain MASTER's **Live Secret Key** from the same place.
3. In Vercel → project → Environment Variables (Production), set:
   ```
   PAYSTACK_SECRET_KEY=<MASTER live secret>
   NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=<MASTER live public>
   NEXT_PUBLIC_APP_URL=https://www.masterdegenius.com.ng
   ```
4. **Redeploy.** `NEXT_PUBLIC_*` values are inlined at build time, so a redeploy is required — not
   just a variable change.
5. In the MASTER Paystack business → Settings → API Keys & Webhooks, set the **Live Webhook URL** to
   `https://www.masterdegenius.com.ng/api/billing/webhook/paystack` and save.

### PHASE C — live test

1. As a real student account, buy **Master Monthly (₦1,500)** and complete it on Paystack.
2. Confirm the transaction shows **Success** in the Paystack dashboard.
3. Confirm the local payment shows **Paid** on `/billing`.
4. Confirm the account moved Free → Master.
5. Confirm the expiry is 30 days out for `master_30`.
6. Confirm the payment appears in billing history with the right amount and masked reference.
7. Confirm Admin → System → *Recent Paystack webhook deliveries* shows the event as `applied` or
   `duplicate`. **`duplicate` is correct** — it means the callback won the race and the webhook
   correctly declined to grant a second time.
8. **Confirm a callback-less payment still settles.** Buy again and close the tab at the Paystack
   page *before* being redirected back. Within a minute the webhook alone should settle it: `/billing`
   shows **Paid** and the expiry extends. This is the step that proves (a) is actually fixed — do not
   skip it.

### PHASE D — post-cutover

1. Verify no old pending rows remain: `npm run billing:pending` should report none, and Admin →
   Payments should show no stale `pending`.
2. Confirm no temporary configuration is left: neither `PAYSTACK_SHARED_BUSINESS_MODE` nor
   `JABUSTUDY_PAYSTACK_WEBHOOK_URL` should exist in Vercel. Neither is read by this build.
3. Admin → System should show no shared-business row or warning at all — the panel is back to
   *secret key set · mode · public key set*.
4. **Remove the old secret from MASTER.** It must not remain in Vercel, in `.env.local`, or in any
   deployment note. Rotate it on the old business's side if it was ever shared.

I changed no Paystack dashboard settings. Every dashboard action above is yours.

---

## 11. Rollback

**If the cutover misbehaves — restore the previous production state:**

1. In Vercel, set `PAYSTACK_SECRET_KEY` and `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` back to the **old live
   keys**, and redeploy.
2. In the MASTER Paystack business, **clear** the Live Webhook URL. The true pre-change state had no
   webhook configured on the business MASTER was settling through, so clearing it — not pointing it
   somewhere else — is the restoration.
3. MASTER is then back to callback-only settlement, which is where it was before. Use §7 (student
   re-check) and §8 (the script) to recover anything that lands in that window.

Note the asymmetry: payments taken under MASTER's new business *between* the cutover and the
rollback can only be verified by MASTER's new key. Settle those **before** reverting the keys, using
`npm run billing:pending -- --apply` while the new key is still configured — the same procedure as
Phase A, in the opposite direction.

**Rolling back the code** is a plain revert. Nothing in this release wrote data in a new shape, so
there is nothing to undo in the database. Existing successful payments, references and entitlements
are untouched throughout.

---

## 12. What was deliberately not done

- No schema migration — the existing schema already supported everything needed.
- No second payment table, no second entitlement authority, no dual permanent Paystack keys.
- No change to plan prices, access durations, JAMB/WAEC logic or product quotas.
- No automatic revocation on refund, chargeback or post-success reversal. Still manual review.
- No Billing UI redesign; one re-check action was added to an existing row.
- No change to `/billing/callback?reference=…` or to the `callback_url` sent at initialization. The
  callback/webhook race is unchanged: whichever applies first wins, the other sees `already_applied`,
  and there is still exactly one entitlement extension per successful payment.
- No Paystack dashboard setting was changed by this work.
