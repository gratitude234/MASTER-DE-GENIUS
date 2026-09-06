-- MASTER@DE'GENIUS M1
-- Student identity, onboarding and exam-preference foundation.

create type public.study_intensity as enum ('light', 'moderate', 'intensive');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exam_bodies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  short_name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.exam_subjects (
  exam_body_id uuid not null references public.exam_bodies(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  is_compulsory boolean not null default false,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  primary key (exam_body_id, subject_id)
);

create table public.student_exam_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_body_id uuid not null references public.exam_bodies(id) on delete restrict,
  exam_year integer not null check (exam_year between 2020 and 2100),
  target_score integer check (target_score between 0 and 1000),
  intended_course text,
  study_intensity public.study_intensity not null default 'moderate',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_body_id, exam_year)
);

create unique index student_exam_preferences_one_primary_per_user
  on public.student_exam_preferences(user_id)
  where is_primary;

create table public.student_subject_preferences (
  preference_id uuid not null references public.student_exam_preferences(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (preference_id, subject_id)
);

create index student_exam_preferences_user_id_idx
  on public.student_exam_preferences(user_id);

create index student_subject_preferences_subject_id_idx
  on public.student_subject_preferences(subject_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger student_exam_preferences_set_updated_at
before update on public.student_exam_preferences
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for auth users that existed before this migration.
insert into public.profiles (id, full_name)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), '')
from auth.users u
on conflict (id) do nothing;

-- Atomically saves the JAMB onboarding choices. This is intentionally
-- server-side so the compulsory-English and four-subject rules cannot be
-- bypassed by a modified client request.
create or replace function public.complete_jamb_onboarding(
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
  v_exam_body_id uuid;
  v_english_id uuid;
  v_preference_id uuid;
  v_unique_subject_count integer;
  v_valid_subject_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_exam_year < extract(year from now())::integer - 1 or p_exam_year > extract(year from now())::integer + 5 then
    raise exception 'Invalid exam year';
  end if;

  if p_target_score < 180 or p_target_score > 400 then
    raise exception 'JAMB target score must be between 180 and 400';
  end if;

  select id into v_exam_body_id
  from public.exam_bodies
  where code = 'jamb' and is_active = true;

  if v_exam_body_id is null then
    raise exception 'JAMB is not currently available';
  end if;

  select id into v_english_id
  from public.subjects
  where slug = 'use-of-english' and is_active = true;

  select count(distinct item)
  into v_unique_subject_count
  from unnest(coalesce(p_subject_ids, array[]::uuid[])) as item;

  if cardinality(coalesce(p_subject_ids, array[]::uuid[])) <> 4 or v_unique_subject_count <> 4 then
    raise exception 'Select exactly four unique JAMB subjects';
  end if;

  if not (v_english_id = any(p_subject_ids)) then
    raise exception 'Use of English is compulsory for JAMB';
  end if;

  select count(*)
  into v_valid_subject_count
  from public.exam_subjects es
  join public.subjects s on s.id = es.subject_id and s.is_active = true
  where es.exam_body_id = v_exam_body_id
    and es.subject_id = any(p_subject_ids);

  if v_valid_subject_count <> 4 then
    raise exception 'One or more selected subjects are not valid for JAMB';
  end if;

  update public.student_exam_preferences
  set is_primary = false
  where user_id = v_user_id and is_primary = true;

  insert into public.student_exam_preferences (
    user_id,
    exam_body_id,
    exam_year,
    target_score,
    intended_course,
    study_intensity,
    is_primary
  )
  values (
    v_user_id,
    v_exam_body_id,
    p_exam_year,
    p_target_score,
    nullif(trim(p_intended_course), ''),
    p_study_intensity,
    true
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

alter table public.profiles enable row level security;
alter table public.exam_bodies enable row level security;
alter table public.subjects enable row level security;
alter table public.exam_subjects enable row level security;
alter table public.student_exam_preferences enable row level security;
alter table public.student_subject_preferences enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "exam_bodies_read_active"
on public.exam_bodies for select
to authenticated
using (is_active = true);

create policy "subjects_read_active"
on public.subjects for select
to authenticated
using (is_active = true);

create policy "exam_subjects_read"
on public.exam_subjects for select
to authenticated
using (
  exists (
    select 1 from public.exam_bodies eb
    where eb.id = exam_body_id and eb.is_active = true
  )
  and exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.is_active = true
  )
);

create policy "exam_preferences_select_own"
on public.student_exam_preferences for select
to authenticated
using (user_id = auth.uid());

create policy "exam_preferences_insert_own"
on public.student_exam_preferences for insert
to authenticated
with check (user_id = auth.uid());

create policy "exam_preferences_update_own"
on public.student_exam_preferences for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "exam_preferences_delete_own"
on public.student_exam_preferences for delete
to authenticated
using (user_id = auth.uid());

create policy "subject_preferences_select_own"
on public.student_subject_preferences for select
to authenticated
using (
  exists (
    select 1 from public.student_exam_preferences sep
    where sep.id = preference_id and sep.user_id = auth.uid()
  )
);

create policy "subject_preferences_insert_own"
on public.student_subject_preferences for insert
to authenticated
with check (
  exists (
    select 1 from public.student_exam_preferences sep
    where sep.id = preference_id and sep.user_id = auth.uid()
  )
);

create policy "subject_preferences_update_own"
on public.student_subject_preferences for update
to authenticated
using (
  exists (
    select 1 from public.student_exam_preferences sep
    where sep.id = preference_id and sep.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.student_exam_preferences sep
    where sep.id = preference_id and sep.user_id = auth.uid()
  )
);

create policy "subject_preferences_delete_own"
on public.student_subject_preferences for delete
to authenticated
using (
  exists (
    select 1 from public.student_exam_preferences sep
    where sep.id = preference_id and sep.user_id = auth.uid()
  )
);

revoke all on function public.complete_jamb_onboarding(integer, integer, text, public.study_intensity, uuid[]) from public;
grant execute on function public.complete_jamb_onboarding(integer, integer, text, public.study_intensity, uuid[]) to authenticated;
