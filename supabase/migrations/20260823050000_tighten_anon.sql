-- Take write privileges away from anon, and stop three policies applying to
-- every role.
--
-- Found by running scripts/sql/audit-security.sql against the live database.
--
-- CONTEXT, SO THIS IS NOT READ AS PANIC. Supabase grants anon and authenticated
-- broad table privileges by default and relies on RLS to decide rows. Twenty-
-- five tables reporting "anon can insert/update/delete" is that default, not
-- twenty-five holes: every policy on them is `to authenticated`, and anon has
-- no policy, so anon reaches nothing. This migration is defence in depth. It
-- removes the half of the pair that is doing no work, so that a future policy
-- written `to public` cannot quietly turn a grant nobody remembered into a
-- hole.
--
-- ONE OF THESE IS A REAL BUG, AND IT IS MINE. 20260823040000 set out to stop
-- an account rewriting its own tier, and revoked UPDATE from `authenticated`
-- while leaving it with anon. The audit shows anon still holding column-level
-- UPDATE on profiles.tier, .tier_expires, .seats, .party_credits,
-- .party_credits_exempt, .public_parties_banned and both stripe ids. RLS is the
-- only thing between that and a rewritten subscription, which is exactly the
-- single-layer situation 040000 was written to end.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. anon writes nothing, anywhere, except the one place it must
-- ===========================================================================
--
-- waitlist keeps its INSERT and only its INSERT: the landing page takes an
-- email address from somebody who by definition has no account, and its policy
-- already constrains the row to a plausible one. It had UPDATE, DELETE and
-- TRUNCATE as well, which is nobody's intention -- an anonymous visitor should
-- be able to add themselves to a list and do nothing else to it.

do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     -- 'r' tables and 'v' views alike. Production has no views today, but a
     -- view carries its own grants and is the classic way a locked table gets
     -- read anyway; a loop that silently skips them would be a trap for
     -- whoever adds the first one.
     where n.nspname = 'public' and c.relkind in ('r', 'v')
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t.relname);
  end loop;
end $$;

grant insert on public.waitlist to anon;

-- profiles gets the full treatment its own migration intended: no writes from
-- anon at any level, column grants included.
revoke all on public.profiles from anon;
grant select on public.profiles to anon;   -- harmless: the select policy is `to authenticated`

-- ===========================================================================
-- 2. Three policies applied to PUBLIC rather than to a role
-- ===========================================================================
--
-- `to public` includes anon. These are not exploitable today -- auth.uid() is
-- null for an anonymous request, so `auth.uid() = owner_id` is null and the row
-- is not returned -- but the protection is incidental. Naming the role means
-- the policy says what it means, and stops mattering what auth.uid() returns.
--
-- Recreated rather than altered, because ALTER POLICY cannot change the roles
-- a policy applies to.

drop policy if exists "Users can manage own household profiles" on public.household_profiles;
create policy "Users can manage own household profiles" on public.household_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners can manage household invites" on public.household_invites;
create policy "Owners can manage household invites" on public.household_invites
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Members can view household membership" on public.household_members;
create policy "Members can view household membership" on public.household_members
  for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = member_user_id);
