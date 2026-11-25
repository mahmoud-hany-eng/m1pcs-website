-- Orders page: filtering, sorting, counting and paging, all in the database.
--
-- WHY A NEW FUNCTION. admin.list_orders (status, search, limit, offset) is what every website built so far calls. It can only filter by status and
-- search, orders by the date placed, and returns at most the rows asked for with no total, so the screen could neither say "1-5 of 23" nor
-- sort by price nor limit by date without loading a hundred orders and slicing them in the browser. This migration ADDS admin.list_orders_page and
-- changes nothing else: list_orders is not touched, so the website that is live today and every earlier Preview keep working exactly as they do.
--
-- WHAT IT DOES (and the website passes in nothing but the choices the owner made; the database does all of it)
--   * search     order number, customer name or customer code (the same match as list_orders)
--   * status     exactly one status code, or any
--   * period     the date the order was PLACED (created_at), in Qatar time (Asia/Qatar, UTC+3, no daylight saving):
--                  - year and/or month (a month with no year means that month of the current Qatar year),
--                  - or a custom range of Qatar calendar dates, INCLUSIVE at both ends, either end optional.
--                A custom range takes precedence: when either date is given, the year and month are ignored (and the answer says so).
--                This has nothing to do with the financial report, which groups by the COMPLETION date.
--   * sort       newest (default), oldest, price_asc, price_desc. Price is what the customer has to PAY:
--                total - discount - redeemed loyalty credit (the stored net_payable_minor), never a cost or a profit. Equal values fall back to the
--                date placed (newest first) and then to the order id, so a page boundary never repeats or skips an order.
--   * paging     a page number and a page size (the screen offers 5, 10 and 25; 5 is the default). The page is clamped to the last page that
--                exists, and the answer carries the total, the page count and "first-last" so the screen can say "Showing 1-5 of 23".
--   * years      the years in which orders were placed (newest first, always including the current Qatar year) for the year selector.
--
-- WHAT IT NEVER RETURNS: a cost, a margin, a profit, a supplier or a private note. The rows have exactly the fields list_orders returns.
--
-- SQLSTATEs: 42501 no permission (orders.read), 22023 an invalid choice (written for staff). Read-only (STABLE). Rerunnable.

create or replace function admin.list_orders_page(
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
begin
  perform private.require_permission('orders.read');
  if sort_key not in ('newest', 'oldest', 'price_asc', 'price_desc') then
    raise exception 'sort must be newest, oldest, price_asc or price_desc' using errcode = '22023';
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

  -- The period the orders were PLACED in, as exact instants: from (inclusive) to (exclusive), midnight to midnight in Qatar.
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

  select coalesce(jsonb_agg((to_jsonb(t) - 'rn') order by t.rn), '[]'::jsonb) into rows
  from (
    select row_number() over (
             order by
               case when sort_key = 'price_asc' then o.net_payable_minor end asc,
               case when sort_key = 'price_desc' then o.net_payable_minor end desc,
               case when sort_key = 'oldest' then o.created_at end asc,
               case when sort_key <> 'oldest' then o.created_at end desc,
               case when sort_key = 'oldest' then o.id end asc,
               case when sort_key <> 'oldest' then o.id end desc) as rn,
           o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.deposit_required_minor,
           (o.deposit_fixed_at is not null) as deposit_fixed,
           (o.deposit_fixed_at is not null and o.amount_paid_minor >= o.deposit_required_minor) as deposit_received,
           o.amount_paid_minor, o.balance_due_minor,
           o.discount_minor, o.loyalty_points_redeemed, o.loyalty_credit_minor, o.net_payable_minor,
           o.workflow_version, o.fulfillment_type,
           o.created_at, c.id as customer_id, c.full_name as customer_name, c.customer_code
    from public.orders o
    join public.customers c on c.id = o.customer_id
    join public.order_statuses s on s.code = o.status
    where (status_code is null or o.status = status_code)
      and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
      and (from_ts is null or o.created_at >= from_ts)
      and (to_ts is null or o.created_at < to_ts)
    order by rn
    limit size offset (page - 1) * size
  ) t;

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
    'filters', jsonb_build_object(
      'search', q, 'status', status_code,
      'year', eff_year, 'month', eff_month, 'from', p_from, 'to', p_to,
      'range_overrides_period', by_range and (p_year is not null or p_month is not null)),
    'years', years,
    'rows', rows);
end;
$$;

comment on function admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer) is
  'Staff Orders list: filter by search, status and the Qatar-local date an order was placed (month/year or an inclusive range), sort by date or by what the customer has to pay, with a total and page numbers. Read-only. admin.list_orders is unchanged.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges: signed-in staff sessions and the staff gateway only; never anon, never PUBLIC.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer) from public, anon, service_role;
grant execute on function admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer) to authenticated, m1_staff_gateway;

-- ---------------------------------------------------------------------------------------------------------------
-- Self-check: a mistake here fails the migration (one transaction, so nothing is left half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f constant text := 'admin.list_orders_page(text, text, integer, integer, date, date, text, integer, integer)';
begin
  if to_regprocedure(f) is null then
    raise exception 'the function % must exist after this migration', f;
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') or has_function_privilege('service_role', f, 'execute') then
    raise exception '% must not be executable by anon, PUBLIC or service_role', f;
  end if;
  if not has_function_privilege('m1_staff_gateway', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
    raise exception '% must be executable by signed-in staff sessions and the staff gateway', f;
  end if;
  if to_regprocedure('admin.list_orders(text, text, integer, integer)') is null then
    raise exception 'the earlier admin.list_orders must still exist; this migration does not replace it';
  end if;
  -- Qatar calendar days: midnight 1 November in Qatar (UTC+3) is 21:00 UTC on 31 October, and the day after 30 November starts at 21:00 UTC on 30 November.
  if (date '2026-11-01')::timestamp at time zone 'Asia/Qatar' <> timestamptz '2026-10-31 21:00:00+00'
     or ((date '2026-11-30') + 1)::timestamp at time zone 'Asia/Qatar' <> timestamptz '2026-11-30 21:00:00+00' then
    raise exception 'the Qatar day boundaries are not what the Orders filter relies on';
  end if;
end;
$$;
