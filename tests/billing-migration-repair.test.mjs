import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * The M9a repair migration.
 *
 * M9 reached at least one environment from a copy taken before its webhook
 * idempotency gate was corrected, so production and the repository disagreed:
 * the database had a claim that was marked permanently on arrival, and no
 * `release_billing_webhook_event` at all.
 *
 * A repair migration has to be right on two different starting points — the
 * drifted database it exists for, and the correct one every fresh environment
 * builds — so both are exercised here. Getting this wrong is how a fix for one
 * environment becomes an outage in another.
 */

const REPAIR = 'supabase/migrations/20260908080000_m9a_webhook_claim_lease.sql';

async function baseDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  return db;
}

/** Every migration in order — what a fresh environment gets. */
async function freshDb() {
  const db = await baseDb();
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  return db;
}

/**
 * Reconstructs what production actually has: M9 with the pre-fix webhook gate.
 *
 * Rather than keep a stale copy of the old SQL around, the corrected pieces are
 * peeled back off a real M9 — the column dropped, the lease-aware function
 * replaced by the four-argument original, and the release function removed.
 */
async function driftedDb() {
  const db = await baseDb();
  for (const file of readdirSync('supabase/migrations').sort()) {
    if (file.startsWith('20260908080000')) continue;
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }

  await db.exec(`
    alter table public.billing_webhook_events drop column claim_expires_at;
    drop function public.record_billing_webhook_event(text, text, text, text, integer);
    drop function public.release_billing_webhook_event(bigint, text);

    create or replace function public.record_billing_webhook_event(
      p_provider text, p_event_id text, p_event_type text, p_reference text default null
    )
    returns table (is_new boolean, event_row_id bigint)
    language plpgsql security definer set search_path = ''
    as $$
    declare v_id bigint;
    begin
      insert into public.billing_webhook_events (provider, event_id, event_type, reference, outcome)
      values (p_provider, p_event_id, p_event_type, p_reference, 'received')
      on conflict (provider, event_id) do nothing
      returning id into v_id;
      if v_id is not null then return query select true, v_id; return; end if;
      select e.id into v_id from public.billing_webhook_events e
      where e.provider = p_provider and e.event_id = p_event_id;
      return query select false, v_id;
    end;
    $$;
    revoke all on function public.record_billing_webhook_event(text, text, text, text) from public, anon, authenticated;
    grant execute on function public.record_billing_webhook_event(text, text, text, text) to service_role;
  `);
  return db;
}

async function functionArity(db, name) {
  const { rows } = await db.query(
    `select pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [name]);
  return rows.map((row) => row.args);
}

const repairSql = () => readFileSync(REPAIR, 'utf8');

test('the drift this repair targets is real, and breaks retry', async () => {
  const db = await driftedDb();
  try {
    const columns = await db.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='billing_webhook_events' and column_name='claim_expires_at'`);
    assert.equal(columns.rows.length, 0, 'the drifted shape has no lease column');
    assert.deepEqual(await functionArity(db, 'release_billing_webhook_event'), [], 'and no release function');

    // The defect itself: a claim marked on arrival can never be retried.
    const record = () => db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:1','charge.success','mdg_ref_1')`,
    ).then((r) => r.rows[0]);
    assert.equal((await record()).is_new, true);
    assert.equal((await record()).is_new, false, 'the redelivery is dismissed even though nothing was decided');
  } finally { await db.close(); }
});

test('the repair fixes a drifted database', async () => {
  const db = await driftedDb();
  try {
    // Deliveries that arrived under the broken shape, one of them stuck.
    await db.query(`select * from record_billing_webhook_event('paystack','charge.success:1','charge.success','mdg_ref_1')`);
    await db.query(`select * from record_billing_webhook_event('paystack','charge.success:2','charge.success','mdg_ref_2')`);
    await db.query(`update billing_webhook_events set outcome='applied', processed_at=now() where event_id='charge.success:2'`);

    await db.exec(repairSql());

    // The lease column exists and old rows kept their meaning.
    const rows = await db.query(`select event_id, outcome, processed_at, claim_expires_at from billing_webhook_events order by event_id`);
    assert.equal(rows.rows.length, 2, 'no history was lost');
    assert.ok(rows.rows.every((row) => row.claim_expires_at), 'existing rows were backfilled');

    // Exactly one record function, with the lease argument.
    assert.deepEqual(
      await functionArity(db, 'record_billing_webhook_event'),
      ['p_provider text, p_event_id text, p_event_type text, p_reference text, p_lease_seconds integer'],
      'the superseded four-argument overload is gone, not merely shadowed',
    );

    // The previously stuck delivery is retryable again…
    const stuck = await db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:1','charge.success','mdg_ref_1',300)`);
    assert.equal(stuck.rows[0].is_new, true, 'an undecided delivery can finally be retried');

    // …and the one that reached a decision is still permanently closed.
    const decided = await db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:2','charge.success','mdg_ref_2',300)`);
    assert.equal(decided.rows[0].is_new, false, 'an applied payment must never be reprocessed');

    // Release now exists and re-arms an unfinished claim.
    await db.query(`select release_billing_webhook_event($1,'verification_unavailable')`, [stuck.rows[0].event_row_id]);
    const retried = await db.query(
      `select * from record_billing_webhook_event('paystack','charge.success:1','charge.success','mdg_ref_1',300)`);
    assert.equal(retried.rows[0].is_new, true);
  } finally { await db.close(); }
});

test('the repair is a no-op on a correctly migrated database', async () => {
  const db = await freshDb();
  try {
    const before = await db.query(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema='public' and table_name='billing_webhook_events' order by ordinal_position`);

    await db.exec(repairSql());
    await db.exec(repairSql());

    const after = await db.query(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema='public' and table_name='billing_webhook_events' order by ordinal_position`);
    assert.deepEqual(after.rows, before.rows, 'running it twice changes nothing');

    assert.equal((await functionArity(db, 'record_billing_webhook_event')).length, 1, 'still exactly one overload');
    assert.equal((await functionArity(db, 'release_billing_webhook_event')).length, 1);
  } finally { await db.close(); }
});

test('the repaired functions keep their grants and pinned search path', async () => {
  const db = await driftedDb();
  try {
    await db.exec(repairSql());

    const { rows } = await db.query(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
             has_function_privilege('service_role', p.oid, 'execute') as svc_exec
      from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('record_billing_webhook_event','release_billing_webhook_event')
      order by p.proname`);

    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must stay SECURITY DEFINER`);
      assert.match(row.config, /^search_path=""?$/, `${row.proname} must keep an empty search_path`);
      assert.equal(row.anon_exec, false, `${row.proname} must stay unreachable from anon`);
      assert.equal(row.auth_exec, false, `${row.proname} must stay unreachable from authenticated`);
      assert.equal(row.svc_exec, true, `${row.proname} must remain callable by service_role`);
    }
  } finally { await db.close(); }
});

test('a repaired database behaves identically to a freshly migrated one', async () => {
  const shape = async (db) => {
    const columns = await db.query(
      `select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='billing_webhook_events' order by column_name`);
    const args = await functionArity(db, 'record_billing_webhook_event');
    const release = await functionArity(db, 'release_billing_webhook_event');
    return { columns: columns.rows, args, release };
  };

  const repaired = await driftedDb();
  const fresh = await freshDb();
  try {
    await repaired.exec(repairSql());
    assert.deepEqual(await shape(repaired), await shape(fresh),
      'the two paths must converge, or environments drift again');
  } finally {
    await repaired.close();
    await fresh.close();
  }
});

test('the repair never drops a table or deletes payment history', () => {
  const sql = repairSql().toLowerCase();

  // A repair migration is the easiest place to lose a ledger by accident.
  for (const forbidden of ['drop table', 'truncate', 'delete from', 'drop column', 'drop schema']) {
    assert.ok(!sql.includes(forbidden), `a repair must never "${forbidden}"`);
  }
  assert.ok(sql.includes('add column if not exists'), 'the column add is idempotent');
  assert.ok(sql.includes('drop function if exists public.record_billing_webhook_event(text, text, text, text)'),
    'only the superseded function overload is dropped, by its exact signature');
});
