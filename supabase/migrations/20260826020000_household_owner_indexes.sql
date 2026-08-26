-- Three indexes the household tables never had.
--
-- Every one of these columns is the thing its table is looked up by, and none
-- of them was indexed, so each lookup was a sequential scan:
--
--   household_profiles.user_id       - "who is watching", read on every cold
--                                      start and every profile switch
--   household_members.member_user_id - read by can_use_profile, which is the
--                                      predicate behind the RLS policies on
--                                      favorites and watch_progress, so it runs
--                                      on every My List and resume query
--   household_invites.owner_id       - the owner's invite list
--
-- can_use_profile is the one that matters at scale: it is not a page load, it
-- is a per-row policy check. Small tables today, but the shape is wrong and it
-- gets worse in exactly the direction growth takes it.
--
-- Not folded into the baseline on purpose. That file records the schema as it
-- was found; this changes it.

create index if not exists household_profiles_user_idx
  on public.household_profiles (user_id);

create index if not exists household_members_member_idx
  on public.household_members (member_user_id);

create index if not exists household_invites_owner_idx
  on public.household_invites (owner_id);
