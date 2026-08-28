-- Earning is on by default and can be switched off.
--
-- Every cloud account is effectively an affiliate: attribute_party_join falls
-- back to the standard terms with `coalesce(rc.rate_bps, 5000)`, so hosting a
-- party earns whether or not the host ever opened the Earn screen. That is
-- deliberate, because parties are the funnel. What was missing is the way out.
--
-- THE SWITCH DID NOTHING. referral_codes.active existed, but the lookup read
--
--     select * into rc from public.referral_codes where user_id = host and active
--
-- so a deactivated code returned no row and fell straight into the coalesce
-- defaults. Opting out produced the same attribution as never having engaged.
-- Nobody could have noticed, because nothing could set active to false either:
-- the table's only policy is SELECT, so the column was unreachable from the app.
--
-- Now an existing row that is inactive means no. A missing row still means the
-- default, which is yes. The two cases are different facts and are no longer
-- collapsed by the same filter.
--
-- The link path already behaved: attribute_referral filters on `active` and a
-- deactivated code answers 'unknown code', so a shared link stops working. Only
-- the party path needed correcting.

-- Turn earning on or off. SECURITY DEFINER because referral_codes is read-only
-- to its owner under RLS, and this is the one thing they should be able to
-- change about it.
--
-- Switching off MINTS a row when none exists, on purpose: "off" has to be a
-- recorded fact rather than an absence, since an absence is what the default
-- reads as.
create or replace function public.set_referral_participation(participating boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Mints the code and its terms if this account has never had one. Existing
  -- rows keep the rate and duration they were created with.
  perform public.ensure_referral_code();

  update public.referral_codes
     set active = participating
   where user_id = uid;

  return jsonb_build_object('ok', true, 'participating', participating);
end;
$$;

revoke execute on function public.set_referral_participation(boolean) from public, anon;
grant execute on function public.set_referral_participation(boolean) to authenticated;

comment on function public.set_referral_participation(boolean) is
  'Opt in or out of earning from people you bring. Off writes active = false, '
  'which attribute_party_join honours; a missing row means the default, on.';

-- Reproduced from the live definition with the lookup and the opt-out check
-- changed. Everything else is unaltered.
create or replace function public.attribute_party_join(party uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid  uuid := auth.uid();
  host uuid;
  rc   public.referral_codes%rowtype;
  cur  public.referrals%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- First touch wins while it is still live or has ever paid, so joining a
  -- second person's party does not reassign somebody else's referral.
  select * into cur from public.referrals where referred_user_id = uid;
  if found and (cur.first_paid_at is not null
                or cur.expires_at is null
                or cur.expires_at > now()) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select host_user_id into host from public.parties where id = party;
  if host is null or host = uid then
    return jsonb_build_object('ok', false, 'error', 'no host');
  end if;

  -- No `and active` here. The row is wanted even when it is switched off,
  -- because that is exactly the case the filter used to hide.
  select * into rc from public.referral_codes where user_id = host;

  -- Host has opted out. The join itself is fine; it simply earns nobody
  -- anything, and no referral row is written to imply otherwise.
  if found and not rc.active then
    return jsonb_build_object('ok', true, 'declined', true);
  end if;

  insert into public.referrals (
    referred_user_id, referrer_user_id, code, source, party_id,
    rate_bps, duration_months, expires_at
  ) values (
    uid, host, rc.code, 'party', party,
    coalesce(rc.rate_bps, 5000), coalesce(rc.duration_months, 0),
    now() + interval '90 days'
  )
  on conflict (referred_user_id) do update
     set referrer_user_id = excluded.referrer_user_id,
         code             = excluded.code,
         source           = excluded.source,
         party_id         = excluded.party_id,
         rate_bps         = excluded.rate_bps,
         duration_months  = excluded.duration_months,
         created_at       = now(),
         expires_at       = excluded.expires_at;

  return jsonb_build_object('ok', true, 'referrer', host);
end;
$$;

revoke execute on function public.attribute_party_join(uuid) from public, anon;
grant execute on function public.attribute_party_join(uuid) to authenticated;
