import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * Getting a paid student off Free, and closing a payment that will never
 * settle.
 *
 * Two failures put a student in the same place. A payment that succeeded at
 * Paystack but whose callback the student never completed and whose webhook
 * never arrived stays `pending` locally for ever, and the student stays Free
 * while their money is gone. A payment Paystack later reversed used to do the
 * same thing for the opposite reason: nothing closed it, so it sat pending
 * waiting for an event that was never coming.
 *
 * The recovery path is deliberately not "trust the pending row". Every test
 * below asserts the same shape: the authority is an authenticated student, a
 * payment that belongs to *them*, a server-to-server answer from Paystack, and
 * `apply_successful_payment`. A pending row is a question, never an answer.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;

const TEST_SECRET = 'sk_test_0000000000000000000000000000000000000000';
process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
process.env.NEXT_PUBLIC_APP_URL = 'https://master.example.invalid';

const ALICE = 'alice-user-id';
const BOB = 'bob-user-id';

/** The payment ledger and the entitlement authority, in memory. */
const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      rows: [],
      entitlements: {},
      verified: { status: 'success', amount: 350000, currency: 'NGN', domain: 'test' },
      verifyFails: false,
      lookupFails: false,
      calls: { rpc: [], lookups: [], verifications: [] },
    }, overrides);
  },
  row(overrides = {}) {
    const row = {
      user_id: ALICE,
      reference: 'mdg_stuck_1',
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
};
world.reset();
globalThis.__recovery = world;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return { url: NEXT_SERVER_URL, shortCircuit: true };

    /*
     * A small stand-in for the two database contracts this path depends on: the
     * user-scoped payment lookup, and the RPCs that are the only things allowed
     * to change a payment. The real PostgreSQL behaviour of those functions is
     * covered against a real Postgres in billing-database.test.mjs; what is
     * under test here is which of them the application calls, with what, and in
     * response to what Paystack said.
     */
    if (specifier === '@/lib/supabase/admin') {
      return stub(`
        export function createAdminClient() {
          const world = globalThis.__recovery;
          return {
            from(table) {
              const filters = {};
              const builder = {
                select() { return builder; },
                eq(column, value) { filters[column] = value; return builder; },
                async maybeSingle() {
                  world.calls.lookups.push({ table, filters: { ...filters } });
                  if (world.lookupFails) return { data: null, error: { code: 'PGRST301' } };
                  const found = world.rows.find((row) =>
                    Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null;
                  return { data: found, error: null };
                },
              };
              return builder;
            },
            async rpc(name, args) {
              world.calls.rpc.push({ name, args });
              const row = world.rows.find((candidate) => candidate.reference === args.p_reference);

              if (name === 'apply_successful_payment') {
                if (!row) return { data: [{ outcome: 'not_found', expires_at: null }], error: null };
                if (row.status === 'success') {
                  return { data: [{ outcome: 'already_applied', expires_at: row.entitlement_expires_at }], error: null };
                }
                if (row.status !== 'pending') return { data: [{ outcome: 'not_pending', expires_at: null }], error: null };
                if (args.p_amount_kobo !== row.amount_kobo) return { data: [{ outcome: 'amount_mismatch', expires_at: null }], error: null };
                if (args.p_currency !== row.currency) return { data: [{ outcome: 'currency_mismatch', expires_at: null }], error: null };
                if (args.p_environment !== row.environment) return { data: [{ outcome: 'environment_mismatch', expires_at: null }], error: null };
                row.status = 'success';
                row.entitlement_expires_at = '2026-12-07T00:00:00.000Z';
                world.entitlements[row.user_id] = { tier: 'master', expiresAt: row.entitlement_expires_at };
                return { data: [{ outcome: 'applied', expires_at: row.entitlement_expires_at }], error: null };
              }

              if (name === 'mark_billing_payment_unsuccessful') {
                // Mirrors the real function: only a pending row ever moves, so a
                // successful payment is never demoted by a later event.
                if (row && row.status === 'pending') row.status = args.p_status;
                return { data: [{ outcome: row ? 'recorded' : 'not_found' }], error: null };
              }

              return { data: [], error: null };
            },
          };
        }
      `);
    }

    return next(specifier, context);
  },
});

const { reconcilePayment } = await import('../features/billing/reconcile.ts');
const { markRecoverablePayments } = await import('../features/billing/entitlements.ts');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (!url.startsWith('https://api.paystack.co/transaction/verify/')) {
    throw new Error(`unexpected network call: ${url}`);
  }
  const reference = decodeURIComponent(url.split('/').pop());
  world.calls.verifications.push(reference);

  if (world.verifyFails) return new Response('{"status":false}', { status: 503 });

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

const rpcNames = () => world.calls.rpc.map((call) => call.name);
const closedWith = () => world.calls.rpc.find((call) => call.name === 'mark_billing_payment_unsuccessful')?.args;

// ───────────────────────────────────────── M — the stuck payment, recovered

test('M: a recent pending payment that Paystack calls successful activates Master', async () => {
  const row = world.row();

  const result = await reconcilePayment(ALICE, row.reference);

  assert.equal(result.state, 'success');
  assert.equal(result.activated, true, 'the entitlement is confirmed locally, not merely paid upstream');
  assert.equal(result.planName, 'Master Exam Pass');
  assert.deepEqual(world.calls.verifications, [row.reference], 'recovery always asks Paystack directly');

  const applied = world.calls.rpc.find((call) => call.name === 'apply_successful_payment');
  assert.ok(applied, 'the grant goes through the one locked function, never a direct write');
  assert.equal(applied.args.p_amount_kobo, 350000, 'the verified amount, not a client-supplied one');
  assert.equal(applied.args.p_currency, 'NGN');
  assert.equal(applied.args.p_environment, 'test');
  assert.deepEqual(world.entitlements[ALICE], { tier: 'master', expiresAt: '2026-12-07T00:00:00.000Z' });
  assert.equal(row.status, 'success');
});

test('M: recovering twice grants access once', async () => {
  const row = world.row();

  const first = await reconcilePayment(ALICE, row.reference);
  const second = await reconcilePayment(ALICE, row.reference);

  assert.equal(first.state, 'success');
  assert.equal(second.state, 'success');
  assert.equal(second.activated, true);
  // The second pass reads the settled row and stops there: no second
  // verification, no second application, one entitlement extension.
  assert.equal(world.calls.verifications.length, 1);
  assert.equal(world.calls.rpc.filter((call) => call.name === 'apply_successful_payment').length, 1);
});

test('M: a recovered payment whose amount or environment does not match activates nothing', async () => {
  for (const [label, verified] of [
    ['short paid', { status: 'success', amount: 100, currency: 'NGN', domain: 'test' }],
    ['wrong currency', { status: 'success', amount: 350000, currency: 'USD', domain: 'test' }],
    ['live event, test row', { status: 'success', amount: 350000, currency: 'NGN', domain: 'live' }],
  ]) {
    world.reset({ verified });
    const row = world.row();

    const result = await reconcilePayment(ALICE, row.reference);

    assert.notEqual(result.state, 'success', `${label} must not activate access`);
    assert.equal(result.activated, false);
    assert.equal(world.entitlements[ALICE], undefined, `${label} must never reach the entitlement`);
  }
});

// ──────────────────────────────── J & N — a payment that will never settle

test('J: a pending payment Paystack has reversed is closed as reversed, not left pending', async () => {
  world.reset({ verified: { status: 'reversed', amount: 350000, currency: 'NGN', domain: 'test' } });
  const row = world.row();

  const result = await reconcilePayment(ALICE, row.reference);

  assert.equal(row.status, 'reversed', 'the ledger records what actually happened');
  assert.equal(closedWith().p_status, 'reversed');
  assert.equal(closedWith().p_provider_status, 'reversed');
  assert.equal(closedWith().p_reason, 'verified_status_reversed');

  assert.equal(result.state, 'failed', 'the student is told it did not go through');
  assert.equal(result.activated, false);
  assert.notEqual(result.state, 'pending', 'it must not sit as Pending for ever');
  assert.equal(world.entitlements[ALICE], undefined, 'the student stays on Free');
  assert.ok(!rpcNames().includes('apply_successful_payment'));
});

test('J: a payment stored as reversed reports the same way on every later visit', async () => {
  const row = world.row({ status: 'reversed' });

  const result = await reconcilePayment(ALICE, row.reference);

  assert.equal(result.state, 'failed');
  assert.equal(result.activated, false);
  assert.deepEqual(world.calls.verifications, [], 'a settled row costs no Paystack call at all');
});

test('N: failed and abandoned close with their own status and grant nothing', async () => {
  for (const [upstream, stored] of [['failed', 'failed'], ['abandoned', 'abandoned']]) {
    world.reset({ verified: { status: upstream, amount: 350000, currency: 'NGN', domain: 'test' } });
    const row = world.row();

    const result = await reconcilePayment(ALICE, row.reference);

    assert.equal(row.status, stored, `${upstream} is stored as ${stored}`);
    assert.equal(closedWith().p_status, stored);
    assert.equal(result.activated, false);
    assert.equal(world.entitlements[ALICE], undefined);
  }
});

test('N: an unfinished payment is still pending, and is not closed on a guess', async () => {
  for (const upstream of ['ongoing', 'pending', 'queued']) {
    world.reset({ verified: { status: upstream, amount: 350000, currency: 'NGN', domain: 'test' } });
    const row = world.row();

    const result = await reconcilePayment(ALICE, row.reference);

    assert.equal(result.state, 'pending', `${upstream} is not a decision`);
    assert.equal(row.status, 'pending', 'an undecided payment is never closed out');
    assert.ok(!rpcNames().includes('mark_billing_payment_unsuccessful'));
  }
});

test('N: a Paystack outage leaves the payment pending rather than failing it', async () => {
  world.reset({ verifyFails: true });
  const row = world.row();

  const result = await reconcilePayment(ALICE, row.reference);

  assert.equal(result.state, 'pending');
  assert.equal(row.status, 'pending', 'our inability to ask is not the student\'s payment failing');
  assert.deepEqual(rpcNames(), []);
});

// ────────────────────────────── I & O — recovery cannot cross an account

test('O: one student cannot recover another student\'s payment', async () => {
  const alices = world.row({ reference: 'mdg_alice_paid' });

  const result = await reconcilePayment(BOB, alices.reference);

  assert.equal(result.state, 'unknown');
  assert.equal(result.amountKobo, null, 'nothing about the payment leaks back');
  assert.equal(result.planSlug, null);
  assert.deepEqual(world.calls.verifications, [], 'a reference that is not yours is never even looked up at Paystack');
  assert.deepEqual(rpcNames(), []);
  assert.equal(alices.status, 'pending', 'and Alice\'s payment is untouched');
  assert.equal(world.entitlements[BOB], undefined);

  // Every lookup is scoped by user_id, which is what makes the answer above
  // indistinguishable from the answer an invented reference gets.
  for (const lookup of world.calls.lookups) {
    assert.equal(lookup.filters.user_id, BOB);
  }
});

test('I: a transaction MASTER did not create cannot activate MASTER', async () => {
  /*
   * A real, successful, correctly-priced Paystack transaction that this
   * application never opened — a payment link, an invoice, a manual charge from
   * the dashboard, or a reference lifted from somewhere else entirely —
   * submitted to MASTER's own verification endpoint by a logged-in student.
   *
   * There is no local row, so there is nothing to verify and nothing to grant.
   */
  for (const reference of ['T1234567890', 'invoice_99', 'PSK_live_charge_1']) {
    world.reset();
    const result = await reconcilePayment(BOB, reference);

    assert.equal(result.state, 'unknown', reference);
    assert.deepEqual(world.calls.verifications, [], 'a reference with no local row is never verified upstream');
    assert.deepEqual(rpcNames(), [], 'and never reaches the function that grants access');
    assert.equal(world.entitlements[BOB], undefined);
  }
});

test('I: an invented reference is refused the same way, whatever it is dressed as', async () => {
  for (const reference of ['mdg_made_up_by_hand', 'T1234567890', 'mdg_' + 'a'.repeat(90)]) {
    world.reset();
    const result = await reconcilePayment(BOB, reference);
    assert.equal(result.state, 'unknown', reference);
    assert.deepEqual(rpcNames(), [], reference);
  }

  // Shapes that are not references at all never reach the database.
  for (const bad of ['', 'short', 'has space', '../../etc', { reference: 'mdg_x' }, null, 42]) {
    world.reset();
    await assert.rejects(() => reconcilePayment(BOB, bad), /REFERENCE_INVALID|not valid/);
    assert.deepEqual(world.calls.lookups, []);
  }
});

test('the verification endpoint takes the account from the session, never from the body', () => {
  const source = readFileSync('app/api/billing/verify/route.ts', 'utf8');

  assert.ok(source.includes('supabase.auth.getUser()'), 'the student is resolved server-side');
  assert.ok(/reconcilePayment\(user\.id, body\?\.reference\)/.test(source),
    'the account comes from the session and the body supplies only a lookup key');
  assert.ok(source.includes('RATE_LIMITS.billingVerify'), 'recovery stays behind the existing limiter');
  assert.ok(/status: 401/.test(source), 'an unauthenticated caller gets nothing');
});

// ─────────────────────────────────────────── what the billing page offers

test('only a few recent pending payments are offered a re-check', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');
  const at = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const marked = markRecoverablePayments([
    { status: 'pending', createdAt: at(0) },
    { status: 'success', createdAt: at(1) },
    { status: 'pending', createdAt: at(2) },
    { status: 'failed', createdAt: at(3) },
    { status: 'pending', createdAt: at(4) },
    { status: 'pending', createdAt: at(5) },   // past the cap of three
    { status: 'pending', createdAt: at(40) },  // and past the age window
    { status: 'pending', createdAt: 'not a date' },
  ], now);

  assert.deepEqual(marked.map((entry) => entry.recoverable),
    [true, false, true, false, true, false, false, false]);
});

test('a settled payment is never offered a re-check', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');
  const marked = markRecoverablePayments(
    ['success', 'failed', 'abandoned', 'reversed'].map((status) => ({ status, createdAt: now.toISOString() })),
    now,
  );
  assert.deepEqual(marked.map((entry) => entry.recoverable), [false, false, false, false]);
});
