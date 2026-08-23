-- The seat cap, enforced where it cannot be walked around.
--
-- Extra seats are $2 a month, so the cap is a paid boundary -- and it lived
-- entirely in the browser. The switcher checked it; the Settings "Add a
-- profile" button, added later, did not check anything at all. The audit found
-- an account sitting at four profiles on three seats, which is that second path
-- being used rather than anyone attacking us.
--
-- A limit that only the client enforces is a suggestion. This is the same
-- reasoning as hosting and the join cap: the client explains the rule, the
-- database is the rule.
--
-- A TRIGGER, NOT A POLICY. An RLS policy on household_profiles can only see the
-- row being written; deciding this needs a count of the rows already there plus
-- a lookup of the owner's seats. That is a BEFORE INSERT trigger.
--
-- EXISTING OVER-CAP ACCOUNTS ARE LEFT ALONE. At least one household is already
-- at four on three through the hole this closes. Deleting somebody's fourth
-- profile to enforce a rule they never saw would be taking away a thing they
-- use to fix a mistake that was ours. They keep it; they cannot add a fifth.
--
-- Safe to re-run.

create or replace function public.enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cap  int;
  used int;
begin
  -- Default 3 to match BASE_SEATS in backend/billing.ts. A null seats column
  -- is an account that has never been through checkout, not an unlimited one.
  select coalesce(p.seats, 3) into cap
    from public.profiles p where p.id = new.user_id;

  if cap is null then
    -- No profiles row for this owner. Refusing here would make the failure
    -- look like a seat problem when it is an account problem, so let it
    -- through and let the account row's absence be diagnosed on its own.
    return new;
  end if;

  select count(*) into used
    from public.household_profiles hp where hp.user_id = new.user_id;

  if used >= cap then
    raise exception 'seat limit reached: % of % seats in use', used, cap
      using errcode = 'check_violation',
            hint = 'Add a seat in Settings, or delete a profile first.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_seat_cap() from public, anon, authenticated;

drop trigger if exists household_profiles_seat_cap on public.household_profiles;
create trigger household_profiles_seat_cap
  before insert on public.household_profiles
  for each row execute function public.enforce_seat_cap();

-- What the client needs to explain the rule before hitting it, rather than
-- catching an exception and translating a database error into English.
create or replace function public.seat_usage()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Defaults to 3 the same way the trigger does, and for the same reason: with
  -- no profiles row the subselect is NULL, and a NULL cap made can_add NULL
  -- too, so the UI could not tell "you are full" from "we could not tell".
  -- Both now answer 3, and the two agree by construction rather than by
  -- someone remembering to change them together.
  with seats as (
    select coalesce((select coalesce(p.seats, 3) from public.profiles p where p.id = auth.uid()), 3) as cap,
           (select count(*) from public.household_profiles where user_id = auth.uid()) as used
  )
  select jsonb_build_object('used', used, 'cap', cap, 'can_add', used < cap) from seats;
$$;

revoke execute on function public.seat_usage() from public, anon;
grant  execute on function public.seat_usage() to authenticated;
