-- PLAT-0004 EXPAND rollback. An OPERATOR script, last resort, normally NOT needed (see supabase/release/README.md).
--
-- The expand migration is additive: the old PLAT-0003 functions are untouched, so the old website works whether or not the
-- new objects exist. To go back to the PLAT-0003 website you only redeploy it; you do NOT have to remove the new objects.
-- Use this script only to make the database look as it did before the expand migration.
--
-- What it does. It removes the four keyed/evidence functions and the claim helper. It deliberately KEEPS
-- private.idempotency_keys: the table has no privileges for any API role, row level security is on, it is append-only, and
-- it holds the history that stops a key from ever being accepted twice. Dropping it would destroy that history, and
-- re-running the expand migration later simply reuses it. (If you truly must drop the table, do it by hand and on purpose.)
--
-- Refusals (nothing is changed):
--   * the CONTRACT step is still applied (the old signatures would be left calling functions that no longer exist):
--     run supabase/release/idempotency_contract_rollback.sql first;
--   * the operator has not stated that the PLAT-0004 website is retired, because it calls the functions removed here:
--         set m1.confirm_expand_rollback = 'new-website-retired';
--
-- ONE statement, so atomic however it is sent. Safe to run twice (a second run finds nothing to remove).

do $rollback$
declare
  stale boolean;
begin
  if coalesce(current_setting('m1.confirm_expand_rollback', true), '') <> 'new-website-retired' then
    raise exception 'REFUSED: removing the keyed functions would break the PLAT-0004 website. NOTHING WAS CHANGED.'
      using errcode = 'M1C03',
            hint = 'Redeploy the previous website first. Then run: set m1.confirm_expand_rollback = ''new-website-retired''; in the same session and run this script again. See supabase/release/README.md.';
  end if;

  select exists (
    select 1 from pg_proc p
    where p.pronamespace = 'admin'::regnamespace
      and ((p.proname = 'record_payment' and p.pronargs = 8)
        or (p.proname = 'create_order' and p.pronargs = 6)
        or (p.proname = 'adjust_loyalty' and p.pronargs = 3))
      and p.prosrc like '%m1:contract-wrapper%'
  ) into stale;
  if stale then
    raise exception 'REFUSED: the CONTRACT step is still applied; the old signatures delegate to the functions this script removes. NOTHING WAS CHANGED.'
      using errcode = 'M1C04',
            hint = 'Run supabase/release/idempotency_contract_rollback.sql first.';
  end if;

  if to_regprocedure('admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)') is not null then
    execute 'drop function admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)';
  end if;
  if to_regprocedure('admin.create_order(uuid, jsonb, uuid, text, text, text, text)') is not null then
    execute 'drop function admin.create_order(uuid, jsonb, uuid, text, text, text, text)';
  end if;
  if to_regprocedure('admin.adjust_loyalty(uuid, integer, text, text)') is not null then
    execute 'drop function admin.adjust_loyalty(uuid, integer, text, text)';
  end if;
  if to_regprocedure('admin.similar_orders(uuid, jsonb, text)') is not null then
    execute 'drop function admin.similar_orders(uuid, jsonb, text)';
  end if;
  if to_regprocedure('private.idempotency_claim(text, text, jsonb, uuid)') is not null then
    execute 'drop function private.idempotency_claim(text, text, jsonb, uuid)';
  end if;
end;
$rollback$;
