-- PLAT-0006, order costs, completion dates and financial reporting, migration 1 of 2: the schema.
--
-- What the owner asked for (design and exact definitions: docs/project-memory/architecture/FINANCIAL_REPORTING.md):
--   * private, editable DIRECT COSTS of an order: many entries, estimated or actual, added or corrected at any stage, with an
--     immutable revision history (who, when, old value, new value, why);
--   * a reliable COMPLETION date (completed_at), recorded by the database the first time an order reaches Delivered / Collected, in
--     either workflow, and the date financial reports are grouped by (Asia/Qatar months), never the creation date;
--   * a clear "costs complete / incomplete" indicator, so a profit is never presented as verified when costs are missing.
--
-- How the money stays honest:
--   orders.total_minor / discount_minor / loyalty_credit_minor are untouched. The revenue of a completed order is a SNAPSHOT of
--   (gross - discount - loyalty credit) taken in the same transaction that completes it (private.order_completions), written once
--   and never changed. Costs are the only part that stays editable, and every change to them is a new immutable revision.
--   Cash and Fawran received stay in the payment ledger with their own dates; nothing here counts a deposit as revenue.
--
-- Forward-only and additive: no existing order, payment, loyalty entry, deposit, status or function changes. Rerunnable.
-- Customers can never read any of it: every new table is in schema private with row level security on and no API privilege;
-- the single new column on public.orders (completed_at) is a date the customer may see, nothing financial.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. One new permission, owner only. (finance.read and finance.manage already exist and are held by the owner only.)
-- ---------------------------------------------------------------------------------------------------------------
insert into private.permissions (code, description) values
  ('finance.verify', 'Confirm the completion date of an order that was delivered before completion dates were recorded (owner only for now)')
on conflict (code) do nothing;
insert into private.role_permissions (role_code, permission_code) values ('owner', 'finance.verify') on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The completion date, and the immutable record that proves where it came from.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.orders add column if not exists completed_at timestamptz;
create index if not exists orders_completed_at_idx on public.orders (completed_at) where completed_at is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_completed_is_delivered') then
    alter table public.orders add constraint orders_completed_is_delivered check (completed_at is null or status = 'delivered');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_completed_after_created') then
    alter table public.orders add constraint orders_completed_after_created check (completed_at is null or completed_at >= created_at);
  end if;
end;
$$;
comment on column public.orders.completed_at is 'When the order FIRST reached Delivered / Collected (set by the database, never typed in). NULL on a delivered order means the date is not proven and needs historical verification.';

create table if not exists private.order_completions (
  order_id uuid primary key references public.orders (id) on delete restrict,
  completed_at timestamptz not null,
  -- transition: recorded by the database at the moment of the move. status_history: copied from the status history, which
  -- records the exact transition time. owner_verified: confirmed by the owner for an order the history cannot prove.
  basis text not null check (basis in ('transition', 'status_history', 'owner_verified')),
  history_id bigint references private.order_status_history (id) on delete restrict,
  -- The revenue snapshot. The order's own money cannot change after this (the pricing guards), and this row cannot change at all.
  gross_minor bigint not null check (gross_minor >= 0),
  discount_minor bigint not null check (discount_minor >= 0),
  loyalty_credit_minor bigint not null check (loyalty_credit_minor >= 0),
  net_revenue_minor bigint not null check (net_revenue_minor >= 0),
  recorded_by uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  recorded_at timestamptz not null default now(),
  constraint order_completions_net_is_gross_less_reductions check (net_revenue_minor = gross_minor - discount_minor - loyalty_credit_minor),
  constraint order_completions_owner_verified_has_reason check (basis <> 'owner_verified' or (reason is not null and char_length(btrim(reason)) >= 3))
);
alter table private.order_completions enable row level security;
revoke all on table private.order_completions from anon, authenticated, service_role;
create index if not exists order_completions_completed_at_idx on private.order_completions (completed_at);
create or replace trigger order_completions_insert_guard before insert on private.order_completions
  for each row execute function private.require_write_ctx();
create or replace trigger order_completions_append_only before update or delete on private.order_completions
  for each row execute function private.forbid_mutation();
create or replace trigger order_completions_no_truncate before truncate on private.order_completions
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The trigger that makes completed_at reliable.
--    * First arrival at 'delivered' (any workflow, any path that updates the status) sets completed_at = now() and writes the
--      completion record, in the same transaction as the move.
--    * completed_at is never typed in, never changed, never cleared. The one exception is the owner-only verification of an
--      order whose date could not be proven: the verifying function names that order in a transaction-local setting.
--    * A completed order cannot change status: Delivered / Collected is final, so recognised revenue cannot be erased by a move.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_order_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.completed_at is not null then
      raise exception 'an order cannot be created already completed' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.completed_at is distinct from old.completed_at then
    if old.completed_at is not null then
      raise exception 'the completion date of an order never changes' using errcode = '55000';
    end if;
    -- Setting it for the first time is allowed only for the order the verification function named, and only on a delivered order.
    if current_setting('m1.completion_verify', true) is distinct from new.id::text or new.status <> 'delivered' then
      raise exception 'the completion date is recorded by the system when an order is delivered; it cannot be typed in' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.completed_at is not null and new.status is distinct from old.status then
    raise exception 'a completed order cannot change status; Delivered / Collected is final' using errcode = '55000';
  end if;

  if new.status = 'delivered' and old.status is distinct from 'delivered' and old.completed_at is null then
    new.completed_at := now();
    insert into private.order_completions (order_id, completed_at, basis, history_id, gross_minor, discount_minor, loyalty_credit_minor,
                                           net_revenue_minor, recorded_by, reason)
    values (new.id, new.completed_at, 'transition', null, new.total_minor, new.discount_minor, new.loyalty_credit_minor,
            new.total_minor - new.discount_minor - new.loyalty_credit_minor, (select auth.uid()), null);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_completion() from public;
create or replace trigger orders_completion before insert or update on public.orders
  for each row execute function private.guard_order_completion();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Direct order costs: many entries per order, estimated or actual, private to the owner.
--    An entry is never deleted: a wrong or unwanted one is VOIDED (it stays, visibly, in the history).
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists private.order_costs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  category text not null check (category in ('components', 'international_shipping', 'customs_duties', 'assembly', 'local_delivery', 'payment_processing', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  -- Integer QAR minor units. Zero is allowed (an explicit "no cost" entry); a missing cost is NOT an entry, so it is never counted as zero.
  amount_minor bigint not null check (amount_minor >= 0 and amount_minor <= 100000000000),
  cost_kind text not null check (cost_kind in ('estimated', 'actual')),
  supplier_ref text check (supplier_ref is null or char_length(btrim(supplier_ref)) between 1 and 120),
  incurred_on date not null check (incurred_on between date '2020-01-01' and date '2100-01-01'),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active', 'voided')),
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.order_costs enable row level security;
revoke all on table private.order_costs from anon, authenticated, service_role;
create index if not exists order_costs_order_idx on private.order_costs (order_id) where status = 'active';
create or replace trigger order_costs_write_guard before insert or update or delete on private.order_costs
  for each row execute function private.require_write_ctx();
create or replace trigger order_costs_touch before update on private.order_costs
  for each row execute function private.touch_updated_at();
create or replace trigger order_costs_no_truncate before truncate on private.order_costs
  for each statement execute function private.forbid_mutation();

create or replace function private.guard_order_cost_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a cost entry is never deleted; void it with a reason instead' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'a cost entry cannot be moved to another order or have its origin changed' using errcode = '55000';
  end if;
  if old.status = 'voided' and new is distinct from old then
    raise exception 'a voided cost entry cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_cost_identity() from public;
create or replace trigger order_costs_identity before update or delete on private.order_costs
  for each row execute function private.guard_order_cost_identity();

-- Every creation, correction, void and "costs complete" decision, in full, forever. Nothing here is ever edited or deleted.
create table if not exists private.order_cost_revisions (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  cost_id uuid references private.order_costs (id) on delete restrict,
  action text not null check (action in ('created', 'edited', 'voided', 'marked_complete', 'marked_incomplete')),
  revision integer check (revision is null or revision >= 1),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 500),
  actor uuid,
  created_at timestamptz not null default now(),
  constraint order_cost_revisions_entry_shape check ((action in ('marked_complete', 'marked_incomplete')) = (cost_id is null)),
  constraint order_cost_revisions_edit_has_reason check (action not in ('edited', 'voided') or (reason is not null and char_length(btrim(reason)) >= 3))
);
alter table private.order_cost_revisions enable row level security;
revoke all on table private.order_cost_revisions from anon, authenticated, service_role;
create index if not exists order_cost_revisions_order_idx on private.order_cost_revisions (order_id, id);
create or replace trigger order_cost_revisions_insert_guard before insert on private.order_cost_revisions
  for each row execute function private.require_write_ctx();
create or replace trigger order_cost_revisions_append_only before update or delete on private.order_cost_revisions
  for each row execute function private.forbid_mutation();
create or replace trigger order_cost_revisions_no_truncate before truncate on private.order_cost_revisions
  for each statement execute function private.forbid_mutation();

-- Whether the owner has declared the costs of an order complete. The declaration is cleared automatically by any later change to the
-- entries, so "complete" always means "the entries as they are now were declared complete".
create table if not exists private.order_cost_state (
  order_id uuid primary key references public.orders (id) on delete restrict,
  costs_complete boolean not null default false,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table private.order_cost_state enable row level security;
revoke all on table private.order_cost_state from anon, authenticated, service_role;
create or replace trigger order_cost_state_write_guard before insert or update or delete on private.order_cost_state
  for each row execute function private.require_write_ctx();
create or replace trigger order_cost_state_no_truncate before truncate on private.order_cost_state
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Backfill: an order that is ALREADY delivered gets a completion date only when the status history proves the exact moment
--    (the first recorded move into Delivered, from a different status). Any other delivered order is left with no date, which
--    is how it is flagged "needs historical verification". No date is ever invented.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  proved integer := 0;
  unproved integer;
begin
  perform private.set_write_ctx(true);
  for r in
    select o.id, o.total_minor, o.discount_minor, o.loyalty_credit_minor, h.id as history_id, h.changed_at
    from public.orders o
    join lateral (
      select x.id, x.changed_at from private.order_status_history x
      where x.order_id = o.id and x.to_status = 'delivered' and x.from_status is not null and x.from_status is distinct from x.to_status
        and x.changed_at >= o.created_at
      order by x.id limit 1
    ) h on true
    where o.status = 'delivered' and o.completed_at is null
  loop
    insert into private.order_completions (order_id, completed_at, basis, history_id, gross_minor, discount_minor, loyalty_credit_minor,
                                           net_revenue_minor, recorded_by, reason)
    values (r.id, r.changed_at, 'status_history', r.history_id, r.total_minor, r.discount_minor, r.loyalty_credit_minor,
            r.total_minor - r.discount_minor - r.loyalty_credit_minor, null,
            'copied from the recorded status history when completion dates were introduced');
    perform set_config('m1.completion_verify', r.id::text, true);
    update public.orders set completed_at = r.changed_at where id = r.id;
    proved := proved + 1;
  end loop;
  perform set_config('m1.completion_verify', '', true);
  perform private.set_write_ctx(false);
  select count(*) into unproved from public.orders where status = 'delivered' and completed_at is null;
  raise notice 'completion dates: % proved from the status history, % delivered order(s) need historical verification', proved, unproved;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Self-checks: a mistake here fails the migration (one transaction, so nothing is left half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  bad bigint;
  t text;
begin
  select count(*) into bad from public.orders o
   where (o.completed_at is not null) is distinct from exists (select 1 from private.order_completions c where c.order_id = o.id);
  if bad > 0 then
    raise exception '% order(s) disagree with their completion record', bad;
  end if;
  select count(*) into bad from public.orders o join private.order_completions c on c.order_id = o.id where c.completed_at is distinct from o.completed_at;
  if bad > 0 then
    raise exception '% completion record(s) carry a different date from their order', bad;
  end if;
  if exists (select 1 from private.role_permissions where role_code <> 'owner' and permission_code in ('finance.read', 'finance.manage', 'finance.verify')) then
    raise exception 'the finance permissions are owner-only';
  end if;
  foreach t in array array['private.order_completions', 'private.order_costs', 'private.order_cost_revisions', 'private.order_cost_state'] loop
    if has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_any_column_privilege('authenticated', t, 'select,insert,update,references')
       or has_any_column_privilege('service_role', t, 'select,insert,update,references') then
      raise exception '% is reachable by an API role', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception '% must have row level security', t;
    end if;
  end loop;
end;
$$;
