-- Grant the monthly allowance on demand, not only on invoice.paid.
--
-- The allowance was granted from the Stripe webhook, on the reasoning that a
-- paid invoice IS the month boundary. True for a paying subscriber -- and wrong
-- for everyone else:
--
--   founder_vip / giveaway  never produce an invoice at all, so a comped
--                           account accrued nothing and could never host
--   trial_7day              no invoice until the trial converts
--   any subscriber          nothing until their next renewal, so the feature
--                           was dead for up to a month after launch
--
-- The webhook path stays (it is the natural boundary when there IS one); this
-- adds a lazy top-up the client can call before it needs credit. Both go
-- through grant_monthly_credits, which is idempotent on credits_granted_for, so
-- the two can never double-grant.
--
-- Safe to re-run.

create or replace function public.ensure_party_credits()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Entitlement, not tier: the same check that gates hosting. An account that
  -- may not host has no business accruing hours it could bank.
  if not public.can_host_party() then
    return jsonb_build_object('ok', false, 'error', 'not entitled');
  end if;

  perform public.grant_monthly_credits(uid);
  return public.party_credit_summary();
end;
$$;

revoke execute on function public.ensure_party_credits() from public, anon;
grant  execute on function public.ensure_party_credits() to authenticated;

-- grant_monthly_credits is definer and was revoked from authenticated on
-- purpose; ensure_party_credits is the only door in, and it checks entitlement
-- before opening it.
