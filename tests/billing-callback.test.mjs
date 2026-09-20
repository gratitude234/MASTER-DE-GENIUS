import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The query string Paystack actually sends a student back with.
 *
 * Paystack appends `trxref` and `reference` to whatever `callback_url` it was
 * given — with `&`, never overwriting what is already there. A `callback_url`
 * that carried its own `?reference=` therefore landed the student on a URL with
 * the key `reference` present twice, which Next.js parses as an array rather
 * than a string. Every test below works from a real landing URL parsed by
 * Next's own query parser, so the shape under test is the shape production
 * gets, not one invented here.
 *
 * Reading a reference out of that URL is the *only* thing the callback is
 * trusted for. Whether money moved, what it bought and whose account it belongs
 * to are still settled server-side, against a payment this server created for
 * this user, verified against Paystack's own API.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

// Next's own parser, so "what does a duplicate key look like?" is answered by
// the framework rather than assumed by the test.
const { searchParamsToUrlQuery } = await import(
  new URL('../node_modules/next/dist/shared/lib/router/utils/querystring.js', import.meta.url).href
);

/** Exactly what Next.js hands a server page for a given landing URL. */
const searchParamsFor = (url) => searchParamsToUrlQuery(new URL(url, 'https://master.example.invalid').searchParams);

// A stand-in secret, invented here. It is not a Paystack key and never was.
const TEST_SECRET = 'sk_test_0000000000000000000000000000000000000000';
process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
process.env.NEXT_PUBLIC_APP_URL = 'https://master.example.invalid';

const ALICE = 'alice-user-id';
const BOB = 'bob-user-id';
const REFERENCE = 'mdg_m1abc_0123456789abcdef0123456789abcdef';

/**
 * The payment ledger and the entitlement authority, in memory.
 *
 * `applyPayment` and `markUnsuccessful` are defined once, here, and used by
 * both the callback's admin client and the webhook's deps — so a callback
 * racing a webhook races over one ledger, the way it does in production,
 * instead of over two mocks that cannot contend.
 */
const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      rows: [],
      entitlements: {},
      grants: 0,
      verified: { status: 'success', amount: 350000, currency: 'NGN', domain: 'test' },
      calls: { rpc: [], lookups: [], verifications: [] },
    }, overrides);
  },
  row(overrides = {}) {
    const row = {
      user_id: ALICE,
      reference: REFERENCE,
      plan_slug: 'master_90',
      amount_kobo: 350000,
      currency: 'NGN',
      access_days: 90,
      status: 'pending',
      environment: 'test',
      entitlement_expires_at: null,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  },
  /** Mirrors `apply_successful_payment`: one locked function, one grant. */
  applyPayment(args) {
    const row = this.rows.find((candidate) => candidate.reference === args.p_reference);
    if (!row) return { outcome: 'not_found', user_id: null, expires_at: null };
    if (row.status === 'success') {
      return { outcome: 'already_applied', user_id: row.user_id, expires_at: row.entitlement_expires_at };
    }
    if (row.status !== 'pending') return { outcome: 'not_pending', user_id: null, expires_at: null };
    if (args.p_amount_kobo !== row.amount_kobo) return { outcome: 'amount_mismatch', user_id: null, expires_at: null };
    if (args.p_currency !== row.currency) return { outcome: 'currency_mismatch', user_id: null, expires_at: null };
    if (args.p_environment !== row.environment) return { outcome: 'environment_mismatch', user_id: null, expires_at: null };

    row.status = 'success';
    row.entitlement_expires_at = '2026-12-07T00:00:00.000Z';
    this.grants += 1;
    this.entitlements[row.user_id] = { tier: 'master', expiresAt: row.entitlement_expires_at };
    return { outcome: 'applied', user_id: row.user_id, expires_at: row.entitlement_expires_at };
  },
  /** Mirrors `mark_billing_payment_unsuccessful`: only a pending row ever moves. */
  markUnsuccessful(args) {
    const row = this.rows.find((candidate) => candidate.reference === args.p_reference);
    if (row && row.status === 'pending') row.status = args.p_status;
    return { outcome: row ? 'recorded' : 'not_found' };
  },
};
world.reset();
globalThis.__callback = world;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/supabase/admin') {
      return stub(`
        export function createAdminClient() {
          const world = globalThis.__callback;
          return {
            from(table) {
              const filters = {};
              const builder = {
                select() { return builder; },
                eq(column, value) { filters[column] = value; return builder; },
                async maybeSingle() {
                  world.calls.lookups.push({ table, filters: { ...filters } });
                  const found = world.rows.find((row) =>
                    Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null;
                  return { data: found, error: null };
                },
              };
              return builder;
            },
            async rpc(name, args) {
              world.calls.rpc.push({ name, args });
              if (name === 'apply_successful_payment') return { data: [world.applyPayment(args)], error: null };
              if (name === 'mark_billing_payment_unsuccessful') return { data: [world.markUnsuccessful(args)], error: null };
              return { data: [], error: null };
            },
          };
        }
      `);
    }
    return next(specifier, context);
  },
});

const { reconcilePayment, parseCallbackReference } = await import('../features/billing/reconcile.ts');
const { processPaystackEvent } = await import('../features/billing/webhook.ts');
const { checkoutCallbackUrl } = await import('../features/billing/checkout.ts');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (!url.startsWith('https://api.paystack.co/transaction/verify/')) {
    throw new Error(`unexpected network call: ${url}`);
  }
  const reference = decodeURIComponent(url.split('/').pop());
  world.calls.verifications.push(reference);
  return new Response(JSON.stringify({
    status: true,
    data: {
      reference,
      status: world.verified.status,
      amount: world.verified.amount,
      currency: world.verified.currency,
      domain: world.verified.domain,
      id: 4242,
      paid_at: '2026-09-08T10:00:00.000Z',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
test.after(() => { globalThis.fetch = originalFetch; });
test.beforeEach(() => { world.reset(); });

/** The webhook's half of the race, over the same ledger the callback uses. */
function webhookDeps() {
  const seen = new Map();
  return {
    environment: 'test',
    async verifyTransaction(reference) {
      world.calls.verifications.push(reference);
      return {
        reference,
        status: world.verified.status,
        amountKobo: world.verified.amount,
        currency: world.verified.currency,
        environment: world.verified.domain === 'live' ? 'live' : 'test',
        providerTransactionId: '4242',
        paidAt: '2026-09-08T10:00:00.000Z',
      };
    },
    async recordEvent({ eventId }) {
      const claimed = seen.get(eventId);
      if (claimed === undefined || claimed === 'released') {
        seen.set(eventId, 'claimed');
        return { isNew: true, eventRowId: 1 };
      }
      return { isNew: false, eventRowId: 1 };
    },
    async finishEvent() {},
    async releaseEvent() {},
    async applyPayment(input) {
      const row = world.applyPayment({
        p_reference: input.reference,
        p_amount_kobo: input.amountKobo,
        p_currency: input.currency,
        p_environment: input.environment,
      });
      return { outcome: row.outcome, userId: row.user_id, expiresAt: row.expires_at };
    },
    async markUnsuccessful(input) {
      world.markUnsuccessful({ p_reference: input.reference, p_status: input.status });
    },
  };
}

const successEvent = (reference = REFERENCE) => ({
  event: 'charge.success',
  data: { reference, id: 4242, amount: 350000, currency: 'NGN', status: 'success' },
});

// ────────────────────────────────── reading the reference out of the redirect

test('1: a callback carrying only `reference` resolves it', () => {
  assert.equal(
    parseCallbackReference(searchParamsFor(`/billing/callback?reference=${REFERENCE}`)),
    REFERENCE,
  );
});

test('2: a callback carrying only `trxref` resolves it', () => {
  assert.equal(
    parseCallbackReference(searchParamsFor(`/billing/callback?trxref=${REFERENCE}`)),
    REFERENCE,
  );
});

test('3: a callback carrying both `reference` and `trxref` in agreement resolves them', () => {
  assert.equal(
    parseCallbackReference(searchParamsFor(`/billing/callback?trxref=${REFERENCE}&reference=${REFERENCE}`)),
    REFERENCE,
  );
});

test('4: a callback carrying `reference` twice with the same value resolves it', () => {
  // The exact shape a `callback_url` with its own `?reference=` used to produce:
  // Paystack appends with `&`, so the key arrives twice and Next.js parses it
  // as an array. This is the regression.
  const landing = `/billing/callback?reference=${REFERENCE}&trxref=${REFERENCE}&reference=${REFERENCE}`;
  const params = searchParamsFor(landing);

  assert.ok(Array.isArray(params.reference), 'Next.js really does hand the page an array here');
  assert.equal(parseCallbackReference(params), REFERENCE);
});

test('5: a callback whose `reference` and `trxref` disagree resolves nothing', () => {
  const other = 'mdg_m1zzz_ffffffffffffffffffffffffffffffff';

  assert.equal(
    parseCallbackReference(searchParamsFor(`/billing/callback?reference=${REFERENCE}&trxref=${other}`)),
    null,
    'a conflict is refused rather than silently resolved to one of them',
  );
  assert.equal(
    parseCallbackReference(searchParamsFor(`/billing/callback?reference=${REFERENCE}&reference=${other}`)),
    null,
    'two different values under the same key are a conflict too',
  );
});

test('6: a callback carrying no reference at all resolves nothing', () => {
  for (const landing of ['/billing/callback', '/billing/callback?reference=', '/billing/callback?trxref=']) {
    assert.equal(parseCallbackReference(searchParamsFor(landing)), null, `${landing} must resolve nothing`);
  }
  assert.equal(parseCallbackReference(undefined), null);
});

test('a reference that is not shaped like one of ours is refused before any lookup', () => {
  for (const value of ['short', 'ref with spaces', "ref'; drop table--", 'x'.repeat(200)]) {
    assert.equal(parseCallbackReference({ reference: value }), null, `${JSON.stringify(value)} must be refused`);
  }
});

// ──────────────────────────────────────────────── the callback URL we build

test('the callback URL carries no reference of its own, so Paystack cannot duplicate one', () => {
  const url = checkoutCallbackUrl('https://master.example.invalid/');
  assert.equal(url, 'https://master.example.invalid/billing/callback');
  assert.ok(!url.includes('?'), 'a query string here is what Paystack appends onto, producing a duplicate key');

  // And the URL Paystack then lands the student on still resolves cleanly.
  const landing = `${url}?trxref=${REFERENCE}&reference=${REFERENCE}`;
  assert.equal(parseCallbackReference(searchParamsFor(landing)), REFERENCE);
});

test('the callback page reads its reference through the shared parser', () => {
  const source = readFileSync('app/(student)/billing/callback/page.tsx', 'utf8');

  assert.ok(source.includes('parseCallbackReference'), 'the page does not parse the query string by hand');
  assert.ok(
    !/params\.reference\s*\?\?/.test(source),
    'the `??` chain cannot tell an array from a string and is what broke this',
  );
  assert.ok(source.includes('requireOnboardedUser'), 'the viewer is authenticated server-side');
  assert.ok(source.includes('reconcilePayment(user.id'), 'the payment is resolved against the signed-in user');
});

// ───────────────────────────────────────────────── resolving it to a payment

test('7: a duplicated reference for a payment this student owns resolves to that payment', async () => {
  const row = world.row();
  const params = searchParamsFor(`/billing/callback?reference=${row.reference}&trxref=${row.reference}&reference=${row.reference}`);

  const result = await reconcilePayment(ALICE, parseCallbackReference(params));

  assert.equal(result.state, 'success');
  assert.equal(result.activated, true);
  assert.equal(result.planName, 'Master Exam Pass');
  assert.deepEqual(world.calls.lookups[0].filters, { reference: row.reference, user_id: ALICE });
  assert.equal(world.entitlements[ALICE].tier, 'master');
});

test('8: a reference with no payment on this account resolves to unknown, and grants nothing', async () => {
  world.row();

  const invented = await reconcilePayment(ALICE, 'mdg_m1qqq_11111111111111111111111111111111');
  assert.equal(invented.state, 'unknown');
  assert.equal(invented.activated, false);

  // Somebody else's real reference answers exactly the same way, so the page
  // cannot be used to discover which references exist.
  const someoneElses = await reconcilePayment(BOB, REFERENCE);
  assert.equal(someoneElses.state, 'unknown');
  assert.equal(someoneElses.activated, false);
  assert.equal(world.entitlements[BOB], undefined);
  assert.equal(world.grants, 0);
  assert.deepEqual(world.calls.verifications, [], 'a payment we do not hold costs no Paystack call');
});

// ─────────────────────────────────────────────────────── test and live modes

test('9: a test-mode transaction under a test secret activates access', async () => {
  const row = world.row({ environment: 'test' });

  const result = await reconcilePayment(ALICE, parseCallbackReference({ reference: row.reference }));

  assert.equal(result.state, 'success');
  assert.equal(result.activated, true);
  const applied = world.calls.rpc.find((call) => call.name === 'apply_successful_payment');
  assert.equal(applied.args.p_environment, 'test', 'the verified domain, not a client-supplied one');
  assert.equal(world.grants, 1);
});

test('10: a live-domain transaction under a test secret activates nothing', async () => {
  world.reset({ verified: { status: 'success', amount: 350000, currency: 'NGN', domain: 'live' } });
  const row = world.row({ environment: 'test' });

  const result = await reconcilePayment(ALICE, parseCallbackReference({ reference: row.reference }));

  assert.equal(result.state, 'pending', 'the student is never told a mismatched payment succeeded');
  assert.equal(result.activated, false);
  assert.equal(world.entitlements[ALICE], undefined);
  assert.equal(world.grants, 0);
  assert.ok(
    !world.calls.rpc.some((call) => call.name === 'apply_successful_payment'),
    'the mismatch is caught before the grant is even attempted',
  );
});

// ───────────────────────────────────────────── callback and webhook, racing

test('11: a callback arriving after the webhook already applied reports success once', async () => {
  const row = world.row();

  const hook = await processPaystackEvent(successEvent(row.reference), webhookDeps());
  assert.equal(hook.outcome, 'applied');
  assert.equal(world.grants, 1);

  const params = searchParamsFor(`/billing/callback?reference=${row.reference}&trxref=${row.reference}&reference=${row.reference}`);
  const result = await reconcilePayment(ALICE, parseCallbackReference(params));

  assert.equal(result.state, 'success');
  assert.equal(result.activated, true);
  assert.equal(result.expiresAt, '2026-12-07T00:00:00.000Z');
  assert.equal(world.grants, 1, 'the settled row is read, never granted a second time');
  assert.ok(
    !world.calls.rpc.some((call) => call.name === 'apply_successful_payment'),
    'a row already marked success costs no second application',
  );
});

test('12: a webhook arriving after the callback already applied is a duplicate, not a second grant', async () => {
  const row = world.row();

  const result = await reconcilePayment(ALICE, parseCallbackReference({ reference: row.reference }));
  assert.equal(result.state, 'success');
  assert.equal(world.grants, 1);

  const hook = await processPaystackEvent(successEvent(row.reference), webhookDeps());

  assert.equal(hook.outcome, 'duplicate');
  assert.equal(hook.detail, 'entitlement_already_granted');
  assert.equal(world.grants, 1, 'one payment extends access exactly once');
  assert.deepEqual(world.entitlements[ALICE], { tier: 'master', expiresAt: '2026-12-07T00:00:00.000Z' });
});
