-- PLAT-0001, migration 6 of 11: quotations and the requested PC specification.
--
-- The public quotation form still ends in a WhatsApp message and stays exactly that (REQ-PRES-001, REC-PLAT-011).
-- Nothing in the website calls these tables yet. They exist so that a later, flagged phase can store the same
-- request without asking the customer to register: a quotation may belong to a customer or be a GUEST quotation
-- that carries only the contact details the visitor typed. Whether and for how long guest quotations are stored is
-- an open question (OQ-0017), so nothing writes one yet.
--
-- Prices are set by staff. A customer has no way to write a quotation, a line or a price.

create table public.quote_categories (
  label text primary key check (char_length(label) between 2 and 60),
  sort_order integer not null unique
);
alter table public.quote_categories enable row level security;
revoke all on table public.quote_categories from anon, authenticated, service_role;
grant select on public.quote_categories to anon, authenticated;
create policy quote_categories_read on public.quote_categories for select to anon, authenticated using (true);

-- The labels are the ones in src/types/quote.ts (QUOTE_CATEGORIES). A test keeps the two lists identical.
insert into public.quote_categories (label, sort_order) values
  ('Complete Custom PC', 1), ('Graphics Card (GPU)', 2), ('Processor (CPU)', 3), ('Motherboard', 4),
  ('RAM / Memory', 5), ('SSD / Storage', 6), ('Power Supply', 7), ('CPU Cooling', 8), ('PC Case', 9),
  ('Case Fans / RGB Fans', 10), ('Monitor', 11), ('Keyboard', 12), ('Mouse', 13), ('Headset', 14),
  ('Mouse Pad', 15), ('Wi-Fi / Bluetooth Adapter', 16), ('Cables / PC Accessories', 17), ('Other Tech Product', 18);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_ref text not null unique default private.next_code('Q'),
  customer_id uuid references public.customers (id) on delete restrict,
  guest_name text check (guest_name is null or char_length(btrim(guest_name)) between 1 and 120),
  guest_phone text check (guest_phone is null or guest_phone ~ '^\+?[0-9 ()-]{6,24}$'),
  guest_email text check (guest_email is null or (char_length(guest_email) <= 254 and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  category text not null references public.quote_categories (label),
  requested_budget_minor bigint check (requested_budget_minor is null or requested_budget_minor >= 0),
  quantity integer not null default 1 check (quantity between 1 and 1000),
  product_preference text not null check (product_preference in (
    'I want a specific model',
    'Find me the best option for my requirements',
    'Find me the best deal available',
    'Not sure')),
  specific_model text check (specific_model is null or char_length(specific_model) <= 200),
  -- The category-specific answers of the form, keyed by field id. Free-form by design (the form's questions change).
  requested_specs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requested_specs) = 'object' and octet_length(requested_specs::text) <= 20000),
  additional_notes text check (additional_notes is null or char_length(additional_notes) <= 4000),
  source text not null default 'website_form' check (source in ('website_form', 'whatsapp', 'admin')),
  status text not null default 'submitted'
    check (status in ('submitted', 'in_review', 'quoted', 'accepted', 'declined', 'expired', 'converted')),
  quoted_total_minor bigint check (quoted_total_minor is null or quoted_total_minor >= 0),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A guest quotation must carry a way to reach the person.
  constraint quotations_has_contact check (customer_id is not null or (guest_name is not null and guest_phone is not null)),
  constraint quotations_specific_model_required check (
    product_preference <> 'I want a specific model' or nullif(btrim(coalesce(specific_model, '')), '') is not null),
  -- A price exists only once the quotation has been quoted: a draft price can never reach the customer.
  constraint quotations_price_only_when_quoted check (
    quoted_total_minor is null or status in ('quoted', 'accepted', 'converted', 'declined', 'expired')),
  constraint quotations_quoted_needs_price check (
    status not in ('quoted', 'accepted', 'converted') or quoted_total_minor is not null)
);
alter table public.quotations enable row level security;
create index quotations_customer_id_idx on public.quotations (customer_id);
create trigger quotations_touch before update on public.quotations
  for each row execute function private.touch_updated_at();

-- Status moves are validated on the server. 'converted' is written only by admin.create_order.
create function private.guard_quotation_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' and not private.write_ctx_on() then
      raise exception 'a quotation starts as submitted' using errcode = '55000';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'converted' then
    ok := old.status = 'accepted' and private.write_ctx_on();
  else
    ok := (old.status, new.status) in (
      ('submitted', 'in_review'), ('submitted', 'declined'), ('submitted', 'expired'),
      ('in_review', 'quoted'), ('in_review', 'declined'), ('in_review', 'expired'),
      ('quoted', 'in_review'), ('quoted', 'accepted'), ('quoted', 'declined'), ('quoted', 'expired'),
      ('accepted', 'declined'));
  end if;
  if not ok then
    raise exception 'a quotation cannot move from % to %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger quotations_status_guard before insert or update of status on public.quotations
  for each row execute function private.guard_quotation_status();

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  position integer not null check (position between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity integer not null default 1 check (quantity between 1 and 1000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint generated always as (quantity::bigint * unit_price_minor) stored,
  unique (quotation_id, position)
);
alter table public.quotation_lines enable row level security;

-- Staff-only: what the business expects the quotation to cost it and any note about it.
create table private.quotation_internal (
  quotation_id uuid primary key references public.quotations (id) on delete cascade,
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  estimated_cost_minor bigint check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  updated_at timestamptz not null default now()
);
alter table private.quotation_internal enable row level security;
revoke all on table private.quotation_internal from anon, authenticated, service_role;
create trigger quotation_internal_touch before update on private.quotation_internal
  for each row execute function private.touch_updated_at();

-- A customer sees the lines (and so the prices) of their own quotation only once it has been quoted.
create function private.quotation_lines_visible_to_customer(p_quotation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quotations q
    where q.id = p_quotation_id
      and q.customer_id in (select ca.customer_id from public.customer_accounts ca where ca.user_id = (select auth.uid()))
      and q.status in ('quoted', 'accepted', 'declined', 'expired', 'converted')
  )
$$;
revoke all on function private.quotation_lines_visible_to_customer(uuid) from public;
grant execute on function private.quotation_lines_visible_to_customer(uuid) to authenticated;

-- ---- privileges and policies ---------------------------------------------------------------------------------
revoke all on table public.quotations from anon, authenticated;
revoke all on table public.quotation_lines from anon, authenticated;
grant select, insert, update on public.quotations to authenticated;
grant select, insert, update, delete on public.quotation_lines to authenticated;

create policy quotations_select_own on public.quotations for select to authenticated
  using (customer_id in (select private.current_customer_ids()));
create policy quotations_select_staff on public.quotations for select to authenticated
  using (private.has_permission('quotations.read'));
create policy quotations_insert_staff on public.quotations for insert to authenticated
  with check (private.has_permission('quotations.manage'));
create policy quotations_update_staff on public.quotations for update to authenticated
  using (private.has_permission('quotations.manage'))
  with check (private.has_permission('quotations.manage'));

create policy quotation_lines_select_own on public.quotation_lines for select to authenticated
  using (private.quotation_lines_visible_to_customer(quotation_id));
create policy quotation_lines_select_staff on public.quotation_lines for select to authenticated
  using (private.has_permission('quotations.read'));
create policy quotation_lines_insert_staff on public.quotation_lines for insert to authenticated
  with check (private.has_permission('quotations.manage'));
create policy quotation_lines_update_staff on public.quotation_lines for update to authenticated
  using (private.has_permission('quotations.manage'))
  with check (private.has_permission('quotations.manage'));
create policy quotation_lines_delete_staff on public.quotation_lines for delete to authenticated
  using (private.has_permission('quotations.manage'));
