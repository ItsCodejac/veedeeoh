-- public.profiles: row creation, access, and what the owner may change.
--
-- The table was made in the dashboard, so it never went through a migration and
-- nothing in the repo describes it. This brings it up to the standard the rest
-- of the schema is held to, and it is written to be safe on a table whose
-- current policies are unknown: it replaces the whole policy set rather than
-- editing around whatever is there.
--
-- THE ONE THAT MATTERS. RLS restricts ROWS, never COLUMNS. A policy of the
-- shape `for update using (id = auth.uid())` -- which is what the dashboard's
-- "enable update for users based on user_id" template produces -- lets the
-- owner PATCH any column in their own row through PostgREST. That includes
-- tier and tier_expires. One request:
--
--   PATCH /rest/v1/profiles?id=eq.<me>   {"tier":"founder_vip","tier_expires":null}
--
-- and the account is comped forever, with the subscription, the credit meter
-- and the join cap all reading a value the account set for itself. Column
-- privileges are the only thing that stops it, so the update grant is
-- enumerated column by column below.
--
-- Safe to re-run.

alter table public.profiles enable row level security;

-- ===========================================================================
-- 1. Replace the policy set wholesale
-- ===========================================================================
--
-- By name is not possible: these were made by hand and the names are not in the
-- repo. Dropping everything is safe here because the full intended set is
-- recreated immediately below, and because no client path reads another user's
-- profiles row directly -- every cross-account read (public_profile,
-- public_parties, party_by_code) goes through a SECURITY DEFINER function that
-- bypasses RLS by design.

do $$
declare pol record;
begin
  for pol in select polname from pg_policy where polrelid = 'public.profiles'::regclass
  loop
    execute format('drop policy if exists %I on public.profiles', pol.polname);
  end loop;
end $$;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy: rows are created by the signup trigger below, which runs as
-- definer. No DELETE policy: deleting the account row would orphan the Stripe
-- customer and the referral ledger. Account deletion goes through the app's
-- delete path, which is service-role.

-- ===========================================================================
-- 2. Column privileges: what the owner may actually change
-- ===========================================================================
--
-- Built from the columns that exist rather than written out flat, so this does
-- not fail on a database where one of them has not been added yet.

do $$
declare
  editable text[] := array[
    'display_name', 'bio',                                  -- public profile
    'region', 'hosts_weekday', 'hosts_hour', 'hosts_tz',    -- when and where they host
    'social_platform', 'social_handle'                      -- their channel
  ];
  present text;
begin
  revoke update on public.profiles from authenticated;
  revoke insert, delete on public.profiles from authenticated, anon;

  select string_agg(quote_ident(c.column_name), ', ')
    into present
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and c.column_name = any(editable);

  if present is not null then
    execute format('grant update (%s) on public.profiles to authenticated', present);
  end if;

  grant select on public.profiles to authenticated;
end $$;

-- public_handle is deliberately NOT in that list. It needs a uniqueness check
-- and a format check, both of which live in claim_handle(); a direct update
-- would walk around them. Same reasoning for tier, seats, credits and the
-- stripe ids, which belong to the webhook and the admin path.

-- ===========================================================================
-- 3. Every signed-in user has a row
-- ===========================================================================
--
-- Nothing created one. A profiles row appeared only when an account reached
-- Stripe checkout, an admin granted it something, or it redeemed an invite --
-- so an ordinary signup had no row at all, and hasActiveAccess() FAILS OPEN on
-- a missing row (deliberately: a transient read failure must not paywall a
-- paying customer). The two together mean a plain signup had unlimited access
-- indefinitely and never appeared in billing.
--
-- The trial length matches what the landing page and the FAQ already promise,
-- so this implements the existing claim rather than inventing a policy.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, tier, tier_expires)
  values (new.id, new.email, 'trial_7day', now() + interval '7 days')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Revoked like every other definer function here. Calling a trigger function
-- directly raises "can only be called as a trigger", so this is hygiene rather
-- than a hole -- but a SECURITY DEFINER function that anyone may execute is
-- exactly the shape of the bug this project already had once, and leaving one
-- around teaches the wrong default.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before the trigger existed. Same seven days:
-- these are accounts that have had unmetered access through the open failure
-- above, so a fresh trial is the generous reading and the safe one -- nobody is
-- locked out by a migration.
insert into public.profiles (id, email, tier, tier_expires)
select u.id, u.email, 'trial_7day', now() + interval '7 days'
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

-- ===========================================================================
-- 4. Indexes the hot paths actually use
-- ===========================================================================
--
-- The Stripe webhook updates by customer id on every subscription event, and
-- the admin panel looks accounts up by email. Both were sequential scans.

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

create index if not exists profiles_email_lower_idx
  on public.profiles (lower(email));

comment on table public.profiles is
  'One row per auth user: identity, tier, seats, credits and public profile. '
  'Created by on_auth_user_created. The owner may read their own row and update '
  'only the presentation columns -- tier, seats, credits and stripe ids are '
  'writable by the service role alone, enforced with column privileges because '
  'RLS restricts rows and not columns.';
