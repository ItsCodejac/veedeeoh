-- The party password is gone.
--
-- It travelled in the same message as the invite link, so it protected nothing,
-- and the boot handler read it from `?pw=` -- putting it in browser history,
-- server access logs and referrer headers. A password that cannot be kept out
-- of the URL is not a password.
--
-- Access control is now a seat limit plus host approval, enforced in the
-- Durable Object where the live connection count actually lives.
--
-- Safe to re-run.

alter table public.parties drop column if exists password_hash;

comment on table public.parties is
  'Party configuration. Liveness, seat enforcement and join approval belong to '
  'the Durable Object -- Postgres cannot see who is currently connected.';
