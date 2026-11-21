-- PLAT-0004 CONTRACT step. An OPERATOR script: it is deliberately NOT in supabase/migrations/ and is never applied by
-- a deployment pipeline. Read supabase/release/README.md first.
--
-- What it does. After the EXPAND migration (20261121120100) the database has BOTH the old, key-less write functions (which
-- the PLAT-0003 website calls) and the new keyed ones (which the PLAT-0004 website calls). This script turns the three old
-- functions into one-line delegations to the keyed ones with a NULL key. The staff gateway then REFUSES any call that still
-- goes through an old signature, so nothing can bypass the idempotency key. A direct database caller (an owner at a SQL
-- prompt) is unaffected: it gets the keyed implementation without duplicate protection, exactly as before.
--
-- When it is safe. ONLY when no deployment that shares this database still runs the PLAT-0003 website: Production, every
-- Preview that points at this database, and any browser tab left open on an old page. Applying it earlier makes every
-- payment, order and loyalty adjustment from the old website fail. The script therefore REFUSES to run unless the operator
-- states that this is the case, in the same session:
--
--     set m1.confirm_contract = 'old-website-retired';
--
-- The whole script is ONE statement, so it is atomic however it is sent (psql -f, an SQL editor, a migration API): either
-- the guard refuses and nothing changes, or all three functions change together. It is safe to run twice.
-- Undo: supabase/release/idempotency_contract_rollback.sql restores the three PLAT-0003 bodies exactly.

do $contract$
begin
  if coalesce(current_setting('m1.confirm_contract', true), '') <> 'old-website-retired' then
    raise exception 'REFUSED: the contract step would break the PLAT-0003 website. NOTHING WAS CHANGED.'
      using errcode = 'M1C01',
            hint = 'Apply this only after every deployment of the old website (Production and every Preview that shares this database) is retired or replaced. If that is true, run: set m1.confirm_contract = ''old-website-retired''; in the same session, then run this script again. See supabase/release/README.md.';
  end if;

  if to_regprocedure('admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)') is null
     or to_regprocedure('admin.create_order(uuid, jsonb, uuid, text, text, text, text)') is null
     or to_regprocedure('admin.adjust_loyalty(uuid, integer, text, text)') is null then
    raise exception 'REFUSED: the EXPAND migration (20261121120100) has not been applied, so there is nothing to delegate to. NOTHING WAS CHANGED.'
      using errcode = 'M1C02';
  end if;

  execute $f$
    create or replace function admin.record_payment(
      p_order_id uuid,
      p_purpose text,
      p_amount_minor bigint,
      p_method text,
      p_received_at timestamptz default now(),
      p_receipt_number text default null,
      p_internal_reference text default null,
      p_internal_notes text default null
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      return admin.record_payment(p_order_id, p_purpose, p_amount_minor, p_method, p_received_at, p_receipt_number,
                                  p_internal_reference, p_internal_notes, null::text, null::bigint);
    end;
    $$
  $f$;

  execute $f$
    create or replace function admin.create_order(
      p_customer_id uuid,
      p_items jsonb,
      p_quotation_id uuid default null,
      p_placed_via text default 'admin',
      p_delivery_method text default null,
      p_delivery_address text default null
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      return admin.create_order(p_customer_id, p_items, p_quotation_id, p_placed_via, p_delivery_method, p_delivery_address, null::text);
    end;
    $$
  $f$;

  execute $f$
    create or replace function admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      return admin.adjust_loyalty(p_customer_id, p_points, p_reason, null::text);
    end;
    $$
  $f$;

  -- The privileges of the three signatures are unchanged by create or replace; check them and the platform audits.
  if has_function_privilege('anon', 'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text)', 'execute')
     or has_function_privilege('anon', 'admin.create_order(uuid, jsonb, uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'admin.adjust_loyalty(uuid, integer, text)', 'execute') then
    raise exception 'an old write signature became executable by anon; refusing';
  end if;
  if (select count(*) from private.security_audit()) + (select count(*) from private.gateway_audit()) > 0 then
    raise exception 'the security audit reports violations after the contract step; refusing';
  end if;
end;
$contract$;
