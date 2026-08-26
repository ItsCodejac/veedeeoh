-- Two functions that exist in the live database and in no migration.
--
-- Found the same way as the baseline: by listing pg_proc against the repo. Both
-- are called by the shipped client, so a database built only from migrations
-- answered the host page with "function does not exist" and returned an empty
-- popular rail. They are separated from the baseline because they read tables
-- the baseline does not create -- parties, host_follows, party_joins -- so they
-- have to come after the migrations that do.
--
-- Read out of the live database on 26 August 2026 and reproduced as found.

-- ------------------------------------------------------------- host_page ---
-- Everything /@handle renders, in one round trip.
--
-- SECURITY DEFINER because it reports on an account the caller cannot read:
-- profiles is owner-only under RLS. It is written to disclose exactly the
-- public-presence fields and nothing else -- no email, no tier, no billing.
--
-- Two rules are enforced here rather than in the client, because the client is
-- not the only thing that can call it:
--   - a banned account keeps its page but loses its channel links, since the
--     ban is about being advertised and the channel is the advertising;
--   - only parties the host chose to list are returned. A private party must
--     never be disclosed by a page about its host.
create or replace function public.host_page(want text)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid uuid := auth.uid();
  h   text := lower(trim(coalesce(want, '')));
  p   public.profiles%rowtype;
begin
  select * into p from public.profiles where public_handle = h;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such host');
  end if;

  return jsonb_build_object(
    'ok', true,
    'userId', p.id,
    'handle', p.public_handle,
    'name', coalesce(p.display_name, p.public_handle),
    'bio', p.bio,
    'platform', case when p.public_parties_banned then null else p.social_platform end,
    'handleSocial', case when p.public_parties_banned then null else p.social_handle end,
    'followers', (select count(*) from public.host_follows f where f.host_user_id = p.id),
    'following', uid is not null and exists (
      select 1 from public.host_follows f
       where f.host_user_id = p.id and f.follower_user_id = uid),
    'isSelf', uid = p.id,
    'live', coalesce((
      select jsonb_agg(jsonb_build_object(
               'joinCode', x.join_code, 'title', x.title, 'contentId', x.content_id,
               'blurb', x.blurb, 'startedAt', x.created_at,
               'watching', (select count(*) from public.party_joins j where j.party_id = x.id))
             order by x.created_at desc)
        from public.parties x
       where x.host_user_id = p.id
         and x.is_public
         and x.ended_at is null
         and not p.public_parties_banned
         and x.created_at > now() - interval '6 hours'
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------- popular_content ---
-- What the house is watching, counted across every profile's resume rows.
--
-- SECURITY DEFINER because watch_progress is readable only by the profile that
-- owns it, and this deliberately aggregates across all of them. It returns
-- counts and titles only -- never a profile_id -- so nothing here says who
-- watched what. The row cap is clamped in the function rather than trusted from
-- the caller.
create or replace function public.popular_content(max_rows integer default 20)
returns table(content_id text, title text, plays bigint)
language sql security definer set search_path to 'public'
as $$
  select content_id,
         max(title) as title,
         count(*)::bigint as plays
  from watch_progress
  where content_id is not null
  group by content_id
  order by count(*) desc, max(updated_at) desc
  limit greatest(1, least(max_rows, 100));
$$;
