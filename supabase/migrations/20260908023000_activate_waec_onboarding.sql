-- Activate verified WAEC objective preparation without changing the JAMB mock engine.
-- The subject list mirrors ALOC Station discovery data verified on 2026-09-08.

insert into public.subjects (slug, name)
values
  ('civic-education', 'Civic Education'),
  ('insurance', 'Insurance')
on conflict (slug) do update set
  name = excluded.name,
  is_active = true;

update public.exam_bodies
set description = 'WASSCE objective practice, past questions and timed subject sessions',
    is_active = true
where code = 'waec';

with waec as (
  select id from public.exam_bodies where code = 'waec'
), ordered_subjects(slug, display_order) as (
  values
    ('mathematics', 1),
    ('economics', 2),
    ('government', 3),
    ('commerce', 4),
    ('literature-in-english', 5),
    ('principles-of-accounts', 6),
    ('geography', 7),
    ('christian-religious-studies', 8),
    ('civic-education', 9),
    ('history', 10),
    ('insurance', 11)
)
insert into public.exam_subjects (exam_body_id, subject_id, is_compulsory, display_order)
select waec.id, subjects.id, false, ordered_subjects.display_order
from waec
join ordered_subjects on true
join public.subjects on subjects.slug = ordered_subjects.slug
on conflict (exam_body_id, subject_id) do update set
  is_compulsory = excluded.is_compulsory,
  display_order = excluded.display_order;

-- Save either supported exam setup atomically. The RPC remains server-authoritative:
-- clients cannot bypass exam-specific target, subject-count, compulsory-subject,
-- catalogue-membership, or ownership checks.
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
