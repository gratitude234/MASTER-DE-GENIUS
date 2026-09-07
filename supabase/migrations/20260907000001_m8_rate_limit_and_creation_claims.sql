-- MASTER@DE'GENIUS M8 (Phase 1)
-- Distributed, atomic protection for the two endpoints that spend external
-- question-provider quota, plus duplicate-creation suppression.
--
-- Both mechanisms live in Postgres deliberately. The application runs on
-- serverless instances with no shared memory: an in-process counter would reset
-- on every cold start and would be enforced independently per instance, which is
-- not rate limiting at all. Postgres is the only state every instance shares.

-- ───────────────────────────────────────────────────────── rate limiting

create table public.rate_limit_buckets (
  bucket_key text primary key,
  tokens     numeric not null check (tokens >= 0),
  updated_at timestamptz not null default now()
);

-- Supports periodic purging of buckets nobody has touched in a long while.
create index rate_limit_buckets_updated_at_idx
  on public.rate_limit_buckets (updated_at);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

/*
 * Token bucket, consumed atomically.
 *
 * `capacity` is the burst a student may use at once; `refill_per_second` is the
 * sustained rate. Correctness under concurrency comes from the SELECT ... FOR
 * UPDATE below: every concurrent caller for the same key serialises on that row,
 * so two simultaneous requests can never both spend the last token.
 *
 * A rejected attempt still writes back the refilled balance and advances the
 * clock. That is deliberate — it records time that has genuinely passed without
 * granting anything, so hammering the endpoint cannot stop the bucket refilling
 * (and cannot extend the caller's own lockout either).
 */
create or replace function public.consume_rate_limit(
  p_key               text,
  p_capacity          numeric,
  p_refill_per_second numeric,
  p_cost              numeric default 1
)
returns table (allowed boolean, remaining numeric, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_tokens  numeric;
  v_updated timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'RATE_LIMIT_KEY_REQUIRED';
  end if;
  if p_capacity <= 0 or p_refill_per_second <= 0 or p_cost <= 0 or p_cost > p_capacity then
    raise exception 'RATE_LIMIT_PARAMS_INVALID';
  end if;

  -- Race-free creation: a concurrent caller that wins the insert is simply
  -- picked up by the locking select below.
  insert into public.rate_limit_buckets (bucket_key, tokens, updated_at)
  values (p_key, p_capacity, v_now)
  on conflict (bucket_key) do nothing;

  select b.tokens, b.updated_at into v_tokens, v_updated
  from public.rate_limit_buckets b
  where b.bucket_key = p_key
  for update;

  v_tokens := least(
    p_capacity,
    v_tokens + (extract(epoch from (v_now - v_updated)) * p_refill_per_second)
  );

  if v_tokens >= p_cost then
    update public.rate_limit_buckets b
    set tokens = v_tokens - p_cost, updated_at = v_now
    where b.bucket_key = p_key;

    return query select true, round(v_tokens - p_cost, 4), 0;
    return;
  end if;

  update public.rate_limit_buckets b
  set tokens = v_tokens, updated_at = v_now
  where b.bucket_key = p_key;

  return query select
    false,
    round(v_tokens, 4),
    greatest(1, ceil((p_cost - v_tokens) / p_refill_per_second))::integer;
end;
$$;

revoke all on function public.consume_rate_limit(text, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, numeric, numeric, numeric)
  to service_role;

-- ──────────────────────────────────────────── duplicate creation suppression

/*
 * A session is only created after the provider has been asked for questions,
 * and that call can take seconds. Two rapid submits, a retried POST, or two
 * open tabs can therefore all pass any "is one already running?" check before
 * the first one finishes — and each would spend provider quota.
 *
 * A claim row is taken before the provider is contacted and released when
 * creation settles, so the second request is answered from the first one's
 * result instead of buying a second batch of questions.
 *
 * session_id intentionally carries no foreign key: it addresses either
 * practice_sessions or exam_attempts depending on `kind`.
 */
create table public.session_creation_claims (
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('practice', 'exam')),
  fingerprint text not null check (length(fingerprint) between 1 and 200),
  session_id  uuid,
  claimed_at  timestamptz not null default now(),
  primary key (user_id, kind, fingerprint)
);

create index session_creation_claims_claimed_at_idx
  on public.session_creation_claims (claimed_at);

alter table public.session_creation_claims enable row level security;
revoke all on public.session_creation_claims from public, anon, authenticated;
grant select, insert, update, delete on public.session_creation_claims to service_role;

/*
 * Outcomes:
 *   claimed     -> the caller owns this creation and must settle it
 *   duplicate   -> an identical request just created `session_id`; reuse it
 *   in_progress -> an identical request is still building; do not start another
 *
 * Two separate windows, because they answer different questions:
 *   p_inflight_seconds  how long a creation may run before it is presumed dead
 *   p_duplicate_seconds how long after success an identical request is treated
 *                       as an accidental double-submit rather than a deliberate
 *                       new session. Keep it short: a student who finishes a
 *                       10-question set and starts another identical one is
 *                       doing something legitimate and must not be handed the
 *                       session they just completed.
 */
create or replace function public.claim_session_creation(
  p_user_id           uuid,
  p_kind              text,
  p_fingerprint       text,
  p_inflight_seconds  integer default 90,
  p_duplicate_seconds integer default 10
)
returns table (outcome text, session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := clock_timestamp();
  v_existing public.session_creation_claims%rowtype;
  v_age      numeric;
begin
  if p_kind not in ('practice', 'exam') then
    raise exception 'INVALID_SESSION_KIND';
  end if;

  insert into public.session_creation_claims (user_id, kind, fingerprint, session_id, claimed_at)
  values (p_user_id, p_kind, p_fingerprint, null, v_now)
  on conflict (user_id, kind, fingerprint) do nothing;

  select * into v_existing
  from public.session_creation_claims c
  where c.user_id = p_user_id and c.kind = p_kind and c.fingerprint = p_fingerprint
  for update;

  -- The row this caller just inserted.
  if v_existing.claimed_at = v_now and v_existing.session_id is null then
    return query select 'claimed'::text, null::uuid;
    return;
  end if;

  v_age := extract(epoch from (v_now - v_existing.claimed_at));

  if v_existing.session_id is not null and v_age < p_duplicate_seconds then
    return query select 'duplicate'::text, v_existing.session_id;
    return;
  end if;

  if v_existing.session_id is null and v_age < p_inflight_seconds then
    return query select 'in_progress'::text, null::uuid;
    return;
  end if;

  -- Stale: the previous attempt finished long enough ago, or died mid-flight.
  update public.session_creation_claims c
  set session_id = null, claimed_at = v_now
  where c.user_id = p_user_id and c.kind = p_kind and c.fingerprint = p_fingerprint;

  return query select 'claimed'::text, null::uuid;
end;
$$;

/*
 * Records the created session against the claim, or releases the claim
 * entirely when p_session_id is null so a failed attempt can be retried at once
 * rather than waiting out the in-flight window.
 */
create or replace function public.settle_session_creation(
  p_user_id     uuid,
  p_kind        text,
  p_fingerprint text,
  p_session_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null then
    delete from public.session_creation_claims c
    where c.user_id = p_user_id and c.kind = p_kind and c.fingerprint = p_fingerprint;
    return;
  end if;

  update public.session_creation_claims c
  set session_id = p_session_id, claimed_at = clock_timestamp()
  where c.user_id = p_user_id and c.kind = p_kind and c.fingerprint = p_fingerprint;
end;
$$;

revoke all on function public.claim_session_creation(uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_session_creation(uuid, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_session_creation(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.settle_session_creation(uuid, text, text, uuid)
  to service_role;
