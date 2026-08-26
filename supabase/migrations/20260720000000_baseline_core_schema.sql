-- Baseline: the seven tables the repo never had a migration for.
--
-- WHY THIS FILE EXISTS. profiles, household_profiles, household_members,
-- household_invites, favorites, watch_progress and catalog_cache were created
-- by hand against the live Supabase project. Twenty-six migrations followed and
-- every one of them ALTERs a table that no migration ever created. So the repo
-- could not build a working database: a fresh `supabase db push` failed on the
-- first ALTER, which means the self-host tier could not actually be self-hosted,
-- and there was no path back from losing the project. The legal review pack said
-- as much and asked for a schema dump before anyone relied on it.
--
-- This was read out of the live database on 26 August 2026, not written from
-- memory. It reproduces what is there, including things that should probably
-- change -- see the two notes below. Fixing them here would mean this file no
-- longer describes production, which is the one job it has.
--
-- DATED BEFORE EVERYTHING ELSE ON PURPOSE. The ALTERs need these tables to
-- exist first, so it has to sort ahead of 20260721000000. On the live project
-- the migration history has no record of it, so the CLI will want to skip it as
-- out of order; it is written to be idempotent so that applying it there with
-- --include-all changes nothing.

-- ---------------------------------------------------------------- profiles ---
-- One row per account, mirroring auth.users. Created by the handle_new_user
-- trigger, which arrives in a later migration.
--
-- NOTE, NOT FIXED HERE: id has no foreign key to auth.users. Deleting an auth
-- user leaves the profile behind, and the same is true of household_profiles
-- .user_id, household_members.owner_id and .member_user_id, and
-- household_invites.owner_id. Account deletion clears these in application code
-- instead. Adding the constraints needs an orphan sweep first, so it is its own
-- change rather than a side effect of writing the schema down.
create table if not exists public.profiles (
  id                      uuid primary key,
  email                   text not null,
  must_change_password    boolean default false,
  created_at              timestamptz default now(),
  tier                    text default 'cloud_paid',
  stripe_customer_id      text,
  stripe_subscription_id  text,
  tier_expires            timestamptz,
  seats                   integer not null default 3,
  party_credits           integer not null default 0,
  party_credits_accrued   integer not null default 0,
  party_credits_spent     integer not null default 0,
  party_credits_exempt    boolean not null default false,
  credits_granted_for     date,
  trial_email_sent        text,
  social_platform         text,
  social_handle           text,
  public_parties_banned   boolean not null default false,
  public_handle           text,
  display_name            text,
  bio                     text,
  region                  text,
  hosts_weekday           smallint,
  hosts_hour              smallint,
  hosts_tz                text
);

-- The public-presence fields are user-authored and reach other people's screens,
-- so each one is bounded in the database rather than only in the form.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_check') then
    alter table public.profiles add constraint profiles_bio_check
      check (bio is null or char_length(bio) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_check') then
    alter table public.profiles add constraint profiles_display_name_check
      check (display_name is null or (char_length(display_name) between 1 and 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_public_handle_check') then
    alter table public.profiles add constraint profiles_public_handle_check
      check (public_handle is null or public_handle ~ '^[a-z0-9_]{3,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_region_check') then
    alter table public.profiles add constraint profiles_region_check
      check (region is null or region ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_social_platform_check') then
    alter table public.profiles add constraint profiles_social_platform_check
      check (social_platform is null or social_platform in
             ('discord','twitch','youtube','x','tiktok','instagram'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_social_handle_check') then
    alter table public.profiles add constraint profiles_social_handle_check
      check (social_handle is null or social_handle ~ '^[A-Za-z0-9_.\-]{2,32}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_hosts_weekday_check') then
    alter table public.profiles add constraint profiles_hosts_weekday_check
      check (hosts_weekday is null or hosts_weekday between 0 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_hosts_hour_check') then
    alter table public.profiles add constraint profiles_hosts_hour_check
      check (hosts_hour is null or hosts_hour between 0 and 23);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_hosts_tz_check') then
    alter table public.profiles add constraint profiles_hosts_tz_check
      check (hosts_tz is null or char_length(hosts_tz) <= 64);
  end if;
end $$;

-- Handles are claimed case-folded, and the partial unique index lets the many
-- accounts without one coexist.
create unique index if not exists profiles_public_handle_key
  on public.profiles (public_handle) where public_handle is not null;

-- Sign-in looks accounts up case-insensitively, so the index has to match.
create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

-- NOTE, NOT FIXED HERE: these two index the same column and only one is needed.
-- Both are live, so both are recorded; dropping one is a separate change.
create index if not exists idx_profiles_stripe_customer on public.profiles (stripe_customer_id);
create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

-- ------------------------------------------------- the profile row itself ---
-- What actually creates a profiles row. It has to be here rather than in
-- 20260823040000 where it currently lives, because 20260821000000 revokes
-- execute on it, and a revoke against a function that does not exist yet is a
-- hard error. On the live project that revoke worked only because the function
-- had been created by hand months earlier -- which is the whole failure this
-- baseline exists to correct. 20260823040000 re-asserts the identical
-- definition; the two agree, so applying both is a no-op.
--
-- on conflict do nothing because signup can be retried and a duplicate must not
-- fail the insert into auth.users that fired this.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, tier, tier_expires)
  values (new.id, new.email, 'trial_7day', now() + interval '7 days')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------ household_profiles ---
-- The "who is watching" avatars. A profile is not an account: one account owns
-- several, and household members borrow the owner's.
create table if not exists public.household_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  name            text not null,
  avatar_color    text default '#c5f04e',
  is_kids         boolean default false,
  max_rating      text default 'TV-MA',
  pin             text,
  created_at      timestamptz default now(),
  avatar_url      text,
  allowed_ratings text[],
  avatar_recipe   jsonb
);

-- ------------------------------------------------------- household_members ---
-- Who else may use this account's profiles. The unique pair is what stops the
-- same person being seated twice and makes accept_household_invite idempotent.
create table if not exists public.household_members (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  member_user_id uuid not null,
  profile_id     uuid,
  joined_at      timestamptz default now(),
  unique (owner_id, member_user_id)
);

-- ------------------------------------------------------- household_invites ---
-- The token is generated in the database, so an invite link never depends on the
-- client picking something unguessable.
create table if not exists public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  invited_email text not null,
  profile_name  text,
  token         text not null unique default encode(gen_random_bytes(16), 'hex'),
  status        text default 'pending',
  created_at    timestamptz default now()
);

-- ---------------------------------------------------------------- content ---
-- Both of these hang off a profile rather than an account, because My List and
-- resume position belong to the person watching, not the person paying. The
-- cascade is what makes deleting a profile actually delete their history.
create table if not exists public.favorites (
  profile_id uuid not null references public.household_profiles(id) on delete cascade,
  content_id text not null,
  title      text,
  poster     text,
  created_at timestamptz not null default now(),
  primary key (profile_id, content_id)
);

create table if not exists public.watch_progress (
  profile_id    uuid not null references public.household_profiles(id) on delete cascade,
  content_id    text not null,
  title         text,
  position_secs double precision not null default 0,
  duration_secs double precision,
  completed     boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (profile_id, content_id)
);

-- ----------------------------------------------------------- catalog_cache ---
-- One warmed catalogue per region, written by the cron and read by everyone.
-- Signed stream URLs are deliberately not stored here; they are resolved on
-- click, because a cached one expires and a cached one is also a hotlink.
create table if not exists public.catalog_cache (
  region     text primary key,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------- access predicates ---
-- These two decide almost every row-level policy in the schema and neither was
-- in the repo. Both are SECURITY DEFINER with a pinned search_path: they read
-- tables the caller cannot read directly, which is the point, and the pinned
-- path is what stops a caller resolving those names to something of their own.

-- Is the caller allowed to act as this viewing profile: their own, or one
-- belonging to a household they have been seated in.
create or replace function public.can_use_profile(pid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists(
    select 1 from public.household_profiles hp
    where hp.id = pid and (
      hp.user_id = auth.uid()
      or exists (
        select 1 from public.household_members m
        where m.owner_id = hp.user_id and m.member_user_id = auth.uid()
      )
    )
  );
$$;

-- Does the caller have a live entitlement. Expiry is checked here rather than
-- in the client, so a stale token cannot keep reading the catalogue.
create or replace function public.has_active_access()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid()
      and tier in ('founder_vip','giveaway','cloud_paid','trial_7day','trial_dollar_month')
      and (tier_expires is null or tier_expires > now())
  );
$$;

-- --------------------------------------------------- accept an invitation ---
-- SECURITY DEFINER because the invitee cannot see the invite row, the owner's
-- seat count, or the membership table. It is idempotent on re-use, and it
-- counts the owner against the seat limit, which is why the comparison is
-- seat_limit - 1.
create or replace function public.accept_household_invite(invite_token text)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
  declare inv public.household_invites; seat_limit int; current_members int;
  begin
    if auth.uid() is null then raise exception 'not authenticated'; end if;

    select * into inv from public.household_invites
      where token = invite_token and status = 'pending';
    if inv.id is null then raise exception 'invalid or already-used invite'; end if;

    if exists (
      select 1 from public.household_members
      where owner_id = inv.owner_id and member_user_id = auth.uid()
    ) then
      update public.household_invites set status = 'accepted' where id = inv.id;
      return inv.owner_id;
    end if;

    select coalesce(seats, 3) into seat_limit from public.profiles where id = inv.owner_id;
    select count(*) into current_members from public.household_members where owner_id = inv.owner_id;
    if current_members >= seat_limit - 1 then
      raise exception 'household is full - % of % seats used (upgrade for more)',
        current_members + 1, seat_limit;
    end if;

    insert into public.household_members (owner_id, member_user_id)
      values (inv.owner_id, auth.uid());
    update public.household_invites set status = 'accepted' where id = inv.id;
    return inv.owner_id;
  end;
$$;

-- --------------------------------------------------------------- policies ---
-- Every table here is RLS-on with no policy for anon, so anonymous reads are
-- refused whatever the grants say.
alter table public.profiles           enable row level security;
alter table public.household_profiles enable row level security;
alter table public.household_members  enable row level security;
alter table public.household_invites  enable row level security;
alter table public.favorites          enable row level security;
alter table public.watch_progress     enable row level security;
alter table public.catalog_cache      enable row level security;

-- profiles: readable and updatable only by its owner. There is deliberately no
-- insert policy -- rows come from the handle_new_user trigger -- and no delete
-- policy, because account deletion runs server-side.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- household_profiles: the owner manages them; a seated member may only read
-- them, which is what lets a member pick a profile without editing the household.
drop policy if exists "Users can manage own household profiles" on public.household_profiles;
create policy "Users can manage own household profiles" on public.household_profiles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists household_profiles_member_read on public.household_profiles;
create policy household_profiles_member_read on public.household_profiles
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.household_members m
      where m.owner_id = household_profiles.user_id and m.member_user_id = auth.uid()
    )
  );

-- household_members: readable by both sides of the relationship. Writes have no
-- policy at all, so seating happens only through accept_household_invite.
drop policy if exists "Members can view household membership" on public.household_members;
create policy "Members can view household membership" on public.household_members
  for select to authenticated using (auth.uid() = owner_id or auth.uid() = member_user_id);

-- household_invites: the owner's to manage. The invitee never reads this table;
-- they redeem a token through the definer function instead.
drop policy if exists "Owners can manage household invites" on public.household_invites;
create policy "Owners can manage household invites" on public.household_invites
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- favorites and watch_progress: keyed on the profile, so the check is whether
-- the caller may act as that profile, not who owns the account.
drop policy if exists favorites_by_profile on public.favorites;
create policy favorites_by_profile on public.favorites
  for all to authenticated using (can_use_profile(profile_id)) with check (can_use_profile(profile_id));

drop policy if exists watch_by_profile on public.watch_progress;
create policy watch_by_profile on public.watch_progress
  for all to authenticated using (can_use_profile(profile_id)) with check (can_use_profile(profile_id));

-- catalog_cache: read-only to anyone with a live entitlement. Writes are the
-- cron's, which runs as the service role and bypasses this.
drop policy if exists catalog_cache_read on public.catalog_cache;
create policy catalog_cache_read on public.catalog_cache
  for select to authenticated using (has_active_access());

-- ----------------------------------------------------------------- grants ---
-- anon keeps select only where it already had it, and every policy above
-- excludes anon, so this grants nothing reachable. Recorded to match live.
grant select on public.profiles to anon;
grant select on public.household_profiles, public.household_members,
                public.household_invites, public.favorites,
                public.watch_progress, public.catalog_cache to anon;

grant select, insert, update, delete on
  public.household_profiles, public.household_members, public.household_invites,
  public.favorites, public.watch_progress, public.catalog_cache to authenticated;

-- profiles is the exception: authenticated may read and update through policy
-- but never insert or delete, because both are server-side operations.
grant select on public.profiles to authenticated;

grant select, insert, update, delete on
  public.profiles, public.household_profiles, public.household_members,
  public.household_invites, public.favorites, public.watch_progress,
  public.catalog_cache to service_role;
