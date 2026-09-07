-- Provider usage ledger for question API economics and reliability.
-- Deliberately contains no user id, API key, question text, answers, or other PII.
create table public.external_api_usage (
  id bigint generated always as identity primary key,
  provider text not null check (char_length(trim(provider)) > 0),
  endpoint text not null check (char_length(trim(endpoint)) > 0),
  request_type text not null check (request_type in ('practice', 'mock', 'probe', 'other')),
  exam_body text,
  subject text,
  requested_question_count integer check (requested_question_count is null or requested_question_count >= 0),
  question_count integer not null default 0 check (question_count >= 0),
  http_status integer check (http_status is null or http_status between 100 and 599),
  outcome text not null check (outcome in ('ok', 'retry', 'failed')),
  duration_ms integer not null check (duration_ms >= 0),
  credits_used integer check (credits_used is null or credits_used >= 0),
  credits_remaining integer check (credits_remaining is null or credits_remaining >= 0),
  provider_request_id text,
  created_at timestamptz not null default now()
);

create index external_api_usage_created_at_idx
  on public.external_api_usage(created_at desc);

create index external_api_usage_provider_feature_idx
  on public.external_api_usage(provider, request_type, created_at desc);

alter table public.external_api_usage enable row level security;

-- The Next.js server writes through its service-role client. Browsers have no
-- direct access, even when the public schema is exposed through the Data API.
revoke all on table public.external_api_usage from public, anon, authenticated;
revoke all on sequence public.external_api_usage_id_seq from public, anon, authenticated;
grant select, insert on table public.external_api_usage to service_role;
grant usage, select on sequence public.external_api_usage_id_seq to service_role;

comment on table public.external_api_usage is
  'Server-only external provider usage ledger. Never store secrets, question content, answers, or student PII.';
