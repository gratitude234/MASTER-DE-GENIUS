-- MASTER@DE'GENIUS M3
-- Persisted practice sessions, answer autosave, feedback, timed-mode enforcement,
-- and atomic session completion.

create type public.practice_mode as enum ('practice', 'timed');
create type public.practice_session_status as enum ('in_progress', 'completed', 'expired', 'abandoned');

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_body_id uuid not null references public.exam_bodies(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  topic_id uuid references public.topics(id) on delete restrict,
  mode public.practice_mode not null,
  difficulty public.question_difficulty,
  year_filter integer check (year_filter is null or year_filter between 1960 and 2100),
  requested_count integer not null check (requested_count between 1 and 100),
  question_count integer not null check (question_count between 1 and 100),
  source_provider text not null,
  status public.practice_session_status not null default 'in_progress',
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  answered_count integer not null default 0 check (answered_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (exam_body_id, subject_id)
    references public.exam_subjects(exam_body_id, subject_id) on delete restrict,
  foreign key (topic_id, subject_id)
    references public.topics(id, subject_id) on delete restrict,
  check (
    (mode = 'timed' and duration_seconds is not null and expires_at is not null)
    or
    (mode = 'practice' and duration_seconds is null and expires_at is null)
  ),
  check (answered_count <= question_count),
  check (correct_count <= answered_count)
);

create index practice_sessions_user_created_idx
  on public.practice_sessions(user_id, created_at desc);
create index practice_sessions_user_status_idx
  on public.practice_sessions(user_id, status, updated_at desc);

create table public.practice_session_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  source_provider text not null,
  source_question_id text not null,
  internal_question_id uuid references public.questions(id) on delete set null,
  student_snapshot jsonb not null check (jsonb_typeof(student_snapshot) = 'object'),
  correct_option_key text not null check (correct_option_key in ('A', 'B', 'C', 'D', 'E')),
  explanation text,
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create index practice_session_questions_session_idx
  on public.practice_session_questions(session_id, position);

create table public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  session_question_id uuid not null references public.practice_session_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_option_key text not null check (selected_option_key in ('A', 'B', 'C', 'D', 'E')),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_question_id),
  unique (session_id, session_question_id)
);

create index practice_answers_session_idx
  on public.practice_answers(session_id, answered_at);
create index practice_answers_user_idx
  on public.practice_answers(user_id, updated_at desc);

create trigger practice_sessions_set_updated_at
before update on public.practice_sessions
for each row execute function public.set_updated_at();

create trigger practice_answers_set_updated_at
before update on public.practice_answers
for each row execute function public.set_updated_at();

-- These tables intentionally have no browser-facing policies. Practice session
-- snapshots contain assessment-sensitive fields in separate columns, so every
-- read/write flows through authenticated server endpoints and the service-role
-- boundary.
alter table public.practice_sessions enable row level security;
alter table public.practice_session_questions enable row level security;
alter table public.practice_answers enable row level security;

revoke all on public.practice_sessions from anon, authenticated;
revoke all on public.practice_session_questions from anon, authenticated;
revoke all on public.practice_answers from anon, authenticated;

grant select, insert, update, delete on public.practice_sessions to service_role;
grant select, insert, update, delete on public.practice_session_questions to service_role;
grant select, insert, update, delete on public.practice_answers to service_role;

-- Atomic session creation. The caller supplies answer-free student snapshots
-- plus the server-only key/explanation fields in one JSON payload.
create or replace function public.create_practice_session(
  p_user_id uuid,
  p_exam_body_id uuid,
  p_subject_id uuid,
  p_topic_id uuid,
  p_mode public.practice_mode,
  p_difficulty public.question_difficulty,
  p_year_filter integer,
  p_requested_count integer,
  p_provider text,
  p_duration_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_count integer;
  v_item jsonb;
  v_position integer := 0;
begin
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Practice questions payload must be an array.';
  end if;

  v_count := jsonb_array_length(p_questions);
  if v_count < 1 or v_count > 100 then
    raise exception 'Practice session must contain between 1 and 100 questions.';
  end if;

  if p_requested_count < 1 or p_requested_count > 100 then
    raise exception 'Requested question count is invalid.';
  end if;

  if p_mode = 'timed' and (p_duration_seconds is null or p_duration_seconds <= 0) then
    raise exception 'Timed practice requires a positive duration.';
  end if;

  insert into public.practice_sessions (
    user_id,
    exam_body_id,
    subject_id,
    topic_id,
    mode,
    difficulty,
    year_filter,
    requested_count,
    question_count,
    source_provider,
    duration_seconds,
    expires_at
  ) values (
    p_user_id,
    p_exam_body_id,
    p_subject_id,
    p_topic_id,
    p_mode,
    p_difficulty,
    p_year_filter,
    p_requested_count,
    v_count,
    p_provider,
    case when p_mode = 'timed' then p_duration_seconds else null end,
    case when p_mode = 'timed' then now() + make_interval(secs => p_duration_seconds) else null end
  ) returning id into v_session_id;

  for v_item in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;

    if jsonb_typeof(v_item -> 'studentSnapshot') <> 'object' then
      raise exception 'Question % is missing a valid student snapshot.', v_position;
    end if;

    if coalesce(v_item ->> 'correctOptionKey', '') not in ('A', 'B', 'C', 'D', 'E') then
      raise exception 'Question % has an invalid answer key.', v_position;
    end if;

    insert into public.practice_session_questions (
      session_id,
      position,
      source_provider,
      source_question_id,
      internal_question_id,
      student_snapshot,
      correct_option_key,
      explanation
    ) values (
      v_session_id,
      v_position,
      coalesce(nullif(v_item ->> 'sourceProvider', ''), p_provider),
      v_item ->> 'sourceQuestionId',
      nullif(v_item ->> 'internalQuestionId', '')::uuid,
      v_item -> 'studentSnapshot',
      v_item ->> 'correctOptionKey',
      nullif(v_item ->> 'explanation', '')
    );
  end loop;

  return v_session_id;
end;
$$;

-- Saves one answer and evaluates it server-side. Practice mode locks an answer
-- after first feedback; timed mode permits changing selections until completion.
create or replace function public.save_practice_answer(
  p_user_id uuid,
  p_session_id uuid,
  p_session_question_id uuid,
  p_selected_option_key text
)
returns table (
  selected_option_key text,
  is_correct boolean,
  correct_option_key text,
  explanation text,
  answered_count integer,
  question_count integer,
  mode public.practice_mode,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.practice_sessions%rowtype;
  v_question public.practice_session_questions%rowtype;
  v_existing public.practice_answers%rowtype;
  v_is_correct boolean;
begin
  if p_selected_option_key not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'Invalid answer option.';
  end if;

  select * into v_session
  from public.practice_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'PRACTICE_SESSION_NOT_FOUND';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'PRACTICE_SESSION_NOT_ACTIVE';
  end if;

  if v_session.mode = 'timed' and v_session.expires_at is not null and now() >= v_session.expires_at then
    raise exception 'PRACTICE_SESSION_TIME_UP';
  end if;

  select * into v_question
  from public.practice_session_questions
  where id = p_session_question_id and session_id = p_session_id;

  if not found then
    raise exception 'PRACTICE_QUESTION_NOT_FOUND';
  end if;

  select * into v_existing
  from public.practice_answers
  where session_question_id = p_session_question_id;

  if found and v_session.mode = 'practice' then
    return query
    select
      v_existing.selected_option_key,
      v_existing.is_correct,
      v_question.correct_option_key,
      v_question.explanation,
      v_session.answered_count,
      v_session.question_count,
      v_session.mode,
      v_session.expires_at;
    return;
  end if;

  v_is_correct := p_selected_option_key = v_question.correct_option_key;

  insert into public.practice_answers (
    session_id,
    session_question_id,
    user_id,
    selected_option_key,
    is_correct,
    answered_at
  ) values (
    p_session_id,
    p_session_question_id,
    p_user_id,
    p_selected_option_key,
    v_is_correct,
    now()
  )
  on conflict (session_question_id) do update
  set selected_option_key = excluded.selected_option_key,
      is_correct = excluded.is_correct,
      answered_at = now(),
      updated_at = now();

  update public.practice_sessions s
  set answered_count = (
        select count(*)::integer from public.practice_answers a where a.session_id = s.id
      ),
      correct_count = (
        select count(*)::integer from public.practice_answers a where a.session_id = s.id and a.is_correct
      )
  where s.id = p_session_id
  returning * into v_session;

  return query
  select
    p_selected_option_key,
    v_is_correct,
    v_question.correct_option_key,
    v_question.explanation,
    v_session.answered_count,
    v_session.question_count,
    v_session.mode,
    v_session.expires_at;
end;
$$;

create or replace function public.complete_practice_session(
  p_user_id uuid,
  p_session_id uuid
)
returns table (
  session_id uuid,
  status public.practice_session_status,
  answered_count integer,
  correct_count integer,
  question_count integer,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.practice_sessions%rowtype;
begin
  select * into v_session
  from public.practice_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'PRACTICE_SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    return query
    select v_session.id, v_session.status, v_session.answered_count,
           v_session.correct_count, v_session.question_count, v_session.completed_at;
    return;
  end if;

  if v_session.status not in ('in_progress', 'expired') then
    raise exception 'PRACTICE_SESSION_NOT_COMPLETABLE';
  end if;

  update public.practice_sessions s
  set status = 'completed',
      completed_at = coalesce(s.completed_at, now()),
      answered_count = (
        select count(*)::integer from public.practice_answers a where a.session_id = s.id
      ),
      correct_count = (
        select count(*)::integer from public.practice_answers a where a.session_id = s.id and a.is_correct
      )
  where s.id = p_session_id
  returning * into v_session;

  return query
  select v_session.id, v_session.status, v_session.answered_count,
         v_session.correct_count, v_session.question_count, v_session.completed_at;
end;
$$;

revoke all on function public.create_practice_session(
  uuid, uuid, uuid, uuid, public.practice_mode, public.question_difficulty,
  integer, integer, text, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.save_practice_answer(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_practice_session(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_practice_session(
  uuid, uuid, uuid, uuid, public.practice_mode, public.question_difficulty,
  integer, integer, text, integer, jsonb
) to service_role;
grant execute on function public.save_practice_answer(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.complete_practice_session(uuid, uuid)
  to service_role;
