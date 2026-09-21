-- MASTER@DE'GENIUS — Free-to-Master conversion quotas.
--
-- The Free plan changes from "20 practice sessions a day" to "4 practice
-- questions a day". A session count cannot express that: one session can hold
-- forty questions, and nothing about creating it says how many the student will
-- actually attempt. So this adds a per-question ledger, and moves every product
-- allowance onto the Nigerian calendar day.
--
-- Forward-only and additive. Nothing here rewrites a session, an answer, a
-- payment or an entitlement, and every statement is safe to re-run:
--   * one new table, practice_question_usage (the ledger)
--   * one new table, ai_explanation_receipts (reopening is never charged twice)
--   * the lock-anchor table learns the new capability name
--   * consume/refund_ai_daily_quota keep their signatures and move to WAT
--   * new SECURITY DEFINER functions, all executable by service_role only
--
-- Rollback does not need this migration reverted: the application chooses
-- whether a tier is metered by questions or by sessions from
-- features/billing/plans.ts, and none of the objects below do anything unless
-- that configuration calls them. See MONETIZATION-NOTES.md, "Free plan v2".

-- ───────────────────────────────────────────── one calendar for every allowance

/*
 * The day a quota belongs to, in Africa/Lagos (WAT, UTC+1, no daylight saving).
 *
 * A student in Lagos who studies at 00:30 is studying "today", not the tail end
 * of yesterday in UTC. Every allowance — practice, mock and MASTER AI — resets
 * on this calendar; the application computes the same key in
 * features/billing/quota.ts and the tests assert the two agree at the boundary.
 */
create or replace function public.product_quota_day(p_at timestamptz default clock_timestamp())
returns date
language sql
set search_path = ''
as $$
  select (p_at at time zone 'Africa/Lagos')::date
$$;

comment on function public.product_quota_day(timestamptz) is
  'The Africa/Lagos calendar date a product allowance belongs to. Shared by every quota window.';

-- ─────────────────────────────────────────── the practice-question ledger

/*
 * The lock anchor learns one more capability. The existing constraint is found
 * by definition rather than assumed by name, so this is safe on any shape the
 * table has reached, and re-running it is a no-op.
 */
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.product_usage_windows'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%capability%'
  loop
    execute format('alter table public.product_usage_windows drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.product_usage_windows
  add constraint product_usage_windows_capability_check
  check (capability in ('practice_session', 'mock_attempt', 'practice_question'));

/*
 * One row per practice question that has counted against a metered (Free)
 * allowance. The primary key is the session question, so a question is charged
 * at most once however many times its answer is submitted, retried or changed.
 *
 *   held  — delivered in a metered session and not yet answered. It is part of
 *           the student's allowance already: it was sized to fit when the
 *           session was built, so it can always be answered.
 *   used  — answered. `window_key` is the day it was answered on.
 *
 * A held question whose session is finished without an answer stays counted:
 * finishing reveals its answer and explanation in the results, so releasing it
 * would turn "start a session and finish it" into unlimited free questions.
 *
 * Deliberately no foreign keys to the session tables: usage history must
 * outlive anything that ever tidies sessions away, or deleting a session would
 * hand the allowance back.
 */
create table if not exists public.practice_question_usage (
  session_question_id uuid primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  session_id          uuid not null,
  window_key          text not null check (window_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  state               text not null check (state in ('held', 'used')),
  created_at          timestamptz not null default now(),
  used_at             timestamptz,
  constraint practice_question_usage_state_shape check (
    (state = 'held' and used_at is null) or (state = 'used' and used_at is not null)
  )
);

create index if not exists practice_question_usage_window_idx
  on public.practice_question_usage (user_id, window_key);
create index if not exists practice_question_usage_held_idx
  on public.practice_question_usage (user_id, session_id) where state = 'held';

alter table public.practice_question_usage enable row level security;
revoke all on table public.practice_question_usage from public, anon, authenticated;
grant select, insert, update on table public.practice_question_usage to service_role;

comment on table public.practice_question_usage is
  'Free practice-question ledger. One row per question charged; never written by a browser role.';

/*
 * Serialises every metered practice operation for one student.
 *
 * Per account rather than per day: a question held yesterday and answered today
 * moves between windows, so a per-day lock would let two requests either side
 * of midnight both pass. The anchor lives in the existing quota lock table.
 */
create or replace function public.lock_practice_question_ledger(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_usage_windows (user_id, capability, window_key)
  values (p_user_id, 'practice_question', 'account')
  on conflict (user_id, capability, window_key) do nothing;

  perform 1 from public.product_usage_windows w
  where w.user_id = p_user_id and w.capability = 'practice_question' and w.window_key = 'account'
  for update;
end;
$$;

/*
 * The three numbers every decision is made from.
 *
 *   charged_today — rows in today's window, in any state
 *   waiting_today — of those, held questions still answerable in a live session
 *   carried       — held questions from an earlier day, still answerable
 *
 * A session is live while it is in progress and, if timed, before its expiry.
 */
create or replace function public.practice_question_load(p_user_id uuid, p_day_key text)
returns table (charged_today integer, waiting_today integer, carried integer)
language sql
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer
       from public.practice_question_usage u
      where u.user_id = p_user_id and u.window_key = p_day_key),
    (select count(*)::integer
       from public.practice_question_usage u
       join public.practice_sessions s on s.id = u.session_id and s.user_id = u.user_id
      where u.user_id = p_user_id and u.window_key = p_day_key and u.state = 'held'
        and s.status = 'in_progress'
        and (s.expires_at is null or s.expires_at > clock_timestamp())),
    (select count(*)::integer
       from public.practice_question_usage u
       join public.practice_sessions s on s.id = u.session_id and s.user_id = u.user_id
      where u.user_id = p_user_id and u.window_key <> p_day_key and u.state = 'held'
        and s.status = 'in_progress'
        and (s.expires_at is null or s.expires_at > clock_timestamp()))
$$;

create or replace function public.assert_practice_question_params(p_day_key text, p_limit integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_day_key is null or p_day_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'PRODUCT_QUOTA_PARAMS_INVALID';
  end if;
end;
$$;

/*
 * What the student sees and what the setup screen may offer.
 *
 *   used      — answered today, plus today's questions finished unanswered
 *   waiting   — held questions still answerable in a live session
 *   remaining — limit − used: how many more they can answer today
 *   available — remaining − waiting: the largest new session they may start
 */
create or replace function public.practice_question_allowance(
  p_user_id uuid,
  p_day_key text,
  p_limit   integer
)
returns table (allowance integer, used integer, waiting integer, remaining integer, available integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load record;
begin
  perform public.assert_practice_question_params(p_day_key, p_limit);
  select * into v_load from public.practice_question_load(p_user_id, p_day_key);

  return query select
    p_limit,
    v_load.charged_today - v_load.waiting_today,
    v_load.waiting_today + v_load.carried,
    greatest(0, p_limit - (v_load.charged_today - v_load.waiting_today)),
    greatest(0, p_limit - v_load.charged_today - v_load.carried);
end;
$$;

/*
 * Builds a metered practice session and holds its questions, atomically.
 *
 * The session is created by the unchanged create_practice_session, so the
 * frozen-snapshot rules are exactly the ones every other session follows. The
 * only addition is the refusal in front of it: a session larger than the
 * student's available allowance is never created, so its questions never reach
 * the browser. Two tabs racing for the last questions serialise on the ledger
 * lock and exactly one of them gets them.
 */
create or replace function public.create_metered_practice_session(
  p_user_id          uuid,
  p_exam_body_id     uuid,
  p_subject_id       uuid,
  p_topic_id         uuid,
  p_mode             public.practice_mode,
  p_difficulty       public.question_difficulty,
  p_year_filter      integer,
  p_requested_count  integer,
  p_provider         text,
  p_duration_seconds integer,
  p_questions        jsonb,
  p_day_key          text,
  p_limit            integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load       record;
  v_count      integer;
  v_session_id uuid;
begin
  perform public.assert_practice_question_params(p_day_key, p_limit);
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Practice questions payload must be an array.';
  end if;
  v_count := jsonb_array_length(p_questions);

  perform public.lock_practice_question_ledger(p_user_id);
  select * into v_load from public.practice_question_load(p_user_id, p_day_key);

  if v_load.charged_today + v_load.carried + v_count > p_limit then
    raise exception 'FREE_PRACTICE_LIMIT';
  end if;

  v_session_id := public.create_practice_session(
    p_user_id, p_exam_body_id, p_subject_id, p_topic_id, p_mode, p_difficulty,
    p_year_filter, p_requested_count, p_provider, p_duration_seconds, p_questions
  );

  insert into public.practice_question_usage (session_question_id, user_id, session_id, window_key, state)
  select q.id, p_user_id, v_session_id, p_day_key, 'held'
  from public.practice_session_questions q
  where q.session_id = v_session_id;

  return v_session_id;
end;
$$;

/*
 * Saves one practice answer, charging the allowance for a first answer only.
 *
 * The charge and the answer commit in one transaction: if the answer is refused
 * (time up, session finished, stale revision) the charge rolls back with it, and
 * if the allowance is exhausted the answer is never written.
 *
 * Nothing is charged when:
 *   - the request is a replay, or the question already has an answer (a retry,
 *     a changed timed answer, a question answered before this release)
 *   - the question was held for this student when its session was built
 *     (it moves to `used`; it was already counted)
 *   - the session or question is not the student's, or is no longer answerable
 *     (save_response_v2 refuses it and nothing is written)
 *
 * Only a question with no ledger row — a session built before this release, or
 * while the student had Master — takes a fresh unit, and only if one is left.
 */
create or replace function public.save_metered_practice_response(
  p_user_id             uuid,
  p_session_id          uuid,
  p_question_id         uuid,
  p_selected_option_key text,
  p_expected_revision   integer,
  p_mutation_id         uuid,
  p_day_key             text,
  p_limit               integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_session public.practice_sessions%rowtype;
  v_usage   public.practice_question_usage%rowtype;
  v_load    record;
  v_payload jsonb;
  v_used    integer;
  v_waiting integer;
begin
  perform public.assert_practice_question_params(p_day_key, p_limit);

  -- Ledger first, then the session row inside save_response_v2: every metered
  -- path takes the two locks in the same order.
  perform public.lock_practice_question_ledger(p_user_id);

  select * into v_session
  from public.practice_sessions s
  where s.id = p_session_id and s.user_id = p_user_id;

  -- now(), not clock_timestamp(): the same instant save_practice_answer uses for
  -- TIME_UP, so no answer can be accepted in a moment this check calls expired.
  if found
     and v_session.status = 'in_progress'
     and (v_session.expires_at is null or v_session.expires_at > now())
     and exists (
       select 1 from public.practice_session_questions q
       where q.id = p_question_id and q.session_id = p_session_id
     )
     and not exists (
       select 1 from public.practice_answers a where a.session_question_id = p_question_id
     )
  then
    select * into v_usage
    from public.practice_question_usage u
    where u.session_question_id = p_question_id
    for update;

    if found then
      if v_usage.user_id = p_user_id and v_usage.state = 'held' then
        update public.practice_question_usage u
        set state = 'used', used_at = v_now, window_key = p_day_key
        where u.session_question_id = p_question_id;
      end if;
    else
      select * into v_load from public.practice_question_load(p_user_id, p_day_key);
      if v_load.charged_today + v_load.carried + 1 > p_limit then
        raise exception 'FREE_PRACTICE_LIMIT';
      end if;
      insert into public.practice_question_usage (
        session_question_id, user_id, session_id, window_key, state, used_at
      ) values (
        p_question_id, p_user_id, p_session_id, p_day_key, 'used', v_now
      );
    end if;
  end if;

  v_payload := public.save_response_v2(
    p_user_id, 'practice', p_session_id, p_question_id, p_selected_option_key,
    false, p_expected_revision, p_mutation_id
  );

  select * into v_load from public.practice_question_load(p_user_id, p_day_key);
  v_used    := v_load.charged_today - v_load.waiting_today;
  v_waiting := v_load.waiting_today + v_load.carried;

  return v_payload || jsonb_build_object('allowance', jsonb_build_object(
    'limit',     p_limit,
    'used',      v_used,
    'waiting',   v_waiting,
    'remaining', greatest(0, p_limit - v_used),
    'available', greatest(0, p_limit - v_load.charged_today - v_load.carried)
  ));
end;
$$;

-- ──────────────────────────────────────── read-only usage for the summary

/* Units counted by reserve_product_quota right now: committed, or still leased. */
create or replace function public.product_quota_usage(
  p_user_id    uuid,
  p_capability text,
  p_window_key text
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.product_usage_reservations r
  where r.user_id = p_user_id
    and r.capability = p_capability
    and r.window_key = p_window_key
    and (r.state = 'committed' or r.lease_expires_at >= clock_timestamp())
$$;

/* Generations counted against today's MASTER AI allowance. */
create or replace function public.ai_quota_usage(p_user_id uuid, p_feature text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select coalesce((
    select d.generation_count
    from public.ai_daily_usage d
    where d.user_id = p_user_id
      and d.feature = p_feature
      and d.usage_date = public.product_quota_day(clock_timestamp())
  ), 0)
$$;

-- ───────────────────────────────────────────── MASTER AI on the WAT calendar

alter table public.ai_daily_usage
  alter column usage_date set default public.product_quota_day(now());

/*
 * Unchanged except for the calendar: the count is reserved atomically before
 * the provider is called, exactly as before, but "today" is now the Lagos day.
 */
create or replace function public.consume_ai_daily_quota(
  p_user_id uuid,
  p_feature text,
  p_limit integer
)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := public.product_quota_day(clock_timestamp());
  v_count integer;
begin
  if p_feature <> 'question_explanation' or p_limit < 1 or p_limit > 10000 then
    raise exception 'AI_DAILY_QUOTA_PARAMS_INVALID';
  end if;

  insert into public.ai_daily_usage (user_id, usage_date, feature, generation_count, updated_at)
  values (p_user_id, v_date, p_feature, 1, clock_timestamp())
  on conflict (user_id, usage_date, feature) do update
  set generation_count = public.ai_daily_usage.generation_count + 1,
      updated_at = clock_timestamp()
  where public.ai_daily_usage.generation_count < p_limit
  returning generation_count into v_count;

  if v_count is not null then
    return query select true, greatest(0, p_limit - v_count);
    return;
  end if;

  select d.generation_count into v_count
  from public.ai_daily_usage d
  where d.user_id = p_user_id and d.usage_date = v_date and d.feature = p_feature;

  return query select false, greatest(0, p_limit - coalesce(v_count, p_limit));
end;
$$;

create or replace function public.refund_ai_daily_quota(
  p_user_id uuid,
  p_feature  text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_feature <> 'question_explanation' then
    raise exception 'AI_DAILY_QUOTA_PARAMS_INVALID';
  end if;

  -- Same Lagos day the consume side uses, so a refund lands on the row it charged.
  update public.ai_daily_usage d
  set generation_count = d.generation_count - 1,
      updated_at       = clock_timestamp()
  where d.user_id   = p_user_id
    and d.usage_date = public.product_quota_day(clock_timestamp())
    and d.feature    = p_feature
    and d.generation_count > 0
  returning d.generation_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

/*
 * Which explanations a student has already been given.
 *
 * The shared cache expires after 48 hours. Without this, a student reopening an
 * explanation they generated three days ago would be charged for it again — or,
 * with nothing left today, refused an explanation they already had. A receipt
 * makes a regeneration of the same explanation free for that student.
 */
create table if not exists public.ai_explanation_receipts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  cache_key  text not null check (char_length(cache_key) = 64),
  created_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

alter table public.ai_explanation_receipts enable row level security;
revoke all on table public.ai_explanation_receipts from public, anon, authenticated;
grant select, insert on table public.ai_explanation_receipts to service_role;

comment on table public.ai_explanation_receipts is
  'Explanations a student has received. Hashed cache keys only — no question text, answers or content.';

-- ──────────────────────────────────────────────────────────────── grants

revoke all on function public.product_quota_day(timestamptz) from public, anon, authenticated;
revoke all on function public.lock_practice_question_ledger(uuid) from public, anon, authenticated;
revoke all on function public.practice_question_load(uuid, text) from public, anon, authenticated;
revoke all on function public.assert_practice_question_params(text, integer) from public, anon, authenticated;
revoke all on function public.practice_question_allowance(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.create_metered_practice_session(
  uuid, uuid, uuid, uuid, public.practice_mode, public.question_difficulty,
  integer, integer, text, integer, jsonb, text, integer
) from public, anon, authenticated;
revoke all on function public.save_metered_practice_response(uuid, uuid, uuid, text, integer, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.product_quota_usage(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ai_quota_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_ai_daily_quota(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.refund_ai_daily_quota(uuid, text) from public, anon, authenticated;

grant execute on function public.product_quota_day(timestamptz) to service_role;
grant execute on function public.practice_question_allowance(uuid, text, integer) to service_role;
grant execute on function public.create_metered_practice_session(
  uuid, uuid, uuid, uuid, public.practice_mode, public.question_difficulty,
  integer, integer, text, integer, jsonb, text, integer
) to service_role;
grant execute on function public.save_metered_practice_response(uuid, uuid, uuid, text, integer, uuid, text, integer)
  to service_role;
grant execute on function public.product_quota_usage(uuid, text, text) to service_role;
grant execute on function public.ai_quota_usage(uuid, text) to service_role;
grant execute on function public.consume_ai_daily_quota(uuid, text, integer) to service_role;
grant execute on function public.refund_ai_daily_quota(uuid, text) to service_role;

comment on function public.create_metered_practice_session(
  uuid, uuid, uuid, uuid, public.practice_mode, public.question_difficulty,
  integer, integer, text, integer, jsonb, text, integer
) is 'Creates a practice session only if every question fits the Free allowance, and holds them.';
comment on function public.save_metered_practice_response(uuid, uuid, uuid, text, integer, uuid, text, integer) is
  'Saves a practice answer and charges the Free allowance for a first answer, atomically.';
