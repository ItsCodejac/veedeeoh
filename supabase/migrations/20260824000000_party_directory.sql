-- veedeeoh.party: blocks that outlive the room, host notes, appeals, one party
-- at a time, and a directory that filters in the database instead of shipping
-- itself to every viewer.
--
-- Implements PARTY-BACKEND.md sections 1, 2, 3, 4, 7 and 8. Section 0 (relay
-- authentication) already landed. Sections 5 and 6 are client-side.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Blocks belong to the host, not the room
-- ===========================================================================
--
-- The worker keeps its ban list in Durable Object storage, and IDLE_CLOSE_MS
-- is five minutes -- so the strongest action a host has expires shortly after
-- the party does, and the same account walks into the next one freely. A block
-- is a standing decision about a person. It goes in the database.

create table if not exists public.party_blocks (
  host_user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  -- Only the KICK_REASONS keys that set ban:true ever land here. `technical`
  -- and `space` are removals, not blocks, and must never write a row.
  reason          text not null check (reason in ('fit','conduct')),
  -- Context the host will want months later, when the room is long gone and
  -- they are deciding whether to lift it.
  party_id        uuid references public.parties(id) on delete set null,
  party_title     text,
  created_at      timestamptz not null default now(),
  primary key (host_user_id, blocked_user_id),
  constraint party_blocks_not_self check (host_user_id <> blocked_user_id)
);

create index if not exists party_blocks_host_idx
  on public.party_blocks (host_user_id, created_at desc);
-- The worker asks "is this person blocked by that host" on every connect.
create index if not exists party_blocks_subject_idx
  on public.party_blocks (blocked_user_id);

alter table public.party_blocks enable row level security;

-- A HOST SEES THEIR OWN BLOCKS AND NOBODY ELSE'S. The blocked person never
-- gets a readable list: knowing exactly who has blocked you is an invitation
-- to work around it with a second account.
drop policy if exists "own blocks" on public.party_blocks;
create policy "own blocks" on public.party_blocks
  for all to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

revoke all on public.party_blocks from anon;

-- ===========================================================================
-- 2. Host notes
-- ===========================================================================
--
-- Free text is safe here in a way it is not in KICK_REASONS: this string is
-- shown to exactly one person, its author. Nothing renders it into a party.

create table if not exists public.party_notes (
  host_user_id    uuid not null references auth.users(id) on delete cascade,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  note            text not null check (length(note) <= 500),
  updated_at      timestamptz not null default now(),
  primary key (host_user_id, subject_user_id)
);

alter table public.party_notes enable row level security;

drop policy if exists "own notes" on public.party_notes;
create policy "own notes" on public.party_notes
  for all to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

revoke all on public.party_notes from anon;

-- ===========================================================================
-- 3. Asking to return
-- ===========================================================================
--
-- One short message from a blocked person to the host who blocked them. One
-- open request at a time, enforced by the primary key: without that, the
-- appeal box is a channel for repeated contact with someone who said no.

create table if not exists public.party_block_appeals (
  host_user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  message         text not null check (length(message) between 1 and 280),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  primary key (host_user_id, blocked_user_id)
);

create index if not exists party_appeals_host_idx
  on public.party_block_appeals (host_user_id, created_at desc)
  where answered_at is null;

alter table public.party_block_appeals enable row level security;

drop policy if exists "host reads appeals" on public.party_block_appeals;
create policy "host reads appeals" on public.party_block_appeals
  for select to authenticated using (host_user_id = auth.uid());

drop policy if exists "host answers appeals" on public.party_block_appeals;
create policy "host answers appeals" on public.party_block_appeals
  for update to authenticated
  using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());

-- The sender may insert their own, once, and only while a block against them
-- actually exists. An appeal from someone who was never blocked is a message
-- channel we did not intend to build.
drop policy if exists "send own appeal" on public.party_block_appeals;
create policy "send own appeal" on public.party_block_appeals
  for insert to authenticated
  with check (
    blocked_user_id = auth.uid()
    and exists (
      select 1 from public.party_blocks b
       where b.host_user_id = party_block_appeals.host_user_id
         and b.blocked_user_id = auth.uid()
    )
  );

revoke all on public.party_block_appeals from anon;

-- ---------------------------------------------------------------------------
-- The calls behind the Blocked and Asking-to-return segments
-- ---------------------------------------------------------------------------

drop function if exists public.my_blocks();

create function public.my_blocks()
returns table (
  user_id uuid, handle text, name text, reason text,
  party_title text, created_at timestamptz, note text,
  appeal text, appeal_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.blocked_user_id, p.public_handle,
         coalesce(p.display_name, p.public_handle, 'Someone'),
         b.reason, b.party_title, b.created_at, n.note,
         a.message, a.created_at
    from public.party_blocks b
    left join public.profiles p on p.id = b.blocked_user_id
    left join public.party_notes n
      on n.host_user_id = b.host_user_id and n.subject_user_id = b.blocked_user_id
    left join public.party_block_appeals a
      on a.host_user_id = b.host_user_id
     and a.blocked_user_id = b.blocked_user_id
     and a.answered_at is null
   where b.host_user_id = auth.uid()
   order by b.created_at desc
   limit 200;
$$;

revoke execute on function public.my_blocks() from public, anon;
grant  execute on function public.my_blocks() to authenticated;

-- Unblocking deletes the appeal alongside the block, in one function, so the
-- queue cannot show a request against a block that no longer exists.
create or replace function public.unblock_user(subject uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  delete from public.party_block_appeals
   where host_user_id = uid and blocked_user_id = subject;
  delete from public.party_blocks
   where host_user_id = uid and blocked_user_id = subject;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.unblock_user(uuid) from public, anon;
grant  execute on function public.unblock_user(uuid) to authenticated;

-- Keeping someone blocked closes the request WITHOUT notifying them. The
-- design deliberately gives no feedback that would reward trying again.
create or replace function public.answer_appeal(subject uuid, lift boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  if lift then
    return public.unblock_user(subject);
  end if;

  update public.party_block_appeals
     set answered_at = now()
   where host_user_id = uid and blocked_user_id = subject and answered_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.answer_appeal(uuid, boolean) from public, anon;
grant  execute on function public.answer_appeal(uuid, boolean) to authenticated;

create or replace function public.set_party_note(subject uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  txt text := nullif(trim(coalesce(body, '')), '');
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if uid = subject then
    return jsonb_build_object('ok', false, 'error', 'that is you');
  end if;

  if txt is null then
    delete from public.party_notes where host_user_id = uid and subject_user_id = subject;
    return jsonb_build_object('ok', true, 'note', null);
  end if;

  txt := left(txt, 500);
  insert into public.party_notes (host_user_id, subject_user_id, note, updated_at)
  values (uid, subject, txt, now())
  on conflict (host_user_id, subject_user_id)
    do update set note = excluded.note, updated_at = now();

  return jsonb_build_object('ok', true, 'note', txt);
end;
$$;

revoke execute on function public.set_party_note(uuid, text) from public, anon;
grant  execute on function public.set_party_note(uuid, text) to authenticated;

-- Sent by the blocked person. Definer rather than a bare insert so the caller
-- never has to be told whether the block exists -- the answer is the same
-- either way, and a distinguishable refusal is a probe.
create or replace function public.send_block_appeal(host uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  txt text := nullif(trim(coalesce(body, '')), '');
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if txt is null or length(txt) > 280 then
    return jsonb_build_object('ok', false, 'error', 'Between 1 and 280 characters.');
  end if;

  if exists (select 1 from public.party_blocks b
              where b.host_user_id = host and b.blocked_user_id = uid) then
    insert into public.party_block_appeals (host_user_id, blocked_user_id, message)
    values (host, uid, txt)
    on conflict (host_user_id, blocked_user_id) do nothing;
  end if;

  -- Deliberately the same answer in every case: sent, already sent, or never
  -- blocked at all.
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.send_block_appeal(uuid, text) from public, anon;
grant  execute on function public.send_block_appeal(uuid, text) to authenticated;

-- What the relay asks on every connect, and what /why asks before a socket is
-- attempted. Definer because the blocked person cannot read party_blocks and
-- must not be able to: this answers about themselves only.
create or replace function public.am_i_blocked(host uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.party_blocks b
     where b.host_user_id = host and b.blocked_user_id = auth.uid()
  );
$$;

revoke execute on function public.am_i_blocked(uuid) from public, anon;
grant  execute on function public.am_i_blocked(uuid) to authenticated;

-- ===========================================================================
-- 4. One party at a time
-- ===========================================================================
--
-- A host running two rooms cannot drive either one, and the credit meter
-- charges for both. The rule already existed in everyone's head.

-- The index will not create while any host has two open rows, so close the
-- stale ones first. A room whose Durable Object closed five minutes after
-- going idle is not live in any sense that matters; only the row outlived it.
with ranked as (
  select id, row_number() over (
           partition by host_user_id order by created_at desc
         ) as rn
    from public.parties
   where ended_at is null
)
update public.parties p
   set ended_at = now()
  from ranked r
 where p.id = r.id and r.rn > 1;

create unique index if not exists parties_one_live_per_host
  on public.parties (host_user_id)
  where ended_at is null;

-- ===========================================================================
-- 7. The directory
-- ===========================================================================
--
-- public_parties() returned every open party with no arguments. Fine at twelve
-- rows, wrong at twelve hundred: the client filtered, which means shipping the
-- whole directory to every viewer.

-- Genre, rating, decade and language are properties of the TITLE, not the
-- party, and the catalogue is resolved per viewer and never reaches the
-- server. So they are denormalised onto the party row at create time. That is
-- the only place the information exists on our side.
alter table public.parties
  add column if not exists genre    text,
  add column if not exists rating   text,
  add column if not exists decade   text,
  add column if not exists language text,
  -- Ending soonest cannot be computed without knowing how long the thing is.
  -- Snapshotted from the catalogue for the same reason as the four above.
  add column if not exists runtime_mins int,
  -- The Private tab says "you approve each person" per room. Until now the
  -- door policy was sent to the worker and never recorded, so nothing could
  -- render it.
  add column if not exists requires_approval boolean not null default true;

comment on column public.parties.genre is
  'Snapshot of the title''s genre at create time. Denormalised because the '
  'catalogue is resolved per viewer and the server never sees it.';

-- Search covers title, host name and blurb. PARTY-BACKEND.md names a
-- host_handle column here; there is no such column, and a generated column
-- cannot reach into profiles to find one. host_name is the snapshot the party
-- row already carries, so that is what is indexed.
alter table public.parties
  add column if not exists search tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(host_name, '') || ' ' || coalesce(blurb, ''))
  ) stored;

create index if not exists parties_search_idx on public.parties using gin (search);
create index if not exists parties_open_idx
  on public.parties (is_public, created_at desc)
  where is_public and ended_at is null;

-- ---------------------------------------------------------------------------
-- The directory query
-- ---------------------------------------------------------------------------
--
-- Sort is always follows-first, then the chosen order. Two clauses, not a
-- separate query.

drop function if exists public.public_parties(int);

create function public.public_parties(
  q            text default null,
  f_genre      text default null,
  f_rating     text default null,
  f_decade     text default null,
  f_language   text default null,
  f_size       text default null,   -- 's' under 5, 'm' 5-15, 'l' over 15
  free_seats   boolean default false,
  just_started boolean default false,
  follows_only boolean default false,
  has_social   boolean default false,
  sort         text default 'new',  -- 'new' | 'most' | 'ending'
  max_rows     int default 40
)
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  seat_limit int, started_at timestamptz, joined_count bigint,
  blurb text, host_name text, social_platform text, social_handle text,
  host_handle text, genre text, rating text, decade text, language text,
  runtime_mins int, following boolean, total_rows bigint
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
           p.search
      from public.parties p
      join public.profiles h on h.id = p.host_user_id
     where p.is_public
       and p.ended_at is null
       and not h.public_parties_banned
       -- Six hours is well past any film. A row whose host vanished without
       -- ending it stops being advertised.
       and p.created_at > now() - interval '6 hours'
       -- Never advertise your own party back at you.
       and p.host_user_id <> auth.uid()
       -- A host who blocked you does not appear in your directory at all.
       -- Showing a Join button that the relay will refuse is worse than not
       -- showing the row.
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
       -- A party with no seat limit always has a free seat.
       and (not free_seats   or b.seat_limit is null or b.joined_count < b.seat_limit)
       and (not just_started or b.started_at > now() - interval '15 minutes')
       and (not follows_only or b.following)
       and (not has_social   or b.social_platform is not null)
  )
  select f.join_code, f.title, f.content_id, f.host_user_id,
         f.seat_limit, f.started_at, f.joined_count,
         f.blurb, f.host_name, f.social_platform, f.social_handle,
         f.host_handle, f.genre, f.rating, f.decade, f.language,
         f.runtime_mins, f.following,
         -- So the filter bar can say "6 of 41" without a second round trip.
         (select count(*) from base) as total_rows
    from filtered f
   order by f.following desc,
            case when sort = 'most' then f.joined_count end desc nulls last,
            -- Ending soonest, from the runtime snapshot. A party with no
            -- runtime recorded sorts last rather than pretending to be first.
            case when sort = 'ending'
                 then f.started_at + make_interval(mins => f.runtime_mins) end asc nulls last,
            f.started_at desc
   limit greatest(1, least(max_rows, 60));
$$;

revoke execute on function public.public_parties from public, anon;
grant  execute on function public.public_parties to authenticated;

-- The facet lists. Built from what is actually open right now, so the dropdown
-- never offers a filter that returns nothing.
drop function if exists public.public_party_facets();

create function public.public_party_facets()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with open as (
    select p.genre, p.rating, p.decade, p.language
      from public.parties p
      join public.profiles h on h.id = p.host_user_id
     where p.is_public and p.ended_at is null
       and not h.public_parties_banned
       and p.created_at > now() - interval '6 hours'
       and p.host_user_id <> auth.uid()
  )
  select jsonb_build_object(
    'genre',    coalesce((select jsonb_agg(distinct genre    order by genre)    from open where genre    is not null), '[]'::jsonb),
    'rating',   coalesce((select jsonb_agg(distinct rating   order by rating)   from open where rating   is not null), '[]'::jsonb),
    'decade',   coalesce((select jsonb_agg(distinct decade   order by decade)   from open where decade   is not null), '[]'::jsonb),
    'language', coalesce((select jsonb_agg(distinct language order by language) from open where language is not null), '[]'::jsonb)
  );
$$;

revoke execute on function public.public_party_facets() from public, anon;
grant  execute on function public.public_party_facets() to authenticated;

-- ---------------------------------------------------------------------------
-- The Private tab: rooms you were let into, and rooms you ran
-- ---------------------------------------------------------------------------
--
-- A private room is never in the directory, so this is the only surface that
-- can show one, and it can only ever show rooms the caller has a relationship
-- with: they hosted it, or they joined it.

drop function if exists public.my_private_parties();

create function public.my_private_parties()
returns table (
  join_code text, title text, content_id text, host_user_id uuid,
  host_name text, host_handle text, started_at timestamptz, ended_at timestamptz,
  requires_approval boolean, is_host boolean, joined_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.join_code, p.title, p.content_id, p.host_user_id,
         coalesce(h.display_name, p.host_name), h.public_handle,
         p.created_at, p.ended_at, p.requires_approval,
         p.host_user_id = auth.uid(),
         (select count(*) from public.party_joins j where j.party_id = p.id)
    from public.parties p
    join public.profiles h on h.id = p.host_user_id
   where not p.is_public
     and (p.host_user_id = auth.uid()
          or exists (select 1 from public.party_joins j
                      where j.party_id = p.id and j.user_id = auth.uid()))
     and p.created_at > now() - interval '30 days'
   order by (p.ended_at is null) desc, p.created_at desc
   limit 40;
$$;

revoke execute on function public.my_private_parties() from public, anon;
grant  execute on function public.my_private_parties() to authenticated;

-- ---------------------------------------------------------------------------
-- Coming up, and Remind me
-- ---------------------------------------------------------------------------
--
-- DERIVED, NOT STORED. There is no schedule table. Each host has one nullable
-- slot on their profile and Coming up is that field for every host you follow,
-- projected forward to the next occurrence. A host with no slot reads "Hosts
-- occasionally" and shows no date.

create table if not exists public.party_reminders (
  user_id    uuid not null references auth.users(id) on delete cascade,
  host_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, host_id),
  constraint party_reminders_not_self check (user_id <> host_id)
);

alter table public.party_reminders enable row level security;

drop policy if exists "own reminders" on public.party_reminders;
create policy "own reminders" on public.party_reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.party_reminders from anon;

-- Unfollowing takes the reminder with it. A reminder about someone you no
-- longer follow is a notification nobody asked for.
create or replace function public.drop_reminder_on_unfollow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.party_reminders
   where user_id = old.follower_user_id and host_id = old.host_user_id;
  return old;
end;
$$;

drop trigger if exists host_follows_drop_reminder on public.host_follows;
create trigger host_follows_drop_reminder
  after delete on public.host_follows
  for each row execute function public.drop_reminder_on_unfollow();

drop function if exists public.coming_up();

create function public.coming_up()
returns table (
  host_user_id uuid, handle text, name text,
  weekday smallint, hour smallint, tz text,
  next_at timestamptz, reminded boolean, live boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id, h.public_handle,
         coalesce(h.display_name, h.public_handle, 'Someone'),
         h.hosts_weekday, h.hosts_hour, h.hosts_tz,
         case when h.hosts_weekday is null or h.hosts_hour is null then null
         else
           -- The next occurrence of that weekday and hour in the HOST'S zone,
           -- returned as a timestamptz so the client renders it in the
           -- viewer's. Today counts only if the hour has not passed.
           (date_trunc('day', now() at time zone coalesce(h.hosts_tz, 'UTC'))
             + make_interval(
                 days => ((h.hosts_weekday - extract(dow from
                            (now() at time zone coalesce(h.hosts_tz, 'UTC')))::int) + 7) % 7
                       + case when ((h.hosts_weekday - extract(dow from
                             (now() at time zone coalesce(h.hosts_tz, 'UTC')))::int) + 7) % 7 = 0
                             and extract(hour from
                               (now() at time zone coalesce(h.hosts_tz, 'UTC')))::int >= h.hosts_hour
                          then 7 else 0 end,
                 hours => h.hosts_hour)
           ) at time zone coalesce(h.hosts_tz, 'UTC')
         end,
         exists (select 1 from public.party_reminders r
                  where r.user_id = auth.uid() and r.host_id = h.id),
         exists (select 1 from public.parties p
                  where p.host_user_id = h.id and p.ended_at is null
                    and p.created_at > now() - interval '6 hours')
    from public.host_follows f
    join public.profiles h on h.id = f.host_user_id
   where f.follower_user_id = auth.uid()
     and not h.public_parties_banned
   order by 7 nulls last
   limit 60;
$$;

revoke execute on function public.coming_up() from public, anon;
grant  execute on function public.coming_up() to authenticated;

-- ===========================================================================
-- 8. The relay is separable from the registry
-- ===========================================================================
--
-- A party is three things: the registry row and join code (cheap), the Durable
-- Object relay (the actual cost), and content resolution (per viewer, local).
-- Recording where to connect is what lets a self-hoster run their own relay
-- against our registry. Additive and defaulted, so nothing changes until
-- something sets it.

alter table public.parties
  add column if not exists relay_url text;

comment on column public.parties.relay_url is
  'Where guests connect for playback sync. Null means the default veedeeoh '
  'relay. Set when a self-hosted instance runs its own Durable Object but '
  'lists the party on the shared registry.';

-- party_by_code is how a guest finds the door, so it is where the relay
-- address has to come out.
drop function if exists public.party_by_code(text);

create function public.party_by_code(code text)
returns table (
  id uuid, join_code text, content_id text, stream_idx int,
  title text, seat_limit int, host_user_id uuid, is_public boolean,
  host_name text, social_platform text, social_handle text,
  host_handle text, relay_url text, requires_approval boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.join_code, p.content_id, p.stream_idx,
         p.title, p.seat_limit, p.host_user_id, p.is_public,
         coalesce(h.display_name, p.host_name), h.social_platform, h.social_handle,
         h.public_handle, p.relay_url, p.requires_approval
    from public.parties p
    left join public.profiles h on h.id = p.host_user_id
   where upper(p.join_code) = upper(code)
     and p.ended_at is null
   limit 1;
$$;

revoke execute on function public.party_by_code(text) from public, anon;
grant  execute on function public.party_by_code(text) to authenticated;
