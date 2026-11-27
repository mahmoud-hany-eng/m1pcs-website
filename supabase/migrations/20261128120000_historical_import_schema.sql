-- PLAT-0008, historical orders import, migration 1 of 2: the schema.
--
-- What the owner asked for (design and exact rules: docs/project-memory/architecture/HISTORICAL_IMPORT.md): an owner-only, auditable,
-- idempotent import of purchases made before this website existed (WhatsApp customers), with their private cost, their real completion date,
-- retroactive loyalty points awarded exactly once, customer profiles that a person claims later with the existing one-time claim code, and private
-- attachments (PDF and PNG) that never reach a customer.
--
-- How the existing rules are kept:
--   * An imported order is Delivered / Collected from its first moment. It has NO tracking events, NO status history, NO deposit and NO payment
--     records: none of those are invented. "Fully paid" comes from the owner's recorded attestation on the batch (private.historical_import_batches),
--     and the order's paid amount is set to its net payable amount so that every balance and report agrees. A payment can never be added to such
--     an order (trigger), so the attested figure cannot be overwritten by a ledger that was never kept.
--   * orders.completed_at is the historical completion date (stored at 12:00 Asia/Qatar so no timezone conversion can move it to another day).
--     The system's own rule "completed_at is set only by the database when an order is delivered" is kept: the only other way in is the importer's
--     transaction, which names the order in a transaction-local setting, exactly as the owner's one-time completion verification already does.
--   * orders.created_at stays the TRUE time the record was created (the import time). The historical date is NOT presented as a placement date:
--     the placement date of these orders is unknown. For sorting and filtering by "date" the Orders page uses orders.order_date, which is the
--     completion date for a historical order and the creation date for every other order.
--   * Nothing existing is changed in value: no order, payment, loyalty entry, price, deposit, policy or workflow switch is touched. Existing
--     orders keep origin 'platform' and an order_date equal to their creation date, so every existing query answers as before.
--
-- Forward-only and re-runnable. Two existing constraints/functions are REPLACED by a version that is the same for every existing order (the
-- completed-after-created check allows the historical case; the completion guard allows the importer's insert); the migration says which and why.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. One new permission, owner only.
-- ---------------------------------------------------------------------------------------------------------------
insert into private.permissions (code, description) values
  ('import.manage', 'Import historical orders, review and confirm an import, and manage the attachments of imported orders (owner only)')
on conflict (code) do nothing;
insert into private.role_permissions (role_code, permission_code) values ('owner', 'import.manage') on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. What an order is, and the date the Orders page sorts and filters by.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.orders add column if not exists origin text not null default 'platform';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_origin_check') then
    alter table public.orders add constraint orders_origin_check check (origin in ('platform', 'historical_import'));
  end if;
  -- A historical order is, by definition, completed: it exists only as Delivered / Collected with its completion date.
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_historical_is_completed') then
    alter table public.orders add constraint orders_historical_is_completed
      check (origin <> 'historical_import' or (status = 'delivered' and completed_at is not null and placed_via = 'whatsapp'));
  end if;
end;
$$;
comment on column public.orders.origin is 'platform = created by this system; historical_import = a purchase made before the website existed, brought in by the owner''s import. Set once, never changed.';

-- order_date: for a historical order its completion date (its placement date is not known), for every other order its creation date.
alter table public.orders
  add column if not exists order_date timestamptz generated always as (case when origin = 'historical_import' then completed_at else created_at end) stored;
create index if not exists orders_order_date_idx on public.orders (order_date desc);
comment on column public.orders.order_date is 'The date an order is listed and sorted by: the completion date of a historical order, the creation date of every other order. Not a placement date for a historical order.';

-- completed_at >= created_at stays true for every order the system creates. A historical order is created at the import (created_at) but completed
-- in the past (completed_at), so the check does not apply to it. This replaces the earlier constraint of the same name; it is identical for every
-- order that is not historical, and no existing order is historical.
alter table public.orders drop constraint if exists orders_completed_after_created;
alter table public.orders add constraint orders_completed_after_created
  check (completed_at is null or completed_at >= created_at or origin = 'historical_import');

-- The origin never changes after the order exists.
create or replace function private.guard_order_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origin is distinct from old.origin then
    raise exception 'the origin of an order never changes' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_origin() from public;
create or replace trigger orders_guard_origin before update on public.orders
  for each row execute function private.guard_order_origin();

-- The completion guard, identical to the earlier one except for ONE case: the importer may insert a historical order that is already completed,
-- and only when its own transaction named this exact order (m1.historical_import), the order is Delivered and its origin says so. Everything else
-- (a typed-in completion date, a status change after completion, a changed date) is refused exactly as before.
create or replace function private.guard_order_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.completed_at is not null then
      if new.origin = 'historical_import' and new.status = 'delivered'
         and current_setting('m1.historical_import', true) is not distinct from new.id::text then
        return new;
      end if;
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

-- The completion record gets one more basis, with the same rule as the owner's verification: it must say how the date is known.
do $$
begin
  alter table private.order_completions drop constraint if exists order_completions_basis_check;
  alter table private.order_completions add constraint order_completions_basis_check
    check (basis in ('transition', 'status_history', 'owner_verified', 'historical_import'));
  if not exists (select 1 from pg_constraint where conrelid = 'private.order_completions'::regclass and conname = 'order_completions_historical_has_reason') then
    alter table private.order_completions add constraint order_completions_historical_has_reason
      check (basis <> 'historical_import' or (reason is not null and char_length(btrim(reason)) >= 3));
  end if;
end;
$$;

-- A historical order has no payment ledger and no tracking: refusing both keeps them from being invented later, and keeps the attested paid
-- amount from being overwritten by a ledger that was never kept.
create or replace function private.refuse_on_historical_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.orders o where o.id = new.order_id and o.origin = 'historical_import') then
    raise exception 'this is a historical order: it has no payment ledger or tracking, and none can be added (its settlement was attested by the owner at import)'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_on_historical_order() from public;
create or replace trigger payments_refuse_historical before insert on public.payments
  for each row execute function private.refuse_on_historical_order();
create or replace trigger tracking_refuse_historical before insert on public.order_tracking_events
  for each row execute function private.refuse_on_historical_order();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The import: batches, rows, customer groups, decisions, attachments. All private: row level security on, no privilege for any API role,
--    writable only inside the owner's functions (the write flag), never truncated.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists private.historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  status text not null default 'staged' check (status in ('staged', 'committed', 'discarded')),
  source_label text check (source_label is null or char_length(source_label) <= 120),
  parser_version integer not null default 1 check (parser_version >= 1),
  date_format text check (date_format is null or date_format in ('iso', 'dmy', 'mdy')),
  date_format_reason text check (date_format_reason is null or char_length(date_format_reason) <= 40),
  -- What the file contains, identity-wise: the same rows in any order give the same hash.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  qar_per_point_minor integer not null check (qar_per_point_minor >= 1),
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  attestation jsonb check (attestation is null or jsonb_typeof(attestation) = 'object'),
  committed_at timestamptz,
  committed_by uuid,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  discarded_at timestamptz,
  discarded_by uuid,
  discard_reason text check (discard_reason is null or char_length(discard_reason) between 3 and 300),
  constraint hist_batch_committed_shape check ((status = 'committed') = (committed_at is not null and result is not null and attestation is not null)),
  constraint hist_batch_discarded_shape check ((status = 'discarded') = (discarded_at is not null and discard_reason is not null))
);
-- One live (staged or committed) batch per file content: uploading the same file again finds it instead of making a second one.
create unique index if not exists hist_batches_one_live_per_content on private.historical_import_batches (content_hash) where status in ('staged', 'committed');

create table if not exists private.historical_import_groups (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  group_no integer not null check (group_no >= 1),
  name_key text not null check (char_length(name_key) between 1 and 160),
  phone_key text not null default '' check (phone_key ~ '^[0-9]{0,15}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+[0-9]{7,15}$'),
  -- A group the owner merged into another one: its rows belong to that group.
  merged_into uuid references private.historical_import_groups (id) on delete restrict,
  -- Whether the customer profile is NEW or an EXISTING one. Null until decided; matching a phone number is never proof of ownership.
  customer_choice text check (customer_choice is null or customer_choice in ('new', 'existing')),
  existing_customer_id uuid references public.customers (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  unique (batch_id, group_no),
  constraint hist_group_existing_choice check ((customer_choice = 'existing') = (existing_customer_id is not null)),
  constraint hist_group_not_self_merged check (merged_into is distinct from id)
);

create table if not exists private.historical_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  row_number integer not null check (row_number >= 2),
  kind text not null check (kind in ('purchase', 'ad_expense', 'invalid_summary', 'invalid')),
  customer_name text check (customer_name is null or char_length(customer_name) between 1 and 120),
  name_key text not null default '' check (char_length(name_key) <= 160),
  phone text check (phone is null or phone ~ '^\+[0-9]{7,15}$'),
  phone_key text not null default '' check (phone_key ~ '^[0-9]{0,15}$'),
  happened_on date check (happened_on is null or happened_on between date '2020-01-01' and date '2100-12-31'),
  month_label text check (month_label is null or char_length(month_label) <= 40),
  revenue_minor bigint check (revenue_minor is null or revenue_minor between 0 and 10000000000),
  cost_minor bigint check (cost_minor is null or cost_minor between 0 and 10000000000),
  profit_minor bigint check (profit_minor is null or profit_minor between -10000000000 and 10000000000),
  occurrence integer check (occurrence is null or occurrence >= 1),
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  points integer not null default 0 check (points >= 0),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  decision text not null default 'import' check (decision in ('import', 'skip')),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 300),
  group_id uuid references private.historical_import_groups (id) on delete restrict,
  status text not null default 'staged' check (status in ('staged', 'imported', 'skipped')),
  order_id uuid references public.orders (id) on delete restrict,
  corrected boolean not null default false,
  unique (batch_id, row_number),
  constraint hist_row_purchase_shape check (kind <> 'purchase' or (
    customer_name is not null and name_key <> '' and happened_on is not null and revenue_minor is not null and revenue_minor > 0
    and fingerprint is not null and occurrence is not null)),
  constraint hist_row_profit_is_revenue_less_cost check (
    kind <> 'purchase' or profit_minor is null or cost_minor is null or profit_minor = revenue_minor - cost_minor),
  constraint hist_row_imported_has_order check ((status = 'imported') = (order_id is not null)),
  constraint hist_row_skip_has_reason check (decision <> 'skip' or skip_reason is not null)
);
create index if not exists hist_rows_batch_idx on private.historical_import_rows (batch_id, row_number);
create index if not exists hist_rows_fingerprint_idx on private.historical_import_rows (fingerprint) where fingerprint is not null;

-- The owner's acknowledgements of things that are not an error but need a decision: "these two customers are different people", "import it anyway".
create table if not exists private.historical_import_resolutions (
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  flag_key text not null check (char_length(flag_key) between 3 and 200),
  resolution text not null check (resolution in ('keep_separate', 'import_anyway')),
  note text check (note is null or char_length(note) <= 300),
  resolved_by uuid,
  resolved_at timestamptz not null default now(),
  primary key (batch_id, flag_key)
);

-- Attachments of imported orders. Original PDFs and PNGs are stored in the database, private, with the SHA-256 of the exact bytes. A reference
-- from the export is only a reference: it is never fetched, and a missing or expired one never means "there was no receipt".
create table if not exists private.historical_import_attachments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  row_id uuid not null references private.historical_import_rows (id) on delete restrict,
  position integer not null check (position between 1 and 50),
  file_name text not null check (char_length(file_name) between 1 and 120),
  declared_ext text not null check (declared_ext in ('pdf', 'png', 'other')),
  source_ref text check (source_ref is null or (char_length(source_ref) <= 2000 and source_ref ~ '^https://')),
  source_host text check (source_host is null or char_length(source_host) <= 255),
  source_expiring boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'stored', 'unavailable')),
  -- Who may ever see it. Everything starts as unclassified and private; a customer-safe receipt is the owner's explicit decision, and a supplier
  -- invoice is never customer-visible.
  classification text not null default 'unclassified' check (classification in ('unclassified', 'customer_receipt', 'supplier_invoice')),
  customer_visible boolean not null default false,
  mime text check (mime is null or mime in ('application/pdf', 'image/png')),
  byte_size integer check (byte_size is null or byte_size between 1 and 4194304),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  content bytea,
  stored_by uuid,
  stored_at timestamptz,
  unavailable_reason text check (unavailable_reason is null or char_length(unavailable_reason) between 3 and 300),
  unique (row_id, position),
  constraint hist_att_stored_shape check ((status = 'stored') = (content is not null and mime is not null and byte_size is not null and sha256 is not null and stored_at is not null)),
  constraint hist_att_size_matches check (content is null or octet_length(content) = byte_size),
  constraint hist_att_unavailable_reason check ((status = 'unavailable') = (unavailable_reason is not null)),
  constraint hist_att_visible_needs_customer_receipt check (not customer_visible or (classification = 'customer_receipt' and status = 'stored'))
);
create unique index if not exists hist_att_one_file_per_row on private.historical_import_attachments (row_id, sha256) where sha256 is not null;

-- Provenance: one row per imported order, forever. The unique source fingerprint is what makes a repeat of the same purchase impossible, whatever
-- batch or file it comes from. Immutable.
create table if not exists private.historical_orders (
  order_id uuid primary key references public.orders (id) on delete restrict,
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  row_id uuid not null unique references private.historical_import_rows (id) on delete restrict,
  source_fingerprint text not null unique check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_row_number integer not null,
  historical_date date not null,
  date_meaning text not null check (date_meaning = 'completion'),
  placement_date_known boolean not null default false check (placement_date_known = false),
  imported_at timestamptz not null default now(),
  imported_by uuid,
  revenue_minor bigint not null check (revenue_minor > 0),
  cost_minor bigint check (cost_minor is null or cost_minor >= 0),
  paid_basis text not null default 'owner_attestation' check (paid_basis = 'owner_attestation'),
  points_awarded integer not null check (points_awarded >= 0),
  loyalty_entry_id uuid references public.loyalty_ledger (id) on delete restrict,
  constraint hist_orders_points_entry check ((points_awarded > 0) = (loyalty_entry_id is not null))
);
create index if not exists historical_orders_batch_idx on private.historical_orders (batch_id);

-- Customers the importer created, so a later file about the same person (same normalised name and phone) reuses the profile.
create table if not exists private.historical_customers (
  customer_id uuid primary key references public.customers (id) on delete restrict,
  batch_id uuid not null references private.historical_import_batches (id) on delete restrict,
  name_key text not null check (char_length(name_key) between 1 and 160),
  phone_key text not null default '' check (phone_key ~ '^[0-9]{0,15}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists historical_customers_identity on private.historical_customers (name_key, phone_key) where phone_key <> '';

-- Changes to the item lines of a historical order (the placeholder line the import creates, enriched later by the owner). The total never changes.
create table if not exists private.historical_item_revisions (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  old_items jsonb not null check (jsonb_typeof(old_items) = 'array'),
  new_items jsonb not null check (jsonb_typeof(new_items) = 'array'),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists historical_item_revisions_order_idx on private.historical_item_revisions (order_id, id);

-- ---- closed to every API role, writable only inside the owner's functions, never truncated --------------------------------------------------
alter table private.historical_import_batches enable row level security;
alter table private.historical_import_groups enable row level security;
alter table private.historical_import_rows enable row level security;
alter table private.historical_import_resolutions enable row level security;
alter table private.historical_import_attachments enable row level security;
alter table private.historical_orders enable row level security;
alter table private.historical_customers enable row level security;
alter table private.historical_item_revisions enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array[
    'historical_import_batches', 'historical_import_groups', 'historical_import_rows', 'historical_import_resolutions',
    'historical_import_attachments', 'historical_orders', 'historical_customers', 'historical_item_revisions'
  ] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on table private.%I from anon, authenticated, service_role', t);
    execute format('create or replace trigger %I before insert or update or delete on private.%I for each row execute function private.require_write_ctx()', t || '_write_guard', t);
    execute format('create or replace trigger %I before truncate on private.%I for each statement execute function private.forbid_mutation()', t || '_no_truncate', t);
  end loop;
end;
$$;

-- Provenance and revisions are append-only. A batch, a row or a group is edited while the batch is being reviewed; once the batch is committed
-- nothing about it changes, except the attachments (which may be added later) and the decisions on them.
create or replace trigger historical_orders_append_only before update or delete on private.historical_orders
  for each row execute function private.forbid_mutation();
create or replace trigger historical_customers_append_only before update or delete on private.historical_customers
  for each row execute function private.forbid_mutation();
create or replace trigger historical_item_revisions_append_only before update or delete on private.historical_item_revisions
  for each row execute function private.forbid_mutation();

-- Deleting is only for purging the personal data of a DISCARDED batch (the owner's function names the batch in a transaction-local setting).
create or replace function private.guard_historical_purge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  b uuid := case when tg_table_name = 'historical_import_batches' then old.id else old.batch_id end;
begin
  if tg_op = 'DELETE' and (tg_table_name = 'historical_import_batches'
       or current_setting('m1.hist_purge', true) is distinct from b::text
       or exists (select 1 from private.historical_import_batches x where x.id = b and x.status <> 'discarded')) then
    raise exception 'an import is never deleted; only the personal data of a discarded one is purged' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_historical_purge() from public;
create or replace trigger historical_import_batches_no_delete before delete on private.historical_import_batches
  for each row execute function private.guard_historical_purge();
create or replace trigger historical_import_rows_purge_only before delete on private.historical_import_rows
  for each row execute function private.guard_historical_purge();
create or replace trigger historical_import_groups_purge_only before delete on private.historical_import_groups
  for each row execute function private.guard_historical_purge();
create or replace trigger historical_import_attachments_purge_only before delete on private.historical_import_attachments
  for each row execute function private.guard_historical_purge();
create or replace trigger historical_import_resolutions_purge_only before delete on private.historical_import_resolutions
  for each row execute function private.guard_historical_purge();

-- A committed batch keeps its rows and groups exactly as they were committed.
create or replace function private.guard_committed_batch_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from private.historical_import_batches b where b.id = old.batch_id and b.status = 'committed')
     and current_setting('m1.hist_commit', true) is distinct from old.batch_id::text then
    raise exception 'a committed import cannot be edited' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_committed_batch_rows() from public;
create or replace trigger historical_import_rows_committed_guard before update on private.historical_import_rows
  for each row execute function private.guard_committed_batch_rows();
create or replace trigger historical_import_groups_committed_guard before update on private.historical_import_groups
  for each row execute function private.guard_committed_batch_rows();

-- A stored attachment's file never changes (the file is evidence); only its classification, visibility and availability can.
create or replace function private.guard_attachment_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'stored' and (new.content is distinct from old.content or new.sha256 is distinct from old.sha256 or new.mime is distinct from old.mime
                                or new.byte_size is distinct from old.byte_size) then
    raise exception 'a stored attachment is never replaced; attach another file instead' using errcode = '55000';
  end if;
  if new.row_id is distinct from old.row_id or new.batch_id is distinct from old.batch_id or new.file_name is distinct from old.file_name
     or new.source_ref is distinct from old.source_ref then
    raise exception 'an attachment cannot be moved or have its origin changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_attachment_content() from public;
create or replace trigger historical_import_attachments_content_guard before update on private.historical_import_attachments
  for each row execute function private.guard_attachment_content();

comment on table private.historical_import_batches is 'One historical-orders upload: what the file said (identity hash), the owner''s attestations at commit, the result. Private; reached only through the admin.hist_* functions.';
comment on table private.historical_orders is 'Provenance of every imported order: the unique fingerprint of the source purchase, the historical date and what it means, the attested paid basis, the points awarded. Immutable.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Self-checks. A mistake here fails the migration (one transaction), so nothing is left half-applied.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from private.role_permissions where role_code <> 'owner' and permission_code = 'import.manage') then
    raise exception 'import.manage is owner-only';
  end if;
  if exists (select 1 from public.orders where origin <> 'platform') then
    raise exception 'an order already has an origin other than platform';
  end if;
  if exists (select 1 from public.orders o where o.order_date is distinct from o.created_at) then
    raise exception 'order_date must equal created_at for every existing order';
  end if;
  foreach t in array array[
    'private.historical_import_batches', 'private.historical_import_groups', 'private.historical_import_rows', 'private.historical_import_resolutions',
    'private.historical_import_attachments', 'private.historical_orders', 'private.historical_customers', 'private.historical_item_revisions'
  ] loop
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
