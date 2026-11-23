-- PLAT-0005, order pricing and rewards, migration 1 of 3: the schema.
--
-- What the owner asked for (see docs/project-memory/architecture/PRICING_AND_REWARDS.md for the whole design):
--   * a discount on an order, entered by the owner, recorded with who authorized it and why;
--   * the customer's loyalty points redeemed against an order as an ORDER CREDIT (1 point = QAR 0.10);
--   * the deposit still worked out from the ORIGINAL gross order total, so a discount or redeemed points never lower it.
--
-- How the money is kept apart (every amount is an integer count of QAR minor units, as everywhere else):
--   orders.total_minor              the GROSS order value: the sum of the item lines. It is NEVER changed by a discount or a
--                                   redemption, and the deposit is taken from it (private.deposit_quote(total_minor)).
--   orders.discount_minor           the ordinary discount (owner only), set once when the order is created.
--   orders.loyalty_points_redeemed  the points spent on this order, set once when the order is created.
--   orders.loyalty_credit_minor     what those points are worth, in QAR minor units, at the point value of that moment.
--   orders.net_payable_minor        generated: total - discount - loyalty credit. What the customer actually has to PAY.
--   orders.amount_paid_minor        cash / Fawran actually received (the payment ledger). A redeemed point is NOT a payment.
--   orders.balance_due_minor        generated: net payable - amount paid. The outstanding balance.
--
-- Forward-only and additive. No existing order, payment, loyalty entry or deposit changes: every existing order gets a
-- discount of 0 and a credit of 0, so its net payable equals its total and its balance is exactly what it was. Rerunnable.
--
-- Compatible with the website that is live today: it never reads or writes the new columns, the functions it calls are
-- untouched by this migration, and for an order with no discount and no credit (every order it can create) the rules are identical.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The order's pricing columns, and the two generated amounts that follow from them.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.orders
  add column if not exists discount_minor bigint not null default 0,
  add column if not exists loyalty_points_redeemed bigint not null default 0,
  add column if not exists loyalty_credit_minor bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_discount_nonneg') then
    alter table public.orders add constraint orders_discount_nonneg check (discount_minor >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_redeemed_nonneg') then
    alter table public.orders add constraint orders_redeemed_nonneg check (loyalty_points_redeemed >= 0 and loyalty_credit_minor >= 0);
  end if;
  -- Points and their money value go together: an order cannot carry one without the other.
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_redeemed_pair') then
    alter table public.orders add constraint orders_redeemed_pair check ((loyalty_points_redeemed = 0) = (loyalty_credit_minor = 0));
  end if;
  -- Discounts and credit can never take more than the order is worth: the net payable is never negative.
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_net_nonneg') then
    alter table public.orders add constraint orders_net_nonneg check (discount_minor + loyalty_credit_minor <= total_minor);
  end if;
end;
$$;

-- balance_due_minor was (total - paid). It becomes (total - discount - credit - paid). A generated column's expression cannot be
-- altered on every supported Postgres version, so the column is dropped and added back, with net_payable_minor beside it. Nothing
-- depends on the column (no view, no index, no constraint); the functions that read it are resolved when they run.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'orders' and column_name = 'net_payable_minor') then
    alter table public.orders drop column balance_due_minor;
    alter table public.orders
      add column net_payable_minor bigint generated always as (total_minor - discount_minor - loyalty_credit_minor) stored,
      add column balance_due_minor bigint generated always as (total_minor - discount_minor - loyalty_credit_minor - amount_paid_minor) stored;
  end if;
end;
$$;

-- Cash received can never exceed what is payable. (It used to be "never exceed the total"; with no discount those are the same.)
alter table public.orders drop constraint if exists orders_paid_within_total;
alter table public.orders add constraint orders_paid_within_total
  check (amount_paid_minor >= 0 and amount_paid_minor <= total_minor - discount_minor - loyalty_credit_minor);

-- A confirmed order's deposit is a CASH amount taken from the gross total. If discounts and credit left less than that to pay,
-- the order would be inconsistent: the deposit cannot be lowered silently and cash cannot be invented. The database refuses the
-- state itself, whatever function tries to produce it. (Every existing order passes: its net payable equals its total.)
alter table public.orders drop constraint if exists orders_confirmed_deposit_within_net;
alter table public.orders add constraint orders_confirmed_deposit_within_net
  check (deposit_fixed_at is null or deposit_required_minor <= total_minor - discount_minor - loyalty_credit_minor);

comment on column public.orders.total_minor is 'The GROSS order value (the sum of the item lines). Never reduced by a discount or a redemption; the deposit is taken from it.';
comment on column public.orders.discount_minor is 'The ordinary discount, in QAR minor units. Owner only. Set once, when the order is created (details in private.order_discounts).';
comment on column public.orders.loyalty_points_redeemed is 'Loyalty points spent on this order. An order credit, not a payment. Set once, when the order is created.';
comment on column public.orders.loyalty_credit_minor is 'What the redeemed points are worth, in QAR minor units. An order credit, not a payment.';
comment on column public.orders.net_payable_minor is 'Generated: total - discount - loyalty credit. What the customer has to pay in cash or Fawran.';
comment on column public.orders.balance_due_minor is 'Generated: net payable - amount paid. The outstanding balance.';

-- The discount and the redemption are set ONCE, in the very transaction that creates the order (the order is inserted, priced and given
-- its discount in one function call), and never again. After that this trigger refuses any change to them, and to the total of an
-- order that carries one, so a screen, a script or a later function can never silently alter what an order was sold for.
create or replace function private.guard_order_pricing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.discount_minor, new.loyalty_points_redeemed, new.loyalty_credit_minor)
       is distinct from (old.discount_minor, old.loyalty_points_redeemed, old.loyalty_credit_minor)
     and old.created_at is distinct from now() then
    raise exception 'the discount and the redeemed points of an order can only be set when the order is created'
      using errcode = '55000';
  end if;
  if (old.discount_minor <> 0 or old.loyalty_points_redeemed <> 0 or old.loyalty_credit_minor <> 0)
     and new.total_minor is distinct from old.total_minor then
    raise exception 'the total of an order that carries a discount or redeemed points cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_pricing() from public;
drop trigger if exists orders_guard_pricing on public.orders;
create trigger orders_guard_pricing before update on public.orders
  for each row execute function private.guard_order_pricing();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Who authorized a discount, and why. One row per discounted order, written with the order, never changed or deleted.
--    Private: the customer sees the amount (on the order) but not this record.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists private.order_discounts (
  order_id uuid primary key references public.orders (id) on delete restrict,
  mode text not null check (mode in ('fixed', 'percent')),
  percent_bps integer check (percent_bps is null or percent_bps between 1 and 10000),
  amount_minor bigint not null check (amount_minor > 0),
  -- The gross order value the percentage (or the cap) was measured against, kept so the figure can be re-derived later.
  base_minor bigint not null check (base_minor > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  authorized_by uuid not null,
  created_at timestamptz not null default now(),
  constraint order_discounts_percent_pair check ((mode = 'percent') = (percent_bps is not null)),
  constraint order_discounts_within_base check (amount_minor <= base_minor)
);
alter table private.order_discounts enable row level security;
revoke all on table private.order_discounts from anon, authenticated, service_role;
drop trigger if exists order_discounts_insert_guard on private.order_discounts;
create trigger order_discounts_insert_guard before insert on private.order_discounts
  for each row execute function private.require_write_ctx();
drop trigger if exists order_discounts_append_only on private.order_discounts;
create trigger order_discounts_append_only before update or delete on private.order_discounts
  for each row execute function private.forbid_mutation();
drop trigger if exists order_discounts_no_truncate on private.order_discounts;
create trigger order_discounts_no_truncate before truncate on private.order_discounts
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The loyalty ledger learns to spend points, and to give them back. Still append-only: nothing is edited or deleted;
--    a cancellation writes a NEW compensating entry that points at the redemption it returns.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_entry_type_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_entry_type_check
  check (entry_type in ('award', 'reversal', 'adjustment', 'redemption', 'redemption_restore'));

alter table public.loyalty_ledger drop constraint if exists loyalty_sign;
alter table public.loyalty_ledger add constraint loyalty_sign check (
  (entry_type = 'award' and points > 0)
  or (entry_type = 'reversal' and points < 0)
  or (entry_type = 'redemption' and points < 0)
  or (entry_type = 'redemption_restore' and points > 0)
  or entry_type = 'adjustment');

alter table public.loyalty_ledger drop constraint if exists loyalty_award_has_order;
alter table public.loyalty_ledger add constraint loyalty_award_has_order
  check (entry_type not in ('award', 'redemption', 'redemption_restore') or order_id is not null);

alter table public.loyalty_ledger drop constraint if exists loyalty_reversal_link;
alter table public.loyalty_ledger add constraint loyalty_reversal_link
  check ((entry_type in ('reversal', 'redemption_restore')) = (reverses_entry_id is not null));

-- One redemption per order (the whole redemption is one entry), and one restoration per redemption: the database itself
-- refuses a duplicate, whatever the code above it does.
create unique index if not exists loyalty_one_redemption_per_order on public.loyalty_ledger (order_id)
  where entry_type = 'redemption';
create unique index if not exists loyalty_one_restore_per_redemption on public.loyalty_ledger (reverses_entry_id)
  where entry_type = 'redemption_restore';

-- Two sessions spending the same customer's points at the same moment must not both succeed. Every entry that takes points
-- away takes the same per-customer lock first and checks the balance AFTER getting it, so the second session sees the first
-- one's committed entry. A redemption can never take the balance below zero, whatever the negative-balance policy says (you
-- cannot spend what you do not have); the other negative entries keep the policy rule they always had.
create or replace function private.loyalty_ledger_balance_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.points < 0 and new.entry_type <> 'award' then -- an award with negative points is refused by the table's own CHECK
    perform pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || new.customer_id::text, 0));
    if (new.entry_type = 'redemption' or not private.negative_balance_allowed())
       and private.loyalty_balance(new.customer_id) + new.points < 0 then
      raise exception 'not enough loyalty points: this entry would take the balance below zero' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.loyalty_ledger_balance_guard() from public;
drop trigger if exists loyalty_ledger_balance_guard on public.loyalty_ledger;
create trigger loyalty_ledger_balance_guard before insert on public.loyalty_ledger
  for each row execute function private.loyalty_ledger_balance_guard();

-- The same lock, for the functions that read the balance before they decide (so their own check is not stale).
create or replace function private.lock_customer_points(p_customer_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$ select pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || p_customer_id::text, 0)) $$;
revoke all on function private.lock_customer_points(uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Two new permissions, owner only. Staff keep exactly what they had.
-- ---------------------------------------------------------------------------------------------------------------
insert into private.permissions (code, description) values
  ('orders.discount', 'Apply a discount to a new order (owner only for now)'),
  ('loyalty.redeem', 'Redeem a customer''s loyalty points against a new order (owner only for now)')
on conflict (code) do nothing;
insert into private.role_permissions (role_code, permission_code) values
  ('owner', 'orders.discount'), ('owner', 'loyalty.redeem')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The policy validator learns one new value: loyalty points can be earned on the NET payable amount.
--    (The previous definition, plus 'net_payable'. Nothing else changes.)
-- ---------------------------------------------------------------------------------------------------------------
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
      if coalesce(p_value ->> 'base', '') not in ('order_total', 'amount_paid', 'net_payable') then
        return 'base must be order_total, amount_paid or net_payable';
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

    when 'orders.workflow' then
      if (p_value - 'default_version') <> '{}'::jsonb then
        return 'orders.workflow allows only default_version';
      end if;
      if jsonb_typeof(p_value -> 'default_version') is distinct from 'number'
         or (p_value ->> 'default_version') not in ('1', '2') then
        return 'default_version must be 1 (the earlier workflow) or 2 (the owner-defined workflow)';
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Self-checks: a mistake here fails the migration (one transaction, so nothing is left half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  bad bigint;
begin
  -- nothing existing moved: every order has no discount and no credit, so its net payable is its total
  select count(*) into bad from public.orders
  where discount_minor <> 0 or loyalty_credit_minor <> 0 or loyalty_points_redeemed <> 0
     or net_payable_minor is distinct from total_minor
     or balance_due_minor is distinct from total_minor - amount_paid_minor;
  if bad > 0 then
    raise exception '% existing order(s) changed in value; this migration must not change any existing order', bad;
  end if;
  if not exists (select 1 from private.role_permissions where role_code = 'owner' and permission_code = 'orders.discount')
     or not exists (select 1 from private.role_permissions where role_code = 'owner' and permission_code = 'loyalty.redeem') then
    raise exception 'the owner must hold the two new permissions';
  end if;
  if exists (select 1 from private.role_permissions where role_code <> 'owner' and permission_code in ('orders.discount', 'loyalty.redeem')) then
    raise exception 'only the owner may hold the discount and redemption permissions';
  end if;
  if private.policy_error('loyalty.earning_base', '{"base": "net_payable", "rounding": "floor"}') is not null then
    raise exception 'the earning base net_payable must be accepted';
  end if;
end;
$$;
