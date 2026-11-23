-- PRICING AND REWARDS: UNDO of migrations 2 and 3 (20261123120100_pricing_rewards_functions.sql and 20261123120200_pricing_rewards_policies.sql).
-- An OPERATOR script: it is deliberately NOT in supabase/migrations (nothing applies it automatically, and a static test forbids DROP in a
-- migration).
--
-- What it does: puts the eight functions that migration 2 replaced back to their DEPLOYED definitions, byte for byte
--   private.transition_block_reason, admin.transition_order, admin.get_order, admin.list_orders   as in 20261122120100 (the workflow release)
--   admin.record_payment (8 arguments)                                                              as in 20261120120100
--   admin.record_payment (10 arguments)                                                             as in 20261121120100
--   private.try_award_loyalty                                                                       as in 20261118120900
--   private.award_loyalty_for_order                                                                 as in 20261118120800
-- takes away the right to run the two NEW staff functions (admin.create_order with 11 arguments and admin.order_pricing_context), so no discounted
-- or redeemed order can be created while the earlier rules are back, and puts the two policies the owner changed back to the values they had before
-- migration 3 (orders.deposit: three tiers; loyalty.earning_base: order_total), each as a NEW policy version with a reason, only if the policy still has
-- the value migration 3 gave it (an owner's later edit is left alone, with a notice).
--
-- What it does NOT do: it deletes nothing. The new columns, the discount record table, the ledger entry types, the permissions and the new functions
-- STAY (they are additive and harmless to the earlier website). No order, payment, loyalty entry or deposit is touched.
--
-- It REFUSES (SQLSTATE M1P01) while any order carries a discount or redeemed points, or any redemption entry exists: the earlier functions do not
-- know the net payable amount (a payment limit, "paid in full", the loyalty award), so those orders could be mis-handled. Keep the new functions in that case.
-- It also refuses (SQLSTATE M1P02) unless the same session first states what it is about to do:
--
--     set m1.confirm_pricing_rollback = 'new-website-retired';
--
-- The whole script is ONE statement, so it is atomic however it is sent. Running it twice is harmless. To go forward again, apply migration 2 again
-- (it is rerunnable and grants the two new functions again) and then migration 3 (or set the two policies with admin.set_policy).
do $m1rollback$
declare
  current_value jsonb;
begin
  if coalesce(current_setting('m1.confirm_pricing_rollback', true), '') <> 'new-website-retired' then
    raise exception 'REFUSED: this restores the earlier staff functions and would break the pricing and rewards website. NOTHING WAS CHANGED. If the new website is retired, run: set m1.confirm_pricing_rollback = ''new-website-retired'';'
      using errcode = 'M1P02';
  end if;
  if exists (select 1 from public.orders where discount_minor <> 0 or loyalty_credit_minor <> 0 or loyalty_points_redeemed <> 0)
     or exists (select 1 from public.loyalty_ledger where entry_type in ('redemption', 'redemption_restore')) then
    raise exception 'REFUSED: % order(s) carry a discount or redeemed points, and the earlier functions do not know the net payable amount. NOTHING WAS CHANGED.',
      (select count(*) from public.orders where discount_minor <> 0 or loyalty_credit_minor <> 0 or loyalty_points_redeemed <> 0) using errcode = 'M1P01';
  end if;

  -- private.transition_block_reason (as in the workflow release)
  execute $m1fn$
create or replace function private.transition_block_reason(o public.orders, p_to text, p_version smallint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  dep jsonb := private.policy('orders.deposit');
  fp jsonb := private.policy('orders.full_payment');
  gate text;
  gate_order integer;
  fp_gate text;
begin
  if p_version >= 2 and o.status = 'carrier_delivering' and o.fulfillment_type is null
     and p_to in ('building', 'items_arrived') then
    return 'choose Custom PC build or Parts only for this order before it leaves "Carrier delivering order to M1"';
  end if;
  if o.status = 'pending_confirmation' and p_to = 'awaiting_deposit' and o.total_minor <= 0 then
    return 'the order has no priced items yet';
  end if;

  -- The rule an order is held to is the one it recorded at confirmation. An order that has not been confirmed yet is
  -- held to the policy in force now (it cannot pass the gate before it is confirmed anyway).
  if o.deposit_fixed_at is not null then
    gate := o.deposit_gate_status;
  else
    if dep is null then
      return 'the orders.deposit policy is missing';
    end if;
    if coalesce(dep ->> 'mode', 'percent') = 'unconfigured' then
      return 'the deposit policy has not been configured by the owner; orders cannot advance until orders.deposit is set';
    end if;
    gate := dep ->> 'required_before_status';
  end if;

  if p_to not in ('on_hold', 'cancelled') then
    gate_order := case when gate is null then null else private.status_order(gate) end;
    if p_version >= 2 then
      -- A version-2 order is held to "deposit paid" from Deposit confirmed onward, whatever the policy's own gate says,
      -- so the Deposit confirmed status can never be reached on a promise: it needs the recorded deposit.
      gate_order := least(coalesce(gate_order, private.status_order('deposit_received')), private.status_order('deposit_received'));
    end if;
    if gate_order is not null and private.status_order(p_to) >= gate_order and o.amount_paid_minor < o.deposit_required_minor then
      return format('the deposit has not been fully paid (%s of %s QAR minor units)', o.amount_paid_minor, o.deposit_required_minor);
    end if;
    fp_gate := fp ->> 'required_before_status';
    if fp_gate is not null and private.status_order(p_to) >= private.status_order(fp_gate) and o.amount_paid_minor < o.total_minor then
      return 'the order must be paid in full before ' || fp_gate;
    end if;
  end if;
  return null;
end;
$$;
  $m1fn$;

  -- admin.transition_order (as in the workflow release)
  execute $m1fn$
create or replace function admin.transition_order(p_order_id uuid, p_to_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  perm text;
  previous text;
  blocked text;
  q private.deposit_quote_result;
begin
  -- Authorization first: nothing below this line may be reached, or described in an error, by someone who is not allowed.
  perform private.require_permission('orders.transition');

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- An explicit choice is required before a version-2 order enters a fulfilment-specific branch: it is never inferred.
  if o.workflow_version >= 2 and o.status = 'carrier_delivering' and o.fulfillment_type is null
     and p_to_status in ('building', 'items_arrived') then
    raise exception 'choose Custom PC build or Parts only for this order before it leaves "Carrier delivering order to M1"'
      using errcode = '55000';
  end if;

  perm := private.workflow_edge_permission(o, p_to_status);
  if perm is null then
    raise exception 'an order cannot move from % to %', o.status, p_to_status using errcode = '55000';
  end if;
  perform private.require_permission(perm);

  if o.status = 'on_hold' and p_to_status <> 'cancelled' then
    previous := private.order_held_from(o.id);
    if previous is distinct from p_to_status then
      raise exception 'a held order can only resume at % (or be cancelled)', previous using errcode = '55000';
    end if;
  end if;

  if o.status = 'pending_confirmation' and p_to_status = 'awaiting_deposit' then
    if o.total_minor <= 0 then
      raise exception 'the order has no priced items yet' using errcode = '55000';
    end if;
    -- Confirmation. The deposit is worked out from the policy in force now, and from here on it is the order's own.
    -- With no confirmed policy this refuses, so an order is never confirmed under a rule nobody has confirmed.
    q := private.deposit_quote(o.total_minor);
  end if;

  blocked := private.transition_block_reason(o, p_to_status, o.workflow_version);
  if blocked is not null then
    raise exception '%', blocked using errcode = '55000';
  end if;

  perform private.set_write_ctx(true);
  if q.amount_minor is not null then
    update public.orders
       set status = p_to_status,
           deposit_required_minor = q.amount_minor,
           deposit_rate_bps = q.rate_bps,
           deposit_policy_version = q.policy_version,
           deposit_rule = q.rule,
           deposit_gate_status = q.gate_status,
           deposit_fixed_at = now()
     where id = o.id;
  else
    update public.orders set status = p_to_status where id = o.id;
  end if;
  insert into private.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (o.id, o.status, p_to_status, (select auth.uid()), left(p_reason, 500));
  perform private.try_award_loyalty(o.id);
  perform private.audit('order.transition', 'order', o.id::text,
    case when q.amount_minor is null then jsonb_build_object('from', o.status, 'to', p_to_status)
         else jsonb_build_object('from', o.status, 'to', p_to_status, 'deposit_minor', q.amount_minor,
                                 'deposit_rate_bps', q.rate_bps, 'policy_version', q.policy_version) end);
  perform private.set_write_ctx(false);
end;
$$;
  $m1fn$;

  -- admin.get_order (as in the workflow release)
  execute $m1fn$
create or replace function admin.get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  s public.order_statuses%rowtype;
  result jsonb;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select * into c from public.customers where id = o.customer_id;
  select * into s from public.order_statuses where code = o.status;

  result := jsonb_build_object(
    'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'status_label', s.customer_label,
    'customer', jsonb_build_object('id', c.id, 'customer_code', c.customer_code, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email),
    'total_minor', o.total_minor, 'deposit_required_minor', o.deposit_required_minor,
    'deposit_fixed', o.deposit_fixed_at is not null, 'deposit_fixed_at', o.deposit_fixed_at,
    -- Received means staff have recorded payments that cover it: nothing else ever counts a deposit as paid.
    'deposit_received', o.deposit_fixed_at is not null and o.amount_paid_minor >= o.deposit_required_minor,
    'deposit_rate_bps', o.deposit_rate_bps, 'deposit_policy_version', o.deposit_policy_version, 'deposit_rule', o.deposit_rule,
    'deposit_gate_status', o.deposit_gate_status,
    'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor,
    'deposit_outstanding_minor', greatest(o.deposit_required_minor - o.amount_paid_minor, 0),
    'delivery_method', o.delivery_method, 'delivery_address', o.delivery_address, 'placed_via', o.placed_via,
    'created_at', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'kind', i.kind, 'description', i.description,
                 'quantity', i.quantity, 'unit_price_minor', i.unit_price_minor, 'line_total_minor', i.line_total_minor) order by i.position)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'at', h.changed_at,
                 'reason', h.reason, 'by', sm.display_name) order by h.id)
               from private.order_status_history h left join private.staff_members sm on sm.user_id = h.changed_by
               where h.order_id = o.id), '[]'::jsonb),
    'tracking', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'status_code', e.status_code, 'title', e.title, 'message', e.message,
                 'published_at', e.published_at, 'retracted', r.event_id is not null, 'retraction_reason', r.reason,
                 'location', e.location, 'occurred_at', e.occurred_at, 'event_kind', e.event_kind, 'corrects_event_id', e.corrects_event_id,
                 'correction_reason', k.reason, 'by', sm.display_name)
                 order by coalesce(e.occurred_at, e.published_at), e.published_at, e.id)
               from public.order_tracking_events e
               left join private.tracking_event_retractions r on r.event_id = e.id
               left join private.tracking_event_corrections k on k.event_id = e.id
               left join private.tracking_event_authors a on a.event_id = e.id
               left join private.staff_members sm on sm.user_id = a.user_id
               where e.order_id = o.id), '[]'::jsonb),
    'next_statuses', private.order_next_statuses(o));

  result := result || jsonb_build_object(
    'workflow_version', o.workflow_version,
    'fulfillment_type', o.fulfillment_type,
    'tracking_phase', private.tracking_phase(o),
    'status_is_terminal', s.is_terminal,
    -- True once the order is inside its fulfilment branch: the type can no longer be changed (the same rule the setter enforces).
    'fulfillment_locked', coalesce(case when o.status = 'on_hold' then private.order_held_from(o.id) else o.status end, o.status)
      in ('building', 'quality_check', 'items_arrived', 'awaiting_scheduling', 'ready_for_delivery', 'delivered'),
    'held_from', case when o.status = 'on_hold' then private.order_held_from(o.id) end,
    -- Only for the owner, and only for an order that can still be moved onto the current workflow: where it could be placed.
    'adoption_options', case when o.workflow_version < 2 and o.status not in ('on_hold', 'cancelled') and private.has_permission('orders.adopt') then
      coalesce((select jsonb_agg(jsonb_build_object('target_status', a.target_status, 'label', ts.customer_label, 'is_default', a.is_default,
                   'requires_fulfillment', a.requires_fulfillment) order by a.is_default desc, a.target_status)
                from private.workflow_adoption_map a join public.order_statuses ts on ts.code = a.target_status
                where a.legacy_status = o.status), '[]'::jsonb) end,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('code', st.status_code, 'label', ss.customer_label,
                 'description', ss.customer_description, 'position', st.position, 'shows_tracking', st.shows_tracking) order by st.position)
               from public.order_workflow_stages st join public.order_statuses ss on ss.code = st.status_code
               where st.workflow_version = o.workflow_version and st.branch in ('any', coalesce(o.fulfillment_type, '-'))), '[]'::jsonb));

  if private.has_permission('payments.read') then
    result := result || jsonb_build_object('payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'entry_type', p.entry_type, 'purpose', p.purpose, 'amount_minor', p.amount_minor, 'method', p.method,
        'receipt_number', p.receipt_number, 'received_at', p.received_at, 'reverses_payment_id', p.reverses_payment_id,
        'reversed', exists (select 1 from public.payments r where r.reverses_payment_id = p.id),
        'recorded_by', sm.display_name, 'internal_reference', d.internal_reference) order by p.received_at, p.created_at)
      from public.payments p
      left join private.payment_details d on d.payment_id = p.id
      left join private.staff_members sm on sm.user_id = d.recorded_by
      where p.order_id = o.id), '[]'::jsonb));
  end if;
  return result;
end;
$$;
  $m1fn$;

  -- admin.list_orders (as in the workflow release)
  execute $m1fn$
create or replace function admin.list_orders(p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_search, ''));
  pattern text;
begin
  perform private.require_permission('orders.read');
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (
      select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.deposit_required_minor,
             (o.deposit_fixed_at is not null) as deposit_fixed,
             (o.deposit_fixed_at is not null and o.amount_paid_minor >= o.deposit_required_minor) as deposit_received,
             o.amount_paid_minor, o.balance_due_minor,
             o.workflow_version, o.fulfillment_type,
             o.created_at, c.id as customer_id, c.full_name as customer_name, c.customer_code
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.order_statuses s on s.code = o.status
      where (p_status is null or o.status = p_status)
        and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
      order by o.created_at desc
      limit p_limit offset p_offset
    ) t), '[]'::jsonb);
end;
$$;
  $m1fn$;

  -- admin.record_payment, 8 arguments (as in 20261120120100)
  execute $m1fn$
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
volatile
security definer
set search_path = ''
as $$
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
$$;
  $m1fn$;

  -- admin.record_payment, 10 arguments (as in 20261121120100)
  execute $m1fn$
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
  $m1fn$;

  -- private.try_award_loyalty (as in 20261118120900)
  execute $m1fn$
create or replace function private.try_award_loyalty(p_order_id uuid)
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
  $m1fn$;

  -- private.award_loyalty_for_order (as in 20261118120800)
  execute $m1fn$
create or replace function private.award_loyalty_for_order(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  rate bigint;
  base_kind text;
  rounding text;
  base bigint;
  pts bigint;
  entry_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  rate := (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::bigint;
  base_kind := private.policy('loyalty.earning_base') ->> 'base';
  rounding := private.policy('loyalty.earning_base') ->> 'rounding';
  if rate is null or rate < 1 or base_kind is null or rounding is null then
    raise exception 'the loyalty policies are incomplete' using errcode = '55000';
  end if;

  base := case base_kind when 'amount_paid' then o.amount_paid_minor else o.total_minor end;
  pts := case rounding
    when 'floor' then base / rate
    when 'ceil' then (base + rate - 1) / rate
    else round(base::numeric / rate)::bigint
  end;
  if pts < 1 then
    return null;
  end if;
  if pts > 2147483647 then
    raise exception 'points out of range' using errcode = '22003';
  end if;

  insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description)
  values (o.customer_id, o.id, 'award', pts::integer, 'Points earned on order ' || o.order_ref)
  on conflict (order_id) where entry_type = 'award' do nothing
  returning id into entry_id;

  if entry_id is null then
    select id into entry_id from public.loyalty_ledger where order_id = o.id and entry_type = 'award';
    return entry_id;
  end if;

  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, coalesce(nullif(btrim(p_reason), ''), 'award for fulfilled order'), (select auth.uid()));
  return entry_id;
end;
$$;
  $m1fn$;

  -- No new discounted or redeemed order can be created while the earlier rules are back. (Migration 2 grants these again when it is rerun.)
  revoke all on function admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint) from public, anon, authenticated, service_role, m1_staff_gateway;
  revoke all on function admin.order_pricing_context(uuid) from public, anon, authenticated, service_role, m1_staff_gateway;

  -- The two policies, back to the values they had, as new versions. An owner's later edit is never overwritten.
  select value into current_value from private.business_policies where key = 'orders.deposit';
  if current_value = '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"up_to_minor": 1000000, "percent_bps": 3500}, {"up_to_minor": 1500000, "percent_bps": 5000}, {"percent_bps": 6000}]}'::jsonb then
    perform set_config('m1.policy_reason', 'PLAT-0005 rollback: the deposit schedule is back to the three tiers of 2026-11-19 (15 / 25 / 35 percent)', true);
    update private.business_policies
       set value = '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"percent_bps": 3500}]}'::jsonb,
           description = 'Confirmed by the owner on 2026-11-19: 15 percent of the whole order total up to QAR 3,000.00; 25 percent above that up to QAR 5,000.00; 35 percent above QAR 5,000.00. Restored by the pricing rollback.',
           version = version + 1, updated_at = now()
     where key = 'orders.deposit';
    perform set_config('m1.policy_reason', '', true);
  elsif current_value is not null then
    raise notice 'orders.deposit is not the five-tier schedule of migration 3 (it was changed since); it was left as it is';
  end if;

  select value into current_value from private.business_policies where key = 'loyalty.earning_base';
  if current_value = '{"base": "net_payable", "rounding": "floor"}'::jsonb then
    perform set_config('m1.policy_reason', 'PLAT-0005 rollback: loyalty points are earned on the order total again (the earlier placeholder rule)', true);
    update private.business_policies
       set value = '{"base": "order_total", "rounding": "floor"}'::jsonb,
           description = 'Placeholder: points are earned on the order total and rounded down. What counts (delivery, discounts, deposits) and the rounding are undecided. Restored by the pricing rollback.',
           confirmation = 'unconfirmed_default', open_question = 'OQ-0007',
           version = version + 1, updated_at = now()
     where key = 'loyalty.earning_base';
    perform set_config('m1.policy_reason', '', true);
  elsif current_value is not null then
    raise notice 'loyalty.earning_base is not the net_payable rule of migration 3 (it was changed since); it was left as it is';
  end if;
end;
$m1rollback$;
