import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * The Free plan — the guarantees that have to hold in PostgreSQL itself.
 *
 *   1 new practice session a day (up to 20 questions), 2 mocks a month, 2 new
 *   MASTER AI explanations a day, account-wide, on the Lagos calendar.
 *
 * Application code can be bypassed by a second entry point or a future
 * refactor; these run the real migrations and call the functions every route
 * goes through. Each test works with its own freshly created students, so one
 * migrated database serves the whole file.
 *
 * On concurrency: PGlite is a single connection, so `Promise.all` here
 * interleaves whole function calls rather than racing row locks. What it proves
 * is that each check-and-charge is one atomic statement with no window between
 * the count and the write — the same standard the M9 quota tests use. The row
 * lock that serialises real concurrent sessions is asserted structurally below.
 */

const MIGRATION = 'supabase/migrations/20260921100000_free_plan_conversion_quotas.sql';
const DAY = '2026-09-21';
const NEXT_DAY = '2026-09-22';
/** The Free practice allowance: one new session a day. */
const LIMIT = 1;
/** The Free per-day allowance the cancelled question meter used, for legacy fixtures. */
const LEGACY_QUESTION_LIMIT = 4;

let db;
let jamb;
let waec;
let subjects;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  jamb = (await db.query("select id from exam_bodies where code='jamb'")).rows[0].id;
  waec = (await db.query("select id from exam_bodies where code='waec'")).rows[0].id;
  const rows = (await db.query(`
    select e.code, s.slug, s.id from exam_subjects es
    join subjects s on s.id = es.subject_id join exam_bodies e on e.id = es.exam_body_id
    where e.code in ('jamb','waec')`)).rows;
  subjects = (code, slug) => rows.find((row) => row.code === code && (!slug || row.slug === slug))?.id;
});

after(async () => { await db?.close(); });

async function student() {
  const id = randomUUID();
  await db.query(`insert into auth.users values ($1,$2,'{}')`, [id, `${id}@example.invalid`]);
  return id;
}

function paper(count, prefix = 'q') {
  return JSON.stringify(Array.from({ length: count }, (_, index) => ({
    sourceProvider: 'internal',
    sourceQuestionId: `${prefix}${index + 1}`,
    studentSnapshot: { id: `${prefix}${index + 1}`, prompt: `Question ${index + 1}`, options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }] },
    correctOptionKey: 'A',
    explanation: 'A is correct.',
  })));
}

/**
 * A session built by the cancelled per-question meter.
 *
 * Retained to build *legacy* fixtures: papers frozen before this release may
 * still exist, and the compatibility rule is that they open and finish
 * normally. No application path calls this function any more.
 */
async function metered(user, count, { day = DAY, exam = 'jamb', subject = 'physics', mode = 'practice', limit = LEGACY_QUESTION_LIMIT } = {}) {
  const examId = exam === 'jamb' ? jamb : waec;
  const subjectId = subjects(exam, subject) ?? subjects(exam);
  const duration = mode === 'timed' ? count * 60 : null;
  const { rows } = await db.query(
    `select create_metered_practice_session($1,$2,$3,null,$4,null,null,$5,'internal',$6,$7::jsonb,$8,$9) as id`,
    [user, examId, subjectId, mode, count, duration, paper(count), day, limit],
  );
  return rows[0].id;
}

/** A session built before this release, or while the student had Master: no holds. */
async function unmetered(user, count, { exam = 'jamb', subject = 'physics', mode = 'practice' } = {}) {
  const examId = exam === 'jamb' ? jamb : waec;
  const { rows } = await db.query(
    `select create_practice_session($1,$2,$3,null,$4,null,null,$5,'internal',$6,$7::jsonb) as id`,
    [user, examId, subjects(exam, subject) ?? subjects(exam), mode, count, mode === 'timed' ? count * 60 : null, paper(count)],
  );
  return rows[0].id;
}

async function questions(session) {
  return (await db.query('select id from practice_session_questions where session_id=$1 order by position', [session])).rows.map((row) => row.id);
}

async function revision(user, session, question) {
  const { rows } = await db.query(
    `select revision from response_revisions where user_id=$1 and kind='practice' and session_id=$2 and question_id=$3`,
    [user, session, question],
  );
  return rows[0]?.revision ?? 0;
}

/** The cancelled metered answer path. Legacy fixtures only. */
async function answer(user, session, question, { day = DAY, key = 'A', mutation = randomUUID(), limit = LEGACY_QUESTION_LIMIT, expected } = {}) {
  const rev = expected ?? await revision(user, session, question);
  const { rows } = await db.query(
    'select save_metered_practice_response($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [user, session, question, key, rev, mutation, day, limit],
  );
  return rows[0].result;
}

async function allowance(user, day = DAY, limit = LEGACY_QUESTION_LIMIT) {
  return (await db.query('select * from practice_question_allowance($1,$2,$3)', [user, day, limit])).rows[0];
}

async function ledgerRows(user) {
  return (await db.query('select count(*)::int as total from practice_question_usage where user_id=$1', [user])).rows[0].total;
}

// ───────────────────────────────────────────────────── FREE PRACTICE

/**
 * One new practice session a day, account-wide, of up to 20 questions.
 *
 * The counting mechanism is `reserve_product_quota`, the same one mocks use:
 * the student's window row is locked before the count, so two requests landing
 * on different serverless instances serialise there. Practice is no longer
 * metered per question — `create_practice_session` writes no ledger row, and
 * answering writes none either.
 */

async function reservePractice(user, day = DAY, limit = LIMIT) {
  return (await db.query('select * from reserve_product_quota($1,$2,$3,$4,120)', [user, 'practice_session', day, limit])).rows[0];
}
async function practiceUsage(user, day = DAY) {
  return (await db.query(`select product_quota_usage($1,'practice_session',$2) as used`, [user, day])).rows[0].used;
}
async function startSession(user, options = {}) {
  const reservation = await reservePractice(user, options.day, options.limit);
  if (!reservation.allowed) return { allowed: false, session: null };
  const session = await unmetered(user, options.count ?? 20, options);
  await db.query('select commit_product_quota($1)', [reservation.reservation_id]);
  return { allowed: true, session };
}

test('1. a new Free student has one practice session available today', async () => {
  const user = await student();
  assert.equal(await practiceUsage(user), 0);
  assert.equal((await reservePractice(user)).remaining, 0, 'one session, so reserving it leaves none');
});

test('2-3. the first new session spends the day, and may hold 20 questions', async () => {
  const user = await student();
  const { allowed, session } = await startSession(user, { count: 20 });

  assert.equal(allowed, true);
  assert.equal((await questions(session)).length, 20, 'a Free session may be the full 20');
  assert.equal(await practiceUsage(user), 1, 'today is spent');
  assert.equal(await ledgerRows(user), 0, 'no per-question ledger row is written any more');
});

test('5. a second new session the same day is refused', async () => {
  const user = await student();
  await startSession(user);
  assert.equal((await reservePractice(user)).allowed, false);
});

test('6-7. a different subject and a different exam body share the one allowance', async () => {
  const user = await student();
  await startSession(user, { exam: 'jamb', subject: 'physics' });

  // The window key carries the day and nothing else — no subject, no exam. A
  // student preparing for both JAMB and WAEC has one allowance, not two.
  assert.equal((await reservePractice(user)).allowed, false, 'Biology does not get a second session');
  assert.equal(await practiceUsage(user), 1);
});

test('8-9. resuming, answering and finishing never spend another session', async () => {
  const user = await student();
  const { session } = await startSession(user, { count: 5 });
  const ids = await questions(session);

  // Answering goes through the unchanged response function, which touches no
  // quota at all — so a student always finishes what they started.
  for (const id of ids) {
    const rev = await revision(user, session, id);
    await db.query(`select save_response_v2($1,'practice',$2,$3,'A',false,$4,$5)`, [user, session, id, rev, randomUUID()]);
  }
  await db.query('select * from complete_practice_session($1,$2)', [user, session]);

  assert.equal(await practiceUsage(user), 1, 'one session created, one session charged');
  assert.equal(await ledgerRows(user), 0);
});

test('8b. reading the allowance — a refresh, a dashboard, a setup screen — spends nothing', async () => {
  const user = await student();
  await startSession(user);
  for (let i = 0; i < 5; i++) assert.equal(await practiceUsage(user), 1);
});

test('10. a session that is never created hands the day straight back', async () => {
  const user = await student();
  const reservation = await reservePractice(user);
  await db.query('select release_product_quota($1)', [reservation.reservation_id]);

  assert.equal(await practiceUsage(user), 0, 'a provider outage costs nothing');
  assert.equal((await reservePractice(user)).allowed, true, 'and the day is available again');
});

test('10b. an abandoned build stops counting once its lease runs out', async () => {
  const user = await student();
  const pending = await reservePractice(user);
  assert.equal(await practiceUsage(user), 1, 'a session being built already counts');

  await db.query(`update product_usage_reservations set lease_expires_at = now() - interval '1 second' where id=$1`, [pending.reservation_id]);
  assert.equal(await practiceUsage(user), 0, 'an abandoned build does not');
  assert.equal((await reservePractice(user)).allowed, true);
});

test('11. two tabs racing for the day: exactly one session is allowed', async () => {
  const user = await student();
  const results = await Promise.all(Array.from({ length: 5 }, () => reservePractice(user)));
  assert.equal(results.filter((row) => row.allowed).length, 1, 'exactly one wins');
});

test('12. the next Lagos day restores the one session', async () => {
  const user = await student();
  await startSession(user);
  assert.equal((await reservePractice(user)).allowed, false);
  assert.equal((await reservePractice(user, NEXT_DAY)).allowed, true, 'tomorrow brings a new session');
});

test('12b. the day key the application computes is the Lagos day the database uses', async () => {
  // 22:30Z on the 21st is already the 22nd in Lagos (UTC+1). The two must agree,
  // or a student's allowance would refill an hour early or late.
  const lagosDay = async (instant) =>
    (await db.query(`select to_char(product_quota_day($1::timestamptz), 'YYYY-MM-DD') as day`, [instant])).rows[0].day;

  assert.equal(await lagosDay('2026-09-21T23:30:00Z'), NEXT_DAY, '00:30 in Lagos is already tomorrow');
  assert.equal(await lagosDay('2026-09-21T22:30:00Z'), DAY, '23:30 in Lagos is still today');
});

test('13. Master practice is unchanged: its own, much larger, daily allowance', async () => {
  const user = await student();
  const results = await Promise.all(Array.from({ length: 5 }, () => reservePractice(user, DAY, 200)));
  assert.equal(results.filter((row) => row.allowed).length, 5, 'Master is nowhere near its limit');

  const session = await unmetered(user, 40);
  assert.equal((await questions(session)).length, 40, 'and keeps its 40-question papers');
});

test('14. a legacy session created under the old plan stays whole and resumable', async () => {
  /*
   * Compatibility rule. Papers frozen under the cancelled per-question plan may
   * still carry `practice_question_usage` rows. Nothing reads them any more, so
   * the session opens in full, every question stays answerable, and the stored
   * result is never rewritten.
   */
  const user = await student();
  const legacy = await metered(user, 4);
  const ids = await questions(legacy);
  assert.equal(await ledgerRows(user), 4, 'the old ledger rows are still there');

  // The day's allowance is untouched by a session that predates it.
  assert.equal(await practiceUsage(user), 0);

  for (const id of ids) {
    const rev = await revision(user, legacy, id);
    const receipt = await db.query(`select save_response_v2($1,'practice',$2,$3,'A',false,$4,$5)`, [user, legacy, id, rev, randomUUID()]);
    assert.ok(receipt.rows[0], 'every legacy question is still answerable');
  }

  const completed = (await db.query('select * from complete_practice_session($1,$2)', [user, legacy])).rows[0];
  assert.equal(completed.status, 'completed');
  assert.equal(completed.answered_count, 4, 'the legacy result is intact');
  assert.equal(await ledgerRows(user), 4, 'and its history was neither deleted nor rewritten');
});

test('14b. today’s session is still available to a student who is resuming a legacy paper', async () => {
  const user = await student();
  await metered(user, 4);
  assert.equal((await reservePractice(user)).allowed, true, 'an old session does not consume the new allowance');
});

test('50. a student can never reach another student’s session or usage', async () => {
  const [owner, intruder] = [await student(), await student()];
  const { session } = await startSession(owner, { count: 2 });
  const [question] = await questions(session);

  await assert.rejects(
    db.query(`select save_response_v2($1,'practice',$2,$3,'A',false,0,$4)`, [intruder, session, question, randomUUID()]),
    'answering somebody else’s session is refused',
  );
  assert.equal(await practiceUsage(intruder), 0, 'and their allowance is their own');
  assert.equal(await practiceUsage(owner), 1);
});

test('reserve_product_quota refuses nonsense parameters', async () => {
  const user = await student();
  await assert.rejects(db.query('select * from reserve_product_quota($1,$2,$3,0,120)', [user, 'practice_session', DAY]));
  await assert.rejects(db.query('select * from reserve_product_quota($1,$2,$3,1,120)', [user, 'free_lunch', DAY]));
});

// ───────────────────────────────────────────────────────────── FREE MOCK

async function reserveMock(user, windowKey, limit = 2) {
  return (await db.query('select * from reserve_product_quota($1,$2,$3,$4,120)', [user, 'mock_attempt', windowKey, limit])).rows[0];
}
async function mockUsage(user, windowKey) {
  return (await db.query(`select product_quota_usage($1,'mock_attempt',$2) as used`, [user, windowKey])).rows[0].used;
}

test('16–20. Free mocks: 2 remaining, then 1, then 0, and the third is refused', async () => {
  const user = await student();
  assert.equal(await mockUsage(user, '2026-09'), 0, '2 of 2 remaining');

  const first = await reserveMock(user, '2026-09');
  await db.query('select commit_product_quota($1)', [first.reservation_id]);
  assert.equal(await mockUsage(user, '2026-09'), 1, '1 remaining');

  const second = await reserveMock(user, '2026-09');
  await db.query('select commit_product_quota($1)', [second.reservation_id]);
  assert.equal(await mockUsage(user, '2026-09'), 2, '0 remaining');

  assert.equal((await reserveMock(user, '2026-09')).allowed, false, 'a third Free mock is refused');
});

test('21–22. a resumed or refreshed attempt releases its reservation and never counts twice', async () => {
  const user = await student();
  const start = await reserveMock(user, '2026-09');
  await db.query('select commit_product_quota($1)', [start.reservation_id]);
  for (let i = 0; i < 3; i++) {
    const resume = await reserveMock(user, '2026-09');
    await db.query('select release_product_quota($1)', [resume.reservation_id]);
  }
  assert.equal(await mockUsage(user, '2026-09'), 1);
});

test('23. racing starts for the final Free mock: exactly one wins', async () => {
  const user = await student();
  const first = await reserveMock(user, '2026-09');
  await db.query('select commit_product_quota($1)', [first.reservation_id]);
  const results = await Promise.all(Array.from({ length: 5 }, () => reserveMock(user, '2026-09')));
  assert.equal(results.filter((r) => r.allowed).length, 1);
});

test('24–25. mocks reset monthly, and JAMB and WAEC share the one monthly allowance', async () => {
  const user = await student();
  // The window key has no exam in it: a WAEC start and a JAMB start spend the same two.
  for (let i = 0; i < 2; i++) {
    const r = await reserveMock(user, '2026-09');
    await db.query('select commit_product_quota($1)', [r.reservation_id]);
  }
  assert.equal((await reserveMock(user, '2026-09')).allowed, false);
  assert.equal((await reserveMock(user, '2026-10')).allowed, true, 'October brings two new mocks');
});

test('26. Master mock allowance is unchanged: three a day', async () => {
  const user = await student();
  const results = await Promise.all(Array.from({ length: 5 }, () => reserveMock(user, '2026-09-21', 3)));
  assert.equal(results.filter((r) => r.allowed).length, 3);
});

test('mock usage counts live reservations but not lapsed ones', async () => {
  const user = await student();
  const pending = await reserveMock(user, '2026-09');
  assert.equal(await mockUsage(user, '2026-09'), 1, 'a paper being built already counts');
  await db.query(`update product_usage_reservations set lease_expires_at = now() - interval '1 second' where id=$1`, [pending.reservation_id]);
  assert.equal(await mockUsage(user, '2026-09'), 0, 'an abandoned build does not');
});

// ──────────────────────────────────────────────────────────── MASTER AI

async function consumeAi(user, limit = 2) {
  return (await db.query(`select * from consume_ai_daily_quota($1,'question_explanation',$2)`, [user, limit])).rows[0];
}
async function aiUsed(user) {
  return (await db.query(`select ai_quota_usage($1,'question_explanation') as used`, [user])).rows[0].used;
}

test('27–30. Free MASTER AI: 2, then 1, then 0, and the third generation is refused', async () => {
  const user = await student();
  assert.equal(await aiUsed(user), 0);
  assert.deepEqual(await consumeAi(user), { allowed: true, remaining: 1 });
  assert.deepEqual(await consumeAi(user), { allowed: true, remaining: 0 });
  assert.deepEqual(await consumeAi(user), { allowed: false, remaining: 0 });
  assert.equal(await aiUsed(user), 2);
});

test('33. a failed generation hands its explanation back', async () => {
  const user = await student();
  await consumeAi(user);
  await consumeAi(user);
  await db.query(`select refund_ai_daily_quota($1,'question_explanation')`, [user]);
  assert.equal(await aiUsed(user), 1);
  assert.equal((await consumeAi(user)).allowed, true);
});

test('34. racing requests for the final explanation: exactly one is charged', async () => {
  const user = await student();
  await consumeAi(user);
  const results = await Promise.all(Array.from({ length: 6 }, () => consumeAi(user)));
  assert.equal(results.filter((r) => r.allowed).length, 1);
});

test('35. the AI allowance is counted on the Lagos day and resets with it', async () => {
  const user = await student();
  await consumeAi(user);
  const { rows } = await db.query(`select usage_date = product_quota_day(clock_timestamp()) as lagos from ai_daily_usage where user_id=$1`, [user]);
  assert.equal(rows[0].lagos, true, 'charged against the WAT date, not the UTC one');

  await db.query(`update ai_daily_usage set usage_date = usage_date - 1 where user_id=$1`, [user]);
  assert.equal(await aiUsed(user), 0, 'yesterday’s explanations do not count today');
});

test('36. Master MASTER AI allowance is unchanged: twenty a day', async () => {
  const user = await student();
  const results = await Promise.all(Array.from({ length: 25 }, () => consumeAi(user, 20)));
  assert.equal(results.filter((r) => r.allowed).length, 20);
});

test('reopening an explanation is recorded once per student and explanation', async () => {
  const user = await student();
  const key = 'a'.repeat(64);
  await db.query('insert into ai_explanation_receipts(user_id, cache_key) values ($1,$2) on conflict do nothing', [user, key]);
  await db.query('insert into ai_explanation_receipts(user_id, cache_key) values ($1,$2) on conflict do nothing', [user, key]);
  const { rows } = await db.query('select count(*)::int as total from ai_explanation_receipts where user_id=$1', [user]);
  assert.equal(rows[0].total, 1);
  await assert.rejects(db.query('insert into ai_explanation_receipts(user_id, cache_key) values ($1,$2)', [user, 'short']));
});

// ───────────────────────────────────────────────────── the calendar

test('the database and the application agree on the Lagos day, either side of midnight', async () => {
  const { quotaWindow } = await import('../features/billing/quota.ts');
  for (const instant of [
    '2026-09-21T11:00:00Z', '2026-09-21T22:59:59Z', '2026-09-21T23:00:00Z',
    '2026-09-30T23:30:00Z', '2026-12-31T22:59:59Z', '2026-12-31T23:00:01Z',
  ]) {
    const { rows } = await db.query(`select to_char(product_quota_day($1::timestamptz),'YYYY-MM-DD') as day`, [instant]);
    assert.equal(rows[0].day, quotaWindow('day', new Date(instant)).key, instant);
  }
});

// ─────────────────────────────────────────────────────────── SECURITY

test('55–56. no browser role can read or write the ledgers', async () => {
  const { rows } = await db.query(`select
    has_table_privilege('authenticated','public.practice_question_usage','select') as auth_read,
    has_table_privilege('authenticated','public.practice_question_usage','insert') as auth_write,
    has_table_privilege('anon','public.practice_question_usage','select') as anon_read,
    has_table_privilege('authenticated','public.ai_explanation_receipts','select') as receipt_read,
    has_table_privilege('authenticated','public.ai_explanation_receipts','insert') as receipt_write,
    has_table_privilege('authenticated','public.ai_daily_usage','update') as ai_write,
    (select relrowsecurity from pg_class where oid = 'public.practice_question_usage'::regclass) as ledger_rls,
    (select relrowsecurity from pg_class where oid = 'public.ai_explanation_receipts'::regclass) as receipt_rls`);
  assert.deepEqual(rows[0], {
    auth_read: false, auth_write: false, anon_read: false,
    receipt_read: false, receipt_write: false, ai_write: false,
    ledger_rls: true, receipt_rls: true,
  });
});

test('56b. an authenticated student sees no ledger rows, not even their own', async () => {
  const user = await student();
  await metered(user, 1);
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [user]);
    await assert.rejects(db.query('select * from practice_question_usage'), /permission denied/);
  } finally {
    await db.exec('rollback');
  }
});

const NEW_FUNCTIONS = [
  ['practice_question_allowance', 'uuid,text,integer'],
  ['create_metered_practice_session', 'uuid,uuid,uuid,uuid,public.practice_mode,public.question_difficulty,integer,integer,text,integer,jsonb,text,integer'],
  ['save_metered_practice_response', 'uuid,uuid,uuid,text,integer,uuid,text,integer'],
  ['product_quota_usage', 'uuid,text,text'],
  ['ai_quota_usage', 'uuid,text'],
  ['lock_practice_question_ledger', 'uuid'],
  ['practice_question_load', 'uuid,text'],
  ['consume_ai_daily_quota', 'uuid,text,integer'],
  ['refund_ai_daily_quota', 'uuid,text'],
];

/**
 * The per-question functions are retained (a migration is forward-only and
 * dropping them would break nothing but gain nothing) and unused. They must
 * stay out of reach of the browser regardless: an unused SECURITY DEFINER
 * function a student could call is still a way in.
 */
test('51/58. every quota function is out of reach of browser roles — a direct call cannot bypass the UI', async () => {
  for (const [name, args] of NEW_FUNCTIONS) {
    const { rows } = await db.query(`select
      has_function_privilege('authenticated', $1, 'execute') as auth,
      has_function_privilege('anon', $1, 'execute') as anon`, [`public.${name}(${args})`]);
    assert.deepEqual(rows[0], { auth: false, anon: false }, name);
  }
});

test('every new function is SECURITY DEFINER with a pinned empty search_path', async () => {
  const names = NEW_FUNCTIONS.map(([name]) => name);
  const { rows } = await db.query(`
    select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1)`, [names]);
  assert.equal(rows.length, names.length);
  for (const row of rows) {
    assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
    assert.match(row.config, /^search_path=""?$/, `${row.proname} must pin an empty search_path`);
  }
});

test('the metered functions resolve to public even under a hostile search_path', async () => {
  const user = await student();
  await db.exec(`create schema if not exists evil;
    create table if not exists evil.practice_question_usage (like public.practice_question_usage including all);
    set search_path = evil, public;`);
  try {
    const session = await metered(user, 1);
    await answer(user, session, (await questions(session))[0]);
    const decoy = (await db.query('select count(*)::int as total from evil.practice_question_usage')).rows[0].total;
    assert.equal(decoy, 0, 'nothing was written to the decoy');
    assert.equal((await db.query('select count(*)::int as total from public.practice_question_usage where user_id=$1', [user])).rows[0].total, 1);
  } finally {
    await db.exec('set search_path = public');
  }
});

test('the lock anchor accepts the new capability and still rejects anything else', async () => {
  const user = await student();
  await db.query(`insert into product_usage_windows(user_id, capability, window_key) values ($1,'practice_question','account')`, [user]);
  await assert.rejects(db.query(`insert into product_usage_windows(user_id, capability, window_key) values ($1,'free_lunch','account')`, [user]));
});

test('the metered paths take the per-student ledger lock before touching anything', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  for (const fn of ['create_metered_practice_session', 'save_metered_practice_response']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    const lock = body.indexOf('lock_practice_question_ledger(p_user_id)');
    const charge = body.search(/insert into public\.practice_question_usage|create_practice_session\(/);
    assert.ok(lock > 0 && lock < charge, `${fn} must serialise on the ledger lock before charging`);
  }
  assert.match(sql, /for update;/, 'the anchor row is locked, not merely read');
});

// ─────────────────────────────────────────────────────────── ENTITLEMENT

test('38–40/52. a Paystack activation after a used-up Free day changes the plan, not the usage account', async () => {
  const user = await student();
  await startSession(user, { count: 20 });
  assert.equal((await reservePractice(user)).allowed, false, 'today is spent on Free');
  const ledgerBefore = await ledgerRows(user);
  const anchorsBefore = (await db.query('select count(*)::int as total from product_usage_windows where user_id=$1', [user])).rows[0].total;

  await db.query(`select * from open_billing_checkout($1,'master_30','mdg_ref_upgrade_${user.slice(0, 8)}','test',900)`, [user]);
  await db.query(`select * from apply_successful_payment('mdg_ref_upgrade_${user.slice(0, 8)}',150000,'NGN','test','ps_1','success',null)`);
  // A replayed webhook and the browser callback settle the same reference.
  await db.query(`select * from apply_successful_payment('mdg_ref_upgrade_${user.slice(0, 8)}',150000,'NGN','test','ps_1','success',null)`);

  const entitlement = (await db.query('select * from current_billing_entitlement($1)', [user])).rows[0];
  assert.equal(entitlement.is_master, true, 'Master applies at once — no new day, no new sign-in');
  assert.equal(await ledgerRows(user), ledgerBefore, 'Free usage history is untouched');
  assert.equal(
    (await db.query('select count(*)::int as total from product_usage_windows where user_id=$1', [user])).rows[0].total,
    anchorsBefore,
    'no second usage account is created',
  );

  // Master is counted against its own, much larger, daily limit, so the
  // exhausted Free day stops applying on the very next request.
  assert.equal((await reservePractice(user, DAY, 200)).allowed, true, 'Master practises at once');
  const masterSession = await unmetered(user, 40);
  assert.equal((await questions(masterSession)).length, 40);

  // When Master lapses, the same usage account resumes where it was.
  await db.query(`update user_entitlements set expires_at = now() - interval '1 second' where user_id=$1`, [user]);
  assert.equal((await db.query('select * from current_billing_entitlement($1)', [user])).rows[0].tier, 'free');
  assert.equal((await reservePractice(user)).allowed, false, 'expired Master resumes today’s Free usage');
});

test('the migration is safe to re-run and preserves usage history', async () => {
  const user = await student();
  await startSession(user, { count: 2 });
  const legacy = await metered(user, 2);
  await answer(user, legacy, (await questions(legacy))[0]);
  const legacyBefore = await allowance(user);

  await db.exec(readFileSync(MIGRATION, 'utf8'));

  assert.equal(await practiceUsage(user), 1, 'the session reservation survives');
  assert.deepEqual(await allowance(user), legacyBefore, 'and so does the legacy ledger');
  assert.equal(await ledgerRows(user), 2);
});
