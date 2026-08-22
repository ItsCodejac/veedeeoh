-- What a public party host gets back.
--
-- A host listing publicly supplies the curation, the moderation and the
-- audience, and until now got nothing named in return -- not even their own
-- name on the listing. They were also already earning referral commission on
-- everyone who signed up through their party and had no way to know it.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Per-party presentation
-- ===========================================================================

alter table public.parties
  add column if not exists blurb text,
  -- Snapshotted rather than joined. The listing needs a name without exposing
  -- the host's profile row to every browser, and a host renaming themselves
  -- later should not retitle a party that has already happened.
  add column if not exists host_name text;

comment on column public.parties.blurb is
  'One line from the host. Makes the directory browsable instead of a list of '
  'titles.';

-- ===========================================================================
-- 2. Per-account host identity
-- ===========================================================================
--
-- PLATFORM AND HANDLE, never a URL. An arbitrary link shown to other users is
-- a phishing and spam surface, and the link would be served under veedeeoh's
-- name. Storing the platform and the handle separately means the client builds
-- the URL, so a disguised link, an open redirect or a shortener is not
-- expressible in the first place.

alter table public.profiles
  add column if not exists social_platform text
    check (social_platform is null or social_platform in ('discord', 'twitch', 'youtube', 'x', 'tiktok', 'instagram')),
  add column if not exists social_handle text
    check (social_handle is null or social_handle ~ '^[A-Za-z0-9_.\-]{2,32}$'),
  -- Admin switch. Hosting stays available; being LISTED does not.
  add column if not exists public_parties_banned boolean not null default false;

comment on column public.profiles.social_handle is
  'Handle only, validated by pattern. The URL is assembled client-side from '
  'the platform, so no user-supplied URL is ever rendered.';

-- ===========================================================================
-- 3. Listing: a cap, a ban check, and the host's details
-- ===========================================================================

-- Dropped rather than replaced: CREATE OR REPLACE cannot change a function's
-- OUT columns, and this one gains four. Safe -- nothing depends on it but the
-- client, which is redeployed alongside.
drop function if exists public.public_parties(int);

create function public.public_parties(max_rows int default 20)
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  seat_limit int, started_at timestamptz, joined_count bigint,
  blurb text, host_name text, social_platform text, social_handle text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.join_code, p.title, p.content_id, p.host_user_id,
         p.seat_limit, p.created_at,
         (select count(*) from public.party_joins j where j.party_id = p.id),
         p.blurb, p.host_name, h.social_platform, h.social_handle
    from public.parties p
    join public.profiles h on h.id = p.host_user_id
   where p.is_public
     and p.ended_at is null
     and not h.public_parties_banned
     and p.created_at > now() - interval '6 hours'
     and p.host_user_id <> auth.uid()
   order by p.created_at desc
   limit greatest(1, least(max_rows, 50));
$$;

revoke execute on function public.public_parties(int) from public, anon;
grant  execute on function public.public_parties(int) to authenticated;

-- May this account list another public party right now?
--
-- Three at once. Without a cap the directory becomes one person's billboard,
-- and a single host running twenty rooms crowds out everyone else on a page
-- whose whole value is variety.
drop function if exists public.can_list_public_party();

create function public.can_list_public_party()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  banned boolean;
  live int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;

  select public_parties_banned into banned from public.profiles where id = uid;
  if coalesce(banned, false) then
    return jsonb_build_object('ok', false, 'reason', 'listing disabled for this account');
  end if;

  select count(*) into live from public.parties
   where host_user_id = uid and is_public and ended_at is null
     and created_at > now() - interval '6 hours';

  if live >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'you already have three parties listed');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.can_list_public_party() from public, anon;
grant  execute on function public.can_list_public_party() to authenticated;

-- ===========================================================================
-- 4. What the host earned
-- ===========================================================================

-- Signups attributable to one party. Referral rows are first-touch and
-- permanent, so this is the number the host actually gets paid on -- not a
-- headcount of who turned up.
drop function if exists public.party_signups(uuid);

create function public.party_signups(party uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.referrals r
   where r.party_id = party
     and r.referrer_user_id = auth.uid();
$$;

revoke execute on function public.party_signups(uuid) from public, anon;
grant  execute on function public.party_signups(uuid) to authenticated;
