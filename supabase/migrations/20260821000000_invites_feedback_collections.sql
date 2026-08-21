-- veedeeoh: beta invites, feedback capture, and curated collections.
--
-- Run once in the Supabase SQL editor. Safe to re-run: everything is guarded
-- with "if not exists" / "or replace".
--
-- SECURITY POSTURE
--   The admin control panel runs locally and uses the service-role key, which
--   bypasses RLS. So none of these tables grant write access to anon or
--   authenticated except where an end user genuinely needs it (submitting
--   feedback, redeeming their own invite). Default-deny everywhere else.

-- ===========================================================================
-- 1. BETA INVITES  (task #4)
--    Grants a tier to a NEW account. Distinct from household_invites, which
--    shares seats within one existing account.
-- ===========================================================================

create table if not exists public.beta_invites (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  email         text not null,
  tier          text not null default 'founder_vip',
  tier_expires  timestamptz,                       -- null = never expires
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  redeemed_by   uuid references auth.users(id),
  redeemed_at   timestamptz,
  revoked_at    timestamptz
);

create index if not exists beta_invites_email_idx on public.beta_invites (lower(email));
alter table public.beta_invites enable row level security;
-- No policies: anon and authenticated get nothing. The panel uses service-role,
-- and redemption goes through the definer function below.

-- Redeem an invite for the CALLING user. Security definer because the invitee
-- must be able to flip their own tier without write access to either table.
create or replace function public.redeem_beta_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.beta_invites%rowtype;
  uid uuid := auth.uid();
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

  update public.profiles
     set tier = inv.tier, tier_expires = inv.tier_expires
   where id = uid;

  update public.beta_invites
     set redeemed_by = uid, redeemed_at = now()
   where id = inv.id;

  return jsonb_build_object('ok', true, 'tier', inv.tier);
end;
$$;

revoke execute on function public.redeem_beta_invite(text) from public, anon;
grant  execute on function public.redeem_beta_invite(text) to authenticated;

-- ===========================================================================
-- 2. FEEDBACK  (task #5)
--    In-app bug and feature reports, with the context auto-attached so testers
--    are not interrogated about what they were doing.
-- ===========================================================================

create table if not exists public.feedback (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('bug','feature')),
  title            text not null,
  body             text,
  reporter_user_id uuid references auth.users(id) default auth.uid(),
  reporter_email   text,
  profile_id       text,
  profile_is_kids  boolean,
  url              text,
  view             text,
  app_version      text,
  user_agent       text,
  viewport         text,
  console_tail     jsonb,          -- scrub tokens client-side before sending
  status           text not null default 'new'
                     check (status in ('new','triaged','done','wontfix')),
  notes            text            -- owner only; never exposed to reporters
);

create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;

drop policy if exists "insert own feedback" on public.feedback;
create policy "insert own feedback" on public.feedback
  for insert to authenticated
  with check (reporter_user_id = auth.uid());

drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback
  for select to authenticated
  using (reporter_user_id = auth.uid());
-- No update/delete for users. Triage happens in the local panel via service-role.

-- ===========================================================================
-- 3. CURATED COLLECTIONS
--    See docs/plans/2026-08-21-curated-content-collections-design.md.
--    A human approves; automation only proposes. Restricted profiles show only
--    what is in a collection at or below their tier.
-- ===========================================================================

create table if not exists public.collections (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('platform','household')),
  owner_id     uuid references auth.users(id),      -- null for platform rows
  name         text not null,
  min_age      smallint,                            -- 0-3, null = no age meaning
  show_as_tab  boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint household_rows_have_an_owner
    check (scope = 'platform' or owner_id is not null)
);

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  content_id    text not null,                      -- provider id: tubi:123, archive:x, pluto _id
  kind          text not null default 'title' check (kind in ('title','series')),
  added_at      timestamptz not null default now(),
  primary key (collection_id, content_id)
);

create table if not exists public.profile_exclusions (
  profile_id uuid not null,
  content_id text not null,
  owner_id   uuid not null references auth.users(id) default auth.uid(),
  primary key (profile_id, content_id)
);

alter table public.collections        enable row level security;
alter table public.collection_items   enable row level security;
alter table public.profile_exclusions enable row level security;

-- Platform collections are the shared baseline: readable by everyone signed in,
-- writable only via service-role (the local panel).
drop policy if exists "read platform or own collections" on public.collections;
create policy "read platform or own collections" on public.collections
  for select to authenticated
  using (scope = 'platform' or owner_id = auth.uid());

drop policy if exists "write own collections" on public.collections;
create policy "write own collections" on public.collections
  for all to authenticated
  using (scope = 'household' and owner_id = auth.uid())
  with check (scope = 'household' and owner_id = auth.uid());

drop policy if exists "read items of visible collections" on public.collection_items;
create policy "read items of visible collections" on public.collection_items
  for select to authenticated
  using (exists (
    select 1 from public.collections c
     where c.id = collection_id
       and (c.scope = 'platform' or c.owner_id = auth.uid())));

drop policy if exists "write items of own collections" on public.collection_items;
create policy "write items of own collections" on public.collection_items
  for all to authenticated
  using (exists (
    select 1 from public.collections c
     where c.id = collection_id and c.scope = 'household' and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.collections c
     where c.id = collection_id and c.scope = 'household' and c.owner_id = auth.uid()));

drop policy if exists "own exclusions" on public.profile_exclusions;
create policy "own exclusions" on public.profile_exclusions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ===========================================================================
-- 4. HOUSEKEEPING from the 2026-08-21 Supabase linter warnings
--    handle_new_user is a SIGNUP TRIGGER and was reachable at
--    /rest/v1/rpc/handle_new_user by the anon role. Postgres does not check
--    EXECUTE on a trigger function when the trigger fires, so revoking is safe.
--    Verify signup still works after running this.
-- ===========================================================================

revoke execute on function public.handle_new_user() from public, anon, authenticated;
