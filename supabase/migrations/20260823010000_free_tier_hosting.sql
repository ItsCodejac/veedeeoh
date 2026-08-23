-- Charge for the thing that costs us money.
--
-- WHAT WE WERE CHARGING FOR. can_host_party() and hasActiveAccess() were the
-- same tier check, so a lapsed account could not browse, could not search and
-- could not stream -- none of which costs us anything. The streams come from
-- Pluto, Tubi and the Internet Archive; we serve none of them and pay for none
-- of them. Meanwhile watch party hosting, which is the one thing that does
-- cost real money -- Durable Objects, sockets, signalling -- already had a
-- proper per-minute meter that only paying accounts ever reached.
--
-- The subscription is for hosting veedeeoh, not for access to free television.
-- Anyone can run the whole thing themselves for nothing. So the paid line
-- belongs where our bill is, and the free tier is a real tier rather than a
-- locked door.
--
--   browse, search, stream    free, always. Costs us nothing.
--   join someone's party      free, always. Already was.
--   host a party              metered. 3 hours a month free, 10 on the plan.
--
-- THREE HOURS, not one. A film is about two, so an allowance under that cannot
-- host a single complete party -- which makes it a demo of a countdown rather
-- than a demo of the feature. Three is one film and a bit: enough to find out
-- whether the thing is any good, not enough to run a weekly night on.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Allowance depends on the plan, not on having one
-- ===========================================================================

create or replace function public.grant_monthly_credits(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  this_month date := date_trunc('month', now())::date;
  paid_grant constant int := 60;   -- 10 hours
  free_grant constant int := 18;   -- 3 hours
  spend_cap  constant int := 180;  -- 30 hours banked, unchanged
  grant_size int;
  before int;
  after  int;
  paid   boolean;
begin
  select p.party_credits,
         p.tier in ('founder_vip', 'giveaway', 'cloud_paid', 'trial_7day', 'trial_dollar_month')
           and (p.tier_expires is null or p.tier_expires > now())
    into before, paid
    from public.profiles p
   where p.id = target
     and coalesce(p.credits_granted_for, '1970-01-01') < this_month
   for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'already granted this month');
  end if;

  grant_size := case when paid then paid_grant else free_grant end;

  -- Spendable is capped, but the accrual counter takes the FULL grant including
  -- the part that overflowed and can never be spent. That overflow is what the
  -- 240 free-month trigger measures.
  after := least(before + grant_size, spend_cap);

  update public.profiles
     set party_credits         = after,
         party_credits_accrued = party_credits_accrued + grant_size,
         credits_granted_for   = this_month
   where id = target;

  insert into public.party_credit_ledger (user_id, delta, reason, note)
  values (target, after - before, 'monthly_grant',
          (case when paid then 'plan' else 'free tier' end) ||
          case when after - before < grant_size
               then '; capped at 180, ' || (grant_size - (after - before)) || ' overflowed'
               else '' end);

  return jsonb_build_object('ok', true, 'balance', after, 'granted', after - before, 'paid', paid);
end;
$$;

revoke execute on function public.grant_monthly_credits(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. Hosting is gated by credit, not by tier
-- ===========================================================================
--
-- The RLS policy on creating a party calls this, so it stays the single
-- authority on who may host. What changed is the question it asks: not "are
-- you paying" but "do you have hours left", which is the question that matches
-- what hosting costs us.

create or replace function public.can_host_party()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.party_credits_exempt or p.party_credits > 0)
  );
$$;

revoke execute on function public.can_host_party() from public, anon;
grant  execute on function public.can_host_party() to authenticated;

-- ===========================================================================
-- 3. Break the circle
-- ===========================================================================
--
-- ensure_party_credits() checked can_host_party() before granting, which was
-- right when entitlement meant tier. Now that entitlement means balance, that
-- check is a deadlock: a free account at zero cannot be granted the credit it
-- needs in order to be allowed the credit. Granting is open to any signed-in
-- account; grant_monthly_credits is idempotent per month and decides the size.

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
  perform public.grant_monthly_credits(uid);
  return public.party_credit_summary();
end;
$$;

revoke execute on function public.ensure_party_credits() from public, anon;
grant  execute on function public.ensure_party_credits() to authenticated;
