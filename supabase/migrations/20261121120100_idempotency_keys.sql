-- PLAT-0004, GAP-1 / GAP-2 / GAP-3: durable idempotency for the three operations that create money or ledger records.
--
-- The problem. A staff member who double-clicks "Record payment", a browser that retries after a timeout, or a page that is
-- reloaded after a lost response could record the same payment twice, create the same order twice, or apply the same loyalty
-- adjustment twice. Only the order-total cap limited the damage. The database itself must refuse the duplicate.
--
-- The design.
--   * The caller supplies an IDEMPOTENCY KEY with the request (a random value chosen once for one intended action and
--     reused for every retry of it).
--   * private.idempotency_keys holds one row per (staff member, operation, key). The primary key makes the claim ATOMIC: two
--     sessions that submit the same key at the same moment cannot both insert it; the second waits for the first to finish and
--     then sees the first one's result.
--   * Each row also stores a SHA-256 fingerprint of the request's data. Repeating an identical request returns the ORIGINAL
--     record id and creates nothing. Reusing a key with different data is REFUSED and creates nothing.
--   * The claim and the operation are one transaction: if the operation fails or the connection dies, the claim rolls back
--     with it, so a failed attempt never blocks a later correct one.
--   * Keys are scoped to the authenticated staff member, and the fingerprint includes the customer or order the request is
--     about. A key can therefore never return another person's record: a different staff member's key is a different key,
--     and the same key with another customer, order or amount is a conflict, not a lookup. The table has no privileges for any
--     API role (only the staff functions, which are SECURITY DEFINER, read or write it) and it is append-only.
--   * Through the staff gateway (the only production path) a key is REQUIRED. A direct database caller (migrations, the test
--     harnesses, an owner at a SQL prompt) may omit it and then gets no duplicate protection, exactly as before.
--
-- This migration is forward-only and drops nothing (a static test forbids any DROP in a migration). It adds one table and one
-- helper, and for each of the three operations it ADDS an overload that takes the key as one extra, required, trailing
-- parameter (p_idempotency_key). The existing signature stays, with the same name, parameters, defaults and privileges, but
-- its body is replaced (create or replace) by a one-line delegation to the new overload with a NULL key. So:
--   * the website's staff gateway calls the new overload with a key (required: a NULL key is refused on the gateway path);
--   * a direct database caller using the old signature gets the old behaviour (no key, no duplicate protection), and if that
--     caller is the gateway the missing key is refused;
--   * all the rules live in ONE implementation, the new overload.
-- Privileges are restated for the new overloads: PUBLIC and anon may not execute; authenticated and the staff gateway may, and
-- each function still checks its own permission and the second-factor rule first. Business rules, monetary arithmetic and
-- the append-only guarantees are untouched.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The claim table
-- ---------------------------------------------------------------------------------------------------------------
create table private.idempotency_keys (
  actor uuid not null,
  operation text not null check (operation in ('payment.record', 'order.create', 'loyalty.adjust')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor, operation, idempotency_key)
);
alter table private.idempotency_keys enable row level security;
revoke all on table private.idempotency_keys from anon, authenticated, service_role;
create trigger idempotency_keys_append_only before update or delete on private.idempotency_keys
  for each row execute function private.forbid_mutation();
create trigger idempotency_keys_no_truncate before truncate on private.idempotency_keys
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The claim helper
--    Returns NULL when the caller should go ahead (a new key was recorded, or no key was given on a direct call).
--    Returns the original result id when the identical request was already done. Raises when the key is malformed, missing
--    on the gateway path, or already used for a different request.
-- ---------------------------------------------------------------------------------------------------------------
create function private.idempotency_claim(p_operation text, p_key text, p_request jsonb, p_new_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_hash text;
  v_existing private.idempotency_keys%rowtype;
begin
  if p_key is null then
    if private.via_gateway() then
      raise exception 'an idempotency key is required; reload the page and try again' using errcode = '22023';
    end if;
    return null;
  end if;
  if p_key !~ '^[A-Za-z0-9._:-]{8,100}$' then
    raise exception 'the idempotency key must be 8 to 100 letters, digits or . _ : -' using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'an idempotency key needs a signed-in staff member' using errcode = '42501';
  end if;

  v_hash := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');

  -- The atomic claim. If another session is inserting the same key right now, this statement WAITS for it to commit or
  -- roll back: afterwards the row either exists (we are the duplicate) or it does not (the first attempt failed, so we go on).
  insert into private.idempotency_keys (actor, operation, idempotency_key, request_hash, result_id)
  values (v_actor, p_operation, p_key, v_hash, p_new_id)
  on conflict (actor, operation, idempotency_key) do nothing;
  if found then
    return null;
  end if;

  select * into v_existing
  from private.idempotency_keys k
  where k.actor = v_actor and k.operation = p_operation and k.idempotency_key = p_key;
  if v_existing.request_hash is distinct from v_hash then
    raise exception 'this idempotency key was already used for a different request; nothing was changed' using errcode = '22023';
  end if;
  return v_existing.result_id;
end;
$$;
revoke all on function private.idempotency_claim(text, text, jsonb, uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. admin.record_payment (GAP-1)
-- ---------------------------------------------------------------------------------------------------------------
create function admin.record_payment(
  p_order_id uuid,
  p_purpose text,
  p_amount_minor bigint,
  p_method text,
  p_received_at timestamptz,
  p_receipt_number text,
  p_internal_reference text,
  p_internal_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  pay_id uuid := gen_random_uuid();
  replay uuid;
  receipt text;
  received timestamptz;
begin
  perform private.require_permission('payments.record');
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'a payment amount must be greater than zero' using errcode = '22023';
  end if;
  received := coalesce(p_received_at, now());
  if received > now() + interval '1 day' then
    raise exception 'a payment cannot be dated in the future' using errcode = '22023';
  end if;

  -- A retry of a payment that was already recorded returns that payment and records nothing. This comes before the
  -- order's current state is checked, so a retry still succeeds after the order has moved on (or been paid in full).
  replay := private.idempotency_claim('payment.record', p_idempotency_key,
    jsonb_build_object(
      'order_id', p_order_id, 'purpose', p_purpose, 'amount_minor', p_amount_minor, 'method', p_method,
      'received_at', p_received_at at time zone 'UTC', 'receipt_number', nullif(btrim(p_receipt_number), ''),
      'internal_reference', p_internal_reference, 'internal_notes', p_internal_notes),
    pay_id);
  if replay is not null then
    return replay;
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status = 'cancelled' then
    raise exception 'a cancelled order cannot receive a payment' using errcode = '55000';
  end if;
  if o.amount_paid_minor + p_amount_minor > o.total_minor then
    raise exception 'this payment would exceed the order total' using errcode = '55000';
  end if;

  receipt := coalesce(nullif(btrim(p_receipt_number), ''), private.next_code('R'));

  perform private.set_write_ctx(true);
  insert into public.payments (id, order_id, entry_type, purpose, amount_minor, method, receipt_number, received_at)
  values (pay_id, o.id, 'payment', p_purpose, p_amount_minor, p_method, receipt, received);
  insert into private.payment_details (payment_id, recorded_by, internal_reference, internal_notes)
  values (pay_id, (select auth.uid()), p_internal_reference, p_internal_notes);
  perform private.recompute_order_paid(o.id);
  perform private.try_award_loyalty(o.id);
  perform private.audit('payment.recorded', 'payment', pay_id::text,
    jsonb_build_object('order_id', o.id, 'amount_minor', p_amount_minor, 'purpose', p_purpose, 'method', p_method, 'receipt', receipt));
  perform private.set_write_ctx(false);
  return pay_id;
end;
$$;

-- The existing signature, unchanged for callers: it delegates with no key. (On the gateway path that is refused.)
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
                              p_internal_reference, p_internal_notes, null::text);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. admin.create_order (GAP-2)
-- ---------------------------------------------------------------------------------------------------------------

create function admin.create_order(
  p_customer_id uuid,
  p_items jsonb,
  p_quotation_id uuid,
  p_placed_via text,
  p_delivery_method text,
  p_delivery_address text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  replay uuid;
  e record;
  it jsonb;
  qty integer;
  price bigint;
  total bigint;
  q public.quotations%rowtype;
begin
  perform private.require_permission('orders.create');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'items must be a JSON array of 1 to 200 items' using errcode = '22023';
  end if;

  -- A retry of an order that was already created returns that order and creates nothing.
  replay := private.idempotency_claim('order.create', p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id, 'items', p_items, 'quotation_id', p_quotation_id,
      'placed_via', coalesce(p_placed_via, 'admin'), 'delivery_method', p_delivery_method, 'delivery_address', p_delivery_address),
    new_id);
  if replay is not null then
    return replay;
  end if;

  if p_quotation_id is not null then
    perform private.require_permission('quotations.manage');
    select * into q from public.quotations where id = p_quotation_id for update;
    if not found then
      raise exception 'quotation not found' using errcode = 'P0002';
    end if;
    if q.customer_id is distinct from p_customer_id then
      raise exception 'the quotation belongs to a different customer' using errcode = '22023';
    end if;
    if q.status <> 'accepted' then
      raise exception 'only an accepted quotation can become an order (it is %)', q.status using errcode = '55000';
    end if;
  end if;

  perform private.set_write_ctx(true);

  insert into public.orders (id, customer_id, quotation_id, placed_via, delivery_method, delivery_address)
  values (new_id, p_customer_id, p_quotation_id, coalesce(p_placed_via, 'admin'), p_delivery_method, p_delivery_address);

  for e in select x.value as item, x.ordinality::integer as pos
           from jsonb_array_elements(p_items) with ordinality as x(value, ordinality)
  loop
    it := e.item;
    if jsonb_typeof(it) <> 'object' or (it - 'kind' - 'description' - 'quantity' - 'unit_price_minor') <> '{}'::jsonb then
      raise exception 'item % has a field that is not allowed; allowed: kind, description, quantity, unit_price_minor', e.pos
        using errcode = '22023';
    end if;
    if coalesce(it ->> 'quantity', '1') !~ '^[0-9]{1,4}$' then
      raise exception 'item % has an invalid quantity', e.pos using errcode = '22023';
    end if;
    if coalesce(it ->> 'unit_price_minor', '') !~ '^-?[0-9]{1,12}$' then
      raise exception 'item % has an invalid unit_price_minor (integer QAR minor units)', e.pos using errcode = '22023';
    end if;
    qty := coalesce(it ->> 'quantity', '1')::integer;
    price := (it ->> 'unit_price_minor')::bigint;
    insert into public.order_items (order_id, position, kind, description, quantity, unit_price_minor)
    values (new_id, e.pos, coalesce(it ->> 'kind', 'component'), it ->> 'description', qty, price);
  end loop;

  select coalesce(sum(line_total_minor), 0) into total from public.order_items where order_id = new_id;
  if total < 0 then
    raise exception 'the order total cannot be negative' using errcode = '23514';
  end if;
  update public.orders set total_minor = total, deposit_required_minor = private.deposit_for_total(total)
  where id = new_id;

  insert into private.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (new_id, null, 'pending_confirmation', (select auth.uid()), 'order created');

  if p_quotation_id is not null then
    update public.quotations set status = 'converted' where id = p_quotation_id;
  end if;

  perform private.audit('order.created', 'order', new_id::text,
    jsonb_build_object('customer_id', p_customer_id, 'total_minor', total, 'quotation_id', p_quotation_id));
  perform private.set_write_ctx(false);
  return new_id;
end;
$$;

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
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. admin.adjust_loyalty (GAP-3)
-- ---------------------------------------------------------------------------------------------------------------
create function admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_id uuid := gen_random_uuid();
  replay uuid;
begin
  perform private.require_permission('loyalty.adjust');
  if p_points is null or p_points = 0 then
    raise exception 'an adjustment must be a non-zero number of points' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required for a loyalty adjustment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  -- A retry of an adjustment that was already applied returns that entry and applies nothing. This comes before the
  -- balance check, so a retry still succeeds after the balance has changed.
  replay := private.idempotency_claim('loyalty.adjust', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'points', p_points, 'reason', btrim(p_reason)), entry_id);
  if replay is not null then
    return replay;
  end if;

  if p_points < 0 and not private.negative_balance_allowed()
     and private.loyalty_balance(p_customer_id) + p_points < 0 then
    raise exception 'this adjustment would make the balance negative; whether that is allowed is undecided (OQ-0010)'
      using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  insert into public.loyalty_ledger (id, customer_id, entry_type, points, description)
  values (entry_id, p_customer_id, 'adjustment', p_points, 'Points adjustment');
  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, left(p_reason, 500), (select auth.uid()));
  perform private.audit('loyalty.adjusted', 'customer', p_customer_id::text, jsonb_build_object('points', p_points));
  perform private.set_write_ctx(false);
  return entry_id;
end;
$$;

create or replace function admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return admin.adjust_loyalty(p_customer_id, p_points, p_reason, null::text);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Privileges for the new overloads (same as every other admin function), and a self-check that fails the migration
--    if anything is wider than intended. The three existing signatures keep the privileges they already had.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text) from public, anon;
revoke all on function admin.create_order(uuid, jsonb, uuid, text, text, text, text) from public, anon;
revoke all on function admin.adjust_loyalty(uuid, integer, text, text) from public, anon;
grant execute on function admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text) to authenticated, m1_staff_gateway;
grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text) to authenticated, m1_staff_gateway;
grant execute on function admin.adjust_loyalty(uuid, integer, text, text) to authenticated, m1_staff_gateway;

do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text)',
    'admin.adjust_loyalty(uuid, integer, text, text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then
      raise exception '% must not be executable by anon or PUBLIC', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('m1_staff_gateway', f, 'execute') then
      raise exception '% must be executable by authenticated and the staff gateway', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.idempotency_claim(text, text, jsonb, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.idempotency_claim(text, text, jsonb, uuid)', 'execute')
     or has_function_privilege('m1_staff_gateway', 'private.idempotency_claim(text, text, jsonb, uuid)', 'execute') then
    raise exception 'private.idempotency_claim must not be executable by any API role or the gateway';
  end if;
  if has_table_privilege('anon', 'private.idempotency_keys', 'select')
     or has_table_privilege('authenticated', 'private.idempotency_keys', 'select')
     or has_table_privilege('service_role', 'private.idempotency_keys', 'select')
     or has_table_privilege('m1_staff_gateway', 'private.idempotency_keys', 'select') then
    raise exception 'private.idempotency_keys must not be readable by any API role or the gateway';
  end if;
end;
$$;
