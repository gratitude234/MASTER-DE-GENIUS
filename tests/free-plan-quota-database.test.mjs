import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * Free plan v2 — the guarantees that have to hold in PostgreSQL itself.
 *
 *   4 practice questions a day, 2 mocks a month, 2 new MASTER AI explanations a
 *   day, account-wide, on the Lagos calendar.
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
const LIMIT = 4;

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

/** The Free path: create_metered_practice_session, exactly as the route calls it. */
async function metered(user, count, { day = DAY, exam = 'jamb', subject = 'physics', mode = 'practice', limit = LIMIT } = {}) {
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

/** The Free answer path: save_metered_practice_response. */
async function answer(user, session, question, { day = DAY, key = 'A', mutation = randomUUID(), limit = LIMIT, expected } = {}) {
  const rev = expected ?? await revision(user, session, question);
  const { rows } = await db.query(
    'select save_metered_practice_response($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [user, session, question, key, rev, mutation, day, limit],
  );
  return rows[0].result;
}

async function allowance(user, day = DAY, limit = LIMIT) {
  return (await db.query('select * from practice_question_allowance($1,$2,$3)', [user, day, limit])).rows[0];
}

async function ledgerRows(user) {
  return (await db.query('select count(*)::int as total from practice_question_usage where user_id=$1', [user])).rows[0].total;
}

const LIMIT_ERROR = /FREE_PRACTICE_LIMIT/;

// ───────────────────────────────────────────────────── FREE PRACTICE

test('1. a new Free student has 4 of 4 practice questions', async () => {
  const user = await student();
  assert.deepEqual(await allowance(user), { allowance: 4, used: 0, waiting: 0, remaining: 4, available: 4 });
});

test('2. answering one practice question leaves 3', async () => {
  const user = await student();
  const session = await metered(user, 1);
  const [q] = await questions(session);
  const result = await answer(user, session, q);

  assert.equal(result.allowance.used, 1);
  assert.equal(result.allowance.remaining, 3);
  assert.equal((await allowance(user)).remaining, 3);
});

test('2b. answering one question of a larger session leaves 3 remaining, with the rest waiting', async () => {
  const user = await student();
  const session = await metered(user, 3);
  const [q1] = await questions(session);
  await answer(user, session, q1);

  assert.deepEqual(await allowance(user), { allowance: 4, used: 1, waiting: 2, remaining: 3, available: 1 });
});

test('3–5. four questions across three subjects exhaust one shared allowance; the fifth is refused', async () => {
  const user = await student();
  // 2 Biology + 1 Chemistry + 1 Mathematics, exactly as the product brief describes.
  const biology = await metered(user, 2, { subject: 'biology' });
  for (const q of await questions(biology)) await answer(user, biology, q);
  const chemistry = await metered(user, 1, { subject: 'chemistry' });
  await answer(user, chemistry, (await questions(chemistry))[0]);
  const maths = await metered(user, 1, { subject: 'mathematics' });
  await answer(user, maths, (await questions(maths))[0]);

  assert.deepEqual(await allowance(user), { allowance: 4, used: 4, waiting: 0, remaining: 0, available: 0 });
  await assert.rejects(metered(user, 1, { subject: 'physics' }), LIMIT_ERROR, 'a new subject does not reset or multiply it');

  const sessions = (await db.query('select count(*)::int as total from practice_sessions where user_id=$1', [user])).rows[0].total;
  assert.equal(sessions, 3, 'the refused session was never created, so its questions never existed');
});

test('6. JAMB and WAEC share one allowance', async () => {
  const user = await student();
  const jambSession = await metered(user, 3, { exam: 'jamb' });
  for (const q of await questions(jambSession)) await answer(user, jambSession, q);

  await assert.rejects(metered(user, 2, { exam: 'waec' }), LIMIT_ERROR, 'WAEC is not another 4');
  const waecSession = await metered(user, 1, { exam: 'waec' });
  await answer(user, waecSession, (await questions(waecSession))[0]);
  assert.equal((await allowance(user)).remaining, 0);
});

test('7. a new session can never contain more questions than remain', async () => {
  const user = await student();
  await assert.rejects(metered(user, 5), LIMIT_ERROR, 'a 5-question paper on a 4-question day');
  const first = await metered(user, 2);
  for (const q of await questions(first)) await answer(user, first, q);

  await assert.rejects(metered(user, 3), LIMIT_ERROR, '3 requested, 2 left');
  const second = await metered(user, 2);
  assert.equal((await questions(second)).length, 2);
  await assert.rejects(metered(user, 1), LIMIT_ERROR, 'held questions already account for the rest');
});

test('8. reading the allowance — a refresh, a dashboard, a setup screen — consumes nothing', async () => {
  const user = await student();
  const session = await metered(user, 2);
  const before = await ledgerRows(user);
  for (let i = 0; i < 5; i++) await allowance(user);
  await db.query('select * from practice_question_load($1,$2)', [user, DAY]);
  assert.equal(await ledgerRows(user), before);
  assert.deepEqual(await allowance(user), { allowance: 4, used: 0, waiting: 2, remaining: 4, available: 2 });
  assert.ok(session);
});

test('9. a duplicate or retried answer submission is charged once', async () => {
  const user = await student();
  const legacy = await unmetered(user, 2);
  const [q] = await questions(legacy);
  const mutation = randomUUID();

  const first = await answer(user, legacy, q, { mutation, expected: 0 });
  const replay = await answer(user, legacy, q, { mutation, expected: 0 });
  assert.equal(first.revision, 1);
  assert.equal(replay.revision, 1, 'a lost acknowledgement replays the stored receipt');

  // A second tap with a new mutation id: practice mode locks the first answer.
  await answer(user, legacy, q, { key: 'B' });
  assert.equal((await allowance(user)).used, 1);
  assert.equal(await ledgerRows(user), 1);
});

test('9b. changing an answer in a timed session never charges a second question', async () => {
  const user = await student();
  const session = await metered(user, 2, { mode: 'timed' });
  const [q] = await questions(session);
  await answer(user, session, q, { key: 'A' });
  await answer(user, session, q, { key: 'B' });
  await answer(user, session, q, { key: 'A' });
  const state = await allowance(user);
  assert.equal(state.used, 1);
  assert.equal(state.waiting, 1);
});

test('10–11. reviewing answers, results and the mistake bank reads — and consumes nothing', async () => {
  const user = await student();
  const session = await metered(user, 2);
  const [q1] = await questions(session);
  await answer(user, session, q1);
  await db.query('select complete_practice_session($1,$2)', [user, session]);
  const before = await allowance(user);

  // Exactly what the results page and the mistake bank read.
  await db.query('select * from practice_sessions where id=$1 and user_id=$2', [session, user]);
  await db.query('select * from practice_session_questions where session_id=$1', [session]);
  await db.query('select * from practice_answers where session_id=$1 and user_id=$2', [session, user]);
  assert.deepEqual(await allowance(user), before);
});

test('12. mock questions never consume the practice allowance', async () => {
  const user = await student();
  const blueprint = (await db.query('select id from exam_blueprints where exam_body_id=$1', [jamb])).rows[0].id;
  const physics = subjects('jamb', 'physics');
  const attempt = (await db.query(`insert into exam_attempts(user_id,exam_body_id,blueprint_id,exam_year,source_provider,status,duration_seconds,total_questions,started_at,expires_at)
    values($1,$2,$3,2027,'internal','in_progress',3600,1,now(),now()+interval '1 hour') returning id`, [user, jamb, blueprint])).rows[0].id;
  const section = (await db.query('insert into exam_attempt_subjects(attempt_id,subject_id,display_order,question_count) values($1,$2,1,1) returning id', [attempt, physics])).rows[0].id;
  const eq = (await db.query(`insert into exam_attempt_questions(attempt_id,attempt_subject_id,subject_id,subject_position,overall_position,source_provider,source_question_id,student_snapshot,correct_option_key)
    values($1,$2,$3,1,1,'internal','m1',$4,'A') returning id`, [attempt, section, physics, JSON.stringify({ options: [{ key: 'A' }] })])).rows[0].id;
  await db.query(`select save_response_v2($1,'exam',$2,$3,'A',false,0,$4)`, [user, attempt, eq, randomUUID()]);

  assert.deepEqual(await allowance(user), { allowance: 4, used: 0, waiting: 0, remaining: 4, available: 4 });
});

test('13. two tabs racing for the final question: exactly one is charged', async () => {
  const user = await student();
  // Three answered, then two unheld questions from a pre-release session.
  const warmup = await metered(user, 3);
  for (const q of await questions(warmup)) await answer(user, warmup, q);
  const legacy = await unmetered(user, 2);
  const [a, b] = await questions(legacy);

  const results = await Promise.allSettled([answer(user, legacy, a, { expected: 0 }), answer(user, legacy, b, { expected: 0 })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(String(results.find((r) => r.status === 'rejected').reason), LIMIT_ERROR);
  assert.equal((await allowance(user)).used, 4);

  const refused = results.findIndex((r) => r.status === 'rejected');
  const answers = (await db.query('select count(*)::int as total from practice_answers where session_question_id=$1', [[a, b][refused]])).rows[0].total;
  assert.equal(answers, 0, 'the refused answer was never written — the charge and the answer are one transaction');
});

test('13b. racing session starts for the last questions: exactly one paper is built', async () => {
  const user = await student();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => metered(user, 2)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2, '2 + 2 = 4 held, every other start refused');
  assert.equal((await allowance(user)).available, 0);
});

test('14. the next Lagos day starts a fresh allowance', async () => {
  const user = await student();
  const session = await metered(user, 4);
  for (const q of await questions(session)) await answer(user, session, q);
  assert.equal((await allowance(user, DAY)).remaining, 0);

  assert.deepEqual(await allowance(user, NEXT_DAY), { allowance: 4, used: 0, waiting: 0, remaining: 4, available: 4 });
  const tomorrow = await metered(user, 4, { day: NEXT_DAY });
  assert.equal((await questions(tomorrow)).length, 4);
});

test('15. a Master session writes nothing to the Free ledger', async () => {
  const user = await student();
  // Master's practice path is the unchanged one: create_practice_session and save_response_v2.
  const session = await unmetered(user, 10);
  for (const q of await questions(session)) {
    await db.query(`select save_response_v2($1,'practice',$2,$3,'A',false,0,$4)`, [user, session, q, randomUUID()]);
  }
  assert.equal(await ledgerRows(user), 0);
});

// ─────────────────────────────────────── holds, carried questions, legacy

test('a held question is always answerable, even with nothing left to start', async () => {
  const user = await student();
  const session = await metered(user, 4);
  assert.equal((await allowance(user)).available, 0);
  for (const q of await questions(session)) await answer(user, session, q);
  assert.equal((await allowance(user)).used, 4);
});

test('finishing a session with unanswered questions counts them — finishing reveals their answers', async () => {
  const user = await student();
  const session = await metered(user, 4);
  const [q1] = await questions(session);
  await answer(user, session, q1);
  await db.query('select complete_practice_session($1,$2)', [user, session]);

  // "Start 4, finish at once, read the answers, repeat" must not be free.
  assert.deepEqual(await allowance(user), { allowance: 4, used: 4, waiting: 0, remaining: 0, available: 0 });
  await assert.rejects(metered(user, 1), LIMIT_ERROR);
});

test('questions held yesterday stay answerable today and reserve today’s allowance', async () => {
  const user = await student();
  const session = await metered(user, 3, { day: DAY });
  const [q1, q2, q3] = await questions(session);
  await answer(user, session, q1, { day: DAY });

  const today = await allowance(user, NEXT_DAY);
  assert.deepEqual(today, { allowance: 4, used: 0, waiting: 2, remaining: 4, available: 2 });
  await assert.rejects(metered(user, 3, { day: NEXT_DAY }), LIMIT_ERROR, 'carried questions are not double-spent');

  await answer(user, session, q2, { day: NEXT_DAY });
  await answer(user, session, q3, { day: NEXT_DAY });
  assert.deepEqual(await allowance(user, NEXT_DAY), { allowance: 4, used: 2, waiting: 0, remaining: 2, available: 2 });
});

test('a legacy session: answers take today’s allowance, stop at the limit, and never rewrite history', async () => {
  const user = await student();
  const legacy = await unmetered(user, 20);
  const ids = await questions(legacy);
  // One answered before the release (the unmetered path, no ledger row).
  await db.query(`select save_response_v2($1,'practice',$2,$3,'A',false,0,$4)`, [user, legacy, ids[0], randomUUID()]);
  const snapshotBefore = (await db.query('select student_snapshot, correct_option_key from practice_session_questions where session_id=$1 order by position', [legacy])).rows;

  // Re-submitting the pre-release answer costs nothing.
  await answer(user, legacy, ids[0], { key: 'B' });
  assert.equal((await allowance(user)).used, 0);

  for (const q of ids.slice(1, 5)) await answer(user, legacy, q);
  assert.equal((await allowance(user)).remaining, 0);
  await assert.rejects(answer(user, legacy, ids[5]), LIMIT_ERROR, 'the 16 other questions are locked for today');

  const snapshotAfter = (await db.query('select student_snapshot, correct_option_key from practice_session_questions where session_id=$1 order by position', [legacy])).rows;
  assert.deepEqual(snapshotAfter, snapshotBefore, 'the frozen paper is untouched');
  assert.equal((await answer(user, legacy, ids[5], { day: NEXT_DAY })).allowance.used, 1, 'tomorrow unlocks the next one');
});

test('a refused answer charges nothing: finished session, foreign session, expired timer', async () => {
  const alice = await student();
  const bob = await student();
  const session = await metered(alice, 2);
  const [q1, q2] = await questions(session);

  await assert.rejects(answer(bob, session, q1), /SESSION_NOT_FOUND/, 'another student cannot spend or answer it');
  assert.equal(await ledgerRows(bob), 0);

  await db.query('select complete_practice_session($1,$2)', [alice, session]);
  await assert.rejects(answer(alice, session, q2), /PRACTICE_SESSION_NOT_ACTIVE/);

  const timed = await unmetered(alice, 1, { mode: 'timed' });
  await db.query("update practice_sessions set expires_at = now() - interval '1 second' where id=$1", [timed]);
  const before = await ledgerRows(alice);
  await assert.rejects(answer(alice, timed, (await questions(timed))[0]), /PRACTICE_SESSION_TIME_UP/);
  assert.equal(await ledgerRows(alice), before, 'the charge rolled back with the refused answer');
});

test('an expired timed session’s held questions are no longer waiting', async () => {
  const user = await student();
  const timed = await metered(user, 2, { mode: 'timed' });
  await db.query("update practice_sessions set expires_at = now() - interval '1 second' where id=$1", [timed]);
  assert.deepEqual(await allowance(user), { allowance: 4, used: 2, waiting: 0, remaining: 2, available: 2 });
});

test('metered functions refuse nonsense parameters', async () => {
  const user = await student();
  await assert.rejects(db.query('select * from practice_question_allowance($1,$2,$3)', [user, 'today', 4]), /PRODUCT_QUOTA_PARAMS_INVALID/);
  await assert.rejects(db.query('select * from practice_question_allowance($1,$2,$3)', [user, DAY, 0]), /PRODUCT_QUOTA_PARAMS_INVALID/);
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

test('58. every new function is out of reach of browser roles — a direct call cannot bypass the UI', async () => {
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

test('38–40. a Paystack activation after a used-up Free day changes the plan, not the usage account', async () => {
  const user = await student();
  const session = await metered(user, 4);
  for (const q of await questions(session)) await answer(user, session, q);
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

  // Master's practice is the unmetered path, so the exhausted Free day no longer applies.
  const masterSession = await unmetered(user, 20);
  assert.equal((await questions(masterSession)).length, 20);

  // When Master lapses, the same Free ledger resumes where it was.
  await db.query(`update user_entitlements set expires_at = now() - interval '1 second' where user_id=$1`, [user]);
  assert.equal((await db.query('select * from current_billing_entitlement($1)', [user])).rows[0].tier, 'free');
  assert.equal((await allowance(user)).remaining, 0, 'expired Master resumes today’s Free usage');
});

test('the migration is safe to re-run and preserves usage history', async () => {
  const user = await student();
  const session = await metered(user, 2);
  await answer(user, session, (await questions(session))[0]);
  const before = await allowance(user);

  await db.exec(readFileSync(MIGRATION, 'utf8'));

  assert.deepEqual(await allowance(user), before);
  assert.equal(await ledgerRows(user), 2);
});
