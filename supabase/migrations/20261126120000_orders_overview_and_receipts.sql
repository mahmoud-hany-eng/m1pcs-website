-- Orders page, simplified: one overview function (price, cost, profit, receipts) and PDF receipts attached to an order.
--
-- WHAT THIS ADDS (nothing existing is changed: admin.list_orders, admin.list_orders_page and every earlier function keep working exactly as
-- they do, so the website that is live today and every earlier Preview are unaffected)
--
--   1. admin.list_orders_overview(...)   the Orders page's one query: search, status, the Qatar date an order was PLACED (month/year or an
--                                        inclusive range), six sorts, a total, a page. The row is deliberately small:
--                                          order number, customer name, order price, placed date
--                                        plus, ONLY for a person who holds finance.read:   cost, profit
--                                        and, ONLY for a person who holds payments.read:   the receipts attached to the order.
--                                        A person without the permission gets a row that does not even contain the keys, never a null.
--   2. private.order_receipts            PDF receipts, stored in the database (never in a public bucket, never reachable from the customer API),
--                                        append-only: a receipt is REMOVED (kept, marked, with who/when/why), never deleted or edited.
--   3. admin.add_order_receipt / admin.remove_order_receipt / admin.get_order_receipt
--
-- THE FIGURES (so a screen can never disagree with the order's own page)
--   order price   orders.net_payable_minor: what the customer has to PAY, after the discount and the redeemed loyalty credit (never the original total).
--   cost          the private, active cost entries of the order (actual + estimated), exactly as admin.order_costs adds them up. An order with NO
--                 entry has an UNKNOWN cost: cost and profit are null, never zero and never "price minus zero".
--   profit        order price - cost. 'profit_is_provisional' says the costs are not all actual and declared complete.
--   Sorting by profit puts the orders whose profit is unknown last, in both directions, so they never pass for the best or the worst.
--
-- PERMISSIONS (the database decides every time; the screen only mirrors it)
--   list_orders_overview      orders.read       (cost/profit keys: finance.read; receipt keys: payments.read; a profit sort: finance.read)
--   get_order_receipt         payments.read
--   add / remove receipt      payments.record   (the owner; the ordinary staff role holds none of the finance or payments permissions)
--
-- RECEIPT RULES: a real PDF (starts with "%PDF-"), 1 byte to 4 MiB, at most 10 active receipts per order, the same file is not attached twice to one
-- order, the file name is cleaned (no path, no control or direction-changing characters, always ends in .pdf). Adding is keyed (the screen chooses the
-- receipt id once per intended upload, so a double click or a retry stores it once). Removing needs a reason (3-300 characters) and is audited.
--
-- SQLSTATEs: 42501 no permission, 22023 an invalid choice (message written for staff), P0002 not found, 54000 a limit, M1K01 the receipt id was already
-- used for a different file. Forward-only and rerunnable.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Receipts: private table, append-only.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists private.order_receipts (
  -- Chosen by the screen once per intended upload (the idempotency key), so a retry of the same upload stores it once.
  id uuid primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  file_name text not null check (char_length(file_name) between 5 and 120 and lower(right(file_name, 4)) = '.pdf'),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea not null,
  status text not null default 'active' check (status in ('active', 'removed')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  removed_by uuid,
  removed_at timestamptz,
  removal_reason text check (removal_reason is null or char_length(removal_reason) <= 300),
  constraint order_receipts_size_matches check (size_bytes = octet_length(content)),
  constraint order_receipts_is_pdf check (substring(content from 1 for 5) = '\x255044462d'::bytea),
  constraint order_receipts_removal_shape check (
    (status = 'active' and removed_at is null and removed_by is null and removal_reason is null)
    or (status = 'removed' and removed_at is not null and removal_reason is not null and char_length(btrim(removal_reason)) >= 3))
);
alter table private.order_receipts enable row level security;
revoke all on table private.order_receipts from anon, authenticated, service_role;
create index if not exists order_receipts_order_idx on private.order_receipts (order_id, uploaded_at desc) where status = 'active';
-- The same file is never attached twice to one order (the function says so in words; this is the backstop for a race).
create unique index if not exists order_receipts_order_file_uidx on private.order_receipts (order_id, sha256) where status = 'active';

create or replace trigger order_receipts_write_guard before insert or update or delete on private.order_receipts
  for each row execute function private.require_write_ctx();
create or replace trigger order_receipts_no_truncate before truncate on private.order_receipts
  for each statement execute function private.forbid_mutation();

-- A receipt is never deleted and its content, name, order and origin never change. The only update is active -> removed, once.
create or replace function private.guard_order_receipt_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a receipt is never deleted; remove it with a reason instead' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.file_name is distinct from old.file_name
     or new.size_bytes is distinct from old.size_bytes or new.sha256 is distinct from old.sha256 or new.content is distinct from old.content
     or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'a receipt cannot be changed, only removed' using errcode = '55000';
  end if;
  if old.status = 'removed' and new is distinct from old then
    raise exception 'a removed receipt cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_receipt_identity() from public;
create or replace trigger order_receipts_identity before update or delete on private.order_receipts
  for each row execute function private.guard_order_receipt_identity();

-- A file name safe to show and to put in a download header: no folders, no control or direction-changing characters, no quotes or the characters
-- Windows forbids, spaces collapsed, at most 120 characters, always ending in .pdf. Arabic and other letters are kept.
create or replace function private.receipt_file_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := coalesce(p_name, '');
  stem text;
begin
  n := regexp_replace(n, '^.*[\\/]', '');
  n := regexp_replace(n, '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g');
  n := regexp_replace(n, '["<>:|?*]', '', 'g');
  n := btrim(regexp_replace(n, '\s+', ' ', 'g'));
  stem := case when lower(right(n, 4)) = '.pdf' then left(n, char_length(n) - 4) else n end;
  stem := btrim(stem, ' .');
  if stem = '' then
    return 'receipt.pdf';
  end if;
  return left(stem, 115) || '.pdf';
end;
$$;
revoke all on function private.receipt_file_name(text) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Add a receipt (keyed).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.add_order_receipt(p_order_id uuid, p_receipt_id uuid, p_file_name text, p_content bytea)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  new_id uuid := coalesce(p_receipt_id, gen_random_uuid());
  clean_name text := private.receipt_file_name(p_file_name);
  file_hash text;
  existing private.order_receipts%rowtype;
  active_count integer;
begin
  perform private.require_permission('payments.record');
  if p_receipt_id is null and private.via_gateway() then
    raise exception 'the receipt needs the id the screen chose; reload the page and try again' using errcode = '22023';
  end if;
  if p_content is null or octet_length(p_content) = 0 then
    raise exception 'the file is empty' using errcode = '22023';
  end if;
  if octet_length(p_content) > 4194304 then
    raise exception 'the file is too large: a receipt can be up to 4 MB' using errcode = '22023';
  end if;
  if substring(p_content from 1 for 5) <> '\x255044462d'::bytea then
    raise exception 'the file is not a PDF; attach the receipt as a PDF' using errcode = '22023';
  end if;
  file_hash := encode(sha256(p_content), 'hex');

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- A retry of the same upload (same receipt id, same file) returns the receipt already stored and stores nothing.
  select * into existing from private.order_receipts where id = new_id;
  if found then
    if existing.order_id = o.id and existing.sha256 = file_hash then
      perform set_config('m1.replayed', 'true', true);
      return existing.id;
    end if;
    raise exception 'this receipt id was already used for a different file; nothing was changed' using errcode = 'M1K01';
  end if;
  perform set_config('m1.replayed', 'false', true);

  select count(*)::integer into active_count from private.order_receipts where order_id = o.id and status = 'active';
  if active_count >= 10 then
    raise exception 'an order can have up to 10 receipts; remove one before attaching another' using errcode = '54000';
  end if;
  if exists (select 1 from private.order_receipts where order_id = o.id and sha256 = file_hash and status = 'active') then
    raise exception 'this file is already attached to this order' using errcode = '22023';
  end if;

  perform private.set_write_ctx(true);
  insert into private.order_receipts (id, order_id, file_name, size_bytes, sha256, content, uploaded_by)
  values (new_id, o.id, clean_name, octet_length(p_content), file_hash, p_content, (select auth.uid()));
  perform private.audit('order.receipt_added', 'order', o.id::text, jsonb_build_object('receipt_id', new_id, 'file_name', clean_name, 'size_bytes', octet_length(p_content), 'sha256', file_hash));
  perform private.set_write_ctx(false);
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Remove a receipt (kept, marked, audited; repeating it changes nothing).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.remove_order_receipt(p_receipt_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r private.order_receipts%rowtype;
  why text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('payments.record');
  if char_length(why) < 3 or char_length(why) > 300 then
    raise exception 'say why the receipt is being removed (3 to 300 characters)' using errcode = '22023';
  end if;
  select * into r from private.order_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if r.status = 'removed' then
    perform set_config('m1.replayed', 'true', true);
    return r.id;
  end if;
  perform set_config('m1.replayed', 'false', true);
  perform private.set_write_ctx(true);
  update private.order_receipts set status = 'removed', removed_by = (select auth.uid()), removed_at = now(), removal_reason = why where id = r.id;
  perform private.audit('order.receipt_removed', 'order', r.order_id::text, jsonb_build_object('receipt_id', r.id, 'file_name', r.file_name, 'reason', why));
  perform private.set_write_ctx(false);
  return r.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Read one receipt's file (for view / download). Removed receipts are not served.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.get_order_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r private.order_receipts%rowtype;
begin
  perform private.require_permission('payments.read');
  select * into r from private.order_receipts where id = p_receipt_id and status = 'active';
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'order_id', r.order_id, 'file_name', r.file_name, 'size_bytes', r.size_bytes, 'content_base64', encode(r.content, 'base64'));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The Orders overview: one page of orders with the few figures the list shows.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.list_orders_overview(
  p_search text default null,
  p_status text default null,
  p_year integer default null,
  p_month integer default null,
  p_from date default null,
  p_to date default null,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_search, ''));
  pattern text;
  sort_key text := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'newest');
  status_code text := nullif(btrim(coalesce(p_status, '')), '');
  size integer := least(greatest(coalesce(p_page_size, 5), 1), 100);
  page integer;
  pages integer;
  total bigint;
  today date := (now() at time zone 'Asia/Qatar')::date;
  by_range boolean := p_from is not null or p_to is not null;
  eff_year integer;
  eff_month integer;
  first_day date;
  after_day date;
  from_ts timestamptz;
  to_ts timestamptz;
  years jsonb;
  rows jsonb;
  fin boolean;
  rcp boolean;
begin
  perform private.require_permission('orders.read');
  if sort_key not in ('newest', 'oldest', 'price_asc', 'price_desc', 'profit_asc', 'profit_desc') then
    raise exception 'sort must be newest, oldest, price_asc, price_desc, profit_asc or profit_desc' using errcode = '22023';
  end if;
  -- Cost and profit are private. Sorting by profit would reveal their order, so it needs the same permission as seeing them.
  fin := private.has_permission('finance.read');
  rcp := private.has_permission('payments.read');
  if sort_key in ('profit_asc', 'profit_desc') then
    perform private.require_permission('finance.read');
  end if;
  if p_month is not null and p_month not between 1 and 12 then
    raise exception 'the month must be 1 to 12' using errcode = '22023';
  end if;
  if p_year is not null and p_year not between 2020 and 2100 then
    raise exception 'the year must be between 2020 and 2100' using errcode = '22023';
  end if;
  if (p_from is not null and p_from not between date '2020-01-01' and date '2100-12-31')
     or (p_to is not null and p_to not between date '2020-01-01' and date '2100-12-31') then
    raise exception 'the dates must be between 2020 and 2100' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'the start date must not be after the end date' using errcode = '22023';
  end if;
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- The period the orders were PLACED in, as exact instants: from (inclusive) to (exclusive), midnight to midnight in Qatar (UTC+3, no daylight saving).
  if by_range then
    from_ts := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Qatar' end;
    to_ts := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Qatar' end;
  elsif p_year is not null or p_month is not null then
    eff_year := coalesce(p_year, extract(year from today)::integer);
    eff_month := p_month;
    if eff_month is null then
      first_day := make_date(eff_year, 1, 1);
      after_day := make_date(eff_year + 1, 1, 1);
    else
      first_day := make_date(eff_year, eff_month, 1);
      after_day := (first_day + interval '1 month')::date;
    end if;
    from_ts := first_day::timestamp at time zone 'Asia/Qatar';
    to_ts := after_day::timestamp at time zone 'Asia/Qatar';
  end if;

  select count(*) into total
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where (status_code is null or o.status = status_code)
    and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
    and (from_ts is null or o.created_at >= from_ts)
    and (to_ts is null or o.created_at < to_ts);

  pages := greatest(1, ceil(total::numeric / size)::integer);
  page := least(greatest(coalesce(p_page, 1), 1), pages);

  with f as (
    select o.id, o.order_ref, o.created_at, o.net_payable_minor, c.full_name as customer_name,
           coalesce(r.cost_state, 'missing') as cost_state,
           -- No entry at all: the cost is UNKNOWN (null), never zero.
           case when r.order_id is null then null else coalesce(r.actual_minor, 0) + coalesce(r.estimated_minor, 0) end as cost_minor
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join private.order_cost_rollup() r on fin and r.order_id = o.id
    where (status_code is null or o.status = status_code)
      and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
      and (from_ts is null or o.created_at >= from_ts)
      and (to_ts is null or o.created_at < to_ts)
  ),
  ranked as (
    select f.*,
           case when f.cost_minor is null then null else f.net_payable_minor - f.cost_minor end as profit_minor,
           row_number() over (
             order by
               case when sort_key = 'price_asc' then f.net_payable_minor end asc,
               case when sort_key = 'price_desc' then f.net_payable_minor end desc,
               case when sort_key = 'profit_asc' then (case when f.cost_minor is null then null else f.net_payable_minor - f.cost_minor end) end asc nulls last,
               case when sort_key = 'profit_desc' then (case when f.cost_minor is null then null else f.net_payable_minor - f.cost_minor end) end desc nulls last,
               case when sort_key = 'oldest' then f.created_at end asc,
               case when sort_key <> 'oldest' then f.created_at end desc,
               case when sort_key = 'oldest' then f.id end asc,
               case when sort_key <> 'oldest' then f.id end desc) as rn
    from f
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('id', x.id, 'order_ref', x.order_ref, 'customer_name', x.customer_name, 'net_payable_minor', x.net_payable_minor, 'created_at', x.created_at)
           || case when fin then jsonb_build_object('cost_minor', x.cost_minor, 'cost_state', x.cost_state, 'profit_minor', x.profit_minor, 'profit_is_provisional', x.cost_state <> 'complete') else '{}'::jsonb end
           || case when rcp then jsonb_build_object('receipt_count', rr.n, 'receipts', rr.list) else '{}'::jsonb end
           order by x.rn), '[]'::jsonb)
    into rows
  from (select * from ranked where ranked.rn > (page - 1) * size and ranked.rn <= page::bigint * size) x
  left join lateral (
    select count(*)::integer as n,
           coalesce(jsonb_agg(jsonb_build_object('id', rc.id, 'file_name', rc.file_name, 'size_bytes', rc.size_bytes, 'uploaded_at', rc.uploaded_at) order by rc.uploaded_at desc, rc.id), '[]'::jsonb) as list
    from private.order_receipts rc
    where rcp and rc.order_id = x.id and rc.status = 'active'
  ) rr on true;

  select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb) into years
  from (
    select extract(year from o.created_at at time zone 'Asia/Qatar')::integer as y from public.orders o
    union select extract(year from today)::integer
  ) s;

  return jsonb_build_object(
    'total', total, 'page', page, 'pages', pages, 'page_size', size,
    'first', case when total = 0 then 0 else (page - 1) * size + 1 end,
    'last', case when total = 0 then 0 else least(page::bigint * size, total) end,
    'sort', sort_key,
    'can_see_finance', fin, 'can_see_receipts', rcp, 'can_manage_receipts', private.has_permission('payments.record'),
    'filters', jsonb_build_object(
      'search', q, 'status', status_code,
      'year', eff_year, 'month', eff_month, 'from', p_from, 'to', p_to,
      'range_overrides_period', by_range and (p_year is not null or p_month is not null)),
    'years', years,
    'rows', rows);
end;
$$;

comment on function admin.list_orders_overview(text, text, integer, integer, date, date, text, integer, integer) is
  'Staff Orders page: one page of orders (number, customer, order price = what the customer pays, placed date) with cost and profit only for finance.read and the attached receipts only for payments.read. Sorts: newest, oldest, price and profit (profit needs finance.read; unknown profit sorts last).';
comment on table private.order_receipts is 'PDF receipts attached to orders. Private, append-only: a receipt is removed (kept, marked), never deleted or edited. Reached only through the admin.*_order_receipt functions.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges: signed-in staff sessions and the staff gateway only; never anon, never PUBLIC.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.list_orders_overview(text, text, integer, integer, date, date, text, integer, integer)',
    'admin.add_order_receipt(uuid, uuid, text, bytea)',
    'admin.remove_order_receipt(uuid, text)',
    'admin.get_order_receipt(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated, m1_staff_gateway', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Self-check: a mistake here fails the migration (one transaction, so nothing is left half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.list_orders_overview(text, text, integer, integer, date, date, text, integer, integer)',
    'admin.add_order_receipt(uuid, uuid, text, bytea)',
    'admin.remove_order_receipt(uuid, text)',
    'admin.get_order_receipt(uuid)'
  ] loop
    if to_regprocedure(f) is null then
      raise exception 'the function % must exist after this migration', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') or has_function_privilege('service_role', f, 'execute') then
      raise exception '% must not be executable by anon, PUBLIC or service_role', f;
    end if;
    if not has_function_privilege('m1_staff_gateway', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% must be executable by signed-in staff sessions and the staff gateway', f;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'private.order_receipts'::regclass) then
    raise exception 'row level security must be on for private.order_receipts';
  end if;
  if has_table_privilege('anon', 'private.order_receipts', 'select') or has_table_privilege('authenticated', 'private.order_receipts', 'select')
     or has_table_privilege('service_role', 'private.order_receipts', 'select') or has_table_privilege('public', 'private.order_receipts', 'select') then
    raise exception 'private.order_receipts must not be readable through the customer or public API';
  end if;
  if to_regprocedure('admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer)') is null
     or to_regprocedure('admin.list_orders(text, text, integer, integer)') is null then
    raise exception 'the earlier Orders functions must still exist; this migration does not replace them';
  end if;
  if private.receipt_file_name('C:\fakepath\Receipt "7".PDF') <> 'Receipt 7.pdf'
     or private.receipt_file_name('../../etc/passwd') <> 'passwd.pdf'
     or private.receipt_file_name('') <> 'receipt.pdf' then
    raise exception 'the receipt file name cleaning is not what the screens rely on';
  end if;
end;
$$;
