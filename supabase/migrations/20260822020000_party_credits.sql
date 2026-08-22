-- Watch Party credits.
--
-- 1 credit = 10 minutes of hosting, wall clock, independent of viewer count.
-- Subscribers are granted 60/month (10 hours) which roll over to a spendable
-- ceiling of 180 (30 hours). Top-ups are $1 for 24 credits.
--
-- Credits are a PREMIUM FEATURE, not cost recovery: a two-hour party costs
-- roughly $0.0014 in Cloudflare requests and no egress at all. Pricing is set
-- for comprehensibility, not to recover anything.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Balances. Spendable is capped; the lifetime counters are not.
-- ===========================================================================

alter table public.profiles
  add column if not exists party_credits         int     not null default 0,
  add column if not exists party_credits_accrued int     not null default 0,
  add column if not exists party_credits_spent   int     not null default 0,
  add column if not exists party_credits_exempt  boolean not null default false,
  add column if not exists credits_granted_for   date;

comment on column public.profiles.party_credits is
  'Spendable balance, capped at 180 (30h). Granted + purchased.';
comment on column public.profiles.party_credits_accrued is
  'Lifetime granted, UNCAPPED -- counts credits that overflowed the spendable '
  'cap and expired unspent. Drives the 240-credit free-month trigger, which '
  'would otherwise be unreachable because 240 > the 180 cap.';
comment on column public.profiles.party_credits_exempt is
  'Owner-granted, bypasses the balance check entirely. Its own axis, NOT a tier '
  'property: exemption is granted and revoked per account regardless of what '
  'that account pays.';
comment on column public.profiles.credits_granted_for is
  'First day of the month the last allowance was granted for. Makes granting '
  'idempotent -- a webhook retry or a double cron run cannot double-grant.';

-- ===========================================================================
-- 2. Ledger. Append-only; the balance is a cache of this.
-- ===========================================================================

create table if not exists public.party_credit_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      int  not null,                       -- + granted/purchased, - spent
  reason     text not null check (reason in ('monthly_grant', 'purchase', 'spend', 'admin')),
  party_id   uuid references public.parties(id) on delete set null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists party_credit_ledger_user_idx
  on public.party_credit_ledger (user_id, created_at desc);

-- ===========================================================================
-- 3. Free months. Dual trigger, three a year.
-- ===========================================================================
--
-- 240 credits ACCRUED UNUSED -> a free month. Someone sitting on that much is
-- about to cancel over "I pay for something I don't use", so this is an
-- automatic, well-timed churn save.
--
-- 120 credits SPENT HOSTING -> a free month. Half the credits, because hosting
-- is the viral loop: every join is an affiliate attribution row, and party
-- links are how lapsed guests get pulled back toward converting. An
-- accrual-only trigger would pay people not to host, which starves it.

create table if not exists public.free_month_grants (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  trigger    text not null check (trigger in ('accrued', 'spent')),
  milestone  int  not null,                       -- which multiple was crossed
  year       int  not null,
  applied_at timestamptz,                         -- set once Stripe accepted it
  stripe_ref text,
  created_at timestamptz not null default now(),
  -- One grant per milestone per trigger, forever. This unique key is what makes
  -- issuance idempotent; without it a retry mints free months.
  unique (user_id, trigger, milestone)
);
create index if not exists free_month_grants_user_idx on public.free_month_grants (user_id, year);

alter table public.party_credit_ledger enable row level security;
alter table public.free_month_grants   enable row level security;

drop policy if exists "read own credit ledger" on public.party_credit_ledger;
create policy "read own credit ledger" on public.party_credit_ledger
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own free months" on public.free_month_grants;
create policy "read own free months" on public.free_month_grants
  for select to authenticated using (user_id = auth.uid());
-- No insert/update policies anywhere: balances move only through the definer
-- functions below and the service-role webhook. A client that can write its own
-- balance has no balance.

-- ===========================================================================
-- 4. Functions
-- ===========================================================================

-- Grant this month's allowance. Idempotent on credits_granted_for, so a webhook
-- retry, a double cron run and a manual re-run are all harmless.
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
          case when after - before < grant_size
               then 'capped at 180; ' || (grant_size - (after - before)) || ' overflowed'
               else null end);

  return jsonb_build_object('ok', true, 'balance', after, 'granted', after - before);
end;
$$;

revoke execute on function public.grant_monthly_credits(uuid) from public, anon, authenticated;

-- Spend credits for a party. Returns ok=false rather than raising, so the
-- caller can warn instead of failing the party outright.
create or replace function public.spend_party_credits(minutes int, party uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  cost int  := greatest(1, ceil(minutes::numeric / 10)::int);
  prof public.profiles%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into prof from public.profiles where id = uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no account');
  end if;

  -- Exemption is checked BEFORE the balance, and records nothing. An exempt
  -- account has no meaningful balance to decrement and should never accumulate
  -- spend history that could later trigger a free month it did not earn.
  if prof.party_credits_exempt then
    return jsonb_build_object('ok', true, 'exempt', true);
  end if;

  if prof.party_credits < cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient credits',
                              'balance', prof.party_credits, 'needed', cost);
  end if;

  update public.profiles
     set party_credits       = party_credits - cost,
         party_credits_spent = party_credits_spent + cost
   where id = uid;

  insert into public.party_credit_ledger (user_id, delta, reason, party_id)
  values (uid, -cost, 'spend', party);

  return jsonb_build_object('ok', true, 'spent', cost, 'balance', prof.party_credits - cost);
end;
$$;

revoke execute on function public.spend_party_credits(int, uuid) from public, anon;
grant  execute on function public.spend_party_credits(int, uuid) to authenticated;

-- Which free months this account has earned but not yet been given. Returns the
-- rows it just claimed, so the backend can apply each to Stripe and mark it.
-- Claiming and applying are separate on purpose: the unique key makes the claim
-- atomic, and a Stripe failure leaves applied_at null to be retried rather than
-- silently minting or losing a month.
create or replace function public.claim_free_months(target uuid)
returns setof public.free_month_grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prof     public.profiles%rowtype;
  yr       int := extract(year from now())::int;
  used     int;
  earned   int;
  i        int;
begin
  select * into prof from public.profiles where id = target for update;
  if not found then return; end if;

  select count(*) into used from public.free_month_grants
   where user_id = target and year = yr;

  -- Three a year, either path.
  for i in 1..3 loop
    exit when used >= 3;

    earned := prof.party_credits_accrued / 240;
    if earned >= i and not exists (
      select 1 from public.free_month_grants
       where user_id = target and trigger = 'accrued' and milestone = i
    ) then
      insert into public.free_month_grants (user_id, trigger, milestone, year)
      values (target, 'accrued', i, yr)
      on conflict do nothing;
      used := used + 1;
    end if;

    earned := prof.party_credits_spent / 120;
    if used < 3 and earned >= i and not exists (
      select 1 from public.free_month_grants
       where user_id = target and trigger = 'spent' and milestone = i
    ) then
      insert into public.free_month_grants (user_id, trigger, milestone, year)
      values (target, 'spent', i, yr)
      on conflict do nothing;
      used := used + 1;
    end if;
  end loop;

  return query
    select * from public.free_month_grants
     where user_id = target and applied_at is null;
end;
$$;

revoke execute on function public.claim_free_months(uuid) from public, anon, authenticated;

-- What the account should be shown. One round trip for the whole billing card.
create or replace function public.party_credit_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'balance',      p.party_credits,
    'exempt',       p.party_credits_exempt,
    'accrued',      p.party_credits_accrued,
    'spent',        p.party_credits_spent,
    'cap',          180,
    -- Distance to whichever free month is closer, so the card can show one
    -- honest number instead of two competing progress bars.
    'to_free_accrued', 240 - (p.party_credits_accrued % 240),
    'to_free_spent',   120 - (p.party_credits_spent % 120),
    'free_months_this_year', (
      select count(*) from public.free_month_grants g
       where g.user_id = p.id and g.year = extract(year from now())::int
    )
  )
  from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.party_credit_summary() from public, anon;
grant  execute on function public.party_credit_summary() to authenticated;
