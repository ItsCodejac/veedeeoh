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
