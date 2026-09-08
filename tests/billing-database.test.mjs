import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * The monetization guarantees that have to hold in PostgreSQL, not merely in
 * TypeScript.
 *
 * Application code can be bypassed — by a second entry point, a future refactor,
 * or a caller that forgets a check. These run the real migrations against a real
 * Postgres and assert the properties that survive all of that: a reference can
 * never grant access twice, a mismatched amount cannot activate anything, RLS
 * keeps one student out of another's payments, and a lapsed entitlement resolves
 * to Free on its own.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.query(`insert into auth.users values ($1,'alice@example.invalid','{}'),($2,'bob@example.invalid','{}')`, [ALICE, BOB]);
  return db;
}

/** Opens a pending payment the way the checkout endpoint does. */
async function openCheckout(db, userId, planSlug, reference, environment = 'test') {
  const result = await db.query(
    'select * from open_billing_checkout($1,$2,$3,$4,900)',
    [userId, planSlug, reference, environment],
  );
  return result.rows[0];
}

async function applyPayment(db, reference, { amountKobo, currency = 'NGN', environment = 'test' }) {
  const result = await db.query(
    'select * from apply_successful_payment($1,$2,$3,$4,$5,$6,$7)',
    [reference, amountKobo, currency, environment, 'ps_1', 'success', null],
  );
  return result.rows[0];
}

async function entitlementOf(db, userId) {
  const result = await db.query('select * from current_billing_entitlement($1)', [userId]);
  return result.rows[0];
}

// ─────────────────────────────────────────────────── catalogue is authoritative

test('the plan catalogue is seeded with the published prices and durations', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query('select slug, tier, price_kobo, currency, duration_days, is_popular from billing_plans order by display_order');
    assert.deepEqual(rows, [
      { slug: 'free', tier: 'free', price_kobo: 0, currency: 'NGN', duration_days: null, is_popular: false },
      { slug: 'master_30', tier: 'master', price_kobo: 150000, currency: 'NGN', duration_days: 30, is_popular: false },
      { slug: 'master_90', tier: 'master', price_kobo: 350000, currency: 'NGN', duration_days: 90, is_popular: true },
      { slug: 'master_180', tier: 'master', price_kobo: 550000, currency: 'NGN', duration_days: 180, is_popular: false },
    ]);
  } finally { await db.close(); }
});

test('exactly one plan may be Most Popular', async () => {
  const db = await freshDb();
  try {
    await assert.rejects(
      () => db.query(`update billing_plans set is_popular = true where slug = 'master_30'`),
      /billing_plans_single_popular_idx|duplicate key/i,
    );
  } finally { await db.close(); }
});

test('the server prices a checkout from the catalogue, not from the caller', async () => {
  const db = await freshDb();
  try {
    // There is deliberately no parameter through which a price could be passed.
    const opened = await openCheckout(db, ALICE, 'master_90', 'mdg_ref_price_check');
    assert.equal(opened.outcome, 'created');
    assert.equal(opened.amount_kobo, 350000);
    assert.equal(opened.access_days, 90);
    assert.equal(opened.currency, 'NGN');
  } finally { await db.close(); }
});

test('the free plan and unknown plans cannot open a checkout', async () => {
  const db = await freshDb();
  try {
    await assert.rejects(() => openCheckout(db, ALICE, 'free', 'mdg_ref_free_0001'), /BILLING_PLAN_NOT_PURCHASABLE/);
    await assert.rejects(() => openCheckout(db, ALICE, 'master_9999', 'mdg_ref_unknown01'), /BILLING_PLAN_NOT_PURCHASABLE/);

    await db.query(`update billing_plans set is_active = false where slug = 'master_30'`);
    await assert.rejects(() => openCheckout(db, ALICE, 'master_30', 'mdg_ref_inactive1'), /BILLING_PLAN_NOT_PURCHASABLE/);
  } finally { await db.close(); }
});

test('a rapid second checkout for the same plan reuses the first pending payment', async () => {
  const db = await freshDb();
  try {
    const first = await openCheckout(db, ALICE, 'master_30', 'mdg_ref_double_001');
    assert.equal(first.outcome, 'created');
    // Reuse requires a checkout link: a row without one is not something the
    // student could have been sent to.
    await db.query(`select attach_billing_authorization_url($1,'https://checkout.paystack.com/abc')`, ['mdg_ref_double_001']);

    const second = await openCheckout(db, ALICE, 'master_30', 'mdg_ref_double_002');
    assert.equal(second.outcome, 'reused');
    assert.equal(second.reference, 'mdg_ref_double_001');
    assert.equal(second.authorization_url, 'https://checkout.paystack.com/abc');

    const { rows } = await db.query('select count(*)::int as total from payment_transactions where user_id = $1', [ALICE]);
    assert.equal(rows[0].total, 1, 'a double tap must not open two Paystack transactions');
  } finally { await db.close(); }
});

// ───────────────────────────────────────────────────────── entitlement resolution

test('a student with no payment resolves to Free', async () => {
  const db = await freshDb();
  try {
    assert.deepEqual(await entitlementOf(db, ALICE), {
      tier: 'free', plan_slug: null, expires_at: null, is_master: false,
    });
  } finally { await db.close(); }
});

test('an applied payment activates Master for the plan duration', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_90', 'mdg_ref_grant_001');
    const applied = await applyPayment(db, 'mdg_ref_grant_001', { amountKobo: 350000 });
    assert.equal(applied.outcome, 'applied');
    assert.equal(applied.tier, 'master');

    const entitlement = await entitlementOf(db, ALICE);
    assert.equal(entitlement.tier, 'master');
    assert.equal(entitlement.plan_slug, 'master_90');
    assert.equal(entitlement.is_master, true);

    const days = (new Date(entitlement.expires_at) - Date.now()) / 86_400_000;
    assert.ok(days > 89.9 && days < 90.1, `expected ~90 days of access, got ${days}`);
  } finally { await db.close(); }
});

test('expired Master access resolves to Free without any job running', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_expiry_01');
    await applyPayment(db, 'mdg_ref_expiry_01', { amountKobo: 150000 });
    assert.equal((await entitlementOf(db, ALICE)).tier, 'master');

    // Move the expiry into the past. The stored tier is deliberately left as
    // 'master' — resolution, not a downgrade job, is what makes this Free.
    await db.query(`update user_entitlements set expires_at = now() - interval '1 second' where user_id = $1`, [ALICE]);

    const lapsed = await entitlementOf(db, ALICE);
    assert.equal(lapsed.tier, 'free');
    assert.equal(lapsed.is_master, false);
    assert.equal(lapsed.plan_slug, null, 'a lapsed plan must not still name itself as the active plan');
    assert.ok(lapsed.expires_at, 'the past expiry is still reported so the billing page can explain it');

    const { rows } = await db.query('select tier from user_entitlements where user_id = $1', [ALICE]);
    assert.equal(rows[0].tier, 'master', 'the stored row is untouched; only the resolved answer changes');
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────── verification is enforced in SQL

test('a mismatched amount cannot activate access even with a valid reference', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_180', 'mdg_ref_amount_01');
    // ₦100 against a ₦5,500 plan: the classic tampered-checkout attempt.
    const result = await applyPayment(db, 'mdg_ref_amount_01', { amountKobo: 10000 });

    assert.equal(result.outcome, 'amount_mismatch');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');

    const { rows } = await db.query(`select status, failure_reason from payment_transactions where reference = $1`, ['mdg_ref_amount_01']);
    assert.equal(rows[0].status, 'pending', 'the payment is not marked successful');
    assert.equal(rows[0].failure_reason, 'amount_mismatch');
  } finally { await db.close(); }
});

test('a non-NGN currency cannot activate access', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_currncy_1');
    const result = await applyPayment(db, 'mdg_ref_currncy_1', { amountKobo: 150000, currency: 'USD' });

    assert.equal(result.outcome, 'currency_mismatch');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');
  } finally { await db.close(); }
});

test('a live-environment event cannot settle a test-mode transaction', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_environm1', 'test');
    const result = await applyPayment(db, 'mdg_ref_environm1', { amountKobo: 150000, environment: 'live' });

    assert.equal(result.outcome, 'environment_mismatch');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');
  } finally { await db.close(); }
});

test('an unknown reference grants nothing and reports itself as unknown', async () => {
  const db = await freshDb();
  try {
    const result = await applyPayment(db, 'mdg_ref_nonexistent', { amountKobo: 150000 });
    assert.equal(result.outcome, 'not_found');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');
  } finally { await db.close(); }
});

test('a payment already marked failed can never later be applied', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_failed_01');
    await db.query(`select * from mark_billing_payment_unsuccessful($1,'failed','card_declined',null,'failed')`, ['mdg_ref_failed_01']);

    const result = await applyPayment(db, 'mdg_ref_failed_01', { amountKobo: 150000 });
    assert.equal(result.outcome, 'not_pending');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');
  } finally { await db.close(); }
});

test('an applied payment is never demoted by a later failure or reversal event', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_reversal1');
    await applyPayment(db, 'mdg_ref_reversal1', { amountKobo: 150000 });

    // Refunds and chargebacks are recorded for review; access is settled by a
    // human rather than removed automatically mid-preparation.
    const result = await db.query(
      `select * from mark_billing_payment_unsuccessful($1,'reversed','chargeback',null,'reversed')`,
      ['mdg_ref_reversal1'],
    );
    assert.equal(result.rows[0].outcome, 'already_applied');

    const { rows } = await db.query(`select status from payment_transactions where reference = $1`, ['mdg_ref_reversal1']);
    assert.equal(rows[0].status, 'success');
    assert.equal((await entitlementOf(db, ALICE)).tier, 'master');
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────── idempotency and renewal

test('a redelivered payment never extends access twice', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_replay_01');
    const first = await applyPayment(db, 'mdg_ref_replay_01', { amountKobo: 150000 });
    assert.equal(first.outcome, 'applied');

    // Paystack retries the same delivery three more times.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeat = await applyPayment(db, 'mdg_ref_replay_01', { amountKobo: 150000 });
      assert.equal(repeat.outcome, 'already_applied');
      assert.equal(repeat.expires_at.getTime(), first.expires_at.getTime(), 'the expiry must not move');
    }

    const { rows } = await db.query('select count(*)::int as total from entitlement_events where user_id = $1', [ALICE]);
    assert.equal(rows[0].total, 1, 'one payment produces exactly one entitlement event');
  } finally { await db.close(); }
});

test('a webhook racing the browser callback produces one grant, not two', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_90', 'mdg_ref_race_0001');

    // Both entry points funnel through the same locked function, exactly as the
    // webhook route and the callback reconciler do.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => applyPayment(db, 'mdg_ref_race_0001', { amountKobo: 350000 })),
    );

    const applied = results.filter((row) => row.outcome === 'applied');
    const alreadyApplied = results.filter((row) => row.outcome === 'already_applied');
    assert.equal(applied.length, 1, 'exactly one caller may apply the payment');
    assert.equal(alreadyApplied.length, 5);

    const days = ((await entitlementOf(db, ALICE)).expires_at - Date.now()) / 86_400_000;
    assert.ok(days > 89.9 && days < 90.1, `access must be 90 days, not a multiple of it — got ${days}`);
  } finally { await db.close(); }
});

test('renewing early extends from the existing expiry, so no paid day is lost', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_renew_a01');
    const first = await applyPayment(db, 'mdg_ref_renew_a01', { amountKobo: 150000 });

    // Renewing on day one, with 30 days still unused.
    await openCheckout(db, ALICE, 'master_90', 'mdg_ref_renew_a02');
    const second = await applyPayment(db, 'mdg_ref_renew_a02', { amountKobo: 350000 });

    const added = (second.expires_at - first.expires_at) / 86_400_000;
    assert.ok(added > 89.9 && added < 90.1, `the 90 days must stack on top of the existing expiry — got ${added}`);

    const { rows } = await db.query(`select event_type from entitlement_events where user_id = $1 order by id`, [ALICE]);
    assert.deepEqual(rows.map((row) => row.event_type), ['granted', 'extended']);
  } finally { await db.close(); }
});

test('a lapsed student renewing starts from today, not from the old expiry', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_lapsed_01');
    await applyPayment(db, 'mdg_ref_lapsed_01', { amountKobo: 150000 });

    // Access ended 100 days ago. Back-dating from there would hand the student
    // a plan that is already expired again.
    await db.query(`update user_entitlements set expires_at = now() - interval '100 days' where user_id = $1`, [ALICE]);

    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_lapsed_02');
    const renewal = await applyPayment(db, 'mdg_ref_lapsed_02', { amountKobo: 150000 });

    const days = (renewal.expires_at - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days < 30.1, `a lapsed renewal must give a full 30 days from now — got ${days}`);
    assert.equal((await entitlementOf(db, ALICE)).tier, 'master');
  } finally { await db.close(); }
});

test('webhook deliveries are deduplicated by provider event id', async () => {
  const db = await freshDb();
  try {
    const record = () => db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:7788','charge.success','mdg_ref_hook_001',300)`,
    ).then((result) => result.rows[0]);

    const results = await Promise.all(Array.from({ length: 5 }, record));
    assert.equal(results.filter((row) => row.is_new).length, 1, 'only the first delivery is new');
    assert.equal(results.filter((row) => !row.is_new).length, 4);

    const { rows } = await db.query('select count(*)::int as total from billing_webhook_events');
    assert.equal(rows[0].total, 1);
  } finally { await db.close(); }
});

test('every event type for one transaction gets its own key, so none collide', async () => {
  const db = await freshDb();
  try {
    /*
     * Paystack reuses the transaction id across the events it sends about one
     * charge. The event type is part of the key, so a later charge.failed or
     * dispute for the same transaction is a separate delivery rather than a
     * unique-violation — or, worse, silently dismissed as a duplicate of the
     * success that already applied.
     */
    const types = ['charge.success', 'charge.failed', 'refund.processed', 'charge.dispute.create', 'transfer.failed'];
    const results = [];
    for (const type of types) {
      const { rows } = await db.query(
        `select * from record_billing_webhook_event('paystack',$1,$2,'mdg_ref_hook_001',300)`,
        [`${type}:7788`, type],
      );
      results.push({ type, isNew: rows[0].is_new, id: rows[0].event_row_id });
      // Each has to reach a decision before the next, exactly as processing does.
      await db.query(`select finish_billing_webhook_event($1,'ignored','recorded')`, [rows[0].event_row_id]);
    }

    assert.ok(results.every((row) => row.isNew), 'every distinct event type is processed on its own merits');
    assert.equal(new Set(results.map((row) => row.id)).size, types.length, 'each gets its own row');

    const { rows } = await db.query('select count(*)::int as total from billing_webhook_events');
    assert.equal(rows[0].total, types.length);

    // And redelivery of any one of them is still a duplicate.
    const repeat = await db.query(
      `select * from record_billing_webhook_event('paystack','charge.failed:7788','charge.failed','mdg_ref_hook_001',300)`,
    );
    assert.equal(repeat.rows[0].is_new, false);
  } finally { await db.close(); }
});

test('an unfinished webhook claim is re-claimable, a decided one never is', async () => {
  const db = await freshDb();
  try {
    const record = () => db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:9001','charge.success','mdg_ref_hook_002',300)`,
    ).then((result) => result.rows[0]);

    const first = await record();
    assert.equal(first.is_new, true);

    // Still leased: another instance is working on it.
    assert.equal((await record()).is_new, false);

    // Released after a retryable failure — Paystack's next delivery must run.
    await db.query(`select release_billing_webhook_event($1,'verification_unavailable')`, [first.event_row_id]);
    const retry = await record();
    assert.equal(retry.is_new, true, 'a released claim is re-claimable');
    assert.equal(retry.event_row_id, first.event_row_id, 'the audit row is reused, not duplicated');

    // Decided. Now it is permanent, and release cannot reopen it.
    await db.query(`select finish_billing_webhook_event($1,'applied','entitlement_granted')`, [first.event_row_id]);
    assert.equal((await record()).is_new, false);
    await db.query(`select release_billing_webhook_event($1,'late_failure')`, [first.event_row_id]);
    assert.equal((await record()).is_new, false, 'a decided delivery can never be reopened');

    const { rows } = await db.query('select outcome, processed_at from billing_webhook_events where id = $1', [first.event_row_id]);
    assert.equal(rows[0].outcome, 'applied');
    assert.ok(rows[0].processed_at);
  } finally { await db.close(); }
});

test('a webhook claim abandoned mid-flight lapses on its own lease', async () => {
  const db = await freshDb();
  try {
    const record = (lease) => db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:9002','charge.success','mdg_ref_hook_003',$1)`,
      [lease],
    ).then((result) => result.rows[0]);

    const first = await record(300);
    assert.equal(first.is_new, true);
    assert.equal((await record(300)).is_new, false);

    // The instance holding the claim died before deciding or releasing.
    await db.query(`update billing_webhook_events set claim_expires_at = now() - interval '1 second' where id = $1`, [first.event_row_id]);
    assert.equal((await record(300)).is_new, true, 'a dead claim must not block the delivery forever');
  } finally { await db.close(); }
});

test('payment history survives expiry — nothing is deleted when access lapses', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_30', 'mdg_ref_history_1');
    await applyPayment(db, 'mdg_ref_history_1', { amountKobo: 150000 });
    await db.query(`update user_entitlements set expires_at = now() - interval '1 day' where user_id = $1`, [ALICE]);

    assert.equal((await entitlementOf(db, ALICE)).tier, 'free');
    const { rows } = await db.query(
      `select status, amount_kobo, access_days, entitlement_expires_at from payment_transactions where user_id = $1`,
      [ALICE],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'success');
    assert.equal(rows[0].amount_kobo, 150000);
    assert.ok(rows[0].entitlement_expires_at, 'the receipt still records what the payment bought');
  } finally { await db.close(); }
});

// ───────────────────────────────────────────────────────── product quota

async function reserve(db, userId, capability, windowKey, limit) {
  const result = await db.query(
    'select * from reserve_product_quota($1,$2,$3,$4,120)',
    [userId, capability, windowKey, limit],
  );
  return result.rows[0];
}

test('a product quota cannot be oversold by concurrent requests', async () => {
  const db = await freshDb();
  try {
    const attempts = await Promise.all(
      Array.from({ length: 40 }, () => reserve(db, ALICE, 'practice_session', '2026-09-08', 20)),
    );
    assert.equal(attempts.filter((row) => row.allowed).length, 20, 'the Free daily practice limit holds under concurrency');
    assert.equal(attempts.filter((row) => !row.allowed).length, 20);
  } finally { await db.close(); }
});

test('a released reservation returns the allowance immediately', async () => {
  const db = await freshDb();
  try {
    // A Free student's single monthly mock, spent on a provider outage.
    const first = await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    assert.equal(first.allowed, true);

    const blocked = await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    assert.equal(blocked.allowed, false, 'the allowance is held while the reservation is open');

    // The provider failed before an attempt existed, so nothing was created.
    const released = await db.query('select release_product_quota($1) as released', [first.reservation_id]);
    assert.equal(released.rows[0].released, true);

    const retry = await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    assert.equal(retry.allowed, true, 'a provider failure must not cost the student their monthly mock');
  } finally { await db.close(); }
});

test('a committed reservation permanently spends the allowance', async () => {
  const db = await freshDb();
  try {
    const first = await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    await db.query('select commit_product_quota($1)', [first.reservation_id]);

    // Committing means a real attempt exists; the allowance is genuinely gone.
    const released = await db.query('select release_product_quota($1) as released', [first.reservation_id]);
    assert.equal(released.rows[0].released, false, 'a committed reservation cannot be released');

    const blocked = await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    assert.equal(blocked.allowed, false);
  } finally { await db.close(); }
});

test('an abandoned reservation expires on its own lease rather than costing a slot forever', async () => {
  const db = await freshDb();
  try {
    const first = await reserve(db, ALICE, 'practice_session', '2026-09-08', 1);
    assert.equal(first.allowed, true);
    assert.equal((await reserve(db, ALICE, 'practice_session', '2026-09-08', 1)).allowed, false);

    // The request died between reserving and creating anything.
    await db.query(`update product_usage_reservations set lease_expires_at = now() - interval '1 second' where id = $1`, [first.reservation_id]);

    assert.equal((await reserve(db, ALICE, 'practice_session', '2026-09-08', 1)).allowed, true);
  } finally { await db.close(); }
});

test('quota windows are per student, per capability and per period', async () => {
  const db = await freshDb();
  try {
    await reserve(db, ALICE, 'mock_attempt', '2026-09', 1);
    assert.equal((await reserve(db, ALICE, 'mock_attempt', '2026-09', 1)).allowed, false);

    // A different student, a different capability and the next month are all
    // separate budgets.
    assert.equal((await reserve(db, BOB, 'mock_attempt', '2026-09', 1)).allowed, true);
    assert.equal((await reserve(db, ALICE, 'practice_session', '2026-09-08', 1)).allowed, true);
    assert.equal((await reserve(db, ALICE, 'mock_attempt', '2026-10', 1)).allowed, true);
  } finally { await db.close(); }
});

test('Master limits are simply larger, using the same mechanism', async () => {
  const db = await freshDb();
  try {
    // 200 practice sessions a day on Master, then the 201st is refused.
    const allowed = await Promise.all(
      Array.from({ length: 200 }, () => reserve(db, ALICE, 'practice_session', '2026-09-08', 200)),
    );
    assert.equal(allowed.filter((row) => row.allowed).length, 200);
    assert.equal((await reserve(db, ALICE, 'practice_session', '2026-09-08', 200)).allowed, false);

    // 3 mocks a day on Master.
    const mocks = await Promise.all(
      Array.from({ length: 5 }, () => reserve(db, ALICE, 'mock_attempt', '2026-09-08', 3)),
    );
    assert.equal(mocks.filter((row) => row.allowed).length, 3);
  } finally { await db.close(); }
});

test('the AI daily quota enforces whatever plan limit it is given', async () => {
  const db = await freshDb();
  try {
    // Free: three generations a day, unchanged from before plans existed.
    const free = await Promise.all(Array.from({ length: 10 }, () =>
      db.query(`select * from consume_ai_daily_quota($1,'question_explanation',3)`, [ALICE]).then((r) => r.rows[0])));
    assert.equal(free.filter((row) => row.allowed).length, 3);

    // Master: twenty, on the same atomic counter.
    const master = await Promise.all(Array.from({ length: 30 }, () =>
      db.query(`select * from consume_ai_daily_quota($1,'question_explanation',20)`, [BOB]).then((r) => r.rows[0])));
    assert.equal(master.filter((row) => row.allowed).length, 20);
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── RLS and exposure

test('one student cannot read another student\'s transactions', async () => {
  const db = await freshDb();
  try {
    await openCheckout(db, ALICE, 'master_90', 'mdg_ref_rls_0001');
    await applyPayment(db, 'mdg_ref_rls_0001', { amountKobo: 350000 });
    await openCheckout(db, BOB, 'master_30', 'mdg_ref_rls_0002');

    await db.exec('begin');
    await db.exec(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [BOB]);

    const visible = await db.query('select reference from payment_transactions');
    assert.deepEqual(visible.rows.map((row) => row.reference), ['mdg_ref_rls_0002'], 'Bob sees only his own payment');

    const entitlements = await db.query('select user_id from user_entitlements');
    assert.ok(
      entitlements.rows.every((row) => row.user_id === BOB),
      'Bob cannot read Alice\'s entitlement row',
    );
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('a student cannot write their own entitlement or payment rows', async () => {
  const db = await freshDb();
  try {
    const privileges = await db.query(`select
      has_table_privilege('authenticated','public.user_entitlements','insert') as ent_insert,
      has_table_privilege('authenticated','public.user_entitlements','update') as ent_update,
      has_table_privilege('authenticated','public.payment_transactions','insert') as pay_insert,
      has_table_privilege('authenticated','public.payment_transactions','update') as pay_update,
      has_table_privilege('anon','public.payment_transactions','select') as anon_read,
      has_table_privilege('authenticated','public.billing_webhook_events','select') as hook_read,
      has_table_privilege('authenticated','public.entitlement_events','select') as events_read,
      has_table_privilege('authenticated','public.product_usage_reservations','select') as quota_read`);

    assert.deepEqual(privileges.rows[0], {
      ent_insert: false, ent_update: false,
      pay_insert: false, pay_update: false,
      anon_read: false, hook_read: false, events_read: false, quota_read: false,
    });
  } finally { await db.close(); }
});

test('privileged billing functions are unreachable from browser roles', async () => {
  const db = await freshDb();
  try {
    const privileges = await db.query(`select
      has_function_privilege('authenticated','public.apply_successful_payment(text,integer,text,text,text,text,timestamptz)','execute') as apply_exec,
      has_function_privilege('anon','public.apply_successful_payment(text,integer,text,text,text,text,timestamptz)','execute') as anon_apply,
      has_function_privilege('authenticated','public.open_billing_checkout(uuid,text,text,text,integer)','execute') as open_exec,
      has_function_privilege('authenticated','public.reserve_product_quota(uuid,text,text,integer,integer)','execute') as quota_exec,
      has_function_privilege('authenticated','public.record_billing_webhook_event(text,text,text,text,integer)','execute') as hook_exec,
      has_function_privilege('authenticated','public.release_billing_webhook_event(bigint,text)','execute') as release_exec,
      has_function_privilege('anon','public.release_billing_webhook_event(bigint,text)','execute') as anon_release`);

    assert.deepEqual(privileges.rows[0], {
      apply_exec: false, anon_apply: false, open_exec: false, quota_exec: false,
      hook_exec: false, release_exec: false, anon_release: false,
    });
  } finally { await db.close(); }
});

test('every billing function is SECURITY DEFINER with a pinned empty search_path', async () => {
  const db = await freshDb();
  try {
    /*
     * An unpinned search_path on a SECURITY DEFINER function is the classic
     * privilege-escalation hole: a caller prepends their own schema and the
     * function resolves `payment_transactions` to a table they control. An
     * empty search_path forces every reference to be schema-qualified.
     */
    const { rows } = await db.query(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'open_billing_checkout','attach_billing_authorization_url','apply_successful_payment',
        'mark_billing_payment_unsuccessful','current_billing_entitlement','reserve_product_quota',
        'commit_product_quota','release_product_quota','record_billing_webhook_event',
        'finish_billing_webhook_event','release_billing_webhook_event')
      order by p.proname`);

    assert.equal(rows.length, 11, 'every billing function is accounted for');
    for (const row of rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert.match(row.config, /^search_path=""?$/, `${row.proname} must pin an empty search_path`);
    }
  } finally { await db.close(); }
});

test('billing functions resolve to public even under a hostile search_path', async () => {
  const db = await freshDb();
  try {
    // A decoy schema whose plan row would sell 180 days for one kobo. Any
    // unqualified reference inside the functions would find it first.
    await db.exec(`
      create schema evil;
      create table evil.billing_plans        (like public.billing_plans including all);
      create table evil.payment_transactions (like public.payment_transactions including all);
      create table evil.user_entitlements    (like public.user_entitlements including all);
      insert into evil.billing_plans (slug, name, tier, price_kobo, duration_days)
        values ('master_90','Hijacked','master',1,3650);
      set search_path = evil, public;
    `);

    const opened = await openCheckout(db, ALICE, 'master_90', 'mdg_ref_hostile01');
    assert.equal(opened.amount_kobo, 350000, 'the price came from public, not the decoy');
    assert.equal(opened.access_days, 90);

    const applied = await applyPayment(db, 'mdg_ref_hostile01', { amountKobo: 350000 });
    assert.equal(applied.outcome, 'applied');

    for (const table of ['payment_transactions', 'user_entitlements']) {
      const { rows } = await db.query(`select count(*)::int as total from evil.${table}`);
      assert.equal(rows[0].total, 0, `nothing may be written to evil.${table}`);
    }
    const real = await db.query('select count(*)::int as total from public.payment_transactions');
    assert.equal(real.rows[0].total, 1);
  } finally { await db.close(); }
});

test('the browser is not granted the provider columns of a payment', async () => {
  const db = await freshDb();
  try {
    const grants = await db.query(`select
      has_column_privilege('authenticated','public.payment_transactions','amount_kobo','select') as amount,
      has_column_privilege('authenticated','public.payment_transactions','status','select') as status,
      has_column_privilege('authenticated','public.payment_transactions','provider_transaction_id','select') as provider_id,
      has_column_privilege('authenticated','public.payment_transactions','authorization_url','select') as checkout_url,
      has_column_privilege('authenticated','public.payment_transactions','failure_reason','select') as failure`);

    assert.deepEqual(grants.rows[0], {
      // What a student needs to understand their own receipt…
      amount: true, status: true,
      // …and nothing about the provider transaction behind it.
      provider_id: false, checkout_url: false, failure: false,
    });
  } finally { await db.close(); }
});

test('no billing table has a column that could hold a card or an authorization code', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name in
        ('payment_transactions','billing_webhook_events','user_entitlements','entitlement_events')`);
    const names = rows.map((row) => row.column_name);

    for (const forbidden of ['authorization_code', 'card_number', 'last4', 'card_type', 'bin', 'cvv', 'signature', 'payload', 'raw_body', 'secret_key']) {
      assert.ok(!names.includes(forbidden), `${forbidden} must never be storable`);
    }
  } finally { await db.close(); }
});

test('RLS is enabled on every billing table', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query(`select relname, relrowsecurity from pg_class
      where relname in ('billing_plans','payment_transactions','user_entitlements','entitlement_events',
                        'billing_webhook_events','product_usage_windows','product_usage_reservations')
      order by relname`);
    assert.equal(rows.length, 7);
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} must have row level security enabled`);
    }
  } finally { await db.close(); }
});
