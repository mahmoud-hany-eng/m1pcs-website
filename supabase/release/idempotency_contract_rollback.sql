-- RESTORE the three PLAT-0003 write functions exactly as they were deployed (migrations up to 20261120120100).
-- Use this to undo idempotency_contract.sql (the old, key-less website works again; the keyed overloads are untouched).
-- Safe to run more than once. It changes only these three function bodies; it deletes no data and no privilege.
-- Generated from a database built from the deployed migrations; supabase/tests/release.db.test.mjs proves that running this
-- script returns the three functions to byte-identical definitions.

-- One transaction however it is run (psql -f runs statement by statement otherwise): all three functions are restored, or none.
begin;

CREATE OR REPLACE FUNCTION admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry_id uuid;
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
  if p_points < 0 and not private.negative_balance_allowed()
     and private.loyalty_balance(p_customer_id) + p_points < 0 then
    raise exception 'this adjustment would make the balance negative; whether that is allowed is undecided (OQ-0010)'
      using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  insert into public.loyalty_ledger (customer_id, entry_type, points, description)
  values (p_customer_id, 'adjustment', p_points, 'Points adjustment')
  returning id into entry_id;
  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, left(p_reason, 500), (select auth.uid()));
  perform private.audit('loyalty.adjusted', 'customer', p_customer_id::text, jsonb_build_object('points', p_points));
  perform private.set_write_ctx(false);
  return entry_id;
end;
$function$;

CREATE OR REPLACE FUNCTION admin.create_order(p_customer_id uuid, p_items jsonb, p_quotation_id uuid DEFAULT NULL::uuid, p_placed_via text DEFAULT 'admin'::text, p_delivery_method text DEFAULT NULL::text, p_delivery_address text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
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

  insert into public.orders (customer_id, quotation_id, placed_via, delivery_method, delivery_address)
  values (p_customer_id, p_quotation_id, coalesce(p_placed_via, 'admin'), p_delivery_method, p_delivery_address)
  returning id into new_id;

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
$function$;

CREATE OR REPLACE FUNCTION admin.record_payment(p_order_id uuid, p_purpose text, p_amount_minor bigint, p_method text, p_received_at timestamp with time zone DEFAULT now(), p_receipt_number text DEFAULT NULL::text, p_internal_reference text DEFAULT NULL::text, p_internal_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.orders%rowtype;
  pay_id uuid;
  receipt text;
begin
  perform private.require_permission('payments.record');
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'a payment amount must be greater than zero' using errcode = '22023';
  end if;
  if p_received_at > now() + interval '1 day' then
    raise exception 'a payment cannot be dated in the future' using errcode = '22023';
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
  insert into public.payments (order_id, entry_type, purpose, amount_minor, method, receipt_number, received_at)
  values (o.id, 'payment', p_purpose, p_amount_minor, p_method, receipt, p_received_at)
  returning id into pay_id;
  insert into private.payment_details (payment_id, recorded_by, internal_reference, internal_notes)
  values (pay_id, (select auth.uid()), p_internal_reference, p_internal_notes);
  perform private.recompute_order_paid(o.id);
  perform private.try_award_loyalty(o.id);
  perform private.audit('payment.recorded', 'payment', pay_id::text,
    jsonb_build_object('order_id', o.id, 'amount_minor', p_amount_minor, 'purpose', p_purpose, 'method', p_method, 'receipt', receipt));
  perform private.set_write_ctx(false);
  return pay_id;
end;
$function$;

commit;
