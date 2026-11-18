-- PLAT-0001, migration 7 of 11: orders, order items, the customer-facing tracking timeline, and the private side.
--
-- Two halves, kept apart on purpose (REC-PLAT-006, REC-PLAT-007):
--   public.*   what the customer may see: reference, status, the agreed prices, what has been paid, and the
--              tracking updates that staff chose to publish. Nothing in these tables is secret, so a wrong flag or a
--              mistaken policy cannot leak a secret: there is none to leak.
--   private.*  supplier costs, staff notes and the full status history with reasons and authors.
--
-- Orders are never written by an API role. They change only inside the staff functions of schema admin, which
-- validate every transition, price and payment on the server. A client-supplied total, status or paid amount is
-- not a concept in this schema: there is no column a client could write.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text not null unique default private.next_code('O'),
  customer_id uuid not null references public.customers (id) on delete restrict,
  quotation_id uuid unique references public.quotations (id) on delete restrict,
  status text not null default 'pending_confirmation' references public.order_statuses (code),
  currency char(3) not null default 'QAR' check (currency = 'QAR'),
  -- Integer minor units of QAR (1 QAR = 100). One shared helper formats them (src/lib/platform/money.ts).
  total_minor bigint not null default 0 check (total_minor >= 0),
  -- A snapshot taken when the order is priced, so a later policy change never rewrites an existing order.
  deposit_required_minor bigint not null default 0 constraint orders_deposit_within_total
    check (deposit_required_minor >= 0 and deposit_required_minor <= total_minor),
  -- Derived from the payment ledger. Never typed in by anyone.
  amount_paid_minor bigint not null default 0 constraint orders_paid_within_total
    check (amount_paid_minor >= 0 and amount_paid_minor <= total_minor),
  balance_due_minor bigint generated always as (total_minor - amount_paid_minor) stored,
  delivery_method text check (delivery_method is null or delivery_method in ('delivery', 'collection')),
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  placed_via text not null default 'admin' check (placed_via in ('website', 'whatsapp', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;
create index orders_customer_id_idx on public.orders (customer_id);
create index orders_status_idx on public.orders (status);
create trigger orders_touch before update on public.orders
  for each row execute function private.touch_updated_at();
create trigger orders_write_guard before insert or update or delete on public.orders
  for each row execute function private.require_write_ctx();
create trigger orders_no_truncate before truncate on public.orders
  for each statement execute function private.forbid_mutation();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  position integer not null check (position between 1 and 200),
  kind text not null default 'component' check (kind in ('component', 'build_service', 'delivery', 'discount', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity integer not null default 1 check (quantity between 1 and 1000),
  unit_price_minor bigint not null,
  line_total_minor bigint generated always as (quantity::bigint * unit_price_minor) stored,
  unique (order_id, position),
  -- A discount lowers the total; every other kind has a price of zero or more.
  constraint order_items_price_sign check (
    (kind = 'discount' and unit_price_minor <= 0) or (kind <> 'discount' and unit_price_minor >= 0))
);
alter table public.order_items enable row level security;
create trigger order_items_write_guard before insert or update or delete on public.order_items
  for each row execute function private.require_write_ctx();
create trigger order_items_no_truncate before truncate on public.order_items
  for each statement execute function private.forbid_mutation();

-- What a customer sees as "tracking": updates that staff publish by hand (REQ-TRK-001). Append-only: a correction
-- is a new update. The author of an update is recorded in private.tracking_event_authors, not here.
create table public.order_tracking_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  status_code text references public.order_statuses (code),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  message text check (message is null or char_length(message) <= 1000),
  published_at timestamptz not null default now()
);
alter table public.order_tracking_events enable row level security;
create index order_tracking_events_order_idx on public.order_tracking_events (order_id, published_at);
create trigger order_tracking_events_insert_guard before insert on public.order_tracking_events
  for each row execute function private.require_write_ctx();
create trigger order_tracking_events_append_only before update or delete on public.order_tracking_events
  for each row execute function private.forbid_mutation();
create trigger order_tracking_events_no_truncate before truncate on public.order_tracking_events
  for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------
-- Private side.
-- ---------------------------------------------------------------------------------------------------------
create table private.tracking_event_authors (
  event_id uuid primary key references public.order_tracking_events (id) on delete restrict,
  user_id uuid
);
alter table private.tracking_event_authors enable row level security;
revoke all on table private.tracking_event_authors from anon, authenticated, service_role;

-- The full, immutable history of every status change, with the reason and the author. Staff only.
create table private.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status text references public.order_statuses (code),
  to_status text not null references public.order_statuses (code),
  changed_by uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  changed_at timestamptz not null default now()
);
alter table private.order_status_history enable row level security;
revoke all on table private.order_status_history from anon, authenticated, service_role;
create index order_status_history_order_idx on private.order_status_history (order_id, changed_at);
create trigger order_status_history_append_only before update or delete on private.order_status_history
  for each row execute function private.forbid_mutation();
create trigger order_status_history_no_truncate before truncate on private.order_status_history
  for each statement execute function private.forbid_mutation();

-- Supplier costs: never exposed to a customer. QAR or USD (U.S. sourcing); no exchange-rate logic is assumed
-- because how costs and margins are allocated is an open question (OQ-0012).
create table private.order_item_costs (
  item_id uuid primary key references public.order_items (id) on delete restrict,
  supplier_name text check (supplier_name is null or char_length(supplier_name) <= 120),
  supplier_cost_minor bigint not null check (supplier_cost_minor >= 0),
  cost_currency text not null default 'USD' check (cost_currency in ('QAR', 'USD')),
  notes text check (notes is null or char_length(notes) <= 1000),
  updated_at timestamptz not null default now()
);
alter table private.order_item_costs enable row level security;
revoke all on table private.order_item_costs from anon, authenticated, service_role;
create trigger order_item_costs_touch before update on private.order_item_costs
  for each row execute function private.touch_updated_at();

create table private.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  author uuid,
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table private.order_notes enable row level security;
revoke all on table private.order_notes from anon, authenticated, service_role;
create trigger order_notes_append_only before update or delete on private.order_notes
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------
-- Ownership helper, privileges and policies.
-- ---------------------------------------------------------------------------------------------------------
create function private.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null and exists (
    select 1
    from public.orders o
    join public.customer_accounts ca on ca.customer_id = o.customer_id
    where o.id = p_order_id and ca.user_id = (select auth.uid())
  )
$$;
revoke all on function private.owns_order(uuid) from public;
grant execute on function private.owns_order(uuid) to authenticated;

-- Read-only for the API roles: there is deliberately no INSERT, UPDATE or DELETE grant, not even for service_role.
revoke all on table public.orders from anon, authenticated, service_role;
revoke all on table public.order_items from anon, authenticated, service_role;
revoke all on table public.order_tracking_events from anon, authenticated, service_role;
grant select on public.orders, public.order_items, public.order_tracking_events to authenticated, service_role;

create policy orders_select_own on public.orders for select to authenticated
  using (customer_id in (select private.current_customer_ids()));
create policy orders_select_staff on public.orders for select to authenticated
  using (private.has_permission('orders.read'));

create policy order_items_select_own on public.order_items for select to authenticated
  using (private.owns_order(order_id));
create policy order_items_select_staff on public.order_items for select to authenticated
  using (private.has_permission('orders.read'));

create policy order_tracking_events_select_own on public.order_tracking_events for select to authenticated
  using (private.owns_order(order_id));
create policy order_tracking_events_select_staff on public.order_tracking_events for select to authenticated
  using (private.has_permission('orders.read'));
