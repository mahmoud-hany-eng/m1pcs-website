-- PLAT-0002, migration 12: the deposit policy is unconfigured until the owner configures it, and can be tiered.
--
-- Why. Phase 1 seeded orders.deposit as a flat 50 % for every order. Nothing in the repository supports that: the
-- public site says only that "for some orders, a deposit may be required depending on the requested products and
-- total order value", and earlier M1 quotation systems are reported to have used tiered deposit amounts. A seeded
-- flat percentage was therefore an unconfirmed commercial schedule, active by default. This migration withdraws it.
--
--   * The seeded policy becomes {"mode": "unconfigured"}. While it is unconfigured, an order cannot be created and
--     an existing order cannot advance (fail closed). The owner sets a real schedule with admin.set_policy.
--   * A schedule can be a percentage, a fixed amount, or tiers by order total. Tiers are validated: ascending
--     thresholds, the last tier open-ended, each tier either a percentage or a fixed amount.
--   * The Phase 1 shape (percent_bps and minimum_minor with no mode) stays valid and means "percent".
--
-- No amount, percentage or tier is chosen here. The previous placeholder stays in the policy's version history.

create function private.deposit_policy_error(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  mode text;
  v jsonb;
  tier jsonb;
  tiers jsonb;
  n integer;
  i integer;
  previous bigint := 0;
  upto bigint;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return 'a policy value must be a JSON object';
  end if;

  v := p_value -> 'mode';
  if v is null then
    mode := 'percent';
  elsif jsonb_typeof(v) = 'string' then
    mode := v #>> '{}';
  else
    return 'mode must be unconfigured, percent, fixed or tiered';
  end if;
  if mode not in ('unconfigured', 'percent', 'fixed', 'tiered') then
    return 'mode must be unconfigured, percent, fixed or tiered';
  end if;

  if mode = 'unconfigured' then
    if (p_value - 'mode') <> '{}'::jsonb then
      return 'an unconfigured deposit policy carries no other setting';
    end if;
    return null;
  end if;

  v := p_value -> 'required_before_status';
  if v is null or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 40 then
    return 'required_before_status must be a status code';
  end if;

  if mode = 'percent' then
    if (p_value - 'mode' - 'percent_bps' - 'minimum_minor' - 'required_before_status') <> '{}'::jsonb then
      return 'orders.deposit allows only percent_bps, minimum_minor and required_before_status';
    end if;
    v := p_value -> 'percent_bps';
    if not private.is_uint(v) then
      return 'percent_bps must be an integer from 0 to 10000';
    end if;
    if (v #>> '{}')::bigint > 10000 then
      return 'percent_bps must be an integer from 0 to 10000';
    end if;
    if not private.is_uint(p_value -> 'minimum_minor') then
      return 'minimum_minor must be a non-negative integer';
    end if;
    return null;
  end if;

  if mode = 'fixed' then
    if (p_value - 'mode' - 'fixed_minor' - 'required_before_status') <> '{}'::jsonb then
      return 'a fixed deposit policy allows only fixed_minor and required_before_status';
    end if;
    if not private.is_uint(p_value -> 'fixed_minor') then
      return 'fixed_minor must be a non-negative integer';
    end if;
    return null;
  end if;

  -- tiered
  if (p_value - 'mode' - 'tiers' - 'minimum_minor' - 'required_before_status') <> '{}'::jsonb then
    return 'a tiered deposit policy allows only tiers, minimum_minor and required_before_status';
  end if;
  if p_value ? 'minimum_minor' and not private.is_uint(p_value -> 'minimum_minor') then
    return 'minimum_minor must be a non-negative integer';
  end if;
  tiers := p_value -> 'tiers';
  if tiers is null or jsonb_typeof(tiers) <> 'array' then
    return 'tiers must be a list';
  end if;
  n := jsonb_array_length(tiers);
  if n < 1 or n > 12 then
    return 'a tiered deposit policy needs between 1 and 12 tiers';
  end if;
  for i in 0 .. n - 1 loop
    tier := tiers -> i;
    if jsonb_typeof(tier) <> 'object' then
      return 'every tier must be an object';
    end if;
    if (tier - 'up_to_minor' - 'percent_bps' - 'fixed_minor') <> '{}'::jsonb then
      return 'a tier allows only up_to_minor, percent_bps and fixed_minor';
    end if;
    if (tier ? 'percent_bps') = (tier ? 'fixed_minor') then
      return 'every tier needs exactly one of percent_bps and fixed_minor';
    end if;
    if tier ? 'percent_bps' then
      if not private.is_uint(tier -> 'percent_bps') then
        return 'percent_bps must be an integer from 0 to 10000';
      end if;
      if (tier ->> 'percent_bps')::bigint > 10000 then
        return 'percent_bps must be an integer from 0 to 10000';
      end if;
    elsif not private.is_uint(tier -> 'fixed_minor') then
      return 'fixed_minor must be a non-negative integer';
    end if;
    if i < n - 1 then
      if not private.is_posint(tier -> 'up_to_minor') then
        return 'every tier except the last needs a positive up_to_minor';
      end if;
      upto := (tier ->> 'up_to_minor')::bigint;
      if upto <= previous then
        return 'up_to_minor must increase from one tier to the next';
      end if;
      previous := upto;
    elsif (tier -> 'up_to_minor') is not null and jsonb_typeof(tier -> 'up_to_minor') <> 'null' then
      return 'the last tier must have no up_to_minor, so that every order total is covered';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.deposit_policy_error(jsonb) from public;

create or replace function private.policy_error(p_key text, p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return 'a policy value must be a JSON object';
  end if;

  case p_key
    when 'orders.deposit' then
      return private.deposit_policy_error(p_value);

    when 'orders.full_payment' then
      if (p_value - 'required_before_status') <> '{}'::jsonb then
        return 'orders.full_payment allows only required_before_status';
      end if;
      v := p_value -> 'required_before_status';
      if v is null or (jsonb_typeof(v) not in ('string', 'null')) then
        return 'required_before_status must be a status code or null (no full-payment gate)';
      end if;

    when 'loyalty.earn_rate' then
      if (p_value - 'qar_per_point_minor') <> '{}'::jsonb then
        return 'loyalty.earn_rate allows only qar_per_point_minor';
      end if;
      if not private.is_posint(p_value -> 'qar_per_point_minor') then
        return 'qar_per_point_minor must be a positive integer (QAR minor units that earn one point)';
      end if;

    when 'loyalty.point_value' then
      if (p_value - 'point_value_minor') <> '{}'::jsonb then
        return 'loyalty.point_value allows only point_value_minor';
      end if;
      if not private.is_posint(p_value -> 'point_value_minor') then
        return 'point_value_minor must be a positive integer (QAR minor units one point is worth)';
      end if;

    when 'loyalty.earning_base' then
      if (p_value - 'base' - 'rounding') <> '{}'::jsonb then
        return 'loyalty.earning_base allows only base and rounding';
      end if;
      if coalesce(p_value ->> 'base', '') not in ('order_total', 'amount_paid') then
        return 'base must be order_total or amount_paid';
      end if;
      if coalesce(p_value ->> 'rounding', '') not in ('floor', 'round', 'ceil') then
        return 'rounding must be floor, round or ceil';
      end if;

    when 'loyalty.award_trigger' then
      if (p_value - 'on_status' - 'require_full_payment') <> '{}'::jsonb then
        return 'loyalty.award_trigger allows only on_status and require_full_payment';
      end if;
      v := p_value -> 'on_status';
      if v is null or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 40 then
        return 'on_status must be a status code';
      end if;
      if jsonb_typeof(p_value -> 'require_full_payment') is distinct from 'boolean' then
        return 'require_full_payment must be true or false';
      end if;

    when 'loyalty.negative_balance' then
      if (p_value - 'allowed') <> '{}'::jsonb then
        return 'loyalty.negative_balance allows only allowed';
      end if;
      if jsonb_typeof(p_value -> 'allowed') is distinct from 'boolean' then
        return 'allowed must be true or false';
      end if;

    when 'admin.mfa' then
      if (p_value - 'required') <> '{}'::jsonb then
        return 'admin.mfa allows only required';
      end if;
      if jsonb_typeof(p_value -> 'required') is distinct from 'boolean' then
        return 'required must be true or false';
      end if;

    else
      return 'unknown policy key ' || coalesce(p_key, '<null>');
  end case;

  return null;
end;
$$;

-- The deposit for an order total, from the policy. It never invents a schedule: with no policy, or an
-- unconfigured one, it refuses (an order cannot be priced under a commercial rule nobody has confirmed).
create or replace function private.deposit_for_total(p_total_minor bigint)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  pol jsonb := private.policy('orders.deposit');
  mode text;
  floor_minor bigint;
  wanted bigint;
  tier jsonb;
begin
  if pol is null then
    raise exception 'the orders.deposit policy is missing' using errcode = '55000';
  end if;
  mode := coalesce(pol ->> 'mode', 'percent');
  if mode = 'unconfigured' then
    raise exception 'the deposit policy has not been configured by the owner; set orders.deposit before creating orders'
      using errcode = '55000';
  end if;

  floor_minor := coalesce((pol ->> 'minimum_minor')::bigint, 0);
  if mode = 'percent' then
    wanted := ceil((p_total_minor::numeric * (pol ->> 'percent_bps')::numeric) / 10000)::bigint;
  elsif mode = 'fixed' then
    wanted := (pol ->> 'fixed_minor')::bigint;
  else
    select e.t into tier
    from jsonb_array_elements(pol -> 'tiers') with ordinality as e(t, ord)
    where (e.t ->> 'up_to_minor') is null or p_total_minor <= (e.t ->> 'up_to_minor')::bigint
    order by e.ord
    limit 1;
    if tier ? 'fixed_minor' then
      wanted := (tier ->> 'fixed_minor')::bigint;
    else
      wanted := ceil((p_total_minor::numeric * (tier ->> 'percent_bps')::numeric) / 10000)::bigint;
    end if;
  end if;
  return least(p_total_minor, greatest(floor_minor, wanted));
end;
$$;

create or replace function admin.transition_order(p_order_id uuid, p_to_status text, p_reason text default null)
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
  if coalesce(dep ->> 'mode', 'percent') = 'unconfigured' then
    raise exception 'the deposit policy has not been configured by the owner; orders cannot advance until orders.deposit is set'
      using errcode = '55000';
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

-- The Phase 1 placeholder is withdrawn. Its value stays in private.business_policy_versions (version 1).
select set_config('m1.policy_reason', 'PLAT-0002: no deposit schedule is confirmed; the Phase 1 flat 50 percent placeholder is withdrawn', true);
update private.business_policies
   set value = '{"mode": "unconfigured"}',
       description = 'No deposit schedule is configured. Orders cannot be created or advanced until the owner sets one: a percentage, a fixed amount, or tiers by order total. No confirmed schedule exists, and no open question has been recorded for it yet.',
       confirmation = 'unconfirmed_default',
       open_question = null,
       version = version + 1,
       updated_at = now()
 where key = 'orders.deposit';
select set_config('m1.policy_reason', '', true);

do $audit$
declare
  problems integer;
begin
  select count(*) into problems from private.security_audit();
  if problems > 0 then
    raise exception 'security audit failed after the deposit policy migration (% violation(s))', problems;
  end if;
end;
$audit$;
