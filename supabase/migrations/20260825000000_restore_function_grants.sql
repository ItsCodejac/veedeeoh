-- The app cannot call its own functions.
--
-- FOUND IN PRODUCTION, not in a harness: every RPC veedeeoh.party makes returns
-- 42501 "permission denied for function" for the `authenticated` role, while
-- table reads on the same session succeed. The party surface has therefore been
-- rendering empty states -- no open parties, no credit record, no history --
-- that look exactly like a quiet directory and are actually a dead one.
--
-- WHAT IS CERTAIN: `authenticated` holds no EXECUTE on these functions.
-- popular_content, the one RPC the client calls that was created in the
-- dashboard and never had a revoke/grant pair written for it, is the only one
-- that still works.
--
-- WHAT IS NOT: which statement took the privilege away. Every migration in this
-- repo that revokes EXECUTE grants it back to `authenticated` on the next line,
-- and the audit scripts are read-only. Rather than guess, this migration
-- reasserts the intended end state, and the query at the foot of the file
-- reports what is actually there so the cause can be found rather than assumed.
--
-- Idempotent, and safe to run repeatedly.

do $$
declare
  fn text;
  sig text;
  -- Everything the client calls, plus the entitlement helpers that policies and
  -- the client both reach for. Named explicitly: a blanket grant over the schema
  -- would also hand out admin_apply_grants and grant_monthly_credits, which are
  -- definer functions that move money and must stay unreachable from a browser.
  wanted text[] := array[
    'accept_household_invite', 'am_i_blocked', 'answer_appeal',
    'attribute_party_join', 'attribute_referral', 'can_host_party',
    'can_join_party', 'can_list_public_party', 'claim_handle', 'coming_up',
    'ensure_party_credits', 'ensure_referral_code', 'followed_live_parties',
    'is_entitled', 'my_blocks', 'my_private_parties', 'my_suggestions',
    'party_by_code', 'party_credit_summary', 'party_join_allowance',
    'party_joins_this_month', 'party_signups', 'public_parties',
    'public_party_facets', 'public_profile', 'redeem_beta_invite',
    'referral_summary', 'report_profile', 'seat_usage', 'send_block_appeal',
    'set_party_note', 'spend_party_credits', 'suggest_to_host', 'unblock_user'
  ];
begin
  foreach fn in array wanted loop
    -- By identity rather than by bare name, so an overload cannot make the
    -- statement ambiguous and abort the whole migration -- which is one way a
    -- grant silently fails to land while the revoke beside it succeeds.
    for sig in
      select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from public, anon', sig);
      execute format('grant  execute on function %s to authenticated', sig);
    end loop;
  end loop;
end $$;

-- What the client is allowed to call now. Every row should read `authenticated`
-- and nothing else; a function the app calls that is missing here is a dead
-- surface, which is the failure this migration exists to end.
select p.proname                                   as function,
       coalesce(
         (select string_agg(distinct a.rolname, ', ' order by a.rolname)
            from aclexplode(p.proacl) x
            join pg_roles a on a.oid = x.grantee
           where x.privilege_type = 'EXECUTE'),
         'PUBLIC (default)')                       as may_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
 order by 1;
