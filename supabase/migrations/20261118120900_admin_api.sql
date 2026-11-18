-- PLAT-0001, migration 10 of 11: the staff API (schema admin).
--
-- Every function here is SECURITY DEFINER with a pinned, empty search_path and begins by asking
-- private.require_permission(...) for a permission that comes from the staff tables and from nothing the caller
-- controls. These functions are the ONLY way orders, items, payments, tracking updates, loyalty entries and
-- policies change. They validate every price, payment, transition and balance on the server.
--
-- The schema is not exposed through the API in this phase (supabase/config.toml). It becomes reachable only when
-- the owner adds it to the exposed schemas, which is a deliberate step of the admin phase.

-- ---------------------------------------------------------------------------------------------------------
-- Helpers (private).
-- ---------------------------------------------------------------------------------------------------------
create function private.deposit_for_total(p_total_minor bigint)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  pol jsonb := private.policy('orders.deposit');
  bps numeric;
  floor_minor bigint;
  wanted bigint;
begin
  if pol is null then
    -- No deposit policy at all: fail safe by requiring the whole amount to be paid before the gate.
    return p_total_minor;
  end if;
  bps := (pol ->> 'percent_bps')::numeric;
  floor_minor := (pol ->> 'minimum_minor')::bigint;
  wanted := ceil((p_total_minor::numeric * bps) / 10000)::bigint;
  return least(p_total_minor, greatest(floor_minor, wanted));
end;
$$;
revoke all on function private.deposit_for_total(bigint) from public;

-- Awards loyalty points when the policy's conditions hold right now (status, and full payment if required).
create function private.try_award_loyalty(p_order_id uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  trig jsonb := private.policy('loyalty.award_trigger');
begin
  select * into o from public.orders where id = p_order_id;
  if not found or trig is null then
    return null;
  end if;
  if o.status is distinct from (trig ->> 'on_status') then
    return null;
  end if;
  if coalesce((trig ->> 'require_full_payment')::boolean, true) and o.amount_paid_minor < o.total_minor then
    return null;
  end if;
  return private.award_loyalty_for_order(o.id, 'award for ' || o.status || ' order');
end;
$$;
revoke all on function private.try_award_loyalty(uuid) from public;

create function private.status_order(p_code text)
returns integer
language sql
stable
set search_path = ''
as $$ select sort_order from public.order_statuses where code = p_code $$;
revoke all on function private.status_order(text) from public;

-- ---------------------------------------------------------------------------------------------------------
-- Who am I? (no permission needed: it returns only the caller's own permissions)
-- ---------------------------------------------------------------------------------------------------------
create function admin.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select rp.permission_code
  from private.staff_members sm
  join private.role_permissions rp on rp.role_code = sm.role_code
  where sm.user_id = (select auth.uid()) and sm.is_active and private.mfa_satisfied()
  order by rp.permission_code
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Orders.
-- ---------------------------------------------------------------------------------------------------------
-- Creates an order, for example for a customer who ordered on WhatsApp (REQ-ORD-002). Items are an array of
-- {kind, description, quantity, unit_price_minor}; nothing else is accepted, in particular no total, no status and
-- no paid amount. The total and the deposit are computed here from the items and the deposit policy.
create function admin.create_order(
  p_customer_id uuid,
  p_items jsonb,
  p_quotation_id uuid default null,
  p_placed_via text default 'admin',
  p_delivery_method text default null,
  p_delivery_address text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

-- Moves an order along an allowed transition. The rules live in data (statuses, transitions, policies):
--   * the transition must exist, and the caller needs the permission the transition names;
--   * a held order can only resume at the status it was held from, or be cancelled;
--   * the deposit must be fully paid before the status named by policy orders.deposit (and every later one);
--   * if policy orders.full_payment names a status, the whole order must be paid before it;
--   * a fulfilled, fully paid order earns its loyalty points in this same transaction.
create function admin.transition_order(p_order_id uuid, p_to_status text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  t private.order_status_transitions%rowtype;
  previous text;
  dep jsonb := private.policy('orders.deposit');
  fp jsonb := private.policy('orders.full_payment');
  gate text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  select * into t from private.order_status_transitions where from_code = o.status and to_code = p_to_status;
  if not found then
    raise exception 'an order cannot move from % to %', o.status, p_to_status using errcode = '55000';
  end if;
  perform private.require_permission(t.requires_permission);

  -- The deposit rule is mandatory: with no policy row the order cannot advance (fail closed).
  if dep is null then
    raise exception 'the orders.deposit policy is missing' using errcode = '55000';
  end if;

  if o.status = 'on_hold' and p_to_status <> 'cancelled' then
    select h.from_status into previous
    from private.order_status_history h
    where h.order_id = o.id and h.to_status = 'on_hold'
    order by h.id desc limit 1;
    if previous is distinct from p_to_status then
      raise exception 'a held order can only resume at % (or be cancelled)', previous using errcode = '55000';
    end if;
  end if;

  if o.status = 'pending_confirmation' and p_to_status = 'awaiting_deposit' and o.total_minor <= 0 then
    raise exception 'the order has no priced items yet' using errcode = '55000';
  end if;

  if p_to_status not in ('on_hold', 'cancelled') then
    gate := dep ->> 'required_before_status';
    if gate is not null and private.status_order(p_to_status) >= private.status_order(gate)
       and o.amount_paid_minor < o.deposit_required_minor then
      raise exception 'the deposit has not been fully paid (% of % QAR minor units)', o.amount_paid_minor, o.deposit_required_minor
        using errcode = '55000';
    end if;
    gate := fp ->> 'required_before_status';
    if gate is not null and private.status_order(p_to_status) >= private.status_order(gate)
       and o.amount_paid_minor < o.total_minor then
      raise exception 'the order must be paid in full before %', gate using errcode = '55000';
    end if;
  end if;

  perform private.set_write_ctx(true);
  update public.orders set status = p_to_status where id = o.id;
  insert into private.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (o.id, o.status, p_to_status, (select auth.uid()), left(p_reason, 500));
  perform private.try_award_loyalty(o.id);
  perform private.audit('order.transition', 'order', o.id::text,
    jsonb_build_object('from', o.status, 'to', p_to_status));
  perform private.set_write_ctx(false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Payments.
-- ---------------------------------------------------------------------------------------------------------
create function admin.record_payment(
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
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  pay_id uuid;
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

  perform private.set_write_ctx(true);
  insert into public.payments (order_id, entry_type, purpose, amount_minor, method, receipt_number, received_at)
  values (o.id, 'payment', p_purpose, p_amount_minor, p_method, p_receipt_number, p_received_at)
  returning id into pay_id;
  insert into private.payment_details (payment_id, recorded_by, internal_reference, internal_notes)
  values (pay_id, (select auth.uid()), p_internal_reference, p_internal_notes);
  perform private.recompute_order_paid(o.id);
  perform private.try_award_loyalty(o.id);
  perform private.audit('payment.recorded', 'payment', pay_id::text,
    jsonb_build_object('order_id', o.id, 'amount_minor', p_amount_minor, 'purpose', p_purpose));
  perform private.set_write_ctx(false);
  return pay_id;
end;
$$;

-- A mistake is reversed by a new negative entry that points at the original; each payment can be reversed once.
-- Reversing does not move the order's status back: that is a separate, deliberate step.
create function admin.reverse_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  rev_id uuid;
begin
  perform private.require_permission('payments.reverse');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to reverse a payment' using errcode = '22023';
  end if;
  select * into p from public.payments where id = p_payment_id and entry_type = 'payment';
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform 1 from public.orders where id = p.order_id for update;
  if exists (select 1 from public.payments where reverses_payment_id = p.id) then
    raise exception 'this payment has already been reversed' using errcode = '23505';
  end if;

  perform private.set_write_ctx(true);
  insert into public.payments (order_id, entry_type, purpose, amount_minor, method, reverses_payment_id)
  values (p.order_id, 'reversal', p.purpose, -p.amount_minor, p.method, p.id)
  returning id into rev_id;
  insert into private.payment_details (payment_id, recorded_by, internal_notes)
  values (rev_id, (select auth.uid()), left(p_reason, 1000));
  perform private.recompute_order_paid(p.order_id);
  perform private.audit('payment.reversed', 'payment', rev_id::text,
    jsonb_build_object('order_id', p.order_id, 'reverses', p.id));
  perform private.set_write_ctx(false);
  return rev_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Tracking, notes and money that only staff may see.
-- ---------------------------------------------------------------------------------------------------------
create function admin.publish_tracking_event(
  p_order_id uuid,
  p_title text,
  p_message text default null,
  p_status_code text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev_id uuid;
begin
  perform private.require_permission('tracking.publish');
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.set_write_ctx(true);
  insert into public.order_tracking_events (order_id, status_code, title, message)
  values (p_order_id, p_status_code, p_title, p_message)
  returning id into ev_id;
  insert into private.tracking_event_authors (event_id, user_id) values (ev_id, (select auth.uid()));
  perform private.audit('tracking.published', 'order', p_order_id::text, jsonb_build_object('event_id', ev_id));
  perform private.set_write_ctx(false);
  return ev_id;
end;
$$;

create function admin.add_order_note(p_order_id uuid, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  note_id uuid;
begin
  perform private.require_permission('notes.write');
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  insert into private.order_notes (order_id, author, note) values (p_order_id, (select auth.uid()), p_note)
  returning id into note_id;
  return note_id;
end;
$$;

create function admin.list_order_notes(p_order_id uuid)
returns table (id uuid, author uuid, note text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('notes.read');
  return query select n.id, n.author, n.note, n.created_at
    from private.order_notes n where n.order_id = p_order_id order by n.created_at, n.id;
end;
$$;

create function admin.add_customer_note(p_customer_id uuid, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  note_id uuid;
begin
  perform private.require_permission('notes.write');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  insert into private.customer_notes (customer_id, author, note) values (p_customer_id, (select auth.uid()), p_note)
  returning id into note_id;
  return note_id;
end;
$$;

create function admin.set_order_item_cost(
  p_item_id uuid,
  p_supplier_name text,
  p_cost_minor bigint,
  p_currency text default 'USD',
  p_notes text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('finance.manage');
  if not exists (select 1 from public.order_items where id = p_item_id) then
    raise exception 'order item not found' using errcode = 'P0002';
  end if;
  insert into private.order_item_costs (item_id, supplier_name, supplier_cost_minor, cost_currency, notes)
  values (p_item_id, p_supplier_name, p_cost_minor, p_currency, p_notes)
  on conflict (item_id) do update
    set supplier_name = excluded.supplier_name, supplier_cost_minor = excluded.supplier_cost_minor,
        cost_currency = excluded.cost_currency, notes = excluded.notes;
  perform private.audit('finance.item_cost_set', 'order_item', p_item_id::text, '{}'::jsonb);
end;
$$;

-- Revenue versus recorded costs. A margin in QAR exists only when every item has a QAR cost: converting U.S.
-- dollar costs needs an exchange-rate rule that does not exist yet (OQ-0012), so none is assumed.
create function admin.get_order_financials(p_order_id uuid)
returns table (
  order_id uuid,
  revenue_minor bigint,
  cost_qar_minor bigint,
  cost_usd_minor bigint,
  items_without_cost integer,
  margin_qar_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rev bigint;
  c_qar bigint;
  c_usd bigint;
  missing integer;
begin
  perform private.require_permission('finance.read');
  select o.total_minor into rev from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(c.supplier_cost_minor) filter (where c.cost_currency = 'QAR'), 0),
         coalesce(sum(c.supplier_cost_minor) filter (where c.cost_currency = 'USD'), 0)
    into c_qar, c_usd
  from private.order_item_costs c join public.order_items i on i.id = c.item_id where i.order_id = p_order_id;
  select count(*)::integer into missing
  from public.order_items i
  where i.order_id = p_order_id and i.kind <> 'discount'
    and not exists (select 1 from private.order_item_costs c where c.item_id = i.id);
  return query select p_order_id, rev, c_qar, c_usd, missing,
    case when c_usd = 0 and missing = 0 then rev - c_qar else null end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Loyalty (awards happen automatically through transition_order and record_payment; these are the manual tools).
-- ---------------------------------------------------------------------------------------------------------
create function admin.award_loyalty_for_order(p_order_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  entry_id uuid;
begin
  perform private.require_permission('loyalty.adjust');
  perform private.set_write_ctx(true);
  entry_id := private.try_award_loyalty(p_order_id);
  perform private.set_write_ctx(false);
  return entry_id;
end;
$$;

create function admin.reverse_loyalty_award(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  entry_id uuid;
begin
  perform private.require_permission('loyalty.adjust');
  perform private.set_write_ctx(true);
  entry_id := private.reverse_loyalty_award(p_order_id, p_reason);
  perform private.audit('loyalty.reversed', 'order', p_order_id::text, '{}'::jsonb);
  perform private.set_write_ctx(false);
  return entry_id;
end;
$$;

create function admin.adjust_loyalty(p_customer_id uuid, p_points integer, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Policies.
-- ---------------------------------------------------------------------------------------------------------
create function admin.list_policies()
returns table (key text, value jsonb, description text, confirmation text, open_question text, version integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('policies.read');
  return query select p.key, p.value, p.description, p.confirmation, p.open_question, p.version
    from private.business_policies p order by p.key;
end;
$$;

-- Changes an existing policy. The value is validated, any status it names must exist, and the previous value stays
-- in private.business_policy_versions. Only the owner confirms a policy: p_confirmation says whether this change
-- is a confirmed business decision.
create function admin.set_policy(p_key text, p_value jsonb, p_confirmation text, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  problem text;
  status_code text;
  new_version integer;
begin
  perform private.require_permission('policies.manage');
  if p_confirmation not in ('unconfirmed_default', 'confirmed_by_owner') then
    raise exception 'confirmation must be unconfirmed_default or confirmed_by_owner' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to change a policy' using errcode = '22023';
  end if;
  problem := private.policy_error(p_key, p_value);
  if problem is not null then
    raise exception 'invalid policy value: %', problem using errcode = '22023';
  end if;
  if not exists (select 1 from private.business_policies where key = p_key) then
    raise exception 'policy % does not exist', p_key using errcode = 'P0002';
  end if;
  for status_code in select unnest(array[p_value ->> 'required_before_status', p_value ->> 'on_status']) loop
    if status_code is not null
       and not exists (select 1 from public.order_statuses s where s.code = status_code) then
      raise exception 'unknown order status %', status_code using errcode = '22023';
    end if;
  end loop;

  perform set_config('m1.policy_reason', left(p_reason, 500), true);
  update private.business_policies
     set value = p_value, confirmation = p_confirmation, version = version + 1, updated_at = now()
   where key = p_key
  returning version into new_version;
  perform set_config('m1.policy_reason', '', true);
  perform private.audit('policy.changed', 'policy', p_key, jsonb_build_object('version', new_version));
  return new_version;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Customers and account linking.
-- ---------------------------------------------------------------------------------------------------------
-- Issues a single-use, expiring code that a person enters after signing in to join an existing customer record.
-- The code is returned once and stored only as a hash.
create function admin.issue_claim_code(p_customer_id uuid, p_valid_hours integer default 72)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  raw text;
begin
  perform private.require_permission('customers.manage');
  if p_valid_hours is null or p_valid_hours not between 1 and 720 then
    raise exception 'a claim code is valid for 1 to 720 hours' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  -- 20 hex characters = 80 random bits. A version-4 UUID fixes its 13th hex character (the version) and its 17th (the
  -- variant), so those two positions are skipped: characters 1-12 and 18-25 are all random.
  raw := upper((select substr(h, 1, 12) || substr(h, 18, 8) from (select replace(gen_random_uuid()::text, '-', '') as h) as u));
  insert into private.customer_claim_codes (customer_id, code_hash, expires_at, created_by)
  values (p_customer_id, sha256(convert_to(raw, 'UTF8')), now() + make_interval(hours => p_valid_hours), (select auth.uid()));
  perform private.audit('customer.claim_code_issued', 'customer', p_customer_id::text, '{}'::jsonb);
  return substr(raw, 1, 5) || '-' || substr(raw, 6, 5) || '-' || substr(raw, 11, 5) || '-' || substr(raw, 16, 5);
end;
$$;

-- The explicit administrator action of REC-PLAT-004 for joining an account to a customer.
create function admin.link_customer_account(p_user_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.manage');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  insert into public.customer_accounts (user_id, customer_id, linked_via) values (p_user_id, p_customer_id, 'admin');
  perform private.audit('customer.account_linked', 'customer', p_customer_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Execute rights: signed-in users only. Each function then checks its own permission.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'admin'
  loop
    execute format('revoke all on function %s from public', f.signature);
    execute format('revoke all on function %s from anon', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end;
$$;
