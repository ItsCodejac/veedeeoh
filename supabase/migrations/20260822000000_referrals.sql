-- Affiliate / referral revenue share.
--
-- Attribution is FIRST TOUCH and PERMANENT: the first referrer recorded for an
-- account is the only one that account ever has. Last-touch would let anyone
-- overwrite a genuine referral by sending their own link afterwards, and the
-- affiliate whose link actually did the work would silently lose the credit.
--
-- Watch-party joins are ONE source among several, not the system. A guest who
-- joins a party had to sign in, so the host is known without cookies -- but
-- plain referral links, creator partners and household invites all land in the
-- same table with a different `source`.
--
-- Rates and durations are SNAPSHOTTED onto the referral row at attribution
-- time. Changing the default rate later must not silently rewrite what an
-- existing affiliate was promised.
--
-- Payouts are deliberately NOT here. This migration builds the ledger; money
-- leaves by hand until Stripe Connect is wired, and `paid_out_at` is how a
-- manual payout is recorded against the rows it settled.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Codes. One per user, minted on demand; partners get a better rate.
-- ===========================================================================

create table if not exists public.referral_codes (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  code             text unique not null,
  kind             text not null default 'user'
                     check (kind in ('user', 'partner')),
  rate_bps         int  not null default 2000     -- 20% of net revenue
                     check (rate_bps between 0 and 10000),
  duration_months  int  not null default 12       -- 0 = for the life of the account
                     check (duration_months >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists referral_codes_code_idx on public.referral_codes (upper(code));

-- ===========================================================================
-- 2. Attribution. One row per referred account, forever.
-- ===========================================================================

create table if not exists public.referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  code             text,
  source           text not null
                     check (source in ('link', 'party', 'household', 'partner')),
  party_id         uuid references public.parties(id) on delete set null,
  rate_bps         int  not null,                 -- snapshot, see header
  duration_months  int  not null,
  created_at       timestamptz not null default now(),
  first_paid_at    timestamptz,                   -- set by the first accrual
  -- Self-referral is meaningless and is the obvious way to farm commission on
  -- your own subscription. Blocked here as well as in the function, because a
  -- constraint survives a rewrite of the function.
  constraint referrals_no_self check (referrer_user_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id, created_at desc);
create index if not exists referrals_source_idx   on public.referrals (source);

-- ===========================================================================
-- 3. Earnings ledger. Append-only; one row per paid invoice.
-- ===========================================================================

create table if not exists public.referral_earnings (
  id                uuid primary key default gen_random_uuid(),
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  referred_user_id  uuid not null references auth.users(id) on delete cascade,
  -- Stripe retries webhooks, so the same invoice can arrive more than once.
  -- The unique key is what makes accrual idempotent; without it a retry storm
  -- silently doubles what is owed.
  stripe_invoice_id text unique not null,
  currency          text not null default 'usd',
  gross_cents       int  not null,
  rate_bps          int  not null,
  commission_cents  int  not null,
  occurred_at       timestamptz not null default now(),
  paid_out_at       timestamptz,
  payout_ref        text
);

create index if not exists referral_earnings_referrer_idx
  on public.referral_earnings (referrer_user_id, occurred_at desc);
create index if not exists referral_earnings_unpaid_idx
  on public.referral_earnings (referrer_user_id) where paid_out_at is null;

-- ===========================================================================
-- 4. RLS. Affiliates read their own rows and write none of them.
-- ===========================================================================

alter table public.referral_codes    enable row level security;
alter table public.referrals         enable row level security;
alter table public.referral_earnings enable row level security;

drop policy if exists "read own referral code" on public.referral_codes;
create policy "read own referral code" on public.referral_codes
  for select to authenticated using (user_id = auth.uid());

-- A referrer sees who they referred; a referred user sees who referred them.
-- Neither can write: attribution goes through attribute_referral() so the
-- rate snapshot and the self-referral and first-touch rules cannot be skipped.
drop policy if exists "read referrals i am part of" on public.referrals;
create policy "read referrals i am part of" on public.referrals
  for select to authenticated
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

-- Earnings are the referrer's business only. The referred user must NOT see
-- what their referrer earns off them.
drop policy if exists "read own earnings" on public.referral_earnings;
create policy "read own earnings" on public.referral_earnings
  for select to authenticated using (referrer_user_id = auth.uid());

-- ===========================================================================
-- 5. Functions
-- ===========================================================================

-- Mint-on-demand so no backfill is needed and codes only exist for accounts
-- that asked for one.
create or replace function public.ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  c    text;
  try  int  := 0;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select code into c from public.referral_codes where user_id = uid;
  if found then
    return c;
  end if;

  -- Same alphabet as the party join code: no O/0 or I/1, so a code read aloud
  -- or written down still resolves.
  loop
    try := try + 1;
    c := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 7)
    );
    begin
      insert into public.referral_codes (user_id, code) values (uid, c);
      return c;
    exception when unique_violation then
      if try >= 8 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.ensure_referral_code() from public, anon;
grant  execute on function public.ensure_referral_code() to authenticated;

-- Record attribution for the CALLING user. Idempotent and first-touch: a second
-- call is a silent no-op, which is what lets the client call it unconditionally
-- on every boot that carries a ?ref= parameter.
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
  uid uuid := auth.uid();
  rc  public.referral_codes%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- First touch wins. Not an error: the caller cannot know in advance.
  if exists (select 1 from public.referrals where referred_user_id = uid) then
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
    rate_bps, duration_months
  ) values (
    uid, rc.user_id, rc.code, src, party, rc.rate_bps, rc.duration_months
  )
  on conflict (referred_user_id) do nothing;

  return jsonb_build_object('ok', true, 'referrer', rc.user_id);
end;
$$;

revoke execute on function public.attribute_referral(text, text, uuid) from public, anon;
grant  execute on function public.attribute_referral(text, text, uuid) to authenticated;

-- Attribute a watch-party guest to the host. The party is the code here: the
-- host does not need a referral code minted for the credit to land, and the
-- guest never types anything.
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
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if exists (select 1 from public.referrals where referred_user_id = uid) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select host_user_id into host from public.parties where id = party;
  if host is null or host = uid then
    return jsonb_build_object('ok', false, 'error', 'no host');
  end if;

  -- Terms come from the host's own code when they have one, so a partner rate
  -- applies to their party invites too; otherwise the standard default.
  select * into rc from public.referral_codes where user_id = host and active;

  insert into public.referrals (
    referred_user_id, referrer_user_id, code, source, party_id,
    rate_bps, duration_months
  ) values (
    uid, host, rc.code, 'party', party,
    coalesce(rc.rate_bps, 2000), coalesce(rc.duration_months, 12)
  )
  on conflict (referred_user_id) do nothing;

  return jsonb_build_object('ok', true, 'referrer', host);
end;
$$;

revoke execute on function public.attribute_party_join(uuid) from public, anon;
grant  execute on function public.attribute_party_join(uuid) to authenticated;

-- What an affiliate is owed, and what they have already been paid.
create or replace function public.referral_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'referred',      (select count(*) from public.referrals
                       where referrer_user_id = auth.uid()),
    'converted',     (select count(*) from public.referrals
                       where referrer_user_id = auth.uid() and first_paid_at is not null),
    'pending_cents', (select coalesce(sum(commission_cents), 0) from public.referral_earnings
                       where referrer_user_id = auth.uid() and paid_out_at is null),
    'paid_cents',    (select coalesce(sum(commission_cents), 0) from public.referral_earnings
                       where referrer_user_id = auth.uid() and paid_out_at is not null)
  );
$$;

revoke execute on function public.referral_summary() from public, anon;
grant  execute on function public.referral_summary() to authenticated;

comment on table public.referrals is
  'First-touch, permanent attribution. Rate and duration are snapshotted so a '
  'later change to the default terms cannot rewrite an existing agreement.';
comment on table public.referral_earnings is
  'Append-only accrual ledger, one row per paid Stripe invoice. Unique on '
  'stripe_invoice_id so webhook retries cannot double-credit.';
