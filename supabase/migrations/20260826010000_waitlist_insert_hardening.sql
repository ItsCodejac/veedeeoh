-- Bring the repo's waitlist policy up to what production actually enforces.
--
-- Found by building a database from migrations only and diffing it against
-- live. The repo still creates the original policy from 20260721000000:
--
--   create policy "Allow public waitlist insertions" on public.waitlist
--     for insert with check (true);
--
-- No role restriction and no check at all, so any caller could write any text
-- into the email column as many times as it liked. Production had been
-- tightened by hand at some point and nothing recorded it, which means every
-- self-hosted instance built from this repo shipped the open version.
--
-- This is the live definition, written down. It restricts the policy to the two
-- roles that should ever reach it and requires something email-shaped: an @ that
-- is not the first character, and a length inside the RFC ceiling.
--
-- The name changes too, so the old policy is dropped by its old name first.

drop policy if exists "Allow public waitlist insertions" on public.waitlist;
drop policy if exists waitlist_public_insert on public.waitlist;

create policy waitlist_public_insert on public.waitlist
  for insert to anon, authenticated
  with check (
    email is not null
    and position('@' in email) > 1
    and length(email) <= 320
  );
