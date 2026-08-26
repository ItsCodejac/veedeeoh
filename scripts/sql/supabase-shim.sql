-- Enough of Supabase to run this repo's migrations against a bare Postgres.
--
-- The point is to answer one question that cannot be answered against the live
-- project: does a database built only from supabase/migrations come out
-- working? Running them against production proves nothing, because production
-- already has everything.
--
-- This is a test fixture, never a migration. It creates the pieces Supabase
-- provides and the migrations assume: the four roles, the auth schema with the
-- columns our triggers read, and the auth.* helpers that RLS policies call.
-- auth.uid() reads a session GUC so a test can act as a given user.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Only the columns the migrations actually touch. handle_new_user reads id,
-- email and raw_user_meta_data; nothing here reads the rest.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- request.jwt.claim.sub is the GUC Supabase populates per request. Setting it
-- with set_config in a test makes every policy behave as that user; leaving it
-- unset is the anonymous case.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant usage on schema public to anon, authenticated, service_role;
