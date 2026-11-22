-- ORDER WORKFLOW v2: UNDO of migration 2 (20261122120100_order_workflow_v2_functions.sql). An OPERATOR script: it is deliberately NOT in
-- supabase/migrations (nothing applies it automatically, and a static test forbids DROP in a migration).
--
-- What it does: puts the five staff functions that migration 2 replaced back to their DEPLOYED definitions, byte for byte
--   admin.transition_order(uuid, text, text)         as in 20261121120000_transition_order_permission_first.sql
--   admin.publish_tracking_event(uuid, text, text, text)   as in 20261118120900_admin_api.sql
--   admin.get_order(uuid), admin.list_orders(...), admin.dashboard_summary()   as in 20261120120100_staff_gateway_and_admin_functions.sql
-- and sets the release switch (policy orders.workflow) back to 1, so new orders follow the earlier workflow again.
--
-- What it does NOT do: it deletes nothing. The new columns, tables, statuses, stage data and permissions STAY (they are additive and
-- harmless to the earlier website), and no order is touched. The four new staff functions (set_order_fulfillment_type,
-- publish_tracking_update, publish_tracking_correction, adopt_new_workflow) also stay; the earlier website never calls them.
--
-- It REFUSES (SQLSTATE M1W01) while any order is on workflow version 2: the earlier functions do not know that workflow's statuses
-- (Live tracking, Items arrived ...), so those orders could not be moved or shown by the earlier website. Moving an order back is
-- not supported (the workflow of an order only ever moves 1 -> 2); keep the new functions in that case.
-- It also refuses (SQLSTATE M1W02) unless the same session first states what it is about to do:
--
--     set m1.confirm_workflow_rollback = 'new-website-retired';
--
-- The whole script is ONE statement, so it is atomic however it is sent. Running it twice is harmless.
do $m1rollback$
begin
  if coalesce(current_setting('m1.confirm_workflow_rollback', true), '') <> 'new-website-retired' then
    raise exception 'REFUSED: this restores the earlier staff functions and would break the order-workflow website. NOTHING WAS CHANGED. If the new website is retired, run: set m1.confirm_workflow_rollback = ''new-website-retired'';'
      using errcode = 'M1W02';
  end if;
  if exists (select 1 from public.orders where workflow_version >= 2) then
    raise exception 'REFUSED: % order(s) are on the new workflow, and the earlier functions cannot move or show them. NOTHING WAS CHANGED.',
      (select count(*) from public.orders where workflow_version >= 2) using errcode = 'M1W01';
  end if;

  execute $m1fn$
create or replace function admin.transition_order(p_order_id uuid, p_to_status text, p_reason text default null)
returns void
language plpgsql
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
  q private.deposit_quote_result;
begin
  -- Authorization first: nothing below this line may be reached, or described in an error, by someone who is not allowed.
  perform private.require_permission('orders.transition');

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  select * into t from private.order_status_transitions where from_code = o.status and to_code = p_to_status;
  if not found then
    raise exception 'an order cannot move from % to %', o.status, p_to_status using errcode = '55000';
  end if;
  perform private.require_permission(t.requires_permission);

  if o.status = 'on_hold' and p_to_status <> 'cancelled' then
    select h.from_status into previous
    from private.order_status_history h
    where h.order_id = o.id and h.to_status = 'on_hold'
    order by h.id desc limit 1;
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

  -- The rule an order is held to is the one it recorded at confirmation. An order that has not been confirmed yet is
  -- held to the policy in force now (it cannot pass the gate before it is confirmed anyway).
  if o.deposit_fixed_at is not null then
    gate := o.deposit_gate_status;
  else
    if dep is null then
      raise exception 'the orders.deposit policy is missing' using errcode = '55000';
    end if;
    if coalesce(dep ->> 'mode', 'percent') = 'unconfigured' then
      raise exception 'the deposit policy has not been configured by the owner; orders cannot advance until orders.deposit is set'
        using errcode = '55000';
    end if;
    gate := dep ->> 'required_before_status';
  end if;

  if p_to_status not in ('on_hold', 'cancelled') then
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

  execute $m1fn$
create or replace function admin.publish_tracking_event(
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
$m1fn$;

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
                 'published_at', e.published_at, 'retracted', r.event_id is not null, 'retraction_reason', r.reason) order by e.published_at)
               from public.order_tracking_events e left join private.tracking_event_retractions r on r.event_id = e.id
               where e.order_id = o.id), '[]'::jsonb),
    'next_statuses', coalesce((select jsonb_agg(jsonb_build_object('code', t.to_code, 'label', ns.customer_label) order by ns.sort_order)
               from private.order_status_transitions t join public.order_statuses ns on ns.code = t.to_code
               where t.from_code = o.status and private.has_permission(t.requires_permission)), '[]'::jsonb));

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

  execute $m1fn$
create or replace function admin.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_permission('orders.read');
  select jsonb_build_object(
    'total_orders', count(*),
    'awaiting_confirmation', count(*) filter (where status = 'pending_confirmation'),
    'awaiting_deposit', count(*) filter (where status = 'awaiting_deposit'),
    'under_assembly', count(*) filter (where status in ('building', 'quality_check')),
    'ready_for_delivery', count(*) filter (where status = 'ready_for_delivery'),
    'delivered', count(*) filter (where status = 'delivered'),
    'on_hold', count(*) filter (where status = 'on_hold'),
    'cancelled', count(*) filter (where status = 'cancelled'))
  into result from public.orders;

  result := result || jsonb_build_object('customers', (select count(*) from public.customers));

  if private.has_permission('payments.read') then
    result := result || jsonb_build_object(
      'outstanding_balance_minor', coalesce((select sum(balance_due_minor) from public.orders where status not in ('pending_confirmation', 'cancelled')), 0),
      'orders_with_balance', (select count(*) from public.orders where status not in ('pending_confirmation', 'cancelled') and balance_due_minor > 0),
      -- Orders past the deposit gate with less than the deposit paid (for example after a reversal): they should be on hold.
      'deposit_shortfalls', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'order_ref', o.order_ref, 'status', o.status,
                 'deposit_required_minor', o.deposit_required_minor, 'amount_paid_minor', o.amount_paid_minor,
                 'customer_name', c.full_name) order by o.created_at)
        from public.orders o join public.customers c on c.id = o.customer_id
        where o.deposit_fixed_at is not null and o.deposit_gate_status is not null
          and o.status not in ('on_hold', 'cancelled')
          and private.status_order(o.status) >= private.status_order(o.deposit_gate_status)
          and o.amount_paid_minor < o.deposit_required_minor), '[]'::jsonb));
  end if;

  result := result || jsonb_build_object('recent_orders', coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.created_at, c.full_name as customer_name
          from public.orders o join public.customers c on c.id = o.customer_id join public.order_statuses s on s.code = o.status
          order by o.created_at desc limit 8) t), '[]'::jsonb));
  return result;
end;
$$;
$m1fn$;

  -- The release switch goes back to 1 (a versioned, audited change like any policy change; skipped if it is already 1).
  update private.business_policies set value = '{"default_version": 1}', version = version + 1, updated_at = now()
   where key = 'orders.workflow' and value is distinct from '{"default_version": 1}'::jsonb;

  -- Self-check: the restored functions are the earlier ones.
  if pg_get_functiondef('admin.get_order(uuid)'::regprocedure) like '%order_next_statuses%'
     or pg_get_functiondef('admin.transition_order(uuid, text, text)'::regprocedure) like '%workflow_edge_permission%' then
    raise exception 'the earlier definitions were not restored';
  end if;
end;
$m1rollback$;
