-- The host's channel reaches the people actually in the party.
--
-- It was added for the public directory and stopped there: a browser could see
-- "this host is on Discord" before joining, and then never again. The moment it
-- matters most -- everyone sitting in the same room watching the same thing --
-- had no sign of it, and a PRIVATE party could not surface it at all, because
-- party_by_code is what a guest joining by link gets and it returned nothing
-- about the host.
--
-- Which is backwards. A private party is people the host actually invited; if
-- anyone should be told where the host talks, it is them.
--
-- Safe to re-run.

-- Dropped rather than replaced: CREATE OR REPLACE cannot change a function's
-- OUT columns and this one gains three.
drop function if exists public.party_by_code(text);

create function public.party_by_code(code text)
returns table (
  id uuid, join_code text, content_id text, stream_idx int,
  title text, seat_limit int, host_user_id uuid, is_public boolean,
  host_name text, social_platform text, social_handle text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.join_code, p.content_id, p.stream_idx,
         p.title, p.seat_limit, p.host_user_id, p.is_public,
         -- Snapshotted on the party row at creation, so a host renaming
         -- themselves later does not retitle a party that has already
         -- happened. Public parties always had one; private parties now get
         -- one too, which is why this can be returned here at all.
         p.host_name,
         -- Platform and handle, never a URL. The client assembles the link, so
         -- a disguised link, an open redirect or a shortener is not expressible
         -- -- the same rule the directory listing already follows.
         case when h.public_parties_banned then null else h.social_platform end,
         case when h.public_parties_banned then null else h.social_handle end
    from public.parties p
    left join public.profiles h on h.id = p.host_user_id
   where upper(p.join_code) = upper(code)
     and p.ended_at is null
   limit 1;
$$;

revoke execute on function public.party_by_code(text) from public, anon;
grant  execute on function public.party_by_code(text) to authenticated;
