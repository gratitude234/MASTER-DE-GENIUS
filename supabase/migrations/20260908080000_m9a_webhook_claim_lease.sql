-- MASTER@DE'GENIUS M9a — repair: the webhook idempotency claim becomes a lease.
--
-- Why this exists.
--
-- The M9 migration was applied to at least one environment from a copy taken
-- before its webhook idempotency gate was corrected. That earlier shape marked
-- a delivery as handled the moment it arrived, whatever happened next. So a
-- delivery that failed for a retryable reason — Paystack's verify API briefly
-- unreachable — was answered with a non-2xx asking for a retry, and that retry
-- was then dismissed as a duplicate. One transient outage meant a student paid
-- and never received access.
--
-- The corrected shape treats the claim as a lease: it blocks future deliveries
-- only once `processed_at` records a terminal decision, and
-- `release_billing_webhook_event` hands an unfinished claim back.
--
-- Every statement below is safe on either shape. An environment that already
-- has the corrected M9 is left exactly as it is, so this is a no-op there and a
-- repair where it is needed.

-- Existing rows take the current timestamp: anything already decided is
-- terminal on `processed_at` regardless, and anything still unfinished becomes
-- immediately re-claimable, which is what it should have been all along.
alter table public.billing_webhook_events
  add column if not exists claim_expires_at timestamptz not null default now();

-- `create or replace function` cannot change an argument list — it would add a
-- second overload and leave both callable, so PostgREST could resolve either.
-- The superseded four-argument form is dropped explicitly.
drop function if exists public.record_billing_webhook_event(text, text, text, text);

create or replace function public.record_billing_webhook_event(
  p_provider      text,
  p_event_id      text,
  p_event_type    text,
  p_reference     text default null,
  p_lease_seconds integer default 300
)
returns table (is_new boolean, event_row_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_id  bigint;
  v_row public.billing_webhook_events%rowtype;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 3600 then
    raise exception 'BILLING_WEBHOOK_LEASE_INVALID';
  end if;

  insert into public.billing_webhook_events (
    provider, event_id, event_type, reference, outcome, claim_expires_at, received_at
  ) values (
    p_provider, p_event_id, p_event_type, p_reference, 'received',
    v_now + make_interval(secs => p_lease_seconds), v_now
  )
  on conflict (provider, event_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select true, v_id;
    return;
  end if;

  select * into v_row
  from public.billing_webhook_events e
  where e.provider = p_provider and e.event_id = p_event_id
  for update;

  -- A delivery that reached a decision is finished, for good.
  if v_row.processed_at is not null then
    return query select false, v_row.id;
    return;
  end if;

  -- Unfinished, but another instance is still working on it.
  if v_row.claim_expires_at > v_now then
    return query select false, v_row.id;
    return;
  end if;

  -- Unfinished and the lease has lapsed: the previous attempt died, or asked
  -- to be retried. Re-arm the claim so this delivery can run.
  update public.billing_webhook_events e
  set event_type       = p_event_type,
      reference        = coalesce(p_reference, e.reference),
      outcome          = 'received',
      detail           = null,
      claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
      received_at      = v_now
  where e.id = v_row.id;

  return query select true, v_row.id;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_event_row_id bigint,
  p_detail       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.billing_webhook_events e
  set outcome          = 'received',
      detail           = left(p_detail, 300),
      claim_expires_at = clock_timestamp()
  where e.id = p_event_row_id and e.processed_at is null;
end;
$$;
revoke all on function public.record_billing_webhook_event(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(bigint, text) from public, anon, authenticated;

grant execute on function public.record_billing_webhook_event(text, text, text, text, integer) to service_role;
grant execute on function public.release_billing_webhook_event(bigint, text) to service_role;

comment on column public.billing_webhook_events.claim_expires_at is
  'Lease on an unfinished delivery. Only processed_at makes a claim permanent, so a retryable failure can still be retried.';
