-- Public profiles, and following someone.
--
-- The directory answers "what is on right now" and nothing else. Someone who
-- gathers people every Friday has no address anyone can return to, no way to
-- be found when they are not live, and no way for a person who enjoyed a party
-- to hear about the next one. Every party therefore starts from nothing, which
-- is the whole retention problem.
--
-- A PROFILE FOR A PERSON, not for a host. Hosting is one thing that appears on
-- it. Tying the profile to the role would mean nobody can be followed until
-- they have already run a party, which is exactly backwards for a loop meant to
-- bring people back -- and it is the same table and the same handle either way.
--
-- ENTIRELY OPT IN. An account has no public presence until it claims a handle.
-- Nothing here exposes an account that has not asked to be exposed: no email,
-- no join date, no watch history, no party history -- only what the person typed
-- into a field for the purpose, plus parties they already chose to list.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. The profile
-- ===========================================================================

alter table public.profiles
  -- The permalink. Lowercase and narrow on purpose: it appears in a URL people
  -- read aloud and retype, and a handle that differs from another only by case
  -- or by a lookalike character is an impersonation waiting to happen.
  add column if not exists public_handle text
    check (public_handle is null or public_handle ~ '^[a-z0-9_]{3,24}$'),
  add column if not exists display_name text
    check (display_name is null or char_length(display_name) between 1 and 40),
  add column if not exists bio text
    check (bio is null or char_length(bio) <= 200);

create unique index if not exists profiles_public_handle_key
  on public.profiles (public_handle) where public_handle is not null;

-- REGION IS NOT DECORATION HERE. A party plays region-locked content and the
-- join path refuses outright when the title is not in the viewer's catalogue,
-- so someone can follow a host in another region and never once be able to join
-- anything they run. Saying so on the page prevents a follow that cannot pay
-- off.
--
-- The schedule is the actual retention mechanism. A follow tells someone THAT
-- you host; a schedule tells them when to come back. Without it, following only
-- works when they happen to open the app while a party is already running.
-- Structured -- a weekday, an hour, a timezone -- so it renders in the reader's
-- own terms and cannot be used to say anything else.
alter table public.profiles
  add column if not exists region text
    check (region is null or region ~ '^[A-Z]{2}$'),
  add column if not exists hosts_weekday smallint
    check (hosts_weekday is null or hosts_weekday between 0 and 6),
  add column if not exists hosts_hour smallint
    check (hosts_hour is null or hosts_hour between 0 and 23),
  add column if not exists hosts_tz text
    check (hosts_tz is null or char_length(hosts_tz) <= 64);


comment on column public.profiles.public_handle is
  'Claimed by the account itself. Its presence is what makes a profile public '
  'at all -- there is no page without one.';

-- Names that would let someone pass themselves off as us, or as a system page.
-- Cheap to reserve now, impossible to reclaim once someone is using one.
create table if not exists public.reserved_handles (handle text primary key);
insert into public.reserved_handles (handle) values
  ('admin'),('veedeeoh'),('support'),('help'),('team'),('staff'),('official'),
  ('security'),('billing'),('party'),('kids'),('settings'),('about'),('legal'),
  ('privacy'),('terms'),('api'),('www'),('root'),('system'),('moderator'),('mod')
on conflict do nothing;

alter table public.reserved_handles enable row level security;

create or replace function public.claim_handle(
  want text, name text default null, about text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  h   text := lower(trim(coalesce(want, '')));
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Clearing it withdraws the profile entirely. Follows are left alone: the
  -- host may come back, and silently destroying other people's lists because
  -- someone edited a field is not a thing to do quietly.
  if h = '' then
    update public.profiles
       set public_handle = null, display_name = name, bio = about
     where id = uid;
    return jsonb_build_object('ok', true, 'handle', null);
  end if;

  if h !~ '^[a-z0-9_]{3,24}$' then
    return jsonb_build_object('ok', false, 'error',
      'Handles are 3 to 24 characters: lowercase letters, numbers and underscores.');
  end if;
  if exists (select 1 from public.reserved_handles r where r.handle = h) then
    return jsonb_build_object('ok', false, 'error', 'That handle is reserved.');
  end if;
  if exists (select 1 from public.profiles p where p.public_handle = h and p.id <> uid) then
    return jsonb_build_object('ok', false, 'error', 'That handle is taken.');
  end if;

  update public.profiles
     set public_handle = h,
         display_name  = nullif(trim(coalesce(name, '')), ''),
         bio           = nullif(trim(coalesce(about, '')), '')
   where id = uid;

  return jsonb_build_object('ok', true, 'handle', h);
end;
$$;

revoke execute on function public.claim_handle(text, text, text) from public, anon;
grant  execute on function public.claim_handle(text, text, text) to authenticated;

-- ===========================================================================
-- 2. Following
-- ===========================================================================

create table if not exists public.host_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  host_user_id     uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (follower_user_id, host_user_id),
  -- Following yourself would put your own parties in the section that exists
  -- to show you other people's.
  constraint host_follows_not_self check (follower_user_id <> host_user_id)
);

create index if not exists host_follows_host_idx on public.host_follows (host_user_id);

alter table public.host_follows enable row level security;

-- YOU CAN SEE WHO YOU FOLLOW, NOT WHO FOLLOWS YOU. A readable follower list is
-- a social graph anyone can walk, and nothing here needs one -- the count is
-- served by a definer function instead.
drop policy if exists "own follows" on public.host_follows;
create policy "own follows" on public.host_follows
  for all to authenticated
  using (follower_user_id = auth.uid())
  with check (follower_user_id = auth.uid());

-- ===========================================================================
-- 3. Recommendations
-- ===========================================================================
--
-- A DELIBERATE LIST, not My List republished. Repurposing a private watchlist
-- as a public one means someone discovers they have published something they
-- saved for themselves, which is the kind of surprise there is no apology for.
-- This is separate, empty by default, and everything on it was put there on
-- purpose.
--
-- Titles only, and no note field. Everything here is catalogue content that
-- veedeeoh already carries and already rates, so there is nothing to moderate;
-- a free text box shown to strangers under our name would be a different
-- proposition entirely, needing reporting, review and takedown. Not now.

create table if not exists public.public_picks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  content_id text not null,
  title      text,
  poster     text,
  created_at timestamptz not null default now(),
  primary key (user_id, content_id)
);

alter table public.public_picks enable row level security;

-- Written only by their owner. Read through public_profile(), which is where
-- the "is this profile public at all" check lives.
drop policy if exists "own picks" on public.public_picks;
create policy "own picks" on public.public_picks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- 4. The page
-- ===========================================================================

drop function if exists public.public_profile(text);

create function public.public_profile(want text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  h   text := lower(trim(coalesce(want, '')));
  p   public.profiles%rowtype;
begin
  select * into p from public.profiles where public_handle = h;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such profile');
  end if;

  return jsonb_build_object(
    'ok', true,
    'userId', p.id,
    'handle', p.public_handle,
    'name', coalesce(p.display_name, p.public_handle),
    'bio', p.bio,
    -- Suppressed for a banned account rather than the whole page being hidden:
    -- the ban is about being advertised, and the channel is the advertising.
    'platform', case when p.public_parties_banned then null else p.social_platform end,
    'handleSocial', case when p.public_parties_banned then null else p.social_handle end,
    'followers', (select count(*) from public.host_follows f where f.host_user_id = p.id),
    'following', uid is not null and exists (
      select 1 from public.host_follows f
       where f.host_user_id = p.id and f.follower_user_id = uid),
    'isSelf', uid = p.id,
    'region', p.region,
    'hostsWeekday', p.hosts_weekday,
    'hostsHour', p.hosts_hour,
    'hostsTz', p.hosts_tz,
    -- Five titles they have hosted PUBLICLY. A taste signal built entirely from
    -- what is already on the parties table -- and public only, because a page
    -- about a person must never disclose a private party they ran.
    'recent', coalesce((
      select jsonb_agg(x.title order by x.ended_at desc nulls last)
        from (select t.title, t.ended_at
                from (select distinct on (r.title) r.title, r.ended_at
                        from public.parties r
                       where r.host_user_id = p.id and r.is_public and r.title is not null
                       order by r.title, r.ended_at desc nulls last) t
               order by t.ended_at desc nulls last
               limit 5) x
    ), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'contentId', k.content_id, 'title', k.title, 'poster', k.poster)
             order by k.created_at desc)
        from public.public_picks k where k.user_id = p.id
    ), '[]'::jsonb),
    -- Only parties they already chose to list. A private party must never be
    -- disclosed by a page about the person hosting it.
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

revoke execute on function public.public_profile(text) from public, anon;
grant  execute on function public.public_profile(text) to authenticated;

-- ===========================================================================
-- 5. What the people you follow have on
-- ===========================================================================

drop function if exists public.followed_live_parties();

create function public.followed_live_parties()
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  host_name text, host_handle text, seat_limit int,
  started_at timestamptz, joined_count bigint, blurb text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.join_code, p.title, p.content_id, p.host_user_id,
         coalesce(h.display_name, p.host_name, h.public_handle), h.public_handle,
         p.seat_limit, p.created_at,
         (select count(*) from public.party_joins j where j.party_id = p.id),
         p.blurb
    from public.parties p
    join public.profiles h on h.id = p.host_user_id
    join public.host_follows f
      on f.host_user_id = p.host_user_id and f.follower_user_id = auth.uid()
   where p.is_public
     and p.ended_at is null
     and not h.public_parties_banned
     and p.created_at > now() - interval '6 hours'
   order by p.created_at desc
   limit 20;
$$;

revoke execute on function public.followed_live_parties() from public, anon;
grant  execute on function public.followed_live_parties() to authenticated;

-- ===========================================================================
-- 6. The directory learns about handles, so a listing can link to its host
-- ===========================================================================

drop function if exists public.public_parties(int);

create function public.public_parties(max_rows int default 20)
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  seat_limit int, started_at timestamptz, joined_count bigint,
  blurb text, host_name text, social_platform text, social_handle text,
  host_handle text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.join_code, p.title, p.content_id, p.host_user_id,
         p.seat_limit, p.created_at,
         (select count(*) from public.party_joins j where j.party_id = p.id),
         p.blurb, coalesce(h.display_name, p.host_name), h.social_platform, h.social_handle,
         h.public_handle
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

-- ===========================================================================
-- 7. Reporting a profile
-- ===========================================================================
--
-- REQUIRED, NOT OPTIONAL. The moment a page carries a display name, a bio and
-- an outbound link written by one person and shown to strangers under
-- veedeeoh's name, there has to be a way to flag it. The reserved handle list
-- stops the obvious impersonations; nothing else here stops an abusive bio.
--
-- Reasons are an allowlist and there is no free text field, for the same reason
-- the removal reasons are: a report is read by us, but a box anyone can type
-- into is still a box that receives abuse, and none of it is needed to say what
-- is wrong with a profile.

create table if not exists public.profile_reports (
  id             uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason         text not null check (reason in ('impersonation','abusive','spam','adult','other')),
  created_at     timestamptz not null default now(),
  handled_at     timestamptz,
  -- One open report per person per subject. Repeat reporting is not extra
  -- signal, it is just noise, and it lets one person manufacture a pile-on.
  unique (subject_user_id, reporter_user_id)
);

create index if not exists profile_reports_open_idx
  on public.profile_reports (created_at) where handled_at is null;

alter table public.profile_reports enable row level security;

-- Write-only from the client's point of view. A reporter cannot read reports,
-- including their own: whether something was acted on is not theirs to see, and
-- a readable table would tell a subject who reported them.
drop policy if exists "file a report" on public.profile_reports;
create policy "file a report" on public.profile_reports
  for insert to authenticated
  with check (reporter_user_id = auth.uid() and subject_user_id <> auth.uid());

create or replace function public.report_profile(handle text, why text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  subject uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if why not in ('impersonation','abusive','spam','adult','other') then
    return jsonb_build_object('ok', false, 'error', 'unknown reason');
  end if;

  select id into subject from public.profiles where public_handle = lower(trim(handle));
  if subject is null or subject = uid then
    return jsonb_build_object('ok', false, 'error', 'no such profile');
  end if;

  insert into public.profile_reports (subject_user_id, reporter_user_id, reason)
  values (subject, uid, why)
  on conflict (subject_user_id, reporter_user_id) do nothing;

  -- Deliberately the same answer whether this is the first report or the
  -- fifth. Telling a reporter "you already reported this" is a small thing,
  -- but it also tells anyone probing the endpoint what is already on file.
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.report_profile(text, text) from public, anon;
grant  execute on function public.report_profile(text, text) to authenticated;

-- ===========================================================================
-- 8. Suggesting something for someone to host
-- ===========================================================================
--
-- A TITLE, NEVER A MESSAGE. "Let people send the host a note" is a different
-- product with a moderation queue attached; "let people point at something in
-- the catalogue" is a row with a content id in it. The second one is worth
-- having and costs nothing to keep safe, because everything expressible through
-- it is content veedeeoh already carries and already rates.
--
-- The host sees what has been suggested and how often, which is exactly what
-- the "what's next" picker wants to know.

create table if not exists public.host_suggestions (
  host_user_id uuid not null references auth.users(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  content_id   text not null,
  title        text,
  created_at   timestamptz not null default now(),
  primary key (host_user_id, from_user_id, content_id),
  constraint host_suggestions_not_self check (host_user_id <> from_user_id)
);

create index if not exists host_suggestions_host_idx on public.host_suggestions (host_user_id);

alter table public.host_suggestions enable row level security;

-- You may add and withdraw your own. You may not read anyone else's: a
-- readable table would let one person work out who else follows a host and
-- what they asked for.
drop policy if exists "own suggestions" on public.host_suggestions;
create policy "own suggestions" on public.host_suggestions
  for all to authenticated
  using (from_user_id = auth.uid())
  with check (from_user_id = auth.uid());

-- What the host is being asked for, most-wanted first. Counts only -- who
-- suggested what stays private, so nobody has to worry about being seen asking.
drop function if exists public.my_suggestions();

create function public.my_suggestions()
returns table (content_id text, title text, votes bigint, newest timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.content_id, max(s.title), count(*), max(s.created_at)
    from public.host_suggestions s
   where s.host_user_id = auth.uid()
   group by s.content_id
   order by count(*) desc, max(s.created_at) desc
   limit 30;
$$;

revoke execute on function public.my_suggestions() from public, anon;
grant  execute on function public.my_suggestions() to authenticated;

create or replace function public.suggest_to_host(handle text, content text, name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  subject uuid;
  mine int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  select id into subject from public.profiles where public_handle = lower(trim(handle));
  if subject is null or subject = uid then
    return jsonb_build_object('ok', false, 'error', 'no such profile');
  end if;

  -- A cap per person per host. Without one, a suggestion list is a place to
  -- dump the entire catalogue at somebody.
  select count(*) into mine from public.host_suggestions
   where host_user_id = subject and from_user_id = uid;
  if mine >= 10 then
    return jsonb_build_object('ok', false, 'error',
      'You have suggested ten things to them already. Withdraw one first.');
  end if;

  insert into public.host_suggestions (host_user_id, from_user_id, content_id, title)
  values (subject, uid, content, name)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.suggest_to_host(text, text, text) from public, anon;
grant  execute on function public.suggest_to_host(text, text, text) to authenticated;
