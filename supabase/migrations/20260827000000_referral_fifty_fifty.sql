-- The affiliate share becomes half of net subscription revenue, for as long as
-- the referred account keeps paying.
--
-- WHY HALF, AND WHY ONLY THE SUBSCRIPTION. The $4 subscription is margin: the
-- catalogue costs nothing to carry, and one more browsing account rounds to
-- nothing in hosting. Watch party credits are the opposite -- they buy Durable
-- Object time we are billed for by the minute, so they are the one line where
-- the money is already spent before it arrives. The subscription is therefore
-- split down the middle and the credits are not shared at all.
--
-- That split needed no code change, which is worth recording: accrueReferral
-- runs only on `invoice.paid`, and a credit top-up is a one-time Checkout
-- payment that produces no invoice, so credits have never paid commission.
-- Commission is computed on total_excluding_tax, because tax is collected for a
-- tax authority and was never ours to divide.
--
-- WHY duration_months = 0. Zero means the life of the account, and the offer is
-- deliberately open-ended: half of every payment for as long as that person
-- stays subscribed, rather than half for a year and nothing after. It also
-- removes the expiry arithmetic from accrueReferral, which skips the window
-- check entirely when the term is zero.

alter table public.referral_codes
  alter column rate_bps set default 5000,
  alter column duration_months set default 0;

comment on column public.referral_codes.rate_bps is
  'Share of NET subscription revenue, in basis points. Default 5000 = 50%. '
  'Snapshotted onto public.referrals at attribution time. Watch party credits '
  'are excluded entirely: they pay for Durable Object time, not margin.';

comment on column public.referral_codes.duration_months is
  'How long the share runs, from the first payment. Default 0 = the life of the '
  'account.';

-- Existing codes are brought onto the new terms rather than left behind.
--
-- Normally this would be exactly the wrong thing to do -- terms are snapshotted
-- per referral precisely so a later change cannot rewrite an agreement somebody
-- is operating under. It is safe here for two specific reasons, both checked
-- before running it: all four codes belong to the operator, and no commission
-- has ever been earned on any of them (referral_earnings is empty, and live
-- Stripe has no charges at all). Nobody's expectation is being altered.
--
-- Every one of these moves upward on both axes: 30%/life, 20%/12mo and 12%/6mo
-- all become 50%/life.
update public.referral_codes
   set rate_bps = 5000, duration_months = 0
 where rate_bps <> 5000 or duration_months <> 0;

-- The three already-attributed referrals carry their own snapshot taken at
-- 20%/12mo. Left as-is they would quietly pay less than the published offer the
-- moment one of them subscribed.
update public.referrals
   set rate_bps = 5000, duration_months = 0
 where first_paid_at is null
   and (rate_bps <> 5000 or duration_months <> 0);

-- The one place a rate was hardcoded: the fallback for a host who has never
-- opened the Earn screen and so has no referral_codes row. It was 20%/12mo,
-- which would have paid a party-sourced signup less than the offer says.
--
-- Reproduced from the live definition with those two numbers changed.
create or replace function public.attribute_party_join(party uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  select * into rc from public.referral_codes where user_id = host and active;

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
$function$;

revoke execute on function public.attribute_party_join(uuid) from public, anon;
grant execute on function public.attribute_party_join(uuid) to authenticated;
