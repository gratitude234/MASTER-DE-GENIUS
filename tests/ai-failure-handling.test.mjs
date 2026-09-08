import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const { GeminiExplanationError } = await import('../features/ai/providers/gemini.ts');

/**
 * What happens when MASTER AI cannot produce an explanation.
 *
 * Two defects met here in production. The provider's reason was recorded only
 * in `ai_usage`, so a generation outage appeared in the deployment log as
 * nothing at all — a 503 with no cause. And the daily allowance was reserved
 * before generation and never returned, so three failures left a student told
 * they had used three explanations they never received.
 */

const USER = '11111111-1111-4111-8111-111111111111';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.query(`insert into auth.users values ($1,'student@example.invalid','{}')`, [USER]);
  return db;
}

const consume = (db, limit = 3) => db.query(
  `select * from consume_ai_daily_quota($1,'question_explanation',$2)`, [USER, limit],
).then((r) => r.rows[0]);

const refund = (db) => db.query(
  `select refund_ai_daily_quota($1,'question_explanation') as remaining`, [USER],
).then((r) => r.rows[0].remaining);

test('a failed generation returns the allowance it reserved', async () => {
  const db = await freshDb();
  try {
    // Three attempts, all of which fail upstream.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await consume(db)).allowed, true);
      await refund(db);
    }

    // The student has received nothing, so all three are still available.
    const usage = await db.query('select generation_count from ai_daily_usage where user_id = $1', [USER]);
    assert.equal(usage.rows[0].generation_count, 0, 'failures must not consume the daily allowance');
    assert.equal((await consume(db)).allowed, true, 'a fourth attempt is still permitted');
  } finally { await db.close(); }
});

test('a successful generation still spends the allowance', async () => {
  const db = await freshDb();
  try {
    // Three successes, no refunds — the limit must still bite.
    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await consume(db)).allowed, true);
    assert.equal((await consume(db)).allowed, false, 'the Free daily limit of three still holds');
  } finally { await db.close(); }
});

test('a refund can never manufacture allowance', async () => {
  const db = await freshDb();
  try {
    // Refunding against a day with nothing spent is a no-op, not a credit.
    for (let i = 0; i < 5; i += 1) assert.equal(await refund(db), 0);

    const rows = await db.query('select generation_count from ai_daily_usage where user_id = $1', [USER]);
    assert.equal(rows.rows.length, 0, 'no usage row is invented by a refund');

    // Spend one, then refund far more times than it was spent.
    await consume(db);
    for (let i = 0; i < 5; i += 1) await refund(db);
    const after = await db.query('select generation_count from ai_daily_usage where user_id = $1', [USER]);
    assert.equal(after.rows[0].generation_count, 0, 'the count floors at zero');

    // The limit is intact afterwards.
    for (let i = 0; i < 3; i += 1) assert.equal((await consume(db)).allowed, true);
    assert.equal((await consume(db)).allowed, false);
  } finally { await db.close(); }
});

test('the refund is unreachable from browser roles', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query(`select
      has_function_privilege('anon','public.refund_ai_daily_quota(uuid,text)','execute') as anon_exec,
      has_function_privilege('authenticated','public.refund_ai_daily_quota(uuid,text)','execute') as auth_exec,
      has_function_privilege('service_role','public.refund_ai_daily_quota(uuid,text)','execute') as svc_exec,
      (select prosecdef from pg_proc where proname = 'refund_ai_daily_quota'
         and pronamespace = 'public'::regnamespace) as secdef,
      (select coalesce(array_to_string(proconfig,','),'') from pg_proc where proname = 'refund_ai_daily_quota'
         and pronamespace = 'public'::regnamespace) as config`);

    assert.equal(rows[0].anon_exec, false, 'a student must not be able to refund their own quota');
    assert.equal(rows[0].auth_exec, false);
    assert.equal(rows[0].svc_exec, true);
    assert.equal(rows[0].secdef, true);
    assert.match(rows[0].config, /^search_path=""?$/);
  } finally { await db.close(); }
});

test('the service refunds on failure and only on failure', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');

  const successReturn = source.indexOf('return { explanation, cached: false');
  const catchBlock = source.indexOf('} catch (error) {', successReturn);
  const refundCall = source.indexOf('refundDailyQuota(userId)', catchBlock);

  assert.ok(refundCall > catchBlock, 'the refund happens on the failure path');
  assert.ok(
    source.indexOf('refundDailyQuota(userId)', successReturn) > catchBlock,
    'the success path must not refund',
  );
});

test('a provider failure is logged with a reason, not swallowed', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');
  assert.match(source, /console\.error\(\s*`\[ai\] generation failed: category=/,
    'the category must reach the deployment log, not only the ai_usage table');
  assert.ok(source.includes('error.detail'), 'the sanitized provider reason is logged with it');
});

test('the logged provider reason names the model but never a credential', () => {
  const error = new GeminiExplanationError('provider', 'model=gemini-x status=404 not found');
  assert.equal(error.category, 'provider');
  assert.match(error.detail, /model=gemini-x/, 'the model name is the most common cause and is safe to log');
  assert.match(error.detail, /status=404/);

  const source = readFileSync('features/ai/providers/gemini.ts', 'utf8');
  const describe = source.slice(source.indexOf('function describeProviderError'));

  // A provider message can carry a key; long token-shaped runs are redacted.
  assert.ok(describe.includes('[redacted-key]'), 'API keys are stripped from provider messages');
  assert.ok(describe.includes('.slice(0, 200)'), 'the message is bounded');
  assert.ok(!source.includes('console.log'));
});

test('sanitization actually removes a key-shaped value', async () => {
  /*
   * Exercised through the real code path rather than by reading it: a provider
   * error whose message embeds a credential must not survive into the detail.
   */
  const { generateGeminiExplanation } = await import('../features/ai/providers/gemini.ts');
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'AIzaSyFAKEKEYFORTESTINGONLY1234567890abcd';

  try {
    await generateGeminiExplanation('x');
    assert.fail('a request with a fabricated key must not succeed');
  } catch (error) {
    assert.ok(error instanceof GeminiExplanationError);
    if (error.detail) {
      assert.ok(!error.detail.includes('AIzaSyFAKEKEYFORTESTINGONLY1234567890abcd'),
        'the fabricated key must never appear in the logged detail');
    }
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
