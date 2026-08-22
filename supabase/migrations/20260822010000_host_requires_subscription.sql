-- Hosting requires an ACTIVE SUBSCRIPTION, enforced in the database.
--
-- The client already hides the button and canHost() checks entitlement, but
-- neither is a control: the insert policy accepted any authenticated user, so a
-- crafted request could create a party from a lapsed account and hand its owner
-- the whole catalogue back through a party they host for themselves.
--
-- Safe to re-run.

create or replace function public.can_host_party()
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

revoke execute on function public.can_host_party() from public, anon;
grant  execute on function public.can_host_party() to authenticated;

-- Split the old catch-all "for all" policy: reading and ending your own parties
-- stays open to the host, but CREATING one now requires entitlement. A lapsed
-- host must still be able to close a party they already started.
drop policy if exists "host manages own parties" on public.parties;

create policy "host reads own parties" on public.parties
  for select to authenticated using (host_user_id = auth.uid());

create policy "host updates own parties" on public.parties
  for update to authenticated
  using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());

create policy "entitled host creates parties" on public.parties
  for insert to authenticated
  with check (host_user_id = auth.uid() and public.can_host_party());

create policy "host deletes own parties" on public.parties
  for delete to authenticated using (host_user_id = auth.uid());
