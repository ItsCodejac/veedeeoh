-- Apply a benefits bundle to someone who has already joined.
--
-- The bundles exist -- founder, beta tester, affiliate partner, friends and
-- family -- but only reachable through an INVITE, which by definition goes to
-- someone who is not here yet. There has been no way to say "make this
-- existing account a partner" short of four separate writes across three
-- tables, done by hand, with no record that they belonged together.
--
-- ONE DEFINITION OF WHAT A GRANT MEANS. The redemption path already knew how to
-- read a grants object; that logic now lives in apply_grants() and both callers
-- use it. Two copies would drift, and the way they would drift is that a bundle
-- means one thing at signup and something else when granted later, which is
-- exactly the kind of difference nobody notices until someone is paid the wrong
-- commission for a year.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Minting a referral code for SOMEONE ELSE
-- ===========================================================================
--
-- ensure_referral_code() mints for auth.uid(), the caller, which is right for
-- the app and useless for an admin acting on another account. Same alphabet and
-- same collision retry; the only difference is whose code it is.

create or replace function public.ensure_referral_code_for(target uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c   text;
  try int := 0;
begin
  if target is null then raise exception 'no user'; end if;

  select code into c from public.referral_codes where user_id = target;
  if found then return c; end if;

  loop
    try := try + 1;
    c := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 7)
    );
    begin
      insert into public.referral_codes (user_id, code) values (target, c);
      return c;
    exception when unique_violation then
      if try >= 8 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.ensure_referral_code_for(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. What a grants object does, in one place
-- ===========================================================================

create or replace function public.apply_grants(uid uuid, g jsonb, note text default 'admin grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  days int;
  exp  timestamptz;
  rk   text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'no user'); end if;
  g := coalesce(g, '{}'::jsonb);

  -- Tier and expiry. A null tier_days means no expiry at all, which is what
  -- founder and comp want; absent means leave the expiry alone.
  days := nullif(g->>'tier_days', '')::int;
  if g ? 'tier' or g ? 'tier_days' then
    exp := case when days is not null then now() + make_interval(days => days) else null end;
    update public.profiles
       set tier         = coalesce(g->>'tier', tier),
           tier_expires = case when g ? 'tier_days' then exp else tier_expires end
     where id = uid;
  end if;

  -- Each of these applies ONLY if mentioned. A tier-only grant must not zero
  -- someone's credits or revoke an exemption granted separately.
  if g ? 'party_credits' then
    update public.profiles
       set party_credits = party_credits + coalesce((g->>'party_credits')::int, 0)
     where id = uid;
    insert into public.party_credit_ledger (user_id, delta, reason, note)
    values (uid, coalesce((g->>'party_credits')::int, 0), 'admin', note);
  end if;

  if g ? 'party_credits_exempt' then
    update public.profiles
       set party_credits_exempt = coalesce((g->>'party_credits_exempt')::boolean, false)
     where id = uid;
  end if;

  if g ? 'referral_kind' or g ? 'referral_rate_bps' or g ? 'referral_duration_months' then
    -- Mint first. Setting partner terms on an account that has never opened
    -- Settings used to fail with "that user has no referral code yet", which
    -- put the burden of a database detail on whoever was doing the granting.
    perform public.ensure_referral_code_for(uid);
    rk := g->>'referral_kind';
    update public.referral_codes
       set kind            = coalesce(rk, kind),
           rate_bps        = coalesce(nullif(g->>'referral_rate_bps', '')::int, rate_bps),
           duration_months = coalesce(nullif(g->>'referral_duration_months', '')::int, duration_months)
     where user_id = uid;
  end if;

  return jsonb_build_object('ok', true, 'grants', g);
end;
$$;

revoke execute on function public.apply_grants(uuid, jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 3. By email, for the panel
-- ===========================================================================
--
-- Service role only. This hands out paid tiers and commission rates, so it must
-- never be reachable with an anon or a signed-in key -- the exact hole found
-- earlier in this project, where a SECURITY DEFINER function was callable by
-- anon because nobody had revoked it.

create or replace function public.admin_apply_grants(target_email text, g jsonb, note text default 'admin grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid;
begin
  select id into uid from public.profiles
   where lower(email) = lower(trim(coalesce(target_email, '')));
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no account with that email');
  end if;
  return public.apply_grants(uid, g, note);
end;
$$;

revoke execute on function public.admin_apply_grants(text, jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 4. Redemption uses the same definition
-- ===========================================================================

create or replace function public.redeem_beta_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv  public.beta_invites%rowtype;
  uid  uuid := auth.uid();
  g    jsonb;
  exp  timestamptz;
  days int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Unchanged from the previous version, including the row lock: two people
  -- racing the same code must not both redeem it.
  select * into inv from public.beta_invites
   where code = invite_code and revoked_at is null and redeemed_by is null
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid or already used');
  end if;

  g := coalesce(inv.grants, '{}'::jsonb);

  -- The invite's own columns still win for tier and expiry, so invites written
  -- before grants existed redeem exactly as they always did.
  days := nullif(g->>'tier_days', '')::int;
  exp := case
           when inv.tier_expires is not null then inv.tier_expires
           when days is not null then now() + make_interval(days => days)
           else null
         end;

  update public.profiles
     set tier         = coalesce(g->>'tier', inv.tier),
         tier_expires = exp
   where id = uid;

  -- Everything else -- credits, exemption, referral terms -- from the shared
  -- definition, with the tier keys stripped so it cannot undo the line above.
  perform public.apply_grants(uid, g - 'tier' - 'tier_days', 'invite ' || inv.code);

  update public.beta_invites
     set redeemed_by = uid, redeemed_at = now()
   where id = inv.id;

  return jsonb_build_object('ok', true, 'tier', coalesce(g->>'tier', inv.tier), 'grants', g);
end;
$$;

revoke execute on function public.redeem_beta_invite(text) from public, anon;
grant  execute on function public.redeem_beta_invite(text) to authenticated;
