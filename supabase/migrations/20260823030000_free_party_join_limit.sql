-- A free cloud account gets a taste of watch parties, not a season ticket.
--
-- Joining was unlimited for anyone signed in. That was right when it was the
-- consolation prize for a lapsed account -- follow the links you are sent, do
-- not browse -- but unlimited is not a taste. Somebody in a household where one
-- person pays can attend every party forever and never need an account of
-- their own, which is the paid feature reached by standing next to it.
--
-- FOUR A MONTH. One a week. Enough to be in the thing your friend keeps
-- inviting you to and to find out whether you want it; not enough to be your
-- Friday night arrangement indefinitely.
--
-- COUNTED IN PARTIES, NOT JOINS, and that comes free from the schema:
-- party_joins is keyed (party_id, user_id), so a refresh, a dropped socket or
-- the auto-reconnect we added never creates a second row and never costs a
-- second party. The INSERT policy fires only for a party this account has not
-- been in before, which is exactly the thing worth counting.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. One definition of "on a plan"
-- ===========================================================================
--
-- The tier list was written out inside can_host_party(). It is about to be
-- needed in two more places, and three copies of a list of tier names is how
-- a tier gets added to two of them.

create or replace function public.is_entitled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.tier in ('founder_vip', 'giveaway', 'cloud_paid', 'trial_7day', 'trial_dollar_month')
       and (p.tier_expires is null or p.tier_expires > now())
  );
$$;

revoke execute on function public.is_entitled() from public, anon;
grant  execute on function public.is_entitled() to authenticated;

create or replace function public.can_host_party()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_entitled();
$$;

revoke execute on function public.can_host_party() from public, anon;
grant  execute on function public.can_host_party() to authenticated;

-- ===========================================================================
-- 2. How many parties this account has been in this month
-- ===========================================================================

create or replace function public.party_joins_this_month()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.party_joins
   where user_id = auth.uid()
     and joined_at >= date_trunc('month', now());
$$;

revoke execute on function public.party_joins_this_month() from public, anon;
grant  execute on function public.party_joins_this_month() to authenticated;

-- ===========================================================================
-- 3. The limit itself
-- ===========================================================================

create or replace function public.can_join_party()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_entitled() or public.party_joins_this_month() < 4;
$$;

revoke execute on function public.can_join_party() from public, anon;
grant  execute on function public.can_join_party() to authenticated;

-- What the UI needs in order to say something useful before the door shuts.
create or replace function public.party_join_allowance()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'entitled',  public.is_entitled(),
    'used',      public.party_joins_this_month(),
    'limit',     4,
    'remaining', greatest(0, 4 - public.party_joins_this_month()),
    'can_join',  public.can_join_party()
  );
$$;

revoke execute on function public.party_join_allowance() from public, anon;
grant  execute on function public.party_join_allowance() to authenticated;

-- ===========================================================================
-- 4. Enforced where it cannot be argued with
-- ===========================================================================
--
-- In the RLS policy, not in the client. The client check exists to explain the
-- limit; this is the one that holds when somebody opens the console.

drop policy if exists "record own join" on public.party_joins;
create policy "record own join" on public.party_joins
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_join_party());

-- The client upserts, so the conflict path is an UPDATE, and an UPDATE with no
-- policy is denied -- which today surfaces as a logged warning on every rejoin
-- and nothing worse, because the row it wanted already exists. Give it a policy
-- rather than leave a known-failing write in the hot path: it cannot be used to
-- gain a join, since updating a row you already have creates nothing.
drop policy if exists "touch own join" on public.party_joins;
create policy "touch own join" on public.party_joins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on policy "record own join" on public.party_joins is
  'A free account may be in 4 distinct parties a month; an entitled one is '
  'unlimited. Keyed (party_id, user_id), so rejoining a party already attended '
  'is an UPDATE and never reaches this check.';
