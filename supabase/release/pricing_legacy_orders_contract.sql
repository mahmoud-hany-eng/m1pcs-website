-- PRICING AND REWARDS: CONTRACT step for the EARLIER order-creation functions. An OPERATOR script: it is deliberately NOT in supabase/migrations
-- (nothing applies it automatically). Read supabase/release/README.md first. NOT APPLIED ANYWHERE: it waits for the owner's go-ahead.
--
-- Why it exists. The two earlier signatures of admin.create_order (6 and 7 arguments) still accept a negative "Discount" item line and are open to
-- every staff member with orders.create. A discount made that way needs no owner authorization, leaves no discount record, and LOWERS the order
-- total, so it lowers the deposit tier: exactly what the owner ruled out (only the owner may discount; a discount never lowers the deposit).
-- The new order form does not use them (it calls the 11-argument create_order, which refuses discount lines) but they stay callable until this step.
--
-- What it does. It takes away the right to run the two earlier signatures from everybody who had it (the staff gateway and signed-in users).
-- Nothing is deleted or rewritten: the functions, every order, discount line, payment and ledger entry stay exactly as they are. From then on every
-- new order, with or without a discount, is created by the 11-argument function, so the owner-only rules and the deposit-from-gross rule always apply.
--
-- When it is safe. ONLY when no deployment that shares this database still creates orders through an earlier signature: Production, every Preview that
-- points at this database, and any browser tab left open on an old page. The website deployed before the pricing release DOES (its "Create order"
-- statement calls the 7-argument signature); after this script it gets "permission denied" there. The script therefore REFUSES (SQLSTATE M1P03)
-- unless the same session first states that this is the case:
--
--     set m1.confirm_legacy_order_contract = 'old-website-retired';
--
-- It also refuses (SQLSTATE M1P04) unless the 11-argument create_order exists and the staff gateway can run it: the contract must never leave the
-- database with no way to create an order. The whole script is ONE statement, so it is atomic however it is sent. Running it twice is harmless.
--
-- UNDO (nothing was removed, so it is only a return of the right; it does not touch any order):
--     grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text) to authenticated, m1_staff_gateway;
--     grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text) to authenticated, m1_staff_gateway;
--
-- Follow-up in the website (separate commit, after this step): delete the unused `create_order` statement from src/lib/staff/gateway.ts and
-- `createOrder` from src/lib/staff/api.ts, so no code path can ask for the earlier signatures any more.
do $m1contract$
declare
  legacy text;
begin
  if coalesce(current_setting('m1.confirm_legacy_order_contract', true), '') <> 'old-website-retired' then
    raise exception 'REFUSED: this closes the earlier order-creation functions and would break any website that still uses them (the one deployed before the pricing release does). NOTHING WAS CHANGED. If every such deployment is retired, run: set m1.confirm_legacy_order_contract = ''old-website-retired'';'
      using errcode = 'M1P03';
  end if;

  if to_regprocedure('admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)') is null
     or not has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute') then
    raise exception 'REFUSED: the 11-argument create_order of the pricing release is missing or the staff gateway cannot run it, so closing the earlier ones would leave no way to create an order. NOTHING WAS CHANGED.'
      using errcode = 'M1P04';
  end if;

  foreach legacy in array array[
    'admin.create_order(uuid, jsonb, uuid, text, text, text)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text)'
  ] loop
    if to_regprocedure(legacy) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role, m1_staff_gateway', legacy);
    end if;
  end loop;

  -- Self-check: the earlier signatures are closed to everyone who could run them, the new one is not.
  foreach legacy in array array[
    'admin.create_order(uuid, jsonb, uuid, text, text, text)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text)'
  ] loop
    if to_regprocedure(legacy) is not null
       and (has_function_privilege('authenticated', legacy, 'execute') or has_function_privilege('m1_staff_gateway', legacy, 'execute')
            or has_function_privilege('anon', legacy, 'execute')) then
      raise exception 'self-check failed: % can still be run', legacy;
    end if;
  end loop;
  if not has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute') then
    raise exception 'self-check failed: the 11-argument create_order can no longer be run';
  end if;
end;
$m1contract$;
