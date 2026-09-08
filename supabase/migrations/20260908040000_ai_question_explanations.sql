-- Secure, distributed AI explanation generation.
-- Question text and answer keys never enter these operational tables. Shared
-- cache entries are addressed only by SHA-256 fingerprints and expire after
-- 48 hours while provider-retention terms are being clarified.

create table public.ai_explanation_cache (
  cache_key text primary key check (char_length(cache_key) = 64),
  question_fingerprint text not null check (char_length(question_fingerprint) = 64),
  explanation_type text not null check (explanation_type in ('explain_better', 'why_wrong')),
  selected_option_key text,
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 100),
  status text not null check (status in ('pending', 'completed')),
  content jsonb check (content is null or jsonb_typeof(content) = 'object'),
  lease_expires_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (explanation_type = 'explain_better' and selected_option_key is null)
    or
    (explanation_type = 'why_wrong' and selected_option_key in ('A', 'B', 'C', 'D', 'E'))
  )
);

create index ai_explanation_cache_expires_at_idx
  on public.ai_explanation_cache (expires_at);

create table public.ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (timezone('utc', now()))::date,
  feature text not null check (feature = 'question_explanation'),
  generation_count integer not null default 0 check (generation_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature)
);

create index ai_daily_usage_date_idx on public.ai_daily_usage (usage_date);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature = 'question_explanation'),
  explanation_type text not null check (explanation_type in ('explain_better', 'why_wrong')),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cache_hit boolean not null default false,
  duration_ms integer not null check (duration_ms >= 0),
  status text not null check (status in ('ok', 'failed')),
  error_category text,
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  created_at timestamptz not null default now()
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_feature_created_idx on public.ai_usage (feature, created_at desc);

alter table public.ai_explanation_cache enable row level security;
alter table public.ai_daily_usage enable row level security;
alter table public.ai_usage enable row level security;

revoke all on table public.ai_explanation_cache from public, anon, authenticated;
revoke all on table public.ai_daily_usage from public, anon, authenticated;
revoke all on table public.ai_usage from public, anon, authenticated;
revoke all on sequence public.ai_usage_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.ai_explanation_cache to service_role;
grant select, insert, update, delete on table public.ai_daily_usage to service_role;
grant select, insert on table public.ai_usage to service_role;
grant usage, select on sequence public.ai_usage_id_seq to service_role;

create or replace function public.claim_ai_explanation(
  p_cache_key text,
  p_question_fingerprint text,
  p_explanation_type text,
  p_selected_option_key text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_lease_seconds integer default 30,
  p_ttl_seconds integer default 172800
)
returns table (outcome text, content jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_inserted boolean := false;
  v_row public.ai_explanation_cache%rowtype;
begin
  if char_length(p_cache_key) <> 64 or char_length(p_question_fingerprint) <> 64 then
    raise exception 'AI_CACHE_KEY_INVALID';
  end if;
  if p_explanation_type not in ('explain_better', 'why_wrong')
     or (p_explanation_type = 'explain_better' and p_selected_option_key is not null)
     or (p_explanation_type = 'why_wrong' and p_selected_option_key not in ('A', 'B', 'C', 'D', 'E'))
     or p_lease_seconds < 5 or p_lease_seconds > 120
     or p_ttl_seconds < 60 or p_ttl_seconds > 172800 then
    raise exception 'AI_CLAIM_PARAMS_INVALID';
  end if;

  insert into public.ai_explanation_cache (
    cache_key, question_fingerprint, explanation_type, selected_option_key,
    prompt_version, provider, model, status, content, lease_expires_at, expires_at
  ) values (
    p_cache_key, p_question_fingerprint, p_explanation_type, p_selected_option_key,
    p_prompt_version, p_provider, p_model, 'pending', null,
    v_now + make_interval(secs => p_lease_seconds),
    v_now + make_interval(secs => p_ttl_seconds)
  )
  on conflict (cache_key) do nothing
  returning true into v_inserted;

  if v_inserted then
    return query select 'claimed'::text, null::jsonb;
    return;
  end if;

  select * into v_row
  from public.ai_explanation_cache c
  where c.cache_key = p_cache_key
  for update;

  if v_row.status = 'completed' and v_row.expires_at > v_now and v_row.content is not null then
    return query select 'completed'::text, v_row.content;
    return;
  end if;

  if v_row.status = 'pending' and v_row.lease_expires_at > v_now then
    return query select 'in_progress'::text, null::jsonb;
    return;
  end if;

  update public.ai_explanation_cache c
  set question_fingerprint = p_question_fingerprint,
      explanation_type = p_explanation_type,
      selected_option_key = p_selected_option_key,
      prompt_version = p_prompt_version,
      provider = p_provider,
      model = p_model,
      status = 'pending',
      content = null,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      expires_at = v_now + make_interval(secs => p_ttl_seconds),
      updated_at = v_now
  where c.cache_key = p_cache_key;

  return query select 'claimed'::text, null::jsonb;
end;
$$;

create or replace function public.settle_ai_explanation(
  p_cache_key text,
  p_content jsonb,
  p_ttl_seconds integer default 172800
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_content) <> 'object' or p_ttl_seconds < 60 or p_ttl_seconds > 172800 then
    raise exception 'AI_EXPLANATION_CONTENT_INVALID';
  end if;

  update public.ai_explanation_cache c
  set status = 'completed',
      content = p_content,
      lease_expires_at = clock_timestamp(),
      expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
      updated_at = clock_timestamp()
  where c.cache_key = p_cache_key and c.status = 'pending';

  if not found then raise exception 'AI_EXPLANATION_CLAIM_NOT_FOUND'; end if;
end;
$$;

create or replace function public.release_ai_explanation_claim(p_cache_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ai_explanation_cache c
  where c.cache_key = p_cache_key and c.status = 'pending';
$$;

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
  v_date date := (timezone('utc', clock_timestamp()))::date;
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

revoke all on function public.claim_ai_explanation(text, text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_ai_explanation(text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.release_ai_explanation_claim(text)
  from public, anon, authenticated;
revoke all on function public.consume_ai_daily_quota(uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_ai_explanation(text, text, text, text, text, text, text, integer, integer)
  to service_role;
grant execute on function public.settle_ai_explanation(text, jsonb, integer)
  to service_role;
grant execute on function public.release_ai_explanation_claim(text)
  to service_role;
grant execute on function public.consume_ai_daily_quota(uuid, text, integer)
  to service_role;

comment on table public.ai_explanation_cache is
  '48-hour hashed cache for structured question explanations. Contains no question text or answer keys.';
comment on table public.ai_usage is
  'Server-only Gemini usage ledger. Never store API keys, prompts, question text, or answers.';
