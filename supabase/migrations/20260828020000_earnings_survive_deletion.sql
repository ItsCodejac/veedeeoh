-- Earned commission is a debt, and a debt should outlive the row it points at.
--
-- referral_earnings had ON DELETE CASCADE on both sides, which produced two
-- different problems from one clause.
--
-- THE BAD ONE. referred_user_id cascaded, so when a CUSTOMER deleted their
-- account, every commission row their subscription had generated was destroyed
-- with it. Somebody who brought ten people lost the record of what nine of them
-- had already paid them because the tenth closed an account. Money earned,
-- erased by a third party's unrelated action.
--
-- THE OTHER ONE. referrer_user_id cascaded too, so an affiliate deleting their
-- own account destroyed the record of what they were owed. That is bad for them
-- and bad for us: the accounting record behind revenue we recognised disappears,
-- and tax retention obligations do not go away because somebody pressed delete.
--
-- Both become ON DELETE SET NULL. The row survives as what it always was, a
-- ledger entry with an amount, a rate and a Stripe invoice id. What leaves is
-- the link to a person, which is the part that is personal data. That is the
-- right split: erasure removes the identity, accounting keeps the number.
--
-- A NOTE ON THE FORFEITURE QUESTION THIS CAME FROM. Expiring unclaimed balances
-- into our own pocket is a poor idea: unclaimed money owed to a person is
-- generally not the payer's to absorb, and "they never claimed it" is a weak
-- position while the payout button does not exist yet. Deleting your own
-- account is different, because it is an affirmative act that makes payment
-- impossible -- there is no longer anybody to pay. That is the only forfeiture
-- here, and it is a consequence rather than a policy.

alter table public.referral_earnings
  alter column referrer_user_id drop not null,
  alter column referred_user_id drop not null;

alter table public.referral_earnings
  drop constraint if exists referral_earnings_referrer_user_id_fkey,
  drop constraint if exists referral_earnings_referred_user_id_fkey;

alter table public.referral_earnings
  add constraint referral_earnings_referrer_user_id_fkey
    foreign key (referrer_user_id) references auth.users(id) on delete set null,
  add constraint referral_earnings_referred_user_id_fkey
    foreign key (referred_user_id) references auth.users(id) on delete set null;

comment on column public.referral_earnings.referrer_user_id is
  'Who earned it. Null once that account is deleted: the ledger entry stays for '
  'accounting, the link to a person does not. Nobody left to pay.';
comment on column public.referral_earnings.referred_user_id is
  'Whose payment generated it. Null once that account is deleted. The commission '
  'still happened and is still owed to the referrer.';

-- What an account is owed but has not been paid. Read by the delete flow so
-- somebody closing their account is told before they confirm, rather than
-- finding out that they cannot be told afterwards.
create or replace function public.unpaid_earnings_cents()
returns integer language sql stable security definer set search_path to 'public'
as $$
  select coalesce(sum(commission_cents), 0)::int
    from public.referral_earnings
   where referrer_user_id = auth.uid()
     and paid_out_at is null;
$$;

revoke execute on function public.unpaid_earnings_cents() from public, anon;
grant execute on function public.unpaid_earnings_cents() to authenticated;
