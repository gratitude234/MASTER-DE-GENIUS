-- MASTER@DE'GENIUS M4
-- Full multi-subject CBT attempt engine: configurable mock blueprint, frozen papers,
-- server-authoritative timing, answer/flag autosave, resume and atomic submission.

create type public.exam_attempt_status as enum ('created', 'in_progress', 'submitted', 'expired', 'abandoned');
create type public.exam_submission_reason as enum ('manual', 'time_expired');

-- Keep exam structure in data rather than hard-coding it into the UI. This lets
-- us update official conditions later without rewriting the exam engine.
create table public.exam_blueprints (
  id uuid primary key default gen_random_uuid(),
  exam_body_id uuid not null references public.exam_bodies(id) on delete cascade,
  code text not null,
  name text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  expected_subject_count integer not null check (expected_subject_count between 1 and 12),
  default_question_count integer not null check (default_question_count between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_body_id, code)
);

create table public.exam_blueprint_subject_overrides (
  blueprint_id uuid not null references public.exam_blueprints(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  question_count integer not null check (question_count between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (blueprint_id, subject_id)
);

create trigger exam_blueprints_set_updated_at
before update on public.exam_blueprints
for each row execute function public.set_updated_at();

-- JAMB full-mock blueprint. Question counts are data-driven and can be changed
-- in a future migration if the official structure changes.
insert into public.exam_blueprints (
  exam_body_id,
  code,
  name,
  duration_seconds,
  expected_subject_count,
  default_question_count
)
select id, 'full_mock', 'JAMB Full Mock', 7200, 4, 40
from public.exam_bodies
where code = 'jamb'
on conflict (exam_body_id, code) do update
set name = excluded.name,
    duration_seconds = excluded.duration_seconds,
    expected_subject_count = excluded.expected_subject_count,
    default_question_count = excluded.default_question_count,
    is_active = true;

insert into public.exam_blueprint_subject_overrides (blueprint_id, subject_id, question_count)
select b.id, s.id, 60
from public.exam_blueprints b
join public.exam_bodies e on e.id = b.exam_body_id and e.code = 'jamb'
join public.subjects s on s.slug = 'use-of-english'
where b.code = 'full_mock'
on conflict (blueprint_id, subject_id) do update
set question_count = excluded.question_count;

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_body_id uuid not null references public.exam_bodies(id) on delete restrict,
  blueprint_id uuid not null references public.exam_blueprints(id) on delete restrict,
  exam_year integer not null check (exam_year between 1960 and 2100),
  source_provider text not null,
  status public.exam_attempt_status not null default 'created',
  duration_seconds integer not null check (duration_seconds > 0),
  total_questions integer not null check (total_questions > 0),
  answered_count integer not null default 0 check (answered_count >= 0),
  flagged_count integer not null default 0 check (flagged_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  started_at timestamptz,
  expires_at timestamptz,
  submitted_at timestamptz,
  submission_reason public.exam_submission_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (answered_count <= total_questions),
  check (flagged_count <= total_questions),
  check (correct_count <= answered_count),
  check ((status = 'submitted' and submitted_at is not null and submission_reason is not null) or status <> 'submitted'),
  check (
    (status = 'created' and started_at is null and expires_at is null)
    or
    (status in ('in_progress', 'submitted', 'expired', 'abandoned') and started_at is not null and expires_at is not null)
  )
);

-- A student may only have one live mock for a given exam body. This protects
-- against double-taps/racing POST requests and gives resume deterministic meaning.
create unique index exam_attempts_one_active_per_exam_idx
  on public.exam_attempts(user_id, exam_body_id)
  where status in ('created', 'in_progress');
create index exam_attempts_user_created_idx
  on public.exam_attempts(user_id, created_at desc);
create index exam_attempts_user_status_idx
  on public.exam_attempts(user_id, status, updated_at desc);

create table public.exam_attempt_subjects (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  display_order integer not null check (display_order between 1 and 20),
  question_count integer not null check (question_count between 1 and 100),
  answered_count integer not null default 0 check (answered_count >= 0),
  flagged_count integer not null default 0 check (flagged_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  created_at timestamptz not null default now(),
  unique (attempt_id, subject_id),
  unique (attempt_id, display_order),
  check (answered_count <= question_count),
  check (flagged_count <= question_count),
  check (correct_count <= answered_count)
);

create index exam_attempt_subjects_attempt_idx
  on public.exam_attempt_subjects(attempt_id, display_order);

create table public.exam_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  attempt_subject_id uuid not null references public.exam_attempt_subjects(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  subject_position integer not null check (subject_position between 1 and 100),
  overall_position integer not null check (overall_position > 0),
  source_provider text not null,
  source_question_id text not null,
  internal_question_id uuid references public.questions(id) on delete set null,
  student_snapshot jsonb not null check (jsonb_typeof(student_snapshot) = 'object'),
  correct_option_key text not null check (correct_option_key in ('A', 'B', 'C', 'D', 'E')),
  explanation text,
  created_at timestamptz not null default now(),
  unique (attempt_id, overall_position),
  unique (attempt_subject_id, subject_position)
);

create index exam_attempt_questions_attempt_idx
  on public.exam_attempt_questions(attempt_id, overall_position);
create index exam_attempt_questions_subject_idx
  on public.exam_attempt_questions(attempt_subject_id, subject_position);

create table public.exam_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  attempt_question_id uuid not null references public.exam_attempt_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_option_key text check (selected_option_key is null or selected_option_key in ('A', 'B', 'C', 'D', 'E')),
  is_flagged boolean not null default false,
  is_correct boolean,
  answered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (attempt_question_id),
  unique (attempt_id, attempt_question_id)
);

create index exam_attempt_answers_attempt_idx
  on public.exam_attempt_answers(attempt_id, updated_at);
create index exam_attempt_answers_user_idx
  on public.exam_attempt_answers(user_id, updated_at desc);

create trigger exam_attempts_set_updated_at
before update on public.exam_attempts
for each row execute function public.set_updated_at();

create trigger exam_attempt_answers_set_updated_at
before update on public.exam_attempt_answers
for each row execute function public.set_updated_at();

-- The assessment-sensitive tables intentionally have no direct browser access.
-- Student-safe snapshots are returned by Next.js server endpoints only.
alter table public.exam_blueprints enable row level security;
alter table public.exam_blueprint_subject_overrides enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_subjects enable row level security;
alter table public.exam_attempt_questions enable row level security;
alter table public.exam_attempt_answers enable row level security;

revoke all on public.exam_blueprints from anon, authenticated;
revoke all on public.exam_blueprint_subject_overrides from anon, authenticated;
revoke all on public.exam_attempts from anon, authenticated;
revoke all on public.exam_attempt_subjects from anon, authenticated;
revoke all on public.exam_attempt_questions from anon, authenticated;
revoke all on public.exam_attempt_answers from anon, authenticated;

grant select, insert, update, delete on public.exam_blueprints to service_role;
grant select, insert, update, delete on public.exam_blueprint_subject_overrides to service_role;
grant select, insert, update, delete on public.exam_attempts to service_role;
grant select, insert, update, delete on public.exam_attempt_subjects to service_role;
grant select, insert, update, delete on public.exam_attempt_questions to service_role;
grant select, insert, update, delete on public.exam_attempt_answers to service_role;

-- Atomic paper creation. p_subjects is an array where each item contains:
-- subjectId, displayOrder, questionCount, questions[]. Every question contains
-- an answer-free studentSnapshot plus server-only answer data.
create or replace function public.create_exam_attempt(
  p_user_id uuid,
  p_exam_body_id uuid,
  p_blueprint_id uuid,
  p_exam_year integer,
  p_provider text,
  p_duration_seconds integer,
  p_subjects jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid;
  v_subject jsonb;
  v_question jsonb;
  v_attempt_subject_id uuid;
  v_subject_count integer;
  v_total_questions integer := 0;
  v_subject_position integer;
  v_overall_position integer := 0;
  v_expected_subject_count integer;
begin
  if jsonb_typeof(p_subjects) <> 'array' then
    raise exception 'Exam subject payload must be an array.';
  end if;

  v_subject_count := jsonb_array_length(p_subjects);
  select expected_subject_count into v_expected_subject_count
  from public.exam_blueprints
  where id = p_blueprint_id and exam_body_id = p_exam_body_id and is_active = true;

  if v_expected_subject_count is null then
    raise exception 'EXAM_BLUEPRINT_NOT_FOUND';
  end if;

  if v_subject_count <> v_expected_subject_count then
    raise exception 'EXAM_SUBJECT_COUNT_INVALID';
  end if;

  if p_duration_seconds <= 0 then
    raise exception 'Exam duration must be positive.';
  end if;

  for v_subject in select value from jsonb_array_elements(p_subjects)
  loop
    if jsonb_typeof(v_subject -> 'questions') <> 'array' then
      raise exception 'Every exam subject requires a questions array.';
    end if;
    if jsonb_array_length(v_subject -> 'questions') <> (v_subject ->> 'questionCount')::integer then
      raise exception 'EXAM_QUESTION_COUNT_INVALID';
    end if;
    v_total_questions := v_total_questions + jsonb_array_length(v_subject -> 'questions');
  end loop;

  if v_total_questions < 1 then
    raise exception 'Exam paper cannot be empty.';
  end if;

  insert into public.exam_attempts (
    user_id,
    exam_body_id,
    blueprint_id,
    exam_year,
    source_provider,
    status,
    duration_seconds,
    total_questions,
    started_at,
    expires_at
  ) values (
    p_user_id,
    p_exam_body_id,
    p_blueprint_id,
    p_exam_year,
    p_provider,
    'in_progress',
    p_duration_seconds,
    v_total_questions,
    now(),
    now() + make_interval(secs => p_duration_seconds)
  ) returning id into v_attempt_id;

  for v_subject in
    select value from jsonb_array_elements(p_subjects)
    order by (value ->> 'displayOrder')::integer
  loop
    insert into public.exam_attempt_subjects (
      attempt_id,
      subject_id,
      display_order,
      question_count
    ) values (
      v_attempt_id,
      (v_subject ->> 'subjectId')::uuid,
      (v_subject ->> 'displayOrder')::integer,
      (v_subject ->> 'questionCount')::integer
    ) returning id into v_attempt_subject_id;

    v_subject_position := 0;
    for v_question in select value from jsonb_array_elements(v_subject -> 'questions')
    loop
      v_subject_position := v_subject_position + 1;
      v_overall_position := v_overall_position + 1;

      if jsonb_typeof(v_question -> 'studentSnapshot') <> 'object' then
        raise exception 'Question % is missing a student snapshot.', v_overall_position;
      end if;
      if coalesce(v_question ->> 'correctOptionKey', '') not in ('A', 'B', 'C', 'D', 'E') then
        raise exception 'Question % has an invalid answer key.', v_overall_position;
      end if;

      insert into public.exam_attempt_questions (
        attempt_id,
        attempt_subject_id,
        subject_id,
        subject_position,
        overall_position,
        source_provider,
        source_question_id,
        internal_question_id,
        student_snapshot,
        correct_option_key,
        explanation
      ) values (
        v_attempt_id,
        v_attempt_subject_id,
        (v_subject ->> 'subjectId')::uuid,
        v_subject_position,
        v_overall_position,
        coalesce(nullif(v_question ->> 'sourceProvider', ''), p_provider),
        v_question ->> 'sourceQuestionId',
        nullif(v_question ->> 'internalQuestionId', '')::uuid,
        v_question -> 'studentSnapshot',
        v_question ->> 'correctOptionKey',
        nullif(v_question ->> 'explanation', '')
      );
    end loop;
  end loop;

  return v_attempt_id;
end;
$$;

-- One atomic write handles answer selection, clearing an answer, and flag state.
-- This keeps the client queue simple and lets rapid answer/flag changes converge.
create or replace function public.save_exam_response(
  p_user_id uuid,
  p_attempt_id uuid,
  p_attempt_question_id uuid,
  p_selected_option_key text,
  p_is_flagged boolean
)
returns table (
  selected_option_key text,
  is_flagged boolean,
  answered_count integer,
  flagged_count integer,
  total_questions integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_subject_id uuid;
  v_is_correct boolean;
begin
  if p_selected_option_key is not null and p_selected_option_key not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'Invalid answer option.';
  end if;

  select * into v_attempt
  from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'EXAM_ATTEMPT_NOT_FOUND';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'EXAM_ATTEMPT_NOT_ACTIVE';
  end if;

  if now() >= v_attempt.expires_at then
    raise exception 'EXAM_TIME_UP';
  end if;

  select * into v_question
  from public.exam_attempt_questions
  where id = p_attempt_question_id and attempt_id = p_attempt_id;

  if not found then
    raise exception 'EXAM_QUESTION_NOT_FOUND';
  end if;

  v_subject_id := v_question.subject_id;
  v_is_correct := case
    when p_selected_option_key is null then null
    else p_selected_option_key = v_question.correct_option_key
  end;

  insert into public.exam_attempt_answers (
    attempt_id,
    attempt_question_id,
    user_id,
    selected_option_key,
    is_flagged,
    is_correct,
    answered_at
  ) values (
    p_attempt_id,
    p_attempt_question_id,
    p_user_id,
    p_selected_option_key,
    p_is_flagged,
    v_is_correct,
    case when p_selected_option_key is null then null else now() end
  )
  on conflict (attempt_question_id) do update
  set selected_option_key = excluded.selected_option_key,
      is_flagged = excluded.is_flagged,
      is_correct = excluded.is_correct,
      answered_at = case
        when excluded.selected_option_key is null then null
        else coalesce(public.exam_attempt_answers.answered_at, now())
      end,
      updated_at = now();

  update public.exam_attempt_subjects s
  set answered_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = v_subject_id
          and a.selected_option_key is not null
      ),
      flagged_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = v_subject_id
          and a.is_flagged = true
      ),
      correct_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = v_subject_id
          and a.is_correct = true
      )
  where s.attempt_id = p_attempt_id and s.subject_id = v_subject_id;

  update public.exam_attempts a
  set answered_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.selected_option_key is not null
      ),
      flagged_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.is_flagged = true
      ),
      correct_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.is_correct = true
      )
  where a.id = p_attempt_id
  returning * into v_attempt;

  return query
  select p_selected_option_key, p_is_flagged, v_attempt.answered_count,
         v_attempt.flagged_count, v_attempt.total_questions, v_attempt.expires_at;
end;
$$;

-- Idempotent final submission. The server calculates final counters; correctness
-- remains server-side and will feed the dedicated results/analytics milestone.
create or replace function public.submit_exam_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_reason public.exam_submission_reason
)
returns table (
  attempt_id uuid,
  status public.exam_attempt_status,
  answered_count integer,
  flagged_count integer,
  total_questions integer,
  submitted_at timestamptz,
  submission_reason public.exam_submission_reason
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_reason public.exam_submission_reason := p_reason;
begin
  select * into v_attempt
  from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'EXAM_ATTEMPT_NOT_FOUND';
  end if;

  if v_attempt.status = 'submitted' then
    return query
    select v_attempt.id, v_attempt.status, v_attempt.answered_count,
           v_attempt.flagged_count, v_attempt.total_questions,
           v_attempt.submitted_at, v_attempt.submission_reason;
    return;
  end if;

  if v_attempt.status not in ('in_progress', 'expired') then
    raise exception 'EXAM_ATTEMPT_NOT_SUBMITTABLE';
  end if;

  -- Once authoritative time has elapsed, the reason is always time_expired.
  if now() >= v_attempt.expires_at then
    v_reason := 'time_expired';
  end if;

  update public.exam_attempt_subjects s
  set answered_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = s.subject_id
          and a.selected_option_key is not null
      ),
      flagged_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = s.subject_id
          and a.is_flagged = true
      ),
      correct_count = (
        select count(*)::integer
        from public.exam_attempt_answers a
        join public.exam_attempt_questions q on q.id = a.attempt_question_id
        where a.attempt_id = p_attempt_id
          and q.subject_id = s.subject_id
          and a.is_correct = true
      )
  where s.attempt_id = p_attempt_id;

  update public.exam_attempts a
  set status = 'submitted',
      submitted_at = coalesce(a.submitted_at, now()),
      submission_reason = v_reason,
      answered_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.selected_option_key is not null
      ),
      flagged_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.is_flagged = true
      ),
      correct_count = (
        select count(*)::integer from public.exam_attempt_answers x
        where x.attempt_id = a.id and x.is_correct = true
      )
  where a.id = p_attempt_id
  returning * into v_attempt;

  return query
  select v_attempt.id, v_attempt.status, v_attempt.answered_count,
         v_attempt.flagged_count, v_attempt.total_questions,
         v_attempt.submitted_at, v_attempt.submission_reason;
end;
$$;

revoke all on function public.create_exam_attempt(uuid, uuid, uuid, integer, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_exam_response(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.submit_exam_attempt(uuid, uuid, public.exam_submission_reason)
  from public, anon, authenticated;

grant execute on function public.create_exam_attempt(uuid, uuid, uuid, integer, text, integer, jsonb)
  to service_role;
grant execute on function public.save_exam_response(uuid, uuid, uuid, text, boolean)
  to service_role;
grant execute on function public.submit_exam_attempt(uuid, uuid, public.exam_submission_reason)
  to service_role;
