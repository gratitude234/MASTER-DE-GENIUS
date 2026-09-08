import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

// The billing components render real markup; only the Next.js runtime, which a
// plain Node render has no router for, is replaced.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

/**
 * The application-layer half of monetization: what the checkout endpoint sends
 * Paystack, and what the webhook refuses to act on.
 *
 * Paystack itself is never contacted. Every network effect is injected, which
 * is what makes rejection paths — a forged signature, a short-paid amount, a
 * replayed delivery — testable at all, and guarantees the suite spends no money.
 */

// A stand-in secret, invented here. It is not a Paystack key and never was.
const TEST_SECRET = 'sk_test_0000000000000000000000000000000000000000';
process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.invalid';

const plans = await import('../features/billing/plans.ts');
const { resolveEntitlement, maskReference } = await import('../features/billing/entitlements.ts');
const { resolveCheckoutPlan, parseCheckoutRequest, startCheckout, checkoutCallbackUrl, BillingError } =
  await import('../features/billing/checkout.ts');
const { processPaystackEvent, parsePaystackEvent } = await import('../features/billing/webhook.ts');
const { verifyPaystackSignature, paystackEnvironment, generatePaymentReference, appUrl } =
  await import('../features/billing/paystack.ts');
const { quotaWindow, capabilityLimit } = await import('../features/billing/quota.ts');
const { planLimitNotice, planLimitText, asPlanLimitNotice } = await import('../features/billing/limit-notice.ts');
const { parseReference } = await import('../features/billing/reconcile.ts');

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

// ────────────────────────────────────────────────────── plan catalogue

test('the published prices and durations are exactly what the catalogue holds', () => {
  const byslug = Object.fromEntries(plans.BILLING_PLANS.map((plan) => [plan.slug, plan]));

  assert.equal(byslug.free.priceKobo, 0);
  assert.equal(byslug.free.durationDays, null);
  assert.equal(byslug.master_30.priceKobo, 150000);
  assert.equal(byslug.master_30.durationDays, 30);
  assert.equal(byslug.master_90.priceKobo, 350000);
  assert.equal(byslug.master_90.durationDays, 90);
  assert.equal(byslug.master_180.priceKobo, 550000);
  assert.equal(byslug.master_180.durationDays, 180);

  for (const plan of plans.BILLING_PLANS) assert.equal(plan.currency, 'NGN');
  assert.deepEqual(
    plans.BILLING_PLANS.filter((plan) => plan.isPopular).map((plan) => plan.slug),
    ['master_90'],
    'the 90-day plan is the single Most Popular slot',
  );
});

test('the Free and Master limits are the published ones', () => {
  assert.deepEqual(plans.TIER_LIMITS.free, {
    practiceSessionsPerDay: 20,
    mockAttempts: 1,
    mockAttemptWindow: 'month',
    aiExplanationsPerDay: 3,
  });
  assert.deepEqual(plans.TIER_LIMITS.master, {
    practiceSessionsPerDay: 200,
    mockAttempts: 3,
    mockAttemptWindow: 'day',
    aiExplanationsPerDay: 20,
  });
});

test('prices are rendered in naira, never in raw kobo', () => {
  assert.match(plans.formatNaira(150000), /1,500/);
  assert.match(plans.formatNaira(350000), /3,500/);
  assert.match(plans.formatNaira(550000), /5,500/);
  assert.ok(!plans.formatNaira(150000).includes('150000'));
});

// ────────────────────────────────────────────────────── entitlement resolution

test('Free resolves for a student with no entitlement row at all', () => {
  const entitlement = resolveEntitlement(null);
  assert.equal(entitlement.tier, 'free');
  assert.equal(entitlement.isMaster, false);
  assert.equal(entitlement.limits.aiExplanationsPerDay, 3);
  assert.equal(entitlement.limits.practiceSessionsPerDay, 20);
  assert.equal(entitlement.plan, null);
});

test('an unexpired Master row resolves to active Master with its plan', () => {
  const expiresAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const entitlement = resolveEntitlement({ tier: 'master', plan_slug: 'master_90', expires_at: expiresAt });

  assert.equal(entitlement.tier, 'master');
  assert.equal(entitlement.isMaster, true);
  assert.equal(entitlement.plan?.slug, 'master_90');
  assert.equal(entitlement.limits.aiExplanationsPerDay, 20);
  assert.equal(entitlement.limits.practiceSessionsPerDay, 200);
  assert.equal(entitlement.limits.mockAttempts, 3);
  assert.equal(entitlement.limits.mockAttemptWindow, 'day');
});

test('an expired Master row falls back to Free, keeping the date for the billing page', () => {
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const entitlement = resolveEntitlement({ tier: 'master', plan_slug: 'master_180', expires_at: expiresAt });

  assert.equal(entitlement.tier, 'free');
  assert.equal(entitlement.isMaster, false);
  assert.equal(entitlement.limits.aiExplanationsPerDay, 3);
  assert.equal(entitlement.plan, null, 'a lapsed plan must not still be reported as the active plan');
  assert.equal(entitlement.expiresAt, expiresAt, 'the past expiry is preserved so it can be explained');
});

test('a malformed or missing expiry never resolves to Master', () => {
  assert.equal(resolveEntitlement({ tier: 'master', plan_slug: 'master_30', expires_at: null }).tier, 'free');
  assert.equal(resolveEntitlement({ tier: 'master', plan_slug: 'master_30', expires_at: 'not-a-date' }).tier, 'free');
  assert.equal(resolveEntitlement({ tier: 'premium', plan_slug: null, expires_at: null }).tier, 'free');
});

test('paid access is never read from editable auth metadata', () => {
  for (const file of [
    'features/billing/entitlements.ts',
    'features/billing/quota.ts',
    'features/billing/checkout.ts',
    'features/billing/webhook.ts',
    'features/billing/reconcile.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    // Comments explaining why are fine; a read is not.
    assert.ok(!/\buser_metadata\b\s*[.?[]/.test(source), `${file} must not read user_metadata`);
    assert.ok(!/\bapp_metadata\b\s*[.?[]/.test(source), `${file} must not read app_metadata`);
    assert.ok(!source.includes('jwt.claim'), `${file} must not authorize from a JWT claim`);
  }
});

test('an entitlement lookup that cannot complete fails closed to Free', async () => {
  const { getEntitlement, FREE_ENTITLEMENT } = await import('../features/billing/entitlements.ts');

  /*
   * Two things at once. `getEntitlement` is wrapped in React's `cache`, which
   * has no request scope here — it must still be callable rather than throwing.
   * And with no Supabase configuration the lookup cannot succeed, so this also
   * proves the failure direction: a billing outage degrades a paying student to
   * free limits for one request, and never hands Master to everybody.
   */
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;

  try {
    const entitlement = await getEntitlement('11111111-1111-4111-8111-111111111111');
    assert.equal(entitlement.tier, 'free');
    assert.equal(entitlement.isMaster, false);
    assert.deepEqual(entitlement.limits, FREE_ENTITLEMENT.limits);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('a payment reference is shortened before it reaches a screen', () => {
  const reference = 'mdg_abc123_0123456789abcdef0123456789abcdef';
  const masked = maskReference(reference);
  assert.ok(masked.length < reference.length);
  assert.ok(masked.startsWith('mdg_abc1'));
  assert.ok(masked.endsWith('cdef'));
});

// ──────────────────────────────────────────────── checkout uses the server price

test('a client-supplied price, duration or tier is not read at all', () => {
  const parsed = parseCheckoutRequest({
    planSlug: 'master_30',
    // Everything a hostile client might try to smuggle in.
    amount: 100,
    amountKobo: 1,
    priceKobo: 1,
    durationDays: 3650,
    tier: 'master',
    expiresAt: '2099-01-01',
  });
  assert.deepEqual(parsed, { planSlug: 'master_30' }, 'only the slug survives parsing');
});

test('the free plan and unknown or inactive plans are refused before any network call', () => {
  for (const slug of ['free', 'master_9999', 'MASTER_30', '', null, undefined, 42, { slug: 'master_30' }]) {
    assert.throws(() => resolveCheckoutPlan(slug), BillingError, `${JSON.stringify(slug)} must be refused`);
  }
  assert.equal(resolveCheckoutPlan('master_180').priceKobo, 550000);
});

/** Records what the checkout service asked its collaborators to do. */
function checkoutHarness(overrides = {}) {
  const calls = { opened: [], initialized: [], attached: [], failed: [] };
  let references = 0;

  const deps = {
    environment: 'test',
    appUrl: 'https://app.example.invalid',
    generateReference: () => `mdg_test_reference_${(references += 1)}`,
    async openCheckout(input) {
      calls.opened.push(input);
      // The database resolves the price from its own catalogue, exactly as
      // open_billing_checkout does.
      const plan = plans.findPlan(input.planSlug);
      return {
        outcome: 'created',
        paymentId: 'payment-1',
        reference: input.reference,
        amountKobo: plan.priceKobo,
        currency: 'NGN',
        accessDays: plan.durationDays,
        authorizationUrl: null,
      };
    },
    async initializeTransaction(input) {
      calls.initialized.push(input);
      return { authorizationUrl: 'https://checkout.paystack.com/xyz' };
    },
    async attachAuthorizationUrl(reference, url) { calls.attached.push({ reference, url }); },
    async markUnsuccessful(reference, reason) { calls.failed.push({ reference, reason }); },
    ...overrides,
  };

  return { deps, calls };
}

test('checkout sends Paystack the server price, in NGN, with a configured callback URL', async () => {
  const { deps, calls } = checkoutHarness();

  const result = await startCheckout(
    // The caller passes a slug the browser sent; nothing else from the request
    // reaches this function.
    { userId: 'user-1', email: 'student@example.invalid', planSlug: 'master_90' },
    deps,
  );

  assert.equal(calls.initialized.length, 1);
  assert.equal(calls.initialized[0].amountKobo, 350000, 'the amount is the catalogue price');
  assert.equal(calls.initialized[0].email, 'student@example.invalid');
  assert.equal(
    calls.initialized[0].callbackUrl,
    'https://app.example.invalid/billing/callback?reference=mdg_test_reference_1',
    'the callback host is configured, never taken from the request',
  );
  assert.equal(result.amountKobo, 350000);
  assert.equal(result.currency, 'NGN');
  assert.equal(result.accessDays, 90);
  assert.equal(result.authorizationUrl, 'https://checkout.paystack.com/xyz');
  assert.equal(calls.attached.length, 1, 'the checkout link is stored against the reference');
});

test('the pending payment is recorded before Paystack is contacted', async () => {
  const order = [];
  const { deps } = checkoutHarness({
    async openCheckout(input) {
      order.push('open');
      const plan = plans.findPlan(input.planSlug);
      return {
        outcome: 'created', paymentId: 'p', reference: input.reference,
        amountKobo: plan.priceKobo, currency: 'NGN', accessDays: plan.durationDays, authorizationUrl: null,
      };
    },
    async initializeTransaction() {
      order.push('paystack');
      return { authorizationUrl: 'https://checkout.paystack.com/xyz' };
    },
  });

  await startCheckout({ userId: 'user-1', email: 'a@b.invalid', planSlug: 'master_30' }, deps);
  // A webhook arriving mid-flight must always find a local row to resolve.
  assert.deepEqual(order, ['open', 'paystack']);
});

test('a rapid double click resolves to one Paystack transaction', async () => {
  let paystackCalls = 0;
  let opens = 0;

  const { deps } = checkoutHarness({
    async openCheckout(input) {
      opens += 1;
      const plan = plans.findPlan(input.planSlug);
      const base = { paymentId: 'p', amountKobo: plan.priceKobo, currency: 'NGN', accessDays: plan.durationDays };
      // The second opener is handed the first one's still-pending checkout, the
      // way open_billing_checkout does under its row lock.
      return opens === 1
        ? { ...base, outcome: 'created', reference: input.reference, authorizationUrl: null }
        : { ...base, outcome: 'reused', reference: 'mdg_test_reference_1', authorizationUrl: 'https://checkout.paystack.com/xyz' };
    },
    async initializeTransaction() {
      paystackCalls += 1;
      return { authorizationUrl: 'https://checkout.paystack.com/xyz' };
    },
  });

  const params = { userId: 'user-1', email: 'a@b.invalid', planSlug: 'master_30' };
  const first = await startCheckout(params, deps);
  const second = await startCheckout(params, deps);

  assert.equal(paystackCalls, 1, 'a second click must not open a second payment');
  assert.equal(second.reused, true);
  assert.equal(second.reference, first.reference);
  assert.equal(second.authorizationUrl, first.authorizationUrl);
});

test('a provider failure closes the pending payment instead of leaving it open', async () => {
  const { deps, calls } = checkoutHarness({
    async initializeTransaction() { throw new Error('paystack down'); },
  });

  await assert.rejects(
    () => startCheckout({ userId: 'user-1', email: 'a@b.invalid', planSlug: 'master_30' }, deps),
    /paystack down/,
  );
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.failed[0].reason, 'initialization_failed');
});

test('a student without a resolvable email cannot open a checkout', async () => {
  const { deps, calls } = checkoutHarness();
  await assert.rejects(
    () => startCheckout({ userId: 'user-1', email: '', planSlug: 'master_30' }, deps),
    BillingError,
  );
  assert.equal(calls.opened.length, 0, 'nothing is recorded and Paystack is never called');
});

test('the checkout route authenticates server-side and never trusts a request amount', () => {
  const source = readFileSync('app/api/billing/checkout/route.ts', 'utf8');
  assert.ok(source.includes('supabase.auth.getUser()'), 'the user is resolved from the session');
  assert.ok(source.includes('status: 401'), 'an unauthenticated request is rejected');
  assert.ok(source.includes('user.email'), 'the email comes from the session, not the body');
  assert.ok(!/body\.(amount|price|durationDays|tier)/.test(source), 'no amount is read from the request');
  assert.ok(source.includes('enforceRateLimit'), 'repeated initialization is rate limited');

  const checkout = readFileSync('features/billing/checkout.ts', 'utf8');
  assert.ok(
    checkout.includes('amountKobo: opened.amountKobo'),
    'the amount sent upstream is the one the database resolved from its catalogue',
  );
});

test('a checkout callback URL is built from the configured app URL', () => {
  assert.equal(
    checkoutCallbackUrl('https://app.example.invalid/', 'mdg_ref_1'),
    'https://app.example.invalid/billing/callback?reference=mdg_ref_1',
  );
  assert.equal(appUrl(), 'https://app.example.invalid');
});

test('payment references are unguessable and unique', () => {
  const references = new Set(Array.from({ length: 500 }, generatePaymentReference));
  assert.equal(references.size, 500);
  for (const reference of references) {
    assert.ok(reference.length >= 8 && reference.length <= 100);
    // 16 random bytes: not enumerable from a timestamp or a counter.
    assert.match(reference, /^mdg_[a-z0-9]+_[0-9a-f]{32}$/);
  }
});

// ─────────────────────────────────────────────────────── webhook signature

test('a valid HMAC SHA-512 signature is accepted', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'mdg_ref_1' } });
  const signature = createHmac('sha512', TEST_SECRET).update(body, 'utf8').digest('hex');
  assert.equal(verifyPaystackSignature(body, signature), true);
});

test('a forged, absent, truncated or wrong-key signature is rejected', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'mdg_ref_1' } });
  const valid = createHmac('sha512', TEST_SECRET).update(body, 'utf8').digest('hex');

  assert.equal(verifyPaystackSignature(body, null), false);
  assert.equal(verifyPaystackSignature(body, undefined), false);
  assert.equal(verifyPaystackSignature(body, ''), false);
  assert.equal(verifyPaystackSignature(body, 'deadbeef'), false, 'a short digest must not pass');
  assert.equal(verifyPaystackSignature(body, valid.slice(0, -1) + '0'), false, 'one flipped character invalidates it');
  assert.equal(verifyPaystackSignature(body, valid.toUpperCase()), false, 'case is part of the digest');
  assert.equal(
    verifyPaystackSignature(body, createHmac('sha512', 'sk_test_someone_elses_key').update(body).digest('hex')),
    false,
    'another key does not authenticate this deployment',
  );
});

test('a signature is bound to the exact bytes, so a modified body fails', () => {
  const original = JSON.stringify({ event: 'charge.success', data: { reference: 'mdg_ref_1', amount: 150000 } });
  const signature = createHmac('sha512', TEST_SECRET).update(original, 'utf8').digest('hex');

  // The classic attack: keep the signature, raise the amount.
  const tampered = JSON.stringify({ event: 'charge.success', data: { reference: 'mdg_ref_1', amount: 999999 } });
  assert.equal(verifyPaystackSignature(tampered, signature), false);

  // Even a re-serialisation with different key order breaks it, which is why
  // the route must sign over the raw body rather than a parsed object.
  const reordered = JSON.stringify({ data: { amount: 150000, reference: 'mdg_ref_1' }, event: 'charge.success' });
  assert.equal(verifyPaystackSignature(reordered, signature), false);
});

test('the webhook route verifies the raw body before parsing it', () => {
  const full = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  // The import statement names the verifier too; ordering only means anything
  // inside the handler.
  const source = full.slice(full.indexOf('export async function POST'));
  const readIndex = source.indexOf('await request.text()');
  const verifyIndex = source.indexOf('verifyPaystackSignature');
  const parseIndex = source.indexOf('JSON.parse');

  assert.ok(readIndex >= 0, 'the raw body is read, not the parsed JSON');
  assert.ok(verifyIndex > readIndex, 'the signature is checked against those raw bytes');
  assert.ok(parseIndex > verifyIndex, 'nothing is parsed until the signature has been verified');
  assert.ok(source.includes('x-paystack-signature'));
  assert.ok(source.includes('status: 401'));
  assert.ok(!full.includes('request.json()'), 'the body must never be read as parsed JSON');

  const paystack = readFileSync('features/billing/paystack.ts', 'utf8');
  assert.ok(paystack.includes('timingSafeEqual'), 'the digest comparison is constant time');
  assert.ok(paystack.includes("createHmac(\"sha512\""), 'HMAC SHA-512, as Paystack specifies');
});

test('no billing module ever logs a secret or a provider payload', () => {
  for (const file of [
    'features/billing/paystack.ts',
    'features/billing/webhook.ts',
    'features/billing/checkout.ts',
    'features/billing/reconcile.ts',
    'app/api/billing/webhook/paystack/route.ts',
    'app/api/billing/checkout/route.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('console.log'), `${file} must not console.log`);

    // Naming a concept in a log line is fine ("signature rejected"); putting the
    // value into one is not. Only interpolation of a sensitive binding fails.
    for (const binding of ['secret', 'signature', 'rawBody', 'payload', 'apiKey', 'authorization']) {
      const interpolated = new RegExp(`console\\.(error|warn)\\([^)]*\\$\\{[^}]*\\b${binding}\\b`, 'i');
      assert.ok(!interpolated.test(source), `${file} must not interpolate ${binding} into a log`);
    }
    assert.ok(!/console\.(error|warn)\(\s*(rawBody|signature|payload|secret)\b/.test(source),
      `${file} must not log a sensitive value directly`);
  }
});

// ─────────────────────────────────────────────────────── webhook processing

/** Records what the webhook processor decided, with no network anywhere. */
function webhookHarness(overrides = {}) {
  const calls = { applied: [], unsuccessful: [], finished: [], released: [], verified: [] };
  const seen = new Map();

  const deps = {
    environment: 'test',
    async verifyTransaction(reference) {
      calls.verified.push(reference);
      return {
        reference,
        status: 'success',
        amountKobo: 150000,
        currency: 'NGN',
        environment: 'test',
        providerTransactionId: '4242',
        paidAt: '2026-09-08T10:00:00.000Z',
      };
    },
    async recordEvent({ eventId }) {
      // Mirrors the lease in record_billing_webhook_event: a claim only blocks
      // future deliveries once it has been finished with a terminal outcome.
      const claimed = seen.get(eventId);
      if (claimed === undefined || claimed === 'released') {
        seen.set(eventId, 'claimed');
        return { isNew: true, eventRowId: 1 };
      }
      return { isNew: false, eventRowId: 1 };
    },
    async finishEvent(rowId, outcome, detail) {
      calls.finished.push({ outcome, detail });
      for (const [key, value] of seen) if (value === 'claimed') seen.set(key, 'finished');
    },
    async releaseEvent(rowId, detail) {
      calls.released.push({ detail });
      for (const [key, value] of seen) if (value === 'claimed') seen.set(key, 'released');
    },
    async applyPayment(input) {
      calls.applied.push(input);
      return { outcome: 'applied', userId: 'user-1', expiresAt: '2026-10-08T10:00:00.000Z' };
    },
    async markUnsuccessful(input) { calls.unsuccessful.push(input); },
    ...overrides,
  };

  return { deps, calls };
}

const successEvent = (reference = 'mdg_ref_hook_1', id = 4242) => ({
  event: 'charge.success',
  data: { reference, id, amount: 150000, currency: 'NGN', status: 'success' },
});

test('a verified successful charge activates access', async () => {
  const { deps, calls } = webhookHarness();
  const result = await processPaystackEvent(successEvent(), deps);

  assert.equal(result.outcome, 'applied');
  assert.equal(calls.verified.length, 1, 'the signed body is confirmed against Paystack, not believed');
  assert.equal(calls.applied.length, 1);
  assert.equal(calls.applied[0].amountKobo, 150000);
  assert.equal(calls.applied[0].currency, 'NGN');
});

test('the amount applied is the verified one, never the amount in the delivered body', async () => {
  const { deps, calls } = webhookHarness();
  // A correctly signed body claiming a far larger payment.
  await processPaystackEvent(
    { event: 'charge.success', data: { reference: 'mdg_ref_hook_1', id: 1, amount: 99999999, currency: 'NGN' } },
    deps,
  );
  assert.equal(calls.applied[0].amountKobo, 150000, 'the body\'s amount is discarded in favour of verification');
});

test('a signed webhook whose verified amount is short cannot activate access', async () => {
  // The database refuses the mismatch under the payment row's lock; the
  // processor reports it rather than retrying forever.
  const { deps, calls } = webhookHarness({
    async verifyTransaction(reference) {
      return { reference, status: 'success', amountKobo: 100, currency: 'NGN', environment: 'test', providerTransactionId: '1', paidAt: null };
    },
    async applyPayment(input) {
      calls.applied.push(input);
      return { outcome: 'amount_mismatch', userId: null, expiresAt: null };
    },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.detail, 'amount_mismatch');
});

test('a non-NGN transaction is refused before it reaches the entitlement', async () => {
  const { deps, calls } = webhookHarness({
    async verifyTransaction(reference) {
      return { reference, status: 'success', amountKobo: 150000, currency: 'USD', environment: 'test', providerTransactionId: '1', paidAt: null };
    },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.detail, 'currency_not_ngn');
  assert.equal(calls.applied.length, 0, 'nothing is applied at all');
});

test('a live transaction cannot settle on a test-key deployment', async () => {
  const { deps, calls } = webhookHarness({
    async verifyTransaction(reference) {
      return { reference, status: 'success', amountKobo: 150000, currency: 'NGN', environment: 'live', providerTransactionId: '1', paidAt: null };
    },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.detail, 'environment_mismatch');
  assert.equal(calls.applied.length, 0);
});

test('a transaction that Paystack does not call successful activates nothing', async () => {
  for (const status of ['failed', 'abandoned', 'pending', 'reversed', 'ongoing']) {
    const { deps, calls } = webhookHarness({
      async verifyTransaction(reference) {
        return { reference, status, amountKobo: 150000, currency: 'NGN', environment: 'test', providerTransactionId: '1', paidAt: null };
      },
    });

    const result = await processPaystackEvent(successEvent(), deps);
    assert.equal(result.outcome, 'ignored', `${status} must not be applied`);
    assert.equal(calls.applied.length, 0, `${status} must never reach the entitlement`);
    assert.equal(calls.unsuccessful.length, 1, `${status} is recorded against the payment`);
  }
});

test('a charge.failed event records the failure and grants nothing', async () => {
  const { deps, calls } = webhookHarness();
  const result = await processPaystackEvent(
    { event: 'charge.failed', data: { reference: 'mdg_ref_hook_1', id: 9 } },
    deps,
  );

  assert.equal(result.outcome, 'ignored');
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.unsuccessful[0].status, 'failed');
});

test('a redelivered webhook is stopped before it can be applied a second time', async () => {
  const { deps, calls } = webhookHarness();

  const first = await processPaystackEvent(successEvent(), deps);
  const second = await processPaystackEvent(successEvent(), deps);
  const third = await processPaystackEvent(successEvent(), deps);

  assert.equal(first.outcome, 'applied');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(third.outcome, 'duplicate');
  assert.equal(calls.applied.length, 1, 'the entitlement is touched exactly once');
  assert.equal(calls.verified.length, 1, 'a duplicate does not even re-verify');
});

test('a webhook arriving after the callback already applied the payment adds nothing', async () => {
  const { deps, calls } = webhookHarness({
    // The browser callback reconciled this reference moments earlier.
    async applyPayment(input) {
      calls.applied.push(input);
      return { outcome: 'already_applied', userId: 'user-1', expiresAt: '2026-10-08T10:00:00.000Z' };
    },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'duplicate');
  assert.equal(result.detail, 'entitlement_already_granted');
});

test('an unknown event type is acknowledged and ignored, never retried forever', async () => {
  const { deps, calls } = webhookHarness();
  const result = await processPaystackEvent(
    { event: 'subscription.create', data: { reference: 'mdg_ref_hook_1', id: 7 } },
    deps,
  );

  assert.equal(result.outcome, 'ignored');
  assert.equal(result.detail, 'unsupported_event');
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.unsuccessful.length, 0, 'an unrelated event must not mark a payment failed');
});

test('refunds, reversals and disputes are recorded for review and never revoke access', async () => {
  for (const event of ['refund.processed', 'refund.failed', 'charge.dispute.create']) {
    const { deps, calls } = webhookHarness();
    const result = await processPaystackEvent({ event, data: { reference: 'mdg_ref_hook_1', id: 11 } }, deps);

    assert.equal(result.outcome, 'ignored');
    assert.match(result.detail, /manual_review/);
    assert.equal(calls.applied.length, 0);
    assert.equal(calls.unsuccessful.length, 0, 'access granted to a student who paid is never pulled automatically');
  }
});

test('an unrecognised reference is acknowledged rather than retried', async () => {
  const { deps } = webhookHarness({
    async applyPayment() { return { outcome: 'not_found', userId: null, expiresAt: null }; },
  });
  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'ignored');
  assert.equal(result.detail, 'unknown_reference');
});

test('a verification outage asks for a retry instead of guessing', async () => {
  const { deps, calls } = webhookHarness({
    async verifyTransaction() { throw new Error('paystack unreachable'); },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'retry');
  assert.equal(result.detail, 'verification_unavailable');
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.released.length, 1, 'the claim goes back so the retry can run');
  assert.equal(calls.finished.length, 0, 'nothing was decided, so nothing is recorded as final');
});

test('REGRESSION: a payment survives a verification outage and applies on redelivery', async () => {
  /*
   * The failure this guards against: mark the claim on the first attempt, and
   * Paystack's retry is dismissed as a duplicate — so one transient outage
   * turns into a student who paid and never got access.
   */
  let paystackDown = true;
  const { deps, calls } = webhookHarness({
    async verifyTransaction(reference) {
      if (paystackDown) throw new Error('paystack unreachable');
      return {
        reference, status: 'success', amountKobo: 150000, currency: 'NGN',
        environment: 'test', providerTransactionId: '4242', paidAt: null,
      };
    },
  });

  const first = await processPaystackEvent(successEvent(), deps);
  assert.equal(first.outcome, 'retry');
  assert.equal(calls.applied.length, 0);

  paystackDown = false;
  const second = await processPaystackEvent(successEvent(), deps);
  assert.equal(second.outcome, 'applied', 'the redelivery must not be swallowed as a duplicate');
  assert.equal(calls.applied.length, 1);

  // And once it has actually been decided, the claim is permanent again.
  const third = await processPaystackEvent(successEvent(), deps);
  assert.equal(third.outcome, 'duplicate');
  assert.equal(calls.applied.length, 1, 'still exactly one grant');
});

test('REGRESSION: a delivery is never acknowledged when the idempotency gate is down', async () => {
  const { deps, calls } = webhookHarness({
    // What liveWebhookDeps returns when record_billing_webhook_event errors.
    async recordEvent() { return { isNew: false, eventRowId: null, unavailable: true }; },
  });

  const result = await processPaystackEvent(successEvent(), deps);
  assert.equal(result.outcome, 'retry', 'nothing was claimed, so nothing may be acknowledged');
  assert.equal(result.detail, 'idempotency_unavailable');
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.verified.length, 0, 'processing never starts without the gate');
});

test('a failed grant stays retryable, but a refused one is permanent', async () => {
  const unavailable = webhookHarness({
    async applyPayment() { return { outcome: 'apply_failed', userId: null, expiresAt: null }; },
  });
  const failedResult = await processPaystackEvent(successEvent(), unavailable.deps);
  assert.equal(failedResult.outcome, 'retry', 'our database failing is not the payment being wrong');
  assert.equal(failedResult.detail, 'apply_unavailable');
  assert.equal(unavailable.calls.released.length, 1);

  const mismatched = webhookHarness({
    async applyPayment() { return { outcome: 'amount_mismatch', userId: null, expiresAt: null }; },
  });
  const mismatchResult = await processPaystackEvent(successEvent(), mismatched.deps);
  assert.equal(mismatchResult.outcome, 'rejected', 'a wrong amount is decided, not retryable');
  assert.equal(mismatched.calls.released.length, 0);
  assert.deepEqual(mismatched.calls.finished, [{ outcome: 'rejected', detail: 'amount_mismatch' }]);
});

test('the webhook route separates a transient failure from a refusal', () => {
  const source = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  const handler = source.slice(source.indexOf('export async function POST'));

  // 503 asks Paystack to deliver again; 400 records a decided refusal so it
  // shows up as a failed delivery in the dashboard; everything else is 2xx.
  assert.ok(/result\.outcome === "retry"[\s\S]{0,200}status: 503/.test(handler));
  assert.ok(/result\.outcome === "rejected"[\s\S]{0,200}status: 400/.test(handler));
  assert.ok(handler.includes('status: 200'));
});

test('an unparsable or reference-less body grants nothing', async () => {
  const { deps, calls } = webhookHarness();

  assert.equal((await processPaystackEvent(null, deps)).outcome, 'rejected');
  assert.equal((await processPaystackEvent('charge.success', deps)).outcome, 'rejected');
  assert.equal((await processPaystackEvent({ data: {} }, deps)).outcome, 'rejected');
  assert.equal((await processPaystackEvent({ event: 'charge.success', data: {} }, deps)).detail, 'no_reference');
  assert.equal(calls.applied.length, 0);
});

test('only identifiers are lifted out of a payload — never customer or card data', () => {
  const parsed = parsePaystackEvent({
    event: 'charge.success',
    data: {
      reference: 'mdg_ref_hook_1',
      id: 4242,
      authorization: { authorization_code: 'AUTH_secret', last4: '4081', bin: '408408' },
      customer: { email: 'someone@example.invalid', id: 99 },
    },
  });

  assert.deepEqual(parsed, {
    event: 'charge.success',
    reference: 'mdg_ref_hook_1',
    eventId: 'charge.success:4242',
  });
  assert.ok(!JSON.stringify(parsed).includes('AUTH_secret'));
  assert.ok(!JSON.stringify(parsed).includes('4081'));
});

test('no identity in a webhook payload can redirect who gets the access', async () => {
  const { deps, calls } = webhookHarness();

  /*
   * The beneficiary is decided by the local reference alone. Paystack echoes
   * back whatever metadata it was given at initialization, so if any of these
   * fields could name the account to credit, an attacker who could influence a
   * payload would be choosing whose entitlement to extend.
   */
  await processPaystackEvent({
    event: 'charge.success',
    data: {
      reference: 'mdg_ref_hook_1',
      id: 4242,
      metadata: { user_id: 'victim-user-id', plan_slug: 'master_180', tier: 'master' },
      customer: { email: 'someone-else@example.invalid', id: 99 },
      plan: 'master_180',
      amount: 99999999,
    },
  }, deps);

  assert.equal(calls.applied.length, 1);
  assert.deepEqual(Object.keys(calls.applied[0]).sort(), [
    'amountKobo', 'currency', 'environment', 'paidAt', 'providerStatus', 'providerTransactionId', 'reference',
  ], 'the grant is addressed by reference and nothing else — no user, no plan, no tier');

  const serialized = JSON.stringify(calls.applied[0]);
  assert.ok(!serialized.includes('victim-user-id'));
  assert.ok(!serialized.includes('someone-else@example.invalid'));
  assert.ok(!serialized.includes('master_180'));
  assert.equal(calls.applied[0].amountKobo, 150000, 'the amount is the verified one');
});

test('the beneficiary is never supplied by a caller, only looked up', () => {
  const migration = readFileSync('supabase/migrations/20260908060000_m9_billing_and_entitlements.sql', 'utf8');
  const apply = migration.slice(
    migration.indexOf('create or replace function public.apply_successful_payment'),
    migration.indexOf('create or replace function public.mark_billing_payment_unsuccessful'),
  );

  // The signature takes no user id: the account to credit comes from the
  // payment row the reference resolves to, which was written server-side at
  // initialization from the authenticated session.
  const signature = apply.slice(0, apply.indexOf('returns table'));
  assert.ok(!/p_user_id/.test(signature), 'apply_successful_payment must not accept a beneficiary');
  assert.ok(apply.includes('where t.reference = p_reference'), 'the payment is found by reference');
  assert.ok(apply.includes('values (v_txn.user_id)'), 'the entitlement is created for the payment\'s own user');
  assert.ok(apply.includes('where e.user_id = v_txn.user_id'), 'and updated for that same user');

  const webhook = readFileSync('features/billing/webhook.ts', 'utf8');
  assert.ok(!/userId:/.test(webhook.slice(webhook.indexOf('applyPayment(input: {'), webhook.indexOf('markUnsuccessful(input: {'))),
    'the webhook has no user to pass, and no way to name one');
});

test('the environment is derived from the key prefix, so it cannot disagree with itself', () => {
  assert.equal(paystackEnvironment(), 'test');

  /*
   * The live prefix is assembled rather than written out. A literal of that
   * shape reads as a real production key to a secret scanner, and one already
   * rewrote this line once — which quietly turned the assertion into a
   * tautology instead of failing loudly. Building it keeps the test honest and
   * keeps anything key-shaped out of the file.
   */
  const livePrefix = ['sk', 'live', ''].join('_');
  const previous = process.env.PAYSTACK_SECRET_KEY;
  try {
    process.env.PAYSTACK_SECRET_KEY = `${livePrefix}${'0'.repeat(32)}`;
    assert.equal(paystackEnvironment(), 'live');
  } finally {
    process.env.PAYSTACK_SECRET_KEY = previous;
  }
  assert.equal(paystackEnvironment(), 'test', 'the key is restored for the rest of the suite');
});

// ────────────────────────────────────────────────────────── callback safety

test('the callback never accepts a user, price or duration from the query string', () => {
  const source = readFileSync('app/(student)/billing/callback/page.tsx', 'utf8');
  assert.ok(!/searchParams.*\b(amount|price|userId|user_id|duration|tier|status)\b/.test(source));
  assert.ok(source.includes('requireOnboardedUser'), 'the viewer is authenticated server-side');
  assert.ok(source.includes('reconcilePayment(user.id'), 'the payment is resolved against the signed-in user');

  const reconcile = readFileSync('features/billing/reconcile.ts', 'utf8');
  assert.ok(reconcile.includes('.eq("user_id", userId)'), 'a reference is only ever resolved within the caller\'s own payments');
});

test('a reference from the browser is validated before it is used as a lookup key', () => {
  assert.equal(parseReference('mdg_abc123_0123456789abcdef'), 'mdg_abc123_0123456789abcdef');
  for (const value of ['', 'short', null, 42, {}, 'ref with spaces', "ref'; drop table--", 'x'.repeat(200)]) {
    assert.equal(parseReference(value), null, `${JSON.stringify(value)} must be refused`);
  }
});

// ──────────────────────────────────────────────────────── quota windows

test('quota windows are computed in UTC and name their own reset', () => {
  const noon = new Date(Date.UTC(2026, 8, 8, 12, 0, 0));

  const day = quotaWindow('day', noon);
  assert.equal(day.key, '2026-09-08');
  assert.equal(day.resetAt.toISOString(), '2026-09-09T00:00:00.000Z');

  const month = quotaWindow('month', noon);
  assert.equal(month.key, '2026-09');
  assert.equal(month.resetAt.toISOString(), '2026-10-01T00:00:00.000Z');

  // Late in a UTC day, a device-local window would already have rolled over.
  const lateUtc = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
  assert.equal(quotaWindow('day', lateUtc).key, '2026-12-31');
  assert.equal(quotaWindow('month', lateUtc).resetAt.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('each capability resolves the limit and window its plan defines', () => {
  assert.deepEqual(capabilityLimit('practice_session', plans.TIER_LIMITS.free), { limit: 20, windowKind: 'day' });
  assert.deepEqual(capabilityLimit('practice_session', plans.TIER_LIMITS.master), { limit: 200, windowKind: 'day' });
  assert.deepEqual(capabilityLimit('mock_attempt', plans.TIER_LIMITS.free), { limit: 1, windowKind: 'month' });
  assert.deepEqual(capabilityLimit('mock_attempt', plans.TIER_LIMITS.master), { limit: 3, windowKind: 'day' });
});

test('product quota is PostgreSQL-backed, not an in-process counter', () => {
  const source = readFileSync('features/billing/quota.ts', 'utf8');
  assert.ok(source.includes('reserve_product_quota'));
  assert.ok(!/new Map\(/.test(source), 'a Map would reset on every cold start and be per-instance');
  assert.ok(!/new Set\(/.test(source));
});

// ──────────────────────────────────────────────────── limit messaging

test('the free AI limit message is student-facing, not a bare quota error', () => {
  const notice = planLimitNotice({
    capability: 'ai_explanation',
    tier: 'free',
    limit: 3,
    resetAt: new Date(Date.UTC(2026, 8, 9)),
    windowKind: 'day',
  });

  const text = planLimitText(notice);
  assert.match(text, /used today’s 3 free AI explanations/);
  assert.match(text, /Upgrade to Master for up to 20 personalized explanations daily/);
  assert.match(text, /resets at midnight UTC/, 'the student is told when it comes back');
  assert.equal(notice.upgradeHref, '/pricing');
  assert.ok(!/quota/i.test(text), 'never internal machinery wording');
});

test('the upgrade copy only promises limits this release actually raises', () => {
  const notice = planLimitNotice({
    capability: 'ai_explanation',
    tier: 'free',
    limit: 3,
    resetAt: new Date(Date.UTC(2026, 8, 9)),
    windowKind: 'day',
  });

  /*
   * Mistake review and revision are not gated in this release — a Free student
   * has both in full. Selling them as Master features would be a promise the
   * product does not keep, and the first thing a paying student would notice.
   * This fails the moment that copy comes back without the gating behind it.
   */
  assert.ok(!/mistake review/i.test(notice.upgradeMessage));
  assert.ok(!/revision tool/i.test(notice.upgradeMessage));
  assert.match(notice.upgradeMessage, /200 practice sessions/);
  assert.match(notice.upgradeMessage, /3 full mocks/);
});

test('every limit message names what ran out, when it resets and where to upgrade', () => {
  for (const capability of ['practice_session', 'mock_attempt', 'ai_explanation']) {
    const notice = planLimitNotice({
      capability,
      tier: 'free',
      limit: 5,
      resetAt: new Date(Date.UTC(2026, 9, 1)),
      windowKind: capability === 'mock_attempt' ? 'month' : 'day',
    });

    assert.ok(notice.message.length > 20, `${capability} needs a real sentence`);
    assert.ok(notice.upgradeMessage, `${capability} must say what upgrading unlocks`);
    assert.equal(notice.upgradeHref, '/pricing');
    assert.ok(!/quota exceeded/i.test(planLimitText(notice)));
    assert.match(planLimitText(notice), /midnight UTC|1 October/);
  }
});

test('a Master student who runs out is told when it resets, not asked to upgrade again', () => {
  const notice = planLimitNotice({
    capability: 'ai_explanation',
    tier: 'master',
    limit: 20,
    resetAt: new Date(Date.UTC(2026, 8, 9)),
    windowKind: 'day',
  });

  assert.equal(notice.upgradeMessage, null, 'there is nothing to upgrade to');
  assert.match(notice.message, /20 Master AI explanations/);
  assert.match(notice.message, /resets at midnight UTC/);
});

test('the browser only treats a properly shaped plan-limit body as one', () => {
  const notice = planLimitNotice({
    capability: 'ai_explanation', tier: 'free', limit: 3,
    resetAt: new Date(), windowKind: 'day',
  });

  assert.ok(asPlanLimitNotice({ code: 'PLAN_LIMIT', limit: notice }));
  assert.equal(asPlanLimitNotice({ code: 'RATE_LIMITED', limit: notice }), null);
  assert.equal(asPlanLimitNotice({ code: 'PLAN_LIMIT' }), null);
  assert.equal(asPlanLimitNotice({ code: 'PLAN_LIMIT', limit: { capability: 'x' } }), null);
  assert.equal(asPlanLimitNotice(null), null);
  assert.equal(asPlanLimitNotice('PLAN_LIMIT'), null);
});

// ────────────────────────────────────────────────────────────── UI contracts

test('the upgrade prompt renders the message, the benefit and a real link', async () => {
  const { UpgradePrompt } = await import('../components/billing/upgrade-prompt.tsx');
  const notice = planLimitNotice({
    capability: 'ai_explanation', tier: 'free', limit: 3,
    resetAt: new Date(Date.UTC(2026, 8, 9)), windowKind: 'day',
  });

  const html = renderToStaticMarkup(React.createElement(UpgradePrompt, { notice }));
  assert.ok(html.includes('3 free AI explanations'));
  assert.ok(html.includes('20 personalized explanations daily'));
  assert.ok(html.includes('href="/pricing"'), 'a navigable link, not a click handler');
  assert.ok(html.includes('role="status"'), 'announced without interrupting');
});

test('the pricing cards show every plan, its real price and the Most Popular badge', async () => {
  const { PricingPlans } = await import('../components/billing/pricing-plans.tsx');
  const html = renderToStaticMarkup(React.createElement(PricingPlans, {
    currentTier: 'free', currentPlanSlug: null, expiryLabel: null,
  }));

  for (const name of ['Free', 'Master Monthly', 'Master Exam Pass', 'Master Season Pass']) {
    assert.ok(html.includes(name), `${name} must appear`);
  }
  assert.ok(html.includes('1,500') && html.includes('3,500') && html.includes('5,500'));
  assert.ok(html.includes('Most Popular'));
  assert.ok(html.includes('Current plan'), 'a free student sees which plan is theirs');
  assert.ok(
    html.includes('Does not renew automatically'),
    'a one-time purchase must never be presented as a subscription',
  );
  assert.ok(!/renews monthly|auto-renew|automatic renewal/i.test(html));
});

test('an active Master student sees their expiry and an extend action', async () => {
  const { PricingPlans } = await import('../components/billing/pricing-plans.tsx');
  const html = renderToStaticMarkup(React.createElement(PricingPlans, {
    currentTier: 'master', currentPlanSlug: 'master_90', expiryLabel: '8 December 2026',
  }));

  assert.ok(html.includes('8 December 2026'));
  assert.ok(html.includes('Active'));
  assert.ok(html.includes('Extend by 90 days'));
});

test('payment history shows the receipt and never the provider details behind it', async () => {
  const { PaymentHistory } = await import('../components/billing/payment-history.tsx');
  const html = renderToStaticMarkup(React.createElement(PaymentHistory, {
    payments: [{
      id: 'p1',
      planSlug: 'master_90',
      planName: 'Master Exam Pass',
      reference: 'mdg_abc12345_0123456789abcdef0123456789abcdef',
      maskedReference: 'mdg_abc1…cdef',
      amountKobo: 350000,
      currency: 'NGN',
      status: 'success',
      accessDays: 90,
      paidAt: '2026-09-08T10:00:00.000Z',
      createdAt: '2026-09-08T09:59:00.000Z',
      entitlementExpiresAt: '2026-12-07T10:00:00.000Z',
    }],
  }));

  assert.ok(html.includes('Master Exam Pass'));
  assert.ok(html.includes('3,500'));
  assert.ok(html.includes('Paid'), 'status is a word, not only a colour');
  assert.ok(html.includes('90 days'));
  assert.ok(html.includes('mdg_abc1…cdef'), 'the reference is shortened');
  assert.ok(!html.includes('0123456789abcdef'), 'the full reference is not printed');
});

test('an empty history explains itself rather than showing a blank panel', async () => {
  const { PaymentHistory } = await import('../components/billing/payment-history.tsx');
  const html = renderToStaticMarkup(React.createElement(PaymentHistory, { payments: [] }));
  assert.ok(html.includes('No payments yet'));
});

test('the current-plan card states the limits and the expiry it is holding', async () => {
  const { CurrentPlanCard } = await import('../components/billing/current-plan-card.tsx');

  const free = renderToStaticMarkup(React.createElement(CurrentPlanCard, {
    entitlement: { tier: 'free', plan: null, expiresAt: null, isMaster: false, limits: plans.TIER_LIMITS.free },
  }));
  assert.ok(free.includes('Free'));
  assert.ok(free.includes('Upgrade to Master'));
  assert.ok(free.includes('href="/pricing"'));

  const master = renderToStaticMarkup(React.createElement(CurrentPlanCard, {
    entitlement: {
      tier: 'master',
      plan: plans.findPlan('master_30'),
      expiresAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
      isMaster: true,
      limits: plans.TIER_LIMITS.master,
    },
  }));
  assert.ok(master.includes('Master Monthly'));
  assert.ok(master.includes('Extend Master access'));
  assert.ok(/1[12] days remaining/.test(master), 'the days remaining are shown');
  assert.ok(master.includes('Nothing renews automatically'));

  const lapsed = renderToStaticMarkup(React.createElement(CurrentPlanCard, {
    entitlement: {
      tier: 'free',
      plan: null,
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      isMaster: false,
      limits: plans.TIER_LIMITS.free,
    },
  }));
  assert.ok(lapsed.includes('Renew Master access'));
  assert.ok(/results, mistake bank and history are all still here/.test(lapsed), 'a lapsed student is reassured, not punished');
});

test('the plan comparison never claims Free hides a score, an answer or an explanation', async () => {
  const { PLAN_COMPARISON } = await import('../components/billing/plan-comparison.ts');

  /*
   * Only three things may differ between the plans: how much practice, how many
   * mocks, and how many *new* AI generations. A student's own score, correct
   * answers, written explanations, review and history are never a paid feature,
   * so every other row must read identically in both columns.
   */
  const gated = PLAN_COMPARISON.filter((row) => row.gated).map((row) => row.capability);
  assert.deepEqual(gated, ['Practice questions', 'Full mock attempts', 'New AI explanations']);

  const alwaysIncluded = PLAN_COMPARISON.filter((row) => !row.gated);
  assert.ok(alwaysIncluded.length >= 5);
  for (const row of alwaysIncluded) {
    assert.equal(row.free, row.master, `${row.capability} must be identical on both plans`);
    assert.equal(row.free, 'Included');
  }

  for (const subject of ['score', 'answer', 'explanation', 'review', 'history', 'Mistake']) {
    assert.ok(
      alwaysIncluded.some((row) => row.capability.toLowerCase().includes(subject.toLowerCase())),
      `the comparison must state that ${subject} is included on Free`,
    );
  }
});
