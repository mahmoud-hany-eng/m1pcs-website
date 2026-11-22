-- PLAT-0004, order workflow v2, migration 2 of 2: the rules (functions) that move an order through the owner-defined workflow.
--
-- Read migration 1 (20261122120000_order_workflow_v2_schema.sql) first for the design and the compatibility rules.
-- Forward-only: every existing function keeps its name, its argument list, its owner, its security-definer setting, its
-- empty search_path and its privileges (`create or replace`); nothing is dropped. Version-1 orders behave exactly as before.
-- Rerunnable.
--
-- What is new here:
--   * one place that answers "what may this order do next, and what is stopping it": private.order_next_statuses and
--     private.transition_block_reason. The status dropdown and the enforcement in admin.transition_order both use it, so
--     the list the staff see and the moves the database accepts cannot drift apart.
--   * Deposit confirmed cannot be reached on a version-2 order without the recorded deposit, whatever the deposit policy's
--     own gate says: a version-2 order is held to "deposit paid" from Deposit confirmed onward.
--   * a version-2 order must have an explicit fulfilment type before it leaves "Carrier delivering order to M1".
--   * tracking updates (with location and the time the event happened) are accepted only while the order is in Live
--     tracking; afterwards only the owner can add a correction, with a reason.
--   * admin.adopt_new_workflow: the deliberate, per-order, owner-only way to put an existing order on the new workflow.
--   * nothing here creates a tracking update or a location by itself, and nothing here records a payment or an award.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Small private helpers
-- ---------------------------------------------------------------------------------------------------------------
-- The status an order was held from (the latest move into on_hold), or NULL.
create or replace function private.order_held_from(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select h.from_status from private.order_status_history h
  where h.order_id = p_order_id and h.to_status = 'on_hold'
  order by h.id desc limit 1
$$;
revoke all on function private.order_held_from(uuid) from public;

-- Where an order is in its Live tracking life. NULL for a version-1 order (it has no such phase).
--   not_started  the order has not reached Live tracking yet
--   live         the order is in Live tracking: updates are accepted
--   paused       the order was put on hold while in Live tracking: updates wait until it resumes
--   ended        the order has moved past Live tracking: the history is read-only, a correction needs the owner
--   cancelled    the order was cancelled
create or replace function private.tracking_phase(o public.orders)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  eff text;
begin
  if o.workflow_version < 2 then
    return null;
  end if;
  if o.status = 'cancelled' then
    return 'cancelled';
  end if;
  if o.status = 'live_tracking' then
    return 'live';
  end if;
  eff := case when o.status = 'on_hold' then private.order_held_from(o.id) else o.status end;
  if eff is null or eff in ('pending_confirmation', 'awaiting_deposit', 'deposit_received', 'order_confirmed') then
    return 'not_started';
  end if;
  if eff = 'live_tracking' then
    return 'paused';
  end if;
  return 'ended';
end;
$$;
revoke all on function private.tracking_phase(public.orders) from public;

-- The permission a move needs, or NULL when the workflow has no such move for this order.
create or replace function private.workflow_edge_permission(o public.orders, p_to text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.requires_permission from (
    select t.requires_permission from private.order_status_transitions t
    where o.workflow_version = 1 and t.from_code = o.status and t.to_code = p_to
    union all
    select w.requires_permission from private.order_workflow_transitions w
    where o.workflow_version >= 2 and w.workflow_version = o.workflow_version
      and w.from_code = o.status and w.to_code = p_to and w.branch in ('any', coalesce(o.fulfillment_type, '-'))
  ) e limit 1
$$;
revoke all on function private.workflow_edge_permission(public.orders, text) from public;

-- Why a move cannot be made right now, in words, or NULL when nothing stops it. These are the rules admin.transition_order
-- enforces (it raises exactly this text), and the dropdown shows the same text next to a move that is not available yet.
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
revoke all on function private.transition_block_reason(public.orders, text, smallint) from public;

-- The moves the CURRENT staff member may offer for this order: only moves the workflow has, only ones their permissions allow,
-- a held order only back to where it was held from (or cancel), and, next to each, why it cannot be made yet (or NULL).
create or replace function private.order_next_statuses(o public.orders)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  previous text := case when o.status = 'on_hold' then private.order_held_from(o.id) end;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.to_code, 'label', ns.customer_label,
             'blocked_reason', private.transition_block_reason(o, c.to_code, o.workflow_version)) order by ns.sort_order)
    from (
      select t.to_code, t.requires_permission from private.order_status_transitions t
      where o.workflow_version = 1 and t.from_code = o.status
      union
      select w.to_code, w.requires_permission from private.order_workflow_transitions w
      where o.workflow_version >= 2 and w.workflow_version = o.workflow_version and w.from_code = o.status
        and (w.branch in ('any', coalesce(o.fulfillment_type, '-'))
             -- until the type is chosen, show both branches (blocked, with the reason) so staff see what comes next
             or (o.fulfillment_type is null and o.status = 'carrier_delivering'))
    ) c
    join public.order_statuses ns on ns.code = c.to_code
    where private.has_permission(c.requires_permission)
      and (o.status <> 'on_hold' or c.to_code = 'cancelled' or c.to_code = previous)
  ), '[]'::jsonb);
end;
$$;
revoke all on function private.order_next_statuses(public.orders) from public;

-- Why a tracking update cannot be published, or NULL when the order is in Live tracking (version 2) / any state (version 1).
create or replace function private.tracking_closed_reason(o public.orders)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case private.tracking_phase(o)
    when 'live' then null
    when 'not_started' then 'tracking updates can only be published while the order is in Live tracking, and it has not started yet'
    when 'paused' then 'this order is on hold; tracking updates can be published again when it returns to Live tracking'
    when 'ended' then 'Live tracking has ended for this order; adding to its tracking history needs a correction by the owner'
    when 'cancelled' then 'a cancelled order cannot receive tracking updates'
    else null
  end
$$;
revoke all on function private.tracking_closed_reason(public.orders) from public;

-- The one place a tracking update is written: the row, its author, and (for a correction) the reason; then the audit entry.
create or replace function private.insert_tracking_event(
  p_order_id uuid, p_status_code text, p_title text, p_message text, p_location text, p_occurred_at timestamptz,
  p_kind text, p_corrects uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev_id uuid;
begin
  if p_occurred_at is not null and p_occurred_at > now() + interval '1 day' then
    raise exception 'the time of a tracking update cannot be in the future' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  insert into public.order_tracking_events (order_id, status_code, title, message, location, occurred_at, event_kind, corrects_event_id)
  values (p_order_id, p_status_code, p_title, p_message, nullif(btrim(p_location), ''), p_occurred_at, p_kind, p_corrects)
  returning id into ev_id;
  insert into private.tracking_event_authors (event_id, user_id) values (ev_id, (select auth.uid()));
  if p_kind = 'correction' then
    insert into private.tracking_event_corrections (event_id, corrected_by, reason)
    values (ev_id, (select auth.uid()), left(btrim(p_reason), 500));
    perform private.audit('tracking.corrected', 'order', p_order_id::text, jsonb_build_object('event_id', ev_id, 'corrects', p_corrects));
  else
    perform private.audit('tracking.published', 'order', p_order_id::text, jsonb_build_object('event_id', ev_id));
  end if;
  perform private.set_write_ctx(false);
  return ev_id;
end;
$$;
revoke all on function private.insert_tracking_event(uuid, text, text, text, text, timestamptz, text, uuid, text) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. admin.transition_order: the same function, now workflow-aware. Authorization still comes first.
-- ---------------------------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Fulfilment type: an explicit, audited choice. Never inferred, never changed once the order is inside its branch.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.set_order_fulfillment_type(p_order_id uuid, p_fulfillment_type text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  eff text;
begin
  perform private.require_permission('orders.transition');
  if p_fulfillment_type is null or p_fulfillment_type not in ('custom_pc_build', 'parts_only') then
    raise exception 'the fulfilment type must be custom_pc_build or parts_only' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.workflow_version < 2 then
    raise exception 'this order is on the earlier workflow; move it to the current workflow first' using errcode = '55000';
  end if;
  if o.status = 'cancelled' then
    raise exception 'a cancelled order cannot be changed' using errcode = '55000';
  end if;
  if o.fulfillment_type is not distinct from p_fulfillment_type then
    return;
  end if;
  eff := case when o.status = 'on_hold' then private.order_held_from(o.id) else o.status end;
  if eff in ('building', 'quality_check', 'items_arrived', 'awaiting_scheduling', 'ready_for_delivery', 'delivered') then
    raise exception 'the fulfilment type cannot change once the order has entered its branch' using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  update public.orders set fulfillment_type = p_fulfillment_type where id = o.id;
  perform private.audit('order.fulfillment_set', 'order', o.id::text,
    jsonb_build_object('from', o.fulfillment_type, 'to', p_fulfillment_type, 'reason', left(btrim(p_reason), 500)));
  perform private.set_write_ctx(false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Tracking. publish_tracking_event keeps its signature (the deployed website calls it); on a version-2 order it now
--    applies the Live tracking rule too. publish_tracking_update adds the shipment location and the time it happened.
-- ---------------------------------------------------------------------------------------------------------------
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
  o public.orders%rowtype;
  closed text;
begin
  perform private.require_permission('tracking.publish');
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  closed := private.tracking_closed_reason(o);
  if closed is not null then
    raise exception '%', closed using errcode = '55000';
  end if;
  return private.insert_tracking_event(o.id, case when o.workflow_version >= 2 then 'live_tracking' else p_status_code end,
    p_title, p_message, null, null, 'update', null, null);
end;
$$;

create or replace function admin.publish_tracking_update(
  p_order_id uuid,
  p_title text,
  p_message text,
  p_location text,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  closed text;
begin
  perform private.require_permission('tracking.publish');
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  closed := private.tracking_closed_reason(o);
  if closed is not null then
    raise exception '%', closed using errcode = '55000';
  end if;
  return private.insert_tracking_event(o.id, case when o.workflow_version >= 2 then 'live_tracking' else null end,
    p_title, p_message, p_location, p_occurred_at, 'update', null, null);
end;
$$;

-- After Live tracking has ended (or while the order is on hold from it) an addition is a CORRECTION: owner only, with a reason,
-- visibly marked as a correction to the customer, and optionally pointing at the update it corrects. The original stays.
create or replace function admin.publish_tracking_correction(
  p_order_id uuid,
  p_title text,
  p_message text,
  p_location text,
  p_occurred_at timestamptz,
  p_reason text,
  p_corrects_event_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  phase text;
begin
  perform private.require_permission('tracking.correct');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to add a correction to the tracking history' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.workflow_version < 2 then
    raise exception 'this order is on the earlier workflow; tracking updates are published normally' using errcode = '55000';
  end if;
  phase := private.tracking_phase(o);
  if phase = 'live' then
    raise exception 'Live tracking is open for this order; publish a normal tracking update' using errcode = '55000';
  end if;
  if phase <> 'ended' and phase <> 'paused' then
    raise exception 'a correction can only be added after Live tracking has started and no longer than the order exists' using errcode = '55000';
  end if;
  if p_corrects_event_id is not null and not exists (
       select 1 from public.order_tracking_events e where e.id = p_corrects_event_id and e.order_id = o.id) then
    raise exception 'the update being corrected does not belong to this order' using errcode = '22023';
  end if;
  return private.insert_tracking_event(o.id, 'live_tracking', p_title, p_message, p_location, p_occurred_at,
    'correction', p_corrects_event_id, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Moving an EXISTING order onto the new workflow: one order at a time, owner only, with a reason, nothing automatic.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.adopt_new_workflow(
  p_order_id uuid,
  p_reason text,
  p_target_status text default null,
  p_fulfillment_type text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  m private.workflow_adoption_map%rowtype;
  blocked text;
  options text;
begin
  perform private.require_permission('orders.adopt');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to move an order onto the current workflow' using errcode = '22023';
  end if;
  if p_fulfillment_type is not null and p_fulfillment_type not in ('custom_pc_build', 'parts_only') then
    raise exception 'the fulfilment type must be custom_pc_build or parts_only' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.workflow_version >= 2 then
    raise exception 'this order is already on the current workflow' using errcode = '55000';
  end if;
  if o.status = 'on_hold' then
    raise exception 'resume the order before moving it onto the current workflow' using errcode = '55000';
  end if;
  if o.status = 'cancelled' then
    raise exception 'a cancelled order stays as it is' using errcode = '55000';
  end if;

  select * into m from private.workflow_adoption_map a
   where a.legacy_status = o.status and ((p_target_status is null and a.is_default) or a.target_status = p_target_status);
  if not found then
    select string_agg(a.target_status, ', ' order by a.is_default desc, a.target_status) into options
      from private.workflow_adoption_map a where a.legacy_status = o.status;
    raise exception 'an order in % can be moved to: %', o.status, coalesce(options, 'nothing') using errcode = '55000';
  end if;
  if m.requires_fulfillment is not null and p_fulfillment_type is distinct from m.requires_fulfillment then
    raise exception 'moving this order to % needs the fulfilment type %', m.target_status, m.requires_fulfillment using errcode = '55000';
  end if;

  -- The same payment rules as a normal move: nothing at or beyond Deposit confirmed without the recorded deposit.
  if private.status_order(m.target_status) >= private.status_order('deposit_received') then
    blocked := private.transition_block_reason(o, m.target_status, 2::smallint);
    if blocked is not null then
      raise exception '%', blocked using errcode = '55000';
    end if;
  end if;

  perform private.set_write_ctx(true);
  update public.orders
     set workflow_version = 2, status = m.target_status, fulfillment_type = coalesce(p_fulfillment_type, o.fulfillment_type)
   where id = o.id;
  -- The earlier history stays exactly as it was; this adds one row that says where the order was placed.
  insert into private.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (o.id, o.status, m.target_status, (select auth.uid()), left('Moved to the current workflow: ' || btrim(p_reason), 500));
  perform private.audit('order.workflow_adopted', 'order', o.id::text,
    jsonb_build_object('from', o.status, 'to', m.target_status, 'fulfillment_type', coalesce(p_fulfillment_type, o.fulfillment_type)));
  perform private.set_write_ctx(false);
  return m.target_status;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The read functions: every key they returned before is still there; they gain the workflow, the stages, the nested
--    tracking fields and, next to each possible move, why it is not available yet.
-- ---------------------------------------------------------------------------------------------------------------
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
    'order_confirmed', count(*) filter (where status = 'order_confirmed'),
    'live_tracking', count(*) filter (where status = 'live_tracking'),
    'awaiting_scheduling', count(*) filter (where status = 'awaiting_scheduling'),
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

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Privileges: the four new staff functions are executable by signed-in staff sessions and the staff gateway only.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function admin.set_order_fulfillment_type(uuid, text, text) from public, anon, service_role;
revoke all on function admin.publish_tracking_update(uuid, text, text, text, timestamptz) from public, anon, service_role;
revoke all on function admin.publish_tracking_correction(uuid, text, text, text, timestamptz, text, uuid) from public, anon, service_role;
revoke all on function admin.adopt_new_workflow(uuid, text, text, text) from public, anon, service_role;
grant execute on function admin.set_order_fulfillment_type(uuid, text, text) to authenticated, m1_staff_gateway;
grant execute on function admin.publish_tracking_update(uuid, text, text, text, timestamptz) to authenticated, m1_staff_gateway;
grant execute on function admin.publish_tracking_correction(uuid, text, text, text, timestamptz, text, uuid) to authenticated, m1_staff_gateway;
grant execute on function admin.adopt_new_workflow(uuid, text, text, text) to authenticated, m1_staff_gateway;

-- Self-check: a mistake in the privileges fails the migration.
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.set_order_fulfillment_type(uuid, text, text)',
    'admin.publish_tracking_update(uuid, text, text, text, timestamptz)',
    'admin.publish_tracking_correction(uuid, text, text, text, timestamptz, text, uuid)',
    'admin.adopt_new_workflow(uuid, text, text, text)',
    'admin.transition_order(uuid, text, text)',
    'admin.publish_tracking_event(uuid, text, text, text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then
      raise exception '% must not be executable by anon or PUBLIC', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('m1_staff_gateway', f, 'execute') then
      raise exception '% must be executable by authenticated and the staff gateway', f;
    end if;
  end loop;
  foreach f in array array[
    'private.order_held_from(uuid)', 'private.tracking_phase(public.orders)', 'private.workflow_edge_permission(public.orders, text)',
    'private.transition_block_reason(public.orders, text, smallint)', 'private.order_next_statuses(public.orders)',
    'private.tracking_closed_reason(public.orders)',
    'private.insert_tracking_event(uuid, text, text, text, text, timestamptz, text, uuid, text)'] loop
    if has_function_privilege('m1_staff_gateway', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception '% must stay private', f;
    end if;
  end loop;
end;
$$;
