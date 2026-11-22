-- PLAT-0004, order workflow v2, migration 1 of 2: the owner-defined order workflow, as DATA and SCHEMA only.
--
-- WHAT THIS IS. The owner has defined the order workflow (replacing the provisional vocabulary of 20261118120400):
--
--   Order received -> Awaiting deposit -> Deposit confirmed -> Order confirmed -> Live tracking
--     -> Order arrived in Qatar -> Carrier delivering order to M1
--        then, by FULFILMENT TYPE:
--          custom_pc_build:  M1 is building your PC -> Final quality checks -> Ready for delivery or pickup
--          parts_only:       Items arrived at M1 -> Awaiting scheduling for pickup or delivery -> Ready for delivery or pickup
--     -> Delivered / Collected            (On hold and Cancelled stay as exceptional states)
--
-- Live tracking is ONE main status. Staff publish the shipment's progress as nested updates inside it, and only while the
-- order is in that status; afterwards the history stays readable and a new entry needs a deliberate, owner-only correction.
--
-- HOW IT STAYS SAFE FOR WHAT IS ALREADY RUNNING (expand step of an expand / contract release).
--   * Every existing order keeps `workflow_version = 1`: its status, its history, its payments, its receipts, its tracking
--     updates and its loyalty entries are not touched, and it keeps moving through the version-1 transition table
--     (private.order_status_transitions) exactly as before. Nothing is deleted, renamed or re-coded.
--   * New orders take their version from the policy `orders.workflow` (default_version). It ships as 1, so the website that
--     is deployed today keeps creating version-1 orders until the owner switches it to 2 AFTER the website that understands
--     version 2 is live. Switching back is the same one-line policy change. The version of an order only ever moves 1 -> 2.
--   * No status code is removed or renamed. `sourcing` and `in_transit` stay valid (version 1 only). `deposit_received`,
--     `building`, `quality_check`, `ready_for_delivery` and `delivered` keep their codes and get the owner's wording.
--   * Existing functions keep their signatures; migration 2 only extends what they return.
--
-- RULES FOR THIS FILE: forward-only, no drop, no delete, no truncate, every new table has row level security, and it is
-- rerunnable (applying it twice changes nothing).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The statuses. Reference data: wording and order are the owner's; the codes of version 1 are kept.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.order_statuses (code, sort_order, customer_label, customer_description, is_terminal, is_provisional) values
  ('order_confirmed', 32, 'Order confirmed', 'Your order is confirmed. We are arranging its shipment.', false, false),
  ('live_tracking', 34, 'Live tracking', 'Your order is on its way. Follow each update from our team below.', false, false),
  ('arrived_in_qatar', 36, 'Order arrived in Qatar', 'Your order has arrived in Qatar.', false, false),
  ('carrier_delivering', 38, 'Carrier delivering order to M1', 'The carrier is delivering your order to M1.', false, false),
  ('items_arrived', 62, 'Items arrived at M1', 'Your items have arrived at M1.', false, false),
  ('awaiting_scheduling', 64, 'Awaiting scheduling for pickup or delivery', 'Your items are at M1. We will contact you to schedule pickup or delivery.', false, false)
on conflict (code) do nothing;

update public.order_statuses s
   set customer_label = v.label, customer_description = v.description, is_provisional = false
  from (values
    ('pending_confirmation', 'Order received', 'We have received your order and are confirming the details with you.'),
    ('awaiting_deposit', 'Awaiting deposit', 'We are waiting for your deposit before we begin.'),
    ('deposit_received', 'Deposit confirmed', 'We have received and verified your deposit.'),
    ('building', 'M1 is building your PC', 'M1 is building your PC.'),
    ('quality_check', 'Final quality checks', 'We are running the final quality checks on your PC.'),
    ('ready_for_delivery', 'Ready for delivery or pickup', 'Your order is ready. We will confirm delivery or pickup with you.'),
    ('delivered', 'Delivered / Collected', 'Your order has been delivered or collected.'),
    ('on_hold', 'On hold', 'Your order is on hold. We will contact you.'),
    ('cancelled', 'Cancelled', 'This order has been cancelled.')
  ) as v (code, label, description)
 where s.code = v.code;
-- `sourcing` and `in_transit` are unchanged and stay flagged provisional: they exist only for orders of workflow version 1.

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Orders: which workflow an order follows, and what kind of order it is.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.orders
  add column if not exists workflow_version smallint not null default 1;
alter table public.orders
  add column if not exists fulfillment_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_workflow_version_check') then
    alter table public.orders add constraint orders_workflow_version_check check (workflow_version in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_fulfillment_type_check') then
    -- Chosen explicitly by staff. NULL means "not chosen yet" (every existing order); it is never inferred from free text.
    alter table public.orders add constraint orders_fulfillment_type_check
      check (fulfillment_type is null or fulfillment_type in ('custom_pc_build', 'parts_only'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_branch_consistent') then
    -- A version-2 order can only sit in a fulfilment-specific status if its type was chosen and matches that status.
    alter table public.orders add constraint orders_branch_consistent check (
      workflow_version = 1
      or status not in ('building', 'quality_check', 'items_arrived', 'awaiting_scheduling')
      -- (IS NOT DISTINCT FROM, so a missing type is a violation: a plain = would give NULL, and a CHECK accepts NULL)
      or (status in ('building', 'quality_check') and fulfillment_type is not distinct from 'custom_pc_build')
      or (status in ('items_arrived', 'awaiting_scheduling') and fulfillment_type is not distinct from 'parts_only'));
  end if;
end;
$$;

-- The version a NEW order gets. Reads the policy `orders.workflow` (added below); 1 if it is missing. Existing rows are not
-- affected: they were given the constant 1 above, and only future inserts evaluate this default.
create or replace function private.default_workflow_version()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(((select value ->> 'default_version' from private.business_policies where key = 'orders.workflow'))::smallint, 1::smallint)
$$;
revoke all on function private.default_workflow_version() from public;

alter table public.orders alter column workflow_version set default private.default_workflow_version();

-- The workflow of an order moves only 1 -> 2, and the type cannot be changed once the order is inside its branch.
create or replace function private.guard_workflow_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workflow_version is distinct from old.workflow_version and not (old.workflow_version = 1 and new.workflow_version = 2) then
    raise exception 'the workflow of an order can only move from version 1 to version 2' using errcode = '55000';
  end if;
  if old.fulfillment_type is not null and new.fulfillment_type is distinct from old.fulfillment_type
     and old.status in ('building', 'quality_check', 'items_arrived', 'awaiting_scheduling', 'ready_for_delivery', 'delivered') then
    raise exception 'the fulfilment type cannot change once the order has entered its branch' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_workflow_columns() from public;
create or replace trigger orders_guard_workflow before update on public.orders
  for each row execute function private.guard_workflow_columns();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The stages each workflow shows (what the timeline is drawn from) and the moves version 2 allows.
--    Customers read the stages (they are not secret and the customer tracker draws the same timeline staff see);
--    the moves are staff-only.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.order_workflow_stages (
  workflow_version smallint not null check (workflow_version in (1, 2)),
  -- 'any' stages are shared; the other two are drawn only for an order of that fulfilment type.
  branch text not null default 'any' check (branch in ('any', 'custom_pc_build', 'parts_only')),
  position smallint not null check (position > 0),
  status_code text not null references public.order_statuses (code),
  -- The stage that owns the nested, expandable shipment updates.
  shows_tracking boolean not null default false,
  primary key (workflow_version, branch, position),
  unique (workflow_version, branch, status_code)
);
alter table public.order_workflow_stages enable row level security;
revoke all on table public.order_workflow_stages from anon, authenticated, service_role;
grant select on public.order_workflow_stages to authenticated, service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_workflow_stages' and policyname = 'order_workflow_stages_read') then
    create policy order_workflow_stages_read on public.order_workflow_stages for select to authenticated using (true);
  end if;
end;
$$;

insert into public.order_workflow_stages (workflow_version, branch, position, status_code, shows_tracking) values
  -- Version 1: the provisional path, exactly as it was.
  (1, 'any', 1, 'pending_confirmation', false), (1, 'any', 2, 'awaiting_deposit', false), (1, 'any', 3, 'deposit_received', false),
  (1, 'any', 4, 'sourcing', false), (1, 'any', 5, 'in_transit', false), (1, 'any', 6, 'building', false),
  (1, 'any', 7, 'quality_check', false), (1, 'any', 8, 'ready_for_delivery', false), (1, 'any', 9, 'delivered', false),
  -- Version 2: the owner-defined workflow.
  (2, 'any', 10, 'pending_confirmation', false), (2, 'any', 20, 'awaiting_deposit', false), (2, 'any', 30, 'deposit_received', false),
  (2, 'any', 40, 'order_confirmed', false), (2, 'any', 50, 'live_tracking', true), (2, 'any', 60, 'arrived_in_qatar', false),
  (2, 'any', 70, 'carrier_delivering', false), (2, 'any', 100, 'ready_for_delivery', false), (2, 'any', 110, 'delivered', false),
  (2, 'custom_pc_build', 80, 'building', false), (2, 'custom_pc_build', 90, 'quality_check', false),
  (2, 'parts_only', 80, 'items_arrived', false), (2, 'parts_only', 90, 'awaiting_scheduling', false)
on conflict do nothing;

create table if not exists private.order_workflow_transitions (
  workflow_version smallint not null check (workflow_version in (1, 2)),
  from_code text not null references public.order_statuses (code),
  to_code text not null references public.order_statuses (code),
  -- 'any', or the one fulfilment type this move belongs to.
  branch text not null default 'any' check (branch in ('any', 'custom_pc_build', 'parts_only')),
  requires_permission text not null default 'orders.transition' references private.permissions (code),
  primary key (workflow_version, from_code, to_code, branch),
  check (from_code <> to_code)
);
alter table private.order_workflow_transitions enable row level security;
revoke all on table private.order_workflow_transitions from anon, authenticated, service_role;

insert into private.order_workflow_transitions (workflow_version, from_code, to_code, branch) values
  (2, 'pending_confirmation', 'awaiting_deposit', 'any'),
  (2, 'awaiting_deposit', 'deposit_received', 'any'),
  (2, 'deposit_received', 'order_confirmed', 'any'),
  (2, 'order_confirmed', 'live_tracking', 'any'),
  (2, 'live_tracking', 'arrived_in_qatar', 'any'),
  (2, 'arrived_in_qatar', 'carrier_delivering', 'any'),
  (2, 'carrier_delivering', 'building', 'custom_pc_build'),
  (2, 'building', 'quality_check', 'custom_pc_build'),
  (2, 'quality_check', 'ready_for_delivery', 'custom_pc_build'),
  (2, 'quality_check', 'building', 'custom_pc_build'),          -- rework after a failed check (as in version 1)
  (2, 'carrier_delivering', 'items_arrived', 'parts_only'),
  (2, 'items_arrived', 'awaiting_scheduling', 'parts_only'),
  (2, 'awaiting_scheduling', 'ready_for_delivery', 'parts_only'),
  (2, 'ready_for_delivery', 'delivered', 'any'),
  -- Exceptional states. Hold is available from the deposit stage until the order is ready; cancel until it is delivered.
  (2, 'awaiting_deposit', 'on_hold', 'any'), (2, 'deposit_received', 'on_hold', 'any'), (2, 'order_confirmed', 'on_hold', 'any'),
  (2, 'live_tracking', 'on_hold', 'any'), (2, 'arrived_in_qatar', 'on_hold', 'any'), (2, 'carrier_delivering', 'on_hold', 'any'),
  (2, 'building', 'on_hold', 'any'), (2, 'quality_check', 'on_hold', 'any'), (2, 'items_arrived', 'on_hold', 'any'),
  (2, 'awaiting_scheduling', 'on_hold', 'any'), (2, 'ready_for_delivery', 'on_hold', 'any'),
  (2, 'pending_confirmation', 'cancelled', 'any'), (2, 'awaiting_deposit', 'cancelled', 'any'), (2, 'deposit_received', 'cancelled', 'any'),
  (2, 'order_confirmed', 'cancelled', 'any'), (2, 'live_tracking', 'cancelled', 'any'), (2, 'arrived_in_qatar', 'cancelled', 'any'),
  (2, 'carrier_delivering', 'cancelled', 'any'), (2, 'building', 'cancelled', 'any'), (2, 'quality_check', 'cancelled', 'any'),
  (2, 'items_arrived', 'cancelled', 'any'), (2, 'awaiting_scheduling', 'cancelled', 'any'), (2, 'ready_for_delivery', 'cancelled', 'any'),
  -- A held order can only resume at the status it was held from, or be cancelled (enforced by admin.transition_order).
  (2, 'on_hold', 'awaiting_deposit', 'any'), (2, 'on_hold', 'deposit_received', 'any'), (2, 'on_hold', 'order_confirmed', 'any'),
  (2, 'on_hold', 'live_tracking', 'any'), (2, 'on_hold', 'arrived_in_qatar', 'any'), (2, 'on_hold', 'carrier_delivering', 'any'),
  (2, 'on_hold', 'building', 'any'), (2, 'on_hold', 'quality_check', 'any'), (2, 'on_hold', 'items_arrived', 'any'),
  (2, 'on_hold', 'awaiting_scheduling', 'any'), (2, 'on_hold', 'ready_for_delivery', 'any'), (2, 'on_hold', 'cancelled', 'any')
on conflict do nothing;

-- How an existing (version 1) order is placed on the new workflow, one order at a time, by the owner (admin.adopt_new_workflow).
-- Data, so the mapping is reviewable. `requires_fulfillment` says which type that target implies.
create table if not exists private.workflow_adoption_map (
  legacy_status text not null references public.order_statuses (code),
  target_status text not null references public.order_statuses (code),
  is_default boolean not null default false,
  requires_fulfillment text check (requires_fulfillment is null or requires_fulfillment in ('custom_pc_build', 'parts_only')),
  primary key (legacy_status, target_status)
);
alter table private.workflow_adoption_map enable row level security;
revoke all on table private.workflow_adoption_map from anon, authenticated, service_role;

insert into private.workflow_adoption_map (legacy_status, target_status, is_default, requires_fulfillment) values
  ('pending_confirmation', 'pending_confirmation', true, null),
  ('awaiting_deposit', 'awaiting_deposit', true, null),
  ('deposit_received', 'deposit_received', true, null),
  ('sourcing', 'order_confirmed', true, null),
  ('in_transit', 'live_tracking', true, null),
  ('in_transit', 'arrived_in_qatar', false, null),
  ('in_transit', 'carrier_delivering', false, null),
  ('building', 'building', true, 'custom_pc_build'),
  ('building', 'items_arrived', false, 'parts_only'),
  ('quality_check', 'quality_check', true, 'custom_pc_build'),
  ('ready_for_delivery', 'ready_for_delivery', true, null),
  ('delivered', 'delivered', true, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Tracking updates: where the shipment is, when it happened, and the correction trail.
--    The table stays append-only; these are new nullable / defaulted columns, so no existing row changes.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.order_tracking_events add column if not exists location text;
alter table public.order_tracking_events add column if not exists occurred_at timestamptz;
alter table public.order_tracking_events add column if not exists event_kind text not null default 'update';
alter table public.order_tracking_events add column if not exists corrects_event_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.order_tracking_events'::regclass and conname = 'order_tracking_events_location_check') then
    alter table public.order_tracking_events add constraint order_tracking_events_location_check
      check (location is null or char_length(btrim(location)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.order_tracking_events'::regclass and conname = 'order_tracking_events_kind_check') then
    alter table public.order_tracking_events add constraint order_tracking_events_kind_check
      check (event_kind in ('update', 'correction'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.order_tracking_events'::regclass and conname = 'order_tracking_events_corrects_fkey') then
    alter table public.order_tracking_events add constraint order_tracking_events_corrects_fkey
      foreign key (corrects_event_id) references public.order_tracking_events (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.order_tracking_events'::regclass and conname = 'order_tracking_events_correction_shape') then
    -- Only a correction may point at another update.
    alter table public.order_tracking_events add constraint order_tracking_events_correction_shape
      check (corrects_event_id is null or event_kind = 'correction');
  end if;
end;
$$;

-- Why a correction was made and by whom. Append-only, staff only (the customer sees the correction itself, not the reason).
create table if not exists private.tracking_event_corrections (
  event_id uuid primary key references public.order_tracking_events (id) on delete restrict,
  corrected_by uuid,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);
alter table private.tracking_event_corrections enable row level security;
revoke all on table private.tracking_event_corrections from anon, authenticated, service_role;
create or replace trigger tracking_event_corrections_append_only before update or delete on private.tracking_event_corrections
  for each row execute function private.forbid_mutation();
create or replace trigger tracking_event_corrections_no_truncate before truncate on private.tracking_event_corrections
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Two new permissions, owner only. Staff keep exactly what they had.
-- ---------------------------------------------------------------------------------------------------------------
insert into private.permissions (code, description) values
  ('tracking.correct', 'Publish a correction to the tracking history after Live tracking has ended'),
  ('orders.adopt', 'Move an existing order onto the current order workflow')
on conflict (code) do nothing;
insert into private.role_permissions (role_code, permission_code) values
  ('owner', 'tracking.correct'), ('owner', 'orders.adopt')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The release switch: which workflow NEW orders follow. Starts at 1 (today's behaviour).
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

-- (policy_error above is the previous definition plus ONE new key, orders.workflow; it must come before the insert below,
-- because the policies table checks every value with it.)

-- The release switch. 'unconfirmed_default' because it is a rollout control, not a business rule the owner has to confirm;
-- the owner changes it with admin.set_policy once the website that understands version 2 is live.
insert into private.business_policies (key, value, description, confirmation, open_question) values
  ('orders.workflow',
   '{"default_version": 1}',
   'Release switch: the order workflow that NEW orders follow. 1 is the earlier provisional workflow; 2 is the owner-defined workflow (Awaiting deposit, Deposit confirmed, Order confirmed, Live tracking, ...). Switch to 2 only after the website that understands version 2 is live. Existing orders keep their own version.',
   'unconfirmed_default', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Self-checks: a mistake in this migration fails it (and, being one transaction, leaves nothing half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  problems text;
begin
  -- no existing order moved: every row is on version 1 unless it was created after the switch
  if exists (select 1 from public.orders where workflow_version = 2 and created_at < now() - interval '1 second'
             and private.default_workflow_version() = 1) then
    raise exception 'an existing order was moved onto workflow version 2';
  end if;
  -- every status named by a stage or a move exists (the foreign keys already guarantee it); the version-2 path is complete
  select string_agg(s.code, ',') into problems
  from (values ('pending_confirmation'), ('awaiting_deposit'), ('deposit_received'), ('order_confirmed'), ('live_tracking'),
               ('arrived_in_qatar'), ('carrier_delivering'), ('building'), ('quality_check'), ('items_arrived'),
               ('awaiting_scheduling'), ('ready_for_delivery'), ('delivered'), ('on_hold'), ('cancelled')) s (code)
  where not exists (select 1 from public.order_statuses o where o.code = s.code);
  if problems is not null then
    raise exception 'workflow statuses missing: %', problems;
  end if;
  -- customers (authenticated) may read the stages; anonymous visitors may not; nobody may write them
  if not has_table_privilege('authenticated', 'public.order_workflow_stages', 'select')
     or has_any_column_privilege('anon', 'public.order_workflow_stages', 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'public.order_workflow_stages', 'insert,update')
     or has_table_privilege('authenticated', 'public.order_workflow_stages', 'delete,truncate') then
    raise exception 'public.order_workflow_stages has the wrong privileges';
  end if;
  -- private tables stay closed to every API role
  if has_any_column_privilege('authenticated', 'private.order_workflow_transitions', 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'private.workflow_adoption_map', 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'private.tracking_event_corrections', 'select,insert,update,references') then
    raise exception 'a private workflow table is reachable by an API role';
  end if;
  -- only the owner holds the two new permissions
  if exists (select 1 from private.role_permissions where role_code <> 'owner' and permission_code in ('tracking.correct', 'orders.adopt')) then
    raise exception 'tracking.correct and orders.adopt are owner-only';
  end if;
end;
$$;
