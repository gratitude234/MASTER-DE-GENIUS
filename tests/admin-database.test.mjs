import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * The admin guarantees that have to hold in PostgreSQL, not merely in the
 * Next.js guards: a student cannot reach admin data or promote themselves, a
 * restricted role cannot perform a super-admin operation even when the server
 * forgets to check, every privileged write leaves an audit row that nobody can
 * alter, and the platform can never be left without a super admin.
 */

const ADMIN_MIGRATION = '20260914000001_admin_system.sql';

const OWNER = '10000000-0000-4000-8000-000000000001';
const SECOND = '10000000-0000-4000-8000-000000000002';
const ACADEMIC = '10000000-0000-4000-8000-000000000003';
const SUPPORT = '10000000-0000-4000-8000-000000000004';
const CLASSES = '10000000-0000-4000-8000-000000000005';
const STUDENT = '20000000-0000-4000-8000-000000000001';
const OTHER_STUDENT = '20000000-0000-4000-8000-000000000002';

const users = [
  [OWNER, 'owner@example.invalid'], [SECOND, 'second@example.invalid'], [ACADEMIC, 'academic@example.invalid'],
  [SUPPORT, 'support@example.invalid'], [CLASSES, 'classes@example.invalid'], [STUDENT, 'ada@example.invalid'],
  [OTHER_STUDENT, 'bayo@example.invalid'],
];

async function freshDb({ beforeAdminMigration } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    if (file === ADMIN_MIGRATION) {
      for (const [id, email] of users) {
        await db.query(`insert into auth.users values ($1,$2,$3)`, [id, email, JSON.stringify({ full_name: email.split('@')[0] })]);
      }
      if (beforeAdminMigration) await beforeAdminMigration(db);
    }
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  return db;
}

/** A platform with one of each role, set up the only supported way. */
async function staffedDb() {
  const db = await freshDb();
  await db.query(`select bootstrap_first_super_admin('owner@example.invalid')`);
  for (const [email, role] of [['second@example.invalid', 'super_admin'], ['academic@example.invalid', 'academic_admin'],
    ['support@example.invalid', 'support_admin'], ['classes@example.invalid', 'classes_admin']]) {
    await db.query(`select admin_grant_membership($1,$2,$3,'Initial staffing for tests')`, [OWNER, email, role]);
  }
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function asBrowser(db, role, userId, fn) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    if (userId) await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId]);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

// ──────────────────────────────────────────────────────────── exposure

test('browser roles hold no privilege on any admin table or privileged function', async () => {
  const db = await freshDb();
  try {
    for (const table of ['app_admins', 'admin_role_permissions', 'admin_audit_log', 'admin_internal_notes',
      'support_cases', 'question_blocks', 'account_suspensions']) {
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['select', 'insert', 'update', 'delete']) {
          const { allowed } = await one(db, `select has_table_privilege($1,$2,$3) as allowed`, [role, `public.${table}`, privilege]);
          assert.equal(allowed, false, `${role} must not ${privilege} ${table}`);
        }
      }
      const { relrowsecurity } = await one(db, `select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${table}`]);
      assert.equal(relrowsecurity, true, `${table} must have RLS enabled`);
      const { total } = await one(db, `select count(*)::int as total from pg_policies where schemaname='public' and tablename=$1 and permissive='RESTRICTIVE'`, [table]);
      assert.equal(total, 1, `${table} carries a restrictive deny policy`);
    }

    const { rows } = await db.query(`
      select p.oid::regprocedure::text as signature, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'admin\\_%' or p.proname in ('assert_admin_permission','record_admin_audit','bootstrap_first_super_admin'))`);
    assert.ok(rows.length >= 25, 'every admin function is enumerated');
    for (const { signature } of rows) {
      for (const role of ['anon', 'authenticated']) {
        const { allowed } = await one(db, `select has_function_privilege($1,$2,'execute') as allowed`, [role, signature]);
        assert.equal(allowed, false, `${role} must not execute ${signature}`);
      }
    }

    const bootstrap = await one(db, `select has_function_privilege('service_role','public.bootstrap_first_super_admin(text)','execute') as allowed`);
    assert.equal(bootstrap.allowed, false, 'even the service key cannot bootstrap a super admin through the API');
    const audit = await one(db, `select has_function_privilege('service_role','public.record_admin_audit(uuid,admin_role,text,text,text,text,jsonb,jsonb)','execute') as allowed`);
    assert.equal(audit.allowed, false, 'audit rows are written only inside the privileged functions');
  } finally { await db.close(); }
});

test('a signed-in student reads nothing and cannot promote themselves', async () => {
  const db = await staffedDb();
  try {
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query('select * from app_admins'), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query('select * from admin_audit_log'), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query(`insert into app_admins (user_id, role) values ($1,'super_admin')`, [STUDENT]), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query(`select admin_grant_membership($1,'ada@example.invalid','super_admin','let me in please')`, [OWNER]), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query(`update user_entitlements set tier='master', expires_at=now()+interval '1 year' where user_id=$1`, [STUDENT]), /permission denied/);
    });
    // Even the trusted server cannot write memberships or CRM state around the audited functions.
    const direct = await one(db, `select has_table_privilege('service_role','public.app_admins','insert') as admins_insert,
      has_table_privilege('service_role','public.premium_class_leads','update') as leads_update,
      has_table_privilege('service_role','public.admin_audit_log','insert') as audit_insert`);
    assert.deepEqual(direct, { admins_insert: false, leads_update: false, audit_insert: false });
  } finally { await db.close(); }
});

test('every admin function is SECURITY DEFINER with an empty search_path', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'admin\\_%' or p.proname in
        ('assert_admin_permission','record_admin_audit','bootstrap_first_super_admin','guard_last_super_admin'))
        and p.proname <> 'admin_required_reason'`);
    for (const row of rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert.match(row.config, /^search_path=""?$/, `${row.proname} must pin an empty search_path`);
    }
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── roles

test('the seeded permission matrix matches the application vocabulary and least privilege', async () => {
  const { ADMIN_PERMISSIONS, ADMIN_ROLES } = await import('../features/admin/permissions.ts');
  const db = await freshDb();
  try {
    const { rows } = await db.query('select role::text, permission from admin_role_permissions order by 1, 2');
    const byRole = Object.fromEntries(ADMIN_ROLES.map((role) => [role, rows.filter((row) => row.role === role).map((row) => row.permission)]));
    assert.deepEqual([...new Set(rows.map((row) => row.permission))].sort(), [...ADMIN_PERMISSIONS].sort(),
      'TypeScript and the database name exactly the same permissions');
    assert.deepEqual(byRole.super_admin.sort(), [...ADMIN_PERMISSIONS].sort(), 'super admin holds everything');
    for (const role of ['academic_admin', 'support_admin', 'classes_admin']) {
      for (const sensitive of ['admins.manage', 'audit.view', 'payments.view', 'entitlements.grant', 'system.view', 'students.manage']) {
        assert.ok(!byRole[role].includes(sensitive), `${role} must not hold ${sensitive}`);
      }
    }
    assert.ok(!byRole.support_admin.includes('classes.view'));
    assert.ok(!byRole.classes_admin.includes('students.view'));
    assert.ok(byRole.academic_admin.includes('questions.manage'));
  } finally { await db.close(); }
});

test('admins allowlisted before roles keep CRM-only access instead of being promoted', async () => {
  const db = await freshDb({
    beforeAdminMigration: (db) => db.query('insert into app_admins (user_id) values ($1)', [CLASSES]),
  });
  try {
    const row = await one(db, 'select role::text, is_active from app_admins where user_id=$1', [CLASSES]);
    assert.deepEqual(row, { role: 'classes_admin', is_active: true });
    await assert.rejects(() => db.query('insert into app_admins (user_id) values ($1)', [SECOND]), /null value in column "role"/,
      'a new membership must state its role');
  } finally { await db.close(); }
});

test('the first super admin can be bootstrapped exactly once', async () => {
  const db = await freshDb();
  try {
    await assert.rejects(() => db.query(`select bootstrap_first_super_admin('nobody@example.invalid')`), /ADMIN_TARGET_NOT_FOUND/);
    const created = await one(db, `select bootstrap_first_super_admin('  OWNER@example.invalid ') as id`);
    assert.equal(created.id, OWNER);
    await assert.rejects(() => db.query(`select bootstrap_first_super_admin('second@example.invalid')`), /SUPER_ADMIN_ALREADY_EXISTS/);
    const audit = await one(db, `select action, actor_id from admin_audit_log where entity_id=$1`, [OWNER]);
    assert.deepEqual(audit, { action: 'admin.bootstrap', actor_id: null });
  } finally { await db.close(); }
});

test('the platform can never lose its last super admin, and nobody edits their own access', async () => {
  const db = await freshDb();
  try {
    await db.query(`select bootstrap_first_super_admin('owner@example.invalid')`);
    await assert.rejects(() => db.query(`update app_admins set is_active=false, deactivated_at=now() where user_id=$1`, [OWNER]), /LAST_SUPER_ADMIN/);
    await assert.rejects(() => db.query(`update app_admins set role='support_admin' where user_id=$1`, [OWNER]), /LAST_SUPER_ADMIN/);
    await assert.rejects(() => db.query(`delete from app_admins where user_id=$1`, [OWNER]), /LAST_SUPER_ADMIN/);
    await assert.rejects(() => db.query(`delete from auth.users where id=$1`, [OWNER]), /LAST_SUPER_ADMIN/);
    await assert.rejects(() => db.query(`select admin_update_membership($1,$1,'support_admin',true,'stepping down myself')`, [OWNER]), /ADMIN_SELF_MODIFICATION/);

    await db.query(`select admin_grant_membership($1,'second@example.invalid','super_admin','Second owner for cover')`, [OWNER]);
    await db.query(`select admin_update_membership($1,$2,null,false,'Handing over to second owner')`, [SECOND, OWNER]);
    const owner = await one(db, 'select is_active, deactivated_at is not null as stamped from app_admins where user_id=$1', [OWNER]);
    assert.deepEqual(owner, { is_active: false, stamped: true });
    // The deactivated owner can no longer act at all.
    await assert.rejects(() => db.query(`select admin_update_membership($1,$2,'support_admin',true,'trying to act after removal')`, [OWNER, SECOND]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_update_membership($1,$2,null,false,'removing the other one too')`, [SECOND, SECOND]), /ADMIN_SELF_MODIFICATION/);

    const { rows } = await db.query(`select action from admin_audit_log where entity_type='admin' order by id`);
    assert.deepEqual(rows.map((row) => row.action), ['admin.bootstrap', 'admin.grant', 'admin.deactivate']);
  } finally { await db.close(); }
});

test('restricted roles are refused super-admin operations by the database itself', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`select admin_grant_membership($1,'ada@example.invalid','super_admin','promote a friend now')`, [ACADEMIC]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_grant_master_access($1,$2,30,null,'free month for a friend')`, [SUPPORT, STUDENT]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_record_suspension($1,$2,'looks suspicious to me')`, [SUPPORT, STUDENT]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_block_question($1,'aloc','jamb','physics','9','wrong answer key')`, [CLASSES]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_weekly_analytics($1,8)`, [ACADEMIC]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select * from admin_list_students($1)`, [CLASSES]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select * from admin_list_admins($1)`, [SUPPORT]), /ADMIN_PERMISSION_DENIED/);
    // A student id passed as the actor is simply not an admin.
    await assert.rejects(() => db.query(`select admin_overview_metrics($1)`, [STUDENT]), /ADMIN_PERMISSION_DENIED/);

    const overview = (await one(db, `select admin_overview_metrics($1) as data`, [CLASSES])).data;
    assert.ok(overview.leads, 'a classes admin sees the lead pipeline');
    for (const hidden of ['monetisation', 'students', 'platform_health', 'support']) {
      assert.equal(overview[hidden], undefined, `a classes admin must not receive ${hidden}`);
    }
    const support = (await one(db, `select admin_overview_metrics($1) as data`, [SUPPORT])).data;
    assert.equal(support.monetisation, undefined, 'support never receives revenue');
    assert.ok(support.students && support.session_health && support.support);
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── entitlements

test('a manual Master grant extends access, records who and why, and leaves payment history alone', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`select admin_grant_master_access($1,$2,30,null,'ok')`, [OWNER, STUDENT]), /ADMIN_REASON_REQUIRED/);
    await assert.rejects(() => db.query(`select admin_grant_master_access($1,$2,30,now()+interval '40 days','both shapes given')`, [OWNER, STUDENT]), /ENTITLEMENT_GRANT_SHAPE_INVALID/);

    // A real purchase first, so the grant has history it must not disturb.
    await db.query(`select * from open_billing_checkout($1,'master_30','mdg_ref_admin_0001','live',900)`, [STUDENT]);
    await db.query(`select * from apply_successful_payment('mdg_ref_admin_0001',150000,'NGN','live','ps_1','success',null)`);
    const before = await one(db, 'select expires_at, total_paid_kobo, last_payment_id from user_entitlements where user_id=$1', [STUDENT]);

    const granted = (await one(db, `select admin_grant_master_access($1,$2,14,null,'Compensation for provider outage') as r`, [OWNER, STUDENT])).r;
    assert.equal(granted.event_type, 'extended');
    const after = await one(db, 'select tier, expires_at, total_paid_kobo, last_payment_id from user_entitlements where user_id=$1', [STUDENT]);
    assert.equal(after.tier, 'master');
    assert.equal(after.expires_at.getTime() - before.expires_at.getTime(), 14 * 86400000, 'early extension keeps the days already paid for');
    assert.equal(after.total_paid_kobo, before.total_paid_kobo, 'a grant is not money');
    assert.equal(after.last_payment_id, before.last_payment_id);

    const { total } = await one(db, `select count(*)::int as total from payment_transactions where user_id=$1`, [STUDENT]);
    assert.equal(total, 1, 'no payment row is invented');

    const event = await one(db, `select source, actor_id, reason, payment_id, previous_expires_at from entitlement_events where user_id=$1 order by id desc limit 1`, [STUDENT]);
    assert.equal(event.source, 'admin');
    assert.equal(event.actor_id, OWNER);
    assert.equal(event.payment_id, null);
    assert.equal(event.previous_expires_at.getTime(), before.expires_at.getTime());
    const paid = await one(db, `select source from entitlement_events where user_id=$1 order by id asc limit 1`, [STUDENT]);
    assert.equal(paid.source, 'payment', 'existing payment events keep their provenance');

    const audit = await one(db, `select actor_role::text, action, reason, before_state, after_state from admin_audit_log where entity_id=$1 and action like 'entitlement.%'`, [STUDENT]);
    assert.equal(audit.actor_role, 'super_admin');
    assert.equal(audit.action, 'entitlement.extend');
    assert.equal(audit.reason, 'Compensation for provider outage');
    assert.equal(audit.before_state.master_active, true);
    assert.equal(audit.after_state.days, 14);

    await assert.rejects(() => db.query(`select admin_grant_master_access($1,$2,null,now()+interval '2 days','shorten by accident')`, [OWNER, STUDENT]), /ENTITLEMENT_WOULD_SHORTEN/);

    const free = (await one(db, `select admin_grant_master_access($1,$2,null,now()+interval '10 days','Scholarship student access') as r`, [OWNER, OTHER_STUDENT])).r;
    assert.equal(free.event_type, 'granted');
    const current = await one(db, 'select * from current_billing_entitlement($1)', [OTHER_STUDENT]);
    assert.equal(current.is_master, true, 'the student product resolves the grant through the same entitlement function');
  } finally { await db.close(); }
});

test('the audit trail cannot be edited, deleted or truncated by anyone', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`update admin_audit_log set reason='covered up'`), /ADMIN_AUDIT_LOG_IMMUTABLE/);
    await assert.rejects(() => db.query(`delete from admin_audit_log`), /ADMIN_AUDIT_LOG_IMMUTABLE/);
    await assert.rejects(() => db.query(`truncate admin_audit_log`), /ADMIN_AUDIT_LOG_IMMUTABLE/);
    const { total } = await one(db, 'select count(*)::int as total from admin_audit_log');
    assert.equal(total, 5, 'bootstrap plus four grants are all still recorded');
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── CRM and support

async function createLead(db, userId = STUDENT) {
  const { rows } = await db.query(`select * from create_premium_class_lead($1,'Ada Student','jamb','physics','Physics',null,'private','08012345678',null,'whatsapp','Evenings',null,'class_page','student_requested',null,$2)`,
    [userId, 'f'.repeat(64)]);
  return rows[0].lead_id;
}

test('lead status, assignment and notes are audited, eligible-only and private', async () => {
  const db = await staffedDb();
  try {
    const lead = await createLead(db);
    await assert.rejects(() => db.query(`select admin_update_class_lead($1,$2,'contacted')`, [SUPPORT, lead]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_update_class_lead($1,$2,null,true,$3)`, [CLASSES, lead, SUPPORT]), /ASSIGNEE_NOT_ELIGIBLE/);
    await assert.rejects(() => db.query(`select admin_update_class_lead($1,$2)`, [CLASSES, lead]), /NOTHING_TO_UPDATE/);

    await db.query(`select admin_update_class_lead($1,$2,'contacted',true,$1,'Called on WhatsApp, prefers Saturdays')`, [CLASSES, lead]);
    const row = await one(db, 'select status::text, assigned_to, contacted_at is not null as contacted from premium_class_leads where id=$1', [lead]);
    assert.deepEqual(row, { status: 'contacted', assigned_to: CLASSES, contacted: true });

    await db.query(`select admin_update_class_lead($1,$2,'closed')`, [OWNER, lead]);
    await db.query(`select admin_update_class_lead($1,$2,'interested')`, [OWNER, lead]);
    const reopened = await one(db, 'select closed_at, contacted_at is not null as contacted from premium_class_leads where id=$1', [lead]);
    assert.equal(reopened.closed_at, null, 'a reopened lead is no longer closed');
    assert.equal(reopened.contacted, true, 'first contact is kept');

    const { rows } = await db.query(`select action, before_state, after_state from admin_audit_log where entity_type='class_lead' order by id`);
    assert.deepEqual(rows.map((r) => r.action), ['class_lead.status_change', 'class_lead.assign', 'class_lead.note_add', 'class_lead.status_change', 'class_lead.status_change']);
    assert.ok(!JSON.stringify(rows).includes('Saturdays'), 'note text lives only in the private notes table');

    const note = await one(db, `select body, author_id from admin_internal_notes where entity_id=$1`, [lead]);
    assert.equal(note.author_id, CLASSES);

    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query('select body from admin_internal_notes'), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      await assert.rejects(() => db.query('select assigned_to from premium_class_leads'), /permission denied/);
    });
    await asBrowser(db, 'authenticated', STUDENT, async () => {
      const visible = await db.query('select id, status from premium_class_leads');
      assert.equal(visible.rows.length, 1, 'the student still sees their own request status');
    });
  } finally { await db.close(); }
});

test('support cases move through open, in progress and resolved with audit', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`select admin_create_support_case($1,$2,'billing','whatsapp','Paid but still Free',null)`, [CLASSES, STUDENT]), /ADMIN_PERMISSION_DENIED/);
    const { id } = await one(db, `select admin_create_support_case($1,$2,'billing','whatsapp','Paid but still Free','Reference sent on WhatsApp') as id`, [SUPPORT, STUDENT]);
    await assert.rejects(() => db.query(`select admin_create_support_case($1,$2,'nonsense','whatsapp','Bad category',null)`, [SUPPORT, STUDENT]), /check constraint/);

    await db.query(`select admin_update_support_case($1,$2,'resolved',true,$1,'Verified payment, access restored')`, [SUPPORT, id]);
    const resolved = await one(db, 'select status, assigned_to, resolved_at is not null as stamped from support_cases where id=$1', [id]);
    assert.deepEqual(resolved, { status: 'resolved', assigned_to: SUPPORT, stamped: true });
    await db.query(`select admin_update_support_case($1,$2,'in_progress')`, [OWNER, id]);
    assert.equal((await one(db, 'select resolved_at from support_cases where id=$1', [id])).resolved_at, null);

    const { rows } = await db.query(`select action from admin_audit_log where entity_type='support_case' order by id`);
    assert.deepEqual(rows.map((r) => r.action), ['support_case.create', 'support_case.status_change', 'support_case.assign', 'support_case.note_add', 'support_case.status_change']);
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── questions

test('external questions are blocked by identity without touching provider data', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`select admin_block_question($1,'internal','jamb','physics','q1','use status instead')`, [ACADEMIC]), /INTERNAL_QUESTIONS_USE_STATUS/);
    await assert.rejects(() => db.query(`select admin_block_question($1,'aloc','jamb','physics','9',' ')`, [ACADEMIC]), /ADMIN_REASON_REQUIRED/);

    const { id } = await one(db, `select admin_block_question($1,'ALOC_Station','JAMB','physics','1234','Answer key marks B but C is correct') as id`, [ACADEMIC]);
    await assert.rejects(() => db.query(`select admin_block_question($1,'aloc_station','jamb','physics','1234','Duplicate report')`, [OWNER]), /QUESTION_ALREADY_BLOCKED/);
    // The same provider id under another subject is a different question.
    await db.query(`select admin_block_question($1,'aloc_station','jamb','chemistry','1234','Different subject, same numeric id')`, [OWNER]);

    await db.query(`select admin_lift_question_block($1,$2,'Provider corrected the key')`, [ACADEMIC, id]);
    await assert.rejects(() => db.query(`select admin_lift_question_block($1,$2,'Lift it twice')`, [ACADEMIC, id]), /QUESTION_BLOCK_NOT_FOUND/);
    await db.query(`select admin_block_question($1,'aloc_station','jamb','physics','1234','Regressed again after the fix')`, [ACADEMIC]);

    const { total } = await one(db, `select count(*)::int as total from question_blocks where lifted_at is null`);
    assert.equal(total, 2);
    const actions = (await db.query(`select action from admin_audit_log where entity_type='question_block' order by id`)).rows.map((r) => r.action);
    assert.deepEqual(actions, ['question.block', 'question.block', 'question.unblock', 'question.block']);
  } finally { await db.close(); }
});

test('internal questions are created, edited through their active guard, and disabled with a reason', async () => {
  const db = await staffedDb();
  try {
    const exam = (await one(db, `select id from exam_bodies where code='jamb'`)).id;
    const subject = (await one(db, `select id from subjects where slug='physics'`)).id;
    const payload = (overrides = {}) => JSON.stringify({
      exam_body_id: exam, subject_id: subject, year: 2021, question_text: 'What is the SI unit of force?',
      correct_option_key: 'B', explanation: 'Force is measured in newtons.', status: 'active',
      options: [{ key: 'A', text: 'Joule' }, { key: 'B', text: 'Newton' }, { key: 'C', text: 'Watt' }],
      ...overrides,
    });

    await assert.rejects(() => db.query(`select admin_save_internal_question($1,null,$2::jsonb)`, [SUPPORT, payload()]), /ADMIN_PERMISSION_DENIED/);
    await assert.rejects(() => db.query(`select admin_save_internal_question($1,null,$2::jsonb)`, [ACADEMIC, payload({ correct_option_key: 'D' })]), /QUESTION_CORRECT_OPTION_INVALID/);
    await assert.rejects(() => db.query(`select admin_save_internal_question($1,null,$2::jsonb)`, [ACADEMIC, payload({ options: [{ key: 'A', text: 'Only' }, { key: 'C', text: 'Gap' }] })]), /QUESTION_OPTION_KEYS_INVALID/);

    const { id } = await one(db, `select admin_save_internal_question($1,null,$2::jsonb) as id`, [ACADEMIC, payload()]);
    const created = await one(db, `select status::text, source_provider, created_by from questions where id=$1`, [id]);
    assert.deepEqual(created, { status: 'active', source_provider: 'internal', created_by: ACADEMIC });

    await assert.rejects(() => db.query(`select admin_save_internal_question($1,$2,$3::jsonb)`, [ACADEMIC, id, payload({ correct_option_key: 'C' })]), /ADMIN_REASON_REQUIRED/,
      'changing a live question needs a reason');
    await db.query(`select admin_save_internal_question($1,$2,$3::jsonb,'Option wording was ambiguous')`,
      [ACADEMIC, id, payload({ options: [{ key: 'A', text: 'Joule (J)' }, { key: 'B', text: 'Newton (N)' }] })]);
    const edited = await one(db, `select q.status::text, count(o.id)::int as options from questions q join question_options o on o.question_id=q.id where q.id=$1 group by q.status`, [id]);
    assert.deepEqual(edited, { status: 'active', options: 2 }, 'the question is back in circulation with its new options');

    const update = await one(db, `select before_state, after_state, reason from admin_audit_log where action='question.update'`);
    assert.equal(update.before_state.options.length, 3);
    assert.equal(update.after_state.options.length, 2);

    await assert.rejects(() => db.query(`select admin_set_question_status($1,$2,'disabled')`, [ACADEMIC, id]), /ADMIN_REASON_REQUIRED/);
    await db.query(`select admin_set_question_status($1,$2,'disabled','Duplicate of a 2019 question')`, [ACADEMIC, id]);
    const disabled = await one(db, `select status::text, review_notes from questions where id=$1`, [id]);
    assert.deepEqual(disabled, { status: 'disabled', review_notes: 'Duplicate of a 2019 question' });
  } finally { await db.close(); }
});

// ──────────────────────────────────────────────────────────── students and sessions

async function practiceSession(db, userId, { timed = false, subjectSlug = 'physics', answers = ['A'] } = {}) {
  const exam = (await one(db, `select id from exam_bodies where code='jamb'`)).id;
  const subject = (await one(db, `select id from subjects where slug=$1`, [subjectSlug])).id;
  const paper = JSON.stringify(answers.map((_, index) => ({
    sourceProvider: 'aloc_station', sourceQuestionId: `q${index + 1}`,
    studentSnapshot: { id: `q${index + 1}`, prompt: `Question ${index + 1}`, subject: { slug: subjectSlug, name: subjectSlug },
      topic: { slug: 'motion', name: 'Motion' }, options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }] },
    correctOptionKey: 'A', explanation: null,
  })));
  const { id } = await one(db, `select create_practice_session($1,$2,$3,null,$4,null,null,$5,'aloc_station',$6,$7::jsonb) as id`,
    [userId, exam, subject, timed ? 'timed' : 'practice', answers.length, timed ? 600 : null, paper]);
  const { rows } = await db.query('select id from practice_session_questions where session_id=$1 order by position', [id]);
  for (const [index, key] of answers.entries()) {
    if (key) await db.query('select * from save_practice_answer($1,$2,$3,$4)', [userId, id, rows[index].id, key]);
  }
  return id;
}

test('student search, filters and pagination are server-side and exact', async () => {
  const db = await staffedDb();
  try {
    await db.query(`select admin_grant_master_access($1,$2,30,null,'Scholarship access granted')`, [OWNER, OTHER_STUDENT]);
    await practiceSession(db, STUDENT);

    const all = (await db.query(`select * from admin_list_students($1,null,null,null,null,'joined_desc',2,0)`, [SUPPORT])).rows;
    assert.equal(all.length, 2);
    assert.equal(Number(all[0].total_count), users.length, 'the total counts every match, not the page');

    const search = (await db.query(`select user_id, email from admin_list_students($1,'ADA@',null,null,null,'joined_desc',25,0)`, [SUPPORT])).rows;
    assert.deepEqual(search.map((row) => row.user_id), [STUDENT]);

    const masters = (await db.query(`select user_id, plan_tier from admin_list_students($1,null,null,'master',null,'joined_desc',25,0)`, [ACADEMIC])).rows;
    assert.deepEqual(masters, [{ user_id: OTHER_STUDENT, plan_tier: 'master' }]);

    const active = (await db.query(`select user_id, last_session_at is not null as seen from admin_list_students($1,null,null,null,'active_7d','active_desc',25,0)`, [OWNER])).rows;
    assert.deepEqual(active, [{ user_id: STUDENT, seen: true }]);

    const wildcard = (await db.query(`select user_id from admin_list_students($1,'%',null,null,null,'joined_desc',25,0)`, [OWNER])).rows;
    assert.equal(wildcard.length, 0, 'a literal % is searched for, not used as a wildcard');

    await assert.rejects(() => db.query(`select * from admin_list_students($1,null,null,null,null,'joined_desc',500,0)`, [OWNER]), /PAGINATION_INVALID/);
  } finally { await db.close(); }
});

test('suspension is recorded with audit, and never applies to an active admin', async () => {
  const db = await staffedDb();
  try {
    await assert.rejects(() => db.query(`select admin_record_suspension($1,$2,'Testing admin suspension')`, [OWNER, SUPPORT]), /SUSPEND_ACTIVE_ADMIN/);
    await db.query(`select admin_record_suspension($1,$2,'Sharing paid account publicly')`, [OWNER, STUDENT]);
    await assert.rejects(() => db.query(`select admin_record_suspension($1,$2,'Sharing paid account publicly')`, [OWNER, STUDENT]), /ACCOUNT_ALREADY_SUSPENDED/);
    const listed = await one(db, `select is_suspended from admin_list_students($1,'ada@',null,null,null,'joined_desc',25,0)`, [OWNER]);
    assert.equal(listed.is_suspended, true);
    await db.query(`select admin_clear_suspension($1,$2,'Owner confirmed the account is personal')`, [OWNER, STUDENT]);
    await assert.rejects(() => db.query(`select admin_clear_suspension($1,$2,'Clearing twice by mistake')`, [OWNER, STUDENT]), /ACCOUNT_NOT_SUSPENDED/);
    const actions = (await db.query(`select action, before_state from admin_audit_log where entity_type='student' order by id`)).rows;
    assert.deepEqual(actions.map((r) => r.action), ['student.suspend', 'student.reactivate']);
    assert.equal(actions[1].before_state.suspension_reason, 'Sharing paid account publicly');
  } finally { await db.close(); }
});

test('only an overdue timed session can be finalised, through the engine\'s own finaliser', async () => {
  const db = await staffedDb();
  try {
    const live = await practiceSession(db, STUDENT, { timed: true, answers: ['A', 'B'] });
    await assert.rejects(() => db.query(`select admin_finalize_overdue_session($1,'practice',$2,'Student says it froze')`, [SUPPORT, live]), /SESSION_NOT_OVERDUE/,
      'an admin can never cut a running session short');
    const untimed = await practiceSession(db, STUDENT);
    await assert.rejects(() => db.query(`select admin_finalize_overdue_session($1,'practice',$2,'Close untimed practice')`, [SUPPORT, untimed]), /SESSION_NOT_OVERDUE/);
    await assert.rejects(() => db.query(`select admin_finalize_overdue_session($1,'practice',$2,'Student says it froze')`, [CLASSES, live]), /ADMIN_PERMISSION_DENIED/);

    await db.query(`update practice_sessions set expires_at = now() - interval '1 hour' where id=$1`, [live]);
    const result = (await one(db, `select admin_finalize_overdue_session($1,'practice',$2,'Timer ran out while offline') as r`, [SUPPORT, live])).r;
    assert.equal(result.status, 'completed');
    const session = await one(db, 'select status::text, answered_count, correct_count from practice_sessions where id=$1', [live]);
    assert.deepEqual(session, { status: 'completed', answered_count: 2, correct_count: 1 }, 'answers and score come from the engine, unchanged');

    const listed = (await db.query(`select session_id, session_type, status from admin_list_sessions($1,null,'finished')`, [SUPPORT])).rows;
    assert.deepEqual(listed, [{ session_id: live, session_type: 'timed', status: 'completed' }]);
  } finally { await db.close(); }
});

test('super admin read models execute and gate their sections', async () => {
  const db = await staffedDb();
  try {
    await practiceSession(db, STUDENT);
    await createLead(db);
    await db.query(`select * from open_billing_checkout($1,'master_90','mdg_ref_admin_0002','test',900)`, [STUDENT]);
    await db.query(`select * from apply_successful_payment('mdg_ref_admin_0002',350000,'NGN','test','ps_2','success',null)`);

    const overview = (await one(db, `select admin_overview_metrics($1) as data`, [OWNER])).data;
    for (const section of ['students', 'exam_split', 'active_students', 'learning', 'monetisation', 'leads', 'support', 'questions', 'session_health', 'platform_health']) {
      assert.ok(section in overview, `super admin receives ${section}`);
    }
    assert.equal(Number(overview.monetisation.revenue_all_kobo), 0, 'test-mode money is never reported as revenue');
    assert.equal(Number(overview.monetisation.test_payments_30d), 1);
    assert.equal(Number(overview.leads.new), 1);

    const weeks = (await one(db, `select admin_weekly_analytics($1,4) as data`, [OWNER])).data;
    assert.equal(weeks.length, 4);
    assert.ok('revenue_kobo' in weeks[3] && 'leads_created' in weeks[3]);
    assert.equal(weeks[3].registrations, users.length);

    const admins = (await db.query(`select email, role::text, is_active, granted_by_email from admin_list_admins($1)`, [OWNER])).rows;
    assert.equal(admins.length, 5);
    assert.equal(admins[0].role, 'super_admin');

    const assignees = (await db.query(`select user_id from admin_list_assignees($1,'classes.manage')`, [CLASSES])).rows.map((r) => r.user_id).sort();
    assert.deepEqual(assignees, [OWNER, SECOND, CLASSES].sort());

    const directory = (await db.query(`select user_id, email from admin_user_directory($1,$2::uuid[])`, [CLASSES, [STUDENT]])).rows;
    assert.deepEqual(directory, [{ user_id: STUDENT, email: 'ada@example.invalid' }]);
    const found = (await db.query(`select user_id from admin_search_users($1,'bayo',10)`, [OWNER])).rows;
    assert.deepEqual(found.map((r) => r.user_id), [OTHER_STUDENT]);

    const sessions = (await db.query(`select session_type, subject_names, student_email from admin_list_sessions($1,'practice',null,'jamb','physics',null,'ada')`, [SUPPORT])).rows;
    assert.deepEqual(sessions, [{ session_type: 'practice', subject_names: 'Physics', student_email: 'ada@example.invalid' }]);
  } finally { await db.close(); }
});

test('academic performance matches grading: unanswered counts as not correct, revision is excluded', async () => {
  const db = await staffedDb();
  try {
    const first = await practiceSession(db, STUDENT, { answers: ['A', 'B', null, 'A'] });
    await db.query('select * from complete_practice_session($1,$2)', [STUDENT, first]);
    const second = await practiceSession(db, OTHER_STUDENT, { answers: ['B', 'B', 'A', 'A'] });
    await db.query('select * from complete_practice_session($1,$2)', [OTHER_STUDENT, second]);
    const repeat = await practiceSession(db, STUDENT, { answers: ['A', 'A', 'B', 'A'] });
    await db.query('select * from complete_practice_session($1,$2)', [STUDENT, repeat]);

    await assert.rejects(() => db.query(`select admin_academic_performance($1)`, [SUPPORT]), /ADMIN_PERMISSION_DENIED/);
    const data = (await one(db, `select admin_academic_performance($1,'jamb','physics',null,null,1) as data`, [ACADEMIC])).data;

    // Ada: 2 + 3 correct, Bayo: 2 correct, across 12 frozen questions.
    assert.equal(data.totals.questions, 12);
    assert.equal(data.totals.correct, 7);
    assert.equal(data.totals.unanswered, 1);
    const physics = data.subjects.find((row) => row.subject_slug === 'physics');
    assert.equal(physics.accuracy, Math.round(100 * 7 / 12));
    assert.equal(physics.students, 2);

    const worst = data.questions[0];
    assert.equal(worst.source_provider, 'aloc_station');
    assert.equal(worst.attempts, 3);
    assert.ok(worst.accuracy <= 34);

    // Ada missed question 3 twice (once unanswered): one repeat miss in Motion.
    assert.deepEqual(data.repeated.map((row) => [row.topic_name, row.repeat_misses, row.students]), [['Motion', 1, 1]]);
  } finally { await db.close(); }
});
