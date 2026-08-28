\set ON_ERROR_STOP on
-- 1. signup creates a profile
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','alice@example.com'),
  ('22222222-2222-2222-2222-222222222222','bob@example.com');
select '1. signup trigger        : ' ||
  case when count(*)=2 then 'PASS both profiles created, tier='||max(tier) else 'FAIL '||count(*) end
from public.profiles;

-- 2. alice creates a viewing profile, as the authenticated role
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.household_profiles (user_id, name) values
  ('11111111-1111-1111-1111-111111111111','Alice TV');
select '2. profile insert (RLS)  : PASS';

-- 3. alice sees only her own account row
select '3. profiles isolation    : ' ||
  case when count(*)=1 and max(email)='alice@example.com' then 'PASS sees only self'
       else 'FAIL sees '||count(*) end from public.profiles;

-- 4. watch_progress through can_use_profile
insert into public.watch_progress (profile_id, content_id, title, position_secs)
select id,'tubi:12345','Test Title',42 from public.household_profiles limit 1;
select '4. can_use_profile write : PASS';

-- 5. bob cannot read alice's rows
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select '5. cross-account read    : ' ||
  case when (select count(*) from public.household_profiles)=0
        and (select count(*) from public.watch_progress)=0
       then 'PASS bob sees nothing of alice''s' else 'FAIL leak' end;

-- 6. seat cap trigger fires
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
reset role;
update public.profiles set seats=1 where id='11111111-1111-1111-1111-111111111111';
set role authenticated;
do $$ begin
  begin
    insert into public.household_profiles (user_id, name)
      values ('11111111-1111-1111-1111-111111111111','Second');
    raise notice '6. seat cap trigger      : FAIL insert allowed past cap';
  exception when others then
    raise notice '6. seat cap trigger      : PASS refused (%)', left(sqlerrm, 44);
  end;
end $$;

-- 7. anonymous is refused
select set_config('request.jwt.claim.sub','',false);
set role anon;
select '7. anonymous read        : ' ||
  case when (select count(*) from public.profiles)=0 then 'PASS refused' else 'FAIL leak' end;
reset role;

-- 8/9. one open party per host: starting a second party closes the first, and
-- the unique index holds if anything ever gets past the trigger. Run as the
-- table owner on purpose -- this is testing the invariant, not the RLS policy
-- that decides who may host.
reset role;
insert into public.parties (host_user_id, join_code, content_id, title)
values ('11111111-1111-1111-1111-111111111111','AAAAAA','tubi:1','First'),
       ('11111111-1111-1111-1111-111111111111','BBBBBB','tubi:2','Second');
select '8. prior party closed    : ' ||
  case when count(*) filter (where ended_at is null) = 1
        and max(title) filter (where ended_at is null) = 'Second'
       then 'PASS only the newest is open'
       else 'FAIL '||count(*) filter (where ended_at is null)||' open' end
from public.parties;

do $$ begin
  begin
    -- Bypass the trigger to prove the index is load-bearing on its own.
    alter table public.parties disable trigger parties_close_prior;
    insert into public.parties (host_user_id, join_code, content_id, title)
      values ('11111111-1111-1111-1111-111111111111','CCCCCC','tubi:3','Third');
    raise notice '9. unique index          : FAIL second open party allowed';
  exception when unique_violation then
    raise notice '9. unique index          : PASS refused a second open party';
  end;
  alter table public.parties enable trigger parties_close_prior;
end $$;

-- 10. deleting an account deletes the account's data. This failed before
-- 20260826040000: only the parties row went, and profile names, PIN hashes,
-- viewing history, favourites and an invited third party's email address all
-- survived with no session left that could ever read or remove them.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','carol@example.com');
insert into public.household_profiles (id, user_id, name, pin)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','Carol TV','hashedpin');
insert into public.watch_progress (profile_id, content_id, title)
  values ('44444444-4444-4444-4444-444444444444','tubi:99','Watched');
insert into public.favorites (profile_id, content_id, title)
  values ('44444444-4444-4444-4444-444444444444','tubi:99','Liked');
insert into public.household_invites (owner_id, invited_email)
  values ('33333333-3333-3333-3333-333333333333','carols-friend@example.com');
insert into public.parties (host_user_id, join_code, content_id, title)
  values ('33333333-3333-3333-3333-333333333333','ZZZZZZ','tubi:99','Carol Party');

delete from auth.users where id = '33333333-3333-3333-3333-333333333333';

select '10. deletion cascades    : ' ||
  case when (select count(*) from public.profiles where id='33333333-3333-3333-3333-333333333333')=0
        and (select count(*) from public.household_profiles where user_id='33333333-3333-3333-3333-333333333333')=0
        and (select count(*) from public.watch_progress where profile_id='44444444-4444-4444-4444-444444444444')=0
        and (select count(*) from public.favorites where profile_id='44444444-4444-4444-4444-444444444444')=0
        and (select count(*) from public.household_invites where owner_id='33333333-3333-3333-3333-333333333333')=0
        and (select count(*) from public.parties where host_user_id='33333333-3333-3333-3333-333333333333')=0
       then 'PASS nothing of the account survives'
       else 'FAIL leftovers: hp='
            ||(select count(*) from public.household_profiles where user_id='33333333-3333-3333-3333-333333333333')
            ||' watch='||(select count(*) from public.watch_progress where profile_id='44444444-4444-4444-4444-444444444444')
            ||' favs='||(select count(*) from public.favorites where profile_id='44444444-4444-4444-4444-444444444444')
            ||' invites='||(select count(*) from public.household_invites where owner_id='33333333-3333-3333-3333-333333333333')
       end;

-- 11-15. Gifting credits. The two properties worth asserting are the abuse
-- ones: a gift must not feed the free-month counters, and it must never destroy
-- credits by clipping at the cap.
--
-- Two traps this hit while being written, both worth the comment. Each gift is
-- its own statement and every assertion is a LATER statement, because reading
-- balances in the same select as the call sees the pre-call snapshot. And the
-- assertions run with `reset role`, because as `authenticated` the RLS policy
-- correctly hides the recipient's profile row and every subquery about them
-- returns NULL -- the test fails while the function is perfectly correct.
reset role;
update public.profiles set party_credits = 100, party_credits_accrued = 100, party_credits_spent = 0
 where id = '11111111-1111-1111-1111-111111111111';
-- 175 of a 180 cap, so there is room for 5 and no more: enough to prove the
-- overflow path without tripping the sender's balance check first.
update public.profiles set party_credits = 175, party_credits_accrued = 10
 where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.gift_party_credits('22222222-2222-2222-2222-222222222222', 4) as g1 \gset
select public.gift_party_credits('22222222-2222-2222-2222-222222222222', 50) as g2 \gset
select public.gift_party_credits('11111111-1111-1111-1111-111111111111', 5)  as g3 \gset
select public.gift_party_credits('22222222-2222-2222-2222-222222222222', 5000) as g4 \gset
reset role;

select '11. gift moves balance   : ' ||
  case when (select party_credits from public.profiles where id='11111111-1111-1111-1111-111111111111') = 96
        and (select party_credits from public.profiles where id='22222222-2222-2222-2222-222222222222') = 179
       then 'PASS 4 moved, both balances correct'
       else 'FAIL sender='||(select party_credits from public.profiles where id='11111111-1111-1111-1111-111111111111')
            ||' recipient='||(select party_credits from public.profiles where id='22222222-2222-2222-2222-222222222222') end;

select '12. accrued untouched    : ' ||
  case when (select party_credits_accrued from public.profiles where id='22222222-2222-2222-2222-222222222222') = 10
        and (select party_credits_spent   from public.profiles where id='11111111-1111-1111-1111-111111111111') = 0
       then 'PASS gifts cannot mint free months'
       else 'FAIL counters moved' end;

select '13. overflow refused     : ' ||
  case when :'g2'::jsonb ->> 'error' = 'that is more than they can hold'
        and (:'g2'::jsonb ->> 'headroom') = '1'
       then 'PASS refused, nothing destroyed' else 'FAIL '||:'g2' end;

select '14. self-gift refused    : ' ||
  case when :'g3'::jsonb ->> 'error' = 'choose someone else'
       then 'PASS' else 'FAIL '||:'g3' end;

select '15. overdraft refused    : ' ||
  case when :'g4'::jsonb ->> 'error' in ('not enough credits','that is more than they can hold')
        and (select party_credits from public.profiles where id='11111111-1111-1111-1111-111111111111') = 96
       then 'PASS' else 'FAIL '||:'g4' end;

-- 16-18. The household invite path, now that the UI can reach it.
-- accept_household_invite has shipped for months with nothing able to create an
-- invitation for it to accept, so this is its first test.
reset role;
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555','owner@example.com'),
  ('66666666-6666-6666-6666-666666666666','guest@example.com'),
  ('77777777-7777-7777-7777-777777777777','spare@example.com');
update public.profiles set seats = 2 where id = '55555555-5555-5555-5555-555555555555';
insert into public.household_invites (id, owner_id, invited_email, token)
values ('88888888-8888-8888-8888-888888888888',
        '55555555-5555-5555-5555-555555555555', 'guest@example.com', 'tok-guest'),
       ('99999999-9999-9999-9999-999999999999',
        '55555555-5555-5555-5555-555555555555', 'spare@example.com', 'tok-spare');

set role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
select public.accept_household_invite('tok-guest') as a1 \gset
select public.accept_household_invite('tok-guest') as a2 \gset
reset role;

select '16. invite seats a member: ' ||
  case when :'a1' = '55555555-5555-5555-5555-555555555555'
        and (select count(*) from public.household_members
              where owner_id='55555555-5555-5555-5555-555555555555'
                and member_user_id='66666666-6666-6666-6666-666666666666') = 1
        and (select status from public.household_invites
              where id='88888888-8888-8888-8888-888888888888') = 'accepted'
       then 'PASS joined and the invite is spent'
       else 'FAIL' end;

select '17. re-accept is a no-op : ' ||
  case when :'a2' = '55555555-5555-5555-5555-555555555555'
        and (select count(*) from public.household_members
              where owner_id='55555555-5555-5555-5555-555555555555') = 1
       then 'PASS no second seat taken'
       else 'FAIL duplicated the membership' end;

-- Owner plus one member fills two seats, so the next invitation must be refused
-- rather than seating somebody the profile trigger would later reject.
set role authenticated;
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
do $$
begin
  perform public.accept_household_invite('tok-spare');
  raise notice '18. full household       : FAIL third person was seated';
exception when others then
  raise notice '18. full household       : PASS refused (%)', left(sqlerrm, 40);
end $$;
reset role;

-- 19-21. Opting out of earning. On by default, off is honoured, and off is a
-- different fact from never having engaged -- which is what the old
-- `where user_id = host and active` filter collapsed.
reset role;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','host-on@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002','host-off@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000003','guest-a@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000004','guest-b@example.com');
insert into public.parties (id, host_user_id, join_code, content_id, title) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ONHOST','tubi:1','On'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','OFFHST','tubi:2','Off');

set role authenticated;
-- host-off switches earning off; host-on never touches it
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false);
select public.set_referral_participation(false) as optout \gset

select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000003',false);
select public.attribute_party_join('bbbbbbbb-0000-0000-0000-000000000001') as j1 \gset
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000004',false);
select public.attribute_party_join('bbbbbbbb-0000-0000-0000-000000000002') as j2 \gset
reset role;

select '19. earning on by default: ' ||
  case when (select count(*) from public.referrals
              where referrer_user_id='aaaaaaaa-0000-0000-0000-000000000001') = 1
        and (select rate_bps from public.referrals
              where referrer_user_id='aaaaaaaa-0000-0000-0000-000000000001') = 5000
       then 'PASS host who never engaged still earns 50%'
       else 'FAIL '||:'j1' end;

select '20. opting out is honoured: ' ||
  case when :'j2'::jsonb ->> 'declined' = 'true'
        and (select count(*) from public.referrals
              where referrer_user_id='aaaaaaaa-0000-0000-0000-000000000002') = 0
       then 'PASS no referral written'
       else 'FAIL '||:'j2' end;

select '21. off is a real record  : ' ||
  case when (select active from public.referral_codes
              where user_id='aaaaaaaa-0000-0000-0000-000000000002') = false
       then 'PASS stored as active=false, not an absence'
       else 'FAIL' end;
