-- One open party per host.
--
-- Nothing enforced this. A host could hold any number of rows with ended_at
-- null, and on the live project one had been open since 22 August because the
-- only thing that ever writes ended_at is the host's browser. Close the tab at
-- the wrong moment and the row stays open forever.
--
-- WHY THIS IS NOT JUST THE INDEX. The obvious fix is a partial unique index,
-- and on its own it would be a trap. ended_at is client-written, so a crashed
-- or force-quit tab leaves an open row behind; with a bare unique index that
-- leaked row would refuse every future party the host tried to start, and
-- nothing in the product could clear it. The failure would look like "I cannot
-- host any more" and the cause would be a browser crash days earlier.
--
-- So the invariant is enforced in two pieces:
--
--   1. a BEFORE INSERT trigger that closes whatever the host already has open,
--      which makes starting a party the thing that repairs the leak; and
--   2. the unique index, which is what makes the rule true rather than merely
--      usual -- it holds against direct PostgREST writes as well as the client.
--
-- The trigger runs first, so the index never actually fires in normal use. It
-- is there for the case the trigger cannot cover: two inserts racing inside the
-- same instant.

-- ---------------------------------------------------------------- the sweep ---
-- The one stale row, closed at the time it was last plausibly alive rather than
-- now, so the party history does not claim it ran for four days.
update public.parties
   set ended_at = created_at + interval '6 hours'
 where ended_at is null
   and created_at < now() - interval '6 hours';

-- --------------------------------------------------------------- the trigger ---
-- SECURITY DEFINER because it closes rows on behalf of the inserting host and
-- must not depend on that host's own RLS policy allowing an update to a row the
-- policy may no longer match.
create or replace function public.close_prior_open_parties()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.parties
     set ended_at = now()
   where host_user_id = new.host_user_id
     and ended_at is null
     and id <> new.id;
  return new;
end;
$$;

revoke execute on function public.close_prior_open_parties() from public, anon, authenticated;

drop trigger if exists parties_close_prior on public.parties;
create trigger parties_close_prior
  before insert on public.parties
  for each row execute function public.close_prior_open_parties();

-- ----------------------------------------------------------------- the index ---
create unique index if not exists parties_one_open_per_host
  on public.parties (host_user_id) where ended_at is null;
