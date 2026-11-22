-- PLAT-0004, GAP-1 / GAP-2 / GAP-3: durable idempotency for the three operations that create money or ledger records.
-- This is the EXPAND half of a two-step release. It only ADDS; it never changes or removes anything the deployed
-- website (PLAT-0003) calls. The CONTRACT half lives in supabase/release/ and is applied by an operator, later, after the
-- old website is gone. See docs/project-memory/architecture/IDEMPOTENCY.md and supabase/release/README.md.
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
--     then sees the first one's result. Rows are kept for the life of the database (append-only, never purged), so a key can
--     never be "forgotten" and then accepted again as a new operation.
--   * Each row also stores a SHA-256 fingerprint of the request's data. Repeating an identical request inside the replay
--     window returns the ORIGINAL record id and creates nothing. Reusing a key with different data is REFUSED (M1K01).
--   * REPLAY WINDOW. A repeat is answered with the original record only while it is still true: the key was used less than
--     one hour ago, the payment has not been reversed, and the order has not been cancelled. Otherwise the repeat is REFUSED
--     (M1K02) and nothing is created or reported as done. A key that was claimed is never reusable as a fresh operation.
--   * The claim and the operation are one transaction: if the operation fails or the connection dies, the claim rolls back
--     with it, so a failed attempt never blocks a later correct one.
--   * Keys are scoped to the authenticated staff member, and the fingerprint includes the customer or order the request is
--     about. A key can therefore never return another person's record. The table has no privileges for any API role (only
--     the staff functions, which are SECURITY DEFINER, read or write it) and it is append-only.
--   * Through the staff gateway (the only production path) a key is REQUIRED. A direct database caller (migrations, the test
--     harnesses, an owner at a SQL prompt) may omit it and then gets no duplicate protection, exactly as before.
--   * EXPECTED PAID AMOUNT. The keyed payment function takes the amount already paid that the staff member was looking at
--     (p_expected_paid_minor). It is compared with the order's real balance under the order's row lock, in the same
--     transaction as the insert. If someone else paid, or a payment was reversed, in the meantime, the payment is REFUSED
--     (M1K03) instead of being added to a balance the user never saw. The value is part of the request fingerprint, so a
--     retry is only a retry when it is the identical request. Through the gateway the value is required.
--   * Duplicate-order EVIDENCE. admin.similar_orders is a read-only helper that lists the same customer's recent orders
--     with the same items. It never blocks anything; the website shows it as a warning that staff can override.
--
-- Shape. The migration is additive and rerunnable (create ... if not exists / create or replace / idempotent grants) and
-- drops nothing (a static test forbids any DROP in a migration). For each operation it ADDS an overload that takes the key
-- as one extra, required, trailing parameter. The existing signatures are NOT touched: the deployed website keeps calling
-- them and they keep working exactly as in PLAT-0003. The contract script later turns them into one-line delegations that the
-- gateway refuses (so that nothing can bypass the key through the old signature).
--
-- SQLSTATEs used by this migration (private, mapped by the website):
--   22023  invalid input (missing/malformed key, missing expected amount on the gateway path)
--   M1K01  the key was used for a different request
--   M1K02  the key was already used and the original can no longer be confirmed (expired, reversed, cancelled)
--   M1K03  the order's paid amount is not the amount the user saw
-- Business rules, monetary arithmetic and the append-only guarantees are untouched.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The claim table
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists private.idempotency_keys (
  actor uuid not null,
  operation text not null check (operation in ('payment.record', 'order.create', 'loyalty.adjust')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor, operation, idempotency_key)
);
alter table private.idempotency_keys enable row level security;
revoke all on table private.idempotency_keys from public, anon, authenticated, service_role, m1_staff_gateway;
create or replace trigger idempotency_keys_append_only before update or delete on private.idempotency_keys
  for each row execute function private.forbid_mutation();
create or replace trigger idempotency_keys_no_truncate before truncate on private.idempotency_keys
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The claim helper
--    Returns NULL when the caller should go ahead (a new key was recorded, or no key was given on a direct call).
--    Returns the original result id when the identical request was already done AND that result is still valid and recent.
--    Raises when the key is malformed, missing on the gateway path, used for a different request (M1K01), or already used
--    and no longer confirmable (M1K02).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.idempotency_claim(p_operation text, p_key text, p_request jsonb, p_new_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_replay_window constant interval := interval '1 hour';
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
  -- Tells the caller of THIS transaction whether the answer is a repeat (the website shows "already recorded" instead of
  -- "recorded"). Transaction-local, so it cannot leak into another request on a pooled connection.
  perform set_config('m1.replayed', 'false', true);

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
    raise exception 'this idempotency key was already used for a different request; nothing was changed'
      using errcode = 'M1K01';
  end if;

  -- The request is identical, so this is a retry. Answer with the original record ONLY while that is still the truth.
  if p_operation = 'payment.record'
     and exists (select 1 from public.payments r where r.reverses_payment_id = v_existing.result_id) then
    raise exception 'this payment was recorded and has since been reversed, so it was not recorded again; reload the page and check the order before recording another payment'
      using errcode = 'M1K02';
  end if;
  if p_operation = 'order.create'
     and exists (select 1 from public.orders o where o.id = v_existing.result_id and o.status = 'cancelled') then
    raise exception 'this order was created and has since been cancelled, so it was not created again; reload the page and check the orders before creating another'
      using errcode = 'M1K02';
  end if;
  if now() - v_existing.created_at > c_replay_window then
    raise exception 'this request was already processed more than an hour ago and can no longer be confirmed automatically; nothing was changed. Check the record before submitting again'
      using errcode = 'M1K02';
  end if;
  perform set_config('m1.replayed', 'true', true);
  return v_existing.result_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. admin.record_payment (GAP-1) with the expected paid amount
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.record_payment(
  p_order_id uuid,
  p_purpose text,
  p_amount_minor bigint,
  p_method text,
  p_received_at timestamptz,
  p_receipt_number text,
  p_internal_reference text,
  p_internal_notes text,
  p_idempotency_key text,
  p_expected_paid_minor bigint
)
returns uuid
language plpgsql
volatile
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
  if p_expected_paid_minor is not null and p_expected_paid_minor < 0 then
    raise exception 'the expected paid amount cannot be negative' using errcode = '22023';
  end if;
  if p_expected_paid_minor is null and private.via_gateway() then
    raise exception 'the amount already paid on the order must be supplied; reload the page and try again' using errcode = '22023';
  end if;
  -- p_received_at is NULL from the website: the payment is then dated by the DATABASE clock when the FIRST attempt runs.
  -- A retry returns that original payment (with its original date); the clock is never part of the fingerprint.
  received := coalesce(p_received_at, now());
  if received > now() + interval '1 day' then
    raise exception 'a payment cannot be dated in the future' using errcode = '22023';
  end if;

  -- A retry of a payment that was already recorded returns that payment and records nothing, as long as the payment is
  -- still standing and the retry is recent. This comes before the order's current state and the expected amount are
  -- checked, so a genuine retry still succeeds after the order has moved on (or been paid in full).
  replay := private.idempotency_claim('payment.record', p_idempotency_key,
    jsonb_build_object(
      'order_id', p_order_id, 'purpose', p_purpose, 'amount_minor', p_amount_minor, 'method', p_method,
      'received_at', p_received_at at time zone 'UTC', 'receipt_number', nullif(btrim(p_receipt_number), ''),
      'internal_reference', p_internal_reference, 'internal_notes', p_internal_notes,
      'expected_paid_minor', p_expected_paid_minor),
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
  -- The safeguard: the balance the user saw must still be the balance. The order is locked, so this cannot change between
  -- this check and the insert below.
  if p_expected_paid_minor is not null and o.amount_paid_minor <> p_expected_paid_minor then
    raise exception 'the amount paid on this order changed while you were working (you saw QAR %, it is now QAR %); nothing was recorded. Reload the page and check the payments before recording again',
      to_char(p_expected_paid_minor / 100.0, 'FM999999999999990.00'), to_char(o.amount_paid_minor / 100.0, 'FM999999999999990.00')
      using errcode = 'M1K03';
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

-- ---------------------------------------------------------------------------------------------------------------
-- 4. admin.create_order (GAP-2)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.create_order(
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
volatile
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

  -- A quotation needs its own permission; it is checked BEFORE the claim so that a repeat can never skip it.
  if p_quotation_id is not null then
    perform private.require_permission('quotations.manage');
  end if;

  -- A retry of an order that was already created returns that order and creates nothing, while it is recent and the order
  -- has not since been cancelled. Two orders with the same content are NOT a retry: only the same key is.
  replay := private.idempotency_claim('order.create', p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id, 'items', p_items, 'quotation_id', p_quotation_id,
      'placed_via', coalesce(p_placed_via, 'admin'), 'delivery_method', p_delivery_method, 'delivery_address', p_delivery_address),
    new_id);
  if replay is not null then
    return replay;
  end if;

  if p_quotation_id is not null then
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

-- ---------------------------------------------------------------------------------------------------------------
-- 5. admin.adjust_loyalty (GAP-3)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
volatile
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

  -- A retry of an adjustment that was already applied returns that entry and applies nothing, while the retry is recent.
  -- This comes before the balance check, so a retry still succeeds after the balance has changed.
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. admin.similar_orders: evidence for a NON-BLOCKING duplicate-order warning (read-only)
--    Lists up to five of the customer's orders from the last 24 hours, not cancelled, whose items are the same as the
--    proposed ones (same kind, description ignoring case and surrounding spaces, quantity and price). It changes nothing and
--    decides nothing: a customer may legitimately buy the same thing twice, so the website only shows this as a warning
--    that staff can confirm. Malformed items return no rows; admin.create_order reports the precise error.
--    The order that THIS idempotency key already created (a retry or a double click) is never reported as "similar": a retry
--    of the same request is answered by admin.create_order itself, not warned about.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.similar_orders(p_customer_id uuid, p_items jsonb, p_idempotency_key text)
returns table (order_id uuid, order_ref text, status text, total_minor bigint, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  wanted text;
  bad boolean;
begin
  perform private.require_permission('orders.create');
  if p_customer_id is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 200 then
    return;
  end if;

  select bool_or(
           jsonb_typeof(x.value) <> 'object'
           or coalesce(x.value ->> 'quantity', '1') !~ '^[0-9]{1,4}$'
           or coalesce(x.value ->> 'unit_price_minor', '') !~ '^-?[0-9]{1,12}$'
           or (x.value - 'kind' - 'description' - 'quantity' - 'unit_price_minor') <> '{}'::jsonb)
    into bad
  from jsonb_array_elements(p_items) as x(value);
  if bad then
    return;
  end if;

  select string_agg(sig, E'\n' order by sig) into wanted
  from (
    select coalesce(x.value ->> 'kind', 'component') || '|' || lower(btrim(coalesce(x.value ->> 'description', '')))
           || '|' || (coalesce(x.value ->> 'quantity', '1'))::integer || '|' || (x.value ->> 'unit_price_minor')::bigint as sig
    from jsonb_array_elements(p_items) as x(value)
  ) s;

  return query
  select o.id, o.order_ref, o.status, o.total_minor, o.created_at
  from public.orders o
  where o.customer_id = p_customer_id
    and o.status <> 'cancelled'
    and o.created_at > now() - interval '24 hours'
    and o.id is distinct from (
      select k.result_id from private.idempotency_keys k
      where k.actor = (select auth.uid()) and k.operation = 'order.create' and k.idempotency_key = p_idempotency_key)
    and (select string_agg(i.kind || '|' || lower(btrim(i.description)) || '|' || i.quantity || '|' || i.unit_price_minor,
                           E'\n' order by i.kind || '|' || lower(btrim(i.description)) || '|' || i.quantity || '|' || i.unit_price_minor)
         from public.order_items i where i.order_id = o.id) = wanted
  order by o.created_at desc
  limit 5;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Privileges, and a self-check that fails (and so rolls back) the whole migration if anything is wider than intended.
--    The existing signatures keep the privileges they already had and are not touched here.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.idempotency_claim(text, text, jsonb, uuid)
  from public, anon, authenticated, service_role, m1_staff_gateway;

revoke all on function admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint) from public, anon, service_role;
revoke all on function admin.create_order(uuid, jsonb, uuid, text, text, text, text) from public, anon, service_role;
revoke all on function admin.adjust_loyalty(uuid, integer, text, text) from public, anon, service_role;
revoke all on function admin.similar_orders(uuid, jsonb, text) from public, anon, service_role;
grant execute on function admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint) to authenticated, m1_staff_gateway;
grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text) to authenticated, m1_staff_gateway;
grant execute on function admin.adjust_loyalty(uuid, integer, text, text) to authenticated, m1_staff_gateway;
grant execute on function admin.similar_orders(uuid, jsonb, text) to authenticated, m1_staff_gateway;

do $$
declare
  f text;
  r text;
  cols text;
begin
  -- The table must have the shape this migration (and every later function) relies on, even if it pre-existed.
  select string_agg(column_name || ':' || data_type, ',' order by column_name) into cols
  from information_schema.columns where table_schema = 'private' and table_name = 'idempotency_keys';
  if cols is distinct from 'actor:uuid,created_at:timestamp with time zone,idempotency_key:text,operation:text,request_hash:text,result_id:uuid' then
    raise exception 'private.idempotency_keys has an unexpected shape (%)', cols;
  end if;
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'private.idempotency_keys'::regclass and i.indisprimary
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['actor', 'idempotency_key', 'operation']) then
    raise exception 'private.idempotency_keys must be keyed by (actor, operation, idempotency_key)';
  end if;

  -- The signatures the deployed website calls must still be there (expand never removes them).
  foreach f in array array[
    'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text)',
    'admin.adjust_loyalty(uuid, integer, text)'
  ] loop
    if to_regprocedure(f) is null then
      raise exception 'the existing function % is missing; the expand migration must not remove it', f;
    end if;
  end loop;

  foreach f in array array[
    'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text)',
    'admin.adjust_loyalty(uuid, integer, text, text)',
    'admin.similar_orders(uuid, jsonb, text)'
  ] loop
    foreach r in array array['public', 'anon', 'service_role'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '% must not be executable by %', f, r;
      end if;
    end loop;
    if not has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('m1_staff_gateway', f, 'execute') then
      raise exception '% must be executable by authenticated and the staff gateway', f;
    end if;
  end loop;

  foreach r in array array['public', 'anon', 'authenticated', 'service_role', 'm1_staff_gateway'] loop
    if has_function_privilege(r, 'private.idempotency_claim(text, text, jsonb, uuid)', 'execute') then
      raise exception 'private.idempotency_claim must not be executable by %', r;
    end if;
    if has_table_privilege(r, 'private.idempotency_keys', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'private.idempotency_keys must not be accessible to %', r;
    end if;
  end loop;
end;
$$;

do $audit$
declare
  problems integer;
  more integer;
begin
  select count(*) into problems from private.security_audit();
  select count(*) into more from private.gateway_audit();
  if problems + more > 0 then
    raise exception 'security audit failed after the idempotency expand migration (% violation(s))', problems + more;
  end if;
end;
$audit$;
