-- Referral attribution gets a window.
--
-- It was first-touch and PERMANENT. Whoever introduced someone earned on them
-- forever, which protects an affiliate from being poached but has two problems
-- once parties are the main channel:
--
--   a host who brings someone in January earns on a conversion in December
--   that host B and host C actually did the work for, and
--
--   an unconverted claim sits on the books indefinitely with no expiry.
--
-- Now: first touch WINS for 90 days -- nobody can overwrite a live claim -- and
-- an unconverted claim expires, after which the next party join re-attributes.
-- A claim that HAS converted never expires; the commission clock in
-- accrueReferral takes over from there.
--
-- Safe to re-run.

alter table public.referrals
  add column if not exists expires_at timestamptz;

comment on column public.referrals.expires_at is
  'When an UNCONVERTED claim lapses and the next party join may re-attribute. '
  'Null once first_paid_at is set: a converted referral is permanent and its '
  'commission window is counted from the first payment instead.';

-- Existing rows keep their claim for 90 days from when they were made, rather
-- than expiring the instant this ships and handing every open attribution to
-- whoever happens to host next.
update public.referrals
   set expires_at = created_at + interval '90 days'
 where expires_at is null and first_paid_at is null;

create index if not exists referrals_expiry_idx
  on public.referrals (expires_at) where first_paid_at is null;

-- ===========================================================================
-- Attribution now replaces a LAPSED claim instead of always refusing.
-- ===========================================================================

create or replace function public.attribute_referral(
  ref_code text,
  src      text default 'link',
  party    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  rc   public.referral_codes%rowtype;
  cur  public.referrals%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into cur from public.referrals where referred_user_id = uid;

  -- A live claim, or one that already earned, is untouchable. This is what
  -- stops a referral being stolen by anyone who sends a link afterwards.
  if found and (cur.first_paid_at is not null
                or cur.expires_at is null
                or cur.expires_at > now()) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select * into rc from public.referral_codes
   where upper(code) = upper(ref_code) and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown code');
  end if;
  if rc.user_id = uid then
    return jsonb_build_object('ok', false, 'error', 'self referral');
  end if;

  insert into public.referrals (
    referred_user_id, referrer_user_id, code, source, party_id,
    rate_bps, duration_months, expires_at
  ) values (
    uid, rc.user_id, rc.code, src, party,
    rc.rate_bps, rc.duration_months, now() + interval '90 days'
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

  return jsonb_build_object('ok', true, 'referrer', rc.user_id);
end;
$$;

revoke execute on function public.attribute_referral(text, text, uuid) from public, anon;
grant  execute on function public.attribute_referral(text, text, uuid) to authenticated;

create or replace function public.attribute_party_join(party uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

  select * into rc from public.referral_codes where user_id = host and active;

  insert into public.referrals (
    referred_user_id, referrer_user_id, code, source, party_id,
    rate_bps, duration_months, expires_at
  ) values (
    uid, host, rc.code, 'party', party,
    coalesce(rc.rate_bps, 2000), coalesce(rc.duration_months, 12),
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
grant  execute on function public.attribute_party_join(uuid) to authenticated;

-- Once a referral earns, it stops being replaceable: clear the expiry so the
-- checks above treat it as permanent. accrueReferral sets first_paid_at, and
-- this keeps the two facts consistent rather than relying on every reader to
-- remember the rule.
create or replace function public.lock_converted_referral()
returns trigger
language plpgsql
as $$
begin
  if new.first_paid_at is not null then new.expires_at := null; end if;
  return new;
end;
$$;

drop trigger if exists referrals_lock_on_convert on public.referrals;
create trigger referrals_lock_on_convert
  before insert or update on public.referrals
  for each row execute function public.lock_converted_referral();
