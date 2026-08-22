-- Which trial reminder an account has already been sent.
--
-- The cron is idempotent on this column: a double run, a retry, or a redeploy
-- cannot mail the same person the same stage twice. Six trials expired with no
-- warning at all and none converted; mailing them three times instead would be
-- a worse version of the same failure.
--
-- Values: 'day2' | 'day1' | 'ended' | null.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists trial_email_sent text;

comment on column public.profiles.trial_email_sent is
  'Last trial reminder stage sent (day2 / day1 / ended). Makes the daily cron '
  'idempotent -- it is a stage marker, not a boolean.';
