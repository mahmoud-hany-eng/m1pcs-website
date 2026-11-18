-- PLAT-0001, migration 11 of 11: final privilege tightening and the security audit.
--
-- 1. Function execution rights are closed by default and opened one by one.
-- 2. private.security_audit() lists every violation of the platform's security invariants. This migration runs it and
--    FAILS if anything is wrong, so a broken migration set can never be applied. The same function can be run at any
--    time against a real project (select * from private.security_audit();) and in CI after future migrations.
--
-- The invariants (REC-PLAT-005, REC-PLAT-006, REC-PLAT-007, REC-PLAT-010):
--   * every table in public and private has row level security;
--   * anonymous visitors can read only the two reference tables, and nothing else;
--   * no API role has any privilege on a table in schema private;
--   * orders, items, tracking events, payments and the loyalty ledger are read-only for every API role;
--   * every SECURITY DEFINER function pins its search_path;
--   * anonymous visitors cannot execute any function in admin, private or public;
--   * no column in public has the name of a cost, margin, supplier, profit or internal value;
--   * no private table is published to Realtime.

-- ---- 1. function rights ----------------------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon;

-- References used by column defaults and trigger bodies run with the caller's rights, so the caller needs them.
alter function private.next_code(text) security definer;
grant usage on schema private to service_role;
grant execute on function
  private.next_code(text),
  private.write_ctx_on(),
  private.has_permission(text),
  private.is_staff(),
  private.current_customer_ids(),
  private.owns_customer(uuid),
  private.owns_order(uuid),
  private.quotation_lines_visible_to_customer(uuid)
to authenticated;
grant execute on function private.next_code(text), private.write_ctx_on() to service_role;

-- ---- 2. the audit ------------------------------------------------------------------------------------------------
create function private.security_audit()
returns table (check_name text, detail text)
language sql
stable
set search_path = ''
as $$
  -- every table must have row level security
  select 'rls_disabled'::text, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'private') and not c.relrowsecurity

  union all
  -- anonymous visitors: nothing, except SELECT on the two reference tables
  select 'anon_has_privilege'::text, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname in ('public', 'private')
    and (n.nspname || '.' || c.relname) not in ('public.order_statuses', 'public.quote_categories')
    and has_any_column_privilege('anon', c.oid, 'select,insert,update,references')

  union all
  select 'anon_can_write_reference_table'::text, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname || '.' || c.relname) in ('public.order_statuses', 'public.quote_categories')
    and has_any_column_privilege('anon', c.oid, 'insert,update,references')

  union all
  -- no API role has any privilege on a private table
  select 'api_role_has_private_privilege'::text, r.rolname || ' on ' || n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) r
  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname = 'private'
    and has_any_column_privilege(r.rolname, c.oid, 'select,insert,update,references')

  union all
  -- ledgers, orders and tracking are read-only for every API role
  select 'ledger_or_order_table_writable'::text, r.rolname || ' on public.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) r
  where n.nspname = 'public'
    and c.relname in ('orders', 'order_items', 'order_tracking_events', 'payments', 'loyalty_ledger', 'loyalty_balances')
    and (has_any_column_privilege(r.rolname, c.oid, 'insert,update')
         or has_table_privilege(r.rolname, c.oid, 'delete,truncate'))

  union all
  -- definer functions must pin the search path
  select 'definer_function_without_search_path'::text, n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private', 'admin')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')

  union all
  -- anonymous visitors cannot execute our functions
  select 'anon_can_execute_function'::text, n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'admin')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute')

  union all
  -- nothing in public may look like a cost, margin, supplier or internal value
  select 'sensitive_column_in_public'::text, c.table_name || '.' || c.column_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name ~* '(cost|margin|supplier|profit|internal_|staff_|secret|password|token)'

  union all
  -- nothing in private may be published to Realtime
  select 'private_table_published'::text, pt.pubname || ': ' || pt.schemaname || '.' || pt.tablename
  from pg_publication_tables pt
  where pt.schemaname in ('private', 'admin');
$$;
revoke all on function private.security_audit() from public, anon, authenticated;

do $$
declare
  n integer;
  sample text;
begin
  select count(*), string_agg(check_name || ' ' || detail, '; ' order by check_name, detail)
    into n, sample from private.security_audit();
  if n > 0 then
    raise exception 'security audit failed with % violation(s): %', n, left(sample, 600);
  end if;
end;
$$;
