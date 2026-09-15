-- Preserve old years and all attempts. One active year per exam, one default per account.
alter table public.student_exam_preferences add column is_active boolean not null default true;
with ranked as (
 select id, row_number() over(partition by user_id, exam_body_id order by is_primary desc, updated_at desc, id) rn
 from public.student_exam_preferences
) update public.student_exam_preferences p set is_active = false from ranked r where p.id=r.id and r.rn>1;
create unique index student_exam_preferences_one_active_exam
on public.student_exam_preferences(user_id, exam_body_id) where is_active;
alter table public.student_exam_preferences add constraint primary_exam_must_be_active check (not is_primary or is_active);
-- Repair legacy accounts that have preferences but no default, without re-onboarding.
with candidates as (
 select id, row_number() over(partition by user_id order by exam_year desc, created_at, id) rn
 from public.student_exam_preferences p where is_active
 and not exists (select 1 from public.student_exam_preferences d where d.user_id=p.user_id and d.is_primary)
) update public.student_exam_preferences p set is_primary=true from candidates c where p.id=c.id and c.rn=1;
comment on column public.student_exam_preferences.is_primary is 'Default workspace, not an access restriction.';
create or replace function public.complete_exam_onboarding(
  p_exam_code text,
  p_exam_year integer,
  p_target_score integer,
  p_intended_course text,
  p_study_intensity public.study_intensity,
  p_subject_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam_code text := lower(trim(coalesce(p_exam_code, '')));
  v_exam_body_id uuid;
  v_preference_id uuid;
  v_subject_count integer;
  v_valid_subject_count integer;
  v_missing_compulsory_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if p_exam_year is null or p_target_score is null or p_study_intensity is null
     or length(coalesce(p_intended_course, '')) > 120 then
    raise exception 'Invalid examination configuration';
  end if;
  if v_exam_code not in ('jamb', 'waec') then
    raise exception 'This examination is not available for onboarding';
  end if;

  if p_exam_year < extract(year from now())::integer or p_exam_year > extract(year from now())::integer + 4 then
    raise exception 'Invalid exam year';
  end if;

  if v_exam_code = 'jamb' and (p_target_score < 180 or p_target_score > 400) then
    raise exception 'JAMB target score must be between 180 and 400';
  end if;
  if v_exam_code = 'waec' and (p_target_score < 1 or p_target_score > 100) then
    raise exception 'WAEC percentage goal must be between 1 and 100';
  end if;

  select id into v_exam_body_id
  from public.exam_bodies
  where code = v_exam_code and is_active = true;

  if v_exam_body_id is null then
    raise exception 'This examination is not currently available';
  end if;

  select count(distinct subject_id)
  into v_subject_count
  from unnest(coalesce(p_subject_ids, array[]::uuid[])) as selected(subject_id);

  if cardinality(coalesce(p_subject_ids, array[]::uuid[])) <> v_subject_count then
    raise exception 'Subjects must be unique';
  end if;
  if v_exam_code = 'jamb' and v_subject_count <> 4 then
    raise exception 'Select exactly four unique JAMB subjects';
  end if;
  if v_exam_code = 'waec' and (v_subject_count < 1 or v_subject_count > 9) then
    raise exception 'Select between one and nine unique WAEC preparation subjects';
  end if;

  select count(*) into v_valid_subject_count
  from public.exam_subjects exam_subject
  join public.subjects subject on subject.id = exam_subject.subject_id and subject.is_active = true
  where exam_subject.exam_body_id = v_exam_body_id
    and exam_subject.subject_id = any(p_subject_ids);

  if v_valid_subject_count <> v_subject_count then
    raise exception 'One or more selected subjects are not valid for this examination';
  end if;

  select count(*) into v_missing_compulsory_count
  from public.exam_subjects exam_subject
  where exam_subject.exam_body_id = v_exam_body_id
    and exam_subject.is_compulsory = true
    and not (exam_subject.subject_id = any(p_subject_ids));

  if v_missing_compulsory_count > 0 then
    raise exception 'A compulsory subject is missing';
  end if;

  update public.student_exam_preferences set is_active = false, is_primary = false
  where user_id = v_user_id and exam_body_id = v_exam_body_id and exam_year <> p_exam_year;

  update public.student_exam_preferences
  set is_primary = false
  where user_id = v_user_id and is_primary = true;

  insert into public.student_exam_preferences (
    user_id, exam_body_id, exam_year, target_score, intended_course, study_intensity, is_primary
  )
  values (
    v_user_id, v_exam_body_id, p_exam_year, p_target_score,
    nullif(trim(p_intended_course), ''), p_study_intensity, true
  )
  on conflict (user_id, exam_body_id, exam_year)
  do update set
    target_score = excluded.target_score,
    intended_course = excluded.intended_course,
    study_intensity = excluded.study_intensity,
    is_primary = true,
    is_active = true,
    updated_at = now()
  returning id into v_preference_id;

  delete from public.student_subject_preferences
  where preference_id = v_preference_id;

  insert into public.student_subject_preferences (preference_id, subject_id, display_order)
  select v_preference_id, subject_id, ordinality::integer
  from unnest(p_subject_ids) with ordinality as selected(subject_id, ordinality);

  update public.profiles
  set onboarding_completed = true
  where id = v_user_id;

  return v_preference_id;
end;
$$;

revoke all on function public.complete_exam_onboarding(text, integer, integer, text, public.study_intensity, uuid[]) from public;
revoke all on function public.complete_exam_onboarding(text, integer, integer, text, public.study_intensity, uuid[]) from anon;
grant execute on function public.complete_exam_onboarding(text, integer, integer, text, public.study_intensity, uuid[]) to authenticated;

-- One transaction: validation failures roll back every exam and onboarding status.
create or replace function public.save_exam_preparations(p_configurations jsonb, p_default_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
 v_user uuid := auth.uid(); v_config jsonb; v_codes text[] := array[]::text[]; v_id uuid;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 perform 1 from public.profiles where id=v_user for update;
 if jsonb_typeof(p_configurations) is distinct from 'array' then raise exception 'Choose at least one exam'; end if;
 if jsonb_array_length(p_configurations) not between 1 and 2 then raise exception 'Choose at least one exam'; end if;
 for v_config in select value from jsonb_array_elements(p_configurations) loop
   if coalesce(v_config->>'examCode','') = any(v_codes) then raise exception 'Duplicate exam'; end if;
   v_codes := array_append(v_codes, v_config->>'examCode');
   v_id := public.complete_exam_onboarding(v_config->>'examCode', (v_config->>'examYear')::integer,
     (v_config->>'targetScore')::integer, v_config->>'intendedCourse',
     (v_config->>'studyIntensity')::public.study_intensity,
     array(select value::uuid from jsonb_array_elements_text(v_config->'subjectIds')));
 end loop;
 if p_default_code is null or not (p_default_code = any(v_codes)) then raise exception 'Choose a configured default exam'; end if;
 update public.student_exam_preferences set is_primary=false where user_id=v_user and is_primary;
 update public.student_exam_preferences set is_primary=true
 where user_id=v_user and is_active and exam_body_id=(select id from public.exam_bodies where code=p_default_code);
end $$;
revoke all on function public.save_exam_preparations(jsonb,text) from public, anon;
grant execute on function public.save_exam_preparations(jsonb,text) to authenticated;

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
          where sep.is_active
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
      and (p_exam is null or exists (select 1 from public.student_exam_preferences sp join public.exam_bodies be on be.id=sp.exam_body_id where sp.user_id=p.id and sp.is_active and be.code=p_exam))
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

-- All preference writes use the validated, account-locked RPCs.
drop policy if exists "exam_preferences_insert_own" on public.student_exam_preferences;
drop policy if exists "exam_preferences_update_own" on public.student_exam_preferences;
drop policy if exists "exam_preferences_delete_own" on public.student_exam_preferences;
drop policy if exists "subject_preferences_insert_own" on public.student_subject_preferences;
drop policy if exists "subject_preferences_update_own" on public.student_subject_preferences;
drop policy if exists "subject_preferences_delete_own" on public.student_subject_preferences;
-- Preserve the legacy JAMB API with the same validated implementation.
create or replace function public.complete_jamb_onboarding(
 p_exam_year integer, p_target_score integer, p_intended_course text,
 p_study_intensity public.study_intensity, p_subject_ids uuid[]
) returns uuid language sql security invoker set search_path=public,pg_temp as $$
 select public.complete_exam_onboarding('jamb',p_exam_year,p_target_score,p_intended_course,p_study_intensity,p_subject_ids);
$$;
