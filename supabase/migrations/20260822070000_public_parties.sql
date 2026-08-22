-- Public watch parties, and a fix for the fact that every party was already
-- public whether the host wanted it or not.
--
-- THE HOLE. The select policy was `using (ended_at is null)`, so any signed-in
-- user could list every open party in the database along with its join code.
-- Approval was the only thing standing between a stranger and a private party,
-- and a party set to "anyone with the link" had nothing at all -- the link was
-- never the secret it was presented as.
--
-- THE MODEL. Possession of the code is the credential. Knowing a code gets you
-- the row through party_by_code(); not knowing it gets you nothing unless the
-- host chose to be listed. Enumeration is no longer possible either way.
--
-- Safe to re-run.

alter table public.parties
  add column if not exists is_public boolean not null default false;

comment on column public.parties.is_public is
  'Host opted in to the open directory. Explicit rather than inferred from '
  '"no approval + unlimited seats": someone picking those for convenience '
  'should not discover afterwards that strangers were watching.';

-- ===========================================================================
-- Enumeration is closed. A code still opens the door, via the function below.
-- ===========================================================================

drop policy if exists "read open parties" on public.parties;

create policy "read public or own parties" on public.parties
  for select to authenticated
  using (host_user_id = auth.uid() or (is_public and ended_at is null));

-- Look a party up BY CODE. Security definer because the select policy no longer
-- exposes private rows: this is what makes the code itself the credential,
-- while a caller without one cannot enumerate anything.
create or replace function public.party_by_code(code text)
returns table (
  id uuid, join_code text, content_id text, stream_idx int,
  title text, seat_limit int, host_user_id uuid, is_public boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.join_code, p.content_id, p.stream_idx,
         p.title, p.seat_limit, p.host_user_id, p.is_public
    from public.parties p
   where upper(p.join_code) = upper(code)
     and p.ended_at is null
   limit 1;
$$;

revoke execute on function public.party_by_code(text) from public, anon;
grant  execute on function public.party_by_code(text) to authenticated;

-- ===========================================================================
-- The directory
-- ===========================================================================

-- Listed parties, newest first, with a live-ish participant count.
--
-- Deliberately does NOT return the join code for someone else's party until
-- they ask to join -- the directory is a list of what is on, not a list of
-- credentials. The client calls party_by_code() with the code it is given back
-- by joining, exactly as it would from a link.
create or replace function public.public_parties(max_rows int default 20)
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  seat_limit int, started_at timestamptz, joined_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.join_code, p.title, p.content_id, p.host_user_id,
         p.seat_limit, p.created_at,
         (select count(*) from public.party_joins j where j.party_id = p.id)
    from public.parties p
   where p.is_public
     and p.ended_at is null
     -- Six hours is well past any film. A row whose host vanished without
     -- ending it should stop being advertised rather than sit in the list
     -- forever pointing at a Durable Object that closed itself long ago.
     and p.created_at > now() - interval '6 hours'
     -- Never advertise your own party back at you.
     and p.host_user_id <> auth.uid()
   order by p.created_at desc
   limit greatest(1, least(max_rows, 50));
$$;

revoke execute on function public.public_parties(int) from public, anon;
grant  execute on function public.public_parties(int) to authenticated;
