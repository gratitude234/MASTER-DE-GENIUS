-- MASTER@DE'GENIUS M2
-- Canonical exam -> subject -> topic -> question architecture.
-- Provider-owned question content is normalized behind the application provider layer.

create type public.question_difficulty as enum ('easy', 'medium', 'hard');
create type public.question_status as enum ('draft', 'pending_review', 'active', 'flagged', 'disabled');
create type public.question_kind as enum ('single_choice');
create type public.question_asset_kind as enum ('image', 'diagram', 'graph', 'table', 'map', 'illustration');

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  display_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, slug),
  unique (id, subject_id)
);

create table public.question_passages (
  id uuid primary key default gen_random_uuid(),
  exam_body_id uuid not null references public.exam_bodies(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text,
  body text not null check (char_length(trim(body)) > 0),
  source_provider text not null default 'internal',
  source_passage_id text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (exam_body_id, subject_id)
    references public.exam_subjects(exam_body_id, subject_id) on delete cascade,
  unique (id, subject_id)
);

create unique index question_passages_provider_external_id_idx
  on public.question_passages(source_provider, source_passage_id)
  where source_passage_id is not null;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_body_id uuid not null references public.exam_bodies(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid,
  passage_id uuid,
  year integer check (year is null or year between 1960 and 2100),
  question_kind public.question_kind not null default 'single_choice',
  question_text text not null check (char_length(trim(question_text)) > 0),
  correct_option_key text not null check (correct_option_key in ('A', 'B', 'C', 'D', 'E')),
  explanation text,
  difficulty public.question_difficulty,
  source_provider text not null default 'internal',
  source_question_id text,
  source_metadata jsonb not null default '{}'::jsonb,
  status public.question_status not null default 'draft',
  review_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (exam_body_id, subject_id)
    references public.exam_subjects(exam_body_id, subject_id) on delete restrict,
  foreign key (topic_id, subject_id)
    references public.topics(id, subject_id) on delete restrict,
  foreign key (passage_id, subject_id)
    references public.question_passages(id, subject_id) on delete restrict
);

create unique index questions_provider_external_id_idx
  on public.questions(source_provider, source_question_id)
  where source_question_id is not null;

create index questions_active_lookup_idx
  on public.questions(exam_body_id, subject_id, topic_id, year, difficulty)
  where status = 'active';

create index questions_subject_status_idx
  on public.questions(subject_id, status);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  option_key text not null check (option_key in ('A', 'B', 'C', 'D', 'E')),
  option_text text not null check (char_length(trim(option_text)) > 0),
  display_order integer not null check (display_order between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, option_key),
  unique (question_id, display_order)
);

create index question_options_question_id_idx on public.question_options(question_id);

create table public.question_assets (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  kind public.question_asset_kind not null,
  url text not null check (char_length(trim(url)) > 0),
  alt_text text,
  caption text,
  display_order integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index question_assets_question_id_idx on public.question_assets(question_id, display_order);

-- Provider mappings keep API-specific identifiers out of the product domain.
create table public.question_provider_subject_mappings (
  provider text not null,
  exam_body_id uuid not null references public.exam_bodies(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  provider_exam_code text,
  provider_subject_code text not null,
  provider_subject_name text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, exam_body_id, subject_id),
  foreign key (exam_body_id, subject_id)
    references public.exam_subjects(exam_body_id, subject_id) on delete cascade
);

create table public.question_provider_topic_mappings (
  provider text not null,
  topic_id uuid not null references public.topics(id) on delete cascade,
  provider_topic_code text,
  provider_topic_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, topic_id)
);

create trigger topics_set_updated_at
before update on public.topics
for each row execute function public.set_updated_at();

create trigger passages_set_updated_at
before update on public.question_passages
for each row execute function public.set_updated_at();

create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

create trigger question_options_set_updated_at
before update on public.question_options
for each row execute function public.set_updated_at();

create trigger provider_subject_mappings_set_updated_at
before update on public.question_provider_subject_mappings
for each row execute function public.set_updated_at();

create trigger provider_topic_mappings_set_updated_at
before update on public.question_provider_topic_mappings
for each row execute function public.set_updated_at();

-- Active questions are immutable at the option level. Editors must move the
-- question back to draft/pending_review before changing its answer choices.
create or replace function public.guard_active_question_child_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_question_id uuid;
  v_status public.question_status;
begin
  if tg_op = 'DELETE' then
    v_question_id := old.question_id;
  else
    v_question_id := new.question_id;
  end if;

  select status into v_status from public.questions where id = v_question_id;
  if v_status = 'active' then
    raise exception 'Active question content is immutable. Move the question out of active status first.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger question_options_guard_active_insert
before insert on public.question_options
for each row execute function public.guard_active_question_child_mutation();

create trigger question_options_guard_active_update
before update on public.question_options
for each row execute function public.guard_active_question_child_mutation();

create trigger question_options_guard_active_delete
before delete on public.question_options
for each row execute function public.guard_active_question_child_mutation();

create trigger question_assets_guard_active_insert
before insert on public.question_assets
for each row execute function public.guard_active_question_child_mutation();

create trigger question_assets_guard_active_update
before update on public.question_assets
for each row execute function public.guard_active_question_child_mutation();

create trigger question_assets_guard_active_delete
before delete on public.question_assets
for each row execute function public.guard_active_question_child_mutation();

create or replace function public.guard_active_passage_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_passage_id uuid;
begin
  if tg_op = 'DELETE' then
    v_passage_id := old.id;
  else
    v_passage_id := new.id;
  end if;
  if exists (
    select 1 from public.questions q
    where q.passage_id = v_passage_id and q.status = 'active'
  ) then
    raise exception 'A passage used by active questions is immutable. Move the dependent questions out of active status first.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger passages_guard_active_update
before update on public.question_passages
for each row execute function public.guard_active_passage_mutation();

create trigger passages_guard_active_delete
before delete on public.question_passages
for each row execute function public.guard_active_passage_mutation();

-- A question is activated only after its option set is valid. This keeps the
-- answer key consistent without exposing it through student-facing queries.
create or replace function public.validate_question_activation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_option_count integer;
  v_correct_exists boolean;
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    raise exception 'Create the question as draft/pending_review, add options, then activate it.';
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'active' and (
    old.question_text is distinct from new.question_text
    or old.correct_option_key is distinct from new.correct_option_key
    or old.subject_id is distinct from new.subject_id
    or old.topic_id is distinct from new.topic_id
    or old.passage_id is distinct from new.passage_id
    or old.question_kind is distinct from new.question_kind
  ) then
    raise exception 'Active question content is immutable. Move the question out of active status first.';
  end if;

  if tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' then
    select count(*) into v_option_count
    from public.question_options
    where question_id = new.id;

    if v_option_count < 2 then
      raise exception 'An active question must have at least two options.';
    end if;

    select exists (
      select 1 from public.question_options
      where question_id = new.id and option_key = new.correct_option_key
    ) into v_correct_exists;

    if not v_correct_exists then
      raise exception 'The correct option key must reference an existing option.';
    end if;
  end if;

  return new;
end;
$$;

create trigger questions_validate_activation_insert
before insert on public.questions
for each row execute function public.validate_question_activation();

create trigger questions_validate_activation_update
before update of status, question_text, correct_option_key, subject_id, topic_id, passage_id, question_kind
on public.questions
for each row execute function public.validate_question_activation();

-- Students may browse the active topic taxonomy, but raw question/answer rows
-- intentionally have no authenticated SELECT policy. Question delivery goes
-- through the server-side provider/service layer so answer keys never reach the browser.
alter table public.topics enable row level security;
alter table public.question_passages enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.question_assets enable row level security;
alter table public.question_provider_subject_mappings enable row level security;
alter table public.question_provider_topic_mappings enable row level security;

create policy "topics_read_active"
on public.topics for select
to authenticated
using (
  is_active = true
  and exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.is_active = true
  )
);

-- Safe aggregate for practice setup. It exposes availability counts only,
-- never question text, answer keys, explanations, or provider metadata.
create or replace function public.question_catalog_counts(p_exam_code text default null)
returns table (
  exam_body_id uuid,
  subject_id uuid,
  topic_id uuid,
  year integer,
  question_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select q.exam_body_id, q.subject_id, q.topic_id, q.year, count(*)::bigint
  from public.questions q
  join public.exam_bodies eb on eb.id = q.exam_body_id
  where q.status = 'active'
    and eb.is_active = true
    and (p_exam_code is null or eb.code = p_exam_code)
  group by q.exam_body_id, q.subject_id, q.topic_id, q.year;
end;
$$;

revoke all on function public.question_catalog_counts(text) from public;
grant execute on function public.question_catalog_counts(text) to authenticated;
