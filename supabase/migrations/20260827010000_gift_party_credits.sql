-- Gifting watch party credits to somebody else.
--
-- The viewer-support case: you are in someone's party, they are paying for the
-- hosting out of their own balance, and you want to chip in. A gift moves
-- prepaid compute between two accounts. No money moves, nothing is redeemable
-- for cash, and the credit stays what it has always been -- hosting time.
--
-- TWO THINGS THIS DELIBERATELY DOES NOT DO.
--
-- It does not touch party_credits_accrued. That column is lifetime GRANTED and
-- it drives the 240-credit free-month trigger. If a gift counted toward it,
-- two accounts could pass the same credits back and forth and mint free months
-- out of nothing. Gifts move the spendable balance and only that.
--
-- It does not increment party_credits_spent on the sender either. Spent means
-- spent on hosting, and it is the other half of the same free-month arithmetic.
-- A gift is a transfer, not a spend, and the ledger is where it is recorded.
--
-- AND IT CARRIES NO MESSAGE. There is no note parameter, on purpose. This
-- product already decided once that a party gets six reactions and no chat box,
-- because free text is how you say something targeted at a person. A gift note
-- would be exactly that: an unmoderated string, delivered to a named individual,
-- attached to something they cannot decline without losing the credits. The
-- ledger note is written by this function, not by the sender.

-- The ledger's reason list is a check constraint, so it has to learn the two
-- new kinds before anything can be written with them.
alter table public.party_credit_ledger
  drop constraint if exists party_credit_ledger_reason_check;

alter table public.party_credit_ledger
  add constraint party_credit_ledger_reason_check
  check (reason in ('monthly_grant', 'purchase', 'spend', 'admin',
                    'gift_sent', 'gift_received'));

-- Gift credits to another account.
--
-- SECURITY DEFINER because it writes the recipient's balance, which the sender
-- cannot see or touch under RLS. Both sides are updated inside one statement
-- pair under a row lock on the sender, so a double-tap cannot spend the same
-- credits twice.
create or replace function public.gift_party_credits(recipient uuid, amount integer)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid       uuid := auth.uid();
  sender    public.profiles%rowtype;
  target    public.profiles%rowtype;
  cap       constant int := 180;   -- the spendable ceiling, as set in 20260822020000
  headroom  int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if recipient is null or recipient = uid then
    return jsonb_build_object('ok', false, 'error', 'choose someone else');
  end if;
  if amount is null or amount < 1 then
    return jsonb_build_object('ok', false, 'error', 'amount must be at least 1 credit');
  end if;

  -- Locked first and by id order is not needed here: only the sender's balance
  -- is checked against, and the recipient can only go up.
  select * into sender from public.profiles where id = uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no account');
  end if;

  -- An exempt account hosts without spending, so it has no meaningful balance
  -- to give away. Letting it gift would mint credits from an exemption.
  if sender.party_credits_exempt then
    return jsonb_build_object('ok', false, 'error',
      'this account hosts without using credits, so it has none to give');
  end if;

  if sender.party_credits < amount then
    return jsonb_build_object('ok', false, 'error', 'not enough credits',
                              'balance', sender.party_credits);
  end if;

  select * into target from public.profiles where id = recipient;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such account');
  end if;

  -- NOTHING IS DESTROYED BY A GIFT. The balance is capped at 180, so a gift
  -- that would overflow is refused with the room that is actually available,
  -- rather than accepted and silently clipped. The sender keeps their credits
  -- and can send the smaller amount.
  headroom := cap - target.party_credits;
  if headroom <= 0 then
    return jsonb_build_object('ok', false, 'error',
      'they are already holding the maximum 30 hours', 'headroom', 0);
  end if;
  if amount > headroom then
    return jsonb_build_object('ok', false, 'error',
      'that is more than they can hold', 'headroom', headroom);
  end if;

  update public.profiles
     set party_credits = party_credits - amount
   where id = uid;

  update public.profiles
     set party_credits = party_credits + amount
   where id = recipient;

  insert into public.party_credit_ledger (user_id, delta, reason, note)
  values (uid, -amount, 'gift_sent',
          coalesce('to @' || target.public_handle, 'Sent as a gift')),
         (recipient, amount, 'gift_received',
          coalesce('from @' || sender.public_handle, 'Received as a gift'));

  return jsonb_build_object('ok', true, 'sent', amount,
                            'balance', sender.party_credits - amount);
end;
$$;

revoke execute on function public.gift_party_credits(uuid, integer) from public, anon;
grant execute on function public.gift_party_credits(uuid, integer) to authenticated;

comment on function public.gift_party_credits(uuid, integer) is
  'Move spendable credits to another account. Never touches accrued or spent, '
  'so gifts cannot be cycled to trigger a free month. Refuses rather than '
  'clipping when the recipient is near the 180 cap. Carries no message.';
