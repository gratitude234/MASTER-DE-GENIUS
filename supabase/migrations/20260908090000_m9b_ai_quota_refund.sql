-- MASTER@DE'GENIUS M9b — a failed AI generation returns the student's allowance.
--
-- `consume_ai_daily_quota` is called before the provider, which is correct: the
-- count has to be reserved atomically or two concurrent requests both spend the
-- last one. But nothing ever gave it back. A student whose generation failed —
-- a provider outage, an unknown model, a malformed reply — permanently lost one
-- of their three daily explanations, and after three failures was told they had
-- "used today's 3 free AI explanations" without having received a single one.
--
-- This mirrors the reserve/release design the product quotas already use: spend
-- on success, hand back when nothing was produced.
--
-- Refunding cannot be farmed. A refund only happens when no explanation was
-- delivered, and the per-user burst limiter still bounds how often a student can
-- reach the provider at all.

create or replace function public.refund_ai_daily_quota(
  p_user_id uuid,
  p_feature  text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_feature <> 'question_explanation' then
    raise exception 'AI_DAILY_QUOTA_PARAMS_INVALID';
  end if;

  -- Same UTC day boundary the consume side uses, so a refund can never land on
  -- a different row than the charge it reverses.
  update public.ai_daily_usage d
  set generation_count = d.generation_count - 1,
      updated_at       = clock_timestamp()
  where d.user_id   = p_user_id
    and d.usage_date = (timezone('utc', clock_timestamp()))::date
    and d.feature    = p_feature
    -- Never below zero, and never a refund against a day with nothing spent.
    and d.generation_count > 0
  returning d.generation_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.refund_ai_daily_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ai_daily_quota(uuid, text) to service_role;

comment on function public.refund_ai_daily_quota(uuid, text) is
  'Returns one reserved generation when the provider produced nothing. Floors at zero and is scoped to the current UTC day.';
