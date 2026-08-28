-- Re-opening an invite link you already used should not look like a failure.
--
-- accept_household_invite carries a comment reading "Idempotent: already a
-- member -> just consume the invite", and the branch implementing it cannot be
-- reached. The function first looks the invite up with `status = 'pending'`, and
-- the first successful accept sets status to 'accepted', so a second call finds
-- nothing and raises 'invalid or already-used invite' before the membership
-- check ever runs.
--
-- Nobody noticed because nothing could create an invitation until now, so the
-- accept path had never been exercised twice. Re-opening the link is the most
-- ordinary thing a person can do with it: they click it, join, then click it
-- again from the same email later, or the page reloads with ?invite= still in
-- the address bar. The app answers "Couldn't join: invalid or full invite",
-- which reads as "you are not in" to somebody who is.
--
-- The token is still the credential and still has to match. What changes is the
-- order: membership is checked first, so being already in the household is a
-- success rather than the reason the lookup missed.

create or replace function public.accept_household_invite(invite_token text)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
  declare inv public.household_invites; seat_limit int; current_members int;
  begin
    if auth.uid() is null then raise exception 'not authenticated'; end if;

    -- By token alone. Status is judged below, after the caller's own membership
    -- has been considered.
    select * into inv from public.household_invites where token = invite_token;
    if inv.id is null then raise exception 'invalid invite'; end if;

    -- Already in this household. Mark a still-pending invitation spent and
    -- report the household, so a second click is quietly the same answer as the
    -- first rather than an error about a link that worked.
    if exists (
      select 1 from public.household_members
      where owner_id = inv.owner_id and member_user_id = auth.uid()
    ) then
      update public.household_invites set status = 'accepted'
       where id = inv.id and status = 'pending';
      return inv.owner_id;
    end if;

    -- Not a member, so the invitation itself has to still be good. Revoked and
    -- already-redeemed links land here.
    if inv.status <> 'pending' then
      raise exception 'that invitation has already been used or was cancelled';
    end if;

    select coalesce(seats, 3) into seat_limit from public.profiles where id = inv.owner_id;
    select count(*) into current_members from public.household_members where owner_id = inv.owner_id;
    -- The owner occupies a seat, hence seat_limit - 1.
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

revoke execute on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated;
