-- MASTER@DE'GENIUS M9 — Free/Master monetization authority.
--
-- Everything a payment is allowed to change lives behind SECURITY DEFINER
-- functions that only service_role may execute. A browser can read its own
-- entitlement and its own safe payment rows and nothing else: it can never
-- write a payment, invent an expiry, or grant itself a tier.
--
-- Paid access is resolved from `user_entitlements`, never from auth metadata.
-- `raw_user_meta_data` is editable by the account holder, so a tier stored
-- there would be a self-service upgrade button.

-- ─────────────────────────────────────────────────── authoritative catalogue

/*
 * The price and duration the server charges. The client submits a slug; this
 * table decides what that slug costs. `apply_successful_payment` re-checks the
 * verified Paystack amount against the price recorded here at initialization,
 * so a tampered checkout cannot activate access even with a valid signature.
 */
create table public.billing_plans (
  slug          text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  name          text not null check (char_length(name) between 1 and 80),
  tier          text not null check (tier in ('free', 'master')),
  price_kobo    integer not null check (price_kobo >= 0),
  currency      text not null default 'NGN' check (currency = 'NGN'),
  duration_days integer check (duration_days is null or duration_days between 1 and 3650),
  is_active     boolean not null default true,
  is_popular    boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Free is permanent and costs nothing; a paid plan must have both a price and
  -- a duration, so "grant access for zero days" is unrepresentable.
  constraint billing_plans_shape check (
    (tier = 'free'   and price_kobo = 0 and duration_days is null)
    or
    (tier = 'master' and price_kobo > 0 and duration_days is not null)
  )
);

-- "Most Popular" is a single editorial slot, not a per-card boolean.
create unique index billing_plans_single_popular_idx
  on public.billing_plans (is_popular) where is_popular;

insert into public.billing_plans (slug, name, tier, price_kobo, duration_days, is_popular, display_order)
values
  ('free',       'Free',               'free',        0, null,  false, 1),
  ('master_30',  'Master Monthly',     'master', 150000,   30,  false, 2),
  ('master_90',  'Master Exam Pass',   'master', 350000,   90,   true, 3),
  ('master_180', 'Master Season Pass', 'master', 550000,  180,  false, 4)
on conflict (slug) do update set
  name          = excluded.name,
  tier          = excluded.tier,
  price_kobo    = excluded.price_kobo,
  duration_days = excluded.duration_days,
  is_popular    = excluded.is_popular,
  display_order = excluded.display_order,
  is_active     = true,
  updated_at    = now();

-- ────────────────────────────────────────────────────────── payment history

/*
 * One row per checkout attempt, created *before* Paystack is contacted so a
 * webhook always has a local record to resolve against. The reference is
 * generated here-side and is the only identifier trusted to name a payment:
 * provider metadata is attacker-influenceable in a way a locally generated,
 * locally stored reference is not.
 *
 * Rows are never deleted. Expired access still has to be auditable, and a
 * student must be able to see what they paid for months later.
 */
create table public.payment_transactions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  plan_slug               text not null references public.billing_plans(slug),
  reference               text not null unique check (char_length(reference) between 8 and 100),
  provider                text not null default 'paystack' check (provider = 'paystack'),
  -- Guards against a live webhook settling a transaction opened in test mode.
  environment             text not null check (environment in ('test', 'live')),
  amount_kobo             integer not null check (amount_kobo > 0),
  currency                text not null check (currency = 'NGN'),
  access_days             integer not null check (access_days between 1 and 3650),
  status                  text not null check (status in ('pending', 'success', 'failed', 'abandoned', 'reversed')),
  -- The student's own checkout link. Safe to return to its owner, and reused so
  -- a double-tapped Pay button resolves to one Paystack transaction.
  authorization_url       text,
  provider_transaction_id text,
  provider_status         text,
  failure_reason          text,
  paid_at                 timestamptz,
  applied_at              timestamptz,
  entitlement_expires_at  timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- A payment cannot be marked successful without recording the access it
  -- bought, which is what makes a double grant detectable rather than silent.
  constraint payment_transactions_success_is_applied check (
    status <> 'success' or (applied_at is not null and entitlement_expires_at is not null)
  )
);

create index payment_transactions_user_created_idx
  on public.payment_transactions (user_id, created_at desc);
create index payment_transactions_status_created_idx
  on public.payment_transactions (status, created_at desc);
create index payment_transactions_open_checkout_idx
  on public.payment_transactions (user_id, plan_slug, created_at desc)
  where status = 'pending';

-- ────────────────────────────────────────────────────────────── entitlements

/*
 * Current paid access. One row per student.
 *
 * `tier` is never downgraded on expiry by a background job — expiry is resolved
 * from `expires_at` at read time, so a lapsed student becomes Free the moment
 * the clock passes, with no cron, no drift, and no window in which a stale row
 * still authorizes Master.
 */
create table public.user_entitlements (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  tier            text not null default 'free' check (tier in ('free', 'master')),
  plan_slug       text references public.billing_plans(slug),
  expires_at      timestamptz,
  activated_at    timestamptz,
  last_payment_id uuid references public.payment_transactions(id) on delete set null,
  total_paid_kobo bigint not null default 0 check (total_paid_kobo >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_entitlements_master_has_expiry check (tier = 'free' or expires_at is not null)
);

create index user_entitlements_expiry_idx
  on public.user_entitlements (expires_at) where tier = 'master';

/* Append-only record of every grant and extension, kept for dispute handling. */
create table public.entitlement_events (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  payment_id          uuid references public.payment_transactions(id) on delete set null,
  event_type          text not null check (event_type in ('granted', 'extended')),
  plan_slug           text,
  previous_tier       text,
  previous_expires_at timestamptz,
  new_tier            text,
  new_expires_at      timestamptz,
  created_at          timestamptz not null default now()
);

create index entitlement_events_user_created_idx
  on public.entitlement_events (user_id, created_at desc);

-- ─────────────────────────────────────────────────────── webhook idempotency

/*
 * Paystack retries. A delivery that already ran must not run again, and the
 * browser callback racing the webhook must not produce a second grant.
 *
 * The claim is a *lease*, not a permanent mark. A row only stops future
 * deliveries once it has `processed_at` — a terminal decision. If a delivery
 * fails for a retryable reason (Paystack's verify API unreachable, our own
 * database briefly unavailable) the claim is released, so Paystack's retry is
 * treated as new and can still activate the payment. Marking the claim
 * permanently on the first attempt would turn one transient outage into a
 * payment that never applies, which is exactly the failure this table exists
 * to prevent.
 *
 * Only sanitized identifiers are stored. No signatures, no card data, no
 * authorization codes, no raw provider payloads — a leak of this table must not
 * become a leak of anybody's payment instrument.
 */
create table public.billing_webhook_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'paystack' check (provider = 'paystack'),
  event_id         text not null check (char_length(event_id) between 1 and 200),
  event_type       text not null check (char_length(event_type) between 1 and 100),
  reference        text,
  outcome          text not null check (outcome in ('received', 'applied', 'ignored', 'rejected', 'duplicate')),
  detail           text check (detail is null or char_length(detail) <= 300),
  -- While this is in the future and processed_at is null, another instance is
  -- working on the delivery. Once it passes, an unfinished claim is re-claimable.
  claim_expires_at timestamptz not null default now(),
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (provider, event_id)
);

create index billing_webhook_events_reference_idx
  on public.billing_webhook_events (reference, received_at desc);

-- ────────────────────────────────────────────────── product entitlement quota

/*
 * Plan-specific product limits: practice sessions and mock attempts.
 *
 * Separate from `rate_limit_buckets`, which is abuse protection for the
 * question provider and applies to every student regardless of what they paid.
 * This is the thing a student buys more of.
 *
 * Reserve → commit/release rather than a bare counter: a session is only
 * created after the upstream provider returns questions, and a provider outage
 * must not silently spend a student's daily allowance. A reservation that is
 * never settled expires on its own lease.
 */
create table public.product_usage_windows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('practice_session', 'mock_attempt')),
  window_key text not null check (char_length(window_key) between 4 and 20),
  updated_at timestamptz not null default now(),
  primary key (user_id, capability, window_key)
);

create table public.product_usage_reservations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  capability       text not null check (capability in ('practice_session', 'mock_attempt')),
  window_key       text not null check (char_length(window_key) between 4 and 20),
  state            text not null check (state in ('reserved', 'committed')),
  lease_expires_at timestamptz,
  committed_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint product_usage_reservations_state_shape check (
    (state = 'reserved'  and lease_expires_at is not null and committed_at is null)
    or
    (state = 'committed' and committed_at is not null)
  )
);

create index product_usage_reservations_window_idx
  on public.product_usage_reservations (user_id, capability, window_key);
create index product_usage_reservations_lease_idx
  on public.product_usage_reservations (lease_expires_at) where state = 'reserved';

-- ───────────────────────────────────────────────────────────────── functions

/*
 * Opens — or reuses — a pending checkout.
 *
 * A double-tapped Pay button, a retried POST or a second tab would otherwise
 * each create their own Paystack transaction, leaving the student staring at
 * two checkout pages and the ledger holding orphan pending rows. The row lock
 * below serialises concurrent openers for the same user, so the second caller
 * is handed the first one's reference instead of starting a new payment.
 */
create or replace function public.open_billing_checkout(
  p_user_id       uuid,
  p_plan_slug     text,
  p_reference     text,
  p_environment   text,
  p_reuse_seconds integer default 900
)
returns table (
  outcome           text,
  payment_id        uuid,
  reference         text,
  amount_kobo       integer,
  currency          text,
  access_days       integer,
  authorization_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := clock_timestamp();
  v_plan     public.billing_plans%rowtype;
  v_existing public.payment_transactions%rowtype;
  v_id       uuid;
begin
  if p_environment not in ('test', 'live') then
    raise exception 'BILLING_ENVIRONMENT_INVALID';
  end if;
  if p_reuse_seconds < 0 or p_reuse_seconds > 3600 then
    raise exception 'BILLING_REUSE_WINDOW_INVALID';
  end if;

  -- The price comes from here, never from the caller.
  select * into v_plan
  from public.billing_plans b
  where b.slug = p_plan_slug and b.is_active and b.tier <> 'free';

  if not found then
    raise exception 'BILLING_PLAN_NOT_PURCHASABLE';
  end if;

  -- Serialises concurrent openers for this user without locking other users:
  -- the entitlement row is the natural per-user anchor, and always exists once
  -- this insert has run.
  insert into public.user_entitlements (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  perform 1 from public.user_entitlements e where e.user_id = p_user_id for update;

  select * into v_existing
  from public.payment_transactions t
  where t.user_id = p_user_id
    and t.plan_slug = p_plan_slug
    and t.status = 'pending'
    and t.environment = p_environment
    and t.authorization_url is not null
    and t.created_at > v_now - make_interval(secs => p_reuse_seconds)
  order by t.created_at desc
  limit 1;

  if found then
    return query select
      'reused'::text, v_existing.id, v_existing.reference, v_existing.amount_kobo,
      v_existing.currency, v_existing.access_days, v_existing.authorization_url;
    return;
  end if;

  insert into public.payment_transactions (
    user_id, plan_slug, reference, environment, amount_kobo, currency, access_days, status
  ) values (
    p_user_id, p_plan_slug, p_reference, p_environment,
    v_plan.price_kobo, v_plan.currency, v_plan.duration_days, 'pending'
  )
  returning id into v_id;

  return query select
    'created'::text, v_id, p_reference, v_plan.price_kobo,
    v_plan.currency, v_plan.duration_days, null::text;
end;
$$;

/* Stores the provider checkout link once initialization succeeds. */
create or replace function public.attach_billing_authorization_url(
  p_reference         text,
  p_authorization_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_authorization_url is null or p_authorization_url !~ '^https://' then
    raise exception 'BILLING_AUTHORIZATION_URL_INVALID';
  end if;

  update public.payment_transactions t
  set authorization_url = p_authorization_url, updated_at = clock_timestamp()
  where t.reference = p_reference and t.status = 'pending';
end;
$$;

/*
 * Applies one verified successful payment, atomically.
 *
 * Every caller — the webhook and the browser-callback reconciler — funnels
 * through here, and the FOR UPDATE on the payment row is what makes them safe
 * to race: the loser blocks, re-reads the committed row, sees `success` and
 * returns `already_applied` without touching the entitlement. The same
 * reference can therefore never buy two extensions.
 *
 * The verified amount, currency and environment are re-checked against the row
 * written at initialization, so a correctly signed webhook carrying the wrong
 * amount is refused here and not merely in application code.
 *
 * Renewal extends from greatest(current expiry, now): renewing early keeps the
 * days already paid for, and renewing after a lapse starts from today rather
 * than back-dating into a window the student could not use.
 */
create or replace function public.apply_successful_payment(
  p_reference               text,
  p_amount_kobo             integer,
  p_currency                text,
  p_environment             text,
  p_provider_transaction_id text default null,
  p_provider_status         text default null,
  p_paid_at                 timestamptz default null
)
returns table (
  outcome     text,
  user_id     uuid,
  plan_slug   text,
  tier        text,
  expires_at  timestamptz,
  access_days integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := clock_timestamp();
  v_txn        public.payment_transactions%rowtype;
  v_ent        public.user_entitlements%rowtype;
  v_base       timestamptz;
  v_new_expiry timestamptz;
  v_event      text;
begin
  select * into v_txn
  from public.payment_transactions t
  where t.reference = p_reference
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::timestamptz, null::integer;
    return;
  end if;

  -- Idempotent replay: a retried webhook, or the callback arriving after the
  -- webhook already settled this reference.
  if v_txn.status = 'success' then
    select * into v_ent from public.user_entitlements e where e.user_id = v_txn.user_id;
    return query select
      'already_applied'::text, v_txn.user_id, v_txn.plan_slug,
      coalesce(v_ent.tier, 'free'), v_ent.expires_at, v_txn.access_days;
    return;
  end if;

  if v_txn.status <> 'pending' then
    return query select 'not_pending'::text, v_txn.user_id, v_txn.plan_slug, null::text, null::timestamptz, v_txn.access_days;
    return;
  end if;

  if p_amount_kobo is distinct from v_txn.amount_kobo then
    update public.payment_transactions t
    set failure_reason = 'amount_mismatch', provider_status = p_provider_status, updated_at = v_now
    where t.id = v_txn.id;
    return query select 'amount_mismatch'::text, v_txn.user_id, v_txn.plan_slug, null::text, null::timestamptz, v_txn.access_days;
    return;
  end if;

  if p_currency is distinct from v_txn.currency then
    update public.payment_transactions t
    set failure_reason = 'currency_mismatch', provider_status = p_provider_status, updated_at = v_now
    where t.id = v_txn.id;
    return query select 'currency_mismatch'::text, v_txn.user_id, v_txn.plan_slug, null::text, null::timestamptz, v_txn.access_days;
    return;
  end if;

  if p_environment is distinct from v_txn.environment then
    update public.payment_transactions t
    set failure_reason = 'environment_mismatch', provider_status = p_provider_status, updated_at = v_now
    where t.id = v_txn.id;
    return query select 'environment_mismatch'::text, v_txn.user_id, v_txn.plan_slug, null::text, null::timestamptz, v_txn.access_days;
    return;
  end if;

  -- The conflict target names the primary-key constraint rather than the
  -- column: this function returns a `user_id` column, and a bare `user_id` in
  -- an inference expression is ambiguous between that output and the table's.
  insert into public.user_entitlements (user_id) values (v_txn.user_id)
  on conflict on constraint user_entitlements_pkey do nothing;

  select * into v_ent
  from public.user_entitlements e
  where e.user_id = v_txn.user_id
  for update;

  -- An expired expiry is in the past, so greatest() resolves it to "now" and a
  -- lapsed student's renewal starts today.
  v_base := greatest(coalesce(v_ent.expires_at, v_now), v_now);
  v_new_expiry := v_base + make_interval(days => v_txn.access_days);
  v_event := case when v_base > v_now then 'extended' else 'granted' end;

  update public.user_entitlements e
  set tier            = 'master',
      plan_slug       = v_txn.plan_slug,
      expires_at      = v_new_expiry,
      activated_at    = coalesce(e.activated_at, v_now),
      last_payment_id = v_txn.id,
      total_paid_kobo = e.total_paid_kobo + v_txn.amount_kobo,
      updated_at      = v_now
  where e.user_id = v_txn.user_id;

  update public.payment_transactions t
  set status                  = 'success',
      provider_transaction_id = p_provider_transaction_id,
      provider_status         = p_provider_status,
      paid_at                 = coalesce(p_paid_at, v_now),
      applied_at              = v_now,
      entitlement_expires_at  = v_new_expiry,
      failure_reason          = null,
      updated_at              = v_now
  where t.id = v_txn.id;

  insert into public.entitlement_events (
    user_id, payment_id, event_type, plan_slug,
    previous_tier, previous_expires_at, new_tier, new_expires_at
  ) values (
    v_txn.user_id, v_txn.id, v_event, v_txn.plan_slug,
    coalesce(v_ent.tier, 'free'), v_ent.expires_at, 'master', v_new_expiry
  );

  return query select 'applied'::text, v_txn.user_id, v_txn.plan_slug, 'master'::text, v_new_expiry, v_txn.access_days;
end;
$$;

/*
 * Records a non-successful outcome.
 *
 * Only a pending payment may move here. An already-applied payment is never
 * demoted by a later event: reversals, refunds and chargebacks are recorded for
 * review and settled by a human, because inventing an automatic revocation on
 * top of an event contract that has not been verified end to end risks cutting
 * off a student who actually paid.
 */
create or replace function public.mark_billing_payment_unsuccessful(
  p_reference               text,
  p_status                  text,
  p_reason                  text default null,
  p_provider_transaction_id text default null,
  p_provider_status         text default null
)
returns table (outcome text, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_txn public.payment_transactions%rowtype;
begin
  if p_status not in ('failed', 'abandoned', 'reversed') then
    raise exception 'BILLING_STATUS_INVALID';
  end if;

  select * into v_txn from public.payment_transactions t where t.reference = p_reference for update;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_txn.status = 'success' then
    return query select 'already_applied'::text, v_txn.user_id;
    return;
  end if;
  if v_txn.status <> 'pending' then
    return query select 'not_pending'::text, v_txn.user_id;
    return;
  end if;

  update public.payment_transactions t
  set status                  = p_status,
      failure_reason          = left(coalesce(p_reason, p_status), 200),
      provider_transaction_id = coalesce(p_provider_transaction_id, t.provider_transaction_id),
      provider_status         = coalesce(p_provider_status, t.provider_status),
      updated_at              = v_now
  where t.id = v_txn.id;

  return query select 'recorded'::text, v_txn.user_id;
end;
$$;

/*
 * Current access, with expiry already resolved.
 *
 * Callers must not compare timestamps themselves; a lapsed Master row returns
 * `free` from here, so no caller can forget the comparison.
 */
create or replace function public.current_billing_entitlement(p_user_id uuid)
returns table (tier text, plan_slug text, expires_at timestamptz, is_master boolean)
language sql
security definer
set search_path = ''
as $$
  select
    case when e.tier = 'master' and e.expires_at > clock_timestamp() then 'master' else 'free' end,
    case when e.tier = 'master' and e.expires_at > clock_timestamp() then e.plan_slug else null end,
    e.expires_at,
    coalesce(e.tier = 'master' and e.expires_at > clock_timestamp(), false)
  from public.user_entitlements e
  where e.user_id = p_user_id
  union all
  select 'free'::text, null::text, null::timestamptz, false
  where not exists (select 1 from public.user_entitlements e2 where e2.user_id = p_user_id)
$$;

/*
 * Reserves one unit of a plan-limited product capability.
 *
 * The window row is locked first, so every concurrent reservation for the same
 * student, capability and window serialises there and the limit cannot be
 * oversold by simultaneous requests landing on different serverless instances.
 *
 * Expired reservations are dropped inside the same lock: a request that died
 * between reserving and creating its session returns its allowance
 * automatically, rather than costing the student a slot forever.
 */
create or replace function public.reserve_product_quota(
  p_user_id       uuid,
  p_capability    text,
  p_window_key    text,
  p_limit         integer,
  p_lease_seconds integer default 120
)
returns table (allowed boolean, used integer, remaining integer, reservation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now  timestamptz := clock_timestamp();
  v_used integer;
  v_id   uuid;
begin
  if p_capability not in ('practice_session', 'mock_attempt') then
    raise exception 'PRODUCT_CAPABILITY_INVALID';
  end if;
  if p_limit < 1 or p_limit > 100000 or p_lease_seconds < 5 or p_lease_seconds > 900 then
    raise exception 'PRODUCT_QUOTA_PARAMS_INVALID';
  end if;

  insert into public.product_usage_windows (user_id, capability, window_key)
  values (p_user_id, p_capability, p_window_key)
  on conflict (user_id, capability, window_key) do nothing;

  perform 1 from public.product_usage_windows w
  where w.user_id = p_user_id and w.capability = p_capability and w.window_key = p_window_key
  for update;

  delete from public.product_usage_reservations r
  where r.user_id = p_user_id
    and r.capability = p_capability
    and r.window_key = p_window_key
    and r.state = 'reserved'
    and r.lease_expires_at < v_now;

  select count(*) into v_used
  from public.product_usage_reservations r
  where r.user_id = p_user_id and r.capability = p_capability and r.window_key = p_window_key;

  if v_used >= p_limit then
    return query select false, v_used, 0, null::uuid;
    return;
  end if;

  insert into public.product_usage_reservations (
    user_id, capability, window_key, state, lease_expires_at
  ) values (
    p_user_id, p_capability, p_window_key, 'reserved', v_now + make_interval(secs => p_lease_seconds)
  )
  returning id into v_id;

  update public.product_usage_windows w
  set updated_at = v_now
  where w.user_id = p_user_id and w.capability = p_capability and w.window_key = p_window_key;

  return query select true, v_used + 1, greatest(0, p_limit - v_used - 1), v_id;
end;
$$;

/* The session or attempt exists: the allowance is genuinely spent. */
create or replace function public.commit_product_quota(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.product_usage_reservations r
  set state = 'committed', committed_at = clock_timestamp(), lease_expires_at = null
  where r.id = p_reservation_id and r.state = 'reserved';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

/*
 * Nothing was created — a provider outage, a duplicate suppressed, an attempt
 * resumed rather than started. The allowance goes straight back.
 */
create or replace function public.release_product_quota(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.product_usage_reservations r
  where r.id = p_reservation_id and r.state = 'reserved';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

/*
 * Idempotency gate. Returns false for a delivery that must not run again.
 *
 * Three distinct cases, and conflating them is how a payment gets lost:
 *   - already decided  (processed_at set)      -> never run again
 *   - in flight        (claim still leased)    -> another instance has it
 *   - stale/released   (unfinished, lease up)  -> re-claim and try again
 */
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

/* Records a terminal decision. After this, the delivery never runs again. */
create or replace function public.finish_billing_webhook_event(
  p_event_row_id bigint,
  p_outcome      text,
  p_detail       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('applied', 'ignored', 'rejected', 'duplicate') then
    raise exception 'BILLING_WEBHOOK_OUTCOME_INVALID';
  end if;

  update public.billing_webhook_events e
  set outcome = p_outcome, detail = left(p_detail, 300), processed_at = clock_timestamp()
  where e.id = p_event_row_id;
end;
$$;

/*
 * Releases an unfinished claim after a retryable failure, so Paystack's next
 * delivery of the same event is processed rather than dismissed as a duplicate.
 *
 * The row is kept, with the reason, so an operator can still see that a
 * delivery arrived and could not be completed. It is never applied to a
 * delivery that already reached a decision.
 */
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

-- ──────────────────────────────────────────────────────────── RLS and grants

alter table public.billing_plans              enable row level security;
alter table public.payment_transactions       enable row level security;
alter table public.user_entitlements          enable row level security;
alter table public.entitlement_events         enable row level security;
alter table public.billing_webhook_events     enable row level security;
alter table public.product_usage_windows      enable row level security;
alter table public.product_usage_reservations enable row level security;

revoke all on table public.billing_plans              from public, anon, authenticated;
revoke all on table public.payment_transactions       from public, anon, authenticated;
revoke all on table public.user_entitlements          from public, anon, authenticated;
revoke all on table public.entitlement_events         from public, anon, authenticated;
revoke all on table public.billing_webhook_events     from public, anon, authenticated;
revoke all on table public.product_usage_windows      from public, anon, authenticated;
revoke all on table public.product_usage_reservations from public, anon, authenticated;
revoke all on sequence public.entitlement_events_id_seq     from public, anon, authenticated;
revoke all on sequence public.billing_webhook_events_id_seq from public, anon, authenticated;

grant select, insert, update on table public.billing_plans          to service_role;
grant select, insert, update on table public.payment_transactions   to service_role;
grant select, insert, update on table public.user_entitlements      to service_role;
grant select, insert         on table public.entitlement_events     to service_role;
grant select, insert, update on table public.billing_webhook_events to service_role;
grant select, insert, update, delete on table public.product_usage_windows      to service_role;
grant select, insert, update, delete on table public.product_usage_reservations to service_role;
grant usage, select on sequence public.entitlement_events_id_seq     to service_role;
grant usage, select on sequence public.billing_webhook_events_id_seq to service_role;

-- The price list is public product information.
grant select on table public.billing_plans to anon, authenticated;

create policy "billing_plans_read_active"
on public.billing_plans for select
to anon, authenticated
using (is_active = true);

/*
 * A student may read their own payments, but only the columns that describe
 * what they bought. `provider_transaction_id`, `provider_status`,
 * `authorization_url` and `failure_reason` are withheld at the column level, so
 * even a future policy mistake cannot turn this into provider-detail exposure.
 */
grant select (
  id, user_id, plan_slug, reference, provider, amount_kobo, currency,
  access_days, status, paid_at, applied_at, entitlement_expires_at, created_at
) on table public.payment_transactions to authenticated;

create policy "payment_transactions_select_own"
on public.payment_transactions for select
to authenticated
using (user_id = auth.uid());

grant select (user_id, tier, plan_slug, expires_at, activated_at, created_at)
  on table public.user_entitlements to authenticated;

create policy "user_entitlements_select_own"
on public.user_entitlements for select
to authenticated
using (user_id = auth.uid());

-- entitlement_events, billing_webhook_events and both product-quota tables get
-- no policies and no grants: nothing outside service_role may read or write them.

revoke all on function public.open_billing_checkout(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.attach_billing_authorization_url(text, text) from public, anon, authenticated;
revoke all on function public.apply_successful_payment(text, integer, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_billing_payment_unsuccessful(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.current_billing_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.reserve_product_quota(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.commit_product_quota(uuid) from public, anon, authenticated;
revoke all on function public.release_product_quota(uuid) from public, anon, authenticated;
revoke all on function public.record_billing_webhook_event(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_billing_webhook_event(bigint, text, text) from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(bigint, text) from public, anon, authenticated;

grant execute on function public.open_billing_checkout(uuid, text, text, text, integer) to service_role;
grant execute on function public.attach_billing_authorization_url(text, text) to service_role;
grant execute on function public.apply_successful_payment(text, integer, text, text, text, text, timestamptz) to service_role;
grant execute on function public.mark_billing_payment_unsuccessful(text, text, text, text, text) to service_role;
grant execute on function public.current_billing_entitlement(uuid) to service_role;
grant execute on function public.reserve_product_quota(uuid, text, text, integer, integer) to service_role;
grant execute on function public.commit_product_quota(uuid) to service_role;
grant execute on function public.release_product_quota(uuid) to service_role;
grant execute on function public.record_billing_webhook_event(text, text, text, text, integer) to service_role;
grant execute on function public.finish_billing_webhook_event(bigint, text, text) to service_role;
grant execute on function public.release_billing_webhook_event(bigint, text) to service_role;

comment on table public.billing_plans is
  'Authoritative price and duration catalogue. The browser submits a slug only; every amount is resolved here.';
comment on table public.payment_transactions is
  'Payment ledger. Never store card details, authorization codes or raw provider payloads. Rows are retained after access expires.';
comment on table public.user_entitlements is
  'Current paid access. Expiry is resolved at read time, so lapsed Master resolves to Free with no background job.';
comment on table public.billing_webhook_events is
  'Sanitized webhook idempotency log. Identifiers and outcomes only — no signatures, payloads or payment instruments.';
comment on table public.product_usage_reservations is
  'Plan entitlement quota. Distinct from rate_limit_buckets, which is question-provider abuse protection.';
