-- Put the cloud back behind the subscription.
--
-- 20260823010000 moved the paid line from account access to metered hosting,
-- on the reasoning that the catalogue is free elsewhere so charging for access
-- charges for nothing. That reasoning is wrong about what is being sold.
--
-- veedeeoh is free: clone it and run it. What costs $4 is US running it -- the
-- Vercel deploy, the Supabase project, the catalogue warming, the Durable
-- Objects. A hosted account that browses, streams, syncs and hosts parties for
-- nothing is not a generous free tier, it is the product given away. Free
-- means self-host. The cloud is the paid thing, and a free cloud account is a
-- restricted one.
--
-- Restores all three functions to their pre-20260823010000 behaviour. Safe to
-- re-run, and safe to run on a database where 010000 was never applied.

-- ===========================================================================
-- 1. One allowance, for accounts that are entitled at all
-- ===========================================================================

create or replace function public.grant_monthly_credits(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  this_month date := date_trunc('month', now())::date;
  grant_size constant int := 60;
  spend_cap  constant int := 180;
  before int;
  after  int;
begin
  select party_credits into before from public.profiles
   where id = target and coalesce(credits_granted_for, '1970-01-01') < this_month
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'already granted this month');
  end if;

  after := least(before + grant_size, spend_cap);

  update public.profiles
     set party_credits         = after,
         party_credits_accrued = party_credits_accrued + grant_size,
         credits_granted_for   = this_month
   where id = target;

  insert into public.party_credit_ledger (user_id, delta, reason, note)
  values (target, after - before, 'monthly_grant',
          case when after - before < grant_size
               then 'capped at 180; ' || (grant_size - (after - before)) || ' overflowed'
               else null end);

  return jsonb_build_object('ok', true, 'balance', after, 'granted', after - before);
end;
$$;

revoke execute on function public.grant_monthly_credits(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. Hosting requires a plan again
-- ===========================================================================
--
-- Credits are a FAIR-USE CAP INSIDE the subscription, not a way to buy your way
-- past it. Making them the gate meant a free account with a balance could host,
-- which is the paid feature handed to a non-paying account.

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
       and p.tier in ('founder_vip', 'giveaway', 'cloud_paid', 'trial_7day', 'trial_dollar_month')
       and (p.tier_expires is null or p.tier_expires > now())
  );
$$;

revoke execute on function public.can_host_party() from public, anon;
grant  execute on function public.can_host_party() to authenticated;

-- ===========================================================================
-- 3. The entitlement check comes back
-- ===========================================================================
--
-- 010000 removed it to break a circle it had created itself: when entitlement
-- meant balance, an account at zero could never be granted the credit that
-- would entitle it. Entitlement means tier again, so the circle is gone and
-- the check is correct -- an account that may not host has no business
-- accruing hours it could bank against a later subscription.

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

  if not public.can_host_party() then
    return jsonb_build_object('ok', false, 'error', 'not entitled');
  end if;

  perform public.grant_monthly_credits(uid);
  return public.party_credit_summary();
end;
$$;

revoke execute on function public.ensure_party_credits() from public, anon;
grant  execute on function public.ensure_party_credits() to authenticated;

-- ===========================================================================
-- 4. Take back the free-tier grants that 010000 handed out
-- ===========================================================================
--
-- Between the two migrations, any non-entitled account that opened the party
-- screen was granted 18 credits and stamped credits_granted_for = this month.
-- Left alone that is three hours of hosting on accounts entitled to none, and
-- the stamp would block a real grant if they subscribe later this month.
--
-- Subtracts the grant rather than zeroing the balance, and only from rows that
-- are BOTH unentitled and carry this month's stamp. A subscriber's balance and
-- a comped account's exemption are untouched.
--
-- THE EDGE THIS DOES NOT HANDLE: an unentitled account that had also PURCHASED
-- credits, was granted the 18, and spent some of the total could lose up to 18
-- credits it paid for. Accepted rather than solved, because it is a same-day
-- correction on a pre-launch database with no purchasers -- and reconstructing
-- purchased-vs-granted from the ledger to protect a case that cannot exist yet
-- is more code to be wrong in than the thing it guards.

update public.profiles p
   set party_credits       = greatest(0, p.party_credits - 18),
       credits_granted_for = null
 where coalesce(p.credits_granted_for, '1970-01-01') = date_trunc('month', now())::date
   and not p.party_credits_exempt
   and not (p.tier in ('founder_vip', 'giveaway', 'cloud_paid', 'trial_7day', 'trial_dollar_month')
            and (p.tier_expires is null or p.tier_expires > now()));
