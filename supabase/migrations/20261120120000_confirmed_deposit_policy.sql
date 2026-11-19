-- PLAT-0003, migration 14: the owner-confirmed deposit schedule, and the deposit is fixed when an order is confirmed.
--
-- The owner confirmed this schedule on 2026-11-19. It applies to the WHOLE order total, never to slices of it:
--
--     total <= QAR 3,000.00                       15 %
--     QAR 3,000.00 < total <= QAR 5,000.00        25 %
--     total > QAR 5,000.00                        35 %
--
-- It replaces the `unconfigured` placeholder of migration 12. The withdrawn flat 50 percent of Phase 1 is NOT restored:
-- it stays in the policy's version history as version 1 and nothing here refers to it.
--
-- Money is integer QAR minor units (1 QAR = 100 dirham, the minor unit). A percentage deposit is rounded to the NEAREST
-- minor unit, a half rounding up: deposit = floor((total * rate_in_basis_points + 5000) / 10000). Only whole-number
-- arithmetic is used, so the result is exact and never depends on floating point.
--
-- The deposit is RECORDED WHEN THE ORDER IS CONFIRMED (the move from pending_confirmation to awaiting_deposit). Until
-- then the figure on the order is provisional. At confirmation the amount, the rate, the policy version, the rule in
-- words and the gate status are written onto the order and can no longer change, so a later change of policy never
-- rewrites an order that was already confirmed.
--
-- Nothing here decides refundability, which payment methods may be refunded, or any other deposit question the owner
-- has not answered. A deposit counts as paid only through admin.record_payment, which needs the payments.record
-- permission: a person with that permission confirms receipt; nobody and nothing else can.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. What an order remembers about its deposit.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.orders
  add column deposit_policy_version integer,
  add column deposit_rate_bps integer,
  add column deposit_rule text,
  add column deposit_gate_status text,
  add column deposit_fixed_at timestamptz;
alter table public.orders
  add constraint orders_deposit_rate_range check (deposit_rate_bps is null or deposit_rate_bps between 0 and 10000),
  add constraint orders_deposit_rule_length check (deposit_rule is null or char_length(deposit_rule) <= 300);

-- Once the deposit is fixed, nothing that defines it may change, by any role or any code path.
create function private.guard_fixed_deposit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deposit_fixed_at is not null and (
       new.deposit_fixed_at is distinct from old.deposit_fixed_at
    or new.deposit_required_minor is distinct from old.deposit_required_minor
    or new.deposit_rate_bps is distinct from old.deposit_rate_bps
    or new.deposit_policy_version is distinct from old.deposit_policy_version
    or new.deposit_rule is distinct from old.deposit_rule
    or new.deposit_gate_status is distinct from old.deposit_gate_status
    or new.total_minor is distinct from old.total_minor) then
    raise exception 'the deposit of a confirmed order is fixed and cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_fixed_deposit() from public;
create trigger orders_guard_fixed_deposit before update on public.orders
  for each row execute function private.guard_fixed_deposit();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The calculation, in one place.
-- ---------------------------------------------------------------------------------------------------------------
create type private.deposit_quote_result as (
  amount_minor bigint,
  rate_bps integer,
  policy_version integer,
  rule text,
  gate_status text
);

-- The deposit for an order total under the policy in force NOW. It never invents a schedule: with no policy, or an
-- unconfigured one, it refuses (an order cannot be priced under a commercial rule nobody has confirmed).
create function private.deposit_quote(p_total_minor bigint)
returns private.deposit_quote_result
language plpgsql
stable
set search_path = ''
as $$
declare
  pol jsonb;
  ver integer;
  mode text;
  floor_minor bigint;
  wanted bigint;
  rate integer;
  tier jsonb;
  tier_no integer;
  tier_count integer;
  rule text;
  result private.deposit_quote_result;
begin
  select p.value, p.version into pol, ver from private.business_policies p where p.key = 'orders.deposit';
  if pol is null then
    raise exception 'the orders.deposit policy is missing' using errcode = '55000';
  end if;
  if p_total_minor is null or p_total_minor < 0 then
    raise exception 'an order total cannot be negative' using errcode = '22023';
  end if;
  mode := coalesce(pol ->> 'mode', 'percent');
  if mode = 'unconfigured' then
    raise exception 'the deposit policy has not been configured by the owner; set orders.deposit before creating orders'
      using errcode = '55000';
  end if;

  floor_minor := coalesce((pol ->> 'minimum_minor')::bigint, 0);
  if mode = 'percent' then
    rate := (pol ->> 'percent_bps')::integer;
    wanted := (p_total_minor * rate + 5000) / 10000;
    rule := format('%s%% of the whole order total, to the nearest dirham (a half rounds up)', to_char(rate / 100.0, 'FM990.00'));
  elsif mode = 'fixed' then
    wanted := (pol ->> 'fixed_minor')::bigint;
    rule := 'a fixed amount';
  else
    select e.t, e.ord::integer into tier, tier_no
    from jsonb_array_elements(pol -> 'tiers') with ordinality as e(t, ord)
    where (e.t ->> 'up_to_minor') is null or p_total_minor <= (e.t ->> 'up_to_minor')::bigint
    order by e.ord
    limit 1;
    tier_count := jsonb_array_length(pol -> 'tiers');
    if tier ? 'fixed_minor' then
      wanted := (tier ->> 'fixed_minor')::bigint;
      rule := format('tier %s of %s: a fixed amount', tier_no, tier_count);
    else
      rate := (tier ->> 'percent_bps')::integer;
      wanted := (p_total_minor * rate + 5000) / 10000;
      rule := format('tier %s of %s: %s%% of the whole order total, to the nearest dirham (a half rounds up)',
        tier_no, tier_count, to_char(rate / 100.0, 'FM990.00'));
    end if;
  end if;

  result.amount_minor := least(p_total_minor, greatest(floor_minor, wanted));
  result.rate_bps := rate;
  result.policy_version := ver;
  result.rule := rule;
  result.gate_status := pol ->> 'required_before_status';
  return result;
end;
$$;
revoke all on function private.deposit_quote(bigint) from public;

-- The amount alone (used when an order is created, where it is only a provisional figure).
create or replace function private.deposit_for_total(p_total_minor bigint)
returns bigint
language sql
stable
set search_path = ''
as $$ select (private.deposit_quote(p_total_minor)).amount_minor $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Confirming an order fixes its deposit.
-- ---------------------------------------------------------------------------------------------------------------
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
$$;
revoke all on function admin.transition_order(uuid, text, text) from public, anon;
grant execute on function admin.transition_order(uuid, text, text) to authenticated;

-- Orders confirmed before this migration (none exist in any deployment; kept so the rule is total): their deposit is
-- marked as recorded earlier, under the rule then in force, and is fixed from now on.
select private.set_write_ctx(true);
update public.orders
   set deposit_fixed_at = created_at,
       deposit_rule = 'recorded before the confirmed schedule existed',
       deposit_gate_status = (select value ->> 'required_before_status' from private.business_policies where key = 'orders.deposit')
 where status <> 'pending_confirmation' and deposit_fixed_at is null;
select private.set_write_ctx(false);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The confirmed schedule replaces the unconfigured placeholder. The old values stay in the version history.
-- ---------------------------------------------------------------------------------------------------------------
select set_config('m1.policy_reason', 'PLAT-0003: the owner confirmed the deposit schedule on 2026-11-19 (15 percent up to QAR 3,000; 25 percent up to QAR 5,000; 35 percent above; whole order total)', true);
update private.business_policies
   set value = '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"percent_bps": 3500}]}',
       description = 'Confirmed by the owner on 2026-11-19: 15 percent of the whole order total up to QAR 3,000.00; 25 percent above that up to QAR 5,000.00; 35 percent above QAR 5,000.00. The percentage applies to the entire total, not to slices. Rounded to the nearest dirham, a half rounding up. Whether a deposit is refundable, and for which payment methods, is not decided.',
       confirmation = 'confirmed_by_owner',
       open_question = null,
       version = version + 1,
       updated_at = now()
 where key = 'orders.deposit';
select set_config('m1.policy_reason', '', true);

-- The stored value must pass the same validator that admin.set_policy applies to every later change.
do $check$
declare
  problem text;
begin
  select private.policy_error('orders.deposit', value) into problem from private.business_policies where key = 'orders.deposit';
  if problem is not null then
    raise exception 'the confirmed deposit policy does not validate: %', problem;
  end if;
end;
$check$;

do $audit$
declare
  problems integer;
begin
  select count(*) into problems from private.security_audit();
  if problems > 0 then
    raise exception 'security audit failed after the confirmed deposit policy migration (% violation(s))', problems;
  end if;
end;
$audit$;
