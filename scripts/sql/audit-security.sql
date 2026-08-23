-- Read-only security audit of the public schema. Changes nothing.
-- Paste whole, run once, read the `flag` column. Anything not 'ok' wants a look.
--
-- ONE QUERY, because the Supabase editor returns only the last statement's
-- result and a file of separate SELECTs reports one section while silently
-- dropping the rest -- which looks like a pass.
--
-- WHY THIS EXISTS. Six tables the app reads and writes every day are in no
-- migration at all -- household_profiles, favorites, watch_progress,
-- household_members, household_invites, catalog_cache -- because they were made
-- in the dashboard before migrations started. Nothing in the repo says whether
-- they have RLS, what their policies are, or who can write to them. Auditing
-- the migrations proves nothing about those, and they hold the household's
-- data and the catalogue everyone is served from.

with

-- 1. Row security, per table. The first thing an audit should answer.
rls as (
  select '1 rls' as section,
         c.relname::text as item,
         case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end
           || ', ' || (select count(*) from pg_policy p where p.polrelid = c.oid) || ' policies'
           || ', anon can ' || concat_ws('/',
                nullif(case when has_table_privilege('anon', c.oid, 'SELECT') then 'select' end, ''),
                nullif(case when has_table_privilege('anon', c.oid, 'INSERT') then 'INSERT' end, ''),
                nullif(case when has_table_privilege('anon', c.oid, 'UPDATE') then 'UPDATE' end, ''),
                nullif(case when has_table_privilege('anon', c.oid, 'DELETE') then 'DELETE' end, ''))
           as detail,
         case
           when not c.relrowsecurity
                and (has_table_privilege('anon', c.oid, 'SELECT')
                  or has_table_privilege('authenticated', c.oid, 'SELECT'))
             then 'NO RLS and readable by a client role'
           when not c.relrowsecurity then 'no RLS (service-role only?)'
           when has_table_privilege('anon', c.oid, 'INSERT')
             or has_table_privilege('anon', c.oid, 'UPDATE')
             or has_table_privilege('anon', c.oid, 'DELETE')
             then 'ANON CAN WRITE'
           when (select count(*) from pg_policy p where p.polrelid = c.oid) = 0
                and has_table_privilege('authenticated', c.oid, 'SELECT')
             then 'RLS on with no policies: denies everything'
           else 'ok'
         end as flag
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),

-- 2. Every policy, with what it actually allows.
pol as (
  select '2 policy' as section,
         c.relname || ' / ' || p.polname as item,
         case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                       when 'd' then 'DELETE' when '*' then 'ALL' else p.polcmd::text end
           || ' to ' || coalesce(array_to_string(
                (select array_agg(rolname::text) from pg_roles where oid = any(p.polroles)), ','), 'PUBLIC')
           || ' | using: ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-')
           || ' | check: ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') as detail,
         case
           when p.polroles = '{0}'::oid[] then 'applies to PUBLIC, not a named role'
           when exists (select 1 from pg_roles r where r.oid = any(p.polroles) and r.rolname = 'anon')
             then 'grants anon'
           when coalesce(pg_get_expr(p.polqual, p.polrelid), '') = 'true'
             then 'USING (true): every row'
           when coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'
             then 'WITH CHECK (true): any row can be written'
           when p.polcmd in ('*', 'a', 'w') and p.polwithcheck is null and p.polqual is not null
             then 'write policy with no WITH CHECK'
           else 'ok'
         end as flag
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
),

-- 3. SECURITY DEFINER functions a client role may execute.
--
-- This is the shape of the hole this project already had: a definer function
-- runs as its owner and ignores RLS, so one that anon or authenticated may call
-- is a hole unless its body checks who is asking. A missing search_path on top
-- of that is the textbook escalation.
fns as (
  select '3 definer' as section,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
         'callable by ' || concat_ws('+',
             nullif(case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon' end, ''),
             nullif(case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' end, ''))
           || case when exists (
                select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
              then ', search_path set' else ', NO search_path' end as detail,
         case
           when not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
             then 'DEFINER WITHOUT search_path'
           when has_function_privilege('anon', p.oid, 'EXECUTE') then 'callable by anon'
           else 'ok'
         end as flag
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
),

-- 4. Column-level UPDATE grants. Where these exist, RLS is not the whole story:
--    RLS picks rows, column privileges pick fields, and only the pair stops an
--    owner rewriting their own tier.
cols as (
  select '4 columns' as section,
         table_name || '.' || column_name as item,
         'UPDATE granted to ' || grantee as detail,
         case when column_name ~* '(tier|credit|seat|stripe|exempt|banned|role|admin)'
              then 'SENSITIVE COLUMN IS CLIENT-WRITABLE' else 'ok' end as flag
    from information_schema.column_privileges
   where table_schema = 'public' and privilege_type = 'UPDATE'
     and grantee in ('anon', 'authenticated')
),

-- 5. Tables where a client role can UPDATE with no column restriction at all.
--    The absence of a row in section 4 for such a table means every column.
wide as (
  select '5 wide-update' as section,
         c.relname::text as item,
         'table-level UPDATE for ' || r.rolname || ', no column grants recorded' as detail,
         case when exists (
                select 1 from information_schema.columns col
                 where col.table_schema='public' and col.table_name=c.relname
                   and col.column_name ~* '(tier|credit|seat|stripe|exempt|banned|role|admin)')
              then 'EVERY COLUMN WRITABLE, INCLUDING SENSITIVE ONES' else 'ok' end as flag
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (select unnest(array['anon','authenticated']) as rolname) r
   where n.nspname='public' and c.relkind='r'
     and has_table_privilege(r.rolname, c.oid, 'UPDATE')
     and not exists (
       select 1 from information_schema.column_privileges cp
        where cp.table_schema='public' and cp.table_name=c.relname
          and cp.privilege_type='UPDATE' and cp.grantee = r.rolname)
),

-- 6. Views ignore RLS unless they are security_invoker. A view over a
--    protected table is a way around it.
vws as (
  select '6 views' as section,
         c.relname::text as item,
         coalesce(array_to_string(c.reloptions, ','), 'no options') as detail,
         case when coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%'
               and (has_table_privilege('anon', c.oid, 'SELECT')
                 or has_table_privilege('authenticated', c.oid, 'SELECT'))
              then 'view runs as owner: bypasses RLS' else 'ok' end as flag
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind = 'v'
)

select * from rls
union all select * from pol
union all select * from fns
union all select * from cols
union all select * from wide
union all select * from vws
order by (flag = 'ok'), section, item;
