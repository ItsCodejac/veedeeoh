-- Read-only account pipeline check. Changes nothing. Paste whole, run once.
--
-- ONE QUERY ON PURPOSE. The Supabase SQL editor shows the result of the last
-- statement only, so a file of eleven separate SELECTs reports one of them and
-- silently drops the other ten -- which is worse than not checking, because it
-- looks like it passed.
--
-- Exists because half this pipeline is not in the repo: public.profiles was
-- created in the dashboard before migrations started, so its defaults, its
-- constraints and whatever creates a row at signup cannot be read from code.
--
-- Read the `flag` column. Anything that is not 'ok' or '' wants a look.

with expected as (
  select * from (values
    ('is_entitled',            true),
    ('can_host_party',         true),
    ('can_join_party',         true),
    ('party_joins_this_month', true),
    ('party_join_allowance',   true),
    ('grant_monthly_credits',  true),
    ('ensure_party_credits',   true),
    ('party_credit_summary',   true),
    ('spend_party_credits',    true),
    ('apply_grants',           true),
    ('redeem_beta_invite',     true),
    -- never written; the browse gate is client-side only, by decision
    ('has_active_access',      false)
  ) as t(name, should_exist)
),
fns as (
  select p.proname as name, pg_get_functiondef(p.oid) as def, p.prosecdef as definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),

-- 1. every function entitlement depends on, and whether the right migration won
functions as (
  select '1 functions' as section,
         e.name as item,
         coalesce(
           case when f.name is null then 'ABSENT'
                else 'present' ||
                     case when f.definer then ', definer' else ', INVOKER' end ||
                     coalesce(', tiers via ' ||
                       case when f.def ilike '%is_entitled()%' then 'is_entitled'
                            when f.def ilike '%founder_vip%'   then 'OWN COPY'
                       end, '') ||
                     coalesce(', grant=' || (regexp_match(f.def, 'grant_size\s+constant\s+int\s*:=\s*(\d+)'))[1], '') ||
                     coalesce(', cap='   || (regexp_match(f.def, 'party_joins_this_month\(\)\s*<\s*(\d+)'))[1], '')
           end, 'ABSENT') as detail,
         case
           when (f.name is not null) <> e.should_exist and e.should_exist then 'MISSING - run the migrations'
           when (f.name is not null) <> e.should_exist then 'unexpected: this was never written'
           when f.name is not null and not f.definer then 'should be SECURITY DEFINER'
           when e.name = 'can_host_party'        and f.def not ilike '%is_entitled()%' then 'stale: 030000 did not run'
           when e.name = 'grant_monthly_credits' and f.def not like '%60%'             then 'stale: 020000 did not run'
           else 'ok'
         end as flag
    from expected e left join fns f on f.name = e.name
),

-- 2. the two gates that are actually enforced in the database
policies as (
  select '2 policies' as section,
         c.relname || ' / ' || pol.polname as item,
         case pol.polcmd when 'a' then 'INSERT' when 'w' then 'UPDATE'
                         when 'r' then 'SELECT' else pol.polcmd::text end
           || ': ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),
                               pg_get_expr(pol.polqual, pol.polrelid), '') as detail,
         case
           when c.relname = 'party_joins' and pol.polcmd = 'a'
                and pg_get_expr(pol.polwithcheck, pol.polrelid) not ilike '%can_join_party%'
             then 'join cap NOT enforced - run 030000'
           when c.relname = 'parties' and pol.polcmd = 'a'
                and pg_get_expr(pol.polwithcheck, pol.polrelid) not ilike '%can_host_party%'
             then 'hosting NOT gated'
           else 'ok'
         end as flag
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname in ('party_joins', 'parties')
),

-- 3. what creates a profiles row at signup, if anything
triggers as (
  select '3 signup' as section,
         c.relname || ' / ' || t.tgname as item,
         pg_get_triggerdef(t.oid) as detail,
         'ok' as flag
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname in ('users', 'profiles')
),
trigger_absence as (
  select '3 signup', '(no trigger found)',
         'nothing on auth.users or profiles creates the account row',
         'CHECK: a signed-in user with no profiles row fails OPEN in hasActiveAccess'
   where not exists (
     select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relname in ('users', 'profiles'))
),

-- 4. the shape of the row entitlement reads
columns as (
  select '4 profiles' as section,
         column_name as item,
         data_type || coalesce(' default ' || column_default, ' (no default)')
           || case when is_nullable = 'YES' then ', nullable' else ', not null' end as detail,
         case when column_name = 'tier' and column_default ilike '%founder%'
                then 'every new row would be comped'
              else 'ok' end as flag
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name in ('tier','tier_expires','seats','party_credits',
                         'party_credits_exempt','credits_granted_for',
                         'stripe_customer_id','stripe_subscription_id')
),

-- 5. population, by what entitlement actually resolves to
tiers as (
  select '5 accounts' as section,
         coalesce(tier, '(null tier)') as item,
         count(*) || ' accounts, ' ||
         count(*) filter (where tier_expires is null) || ' no expiry, ' ||
         count(*) filter (where tier_expires > now()) || ' unexpired, ' ||
         count(*) filter (where tier_expires <= now()) || ' expired, ' ||
         count(*) filter (where party_credits_exempt) || ' exempt' as detail,
         'ok' as flag
    from public.profiles group by tier
),

-- 6. did the 020000 clawback land
clawback as (
  select '6 clawback' as section,
         coalesce(p.email, p.id::text) as item,
         'tier=' || coalesce(p.tier,'null') ||
         ', credits=' || p.party_credits ||
         ', granted_for=' || coalesce(p.credits_granted_for::text, 'null') as detail,
         'unentitled but holds credits or a month stamp' as flag
    from public.profiles p
   where not p.party_credits_exempt
     and not (p.tier in ('founder_vip','giveaway','cloud_paid','trial_7day','trial_dollar_month')
              and (p.tier_expires is null or p.tier_expires > now()))
     and (p.party_credits > 0 or p.credits_granted_for is not null)
),

-- 7. joins this month against the cap
joins as (
  select '7 joins' as section,
         coalesce(p.email, p.id::text) as item,
         count(j.party_id) || ' parties this month, tier=' || coalesce(p.tier,'null') as detail,
         case when count(j.party_id) > 4
               and not (p.tier in ('founder_vip','giveaway','cloud_paid','trial_7day','trial_dollar_month')
                        and (p.tier_expires is null or p.tier_expires > now()))
              then 'OVER CAP for an unentitled account' else 'ok' end as flag
    from public.profiles p
    join public.party_joins j
      on j.user_id = p.id and j.joined_at >= date_trunc('month', now())
   group by p.id, p.email, p.tier, p.tier_expires
),

-- 8. seats against profiles actually created
seats as (
  select '8 seats' as section,
         coalesce(p.email, p.id::text) as item,
         count(hp.id) || ' of ' || coalesce(p.seats, 3) || ' seats used' as detail,
         case when count(hp.id) > coalesce(p.seats, 3) then 'OVER SEAT CAP' else 'ok' end as flag
    from public.profiles p
    left join public.household_profiles hp on hp.user_id = p.id
   group by p.id, p.email, p.seats
),

-- 9. stripe linkage that stopped halfway
stripe as (
  select '9 stripe' as section,
         coalesce(email, id::text) as item,
         'customer=' || (stripe_customer_id is not null) ||
         ', subscription=' || (stripe_subscription_id is not null) ||
         ', tier=' || coalesce(tier,'null') as detail,
         'half-linked: normal transiently, stuck if it persists' as flag
    from public.profiles
   where (stripe_customer_id is null) <> (stripe_subscription_id is null)
)

select * from functions
union all select * from policies
union all select * from triggers
union all select * from trigger_absence
union all select * from columns
union all select * from tiers
union all select * from clawback
union all select * from joins
union all select * from seats
union all select * from stripe
order by section, flag desc, item;
