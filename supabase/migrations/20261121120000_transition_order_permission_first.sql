-- PLAT-0004, DEFECT-2: admin.transition_order verifies authorization BEFORE it discloses anything about an order.
--
-- Until now the function looked the order up (answering "order not found") and checked the requested move (answering
-- "an order cannot move from <status> to <status>") before it checked the permission. A caller who was signed in to the
-- database but held no permission, and who knew an order id, could therefore learn that the order exists and what its
-- current status is from the error text. Every other staff function already checks its permission first.
--
-- This migration is forward-only: it replaces the function with `create or replace` and changes ONE thing, the position of
-- the permission check. The body is otherwise identical to the definition in 20261120120000_confirmed_deposit_policy.sql,
-- and the owner, the security-definer setting, the empty search_path and the privileges (authenticated and the staff
-- gateway may execute; PUBLIC and anon may not) are kept by `create or replace`. No earlier migration is edited.
--
-- Every status transition is configured to need `orders.transition` (private.order_status_transitions.requires_permission),
-- so that is the permission checked up front. The per-transition permission is still checked once the move is known, so a
-- transition that is later configured to need a stronger permission keeps working as before.

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

-- Self-check: the privileges are exactly what they were (create or replace keeps them), so a mistake here fails the migration.
do $$
begin
  if has_function_privilege('anon', 'admin.transition_order(uuid, text, text)', 'execute')
     or has_function_privilege('public', 'admin.transition_order(uuid, text, text)', 'execute') then
    raise exception 'admin.transition_order must not be executable by anon or PUBLIC';
  end if;
  if not has_function_privilege('authenticated', 'admin.transition_order(uuid, text, text)', 'execute')
     or not has_function_privilege('m1_staff_gateway', 'admin.transition_order(uuid, text, text)', 'execute') then
    raise exception 'admin.transition_order must stay executable by authenticated and the staff gateway';
  end if;
end;
$$;
