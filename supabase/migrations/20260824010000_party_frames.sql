-- A frame from what is playing, on the party card.
--
-- The directory renders an empty well until a capture exists, and that well is
-- correct first paint and correct forever for any party that cannot or must
-- not be captured. Nothing here is required for the directory to work.
--
-- WHO CAPTURES: the host's own browser, because that is the only place the
-- frame exists. No server ever sees a video byte -- segments go from the
-- provider's CDN straight to each viewer, which is the whole reason hosting
-- costs us a socket and not bandwidth.
--
-- THE PRIVACY RULE, ENFORCED TWICE. A private room must never be captured. The
-- client refuses, and so does this trigger, because the client check sits on
-- the caller's side of the boundary and that is exactly the sort of check that
-- turns out to be missing. Ending a party takes its frame with it.
--
-- Safe to re-run.

alter table public.parties
  -- Stored inline rather than in a bucket. At 240x135 and JPEG quality 0.4 a
  -- frame measured 6,951 characters against full-frame noise, which is the
  -- worst case there is, and real content lands well under half of that -- so
  -- forty cards cost less than a couple of posters. Inline means no bucket, no
  -- policies on storage.objects, no signed URLs, and no orphaned object when a
  -- row is deleted. The cap is a constraint rather than a convention: without
  -- it this column is a place to put a megabyte.
  --
  -- THE SHAPE IS CHECKED, NOT JUST THE LENGTH. This string is written by one
  -- account and then rendered on every other viewer's directory. A plain text
  -- column would let a host put anything in it -- and the obvious way to show
  -- a frame is a CSS background-image, which makes "anything" a stylesheet
  -- running on someone else's page. The pattern admits a base64 image data URI
  -- and nothing whatsoever else: no quotes, no parentheses, no semicolons
  -- beyond the one in the prefix, so there is nothing to break out of.
  add column if not exists frame text
    check (frame is null or (
      length(frame) <= 12000
      and frame ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$'
    )),
  add column if not exists frame_at timestamptz;

comment on column public.parties.frame is
  'A small, deliberately lossy still from what the host is playing, captured '
  'by the host''s own browser. 240x135, JPEG quality 0.4. Public parties only, '
  'cleared when the party ends.';

create or replace function public.guard_party_frame()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A PRIVATE ROOM IS NEVER CAPTURED. Nulled rather than raised: a stale or
  -- buggy client should lose its thumbnail, not fail the party.
  if new.is_public is not true then
    new.frame := null;
    new.frame_at := null;
  end if;

  -- Ending the party takes the frame with it. A directory that stops
  -- advertising a room after six hours should not still be holding a picture
  -- of what was on in it.
  if new.ended_at is not null then
    new.frame := null;
    new.frame_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists parties_guard_frame on public.parties;
create trigger parties_guard_frame
  before insert or update on public.parties
  for each row execute function public.guard_party_frame();

-- ---------------------------------------------------------------------------
-- The directory carries it
-- ---------------------------------------------------------------------------

drop function if exists public.public_parties(text, text, text, text, text, text, boolean, boolean, boolean, boolean, text, int);

create function public.public_parties(
  q            text default null,
  f_genre      text default null,
  f_rating     text default null,
  f_decade     text default null,
  f_language   text default null,
  f_size       text default null,
  free_seats   boolean default false,
  just_started boolean default false,
  follows_only boolean default false,
  has_social   boolean default false,
  sort         text default 'new',
  max_rows     int default 40
)
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  seat_limit int, started_at timestamptz, joined_count bigint,
  blurb text, host_name text, social_platform text, social_handle text,
  host_handle text, genre text, rating text, decade text, language text,
  runtime_mins int, following boolean, frame text, total_rows bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select p.join_code, p.title, p.content_id, p.host_user_id,
           p.seat_limit, p.created_at as started_at,
           (select count(*) from public.party_joins j where j.party_id = p.id) as joined_count,
           p.blurb,
           coalesce(h.display_name, p.host_name) as host_name,
           h.social_platform, h.social_handle, h.public_handle as host_handle,
           p.genre, p.rating, p.decade, p.language, p.runtime_mins,
           exists (select 1 from public.host_follows f
                    where f.host_user_id = p.host_user_id
                      and f.follower_user_id = auth.uid()) as following,
           p.frame,
           p.search
      from public.parties p
      join public.profiles h on h.id = p.host_user_id
     where p.is_public
       and p.ended_at is null
       and not h.public_parties_banned
       and p.created_at > now() - interval '6 hours'
       and p.host_user_id <> auth.uid()
       and not exists (select 1 from public.party_blocks b
                        where b.host_user_id = p.host_user_id
                          and b.blocked_user_id = auth.uid())
  ),
  filtered as (
    select * from base b
     where (q is null or btrim(q) = ''
            or b.search @@ plainto_tsquery('simple', q)
            or b.host_handle ilike '%' || q || '%')
       and (f_genre    is null or f_genre    = '' or b.genre    = f_genre)
       and (f_rating   is null or f_rating   = '' or b.rating   = f_rating)
       and (f_decade   is null or f_decade   = '' or b.decade   = f_decade)
       and (f_language is null or f_language = '' or b.language = f_language)
       and (f_size is null or f_size = ''
            or (f_size = 's' and b.joined_count < 5)
            or (f_size = 'm' and b.joined_count between 5 and 15)
            or (f_size = 'l' and b.joined_count > 15))
       and (not free_seats   or b.seat_limit is null or b.joined_count < b.seat_limit)
       and (not just_started or b.started_at > now() - interval '15 minutes')
       and (not follows_only or b.following)
       and (not has_social   or b.social_platform is not null)
  )
  select f.join_code, f.title, f.content_id, f.host_user_id,
         f.seat_limit, f.started_at, f.joined_count,
         f.blurb, f.host_name, f.social_platform, f.social_handle,
         f.host_handle, f.genre, f.rating, f.decade, f.language,
         f.runtime_mins, f.following, f.frame,
         (select count(*) from base) as total_rows
    from filtered f
   order by f.following desc,
            case when sort = 'most' then f.joined_count end desc nulls last,
            case when sort = 'ending'
                 then f.started_at + make_interval(mins => f.runtime_mins) end asc nulls last,
            f.started_at desc
   limit greatest(1, least(max_rows, 60));
$$;

revoke execute on function public.public_parties from public, anon;
grant  execute on function public.public_parties to authenticated;
