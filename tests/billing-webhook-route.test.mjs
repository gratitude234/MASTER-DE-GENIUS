import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The Paystack webhook endpoint, end to end.
 *
 * MASTER settles through its own dedicated Paystack business: this endpoint
 * serves one business, decides MASTER billing events, and forwards nothing
 * anywhere. These run the **real route handler** with only the database and the
 * network replaced, because what is under test is the ordering — the signature
 * is verified against the raw bytes before anything is parsed, and a valid
 * signature by itself still reaches nobody's entitlement.
 *
 * `billing-service.test.mjs` covers the processor's decisions in isolation;
 * this file covers what actually comes back over HTTP.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;

// A stand-in secret, invented here. It is not a Paystack key and never was.
const TEST_SECRET = 'sk_test_0000000000000000000000000000000000000000';
process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
process.env.NEXT_PUBLIC_APP_URL = 'https://www.masterdegenius.com.ng';

/** Everything the route reaches for, recorded rather than performed. */
const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      rpc: [],
      fetches: [],
      applyOutcome: 'applied',
      recordIsNew: true,
      recordFails: false,
      verified: null,
      verifyFails: false,
    }, overrides);
  },
};
world.reset();
globalThis.__world = world;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return { url: NEXT_SERVER_URL, shortCircuit: true };

    /*
     * Every MASTER billing side effect goes through `.rpc` — the ledger claim,
     * the application, the failure record. Recording each call is what lets a
     * test assert that a refused delivery touched nothing at all.
     */
    if (specifier === '@/lib/supabase/admin') {
      return stub(`
        export function createAdminClient() {
          return {
            async rpc(name, args) {
              const world = globalThis.__world;
              world.rpc.push({ name, args });
              if (name === 'record_billing_webhook_event') {
                if (world.recordFails) return { data: null, error: { code: '57014' } };
                return { data: [{ is_new: world.recordIsNew, event_row_id: 1 }], error: null };
              }
              if (name === 'apply_successful_payment') {
                return { data: [{ outcome: world.applyOutcome, user_id: 'user-1', expires_at: '2026-10-08T00:00:00.000Z' }], error: null };
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

const { POST } = await import('../app/api/billing/webhook/paystack/route.ts');

/** Paystack's verification API, answered locally. Never a real network call. */
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  world.fetches.push({ url, init });

  if (!url.startsWith('https://api.paystack.co/transaction/verify/')) {
    throw new Error(`the webhook must make no outbound call but Paystack verification: ${url}`);
  }
  if (world.verifyFails) return new Response('{"status":false}', { status: 503 });

  const reference = decodeURIComponent(url.split('/').pop());
  const verified = world.verified ?? {};
  return new Response(JSON.stringify({
    status: true,
    data: {
      reference,
      status: verified.status ?? 'success',
      amount: verified.amount ?? 150000,
      currency: verified.currency ?? 'NGN',
      domain: verified.domain ?? 'test',
      id: 4242,
      paid_at: '2026-09-08T10:00:00.000Z',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
test.after(() => { globalThis.fetch = originalFetch; });
test.afterEach(() => { world.reset(); });

function signedRequest(body, { signature } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://www.masterdegenius.com.ng/api/billing/webhook/paystack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature ?? createHmac('sha512', TEST_SECRET).update(raw, 'utf8').digest('hex'),
    },
    body: raw,
  });
}

const charge = (reference, event = 'charge.success') => ({
  event,
  data: { reference, id: 4242, amount: 150000, currency: 'NGN', status: 'success' },
});

const rpcNames = () => world.rpc.map((call) => call.name);
const verifications = () => world.fetches.filter((call) => call.url.includes('/transaction/verify/'));

// ────────────────────────────────────────────────── A — the successful path

test('A: a signed MASTER charge is verified upstream and activates access', async () => {
  const response = await POST(signedRequest(charge('mdg_live_1')));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, status: 'applied' });

  // The full chain, in order: ledger claim, server-to-server verification, then
  // the one function allowed to grant.
  assert.deepEqual(rpcNames(), ['record_billing_webhook_event', 'apply_successful_payment', 'finish_billing_webhook_event']);
  assert.equal(verifications().length, 1, 'the signed body is confirmed against Paystack, not believed');

  const applied = world.rpc.find((call) => call.name === 'apply_successful_payment').args;
  assert.equal(applied.p_amount_kobo, 150000, 'the verified amount, never the amount in the body');
  assert.equal(applied.p_currency, 'NGN');
  assert.equal(applied.p_environment, 'test');
});

test('A: the route makes no outbound call other than Paystack verification', async () => {
  await POST(signedRequest(charge('mdg_live_2')));

  for (const call of world.fetches) {
    assert.ok(call.url.startsWith('https://api.paystack.co/'), `unexpected outbound call to ${call.url}`);
  }

  // Stated structurally as well: no forwarding, no proxying, no partner.
  const source = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  assert.ok(!/fetch\(/.test(source), 'the webhook route makes no request of its own');
  assert.ok(!/JABUSTUDY|SHARED_BUSINESS|shared-business/.test(source), 'no partner configuration is read');
  assert.ok(!/forwardWebhookEvent|resolveForwardTarget|forwardResponse/.test(source),
    'no forwarding path remains');
});

test('the shared-business forwarding layer is gone from the codebase', () => {
  // The temporary cross-product router existed only while MASTER settled
  // through another product's Paystack business. MASTER has its own now, so the
  // whole surface — module, configuration and destination — is removed rather
  // than left switched off, which is one fewer thing that can be turned on by
  // accident.
  assert.throws(() => readFileSync('features/billing/shared-business.ts', 'utf8'), /ENOENT/);

  for (const file of [
    'app/api/billing/webhook/paystack/route.ts',
    'features/billing/webhook.ts',
    'features/billing/reconcile.ts',
    'features/billing/paystack.ts',
    'features/admin/system.ts',
    'app/admin/system/page.tsx',
    '.env.example',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/JABUSTUDY|SHARED_BUSINESS/.test(source), `${file} must not reference partner configuration`);
    assert.ok(!/jabustudy/i.test(source), `${file} must not name the former partner`);
  }
});

// ──────────────────────────────────────────────────────── B — bad signature

test('B: an invalid signature is refused before anything is parsed or recorded', async () => {
  for (const signature of ['deadbeef', '', createHmac('sha512', 'sk_test_wrong').update('{}', 'utf8').digest('hex')]) {
    world.reset();
    const response = await POST(signedRequest(charge('mdg_live_3'), { signature }));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid signature' });
    assert.deepEqual(rpcNames(), [], 'nothing is recorded');
    assert.deepEqual(world.fetches, [], 'nothing is verified');
  }
});

test('B: a tampered body fails even though the signature is a real one', async () => {
  const original = JSON.stringify(charge('mdg_live_4'));
  const signature = createHmac('sha512', TEST_SECRET).update(original, 'utf8').digest('hex');

  // The classic attack: keep the signature, raise the amount.
  const tampered = JSON.stringify({ event: 'charge.success', data: { reference: 'mdg_live_4', id: 4242, amount: 9_999_999 } });
  const response = await POST(signedRequest(tampered, { signature }));

  assert.equal(response.status, 401);
  assert.deepEqual(rpcNames(), []);
});

test('B: the mdg_ namespace gate never runs before the HMAC check', async () => {
  /*
   * The ordering that matters most, stated as behaviour rather than as source
   * reading.
   *
   * If the namespace gate ran first, a forged delivery carrying a foreign
   * reference would be answered 200 "ignored" — a free oracle telling an
   * unauthenticated caller which references this deployment considers its own,
   * and a parser run on unauthenticated input. It must be 401 instead: the
   * signature decides whether the body is looked at *at all*, and only a body
   * Paystack actually signed ever reaches the namespace rule.
   */
  for (const reference of ['T1234567890', 'invoice_99', 'mdg_live_5']) {
    world.reset();
    const response = await POST(signedRequest(charge(reference), { signature: 'deadbeef' }));

    assert.equal(response.status, 401, `${reference} must be refused on the signature, not on the namespace`);
    assert.deepEqual(await response.json(), { error: 'Invalid signature' },
      'and the answer must not reveal which branch it would have taken');
    assert.deepEqual(rpcNames(), [], 'nothing is recorded');
    assert.deepEqual(world.fetches, [], 'nothing is verified');
  }

  // Structurally: the route cannot apply the gate, because it does not have it.
  // The only webhook-reachable caller is inside processPaystackEvent, which the
  // route reaches only after the signature check and the parse.
  const route = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  assert.ok(!route.includes('isMasterPaymentReference'),
    'the route must not reference the namespace gate at all');

  const processor = readFileSync('features/billing/webhook.ts', 'utf8');
  const body = processor.slice(processor.indexOf('export async function processPaystackEvent'));
  const parse = body.indexOf('parsePaystackEvent(payload)');
  const gate = body.indexOf('isMasterPaymentReference(');
  const verify = body.indexOf('deps.verifyTransaction(');
  const apply = body.indexOf('deps.applyPayment(');

  assert.ok(parse >= 0 && gate > parse, 'the gate needs a parsed reference, so it cannot precede the parse');
  assert.ok(verify > gate, 'server-to-server verification comes after the gate');
  assert.ok(apply > verify, 'and the grant comes last of all');
});

test('B: the raw bytes are verified before the body is parsed', () => {
  const full = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  const handler = full.slice(full.indexOf('export async function POST'));

  const read = handler.indexOf('await request.text()');
  const verify = handler.indexOf('verifyPaystackSignature');
  const parse = handler.indexOf('JSON.parse');
  const process = handler.indexOf('processPaystackEvent');

  assert.ok(read >= 0 && verify > read, 'the signature is checked against those exact bytes');
  assert.ok(parse > verify, 'nothing is parsed until the signature has been verified');
  assert.ok(process > parse, 'and nothing is processed until it has been parsed');
  assert.ok(!full.includes('request.json()'), 'the body must never be read as parsed JSON');
});

// ───────────────────────────── C & D — references that own no local payment

test('C: an mdg_ reference with no local payment row grants nothing', async () => {
  world.applyOutcome = 'not_found';
  const response = await POST(signedRequest(charge('mdg_never_created')));

  assert.equal(response.status, 200, 'acknowledged once rather than retried for ever');
  assert.deepEqual(await response.json(), { received: true, status: 'ignored' });

  // The database is the authority that says "not_found" — the namespace only
  // decided that it was worth asking.
  assert.equal(world.rpc.filter((call) => call.name === 'apply_successful_payment').length, 1);
  const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
  assert.equal(finished.p_detail, 'unknown_reference');
});

test('D: a reference outside the MASTER namespace cannot activate anything', async () => {
  /*
   * A transaction started from the Paystack dashboard — a payment link, an
   * invoice, a manual charge — carries a Paystack-minted reference. No row this
   * application has ever written could match it, because `open_billing_checkout`
   * is the only insert and it is always handed an `mdg_` reference.
   */
  for (const reference of ['T1234567890', 'JBS_7781', 'invoice_99', 'MDG_uppercase', 'mdg']) {
    world.reset();
    const response = await POST(signedRequest(charge(reference)));

    assert.equal(response.status, 200, reference);
    assert.deepEqual(await response.json(), { received: true, status: 'ignored' });
    assert.equal(verifications().length, 0, `${reference} costs no Paystack verification`);
    assert.ok(!rpcNames().includes('apply_successful_payment'), `${reference} must never reach the entitlement`);

    const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
    assert.equal(finished.p_detail, 'foreign_reference');
  }
});

test('D: metadata claiming to be MASTER changes nothing', async () => {
  // Paystack echoes back whatever a transaction was initialized with, so this
  // field is attacker-influenceable. It is not consulted anywhere.
  const response = await POST(signedRequest({
    event: 'charge.success',
    data: { reference: 'T1234567890', id: 7, amount: 150000, metadata: { product: 'master_degenius', plan_slug: 'master_180' } },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, status: 'ignored' });
  assert.ok(!rpcNames().includes('apply_successful_payment'));
});

// ────────────────────────────── F, G, H — what a verified non-success does

test('F/G/H: a verified failure, abandonment or reversal closes the row with its own status', async () => {
  for (const [upstream, stored] of [['failed', 'failed'], ['abandoned', 'abandoned'], ['reversed', 'reversed']]) {
    world.reset({ verified: { status: upstream } });
    const response = await POST(signedRequest(charge('mdg_unsuccessful')));

    assert.equal(response.status, 200, `${upstream} is a decided outcome, not a retry`);
    assert.deepEqual(await response.json(), { received: true, status: 'ignored' });
    assert.ok(!rpcNames().includes('apply_successful_payment'), `${upstream} must never reach the entitlement`);

    const closed = world.rpc.find((call) => call.name === 'mark_billing_payment_unsuccessful').args;
    assert.equal(closed.p_status, stored, `${upstream} is stored as ${stored}`);
    assert.equal(closed.p_provider_status, upstream);

    const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
    assert.equal(finished.p_detail, `not_successful_upstream_${stored}`);
  }
});

test('H: a signed success that verifies as reversed does not stay pending', async () => {
  world.reset({ verified: { status: 'reversed' } });
  await POST(signedRequest(charge('mdg_reversed_hook')));

  const closed = world.rpc.find((call) => call.name === 'mark_billing_payment_unsuccessful').args;
  assert.equal(closed.p_status, 'reversed', 'a reversal is distinguishable from a card decline in the ledger');
  assert.equal(closed.p_reason, 'verified_status_reversed');
});

// ───────────────────────────────── N, O, P — the refusals, over HTTP

test('N/O/P: a mismatched amount, currency or environment is a visible refusal', async () => {
  // A wrong amount is decided by the database under the row's lock.
  world.reset({ applyOutcome: 'amount_mismatch' });
  const short = await POST(signedRequest(charge('mdg_short')));
  assert.equal(short.status, 400, 'a refusal surfaces as a failed delivery in the dashboard');
  assert.deepEqual(await short.json(), { received: true, status: 'amount_mismatch' });

  // Currency and environment are refused in the application layer too, before
  // the grant is even attempted.
  world.reset({ verified: { currency: 'USD' } });
  const wrongCurrency = await POST(signedRequest(charge('mdg_usd')));
  assert.equal(wrongCurrency.status, 400);
  assert.deepEqual(await wrongCurrency.json(), { received: true, status: 'currency_not_ngn' });
  assert.ok(!rpcNames().includes('apply_successful_payment'));

  world.reset({ verified: { domain: 'live' } });
  const wrongEnvironment = await POST(signedRequest(charge('mdg_live_domain')));
  assert.equal(wrongEnvironment.status, 400);
  assert.deepEqual(await wrongEnvironment.json(), { received: true, status: 'environment_mismatch' });
  assert.ok(!rpcNames().includes('apply_successful_payment'));
});

// ────────────────────────────── J & K — the race, and exactly one grant

test('J/K: a webhook arriving after the callback already applied adds nothing', async () => {
  world.applyOutcome = 'already_applied';
  const response = await POST(signedRequest(charge('mdg_raced')));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, status: 'duplicate' },
    'the callback won the race; this is not an error and explicitly not a second grant');

  const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
  assert.equal(finished.p_detail, 'entitlement_already_granted');
});

test('K: a redelivered webhook is stopped before it can be applied a second time', async () => {
  world.recordIsNew = false;
  const response = await POST(signedRequest(charge('mdg_redelivered')));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, status: 'duplicate' });
  assert.deepEqual(rpcNames(), ['record_billing_webhook_event'], 'the claim stops it before anything else runs');
  assert.equal(verifications().length, 0);
});

// ───────────────────────────────────────── transient failure vs refusal

test('a dependency being down asks Paystack to redeliver; a refusal does not', async () => {
  // Our idempotency gate is unreachable: nothing was claimed, so nothing ran.
  world.reset({ recordFails: true });
  const gateDown = await POST(signedRequest(charge('mdg_gate_down')));
  assert.equal(gateDown.status, 503);
  assert.deepEqual(await gateDown.json(), { received: false, status: 'idempotency_unavailable' });

  // Paystack's own verification is unreachable: whether money moved is unknown,
  // so the claim is released and the next delivery must run.
  world.reset({ verifyFails: true });
  const verifyDown = await POST(signedRequest(charge('mdg_verify_down')));
  assert.equal(verifyDown.status, 503);
  assert.deepEqual(await verifyDown.json(), { received: false, status: 'verification_unavailable' });
  assert.ok(rpcNames().includes('release_billing_webhook_event'), 'the claim goes back so the retry is not dismissed');

  const source = readFileSync('app/api/billing/webhook/paystack/route.ts', 'utf8');
  const handler = source.slice(source.indexOf('export async function POST'));
  assert.ok(/result\.outcome === "retry"[\s\S]{0,200}status: 503/.test(handler));
  assert.ok(/result\.outcome === "rejected"[\s\S]{0,200}status: 400/.test(handler));
});

// ──────────────────────────────────────────────── the rest of the surface

test('an unsupported event and a reference-less body are acknowledged, not retried', async () => {
  world.reset();
  const unsupported = await POST(signedRequest({ event: 'customer.identification.success', data: { id: 1 } }));
  assert.equal(unsupported.status, 200);
  assert.deepEqual(await unsupported.json(), { received: true, status: 'ignored' });
  assert.equal(verifications().length, 0);

  world.reset();
  const noReference = await POST(signedRequest({ event: 'charge.success', data: { id: 1 } }));
  assert.equal(noReference.status, 200);
  const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
  assert.equal(finished.p_detail, 'no_reference');
});

test('refunds and disputes are recorded for review and never revoke access', async () => {
  for (const event of ['refund.processed', 'refund.failed', 'charge.dispute.create']) {
    world.reset();
    const response = await POST(signedRequest(charge('mdg_refunded', event)));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, status: 'ignored' });
    assert.ok(!rpcNames().includes('mark_billing_payment_unsuccessful'),
      `${event} must not demote a payment automatically`);
    const finished = world.rpc.find((call) => call.name === 'finish_billing_webhook_event').args;
    assert.equal(finished.p_detail, `${event}_recorded_for_manual_review`);
  }
});

test('a body that is not JSON is refused without being processed', async () => {
  const response = await POST(signedRequest('not json at all'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid payload' });
  assert.deepEqual(rpcNames(), []);
});
