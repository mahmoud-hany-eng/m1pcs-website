-- RESTORE admin.transition_order exactly as it was deployed in PLAT-0003 (before 20261121120000).
-- WARNING: that version checks the order BEFORE it checks the caller's permission, which is the defect that migration fixes.
-- Use this only if migration 20261121120000 itself must be undone. Safe to run more than once; it changes one function body.
-- supabase/tests/release.db.test.mjs proves that running this script returns the function to a byte-identical definition.

CREATE OR REPLACE FUNCTION admin.transition_order(p_order_id uuid, p_to_status text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.orders%rowtype;
  t private.order_status_transitions%rowtype;
  previous text;
  dep jsonb := private.policy('orders.deposit');
  fp jsonb := private.policy('orders.full_payment');
  gate text;
  q private.deposit_quote_result;
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
$function$;
