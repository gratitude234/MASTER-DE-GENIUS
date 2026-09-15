-- MASTER@DE'GENIUS Admin System — Phase 1
--
-- Extends the Premium Classes allowlist (`app_admins`) into database-backed
-- roles, and adds only the structures the admin workspace cannot work without:
-- an immutable audit trail, internal notes, support cases, an external
-- question blocklist and account suspensions.
--
-- The access model, stated once:
--
--   * Browser roles (anon, authenticated) get nothing on any table below. Each
--     table has RLS enabled and a RESTRICTIVE deny policy, so a grant or a
--     permissive policy added later by mistake still cannot expose admin data.
--   * The Next.js server reads through service_role only after its own
--     permission guard (features/admin/auth.ts).
--   * Every privileged write is a SECURITY DEFINER function that only
--     service_role may execute. It re-checks the acting admin's permission in
--     the database and writes its audit row in the same transaction, so a
--     server bug that skipped the TypeScript guard still cannot mutate
--     anything, and no mutation can commit without its audit entry.

-- ──────────────────────────────────────────────────────────── roles

create type public.admin_role as enum ('super_admin', 'academic_admin', 'support_admin', 'classes_admin');

alter table public.app_admins
  add column role public.admin_role,
  add column is_active boolean not null default true,
  add column granted_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add column deactivated_at timestamptz;

-- Rows allowlisted before roles existed could only ever reach the Premium
-- Classes CRM. They keep exactly that access: nobody is silently promoted to
-- payments, roles or system controls. The platform owner becomes the first
-- super admin explicitly, through bootstrap_first_super_admin() below.
update public.app_admins set role = 'classes_admin' where role is null;

-- No default: every future membership has to state its role deliberately.
alter table public.app_admins alter column role set not null;
alter table public.app_admins
  add constraint app_admins_deactivation_shape check (is_active = (deactivated_at is null));

create index app_admins_role_active_idx on public.app_admins (role) where is_active;

create trigger app_admins_set_updated_at
before update on public.app_admins
for each row execute function public.set_updated_at();

/*
 * The permission matrix. The application reads it rather than mirroring it, so
 * adding a role (Finance, later) is an enum value plus rows here — no route,
 * guard or policy has to change.
 */
create table public.admin_role_permissions (
  role       public.admin_role not null,
  permission text not null check (permission ~ '^[a-z]+\.[a-z_]+$'),
  created_at timestamptz not null default now(),
  primary key (role, permission)
);

insert into public.admin_role_permissions (role, permission) values
  ('super_admin', 'overview.view'),
  ('super_admin', 'students.view'),
  ('super_admin', 'students.manage'),
  ('super_admin', 'entitlements.grant'),
  ('super_admin', 'payments.view'),
  ('super_admin', 'academics.view'),
  ('super_admin', 'questions.view'),
  ('super_admin', 'questions.manage'),
  ('super_admin', 'sessions.view'),
  ('super_admin', 'sessions.recover'),
  ('super_admin', 'classes.view'),
  ('super_admin', 'classes.manage'),
  ('super_admin', 'support.view'),
  ('super_admin', 'support.manage'),
  ('super_admin', 'analytics.view'),
  ('super_admin', 'system.view'),
  ('super_admin', 'admins.manage'),
  ('super_admin', 'audit.view'),

  ('academic_admin', 'overview.view'),
  ('academic_admin', 'students.view'),
  ('academic_admin', 'academics.view'),
  ('academic_admin', 'questions.view'),
  ('academic_admin', 'questions.manage'),
  ('academic_admin', 'sessions.view'),

  ('support_admin', 'overview.view'),
  ('support_admin', 'students.view'),
  ('support_admin', 'sessions.view'),
  ('support_admin', 'sessions.recover'),
  ('support_admin', 'support.view'),
  ('support_admin', 'support.manage'),

  ('classes_admin', 'overview.view'),
  ('classes_admin', 'classes.view'),
  ('classes_admin', 'classes.manage');

create or replace function public.admin_user_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins a
    join public.admin_role_permissions rp on rp.role = a.role
    where a.user_id = p_user_id and a.is_active and rp.permission = p_permission
  );
$$;

/* Returns the actor's role, for the audit snapshot, or refuses. */
create or replace function public.assert_admin_permission(p_actor_id uuid, p_permission text)
returns public.admin_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.admin_role;
begin
  select a.role into v_role
  from public.app_admins a
  join public.admin_role_permissions rp on rp.role = a.role and rp.permission = p_permission
  where a.user_id = p_actor_id and a.is_active;

  if v_role is null then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function public.admin_required_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'ADMIN_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'ADMIN_REASON_TOO_LONG';
  end if;
  return v_reason;
end;
$$;

-- ──────────────────────────────────────────────────────────── audit trail

create table public.admin_audit_log (
  id           bigint generated always as identity primary key,
  -- No foreign key: the trail must outlive the accounts it describes, and an
  -- ON DELETE action would have to rewrite rows this table refuses to change.
  actor_id     uuid,
  actor_role   public.admin_role,
  action       text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type  text not null check (entity_type ~ '^[a-z_]{2,40}$'),
  entity_id    text not null check (char_length(entity_id) between 1 and 200),
  reason       text check (reason is null or char_length(reason) <= 1000),
  before_state jsonb check (before_state is null or jsonb_typeof(before_state) = 'object'),
  after_state  jsonb check (after_state is null or jsonb_typeof(after_state) = 'object'),
  created_at   timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_entity_idx on public.admin_audit_log (entity_type, entity_id, created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_action_idx on public.admin_audit_log (action, created_at desc);

create or replace function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ADMIN_AUDIT_LOG_IMMUTABLE';
end;
$$;

-- Triggers bind service_role and the table owner too, not only browser roles.
create trigger admin_audit_log_immutable_rows
before update or delete on public.admin_audit_log
for each row execute function public.prevent_admin_audit_mutation();

create trigger admin_audit_log_immutable_truncate
before truncate on public.admin_audit_log
for each statement execute function public.prevent_admin_audit_mutation();

/* Internal: called only from the privileged functions below. */
create or replace function public.record_admin_audit(
  p_actor_id    uuid,
  p_actor_role  public.admin_role,
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_reason      text default null,
  p_before      jsonb default null,
  p_after       jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.admin_audit_log (actor_id, actor_role, action, entity_type, entity_id, reason, before_state, after_state)
  values (p_actor_id, p_actor_role, p_action, p_entity_type, p_entity_id, nullif(btrim(coalesce(p_reason, '')), ''), p_before, p_after)
  returning id into v_id;
  return v_id;
end;
$$;

-- ──────────────────────────────────────────────── notes, support, blocks

/* Append-only internal notes. Never exposed to the student they concern. */
create table public.admin_internal_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('class_lead', 'support_case')),
  entity_id   uuid not null,
  author_id   uuid references auth.users(id) on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now()
);

create index admin_internal_notes_entity_idx on public.admin_internal_notes (entity_type, entity_id, created_at desc);

/*
 * Internal support workflow. Students still reach support through the Need
 * Help? panel and WhatsApp; an admin logs the case here so it can be owned,
 * followed and resolved. There is deliberately no student-facing access.
 */
create table public.support_cases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  category    text not null check (category in ('account', 'billing', 'academic', 'exam_session', 'classes', 'technical', 'other')),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp', 'email', 'phone', 'in_app', 'other')),
  subject     text not null check (char_length(btrim(subject)) between 3 and 160),
  message     text check (message is null or char_length(message) <= 3000),
  status      text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_cases_resolution_shape check ((status = 'resolved') = (resolved_at is not null))
);

create index support_cases_status_idx on public.support_cases (status, created_at desc);
create index support_cases_user_idx on public.support_cases (user_id, created_at desc);
create index support_cases_assignee_idx on public.support_cases (assigned_to, status) where assigned_to is not null;

create trigger support_cases_set_updated_at
before update on public.support_cases
for each row execute function public.set_updated_at();

/*
 * External questions Master De Genius will not serve again.
 *
 * The provider's data is never edited. Identity includes exam and subject
 * because providers reuse numeric ids across subjects, so a block on one
 * Physics question must never hide an unrelated Chemistry question.
 */
create table public.question_blocks (
  id                 uuid primary key default gen_random_uuid(),
  source_provider    text not null check (source_provider ~ '^[a-z_]{2,40}$'),
  exam_code          text not null check (exam_code ~ '^[a-z_]{2,20}$'),
  subject_slug       text not null check (subject_slug ~ '^[a-z0-9-]+$'),
  source_question_id text not null check (char_length(source_question_id) between 1 and 200),
  reason             text not null check (char_length(btrim(reason)) between 5 and 1000),
  blocked_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  lifted_at          timestamptz,
  lifted_by          uuid references auth.users(id) on delete set null,
  lift_reason        text check (lift_reason is null or char_length(lift_reason) <= 1000),
  constraint question_blocks_lift_shape check ((lifted_at is null) = (lift_reason is null))
);

create unique index question_blocks_active_identity_idx
  on public.question_blocks (source_provider, exam_code, subject_slug, source_question_id)
  where lifted_at is null;
create index question_blocks_lookup_idx
  on public.question_blocks (exam_code, subject_slug)
  where lifted_at is null;

/* Presence of a row is the suspension. History lives in the audit log. */
create table public.account_suspensions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  reason       text not null check (char_length(btrim(reason)) between 5 and 1000),
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz not null default now()
);

-- A manual grant is recorded beside payment grants, never in place of them.
alter table public.entitlement_events
  add column source text not null default 'payment' check (source in ('payment', 'admin')),
  add column actor_id uuid,
  add column reason text check (reason is null or char_length(reason) <= 1000);

-- ─────────────────────────────────── indexes for bounded admin aggregation

create index if not exists profiles_created_at_idx on public.profiles (created_at desc);
create index if not exists practice_sessions_created_at_idx on public.practice_sessions (created_at desc);
create index if not exists practice_sessions_completed_at_idx on public.practice_sessions (completed_at desc) where status = 'completed';
create index if not exists exam_attempts_created_at_idx on public.exam_attempts (created_at desc);
create index if not exists exam_attempts_submitted_at_idx on public.exam_attempts (submitted_at desc) where status = 'submitted';
create index if not exists payment_transactions_paid_at_idx on public.payment_transactions (paid_at desc) where status = 'success';
create index if not exists premium_class_leads_assignee_idx on public.premium_class_leads (assigned_to, status) where assigned_to is not null;
create index if not exists entitlement_events_source_idx on public.entitlement_events (source, created_at desc);
-- Inspecting a reported external question finds its frozen snapshots by id.
create index if not exists practice_session_questions_source_idx on public.practice_session_questions (source_provider, source_question_id);
create index if not exists exam_attempt_questions_source_idx on public.exam_attempt_questions (source_provider, source_question_id);

-- ─────────────────────────────────────────────── membership invariants

/*
 * The platform may never be left without a usable super admin — through the
 * admin UI, a direct SQL edit, or the cascade from deleting an auth user.
 *
 * The advisory lock serialises every membership change, so two super admins
 * demoting each other at the same moment cannot both see the other as the
 * survivor.
 */
create or replace function public.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'super_admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.is_active) then
    perform pg_advisory_xact_lock(hashtextextended('app_admins:membership', 0));
    if not exists (
      select 1 from public.app_admins a
      where a.role = 'super_admin' and a.is_active and a.user_id <> old.user_id
    ) then
      raise exception 'LAST_SUPER_ADMIN';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger app_admins_guard_last_super_admin
before update or delete on public.app_admins
for each row execute function public.guard_last_super_admin();

/*
 * Establishes the first super admin. Executable only by the database owner —
 * the Supabase SQL editor — and never through the API, not even with the
 * service key. Refuses once any active super admin exists, so it cannot be
 * used to seize an already-administered platform.
 */
create or replace function public.bootstrap_first_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_previous public.app_admins%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('app_admins:membership', 0));

  if exists (select 1 from public.app_admins a where a.role = 'super_admin' and a.is_active) then
    raise exception 'SUPER_ADMIN_ALREADY_EXISTS';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email::text) = lower(btrim(coalesce(p_email, '')))
  limit 1;

  if v_user_id is null then
    raise exception 'ADMIN_TARGET_NOT_FOUND';
  end if;

  select * into v_previous from public.app_admins a where a.user_id = v_user_id;

  insert into public.app_admins (user_id, role, is_active, deactivated_at)
  values (v_user_id, 'super_admin', true, null)
  on conflict on constraint app_admins_pkey do update
  set role = 'super_admin', is_active = true, deactivated_at = null;

  perform public.record_admin_audit(
    null, null, 'admin.bootstrap', 'admin', v_user_id::text, 'First super admin established from the database console',
    case when v_previous.user_id is null then null
         else jsonb_build_object('role', v_previous.role, 'is_active', v_previous.is_active) end,
    jsonb_build_object('role', 'super_admin', 'is_active', true)
  );

  return v_user_id;
end;
$$;

-- ─────────────────────────────────────────────── admin memberships

create or replace function public.admin_grant_membership(
  p_actor_id uuid,
  p_email    text,
  p_role     public.admin_role,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_user_id    uuid;
  v_existing   public.app_admins%rowtype;
  v_found      boolean;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'admins.manage');
  v_reason := public.admin_required_reason(p_reason);
  if p_role is null then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('app_admins:membership', 0));

  -- Only an account that already exists can be promoted: there is no admin sign-up.
  select u.id into v_user_id
  from auth.users u
  where lower(u.email::text) = lower(btrim(coalesce(p_email, '')))
  limit 1;

  if v_user_id is null then
    raise exception 'ADMIN_TARGET_NOT_FOUND';
  end if;
  if v_user_id = p_actor_id then
    raise exception 'ADMIN_SELF_MODIFICATION';
  end if;

  select * into v_existing from public.app_admins a where a.user_id = v_user_id for update;
  v_found := found;

  if v_found and v_existing.is_active and v_existing.role = p_role then
    raise exception 'ADMIN_MEMBERSHIP_UNCHANGED';
  end if;

  insert into public.app_admins (user_id, role, is_active, granted_by, deactivated_at)
  values (v_user_id, p_role, true, p_actor_id, null)
  on conflict on constraint app_admins_pkey do update
  set role = excluded.role, is_active = true, granted_by = excluded.granted_by, deactivated_at = null;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'admin.grant', 'admin', v_user_id::text, v_reason,
    case when v_found then jsonb_build_object('role', v_existing.role, 'is_active', v_existing.is_active) end,
    jsonb_build_object('role', p_role, 'is_active', true)
  );

  return jsonb_build_object('user_id', v_user_id, 'role', p_role, 'is_active', true);
end;
$$;

create or replace function public.admin_update_membership(
  p_actor_id  uuid,
  p_user_id   uuid,
  p_role      public.admin_role,
  p_is_active boolean,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_existing   public.app_admins%rowtype;
  v_role       public.admin_role;
  v_active     boolean;
  v_action     text;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'admins.manage');
  v_reason := public.admin_required_reason(p_reason);

  perform pg_advisory_xact_lock(hashtextextended('app_admins:membership', 0));

  -- Changing your own access is always a second person's decision.
  if p_user_id = p_actor_id then
    raise exception 'ADMIN_SELF_MODIFICATION';
  end if;

  select * into v_existing from public.app_admins a where a.user_id = p_user_id for update;
  if not found then
    raise exception 'ADMIN_MEMBERSHIP_NOT_FOUND';
  end if;

  v_role := coalesce(p_role, v_existing.role);
  v_active := coalesce(p_is_active, v_existing.is_active);

  if v_role = v_existing.role and v_active = v_existing.is_active then
    raise exception 'ADMIN_MEMBERSHIP_UNCHANGED';
  end if;

  update public.app_admins a
  set role = v_role,
      is_active = v_active,
      deactivated_at = case when v_active then null else coalesce(a.deactivated_at, clock_timestamp()) end
  where a.user_id = p_user_id;

  v_action := case
    when v_active <> v_existing.is_active and v_role <> v_existing.role then 'admin.update'
    when v_active <> v_existing.is_active and v_active then 'admin.activate'
    when v_active <> v_existing.is_active then 'admin.deactivate'
    else 'admin.role_change'
  end;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, v_action, 'admin', p_user_id::text, v_reason,
    jsonb_build_object('role', v_existing.role, 'is_active', v_existing.is_active),
    jsonb_build_object('role', v_role, 'is_active', v_active)
  );

  return jsonb_build_object('user_id', p_user_id, 'role', v_role, 'is_active', v_active);
end;
$$;

-- ─────────────────────────────────────────────── students and entitlements

create or replace function public.admin_record_suspension(
  p_actor_id uuid,
  p_user_id  uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'students.manage');
  v_reason := public.admin_required_reason(p_reason);

  if p_user_id = p_actor_id then
    raise exception 'ADMIN_SELF_MODIFICATION';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  -- An administrator loses access through their membership, which is audited
  -- as such, not by being suspended as a student.
  if exists (select 1 from public.app_admins a where a.user_id = p_user_id and a.is_active) then
    raise exception 'SUSPEND_ACTIVE_ADMIN';
  end if;

  insert into public.account_suspensions (user_id, reason, suspended_by)
  values (p_user_id, v_reason, p_actor_id)
  on conflict on constraint account_suspensions_pkey do nothing;

  if not found then
    raise exception 'ACCOUNT_ALREADY_SUSPENDED';
  end if;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'student.suspend', 'student', p_user_id::text, v_reason,
    jsonb_build_object('suspended', false),
    jsonb_build_object('suspended', true)
  );

  return jsonb_build_object('user_id', p_user_id, 'suspended', true);
end;
$$;

create or replace function public.admin_clear_suspension(
  p_actor_id uuid,
  p_user_id  uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_existing   public.account_suspensions%rowtype;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'students.manage');
  v_reason := public.admin_required_reason(p_reason);

  select * into v_existing from public.account_suspensions s where s.user_id = p_user_id for update;
  if not found then
    raise exception 'ACCOUNT_NOT_SUSPENDED';
  end if;

  delete from public.account_suspensions s where s.user_id = p_user_id;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'student.reactivate', 'student', p_user_id::text, v_reason,
    jsonb_build_object('suspended', true, 'suspended_at', v_existing.suspended_at,
      'suspended_by', v_existing.suspended_by, 'suspension_reason', v_existing.reason),
    jsonb_build_object('suspended', false)
  );

  return jsonb_build_object('user_id', p_user_id, 'suspended', false);
end;
$$;

/*
 * Grants or extends Master by hand.
 *
 * Deliberately separate from apply_successful_payment: no payment row is
 * written or touched, total_paid_kobo and last_payment_id are left alone, and
 * the entitlement event is marked source = 'admin' with its actor and reason.
 *
 * It only ever lengthens access. Shortening or revoking a student's paid time
 * is a different decision and is not offered here.
 */
create or replace function public.admin_grant_master_access(
  p_actor_id   uuid,
  p_user_id    uuid,
  p_days       integer,
  p_expires_at timestamptz,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_now        timestamptz := clock_timestamp();
  v_ent        public.user_entitlements%rowtype;
  v_active     boolean;
  v_new_expiry timestamptz;
  v_event      text;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'entitlements.grant');
  v_reason := public.admin_required_reason(p_reason);

  if (p_days is null) = (p_expires_at is null) then
    raise exception 'ENTITLEMENT_GRANT_SHAPE_INVALID';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 730) then
    raise exception 'ENTITLEMENT_GRANT_DAYS_INVALID';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  insert into public.user_entitlements (user_id) values (p_user_id)
  on conflict on constraint user_entitlements_pkey do nothing;

  -- Same per-student lock the payment path takes, so a grant and a webhook
  -- landing together serialise instead of overwriting each other's expiry.
  select * into v_ent from public.user_entitlements e where e.user_id = p_user_id for update;
  v_active := v_ent.tier = 'master' and v_ent.expires_at > v_now;

  if p_days is not null then
    -- Identical renewal rule to payments: early extension keeps the remaining
    -- days, a lapsed student starts from now.
    v_new_expiry := (case when v_active then v_ent.expires_at else v_now end) + make_interval(days => p_days);
  else
    if p_expires_at <= v_now + interval '1 hour' then
      raise exception 'ENTITLEMENT_EXPIRY_NOT_FUTURE';
    end if;
    if p_expires_at > v_now + interval '3 years' then
      raise exception 'ENTITLEMENT_EXPIRY_TOO_FAR';
    end if;
    if v_active and p_expires_at <= v_ent.expires_at then
      raise exception 'ENTITLEMENT_WOULD_SHORTEN';
    end if;
    v_new_expiry := p_expires_at;
  end if;

  v_event := case when v_active then 'extended' else 'granted' end;

  update public.user_entitlements e
  set tier = 'master',
      -- A grant to a lapsed or free student is not the plan they once bought.
      plan_slug = case when v_active then e.plan_slug else null end,
      expires_at = v_new_expiry,
      activated_at = coalesce(e.activated_at, v_now),
      updated_at = v_now
  where e.user_id = p_user_id;

  insert into public.entitlement_events (
    user_id, payment_id, event_type, plan_slug, previous_tier, previous_expires_at,
    new_tier, new_expires_at, source, actor_id, reason
  ) values (
    p_user_id, null, v_event, null, coalesce(v_ent.tier, 'free'), v_ent.expires_at,
    'master', v_new_expiry, 'admin', p_actor_id, v_reason
  );

  perform public.record_admin_audit(
    p_actor_id, v_actor_role,
    case when v_active then 'entitlement.extend' else 'entitlement.grant' end,
    'student', p_user_id::text, v_reason,
    jsonb_build_object('tier', coalesce(v_ent.tier, 'free'), 'expires_at', v_ent.expires_at, 'master_active', v_active),
    jsonb_build_object('tier', 'master', 'expires_at', v_new_expiry, 'days', p_days, 'explicit_expiry', p_expires_at)
  );

  return jsonb_build_object(
    'event_type', v_event,
    'previous_tier', coalesce(v_ent.tier, 'free'),
    'previous_expires_at', v_ent.expires_at,
    'new_expires_at', v_new_expiry
  );
end;
$$;

-- ─────────────────────────────────────────────── premium class CRM

create or replace function public.admin_update_class_lead(
  p_actor_id          uuid,
  p_lead_id           uuid,
  p_status            public.class_lead_status default null,
  p_update_assignment boolean default false,
  p_assigned_to       uuid default null,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_lead       public.premium_class_leads%rowtype;
  v_now        timestamptz := clock_timestamp();
  v_status     public.class_lead_status;
  v_assignee   uuid;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_note_id    uuid;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'classes.manage');

  select * into v_lead from public.premium_class_leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'CLASS_LEAD_NOT_FOUND';
  end if;

  v_status := coalesce(p_status, v_lead.status);
  v_assignee := case when p_update_assignment then p_assigned_to else v_lead.assigned_to end;

  if v_assignee is not null and v_assignee is distinct from v_lead.assigned_to
     and not public.admin_user_has_permission(v_assignee, 'classes.manage') then
    raise exception 'ASSIGNEE_NOT_ELIGIBLE';
  end if;
  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'NOTE_TOO_LONG';
  end if;
  if v_status = v_lead.status and v_assignee is not distinct from v_lead.assigned_to and v_note is null then
    raise exception 'NOTHING_TO_UPDATE';
  end if;

  update public.premium_class_leads l
  set status = v_status,
      assigned_to = v_assignee,
      updated_at = v_now,
      -- First contact is a fact about the lead; later status changes keep it.
      contacted_at = case when v_status in ('contacted', 'interested', 'follow_up', 'enrolled')
                          then coalesce(l.contacted_at, v_now) else l.contacted_at end,
      enrolled_at = case when v_status = 'enrolled' then coalesce(l.enrolled_at, v_now) else l.enrolled_at end,
      closed_at = case when v_status in ('closed', 'not_interested') then coalesce(l.closed_at, v_now) else null end
  where l.id = p_lead_id;

  if v_note is not null then
    insert into public.admin_internal_notes (entity_type, entity_id, author_id, body)
    values ('class_lead', p_lead_id, p_actor_id, v_note)
    returning id into v_note_id;
  end if;

  if v_status <> v_lead.status then
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'class_lead.status_change', 'class_lead', p_lead_id::text, null,
      jsonb_build_object('status', v_lead.status), jsonb_build_object('status', v_status)
    );
  end if;
  if v_assignee is distinct from v_lead.assigned_to then
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'class_lead.assign', 'class_lead', p_lead_id::text, null,
      jsonb_build_object('assigned_to', v_lead.assigned_to), jsonb_build_object('assigned_to', v_assignee)
    );
  end if;
  if v_note_id is not null then
    -- The note body stays in one private place; the trail records that it exists.
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'class_lead.note_add', 'class_lead', p_lead_id::text, null,
      null, jsonb_build_object('note_id', v_note_id)
    );
  end if;

  return jsonb_build_object('status', v_status, 'assigned_to', v_assignee, 'note_id', v_note_id);
end;
$$;

-- ─────────────────────────────────────────────── support cases

create or replace function public.admin_create_support_case(
  p_actor_id    uuid,
  p_user_id     uuid,
  p_category    text,
  p_channel     text,
  p_subject     text,
  p_message     text,
  p_assigned_to uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_id         uuid;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'support.manage');

  if p_user_id is not null and not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  if p_assigned_to is not null and not public.admin_user_has_permission(p_assigned_to, 'support.manage') then
    raise exception 'ASSIGNEE_NOT_ELIGIBLE';
  end if;

  insert into public.support_cases (user_id, category, channel, subject, message, assigned_to, created_by)
  values (p_user_id, p_category, coalesce(p_channel, 'whatsapp'), btrim(coalesce(p_subject, '')),
          nullif(btrim(coalesce(p_message, '')), ''), p_assigned_to, p_actor_id)
  returning id into v_id;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'support_case.create', 'support_case', v_id::text, null, null,
    jsonb_build_object('status', 'open', 'category', p_category, 'user_id', p_user_id, 'assigned_to', p_assigned_to)
  );

  return v_id;
end;
$$;

create or replace function public.admin_update_support_case(
  p_actor_id          uuid,
  p_case_id           uuid,
  p_status            text default null,
  p_update_assignment boolean default false,
  p_assigned_to       uuid default null,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_case       public.support_cases%rowtype;
  v_status     text;
  v_assignee   uuid;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_note_id    uuid;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'support.manage');

  select * into v_case from public.support_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;

  v_status := coalesce(p_status, v_case.status);
  if v_status not in ('open', 'in_progress', 'resolved') then
    raise exception 'SUPPORT_STATUS_INVALID';
  end if;
  v_assignee := case when p_update_assignment then p_assigned_to else v_case.assigned_to end;

  if v_assignee is not null and v_assignee is distinct from v_case.assigned_to
     and not public.admin_user_has_permission(v_assignee, 'support.manage') then
    raise exception 'ASSIGNEE_NOT_ELIGIBLE';
  end if;
  if v_note is not null and char_length(v_note) > 5000 then
    raise exception 'NOTE_TOO_LONG';
  end if;
  if v_status = v_case.status and v_assignee is not distinct from v_case.assigned_to and v_note is null then
    raise exception 'NOTHING_TO_UPDATE';
  end if;

  update public.support_cases c
  set status = v_status,
      assigned_to = v_assignee,
      resolved_at = case when v_status = 'resolved' then coalesce(c.resolved_at, clock_timestamp()) else null end
  where c.id = p_case_id;

  if v_note is not null then
    insert into public.admin_internal_notes (entity_type, entity_id, author_id, body)
    values ('support_case', p_case_id, p_actor_id, v_note)
    returning id into v_note_id;
  end if;

  if v_status <> v_case.status then
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'support_case.status_change', 'support_case', p_case_id::text, null,
      jsonb_build_object('status', v_case.status), jsonb_build_object('status', v_status)
    );
  end if;
  if v_assignee is distinct from v_case.assigned_to then
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'support_case.assign', 'support_case', p_case_id::text, null,
      jsonb_build_object('assigned_to', v_case.assigned_to), jsonb_build_object('assigned_to', v_assignee)
    );
  end if;
  if v_note_id is not null then
    perform public.record_admin_audit(
      p_actor_id, v_actor_role, 'support_case.note_add', 'support_case', p_case_id::text, null,
      null, jsonb_build_object('note_id', v_note_id)
    );
  end if;

  return jsonb_build_object('status', v_status, 'assigned_to', v_assignee, 'note_id', v_note_id);
end;
$$;

-- ─────────────────────────────────────────────── questions

/*
 * Creates or edits an internal question with its options in one transaction.
 *
 * The M2 guards keep active question content immutable. This is the single,
 * deliberate and audited way through them: an active question is moved to
 * draft, edited, and re-activated — at which point the activation trigger
 * re-validates the option set exactly as it would for any other activation.
 * Historical attempts are unaffected because sessions freeze their own
 * snapshot at creation.
 */
create or replace function public.admin_save_internal_question(
  p_actor_id    uuid,
  p_question_id uuid,
  p_payload     jsonb,
  p_reason      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role  public.admin_role;
  v_existing    public.questions%rowtype;
  v_exam_id     uuid;
  v_subject_id  uuid;
  v_topic_id    uuid;
  v_year        integer;
  v_text        text;
  v_explanation text;
  v_difficulty  public.question_difficulty;
  v_correct     text;
  v_target      public.question_status;
  v_options     jsonb;
  v_option      jsonb;
  v_position    integer := 0;
  v_id          uuid;
  v_before      jsonb;
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'questions.manage');

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'QUESTION_PAYLOAD_INVALID';
  end if;

  v_exam_id := nullif(p_payload ->> 'exam_body_id', '')::uuid;
  v_subject_id := nullif(p_payload ->> 'subject_id', '')::uuid;
  v_topic_id := nullif(p_payload ->> 'topic_id', '')::uuid;
  v_year := nullif(p_payload ->> 'year', '')::integer;
  v_text := btrim(coalesce(p_payload ->> 'question_text', ''));
  v_explanation := nullif(btrim(coalesce(p_payload ->> 'explanation', '')), '');
  v_difficulty := nullif(p_payload ->> 'difficulty', '')::public.question_difficulty;
  v_correct := upper(btrim(coalesce(p_payload ->> 'correct_option_key', '')));
  v_target := coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.question_status;
  v_options := p_payload -> 'options';

  if v_target not in ('draft', 'pending_review', 'active') then
    raise exception 'QUESTION_STATUS_INVALID';
  end if;
  if char_length(v_text) < 3 or char_length(v_text) > 5000 then
    raise exception 'QUESTION_TEXT_INVALID';
  end if;
  if v_explanation is not null and char_length(v_explanation) > 5000 then
    raise exception 'QUESTION_EXPLANATION_INVALID';
  end if;
  if v_year is not null and (v_year < 1960 or v_year > 2100) then
    raise exception 'QUESTION_YEAR_INVALID';
  end if;
  if not exists (
    select 1 from public.exam_subjects es where es.exam_body_id = v_exam_id and es.subject_id = v_subject_id
  ) then
    raise exception 'QUESTION_SUBJECT_NOT_IN_EXAM';
  end if;
  if v_topic_id is not null and not exists (
    select 1 from public.topics t where t.id = v_topic_id and t.subject_id = v_subject_id
  ) then
    raise exception 'QUESTION_TOPIC_INVALID';
  end if;
  if v_options is null or jsonb_typeof(v_options) <> 'array'
     or jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 5 then
    raise exception 'QUESTION_OPTIONS_INVALID';
  end if;

  for v_option in select value from jsonb_array_elements(v_options)
  loop
    v_position := v_position + 1;
    if (v_option ->> 'key') is distinct from (array['A', 'B', 'C', 'D', 'E'])[v_position] then
      raise exception 'QUESTION_OPTION_KEYS_INVALID';
    end if;
    if char_length(btrim(coalesce(v_option ->> 'text', ''))) not between 1 and 2000 then
      raise exception 'QUESTION_OPTION_TEXT_INVALID';
    end if;
  end loop;

  if not exists (select 1 from jsonb_array_elements(v_options) o where o.value ->> 'key' = v_correct) then
    raise exception 'QUESTION_CORRECT_OPTION_INVALID';
  end if;

  if p_question_id is not null then
    select * into v_existing from public.questions q where q.id = p_question_id for update;
    if not found then
      raise exception 'QUESTION_NOT_FOUND';
    end if;
    if v_existing.passage_id is not null and v_existing.subject_id <> v_subject_id then
      raise exception 'QUESTION_PASSAGE_SUBJECT_LOCKED';
    end if;
    -- Changing what students are currently being served needs a stated reason.
    if v_existing.status = 'active' and (v_reason is null or char_length(v_reason) < 5) then
      raise exception 'ADMIN_REASON_REQUIRED';
    end if;

    v_before := jsonb_build_object(
      'status', v_existing.status,
      'exam_body_id', v_existing.exam_body_id,
      'subject_id', v_existing.subject_id,
      'topic_id', v_existing.topic_id,
      'year', v_existing.year,
      'difficulty', v_existing.difficulty,
      'question_text', v_existing.question_text,
      'correct_option_key', v_existing.correct_option_key,
      'explanation', v_existing.explanation,
      'options', (
        select coalesce(jsonb_agg(jsonb_build_object('key', o.option_key, 'text', o.option_text) order by o.display_order), '[]'::jsonb)
        from public.question_options o where o.question_id = p_question_id
      )
    );

    if v_existing.status = 'active' then
      update public.questions q set status = 'draft' where q.id = p_question_id;
    end if;

    update public.questions q
    set exam_body_id = v_exam_id,
        subject_id = v_subject_id,
        topic_id = v_topic_id,
        year = v_year,
        question_text = v_text,
        explanation = v_explanation,
        difficulty = v_difficulty,
        correct_option_key = v_correct
    where q.id = p_question_id;

    delete from public.question_options o where o.question_id = p_question_id;
    v_id := p_question_id;
  else
    insert into public.questions (
      exam_body_id, subject_id, topic_id, year, question_text, correct_option_key,
      explanation, difficulty, source_provider, status, created_by
    ) values (
      v_exam_id, v_subject_id, v_topic_id, v_year, v_text, v_correct,
      v_explanation, v_difficulty, 'internal', 'draft', p_actor_id
    )
    returning id into v_id;
  end if;

  insert into public.question_options (question_id, option_key, option_text, display_order)
  select v_id, o.value ->> 'key', btrim(o.value ->> 'text'), o.ordinality::integer
  from jsonb_array_elements(v_options) with ordinality as o(value, ordinality);

  if v_target <> 'draft' then
    update public.questions q set status = v_target where q.id = v_id;
  end if;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role,
    case when p_question_id is null then 'question.create' else 'question.update' end,
    'question', v_id::text, v_reason, v_before,
    jsonb_build_object(
      'status', v_target, 'exam_body_id', v_exam_id, 'subject_id', v_subject_id, 'topic_id', v_topic_id,
      'year', v_year, 'difficulty', v_difficulty, 'question_text', v_text,
      'correct_option_key', v_correct, 'explanation', v_explanation,
      'options', (
        select coalesce(jsonb_agg(jsonb_build_object('key', o.value ->> 'key', 'text', btrim(o.value ->> 'text')) order by o.ordinality), '[]'::jsonb)
        from jsonb_array_elements(v_options) with ordinality as o(value, ordinality)
      )
    )
  );

  return v_id;
end;
$$;

create or replace function public.admin_set_question_status(
  p_actor_id    uuid,
  p_question_id uuid,
  p_status      public.question_status,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_existing   public.questions%rowtype;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'questions.manage');

  select * into v_existing from public.questions q where q.id = p_question_id for update;
  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;
  if p_status is null or p_status = v_existing.status then
    raise exception 'NOTHING_TO_UPDATE';
  end if;
  -- Taking a question out of circulation is always explained.
  if p_status in ('flagged', 'disabled') or v_existing.status = 'active' then
    v_reason := public.admin_required_reason(v_reason);
  end if;

  update public.questions q
  set status = p_status,
      review_notes = case when p_status in ('flagged', 'disabled') then v_reason else q.review_notes end
  where q.id = p_question_id;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'question.status_change', 'question', p_question_id::text, v_reason,
    jsonb_build_object('status', v_existing.status), jsonb_build_object('status', p_status)
  );

  return jsonb_build_object('status', p_status);
end;
$$;

create or replace function public.admin_block_question(
  p_actor_id           uuid,
  p_source_provider    text,
  p_exam_code          text,
  p_subject_slug       text,
  p_source_question_id text,
  p_reason             text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_provider   text := lower(btrim(coalesce(p_source_provider, '')));
  v_id         uuid;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'questions.manage');
  v_reason := public.admin_required_reason(p_reason);

  -- Internal questions are Master De Genius content: disable them instead.
  if v_provider = 'internal' then
    raise exception 'INTERNAL_QUESTIONS_USE_STATUS';
  end if;

  insert into public.question_blocks (source_provider, exam_code, subject_slug, source_question_id, reason, blocked_by)
  values (v_provider, lower(btrim(coalesce(p_exam_code, ''))), lower(btrim(coalesce(p_subject_slug, ''))),
          btrim(coalesce(p_source_question_id, '')), v_reason, p_actor_id)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'QUESTION_ALREADY_BLOCKED';
  end if;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'question.block', 'question_block', v_id::text, v_reason, null,
    jsonb_build_object('source_provider', v_provider, 'exam_code', lower(btrim(p_exam_code)),
      'subject_slug', lower(btrim(p_subject_slug)), 'source_question_id', btrim(p_source_question_id))
  );

  return v_id;
end;
$$;

create or replace function public.admin_lift_question_block(
  p_actor_id uuid,
  p_block_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_block      public.question_blocks%rowtype;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'questions.manage');
  v_reason := public.admin_required_reason(p_reason);

  select * into v_block from public.question_blocks b where b.id = p_block_id and b.lifted_at is null for update;
  if not found then
    raise exception 'QUESTION_BLOCK_NOT_FOUND';
  end if;

  update public.question_blocks b
  set lifted_at = clock_timestamp(), lifted_by = p_actor_id, lift_reason = v_reason
  where b.id = p_block_id;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'question.unblock', 'question_block', p_block_id::text, v_reason,
    jsonb_build_object('blocked', true, 'source_provider', v_block.source_provider,
      'source_question_id', v_block.source_question_id),
    jsonb_build_object('blocked', false)
  );

  return jsonb_build_object('id', p_block_id, 'lifted', true);
end;
$$;

-- ─────────────────────────────────────────────── session recovery

/*
 * The one recovery action: finalise a timed session whose authoritative time
 * has already run out but which nobody has reopened to trigger the automatic
 * submission. It calls the engine's own idempotent finalisers, so scoring is
 * never re-implemented, and it refuses anything still inside its time — an
 * admin can never cut a live exam short or change an answer.
 */
create or replace function public.admin_finalize_overdue_session(
  p_actor_id   uuid,
  p_kind       text,
  p_session_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.admin_role;
  v_reason     text;
  v_user_id    uuid;
  v_status     text;
  v_mode       text;
  v_expires    timestamptz;
  v_answered   integer;
  v_after      text;
begin
  v_actor_role := public.assert_admin_permission(p_actor_id, 'sessions.recover');
  v_reason := public.admin_required_reason(p_reason);

  if p_kind = 'exam' then
    select a.user_id, a.status::text, a.expires_at, a.answered_count
    into v_user_id, v_status, v_expires, v_answered
    from public.exam_attempts a where a.id = p_session_id;

    if v_user_id is null then
      raise exception 'SESSION_NOT_FOUND';
    end if;
    if v_status <> 'in_progress' or v_expires is null or v_expires > clock_timestamp() then
      raise exception 'SESSION_NOT_OVERDUE';
    end if;

    perform * from public.submit_exam_attempt(v_user_id, p_session_id, 'time_expired');
    v_after := 'submitted';
  elsif p_kind = 'practice' then
    select s.user_id, s.status::text, s.mode::text, s.expires_at, s.answered_count
    into v_user_id, v_status, v_mode, v_expires, v_answered
    from public.practice_sessions s where s.id = p_session_id;

    if v_user_id is null then
      raise exception 'SESSION_NOT_FOUND';
    end if;
    if v_status <> 'in_progress' or v_mode <> 'timed' or v_expires is null or v_expires > clock_timestamp() then
      raise exception 'SESSION_NOT_OVERDUE';
    end if;

    perform * from public.complete_practice_session(v_user_id, p_session_id);
    v_after := 'completed';
  else
    raise exception 'INVALID_SESSION_KIND';
  end if;

  perform public.record_admin_audit(
    p_actor_id, v_actor_role, 'session.finalize_overdue',
    case when p_kind = 'exam' then 'exam_attempt' else 'practice_session' end,
    p_session_id::text, v_reason,
    jsonb_build_object('status', v_status, 'expires_at', v_expires, 'answered_count', v_answered),
    jsonb_build_object('status', v_after)
  );

  return jsonb_build_object('status', v_after, 'user_id', v_user_id);
end;
$$;

-- ─────────────────────────────────────────────── read models

create or replace function public.admin_overview_metrics(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_result jsonb := jsonb_build_object('generated_at', clock_timestamp());
begin
  perform public.assert_admin_permission(p_actor_id, 'overview.view');

  if public.admin_user_has_permission(p_actor_id, 'students.view') then
    v_result := v_result || jsonb_build_object(
      'students', (
        select jsonb_build_object(
          'total', count(*),
          'onboarded', count(*) filter (where p.onboarding_completed),
          'new_7d', count(*) filter (where p.created_at >= v_now - interval '7 days'),
          'new_30d', count(*) filter (where p.created_at >= v_now - interval '30 days')
        )
        from public.profiles p
      ),
      'exam_split', (
        select coalesce(jsonb_object_agg(x.code, x.total), '{}'::jsonb)
        from (
          select eb.code, count(*) as total
          from public.student_exam_preferences sep
          join public.exam_bodies eb on eb.id = sep.exam_body_id
          where sep.is_primary
          group by eb.code
        ) x
      ),
      'active_students', (
        select jsonb_build_object(
          'd7', count(distinct a.user_id) filter (where a.created_at >= v_now - interval '7 days'),
          'd30', count(distinct a.user_id)
        )
        from (
          select s.user_id, s.created_at from public.practice_sessions s where s.created_at >= v_now - interval '30 days'
          union all
          select e.user_id, e.created_at from public.exam_attempts e where e.created_at >= v_now - interval '30 days'
        ) a
      )
    );
  end if;

  if public.admin_user_has_permission(p_actor_id, 'students.view')
     or public.admin_user_has_permission(p_actor_id, 'academics.view')
     or public.admin_user_has_permission(p_actor_id, 'sessions.view') then
    v_result := v_result || jsonb_build_object('learning', jsonb_build_object(
      'practice_completed_7d', (select count(*) from public.practice_sessions s where s.status = 'completed' and s.completed_at >= v_now - interval '7 days'),
      'practice_completed_30d', (select count(*) from public.practice_sessions s where s.status = 'completed' and s.completed_at >= v_now - interval '30 days'),
      'mocks_submitted_7d', (select count(*) from public.exam_attempts e where e.status = 'submitted' and e.submitted_at >= v_now - interval '7 days'),
      'mocks_submitted_30d', (select count(*) from public.exam_attempts e where e.status = 'submitted' and e.submitted_at >= v_now - interval '30 days'),
      -- Revision sets hold only previously missed questions, so they are left
      -- out of accuracy rather than dragging it down by construction.
      'practice_questions_30d', (select coalesce(sum(s.question_count), 0) from public.practice_sessions s where s.status = 'completed' and s.source_provider <> 'revision' and s.completed_at >= v_now - interval '30 days'),
      'practice_correct_30d', (select coalesce(sum(s.correct_count), 0) from public.practice_sessions s where s.status = 'completed' and s.source_provider <> 'revision' and s.completed_at >= v_now - interval '30 days')
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'payments.view') then
    -- Revenue is live-mode money only. Test-mode checkouts are counted
    -- separately so a preview deployment can never inflate the figure.
    v_result := v_result || jsonb_build_object('monetisation', jsonb_build_object(
      'active_master', (select count(*) from public.user_entitlements e where e.tier = 'master' and e.expires_at > v_now),
      'payments_30d', (select count(*) from public.payment_transactions t where t.status = 'success' and t.environment = 'live' and t.paid_at >= v_now - interval '30 days'),
      'revenue_7d_kobo', (select coalesce(sum(t.amount_kobo), 0) from public.payment_transactions t where t.status = 'success' and t.environment = 'live' and t.paid_at >= v_now - interval '7 days'),
      'revenue_30d_kobo', (select coalesce(sum(t.amount_kobo), 0) from public.payment_transactions t where t.status = 'success' and t.environment = 'live' and t.paid_at >= v_now - interval '30 days'),
      'revenue_all_kobo', (select coalesce(sum(t.amount_kobo), 0) from public.payment_transactions t where t.status = 'success' and t.environment = 'live'),
      'unsuccessful_30d', (select count(*) from public.payment_transactions t where t.status in ('failed', 'abandoned') and t.created_at >= v_now - interval '30 days'),
      'test_payments_30d', (select count(*) from public.payment_transactions t where t.status = 'success' and t.environment = 'test' and t.paid_at >= v_now - interval '30 days'),
      'manual_grants_30d', (select count(*) from public.entitlement_events ev where ev.source = 'admin' and ev.created_at >= v_now - interval '30 days')
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'classes.view') then
    v_result := v_result || jsonb_build_object('leads', (
      select jsonb_build_object(
        'new', count(*) filter (where l.status = 'new'),
        'contacted', count(*) filter (where l.status = 'contacted'),
        'interested', count(*) filter (where l.status = 'interested'),
        'follow_up', count(*) filter (where l.status = 'follow_up'),
        'enrolled', count(*) filter (where l.status = 'enrolled'),
        'not_interested', count(*) filter (where l.status = 'not_interested'),
        'closed', count(*) filter (where l.status = 'closed'),
        'created_7d', count(*) filter (where l.created_at >= v_now - interval '7 days'),
        -- The request form promises a reply within a day.
        'waiting_over_24h', count(*) filter (where l.status = 'new' and l.created_at < v_now - interval '24 hours'),
        'unassigned_open', count(*) filter (where l.assigned_to is null and l.status in ('new', 'contacted', 'interested', 'follow_up'))
      )
      from public.premium_class_leads l
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'support.view') then
    v_result := v_result || jsonb_build_object('support', (
      select jsonb_build_object(
        'open', count(*) filter (where c.status = 'open'),
        'in_progress', count(*) filter (where c.status = 'in_progress'),
        'unassigned', count(*) filter (where c.status <> 'resolved' and c.assigned_to is null)
      )
      from public.support_cases c
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'questions.view') then
    v_result := v_result || jsonb_build_object('questions', jsonb_build_object(
      'active', (select count(*) from public.questions q where q.status = 'active'),
      'pending_review', (select count(*) from public.questions q where q.status = 'pending_review'),
      'flagged', (select count(*) from public.questions q where q.status = 'flagged'),
      'blocked_external', (select count(*) from public.question_blocks b where b.lifted_at is null)
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'sessions.view') then
    v_result := v_result || jsonb_build_object('session_health', jsonb_build_object(
      'overdue_mocks', (select count(*) from public.exam_attempts e where e.status = 'in_progress' and e.expires_at < v_now - interval '10 minutes'),
      'overdue_timed_practice', (select count(*) from public.practice_sessions s where s.status = 'in_progress' and s.mode = 'timed' and s.expires_at < v_now - interval '10 minutes')
    ));
  end if;

  if public.admin_user_has_permission(p_actor_id, 'system.view') then
    v_result := v_result || jsonb_build_object('platform_health', jsonb_build_object(
      'provider_requests_24h', (select count(*) from public.external_api_usage u where u.created_at >= v_now - interval '24 hours'),
      'provider_failures_24h', (select count(*) from public.external_api_usage u where u.outcome = 'failed' and u.created_at >= v_now - interval '24 hours'),
      'provider_last_ok_at', (select u.created_at from public.external_api_usage u where u.outcome = 'ok' order by u.created_at desc limit 1),
      'ai_requests_7d', (select count(*) from public.ai_usage a where a.created_at >= v_now - interval '7 days'),
      'ai_failures_7d', (select count(*) from public.ai_usage a where a.status = 'failed' and a.created_at >= v_now - interval '7 days'),
      'webhook_rejected_7d', (select count(*) from public.billing_webhook_events w where w.outcome = 'rejected' and w.received_at >= v_now - interval '7 days'),
      'webhook_unfinished', (select count(*) from public.billing_webhook_events w where w.processed_at is null and w.claim_expires_at < v_now - interval '10 minutes')
    ));
  end if;

  return v_result;
end;
$$;

create or replace function public.admin_list_students(
  p_actor_id uuid,
  p_search   text default null,
  p_exam     text default null,
  p_plan     text default null,
  p_activity text default null,
  p_sort     text default 'joined_desc',
  p_limit    integer default 25,
  p_offset   integer default 0
)
returns table (
  user_id              uuid,
  full_name            text,
  email                text,
  exam_code            text,
  exam_year            integer,
  plan_tier            text,
  master_expires_at    timestamptz,
  subject_names        text[],
  joined_at            timestamptz,
  last_session_at      timestamptz,
  finished_sessions    bigint,
  onboarding_completed boolean,
  is_suspended         boolean,
  total_count          bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_now    timestamptz := clock_timestamp();
begin
  perform public.assert_admin_permission(p_actor_id, 'students.view');

  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'PAGINATION_INVALID';
  end if;
  if coalesce(p_sort, 'joined_desc') not in ('joined_desc', 'joined_asc', 'active_desc', 'name_asc') then
    raise exception 'STUDENT_FILTER_INVALID';
  end if;
  if p_plan is not null and p_plan not in ('free', 'master', 'lapsed') then
    raise exception 'STUDENT_FILTER_INVALID';
  end if;
  if p_activity is not null and p_activity not in ('active_7d', 'active_30d', 'inactive_30d', 'never') then
    raise exception 'STUDENT_FILTER_INVALID';
  end if;
  if v_search is not null then
    v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
  with base as (
    select
      p.id,
      p.full_name,
      u.email::text as email,
      p.created_at,
      p.onboarding_completed,
      pref.id as preference_id,
      eb.code as exam_code,
      pref.exam_year,
      case when e.tier = 'master' and e.expires_at > v_now then 'master' else 'free' end as plan_tier,
      case when e.tier = 'master' and e.expires_at > v_now then e.expires_at end as master_expires_at,
      (e.tier = 'master' and e.expires_at <= v_now) as is_lapsed,
      -- "Last session" is the most recent practice or mock the student
      -- started. Both lookups ride the existing (user_id, created_at) indexes.
      greatest(
        (select max(ps.created_at) from public.practice_sessions ps where ps.user_id = p.id),
        (select max(ea.created_at) from public.exam_attempts ea where ea.user_id = p.id)
      ) as last_session_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.student_exam_preferences pref on pref.user_id = p.id and pref.is_primary
    left join public.exam_bodies eb on eb.id = pref.exam_body_id
    left join public.user_entitlements e on e.user_id = p.id
    where (v_search is null
        or p.full_name ilike '%' || v_search || '%'
        or u.email::text ilike '%' || v_search || '%'
        or p.id::text = lower(btrim(p_search)))
      and (p_exam is null or eb.code = p_exam)
  ), filtered as (
    select b.*
    from base b
    where (p_plan is null
        or (p_plan = 'master' and b.plan_tier = 'master')
        or (p_plan = 'free' and b.plan_tier = 'free')
        or (p_plan = 'lapsed' and coalesce(b.is_lapsed, false)))
      and (p_activity is null
        or (p_activity = 'active_7d' and b.last_session_at >= v_now - interval '7 days')
        or (p_activity = 'active_30d' and b.last_session_at >= v_now - interval '30 days')
        or (p_activity = 'inactive_30d' and (b.last_session_at is null or b.last_session_at < v_now - interval '30 days'))
        or (p_activity = 'never' and b.last_session_at is null))
  ), ranked as (
    select f.*,
      count(*) over () as total,
      row_number() over (order by
        case when coalesce(p_sort, 'joined_desc') = 'joined_desc' then f.created_at end desc nulls last,
        case when p_sort = 'joined_asc' then f.created_at end asc nulls last,
        case when p_sort = 'active_desc' then f.last_session_at end desc nulls last,
        case when p_sort = 'name_asc' then lower(f.full_name) end asc nulls last,
        f.id
      ) as rn
    from filtered f
  )
  select
    r.id,
    r.full_name,
    r.email,
    r.exam_code,
    r.exam_year,
    r.plan_tier,
    r.master_expires_at,
    coalesce((
      select array_agg(s.name order by ssp.display_order)
      from public.student_subject_preferences ssp
      join public.subjects s on s.id = ssp.subject_id
      where ssp.preference_id = r.preference_id
    ), array[]::text[]),
    r.created_at,
    r.last_session_at,
    (select count(*) from public.practice_sessions ps where ps.user_id = r.id and ps.status = 'completed')
      + (select count(*) from public.exam_attempts ea where ea.user_id = r.id and ea.status = 'submitted'),
    r.onboarding_completed,
    exists (select 1 from public.account_suspensions sus where sus.user_id = r.id),
    r.total
  from ranked r
  where r.rn > p_offset and r.rn <= p_offset + p_limit
  order by r.rn;
end;
$$;

create or replace function public.admin_list_sessions(
  p_actor_id     uuid,
  p_kind         text default null,
  p_state        text default null,
  p_exam         text default null,
  p_subject_slug text default null,
  p_user_id      uuid default null,
  p_search       text default null,
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_limit        integer default 25,
  p_offset       integer default 0
)
returns table (
  session_kind    text,
  session_id      uuid,
  user_id         uuid,
  student_name    text,
  student_email   text,
  exam_code       text,
  session_type    text,
  subject_names   text,
  status          text,
  question_count  integer,
  answered_count  integer,
  correct_count   integer,
  source_provider text,
  started_at      timestamptz,
  finished_at     timestamptz,
  expires_at      timestamptz,
  total_count     bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
  v_search     text := nullif(btrim(coalesce(p_search, '')), '');
  v_now        timestamptz := clock_timestamp();
begin
  perform public.assert_admin_permission(p_actor_id, 'sessions.view');

  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'PAGINATION_INVALID';
  end if;
  if p_kind is not null and p_kind not in ('practice', 'timed', 'revision', 'mock') then
    raise exception 'SESSION_FILTER_INVALID';
  end if;
  if p_state is not null and p_state not in ('active', 'finished', 'overdue', 'abandoned') then
    raise exception 'SESSION_FILTER_INVALID';
  end if;
  if p_subject_slug is not null then
    select s.id into v_subject_id from public.subjects s where s.slug = p_subject_slug;
    if v_subject_id is null then
      return;
    end if;
  end if;
  if v_search is not null then
    v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
  with combined as (
    select 'practice'::text as kind, s.id, s.user_id, s.exam_body_id,
      case when s.source_provider = 'revision' then 'revision' else s.mode::text end as session_type,
      s.status::text as status, s.question_count, s.answered_count, s.correct_count, s.source_provider,
      s.started_at, s.completed_at as finished_at, s.expires_at, s.created_at
    from public.practice_sessions s
    where (p_kind is null or p_kind in ('practice', 'timed', 'revision'))
      and (p_user_id is null or s.user_id = p_user_id)
      and (v_subject_id is null or s.subject_id = v_subject_id)
      and (p_from is null or s.created_at >= p_from)
      and (p_to is null or s.created_at < p_to)
    union all
    select 'exam'::text, a.id, a.user_id, a.exam_body_id, 'mock'::text, a.status::text, a.total_questions,
      a.answered_count, a.correct_count, a.source_provider, a.started_at, a.submitted_at, a.expires_at, a.created_at
    from public.exam_attempts a
    where (p_kind is null or p_kind = 'mock')
      and (p_user_id is null or a.user_id = p_user_id)
      and (v_subject_id is null or exists (
        select 1 from public.exam_attempt_subjects x where x.attempt_id = a.id and x.subject_id = v_subject_id))
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
  ), filtered as (
    select c.*, eb.code as exam_code, pr.full_name as student_name, u.email::text as student_email
    from combined c
    left join public.exam_bodies eb on eb.id = c.exam_body_id
    left join public.profiles pr on pr.id = c.user_id
    left join auth.users u on u.id = c.user_id
    where (p_kind is null or c.session_type = p_kind)
      and (p_exam is null or eb.code = p_exam)
      and (v_search is null or pr.full_name ilike '%' || v_search || '%' or u.email::text ilike '%' || v_search || '%')
      and (p_state is null
        or (p_state = 'active' and c.status in ('created', 'in_progress') and (c.expires_at is null or c.expires_at > v_now))
        or (p_state = 'overdue' and c.status = 'in_progress' and c.expires_at <= v_now)
        or (p_state = 'finished' and c.status in ('completed', 'submitted'))
        or (p_state = 'abandoned' and c.status in ('expired', 'abandoned')))
  ), ranked as (
    select f.*, count(*) over () as total, row_number() over (order by f.created_at desc, f.id) as rn
    from filtered f
  )
  select
    r.kind,
    r.id,
    r.user_id,
    r.student_name,
    r.student_email,
    r.exam_code,
    r.session_type,
    case when r.kind = 'practice' then (
      select sub.name from public.practice_sessions ps join public.subjects sub on sub.id = ps.subject_id where ps.id = r.id
    ) else (
      select string_agg(sub.name, ', ' order by x.display_order)
      from public.exam_attempt_subjects x join public.subjects sub on sub.id = x.subject_id
      where x.attempt_id = r.id
    ) end,
    r.status,
    r.question_count,
    r.answered_count,
    r.correct_count,
    r.source_provider,
    r.started_at,
    r.finished_at,
    r.expires_at,
    r.total
  from ranked r
  where r.rn > p_offset and r.rn <= p_offset + p_limit
  order by r.rn;
end;
$$;

/*
 * Academic performance over a bounded window, computed from the same frozen
 * session rows the student's own results are graded from: accuracy is
 * correct / questions, with unanswered counting as not correct, exactly as in
 * features/results/grading.ts.
 */
create or replace function public.admin_academic_performance(
  p_actor_id     uuid,
  p_exam_code    text default null,
  p_subject_slug text default null,
  p_since        timestamptz default null,
  p_until        timestamptz default null,
  p_min_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until      timestamptz := coalesce(p_until, clock_timestamp());
  v_since      timestamptz := coalesce(p_since, coalesce(p_until, clock_timestamp()) - interval '30 days');
  v_min        integer := least(greatest(coalesce(p_min_attempts, 5), 1), 1000);
  v_exam_id    uuid;
  v_subject_id uuid;
  v_result     jsonb;
begin
  perform public.assert_admin_permission(p_actor_id, 'academics.view');

  if v_since >= v_until or v_until - v_since > interval '366 days' then
    raise exception 'ACADEMIC_WINDOW_INVALID';
  end if;
  if p_exam_code is not null then
    select eb.id into v_exam_id from public.exam_bodies eb where eb.code = p_exam_code;
    if v_exam_id is null then
      raise exception 'EXAM_NOT_FOUND';
    end if;
  end if;
  if p_subject_slug is not null then
    select s.id into v_subject_id from public.subjects s where s.slug = p_subject_slug;
    if v_subject_id is null then
      raise exception 'SUBJECT_NOT_FOUND';
    end if;
  end if;

  with facts as materialized (
    select ps.id as session_id, ps.user_id, ps.exam_body_id, ps.subject_id,
      q.source_provider, q.source_question_id, q.internal_question_id,
      nullif(q.student_snapshot -> 'topic' ->> 'slug', '') as topic_slug,
      nullif(q.student_snapshot -> 'topic' ->> 'name', '') as topic_name,
      left(q.student_snapshot ->> 'prompt', 200) as prompt,
      coalesce(pa.is_correct, false) as is_correct,
      pa.id is null as is_unanswered
    from public.practice_sessions ps
    join public.practice_session_questions q on q.session_id = ps.id
    left join public.practice_answers pa on pa.session_question_id = q.id
    where ps.status = 'completed'
      and ps.source_provider <> 'revision'
      and ps.completed_at >= v_since and ps.completed_at < v_until
      and (v_exam_id is null or ps.exam_body_id = v_exam_id)
      and (v_subject_id is null or ps.subject_id = v_subject_id)
    union all
    select ea.id, ea.user_id, ea.exam_body_id, q.subject_id,
      q.source_provider, q.source_question_id, q.internal_question_id,
      nullif(q.student_snapshot -> 'topic' ->> 'slug', ''),
      nullif(q.student_snapshot -> 'topic' ->> 'name', ''),
      left(q.student_snapshot ->> 'prompt', 200),
      coalesce(xa.is_correct, false),
      xa.selected_option_key is null
    from public.exam_attempts ea
    join public.exam_attempt_questions q on q.attempt_id = ea.id
    left join public.exam_attempt_answers xa on xa.attempt_question_id = q.id
    where ea.status = 'submitted'
      and ea.submitted_at >= v_since and ea.submitted_at < v_until
      and (v_exam_id is null or ea.exam_body_id = v_exam_id)
      and (v_subject_id is null or q.subject_id = v_subject_id)
  ), labelled as materialized (
    select f.*, eb.code as exam_code, s.slug as subject_slug, s.name as subject_name
    from facts f
    join public.exam_bodies eb on eb.id = f.exam_body_id
    join public.subjects s on s.id = f.subject_id
  )
  select jsonb_build_object(
    'window', jsonb_build_object('since', v_since, 'until', v_until, 'min_attempts', v_min),
    'totals', (
      select jsonb_build_object(
        'questions', count(*),
        'correct', count(*) filter (where l.is_correct),
        'unanswered', count(*) filter (where l.is_unanswered),
        'sessions', count(distinct l.session_id),
        'students', count(distinct l.user_id)
      )
      from labelled l
    ),
    'subjects', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.accuracy, x.questions desc), '[]'::jsonb)
      from (
        select l.exam_code, l.subject_slug, l.subject_name,
          count(*) as questions,
          count(*) filter (where l.is_correct) as correct,
          count(*) filter (where not l.is_correct and not l.is_unanswered) as incorrect,
          count(*) filter (where l.is_unanswered) as unanswered,
          count(distinct l.session_id) as sessions,
          count(distinct l.user_id) as students,
          round(100.0 * count(*) filter (where l.is_correct) / count(*))::integer as accuracy
        from labelled l
        group by l.exam_code, l.subject_slug, l.subject_name
      ) x
    ),
    'topics', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.accuracy, x.questions desc), '[]'::jsonb)
      from (
        select l.exam_code, l.subject_slug, l.subject_name, l.topic_slug,
          coalesce(max(l.topic_name), 'Uncategorised') as topic_name,
          count(*) as questions,
          count(*) filter (where l.is_correct) as correct,
          count(distinct l.user_id) as students,
          round(100.0 * count(*) filter (where l.is_correct) / count(*))::integer as accuracy
        from labelled l
        group by l.exam_code, l.subject_slug, l.subject_name, l.topic_slug
        having count(*) >= v_min
        order by accuracy, questions desc
        limit 60
      ) x
    ),
    'questions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.accuracy, x.attempts desc), '[]'::jsonb)
      from (
        select l.source_provider, l.exam_code, l.subject_slug, l.subject_name, l.source_question_id,
          max(l.internal_question_id::text) as internal_question_id,
          max(l.topic_name) as topic_name,
          min(l.prompt) as prompt,
          count(*) as attempts,
          count(*) filter (where l.is_correct) as correct,
          count(distinct l.user_id) as students,
          round(100.0 * count(*) filter (where l.is_correct) / count(*))::integer as accuracy,
          exists (
            select 1 from public.question_blocks b
            where b.lifted_at is null and b.source_provider = l.source_provider and b.exam_code = l.exam_code
              and b.subject_slug = l.subject_slug and b.source_question_id = l.source_question_id
          ) as is_blocked
        from labelled l
        group by l.source_provider, l.exam_code, l.subject_slug, l.subject_name, l.source_question_id
        having count(*) >= v_min
        order by accuracy, attempts desc
        limit 50
      ) x
    ),
    -- "Repeat misses": the same student got the same question wrong at least
    -- twice in the window. A plain, countable fact — not the Mistake Bank's
    -- mastery rule, which depends on answer order per student.
    'repeated', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.repeat_misses desc), '[]'::jsonb)
      from (
        select r.exam_code, r.subject_slug, r.subject_name, r.topic_slug,
          coalesce(max(r.topic_name), 'Uncategorised') as topic_name,
          count(*) as repeat_misses,
          count(distinct r.user_id) as students
        from (
          select l.user_id, l.exam_code, l.subject_slug, l.subject_name, l.topic_slug,
            max(l.topic_name) as topic_name
          from labelled l
          group by l.user_id, l.exam_code, l.subject_slug, l.subject_name, l.topic_slug, l.source_provider, l.source_question_id
          having count(*) filter (where not l.is_correct) >= 2
        ) r
        group by r.exam_code, r.subject_slug, r.subject_name, r.topic_slug
        order by repeat_misses desc
        limit 30
      ) x
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_weekly_analytics(p_actor_id uuid, p_weeks integer default 8)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payments boolean;
  v_classes  boolean;
  v_result   jsonb;
begin
  perform public.assert_admin_permission(p_actor_id, 'analytics.view');
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then
    raise exception 'ANALYTICS_WINDOW_INVALID';
  end if;

  v_payments := public.admin_user_has_permission(p_actor_id, 'payments.view');
  v_classes := public.admin_user_has_permission(p_actor_id, 'classes.view');

  select coalesce(jsonb_agg(weekly.row_data order by weekly.week_start), '[]'::jsonb)
  into v_result
  from (
    select w.week_start, jsonb_strip_nulls(jsonb_build_object(
      'week_start', w.week_start,
      'registrations', (select count(*) from public.profiles p where p.created_at >= w.week_start and p.created_at < w.week_end),
      'onboarded', (select count(*) from public.profiles p where p.created_at >= w.week_start and p.created_at < w.week_end and p.onboarding_completed),
      'active_students', (
        select count(distinct a.user_id) from (
          select s.user_id from public.practice_sessions s where s.created_at >= w.week_start and s.created_at < w.week_end
          union all
          select e.user_id from public.exam_attempts e where e.created_at >= w.week_start and e.created_at < w.week_end
        ) a
      ),
      'practice_completed', (select count(*) from public.practice_sessions s where s.status = 'completed' and s.source_provider <> 'revision' and s.completed_at >= w.week_start and s.completed_at < w.week_end),
      'revision_sessions', (select count(*) from public.practice_sessions s where s.source_provider = 'revision' and s.created_at >= w.week_start and s.created_at < w.week_end),
      'mocks_submitted', (select count(*) from public.exam_attempts e where e.status = 'submitted' and e.submitted_at >= w.week_start and e.submitted_at < w.week_end),
      'ai_generated', (select count(*) from public.ai_usage u where u.status = 'ok' and not u.cache_hit and u.created_at >= w.week_start and u.created_at < w.week_end),
      'ai_cached', (select count(*) from public.ai_usage u where u.status = 'ok' and u.cache_hit and u.created_at >= w.week_start and u.created_at < w.week_end),
      'ai_failed', (select count(*) from public.ai_usage u where u.status = 'failed' and u.created_at >= w.week_start and u.created_at < w.week_end),
      'purchases', case when v_payments then (select count(*) from public.payment_transactions t where t.status = 'success' and t.environment = 'live' and t.paid_at >= w.week_start and t.paid_at < w.week_end) end,
      'revenue_kobo', case when v_payments then (select coalesce(sum(t.amount_kobo), 0) from public.payment_transactions t where t.status = 'success' and t.environment = 'live' and t.paid_at >= w.week_start and t.paid_at < w.week_end) end,
      'first_purchases', case when v_payments then (
        select count(*) from (
          select t.user_id, min(t.paid_at) as first_paid_at
          from public.payment_transactions t
          where t.status = 'success' and t.environment = 'live'
          group by t.user_id
        ) fp where fp.first_paid_at >= w.week_start and fp.first_paid_at < w.week_end
      ) end,
      'leads_created', case when v_classes then (select count(*) from public.premium_class_leads l where l.created_at >= w.week_start and l.created_at < w.week_end) end,
      'leads_contacted', case when v_classes then (select count(*) from public.premium_class_leads l where l.contacted_at >= w.week_start and l.contacted_at < w.week_end) end,
      'leads_enrolled', case when v_classes then (select count(*) from public.premium_class_leads l where l.enrolled_at >= w.week_start and l.enrolled_at < w.week_end) end
    )) as row_data
    from (
      select gs as week_start, gs + interval '7 days' as week_end
      from generate_series(
        date_trunc('week', clock_timestamp()) - make_interval(weeks => p_weeks - 1),
        date_trunc('week', clock_timestamp()),
        interval '7 days'
      ) gs
    ) w
  ) weekly;

  return v_result;
end;
$$;

create or replace function public.admin_list_admins(p_actor_id uuid)
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  role             public.admin_role,
  is_active        boolean,
  granted_by_email text,
  created_at       timestamptz,
  updated_at       timestamptz,
  deactivated_at   timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_permission(p_actor_id, 'admins.manage');

  return query
  select a.user_id, u.email::text, coalesce(p.full_name, ''), a.role, a.is_active, g.email::text,
    a.created_at, a.updated_at, a.deactivated_at
  from public.app_admins a
  left join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  left join auth.users g on g.id = a.granted_by
  order by a.is_active desc, a.role, lower(coalesce(u.email::text, ''));
end;
$$;

/* Active admins who hold a permission, for assignment pickers. */
create or replace function public.admin_list_assignees(p_actor_id uuid, p_permission text)
returns table (user_id uuid, email text, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_permission(p_actor_id, 'overview.view');

  return query
  select a.user_id, u.email::text, coalesce(p.full_name, '')
  from public.app_admins a
  join public.admin_role_permissions rp on rp.role = a.role and rp.permission = p_permission
  left join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  where a.is_active
  order by lower(coalesce(nullif(p.full_name, ''), u.email::text, ''));
end;
$$;

/* Names and emails for a page of ids, in one round trip instead of N. */
create or replace function public.admin_user_directory(p_actor_id uuid, p_user_ids uuid[])
returns table (user_id uuid, email text, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_permission(p_actor_id, 'overview.view');
  if cardinality(coalesce(p_user_ids, array[]::uuid[])) > 500 then
    raise exception 'DIRECTORY_REQUEST_TOO_LARGE';
  end if;

  return query
  select u.id, u.email::text, coalesce(p.full_name, '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = any(coalesce(p_user_ids, array[]::uuid[]));
end;
$$;

create or replace function public.admin_search_users(p_actor_id uuid, p_search text, p_limit integer default 50)
returns table (user_id uuid, email text, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.assert_admin_permission(p_actor_id, 'overview.view');
  if v_search is null then
    return;
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'PAGINATION_INVALID';
  end if;
  v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select u.id, u.email::text, coalesce(p.full_name, '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email::text ilike '%' || v_search || '%' or p.full_name ilike '%' || v_search || '%'
  order by u.email
  limit p_limit;
end;
$$;

-- ─────────────────────────────────────────────── RLS, grants and exposure

alter table public.admin_role_permissions enable row level security;
alter table public.admin_audit_log        enable row level security;
alter table public.admin_internal_notes   enable row level security;
alter table public.support_cases          enable row level security;
alter table public.question_blocks        enable row level security;
alter table public.account_suspensions    enable row level security;

-- Supabase's default privileges grant new public tables to every API role, so
-- each grant is stated explicitly rather than inherited.
revoke all on table public.admin_role_permissions from public, anon, authenticated, service_role;
revoke all on table public.admin_audit_log        from public, anon, authenticated, service_role;
revoke all on table public.admin_internal_notes   from public, anon, authenticated, service_role;
revoke all on table public.support_cases          from public, anon, authenticated, service_role;
revoke all on table public.question_blocks        from public, anon, authenticated, service_role;
revoke all on table public.account_suspensions    from public, anon, authenticated, service_role;
revoke all on sequence public.admin_audit_log_id_seq from public, anon, authenticated, service_role;

-- The server reads. Every write goes through the audited functions above.
grant select on table public.admin_role_permissions to service_role;
grant select on table public.admin_audit_log        to service_role;
grant select on table public.admin_internal_notes   to service_role;
grant select on table public.support_cases          to service_role;
grant select on table public.question_blocks        to service_role;
grant select on table public.account_suspensions    to service_role;

-- Memberships and CRM state can no longer be changed by a direct service-role
-- write that would bypass the audit trail.
revoke insert, update, delete, truncate on table public.app_admins from service_role;
revoke update, delete, truncate on table public.premium_class_leads from service_role;

-- Restrictive deny policies: even a future permissive policy or grant cannot
-- make these rows visible to a browser session.
create policy "app_admins_deny_browser" on public.app_admins
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "admin_role_permissions_deny_browser" on public.admin_role_permissions
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "admin_audit_log_deny_browser" on public.admin_audit_log
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "admin_internal_notes_deny_browser" on public.admin_internal_notes
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "support_cases_deny_browser" on public.support_cases
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "question_blocks_deny_browser" on public.question_blocks
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy "account_suspensions_deny_browser" on public.account_suspensions
  as restrictive for all to anon, authenticated using (false) with check (false);

-- Internal helpers: owner only.
revoke all on function public.admin_user_has_permission(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.assert_admin_permission(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_required_reason(text) from public, anon, authenticated, service_role;
revoke all on function public.record_admin_audit(uuid, public.admin_role, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.prevent_admin_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function public.guard_last_super_admin() from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_first_super_admin(text) from public, anon, authenticated, service_role;

-- Privileged operations: the trusted server only, each re-checking the actor.
revoke all on function public.admin_grant_membership(uuid, text, public.admin_role, text) from public, anon, authenticated;
revoke all on function public.admin_update_membership(uuid, uuid, public.admin_role, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_record_suspension(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_clear_suspension(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_grant_master_access(uuid, uuid, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_update_class_lead(uuid, uuid, public.class_lead_status, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_create_support_case(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_support_case(uuid, uuid, text, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_save_internal_question(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_set_question_status(uuid, uuid, public.question_status, text) from public, anon, authenticated;
revoke all on function public.admin_block_question(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_lift_question_block(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_finalize_overdue_session(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_overview_metrics(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_students(uuid, text, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_sessions(uuid, text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_academic_performance(uuid, text, text, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.admin_weekly_analytics(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_list_admins(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_assignees(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_user_directory(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.admin_search_users(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.admin_grant_membership(uuid, text, public.admin_role, text) to service_role;
grant execute on function public.admin_update_membership(uuid, uuid, public.admin_role, boolean, text) to service_role;
grant execute on function public.admin_record_suspension(uuid, uuid, text) to service_role;
grant execute on function public.admin_clear_suspension(uuid, uuid, text) to service_role;
grant execute on function public.admin_grant_master_access(uuid, uuid, integer, timestamptz, text) to service_role;
grant execute on function public.admin_update_class_lead(uuid, uuid, public.class_lead_status, boolean, uuid, text) to service_role;
grant execute on function public.admin_create_support_case(uuid, uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.admin_update_support_case(uuid, uuid, text, boolean, uuid, text) to service_role;
grant execute on function public.admin_save_internal_question(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.admin_set_question_status(uuid, uuid, public.question_status, text) to service_role;
grant execute on function public.admin_block_question(uuid, text, text, text, text, text) to service_role;
grant execute on function public.admin_lift_question_block(uuid, uuid, text) to service_role;
grant execute on function public.admin_finalize_overdue_session(uuid, text, uuid, text) to service_role;
grant execute on function public.admin_overview_metrics(uuid) to service_role;
grant execute on function public.admin_list_students(uuid, text, text, text, text, text, integer, integer) to service_role;
grant execute on function public.admin_list_sessions(uuid, text, text, text, text, uuid, text, timestamptz, timestamptz, integer, integer) to service_role;
grant execute on function public.admin_academic_performance(uuid, text, text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.admin_weekly_analytics(uuid, integer) to service_role;
grant execute on function public.admin_list_admins(uuid) to service_role;
grant execute on function public.admin_list_assignees(uuid, text) to service_role;
grant execute on function public.admin_user_directory(uuid, uuid[]) to service_role;
grant execute on function public.admin_search_users(uuid, text, integer) to service_role;

comment on table public.app_admins is
  'Admin memberships. Changed only through admin_grant_membership / admin_update_membership (audited) or bootstrap_first_super_admin from the SQL editor.';
comment on table public.admin_audit_log is
  'Immutable administrative audit trail. Rows cannot be updated, deleted or truncated by any role.';
comment on table public.question_blocks is
  'External questions withheld from new sessions. Provider data is never modified.';
comment on table public.account_suspensions is
  'Active account suspensions. The Supabase Auth ban is applied alongside by the server.';
