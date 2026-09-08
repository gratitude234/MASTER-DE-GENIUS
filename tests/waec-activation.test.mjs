import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

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
  for (const file of readdirSync("supabase/migrations").sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  return db;
}

test("WAEC catalogue and generic onboarding RPC enforce the new exam rules", async () => {
  const db = await database();
  try {
    const userId = "77777777-7777-4777-8777-777777777777";
    await db.query("insert into auth.users values ($1, 'waec@example.invalid', '{}')", [userId]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);

    const rows = (await db.query(`
      select subject.slug
      from exam_subjects
      join exam_bodies on exam_bodies.id = exam_subjects.exam_body_id
      join subjects subject on subject.id = exam_subjects.subject_id
      where exam_bodies.code = 'waec'
      order by exam_subjects.display_order
    `)).rows.map((row) => row.slug);
    assert.equal(rows.length, 11);
    assert.ok(rows.includes("mathematics"));
    assert.ok(rows.includes("civic-education"));
    assert.ok(!rows.includes("physics"), "unverified WAEC Physics must not be offered");

    const ids = (await db.query("select id, slug from subjects where slug in ('mathematics', 'government')")).rows;
    const idBySlug = Object.fromEntries(ids.map((row) => [row.slug, row.id]));
    const year = new Date().getUTCFullYear() + 1;
    const result = await db.query(`
      select complete_exam_onboarding(
        'waec', $1, 70, 'Medicine', 'moderate', array[$2, $3]::uuid[]
      ) as id
    `, [year, idBySlug.mathematics, idBySlug.government]);
    assert.ok(result.rows[0].id);

    const preference = (await db.query(`
      select exam_bodies.code, target_score, is_primary
      from student_exam_preferences
      join exam_bodies on exam_bodies.id = student_exam_preferences.exam_body_id
      where user_id = $1
    `, [userId])).rows[0];
    assert.deepEqual(preference, { code: "waec", target_score: 70, is_primary: true });

    await assert.rejects(
      db.query(`select complete_exam_onboarding('waec', $1, 101, '', 'light', array[$2]::uuid[])`, [year, idBySlug.mathematics]),
      /WAEC percentage goal must be between 1 and 100/,
    );

    const jambIds = (await db.query(`
      select subject.id
      from exam_subjects
      join exam_bodies on exam_bodies.id = exam_subjects.exam_body_id
      join subjects subject on subject.id = exam_subjects.subject_id
      where exam_bodies.code = 'jamb' and subject.slug <> 'use-of-english'
      order by exam_subjects.display_order
      limit 4
    `)).rows.map((row) => row.id);
    await assert.rejects(
      db.query(`select complete_exam_onboarding('jamb', $1, 280, '', 'moderate', $2::uuid[])`, [year, jambIds]),
      /compulsory subject is missing/i,
    );

    assert.equal((await db.query("select has_function_privilege('anon', 'complete_exam_onboarding(text,integer,integer,text,study_intensity,uuid[])', 'execute') allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('authenticated', 'complete_exam_onboarding(text,integer,integer,text,study_intensity,uuid[])', 'execute') allowed")).rows[0].allowed, true);
  } finally {
    await db.close();
  }
});
