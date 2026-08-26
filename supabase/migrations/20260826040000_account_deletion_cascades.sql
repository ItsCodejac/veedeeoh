-- Make deleting an account actually delete the account's data.
--
-- WHAT WAS WRONG. Deleting a user from auth.users removed their parties row and
-- nothing else. household_profiles, watch_progress, favorites and
-- household_invites all survived. Demonstrated on a database built from these
-- migrations: insert a user with a viewing profile, one watch row, one
-- favourite, one invite and one party; delete the user; every count stays at 1
-- except parties.
--
-- The cause is that the four tables created by hand never got the foreign key
-- every migration-created table has. profiles is deleted explicitly by
-- /api/account/delete, so the account row went; the rest had nothing pointing
-- at auth.users and nothing to cascade from. favorites and watch_progress do
-- cascade, but from household_profiles, which was never deleted either.
--
-- WHY IT IS WORSE THAN LEFTOVER ROWS. RLS on these tables keys on auth.uid().
-- With the auth user gone there is no session that can ever match, so the rows
-- become permanently unreadable and permanently undeletable through the app --
-- a viewing history, profile names, PIN hashes and rating limits, kept forever
-- with no way to reach them. household_invites is the sharpest case: it holds
-- the email address of somebody who never had an account here at all.
--
-- The product offers account deletion and the privacy page describes it. This
-- makes the description true.

-- ------------------------------------------------------------ orphan sweep ---
-- Production has none of these, checked before writing this. It runs anyway,
-- because a self-hosted instance built from an older state of this repo will
-- have accumulated exactly the rows described above, and the constraints below
-- cannot be added while they exist. Deleting them is the same operation the
-- account deletion should have performed at the time.
delete from public.favorites f
 where not exists (select 1 from public.household_profiles h where h.id = f.profile_id);

delete from public.watch_progress w
 where not exists (select 1 from public.household_profiles h where h.id = w.profile_id);

delete from public.household_profiles h
 where not exists (select 1 from auth.users u where u.id = h.user_id);

delete from public.household_members m
 where not exists (select 1 from auth.users u where u.id = m.owner_id)
    or not exists (select 1 from auth.users u where u.id = m.member_user_id);

delete from public.household_invites i
 where not exists (select 1 from auth.users u where u.id = i.owner_id);

delete from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

-- ------------------------------------------------------------- constraints ---
-- On delete cascade throughout, matching what every other table in the schema
-- already does. household_members carries two, because either side leaving
-- should end the membership: an owner deleting their account should not strand
-- a member holding a seat in a household that no longer exists.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey') then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'household_profiles_user_id_fkey') then
    alter table public.household_profiles
      add constraint household_profiles_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'household_members_owner_id_fkey') then
    alter table public.household_members
      add constraint household_members_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'household_members_member_user_id_fkey') then
    alter table public.household_members
      add constraint household_members_member_user_id_fkey
      foreign key (member_user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'household_invites_owner_id_fkey') then
    alter table public.household_invites
      add constraint household_invites_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
end $$;
