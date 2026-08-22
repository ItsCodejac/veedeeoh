-- Invites carry a full grant, not just a tier.
--
-- beta_invites could set tier and tier_expires and nothing else, so every other
-- privilege had to be applied by hand AFTER the person signed up -- which meant
-- knowing they had, finding their row, and remembering what was promised. The
-- four presets in the panel were a workaround for the same gap.
--
-- A grant is a jsonb blob so a new privilege does not need a migration and an
-- older invite that predates it still redeems cleanly. Unknown keys are
-- ignored, missing keys leave the account alone -- an invite that grants a tier
-- must not silently reset someone's credits to zero.
--
-- Recognised keys (all optional):
--   tier                      text
--   tier_days                 int   -- null/absent = no expiry
--   party_credits             int   -- added to the balance, not assigned
--   party_credits_exempt      bool
--   referral_kind             'user' | 'partner'
--   referral_rate_bps         int
--   referral_duration_months  int   -- 0 = life of the account
--
-- Safe to re-run.

alter table public.beta_invites
  add column if not exists grants jsonb not null default '{}'::jsonb,
  add column if not exists note text;

comment on column public.beta_invites.grants is
  'Everything the invite confers beyond tier. jsonb so a new privilege needs no '
  'migration and old invites still redeem. Absent keys leave the account alone.';

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
  rk   text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into inv from public.beta_invites
   where code = invite_code and revoked_at is null and redeemed_by is null
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid or already used');
  end if;

  g := coalesce(inv.grants, '{}'::jsonb);

  -- The column still wins for tier and expiry, so invites created before this
  -- migration redeem exactly as they did. The grant only fills what is absent.
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

  -- Each of these is applied ONLY if the invite mentions it. A tier-only invite
  -- must not zero out credits or revoke an exemption granted separately.
  if g ? 'party_credits' then
    update public.profiles
       set party_credits = party_credits + coalesce((g->>'party_credits')::int, 0)
     where id = uid;
    insert into public.party_credit_ledger (user_id, delta, reason, note)
    values (uid, coalesce((g->>'party_credits')::int, 0), 'admin',
            'invite ' || inv.code);
  end if;

  if g ? 'party_credits_exempt' then
    update public.profiles
       set party_credits_exempt = coalesce((g->>'party_credits_exempt')::boolean, false)
     where id = uid;
  end if;

  -- Referral terms need a code to hang on. ensure_referral_code mints one for
  -- the CALLER, which is the redeemer, so it can be called directly here.
  if g ? 'referral_kind' or g ? 'referral_rate_bps' or g ? 'referral_duration_months' then
    perform public.ensure_referral_code();
    rk := g->>'referral_kind';
    update public.referral_codes
       set kind            = coalesce(rk, kind),
           rate_bps        = coalesce(nullif(g->>'referral_rate_bps', '')::int, rate_bps),
           duration_months = coalesce(nullif(g->>'referral_duration_months', '')::int, duration_months)
     where user_id = uid;
  end if;

  update public.beta_invites
     set redeemed_by = uid, redeemed_at = now()
   where id = inv.id;

  return jsonb_build_object('ok', true, 'tier', coalesce(g->>'tier', inv.tier), 'grants', g);
end;
$$;

revoke execute on function public.redeem_beta_invite(text) from public, anon;
grant  execute on function public.redeem_beta_invite(text) to authenticated;
