import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.SDASH_API_KEY = 'sdash-test-key';
process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.QUESTION_PROVIDER = 'aloc_station';

const { isSubjectAvailable } = await import('../features/questions/service.ts');
const { resolveQuestionProviderId } = await import('../features/questions/routing.ts');

/**
 * The WAEC catalogue migration, applied to a real Postgres.
 *
 * The catalogue and the provider mappings are two halves of one release: a
 * subject linked in the database but unserveable upstream is offered and then
 * fails at session creation, and a mapping with no link is simply unreachable.
 * WAEC went dark in production once because those two halves disagreed, so this
 * test runs every migration in order and then checks the code against the rows
 * the database actually ends up with.
 */

const MIGRATION = 'supabase/migrations/20260920090000_waec_science_subject_coverage.sql';

const NEW_SUBJECTS = ['biology', 'chemistry', 'physics', 'agricultural-science'];
const EXISTING_SUBJECTS = [
  'mathematics', 'economics', 'government', 'commerce', 'literature-in-english',
  'principles-of-accounts', 'geography', 'christian-religious-studies',
  'civic-education', 'history', 'insurance',
];

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  return db;
}

const waecRows = async (db) => (await db.query(`
  select subject.slug, exam_subjects.is_compulsory, exam_subjects.display_order
  from exam_subjects
  join exam_bodies on exam_bodies.id = exam_subjects.exam_body_id
  join subjects subject on subject.id = exam_subjects.subject_id
  where exam_bodies.code = 'waec'
  order by exam_subjects.display_order
`)).rows;

test('V: WAEC gains exactly the four science relationships', async () => {
  const db = await database();
  try {
    const rows = await waecRows(db);
    const slugs = rows.map((row) => row.slug);

    assert.equal(rows.length, 15, 'eleven established subjects plus four new ones');
    for (const slug of NEW_SUBJECTS) assert.ok(slugs.includes(slug), `${slug} must be linked to WAEC`);
    for (const slug of EXISTING_SUBJECTS) assert.ok(slugs.includes(slug), `${slug} must still be linked`);

    // Nothing else crept in. English and Further Mathematics have no verified
    // source, so neither may appear.
    assert.deepEqual(slugs.slice().sort(), [...NEW_SUBJECTS, ...EXISTING_SUBJECTS].sort());
    assert.ok(!slugs.includes('use-of-english'));
    assert.ok(!slugs.includes('further-mathematics'));
  } finally {
    await db.close();
  }
});

test('V: no WAEC subject is made compulsory, so existing selections stay valid', async () => {
  const db = await database();
  try {
    const rows = await waecRows(db);
    assert.equal(rows.every((row) => row.is_compulsory === false), true,
      'a newly compulsory subject would invalidate every stored WAEC preference');
  } finally {
    await db.close();
  }
});

test('V: the migration creates relationships only — it never re-seeds a subject', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  assert.doesNotMatch(sql, /insert\s+into\s+public\.subjects/i,
    'the four subject rows already exist from the M1 catalogue seed');
  assert.doesNotMatch(sql, /delete\s+from/i, 'a forward-only migration removes nothing');
  assert.doesNotMatch(sql, /drop\s+/i);
  // The four sciences sit behind Mathematics rather than after eleven
  // commercial and arts subjects.
  assert.match(sql, /\('biology', 2\)/);
  assert.match(sql, /\('agricultural-science', 5\)/);
});

test('V: the migration is idempotent', async () => {
  const db = await database();
  try {
    const before = await waecRows(db);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    assert.deepEqual(await waecRows(db), before, 're-applying it must change nothing');
  } finally {
    await db.close();
  }
});

test('V: the new subjects are ordered where a science candidate will find them', async () => {
  const db = await database();
  try {
    const slugs = (await waecRows(db)).map((row) => row.slug);
    assert.deepEqual(slugs, [
      'mathematics', 'biology', 'chemistry', 'physics', 'agricultural-science',
      'economics', 'government', 'commerce', 'literature-in-english',
      'principles-of-accounts', 'geography', 'christian-religious-studies',
      'civic-education', 'history', 'insurance',
    ]);
  } finally {
    await db.close();
  }
});

test('the catalogue and the provider routing agree, subject by subject', async () => {
  const db = await database();
  try {
    const slugs = (await waecRows(db)).map((row) => row.slug);

    // Every linked subject must resolve to a provider that can actually serve
    // it, or the product offers a session it cannot build.
    for (const slug of slugs) {
      assert.equal(isSubjectAvailable('waec', slug), true,
        `${slug} is linked for WAEC but no routed provider serves it`);
    }
    for (const slug of NEW_SUBJECTS) {
      assert.equal(resolveQuestionProviderId('waec', slug), 'sdash');
    }
    for (const slug of EXISTING_SUBJECTS) {
      assert.equal(resolveQuestionProviderId('waec', slug), 'aloc_station');
    }
  } finally {
    await db.close();
  }
});

test('WAEC onboarding still accepts between one and nine subjects', async () => {
  const db = await database();
  try {
    const userId = '77777777-7777-4777-8777-777777777777';
    await db.query("insert into auth.users values ($1, 'science@example.invalid', '{}')", [userId]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);

    const ids = Object.fromEntries((await db.query('select id, slug from subjects')).rows.map((row) => [row.slug, row.id]));
    const year = new Date().getUTCFullYear() + 1;
    const save = (slugs) => db.query(
      `select complete_exam_onboarding('waec', $1, 70, '', 'moderate', $2::uuid[]) as id`,
      [year, slugs.map((slug) => ids[slug])],
    );

    // A newly available science subject is selectable.
    assert.ok((await save(['biology', 'chemistry', 'physics'])).rows[0].id);

    // The 1-9 rule is unchanged: nine is fine, ten is not.
    assert.ok((await save([...NEW_SUBJECTS, ...EXISTING_SUBJECTS.slice(0, 5)])).rows[0].id);
    await assert.rejects(
      save([...NEW_SUBJECTS, ...EXISTING_SUBJECTS.slice(0, 6)]),
      /between one and nine/,
    );

    // WAEC still has no compulsory subject, so a single choice is valid.
    assert.ok((await save(['agricultural-science'])).rows[0].id);
  } finally {
    await db.close();
  }
});

test('an existing WAEC selection made before this release remains valid', async () => {
  const db = await database();
  try {
    const userId = '66666666-6666-4666-8666-666666666666';
    await db.query("insert into auth.users values ($1, 'existing@example.invalid', '{}')", [userId]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);

    const ids = Object.fromEntries((await db.query('select id, slug from subjects')).rows.map((row) => [row.slug, row.id]));
    const year = new Date().getUTCFullYear() + 1;
    const save = (slugs) => db.query(
      `select complete_exam_onboarding('waec', $1, 70, '', 'moderate', $2::uuid[]) as id`,
      [year, slugs.map((slug) => ids[slug])],
    );

    // The old two-subject selection still saves...
    const before = (await save(['mathematics', 'government'])).rows[0].id;
    assert.ok(before);

    // ...and can later be extended with a newly available science subject,
    // rather than being rewritten by the release.
    const after = (await save(['mathematics', 'government', 'physics'])).rows[0].id;
    assert.equal(after, before, 'the same preference row is edited, not replaced');
    const chosen = (await db.query(`
      select subject.slug from student_subject_preferences link
      join subjects subject on subject.id = link.subject_id
      where link.preference_id = $1 order by link.display_order
    `, [after])).rows.map((row) => row.slug);
    assert.deepEqual(chosen, ['mathematics', 'government', 'physics']);
  } finally {
    await db.close();
  }
});

test('JAMB is untouched by the WAEC catalogue change', async () => {
  const db = await database();
  try {
    const jamb = (await db.query(`
      select subject.slug, exam_subjects.is_compulsory
      from exam_subjects
      join exam_bodies on exam_bodies.id = exam_subjects.exam_body_id
      join subjects subject on subject.id = exam_subjects.subject_id
      where exam_bodies.code = 'jamb'
      order by exam_subjects.display_order
    `)).rows;

    assert.equal(jamb.length, 23, 'the JAMB catalogue keeps its original size');
    assert.deepEqual(jamb.filter((row) => row.is_compulsory).map((row) => row.slug), ['use-of-english']);
    assert.equal(jamb[0].slug, 'use-of-english', 'JAMB display order is unchanged');
    assert.equal(jamb[1].slug, 'mathematics');
  } finally {
    await db.close();
  }
});
