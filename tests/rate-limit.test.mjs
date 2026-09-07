import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

// The bundler resolves this bare specifier; plain Node needs the file. The real
// module is used, so the 429 under test is a real NextResponse.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') {
      return { url: new URL('../node_modules/next/server.js', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

/*
 * The limiter runs on serverless instances that share no memory, so it is
 * exercised here as what it actually is: SQL. Every test below runs the real
 * migration against a real Postgres engine.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.query(`insert into auth.users values ($1,'a@example.invalid','{}'),($2,'b@example.invalid','{}')`, [USER, OTHER]);
  return db;
}

const consume = (db, key, capacity, perHour, cost = 1) =>
  db.query('select * from consume_rate_limit($1,$2,$3,$4)', [key, capacity, perHour / 3600, cost])
    .then((r) => r.rows[0]);

// ───────────────────────────────────────────────────────────────── normal use
test('a student working normally is never rate limited', async () => {
  const db = await freshDb();
  try {
    // The real default: burst 12, 30/hour. A heavy but entirely ordinary
    // afternoon of practice must pass without a single rejection.
    for (let i = 1; i <= 12; i += 1) {
      const row = await consume(db, `practice_create:${USER}`, 12, 30);
      assert.equal(row.allowed, true, `request ${i} of an ordinary burst was rejected`);
    }

    const remaining = await consume(db, `practice_create:${USER}`, 12, 30);
    assert.equal(remaining.allowed, false, 'the 13th back-to-back request is over the burst');

    // Simulate an hour passing. The bucket refills at the sustained rate.
    await db.query(`update rate_limit_buckets set updated_at = updated_at - interval '1 hour' where bucket_key = $1`, [`practice_create:${USER}`]);
    const later = await consume(db, `practice_create:${USER}`, 12, 30);
    assert.equal(later.allowed, true, 'the bucket must refill over time');
  } finally { await db.close(); }
});

test('buckets are per user, so one heavy account cannot lock out another', async () => {
  const db = await freshDb();
  try {
    for (let i = 0; i < 12; i += 1) await consume(db, `practice_create:${USER}`, 12, 30);
    assert.equal((await consume(db, `practice_create:${USER}`, 12, 30)).allowed, false);

    // This is the property that makes user-keyed limiting safe on shared IPs —
    // a whole cyber café or campus behind one address is unaffected.
    const neighbour = await consume(db, `practice_create:${OTHER}`, 12, 30);
    assert.equal(neighbour.allowed, true, 'a second student must be unaffected');
  } finally { await db.close(); }
});

test('practice and mock budgets are independent', async () => {
  const db = await freshDb();
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await consume(db, `mock_create:${USER}`, 3, 6)).allowed, true);
    }
    assert.equal((await consume(db, `mock_create:${USER}`, 3, 6)).allowed, false, 'mock burst is exhausted');
    assert.equal((await consume(db, `practice_create:${USER}`, 12, 30)).allowed, true,
      'exhausting mocks must not block practice');
  } finally { await db.close(); }
});

// ─────────────────────────────────────────────────────────── burst rejection
test('a runaway script is cut off after the burst and told when to return', async () => {
  const db = await freshDb();
  try {
    let allowed = 0;
    let firstRejection = null;
    for (let i = 0; i < 200; i += 1) {
      const row = await consume(db, `practice_create:${USER}`, 12, 30);
      if (row.allowed) allowed += 1;
      else if (!firstRejection) firstRejection = row;
    }

    assert.equal(allowed, 12, '200 rapid attempts must yield exactly the burst, never more');
    assert.ok(firstRejection, 'the rest must be rejected');
    assert.ok(firstRejection.retry_after_seconds >= 1, 'a rejection must say when to retry');
    assert.ok(firstRejection.retry_after_seconds <= 3600, 'and the wait must be sane');
  } finally { await db.close(); }
});

test('hammering a rejected bucket cannot delay its own refill', async () => {
  const db = await freshDb();
  try {
    for (let i = 0; i < 12; i += 1) await consume(db, `practice_create:${USER}`, 12, 30);

    // Half an hour passes, then the client hammers the endpoint.
    await db.query(`update rate_limit_buckets set updated_at = updated_at - interval '30 minutes' where bucket_key = $1`, [`practice_create:${USER}`]);
    for (let i = 0; i < 50; i += 1) await consume(db, `practice_create:${USER}`, 12, 30);

    // 30 minutes at 30/hour is 15 tokens, capped at 12; the 50 attempts above
    // consumed 12 of them and the rest were rejected without resetting anything.
    const { rows } = await db.query('select tokens from rate_limit_buckets where bucket_key = $1', [`practice_create:${USER}`]);
    assert.ok(Number(rows[0].tokens) >= 0, 'the balance must never go negative');

    await db.query(`update rate_limit_buckets set updated_at = updated_at - interval '1 hour' where bucket_key = $1`, [`practice_create:${USER}`]);
    assert.equal((await consume(db, `practice_create:${USER}`, 12, 30)).allowed, true,
      'the bucket still refills normally after being hammered');
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────── concurrency / race
test('concurrent consumers cannot spend the same token twice', async () => {
  const db = await freshDb();
  try {
    // Fired without awaiting in between, so the calls interleave rather than
    // running as a tidy sequence. On real Postgres the SELECT ... FOR UPDATE in
    // consume_rate_limit serialises them on the bucket row; the property under
    // test either way is that no token is ever handed out twice.
    const results = await Promise.all(
      Array.from({ length: 40 }, () => consume(db, `practice_create:${USER}`, 12, 30)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 12, `expected exactly the burst to be granted, got ${allowed}`);

    const { rows } = await db.query('select tokens from rate_limit_buckets where bucket_key = $1', [`practice_create:${USER}`]);
    assert.ok(Number(rows[0].tokens) < 1, 'the bucket must actually be drained, not merely reported as such');
    assert.ok(Number(rows[0].tokens) >= 0, 'and never oversold into a negative balance');
  } finally { await db.close(); }
});

test('the limiter rejects nonsensical parameters instead of failing open', async () => {
  const db = await freshDb();
  try {
    await assert.rejects(() => consume(db, `k:${USER}`, 0, 30), /RATE_LIMIT_PARAMS_INVALID/);
    await assert.rejects(() => consume(db, `k:${USER}`, 12, 0), /RATE_LIMIT_PARAMS_INVALID/);
    await assert.rejects(() => consume(db, '', 12, 30), /RATE_LIMIT_KEY_REQUIRED/);
  } finally { await db.close(); }
});

// ─────────────────────────────────────────────── duplicate session creation
const claim = (db, user, kind, fp, inflight = 90, duplicate = 10) =>
  db.query('select * from claim_session_creation($1,$2,$3,$4,$5)', [user, kind, fp, inflight, duplicate])
    .then((r) => r.rows[0]);
const settle = (db, user, kind, fp, sessionId) =>
  db.query('select settle_session_creation($1,$2,$3,$4)', [user, kind, fp, sessionId]);

test('a double-submitted practice request does not buy two batches of questions', async () => {
  const db = await freshDb();
  try {
    const fp = 'physics-10-practice';

    const first = await claim(db, USER, 'practice', fp);
    assert.equal(first.outcome, 'claimed', 'the first request owns the creation');

    // Second tap arrives while the provider call is still running.
    const second = await claim(db, USER, 'practice', fp);
    assert.equal(second.outcome, 'in_progress',
      'a concurrent identical request must not start its own provider fetch');

    const sessionId = '33333333-3333-4333-8333-333333333333';
    await settle(db, USER, 'practice', fp, sessionId);

    // A retried POST landing just after success gets the same session back.
    const retry = await claim(db, USER, 'practice', fp);
    assert.equal(retry.outcome, 'duplicate');
    assert.equal(retry.session_id, sessionId, 'the duplicate is answered from the first result');
  } finally { await db.close(); }
});

test('a genuinely repeated practice setup is still allowed', async () => {
  const db = await freshDb();
  try {
    const fp = 'physics-10-practice';
    await claim(db, USER, 'practice', fp);
    await settle(db, USER, 'practice', fp, '33333333-3333-4333-8333-333333333333');

    // The student finishes that set and deliberately starts an identical one.
    // Past the duplicate window this must be a real new session, never the
    // completed one handed back.
    await db.query(`update session_creation_claims set claimed_at = claimed_at - interval '60 seconds'`);
    const again = await claim(db, USER, 'practice', fp);
    assert.equal(again.outcome, 'claimed', 'a deliberate repeat must not be suppressed');
  } finally { await db.close(); }
});

test('different practice setups never collide, and neither do different students', async () => {
  const db = await freshDb();
  try {
    assert.equal((await claim(db, USER, 'practice', 'physics-10')).outcome, 'claimed');
    assert.equal((await claim(db, USER, 'practice', 'chemistry-20')).outcome, 'claimed',
      'a different setup is a different request');
    assert.equal((await claim(db, OTHER, 'practice', 'physics-10')).outcome, 'claimed',
      'another student is never blocked by this one');
  } finally { await db.close(); }
});

test('an abandoned creation stops blocking once its in-flight window passes', async () => {
  const db = await freshDb();
  try {
    const fp = 'physics-10-practice';
    await claim(db, USER, 'practice', fp);
    assert.equal((await claim(db, USER, 'practice', fp)).outcome, 'in_progress');

    // The instance handling it died without settling.
    await db.query(`update session_creation_claims set claimed_at = claimed_at - interval '10 minutes'`);
    assert.equal((await claim(db, USER, 'practice', fp)).outcome, 'claimed',
      'a dead claim must never lock a student out permanently');
  } finally { await db.close(); }
});

test('releasing a failed creation lets the student retry at once', async () => {
  const db = await freshDb();
  try {
    const fp = 'physics-10-practice';
    await claim(db, USER, 'practice', fp);
    await settle(db, USER, 'practice', fp, null);   // provider error path

    assert.equal((await claim(db, USER, 'practice', fp)).outcome, 'claimed',
      'a student who hit a provider error must not be told to wait');
  } finally { await db.close(); }
});

test('practice and exam claims are tracked separately', async () => {
  const db = await freshDb();
  try {
    await claim(db, USER, 'practice', 'shared-fingerprint');
    assert.equal((await claim(db, USER, 'exam', 'shared-fingerprint')).outcome, 'claimed',
      'starting a mock must not be blocked by a practice claim');
    await assert.rejects(() => claim(db, USER, 'nonsense', 'x'), /INVALID_SESSION_KIND/);
  } finally { await db.close(); }
});

// ───────────────────────────────────────── existing protections stay intact
test('the one-active-mock-per-exam guarantee is unchanged', async () => {
  const db = await freshDb();
  try {
    const exam = (await db.query("select id from exam_bodies where code='jamb'")).rows[0].id;
    const blueprint = (await db.query('select id from exam_blueprints where exam_body_id=$1', [exam])).rows[0].id;
    const insert = () => db.query(
      `insert into exam_attempts(user_id,exam_body_id,blueprint_id,exam_year,source_provider,status,duration_seconds,total_questions,started_at,expires_at)
       values($1,$2,$3,2027,'aloc','in_progress',7200,180,now(),now()+interval '2 hours') returning id`,
      [USER, exam, blueprint]);

    await insert();
    await assert.rejects(insert, /duplicate key|unique/i,
      'the partial unique index must still prevent a second live attempt');

    await db.query(`update exam_attempts set status='submitted', submitted_at=now(), submission_reason='manual' where user_id=$1`, [USER]);
    await insert();   // a new mock after submitting is legitimate
  } finally { await db.close(); }
});

test('neither new table nor RPC is reachable by a signed-in browser session', async () => {
  const db = await freshDb();
  try {
    for (const table of ['rate_limit_buckets', 'session_creation_claims']) {
      for (const privilege of ['select', 'insert', 'update', 'delete']) {
        const { rows } = await db.query('select has_table_privilege($1,$2,$3) allowed', ['authenticated', table, privilege]);
        assert.equal(rows[0].allowed, false, `authenticated must not ${privilege} ${table}`);
      }
    }
    for (const fn of [
      'consume_rate_limit(text,numeric,numeric,numeric)',
      'claim_session_creation(uuid,text,text,integer,integer)',
      'settle_session_creation(uuid,text,text,uuid)',
    ]) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query('select has_function_privilege($1,$2,$3) allowed', [role, fn, 'execute']);
        assert.equal(rows[0].allowed, false, `${role} must not execute ${fn}`);
      }
    }
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────── failure never leaks detail
test('a limiter failure is refused without leaking internals to the student', async () => {
  const SECRET = 'postgresql://svc:sb_secret_DO_NOT_LEAK@db.internal:5432/app';
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(args.join(' '));

  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@/lib/supabase/admin') {
        return {
          url: 'data:text/javascript,' + encodeURIComponent(
            `export function createAdminClient(){ return { rpc: async () => ({ data: null, error: { message: globalThis.__dbError } }) }; }`),
          shortCircuit: true,
        };
      }
      return next(specifier, context);
    },
  });

  try {
    globalThis.__dbError = `connection failed for ${SECRET}`;
    const { consumeRateLimit, rateLimitedResponse, RATE_LIMITS } = await import('../lib/rate-limit.ts');

    const result = await consumeRateLimit(RATE_LIMITS.practiceCreate, USER);
    assert.equal(result.allowed, false,
      'the limiter fails closed: it must not wave requests through when it cannot check them');

    const response = rateLimitedResponse(result);
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('Retry-After'), 'a 429 must carry Retry-After');

    const body = await response.json();
    const serialised = JSON.stringify(body);
    assert.doesNotMatch(serialised, /sb_secret/, 'no key material may reach the client');
    assert.doesNotMatch(serialised, /postgresql:\/\//, 'no connection string may reach the client');
    assert.doesNotMatch(serialised, /db\.internal/, 'no host may reach the client');
    assert.doesNotMatch(serialised, /rate_limit_buckets|consume_rate_limit/, 'no schema detail may reach the client');
    assert.match(body.error, /wait/i, 'the student is told what to do instead');
    assert.equal(body.code, 'RATE_LIMITED');

    assert.ok(messages.some((m) => m.includes('[rate-limit]')), 'the real cause is logged server-side');
  } finally {
    console.error = originalError;
    delete globalThis.__dbError;
  }
});

test('configured limits are sane and generous by default', async () => {
  const { RATE_LIMITS } = await import('../lib/rate-limit.ts');
  for (const [name, policy] of Object.entries(RATE_LIMITS)) {
    assert.ok(policy.capacity >= 1, `${name} must allow at least one request`);
    assert.ok(policy.perHour >= 1, `${name} must refill`);
    assert.ok(policy.capacity <= policy.perHour, `${name}: a burst larger than the hourly rate is a misconfiguration`);
  }
  assert.ok(RATE_LIMITS.practiceCreate.capacity >= 10, 'ordinary study must never hit the practice limit');
  assert.ok(RATE_LIMITS.mockCreate.capacity >= 2, 'a student must be able to restart a mock');
});
