-- PLAT-0005, order pricing and rewards, migration 2 of 3: the rules (functions).
--
-- Read migration 1 (20261123120000_pricing_rewards_schema.sql) first for the design and the meaning of every amount.
-- Forward-only: every existing function keeps its name, argument list, owner, security-definer setting, empty search_path and
-- privileges (`create or replace`); nothing is dropped. The three older entry points the live website calls
-- (admin.create_order with 7 arguments, admin.record_payment with 8 and 10) keep working and keep their behaviour: for an order
-- with no discount and no credit (every order they can create) the net payable is the total. Rerunnable.
--
-- What is new here:
--   * private.order_pricing_quote: ONE place that works out an order's money (gross, discount, credit, net payable, the deposit,
--     the cash left after the deposit) and refuses what the owner's rules forbid. admin.create_order uses it; so does every test.
--   * admin.create_order (11 arguments): creates the order with its discount and its loyalty redemption in ONE transaction. If
--     anything fails, nothing is kept: no order, no discount record, no spent points, no idempotency claim.
--   * private.redeem_points_for_order / private.restore_redeemed_points: the redemption ledger entry, and its compensating
--     entry when the order is cancelled (append-only; one of each per order, by unique index).
--   * the rules that mean "paid in full" now mean "paid in full of the NET payable amount": payments, the full-payment gate and
--     the loyalty award. Points are earned on the net payable amount only, never on discounted or credited money.
--   * admin.order_pricing_context: what the order form needs to show the Pricing & Rewards section (point value, the customer's
--     points, the deposit schedule, whether the signed-in person may discount or redeem).
--   * admin.get_order and admin.list_orders return the pricing fields.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Small private helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.point_value_minor()
returns bigint
language sql
stable
set search_path = ''
as $$ select (private.policy('loyalty.point_value') ->> 'point_value_minor')::bigint $$;
revoke all on function private.point_value_minor() from public;

-- Discounts and redemptions are available only while the loyalty earning rule counts money that is actually payable (the net
-- amount, or cash received). Otherwise a discounted order would earn points on money the customer never paid.
create or replace function private.rewards_pricing_ready()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(private.policy('loyalty.earning_base') ->> 'base', '') in ('net_payable', 'amount_paid') $$;
revoke all on function private.rewards_pricing_ready() from public;

-- A discount request, checked and put in one fixed shape (or NULL for "no discount"). The shape is also what the idempotency
-- fingerprint is made of, so the same request always has the same fingerprint.
create or replace function private.normalize_discount(p_discount jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  mode text;
  reason text;
begin
  if p_discount is null or p_discount = 'null'::jsonb or p_discount = '{}'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_discount) <> 'object' then
    raise exception 'the discount must be a JSON object' using errcode = '22023';
  end if;
  if (p_discount - 'mode' - 'amount_minor' - 'percent_bps' - 'reason') <> '{}'::jsonb then
    raise exception 'the discount has a field that is not allowed; allowed: mode, amount_minor, percent_bps, reason' using errcode = '22023';
  end if;
  mode := p_discount ->> 'mode';
  reason := btrim(coalesce(p_discount ->> 'reason', ''));
  if char_length(reason) not between 3 and 500 then
    raise exception 'a reason is required for a discount (3 to 500 characters); it is kept with the record of who authorized it' using errcode = '22023';
  end if;
  if mode = 'fixed' then
    if p_discount ? 'percent_bps' then
      raise exception 'a fixed discount carries an amount, not a percentage' using errcode = '22023';
    end if;
    if coalesce(p_discount ->> 'amount_minor', '') !~ '^[0-9]{1,12}$' or (p_discount ->> 'amount_minor')::bigint < 1 then
      raise exception 'a fixed discount must be a whole number of QAR minor units, at least 1' using errcode = '22023';
    end if;
    return jsonb_build_object('mode', 'fixed', 'amount_minor', (p_discount ->> 'amount_minor')::bigint, 'reason', reason);
  elsif mode = 'percent' then
    if p_discount ? 'amount_minor' then
      raise exception 'a percentage discount carries a percentage, not an amount' using errcode = '22023';
    end if;
    if coalesce(p_discount ->> 'percent_bps', '') !~ '^[0-9]{1,5}$'
       or (p_discount ->> 'percent_bps')::integer not between 1 and 10000 then
      raise exception 'a percentage discount must be from 0.01%% to 100%% (percent_bps 1 to 10000)' using errcode = '22023';
    end if;
    return jsonb_build_object('mode', 'percent', 'percent_bps', (p_discount ->> 'percent_bps')::integer, 'reason', reason);
  end if;
  raise exception 'the discount mode must be fixed or percent' using errcode = '22023';
end;
$$;
revoke all on function private.normalize_discount(jsonb) from public;

create or replace function private.qar_text(p_minor bigint)
returns text
language sql
immutable
set search_path = ''
as $$ select 'QAR ' || to_char(p_minor / 100.0, 'FM999,999,999,999,990.00') $$;
revoke all on function private.qar_text(bigint) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. THE calculation. Money in, money out, in one place.
--      deposit            from the ORIGINAL GROSS total, whatever the discount or the redemption (private.deposit_quote)
--      discount           fixed, or a percentage of the gross rounded to the nearest 0.01 (a half rounds up)
--      credit             points x the point value, never more than what is left after the discount
--      net payable        gross - discount - credit
--      cash after deposit net payable - deposit
--    and it REFUSES, with the reason in words, whatever the owner's rules do not allow, including the one situation that is a
--    policy decision: discounts and credit that leave less to pay than the cash deposit. It never lowers the deposit on its own,
--    never invents a payment and never lets an inconsistent order be created.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.order_pricing_quote(p_customer_id uuid, p_gross_minor bigint, p_discount jsonb, p_points bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d jsonb := private.normalize_discount(p_discount);
  pts bigint := coalesce(p_points, 0);
  pv bigint := private.point_value_minor();
  balance bigint := private.loyalty_balance(p_customer_id);
  disc bigint := 0;
  after_disc bigint;
  credit bigint := 0;
  net bigint;
  dq private.deposit_quote_result;
begin
  if p_gross_minor is null or p_gross_minor < 0 then
    raise exception 'an order total cannot be negative' using errcode = '22023';
  end if;
  if pts < 0 then
    raise exception 'points to redeem cannot be negative' using errcode = '22023';
  end if;
  if (d is not null or pts > 0) and not private.rewards_pricing_ready() then
    raise exception 'discounts and redeemed points are switched off until the loyalty rule (loyalty.earning_base) counts only the amount actually payable; ask the owner to set it to net_payable'
      using errcode = '55000';
  end if;

  if d is not null then
    if p_gross_minor = 0 then
      raise exception 'there is nothing to discount: the order has no priced items yet' using errcode = '22023';
    end if;
    disc := case d ->> 'mode'
              when 'fixed' then (d ->> 'amount_minor')::bigint
              else (p_gross_minor * (d ->> 'percent_bps')::bigint + 5000) / 10000 end;
    if disc < 1 then
      raise exception 'the discount works out to less than QAR 0.01' using errcode = '22023';
    end if;
    if disc > p_gross_minor then
      raise exception 'the discount (%) is more than the order total (%)', private.qar_text(disc), private.qar_text(p_gross_minor)
        using errcode = '55000';
    end if;
  end if;
  after_disc := p_gross_minor - disc;

  if pts > 0 then
    if pv is null or pv < 1 then
      raise exception 'the loyalty.point_value policy is missing' using errcode = '55000';
    end if;
    if pts > balance then
      raise exception 'this customer has % points, so % cannot be redeemed', balance, pts using errcode = '55000';
    end if;
    credit := pts * pv;
    if credit > after_disc then
      raise exception 'the points are worth %, which is more than the % left to pay after the discount; redeem at most % points',
        private.qar_text(credit), private.qar_text(after_disc), after_disc / pv using errcode = '55000';
    end if;
  end if;
  net := after_disc - credit;

  -- The deposit: from the ORIGINAL gross total. It raises if the deposit policy is missing or unconfigured.
  dq := private.deposit_quote(p_gross_minor);
  if net < dq.amount_minor then
    raise exception 'the discount and loyalty credit leave % to pay, which is less than the % cash deposit that is worked out from the original order total (%). The deposit is not lowered automatically and no payment can be invented, so this order cannot be created like this; the owner has to decide how such an order is treated',
      private.qar_text(net), private.qar_text(dq.amount_minor), private.qar_text(p_gross_minor) using errcode = '55000';
  end if;

  return jsonb_build_object(
    'gross_minor', p_gross_minor,
    'discount_mode', d ->> 'mode',
    'discount_percent_bps', (d ->> 'percent_bps')::integer,
    'discount_minor', disc,
    'after_discount_minor', after_disc,
    'points_redeemed', pts,
    'point_value_minor', pv,
    'credit_minor', credit,
    'net_payable_minor', net,
    'deposit_minor', dq.amount_minor,
    'deposit_rate_bps', dq.rate_bps,
    'deposit_policy_version', dq.policy_version,
    'deposit_rule', dq.rule,
    'cash_balance_after_deposit_minor', net - dq.amount_minor,
    'points_balance_before', balance,
    'points_balance_after', balance - pts);
end;
$$;
revoke all on function private.order_pricing_quote(uuid, bigint, jsonb, bigint) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The redemption, and its compensation. Both write to the append-only ledger; neither edits or deletes anything.
-- ---------------------------------------------------------------------------------------------------------------
-- Spends p_points of the order's customer against the order. A redeemed point is an ORDER CREDIT, not a payment: nothing here
-- touches the payment ledger and no receipt is produced. Runs inside the staff function (write flag on), in the same transaction
-- as the order. The per-customer lock is taken first, so two orders cannot spend the same points; the ledger's own trigger
-- re-checks the balance after the lock, so even a caller that skipped this function could not overspend.
create or replace function private.redeem_points_for_order(p_order_id uuid, p_points bigint, p_credit_minor bigint)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  entry_id uuid;
begin
  if p_points is null or p_points < 1 or p_points > 2147483647 then
    raise exception 'points to redeem must be a whole number from 1' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  perform private.lock_customer_points(o.customer_id);
  if private.loyalty_balance(o.customer_id) < p_points then
    raise exception 'this customer has % points, so % cannot be redeemed', private.loyalty_balance(o.customer_id), p_points using errcode = '55000';
  end if;
  insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description)
  values (o.customer_id, o.id, 'redemption', -p_points::integer,
          'Redeemed on order ' || o.order_ref || ': ' || private.qar_text(p_credit_minor) || ' credit')
  returning id into entry_id;
  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, 'redeemed against order ' || o.order_ref || ' when it was created', (select auth.uid()));
  return entry_id;
end;
$$;
revoke all on function private.redeem_points_for_order(uuid, bigint, bigint) from public;

-- Gives the points of a cancelled order back, once. A NEW positive entry that points at the redemption; the redemption itself
-- is never edited. Safe to call twice (the second call returns the first entry and writes nothing). Returns NULL when the order
-- redeemed nothing. It does not touch earned points, and it never creates a negative balance.
create or replace function private.restore_redeemed_points(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  red public.loyalty_ledger%rowtype;
  entry_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select * into red from public.loyalty_ledger where order_id = o.id and entry_type = 'redemption';
  if not found then
    return null;
  end if;
  perform private.lock_customer_points(o.customer_id);
  insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, reverses_entry_id, description)
  values (o.customer_id, o.id, 'redemption_restore', -red.points, red.id, 'Points returned: order ' || o.order_ref || ' was cancelled')
  on conflict (reverses_entry_id) where entry_type = 'redemption_restore' do nothing
  returning id into entry_id;
  if entry_id is null then
    select id into entry_id from public.loyalty_ledger where reverses_entry_id = red.id and entry_type = 'redemption_restore';
    return entry_id;
  end if;
  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  -- The reason kept with the entry must be 3 to 500 characters; the cancel form allows any length from 0 to 500, so a shorter or longer
  -- reason is replaced by a standard one here (the order's own history keeps the reason exactly as typed). Otherwise cancelling an
  -- order that redeemed points would fail for a reason such as "ok".
  values (entry_id, case when char_length(btrim(coalesce(p_reason, ''))) between 3 and 500 then btrim(p_reason) else 'order cancelled' end, (select auth.uid()));
  perform private.audit('loyalty.redemption_restored', 'order', o.id::text,
    jsonb_build_object('points', -red.points, 'redemption_entry', red.id, 'restore_entry', entry_id));
  return entry_id;
end;
$$;
revoke all on function private.restore_redeemed_points(uuid, text) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. "Paid in full" means paid in full of the NET payable amount; points are earned on the net payable amount.
-- ---------------------------------------------------------------------------------------------------------------
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

  -- amount_paid: cash received. Any other base (net_payable, and the earlier placeholder order_total) counts the amount payable: the gross
  -- value less the discount and the redeemed credit. Points are never earned on money that was discounted or paid with points, whatever
  -- the policy is called; for an order with nothing taken off the amount payable IS the order total, so earlier orders earn exactly as before.
  base := case base_kind when 'amount_paid' then o.amount_paid_minor else o.net_payable_minor end;
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
revoke all on function private.award_loyalty_for_order(uuid, text) from public;

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
  if coalesce((trig ->> 'require_full_payment')::boolean, true) and o.amount_paid_minor < o.net_payable_minor then
    return null;
  end if;
  return private.award_loyalty_for_order(o.id, 'award for ' || o.status || ' order');
end;
$$;
revoke all on function private.try_award_loyalty(uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 4b. Moves that depend on money, and the cancellation that gives redeemed points back.
-- ---------------------------------------------------------------------------------------------------------------
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
    -- Confirming an order whose discounts and credit leave less to pay than the cash deposit (worked out from the gross total) is
    -- refused: the deposit is not lowered silently and no payment is invented. (Never true for an order without a discount.)
    if o.status = 'pending_confirmation' and p_to = 'awaiting_deposit' and (o.discount_minor + o.loyalty_credit_minor) > 0
       and o.net_payable_minor < (private.deposit_quote(o.total_minor)).amount_minor then
      return format('the discount and loyalty credit leave %s to pay, which is less than the %s cash deposit worked out from the original order total; the owner has to decide how such an order is treated',
                    private.qar_text(o.net_payable_minor), private.qar_text((private.deposit_quote(o.total_minor)).amount_minor));
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
    if fp_gate is not null and private.status_order(p_to) >= private.status_order(fp_gate) and o.amount_paid_minor < o.net_payable_minor then
      return 'the order must be paid in full before ' || fp_gate;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.transition_block_reason(public.orders, text, smallint) from public;

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
  -- A cancelled order gives its redeemed points back, once, by a new compensating entry (never an edit of the redemption).
  if p_to_status = 'cancelled' then
    perform private.restore_redeemed_points(o.id, coalesce(nullif(btrim(p_reason), ''), 'order cancelled'));
  end if;
  perform private.try_award_loyalty(o.id);
  perform private.audit('order.transition', 'order', o.id::text,
    case when q.amount_minor is null then jsonb_build_object('from', o.status, 'to', p_to_status)
         else jsonb_build_object('from', o.status, 'to', p_to_status, 'deposit_minor', q.amount_minor,
                                 'deposit_rate_bps', q.rate_bps, 'policy_version', q.policy_version) end);
  perform private.set_write_ctx(false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4c. Payments: never more than the net payable amount (both entry points the website can have).
-- ---------------------------------------------------------------------------------------------------------------
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
  -- A payment can never exceed what is payable: the total less any discount and loyalty credit.
  if o.amount_paid_minor + p_amount_minor > o.net_payable_minor then
    raise exception '%', case when o.discount_minor + o.loyalty_credit_minor = 0 then 'this payment would exceed the order total'
      else format('this payment would exceed the amount payable on this order (%s after the discount and loyalty credit)', private.qar_text(o.net_payable_minor)) end
      using errcode = '55000';
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
  -- A payment can never exceed what is payable: the total less any discount and loyalty credit.
  if o.amount_paid_minor + p_amount_minor > o.net_payable_minor then
    raise exception '%', case when o.discount_minor + o.loyalty_credit_minor = 0 then 'this payment would exceed the order total'
      else format('this payment would exceed the amount payable on this order (%s after the discount and loyalty credit)', private.qar_text(o.net_payable_minor)) end
      using errcode = '55000';
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
-- 4d. The read functions gain the pricing fields; every key they returned before is still there.
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

  -- The money, kept apart: the gross value, the ordinary discount (and who authorized it), the loyalty credit, the net payable
  -- amount, the cash received and the outstanding balance. The deposit is the one worked out from the gross value.
  result := result || jsonb_build_object(
    'discount_minor', o.discount_minor,
    'loyalty_points_redeemed', o.loyalty_points_redeemed,
    'loyalty_credit_minor', o.loyalty_credit_minor,
    'net_payable_minor', o.net_payable_minor,
    'cash_balance_after_deposit_minor', greatest(o.net_payable_minor - o.deposit_required_minor, 0),
    'discount_record', (select jsonb_build_object('mode', d.mode, 'percent_bps', d.percent_bps, 'amount_minor', d.amount_minor,
                          'base_minor', d.base_minor, 'reason', d.reason, 'authorized_by', sm.display_name, 'authorized_at', d.created_at)
                        from private.order_discounts d left join private.staff_members sm on sm.user_id = d.authorized_by
                        where d.order_id = o.id),
    'redemption_record', (select jsonb_build_object('points', -l.points, 'credit_minor', o.loyalty_credit_minor, 'at', l.created_at,
                            'returned', exists (select 1 from public.loyalty_ledger r where r.reverses_entry_id = l.id and r.entry_type = 'redemption_restore'))
                          from public.loyalty_ledger l where l.order_id = o.id and l.entry_type = 'redemption'));

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
             o.discount_minor, o.loyalty_points_redeemed, o.loyalty_credit_minor, o.net_payable_minor,
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

-- ---------------------------------------------------------------------------------------------------------------
-- 5. admin.create_order with pricing: the order, its discount and its redemption, in ONE transaction.
--    The earlier 7-argument function stays exactly as it was (the live website calls it); this one is called by the website that
--    has the Pricing & Rewards section. It takes the figures the screen showed (net payable and deposit) and refuses to go on if
--    the database now works out something different, so nobody confirms a price they did not see.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.create_order(
  p_customer_id uuid,
  p_items jsonb,
  p_quotation_id uuid,
  p_placed_via text,
  p_delivery_method text,
  p_delivery_address text,
  p_idempotency_key text,
  p_discount jsonb,
  p_redeem_points bigint,
  p_expected_net_minor bigint,
  p_expected_deposit_minor bigint
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
  d jsonb;
  pts bigint := coalesce(p_redeem_points, 0);
  quote jsonb;
  extras jsonb := '{}'::jsonb;
begin
  perform private.require_permission('orders.create');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'items must be a JSON array of 1 to 200 items' using errcode = '22023';
  end if;
  if pts < 0 or pts > 2147483647 then
    raise exception 'points to redeem must be a whole number of points' using errcode = '22023';
  end if;

  -- The permissions come BEFORE the claim and before anything is described, so a repeat can never skip them and a person
  -- without them learns nothing about the customer's points. (Owner only for now.)
  d := private.normalize_discount(p_discount);
  if d is not null then
    perform private.require_permission('orders.discount');
  end if;
  if pts > 0 then
    perform private.require_permission('loyalty.redeem');
  end if;
  if p_quotation_id is not null then
    perform private.require_permission('quotations.manage');
  end if;
  if private.via_gateway() and (p_expected_net_minor is null or p_expected_deposit_minor is null) then
    raise exception 'the amounts shown on the screen must be supplied; reload the page and try again' using errcode = '22023';
  end if;

  -- A retry of an order that was already created returns that order and creates nothing (and spends no points), while it is
  -- recent and the order has not since been cancelled. The fingerprint covers the discount and the points to redeem.
  replay := private.idempotency_claim('order.create', p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id, 'items', p_items, 'quotation_id', p_quotation_id,
      'placed_via', coalesce(p_placed_via, 'admin'), 'delivery_method', p_delivery_method, 'delivery_address', p_delivery_address,
      'discount', d, 'redeem_points', pts,
      'expected_net_minor', p_expected_net_minor, 'expected_deposit_minor', p_expected_deposit_minor),
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

  -- Two orders for one customer cannot spend the same points: whoever gets the lock first spends them, the other then sees the
  -- smaller balance. Taken before the balance is read.
  if pts > 0 then
    perform private.lock_customer_points(p_customer_id);
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
    if coalesce(it ->> 'kind', 'component') = 'discount' then
      raise exception 'item % is a discount line; discounts are entered under Pricing & Rewards, where they are recorded with who authorized them', e.pos
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

  -- All of the money is worked out here, once, from the gross total.
  quote := private.order_pricing_quote(p_customer_id, total, d, pts);
  if p_expected_net_minor is not null and (quote ->> 'net_payable_minor')::bigint <> p_expected_net_minor then
    raise exception 'the amount payable is now % but the screen showed %; nothing was created. Reload the page and check the figures before creating the order',
      private.qar_text((quote ->> 'net_payable_minor')::bigint), private.qar_text(p_expected_net_minor) using errcode = 'M1K03';
  end if;
  if p_expected_deposit_minor is not null and (quote ->> 'deposit_minor')::bigint <> p_expected_deposit_minor then
    raise exception 'the deposit is now % but the screen showed %; nothing was created. Reload the page and check the figures before creating the order',
      private.qar_text((quote ->> 'deposit_minor')::bigint), private.qar_text(p_expected_deposit_minor) using errcode = 'M1K03';
  end if;

  update public.orders
     set total_minor = total,
         deposit_required_minor = (quote ->> 'deposit_minor')::bigint,
         discount_minor = (quote ->> 'discount_minor')::bigint,
         loyalty_points_redeemed = (quote ->> 'points_redeemed')::bigint,
         loyalty_credit_minor = (quote ->> 'credit_minor')::bigint
   where id = new_id;

  if d is not null then
    insert into private.order_discounts (order_id, mode, percent_bps, amount_minor, base_minor, reason, authorized_by)
    values (new_id, d ->> 'mode', (d ->> 'percent_bps')::integer, (quote ->> 'discount_minor')::bigint, total, d ->> 'reason', (select auth.uid()));
    perform private.audit('order.discount_applied', 'order', new_id::text,
      jsonb_build_object('mode', d ->> 'mode', 'percent_bps', (d ->> 'percent_bps')::integer, 'discount_minor', (quote ->> 'discount_minor')::bigint,
                         'gross_minor', total));
    extras := extras || jsonb_build_object('discount_minor', (quote ->> 'discount_minor')::bigint);
  end if;
  if pts > 0 then
    perform private.redeem_points_for_order(new_id, pts, (quote ->> 'credit_minor')::bigint);
    perform private.audit('loyalty.redeemed', 'order', new_id::text,
      jsonb_build_object('points', pts, 'credit_minor', (quote ->> 'credit_minor')::bigint));
    extras := extras || jsonb_build_object('loyalty_points_redeemed', pts, 'loyalty_credit_minor', (quote ->> 'credit_minor')::bigint);
  end if;
  if extras <> '{}'::jsonb then
    extras := extras || jsonb_build_object('net_payable_minor', (quote ->> 'net_payable_minor')::bigint, 'deposit_minor', (quote ->> 'deposit_minor')::bigint);
  end if;

  insert into private.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (new_id, null, 'pending_confirmation', (select auth.uid()), 'order created');

  if p_quotation_id is not null then
    update public.quotations set status = 'converted' where id = p_quotation_id;
  end if;

  perform private.audit('order.created', 'order', new_id::text,
    jsonb_build_object('customer_id', p_customer_id, 'total_minor', total, 'quotation_id', p_quotation_id) || extras);
  perform private.set_write_ctx(false);
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. What the order form needs to show Pricing & Rewards for one customer.
--    The customer's points are shown to a person who may redeem them or read the loyalty ledger, and to nobody else.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.order_pricing_context(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  dep jsonb;
  ver integer;
  can_redeem boolean;
  sees_points boolean;
begin
  perform private.require_permission('orders.create');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  select p.value, p.version into dep, ver from private.business_policies p where p.key = 'orders.deposit';
  can_redeem := private.has_permission('loyalty.redeem');
  sees_points := can_redeem or private.has_permission('loyalty.read');
  return jsonb_build_object(
    'point_value_minor', private.point_value_minor(),
    'earn_qar_per_point_minor', (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::bigint,
    'earning_base', private.policy('loyalty.earning_base') ->> 'base',
    'pricing_enabled', private.rewards_pricing_ready(),
    'can_discount', private.has_permission('orders.discount'),
    'can_redeem', can_redeem,
    'points_balance', case when sees_points then private.loyalty_balance(p_customer_id) end,
    'deposit_policy', dep,
    'deposit_policy_version', ver);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Privileges for the new signatures. (Replaced functions keep theirs.)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint) from public, anon, service_role;
grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint) to authenticated, m1_staff_gateway;
revoke all on function admin.order_pricing_context(uuid) from public, anon, service_role;
grant execute on function admin.order_pricing_context(uuid) to authenticated, m1_staff_gateway;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Self-checks.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text)',
    'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text)',
    'admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)',
    'admin.order_pricing_context(uuid)',
    'private.order_pricing_quote(uuid, bigint, jsonb, bigint)',
    'private.redeem_points_for_order(uuid, bigint, bigint)',
    'private.restore_redeemed_points(uuid, text)'
  ] loop
    if to_regprocedure(f) is null then
      raise exception 'the function % must exist after this migration', f;
    end if;
  end loop;
  if not has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute') then
    raise exception 'the staff gateway must be able to run the new admin.create_order';
  end if;
  if has_function_privilege('anon', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute') then
    raise exception 'anon must not be able to run admin.create_order';
  end if;
end;
$$;
