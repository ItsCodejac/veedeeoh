-- Watch Party. Design: docs/plans/2026-08-21-watch-party-design.md
--
-- Supabase holds CONFIGURATION; the Cloudflare Durable Object holds LIVENESS.
-- Seat limits are enforced in the Durable Object because it is the only
-- component that knows how many viewers are connected right now -- a row count
-- in Postgres cannot express that.
--
-- Safe to re-run.

create table if not exists public.parties (
  id            uuid primary key default gen_random_uuid(),
  host_user_id  uuid not null references auth.users(id) on delete cascade,
  join_code     text unique not null,
  content_id    text not null,
  stream_idx    int  not null default 0,
  title         text,
  password_hash text,                    -- null = no password
  seat_limit    int,                     -- null = uncapped
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index if not exists parties_host_idx on public.parties (host_user_id, created_at desc);
create index if not exists parties_open_idx on public.parties (join_code) where ended_at is null;

-- Who joined which party, and who invited them. This is the whole attribution
-- story for the affiliate work: a guest must sign in to join, so the host is
-- known at join time. No codes, no cookies, no last-touch guessing.
create table if not exists public.party_joins (
  party_id     uuid not null references public.parties(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists party_joins_host_idx on public.party_joins (host_user_id, joined_at desc);
create index if not exists party_joins_user_idx on public.party_joins (user_id);

alter table public.parties     enable row level security;
alter table public.party_joins enable row level security;

-- Hosting is an ACCOUNT-level entitlement, not per-profile: only the account
-- owner creates parties. Enforced here rather than by hiding the tab, because
-- hidden UI is not a control.
drop policy if exists "host manages own parties" on public.parties;
create policy "host manages own parties" on public.parties
  for all to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

-- A guest needs to read the party they are joining. Restricted to open parties
-- looked up by join code; nothing here exposes the host's other parties.
drop policy if exists "read open parties" on public.parties;
create policy "read open parties" on public.parties
  for select to authenticated
  using (ended_at is null);

drop policy if exists "see own joins or joins to my parties" on public.party_joins;
create policy "see own joins or joins to my parties" on public.party_joins
  for select to authenticated
  using (user_id = auth.uid() or host_user_id = auth.uid());

drop policy if exists "record own join" on public.party_joins;
create policy "record own join" on public.party_joins
  for insert to authenticated
  with check (user_id = auth.uid());

comment on table public.party_joins is
  'Join records double as referral attribution: the host invited the guest and '
  'the guest had to sign in, so a later subscription is unambiguously credited.';
