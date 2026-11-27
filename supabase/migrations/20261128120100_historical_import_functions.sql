-- PLAT-0008, historical orders import, migration 2 of 2: the owner's functions.
--
-- Every function below is in schema admin, SECURITY DEFINER with a pinned search path, and asks for the permission `import.manage` (held by the owner
-- role only, and by nobody without the second factor: private.has_permission applies the MFA policy) as its FIRST statement. They are granted to
-- signed-in sessions and to the staff gateway only; never to anon, PUBLIC or service_role. Nothing here sends an email, creates an Auth account or
-- issues a claim code: the importer creates customer PROFILES (no password, no login) that the existing one-time claim code links to an account later.
--
-- The shape of an import:
--   admin.hist_stage_batch      the website parsed the file; the database re-validates every row, fixes each purchase's identity (a fingerprint that
--                               no re-upload or re-ordering can change), skips what was already imported, and keeps the batch as STAGED. Nothing in
--                               orders, customers, costs or loyalty is touched.
--   admin.hist_get_batch        everything the owner reviews: rows, customers, what needs a decision, the totals, the loyalty to be awarded.
--   admin.hist_update_row / hist_set_row_decision / hist_merge_groups / hist_set_group_customer / hist_resolve_flag    the owner's decisions.
--   admin.hist_commit_batch     ONE transaction: the customers, the orders, their costs, the completion records, the loyalty awards, the provenance.
--                               All or nothing. Idempotent: committing the same batch again returns the same result and changes nothing.
--                               With p_dry_run it does all of it, reports it, and rolls it back.
--   admin.hist_*attachment*     original PDFs and PNGs, private, validated, classified; a missing one never blocks an import.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------------------------------------------

-- The matching key of a phone number: the digits with the country code, no plus. The website applies the same rules (src/lib/staff/historical/normalize.ts;
-- a test compares them on a table of cases). Returns '' for no number and NULL for one that cannot be read.
create or replace function private.hist_phone_key(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := translate(btrim(coalesce(p_raw, '')), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  digits text;
  intl boolean;
begin
  s := btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g'));
  if s = '' then
    return '';
  end if;
  if s !~ '^\+?[0-9 ()\-.]+$' then
    return null;
  end if;
  digits := regexp_replace(s, '[^0-9]', '', 'g');
  intl := left(s, 1) = '+';
  if not intl and left(digits, 2) = '00' then
    digits := substr(digits, 3);
    intl := true;
  end if;
  if not intl and length(digits) = 8 then
    digits := '974' || digits;
  end if;
  if length(digits) < 7 or length(digits) > 15 then
    return null;
  end if;
  if left(digits, 3) = '974' and length(digits) <> 11 then
    return null;
  end if;
  return digits;
end;
$$;
revoke all on function private.hist_phone_key(text) from public;

-- A name folded loosely, to compare a name in the export with the name of a customer who already exists: case, spaces and the usual punctuation are ignored.
-- This is deliberately weaker than the website's own name key (normalize.ts): it is only ever used to RAISE a question for the owner (never to merge or to
-- skip anything), where a missed match costs more than an extra one. An empty result matches nothing.
create or replace function private.hist_name_fold(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]''".,_()-]+', '', 'g'))
$$;
revoke all on function private.hist_name_fold(text) from public;

-- A purchase's identity, and the identity of every row (for the batch's content hash). Two rows with exactly the same values are two purchases,
-- numbered in row order; which of them is which never matters. The text is the one the website builds (purchaseCanonical in normalize.ts).
create or replace function private.hist_signatures(p_rows jsonb)
returns table (rn integer, kind text, occ integer, fingerprint text, sig text)
language sql
immutable
set search_path = ''
as $$
  with src as (
    select (e ->> 'row_number')::integer as rn, e ->> 'kind' as kind, coalesce(e ->> 'name_key', '') as name_key, coalesce(e ->> 'phone_key', '') as phone_key,
           e ->> 'happened_on' as happened_on, e ->> 'revenue_minor' as revenue, e ->> 'cost_minor' as cost
    from jsonb_array_elements(p_rows) e
  ), base as (
    select s.*,
           case when s.kind = 'purchase' then concat_ws('|', 'v1', s.name_key, s.phone_key, s.happened_on, s.revenue, coalesce(s.cost, '-'))
                when s.kind = 'ad_expense' then concat_ws('|', 'ad', s.happened_on, coalesce(s.cost, '-'))
                else concat_ws('|', 'x', s.kind, s.name_key, coalesce(s.happened_on, ''), coalesce(s.revenue, ''), coalesce(s.cost, '')) end as base
    from src s
  ), numbered as (
    select b.*, (row_number() over (partition by b.base order by b.rn))::integer as occ from base b
  )
  select n.rn, n.kind, n.occ,
         case when n.kind = 'purchase' then encode(sha256(convert_to(n.base || '|' || n.occ::text, 'UTF8')), 'hex') end,
         n.base || '|' || n.occ::text
  from numbered n
$$;
revoke all on function private.hist_signatures(jsonb) from public;

-- Checks one row the website sends (at staging and at a correction). Raises 22023 with a message for staff on the first problem. The website has
-- already read and cleaned the file; this is the database not taking that on trust.
create or replace function private.hist_check_row(e jsonb, p_today date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text := e ->> 'kind';
  nm text := e ->> 'customer_name';
  nk text := coalesce(e ->> 'name_key', '');
  ph text := e ->> 'phone';
  pk text := coalesce(e ->> 'phone_key', '');
  d date;
  v jsonb;
  f text;
  i jsonb;
begin
  if jsonb_typeof(e) <> 'object' or (e ->> 'row_number') !~ '^[0-9]{1,6}$' or (e ->> 'row_number')::integer < 2 then
    raise exception 'a row has no valid row number' using errcode = '22023';
  end if;
  if k is null or k not in ('purchase', 'ad_expense', 'invalid_summary', 'invalid') then
    raise exception 'row %: unknown kind', e ->> 'row_number' using errcode = '22023';
  end if;
  if nm is not null and (char_length(nm) not between 1 and 120 or nm ~ '[\x00-\x1f\x7f]') then
    raise exception 'row %: the customer name is not valid', e ->> 'row_number' using errcode = '22023';
  end if;
  if char_length(nk) > 160 or nk ~ '[|\x00-\x1f]' then
    raise exception 'row %: the name key is not valid', e ->> 'row_number' using errcode = '22023';
  end if;
  if ph is null then
    if pk <> '' then
      raise exception 'row %: a phone key without a phone number', e ->> 'row_number' using errcode = '22023';
    end if;
  elsif ph !~ '^\+[0-9]{7,15}$' or pk <> regexp_replace(ph, '[^0-9]', '', 'g') or private.hist_phone_key(ph) is distinct from pk then
    raise exception 'row %: the phone number is not valid', e ->> 'row_number' using errcode = '22023';
  end if;
  if e ->> 'happened_on' is not null then
    if (e ->> 'happened_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'row %: the date is not valid', e ->> 'row_number' using errcode = '22023';
    end if;
    d := (e ->> 'happened_on')::date;
    if d < date '2020-01-01' or d > p_today then
      raise exception 'row %: the date must be between 2020 and today (Qatar)', e ->> 'row_number' using errcode = '22023';
    end if;
  end if;
  foreach f in array array['revenue_minor', 'cost_minor', 'profit_minor'] loop
    v := e -> f;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^-?[0-9]{1,11}$' then
        raise exception 'row %: % must be a whole number of minor units', e ->> 'row_number', f using errcode = '22023';
      end if;
    end if;
  end loop;
  if k = 'purchase' then
    if nm is null or nk = '' or d is null or (e ->> 'revenue_minor') is null or (e ->> 'revenue_minor')::bigint <= 0 then
      raise exception 'row %: a purchase needs a name, a date and a revenue above zero', e ->> 'row_number' using errcode = '22023';
    end if;
    if (e ->> 'cost_minor') is not null and (e ->> 'cost_minor')::bigint < 0 then
      raise exception 'row %: a cost cannot be negative', e ->> 'row_number' using errcode = '22023';
    end if;
    if (e ->> 'cost_minor') is not null and (e ->> 'profit_minor') is not null
       and (e ->> 'profit_minor')::bigint <> (e ->> 'revenue_minor')::bigint - (e ->> 'cost_minor')::bigint then
      raise exception 'row %: the profit is not revenue minus cost', e ->> 'row_number' using errcode = '22023';
    end if;
  end if;
  if k = 'ad_expense' and ((e ->> 'cost_minor') is null or (e ->> 'cost_minor')::bigint < 0 or coalesce((e ->> 'revenue_minor')::bigint, 0) <> 0) then
    raise exception 'row %: an advertising expense needs a cost and no revenue', e ->> 'row_number' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(e -> 'issues'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'issues', '[]'::jsonb)) > 40 then
    raise exception 'row %: the issues are not valid', e ->> 'row_number' using errcode = '22023';
  end if;
  for i in select x from jsonb_array_elements(coalesce(e -> 'issues', '[]'::jsonb)) x loop
    if jsonb_typeof(i) <> 'object' or (i ->> 'severity') not in ('error', 'warning', 'info') or coalesce(i ->> 'code', '') = '' then
      raise exception 'row %: an issue is not valid', e ->> 'row_number' using errcode = '22023';
    end if;
  end loop;
  if k = 'purchase' and exists (select 1 from jsonb_array_elements(coalesce(e -> 'issues', '[]'::jsonb)) x where x ->> 'severity' = 'error') then
    raise exception 'row %: a purchase with an error is not importable; send it as invalid', e ->> 'row_number' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(e -> 'attachments'), 'array') <> 'array' or jsonb_array_length(coalesce(e -> 'attachments', '[]'::jsonb)) > 20 then
    raise exception 'row %: too many attachment references', e ->> 'row_number' using errcode = '22023';
  end if;
  for i in select x from jsonb_array_elements(coalesce(e -> 'attachments', '[]'::jsonb)) x loop
    if jsonb_typeof(i) <> 'object' or char_length(coalesce(i ->> 'file_name', '')) not between 1 and 120 or (i ->> 'file_name') ~ '[\x00-\x1f\x7f/\\]'
       or coalesce(i ->> 'ext', '') not in ('pdf', 'png', 'other')
       or (i ->> 'ref' is not null and ((i ->> 'ref') !~ '^https://' or char_length(i ->> 'ref') > 2000))
       or char_length(coalesce(i ->> 'host', '')) > 255 then
      raise exception 'row %: an attachment reference is not valid', e ->> 'row_number' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function private.hist_check_row(jsonb, date) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. What still needs the owner: the flags. Computed on demand from the rows, groups and decisions, so they are never stale.
--    severity 'error' blocks the commit until it is resolved; 'warning' and 'info' are shown and never block.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.hist_flags(p_batch uuid)
returns table (flag_key text, kind text, severity text, row_id uuid, group_id uuid, other_group_id uuid, existing_customer_id uuid, message text, resolved boolean, resolution text)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    -- the customers (groups that have not been merged into another) that have at least one purchase to import
    select eg.* from private.historical_import_groups eg
    where eg.batch_id = p_batch and eg.merged_into is null
      and exists (select 1 from private.historical_import_rows r join private.historical_import_groups rg on rg.id = r.group_id
                  where r.batch_id = p_batch and r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped' and coalesce(rg.merged_into, rg.id) = eg.id)
  ), res as (
    select x.flag_key, x.resolution from private.historical_import_resolutions x where x.batch_id = p_batch
  ), oc as materialized (
    -- every order a row of this import could be a second copy of: any order that is not cancelled (a website order, or one imported earlier), with the facts
    -- the comparison needs worked out once per order. A historical order is dated by its completion day only (its created_at is the day it was imported);
    -- a website order spans the days from when it was placed to when it was completed.
    select o.id as order_id, o.order_ref, o.origin, c.customer_code, o.net_payable_minor as net_minor,
           coalesce(private.hist_phone_key(c.phone), '') as phone_key,
           private.hist_name_fold(c.full_name) as name_fold,
           ir.phone_key as src_phone_key,
           ir.name_key as src_name_key,
           ho.cost_minor as src_cost_minor,
           (case when o.origin = 'historical_import' then (o.completed_at at time zone 'Asia/Qatar')::date else (o.created_at at time zone 'Asia/Qatar')::date end) as day_a,
           ((coalesce(o.completed_at, o.created_at)) at time zone 'Asia/Qatar')::date as day_b
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join private.historical_orders ho on ho.order_id = o.id
    left join private.historical_import_rows ir on ir.id = ho.row_id
    where o.status <> 'cancelled'
  ), m as (
    -- The same purchase uploaded again with one value corrected has a NEW fingerprint (the fingerprint includes the values), and a purchase that was
    -- already agreed on the website may be written down with another phone, another spelling or another date. So a purchase is compared with every order on
    -- five signals, each independent of the others: the phone, the name, the amount actually paid, the date (within three days of the order's own days) and
    -- the direct cost (only for an order that was imported, the only kind that has a cost from a file).
    select r.id as row_id, x.order_id, x.order_ref, x.origin, x.customer_code, s.s_phone, s.s_name, s.s_amount, s.s_date, s.s_cost
    from private.historical_import_rows r
    join oc x on true
    cross join lateral (
      select
        -- every signal is a plain true or false, never null (a missing value must count as "does not match", not wipe out the whole sum)
        coalesce(r.phone_key <> '' and (x.phone_key = r.phone_key or coalesce(x.src_phone_key = r.phone_key, false)), false) as s_phone,
        coalesce((x.name_fold <> '' and x.name_fold = private.hist_name_fold(r.customer_name)) or coalesce(x.src_name_key = r.name_key, false), false) as s_name,
        coalesce(x.net_minor = r.revenue_minor, false) as s_amount,
        coalesce(r.happened_on between (least(x.day_a, x.day_b) - 3) and (greatest(x.day_a, x.day_b) + 3), false) as s_date,
        coalesce(x.src_cost_minor is not null and r.cost_minor is not null and x.src_cost_minor = r.cost_minor, false) as s_cost,
        coalesce(r.happened_on in (x.day_a, x.day_b), false) as s_day
    ) s
    where r.batch_id = p_batch and r.kind = 'purchase' and r.decision = 'import' and r.status = 'staged'
      and (
        -- somebody it could be (the same phone or the same name) and at least three of the five signals agree: one corrected value, or two, still leaves three
        ((s.s_phone or s.s_name) and (s.s_phone::int + s.s_name::int + s.s_amount::int + s.s_date::int + s.s_cost::int) >= 3)
        -- nobody it could be, but the amount, the day and the direct cost are all the same: a customer whose name AND phone were both corrected looks exactly like this
        or (s.s_amount and s.s_day and s.s_cost)
      )
  )
  -- a row that cannot be imported as it is: correct it or skip it
  select 'row_invalid:' || r.id::text, 'row_invalid'::text, 'error'::text, r.id, null::uuid, null::uuid, null::uuid,
         coalesce((select i ->> 'message' from jsonb_array_elements(r.issues) i where i ->> 'severity' = 'error' limit 1), 'This row cannot be imported as it is.'),
         false, null::text
  from private.historical_import_rows r where r.batch_id = p_batch and r.kind = 'invalid' and r.decision = 'import'
  union all
  -- the same purchase was imported before (any batch): skipped automatically, never imported or rewarded twice
  select 'already_imported:' || r.id::text, 'already_imported', 'info', r.id, null, null, null,
         'This purchase was already imported earlier and is skipped; it will not be imported or rewarded again.', true, null
  from private.historical_import_rows r where r.batch_id = p_batch and r.kind = 'purchase' and r.decision = 'skip' and r.skip_reason like 'already imported%'
  union all
  -- a purchase that may be a second copy of an order that already exists (imported earlier, or agreed on the website): the owner decides, per order it resembles.
  -- Skipping it is "it is the same purchase"; "import anyway" is "it is a different one". The decision is asked again at the moment of confirming, so an
  -- order that appeared after the review (another import, a website order) is a new question, never an answer already given.
  select 'possible_duplicate:' || m.row_id::text || ':' || m.order_id::text, 'possible_duplicate', 'error', m.row_id, null, null, null,
         'This purchase looks like ' || case when m.origin = 'historical_import' then 'one that was already imported' else 'an order that is already on the website' end
         || ' (' || m.order_ref || ', customer ' || m.customer_code || '): '
         || case when m.s_phone or m.s_name
                 then concat_ws(', ', case when m.s_phone then 'the same phone number' end, case when m.s_name then 'the same name' end,
                                case when m.s_amount then 'the same amount' end, case when m.s_date then 'a date within three days' end,
                                case when m.s_cost then 'the same direct cost' end)
                 else 'no customer detail matches, but the amount, the day and the direct cost are all the same' end
         || '. If it is the same purchase, skip it: importing it again would count it, and reward it, a second time (to correct an order that exists, use its cost editor or a loyalty adjustment). If it is a different purchase, confirm that.',
         rs.resolution is not null, rs.resolution
  from m
  left join res rs on rs.flag_key = 'possible_duplicate:' || m.row_id::text || ':' || m.order_id::text
  union all
  -- identical rows inside one file: two purchases (a customer can buy two of the same thing on one day), never merged and never dropped, but worth a look
  select 'identical_rows:' || md5(concat_ws('|', r.name_key, r.phone_key, r.happened_on::text, r.revenue_minor::text, coalesce(r.cost_minor::text, '-'))),
         'identical_rows', 'warning', (array_agg(r.id order by r.row_number))[1], null, null, null,
         count(*)::text || ' rows of the file are identical (the same customer, date, revenue and cost). They are imported as ' || count(*)::text
         || ' separate purchases, each with its own points. If one of them is a copy made by mistake, skip it.',
         true, null
  from private.historical_import_rows r
  where r.batch_id = p_batch and r.kind = 'purchase' and r.decision = 'import' and r.status = 'staged'
  group by r.name_key, r.phone_key, r.happened_on, r.revenue_minor, r.cost_minor
  having count(*) > 1
  union all
  -- different names, one phone number: one person spelled two ways, or two people sharing a phone?
  select 'shared_phone:' || a.phone_key, 'shared_phone', 'error', null, (array_agg(a.id order by a.group_no))[1], (array_agg(b.id order by b.group_no))[1], null,
         'Different names share one phone number. They may be one person written two ways, or different people (a family, a shared phone). A phone number alone is not proof of who someone is. Merge them or keep them separate.',
         rs.resolution is not null, rs.resolution
  from g a join g b on a.phone_key <> '' and a.phone_key = b.phone_key and a.name_key <> b.name_key and a.group_no < b.group_no
  left join res rs on rs.flag_key = 'shared_phone:' || a.phone_key
  group by a.phone_key, rs.resolution
  union all
  -- one name, several phone numbers (or with and without one)
  select 'same_name:' || a.name_key, 'same_name_other_phone', 'error', null, (array_agg(a.id order by a.group_no))[1], (array_agg(b.id order by b.group_no))[1], null,
         'The same name appears with different phone numbers (or with and without one). They may be one customer with two numbers, or two people. Merge them or keep them separate.',
         rs.resolution is not null, rs.resolution
  from g a join g b on a.name_key = b.name_key and a.group_no < b.group_no and a.phone_key <> b.phone_key
  left join res rs on rs.flag_key = 'same_name:' || a.name_key
  group by a.name_key, rs.resolution
  union all
  select 'missing_phone:' || a.id::text, 'missing_phone', 'warning', null, a.id, null, null,
         'There is no phone number for this customer, so they cannot be matched with another record; a separate profile is created.', true, null
  from g a where a.phone_key = ''
  union all
  -- a customer already exists with the same phone number. Never linked automatically: the owner chooses a NEW profile or that EXISTING one.
  select 'existing_customer:' || a.id::text || ':' || c.id::text, case when hc.customer_id is not null then 'previous_import' else 'existing_customer' end,
         case when a.customer_choice is not null or (hc.customer_id is not null and not exists (select 1 from public.customer_accounts ca where ca.customer_id = c.id)) then 'info' else 'error' end,
         null, a.id, null, c.id,
         case when hc.customer_id is not null then 'This customer was created by an earlier import (' || c.customer_code || ').'
              else 'A customer with the same phone number already exists (' || c.customer_code || '). Knowing a phone number is not proof of ownership: create a NEW profile, or explicitly attach these orders to that EXISTING customer.' end,
         a.customer_choice is not null or (hc.customer_id is not null and not exists (select 1 from public.customer_accounts ca where ca.customer_id = c.id)),
         a.customer_choice
  from g a
  join public.customers c on a.phone_key <> '' and private.hist_phone_key(c.phone) = a.phone_key
  left join private.historical_customers hc on hc.customer_id = c.id and hc.name_key = a.name_key and hc.phone_key = a.phone_key
$$;
revoke all on function private.hist_flags(uuid) from public;

-- The figures of a batch: what would be (or was) imported. Computed from the rows, never typed in.
create or replace function private.hist_totals(p_batch uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orders', count(*) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped'),
    'revenue_minor', coalesce(sum(r.revenue_minor) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped'), 0),
    'cost_minor', coalesce(sum(r.cost_minor) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped'), 0),
    'orders_with_cost', count(r.cost_minor) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped'),
    'profit_minor', coalesce(sum(r.revenue_minor - r.cost_minor) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped' and r.cost_minor is not null), 0),
    'points', coalesce(sum(r.points) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped'), 0),
    'loss_orders', count(*) filter (where r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped' and r.cost_minor > r.revenue_minor),
    'customers', (select count(distinct coalesce(g.merged_into, g.id)) from private.historical_import_rows x join private.historical_import_groups g on g.id = x.group_id
                  where x.batch_id = p_batch and x.kind = 'purchase' and x.decision = 'import' and x.status <> 'skipped'),
    'ad_rows', count(*) filter (where r.kind = 'ad_expense'),
    'ad_minor', coalesce(sum(r.cost_minor) filter (where r.kind = 'ad_expense'), 0),
    'invalid_summary_rows', count(*) filter (where r.kind = 'invalid_summary'),
    'invalid_rows', count(*) filter (where r.kind = 'invalid' and r.decision = 'import'),
    'skipped_by_owner', count(*) filter (where r.kind in ('purchase', 'invalid') and r.decision = 'skip' and coalesce(r.skip_reason, '') not like 'already imported%'),
    'skipped_already_imported', count(*) filter (where r.kind = 'purchase' and r.decision = 'skip' and r.skip_reason like 'already imported%'),
    'data_rows', count(*))
  from private.historical_import_rows r where r.batch_id = p_batch
$$;
revoke all on function private.hist_totals(uuid) from public;

-- The identity of every purchase of a batch (occurrence, fingerprint) and its points, recomputed from the rows as they stand, then the automatic
-- decisions that follow from it: a purchase already imported is skipped (and un-skipped again if a correction made it a different purchase),
-- and a customer an earlier import created, with no account, is reused.
create or replace function private.hist_refresh(p_batch uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  rate integer;
begin
  select b.qar_per_point_minor into rate from private.historical_import_batches b where b.id = p_batch;
  with calc as (
    select r.id, r.row_number,
           concat_ws('|', 'v1', r.name_key, r.phone_key, to_char(r.happened_on, 'YYYY-MM-DD'), r.revenue_minor::text, coalesce(r.cost_minor::text, '-')) as base
    from private.historical_import_rows r where r.batch_id = p_batch and r.kind = 'purchase'
  ), numbered as (
    select c.*, (row_number() over (partition by c.base order by c.row_number))::integer as occ from calc c
  )
  update private.historical_import_rows r
     set occurrence = n.occ,
         fingerprint = encode(sha256(convert_to(n.base || '|' || n.occ::text, 'UTF8')), 'hex'),
         points = (r.revenue_minor / rate)::integer
    from numbered n where n.id = r.id;
  update private.historical_import_rows r set occurrence = null, fingerprint = null, points = 0
   where r.batch_id = p_batch and r.kind <> 'purchase' and (r.fingerprint is not null or r.occurrence is not null or r.points <> 0);

  update private.historical_import_rows r
     set decision = 'skip', status = 'skipped', skip_reason = 'already imported in an earlier batch'
   where r.batch_id = p_batch and r.kind = 'purchase' and r.status = 'staged' and r.decision = 'import'
     and exists (select 1 from private.historical_orders h where h.source_fingerprint = r.fingerprint);
  update private.historical_import_rows r
     set decision = 'import', status = 'staged', skip_reason = null
   where r.batch_id = p_batch and r.kind = 'purchase' and r.status = 'skipped' and r.skip_reason like 'already imported%'
     and not exists (select 1 from private.historical_orders h where h.source_fingerprint = r.fingerprint);

  update private.historical_import_groups g
     set customer_choice = 'existing', existing_customer_id = hc.customer_id
    from private.historical_customers hc
   where g.batch_id = p_batch and g.merged_into is null and g.customer_choice is null and g.phone_key <> ''
     and hc.name_key = g.name_key and hc.phone_key = g.phone_key
     and not exists (select 1 from public.customer_accounts ca where ca.customer_id = hc.customer_id);
end;
$$;
revoke all on function private.hist_refresh(uuid) from public;

-- The group (customer) a purchase row belongs to: the one with the same name and phone keys in the batch, made if it does not exist.
create or replace function private.hist_group_for(p_batch uuid, p_name text, p_name_key text, p_phone text, p_phone_key text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  gid uuid;
begin
  select g.id into gid from private.historical_import_groups g
   where g.batch_id = p_batch and g.name_key = p_name_key and g.phone_key = p_phone_key order by g.group_no limit 1;
  if gid is null then
    insert into private.historical_import_groups (batch_id, group_no, name_key, phone_key, display_name, phone)
    values (p_batch, coalesce((select max(x.group_no) from private.historical_import_groups x where x.batch_id = p_batch), 0) + 1, p_name_key, p_phone_key, p_name, p_phone)
    returning id into gid;
  end if;
  return gid;
end;
$$;
revoke all on function private.hist_group_for(uuid, text, text, text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Staging
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.hist_stage_batch(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  opts jsonb;
  rows_in jsonb;
  n integer;
  rate integer;
  chash text;
  b private.historical_import_batches%rowtype;
  bid uuid := gen_random_uuid();
  today date := private.qatar_today();
  e jsonb;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload -> 'rows') is distinct from 'array' then
    raise exception 'the import payload is not valid' using errcode = '22023';
  end if;
  rows_in := p_payload -> 'rows';
  opts := coalesce(p_payload -> 'options', '{}'::jsonb);
  n := jsonb_array_length(rows_in);
  if n < 1 or n > 2000 then
    raise exception 'an import needs between 1 and 2000 data rows' using errcode = '22023';
  end if;
  if (opts ->> 'date_format') is not null and (opts ->> 'date_format') not in ('iso', 'dmy', 'mdy') then
    raise exception 'unknown date format' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(opts -> 'notes'), 'array') <> 'array' or jsonb_array_length(coalesce(opts -> 'notes', '[]'::jsonb)) > 40 then
    raise exception 'the notes are not valid' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(rows_in) x loop
    perform private.hist_check_row(e, today);
  end loop;
  if (select count(distinct (x ->> 'row_number')) from jsonb_array_elements(rows_in) x) <> n then
    raise exception 'two rows have the same row number' using errcode = '22023';
  end if;

  rate := (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::integer;
  if rate is null or rate < 1 then
    raise exception 'the loyalty earning policy is missing; the importer needs it to work out the points' using errcode = '55000';
  end if;

  -- The same content (whatever its row order) is the same batch: find it instead of making a second one.
  select encode(sha256(convert_to(string_agg(s.sig, E'\n' order by s.sig), 'UTF8')), 'hex') into chash from private.hist_signatures(rows_in) s;
  select * into b from private.historical_import_batches x where x.content_hash = chash and x.status in ('staged', 'committed') limit 1;
  if found then
    return jsonb_build_object('batch_id', b.id, 'status', b.status, 'reused', true);
  end if;

  perform private.set_write_ctx(true);
  insert into private.historical_import_batches (id, created_by, source_label, parser_version, date_format, date_format_reason, content_hash, qar_per_point_minor, notes)
  values (bid, (select auth.uid()), nullif(left(btrim(coalesce(opts ->> 'source_label', '')), 120), ''), coalesce((opts ->> 'parser_version')::integer, 1),
          opts ->> 'date_format', left(opts ->> 'date_format_reason', 40), chash, rate,
          coalesce((select jsonb_agg(jsonb_build_object('code', left(x ->> 'code', 60), 'severity', x ->> 'severity', 'message', left(x ->> 'message', 300)))
                    from jsonb_array_elements(coalesce(opts -> 'notes', '[]'::jsonb)) x), '[]'::jsonb));

  -- the customers of the file: one group per normalised name and phone
  insert into private.historical_import_groups (batch_id, group_no, name_key, phone_key, display_name, phone)
  select bid, (row_number() over (order by s.first_rn))::integer, s.name_key, s.phone_key, s.display_name, s.phone
  from (
    select coalesce(x ->> 'name_key', '') as name_key, coalesce(x ->> 'phone_key', '') as phone_key,
           (array_agg(x ->> 'customer_name' order by (x ->> 'row_number')::integer))[1] as display_name,
           (array_agg(x ->> 'phone' order by (x ->> 'row_number')::integer) filter (where x ->> 'phone' is not null))[1] as phone,
           min((x ->> 'row_number')::integer) as first_rn
    from jsonb_array_elements(rows_in) x where x ->> 'kind' = 'purchase'
    group by 1, 2
  ) s;

  insert into private.historical_import_rows (batch_id, row_number, kind, customer_name, name_key, phone, phone_key, happened_on, month_label,
                                              revenue_minor, cost_minor, profit_minor, occurrence, fingerprint, points, issues, group_id)
  select bid, (x ->> 'row_number')::integer, x ->> 'kind', x ->> 'customer_name', coalesce(x ->> 'name_key', ''), x ->> 'phone', coalesce(x ->> 'phone_key', ''),
         (x ->> 'happened_on')::date, left(x ->> 'month_label', 40), (x ->> 'revenue_minor')::bigint, (x ->> 'cost_minor')::bigint, (x ->> 'profit_minor')::bigint,
         case when x ->> 'kind' = 'purchase' then sg.occ end, sg.fingerprint,
         case when x ->> 'kind' = 'purchase' then ((x ->> 'revenue_minor')::bigint / rate)::integer else 0 end,
         coalesce((select jsonb_agg(jsonb_build_object('code', left(i ->> 'code', 60), 'severity', i ->> 'severity', 'message', left(coalesce(i ->> 'message', ''), 300),
                                                       'field', left(coalesce(i ->> 'field', ''), 20)))
                   from jsonb_array_elements(coalesce(x -> 'issues', '[]'::jsonb)) i), '[]'::jsonb),
         grp.id
  from jsonb_array_elements(rows_in) x
  join private.hist_signatures(rows_in) sg on sg.rn = (x ->> 'row_number')::integer
  left join private.historical_import_groups grp on grp.batch_id = bid and x ->> 'kind' = 'purchase'
                                                and grp.name_key = coalesce(x ->> 'name_key', '') and grp.phone_key = coalesce(x ->> 'phone_key', '');

  insert into private.historical_import_attachments (batch_id, row_id, position, file_name, declared_ext, source_ref, source_host, source_expiring)
  select bid, r.id, (a.ord)::integer, a.item ->> 'file_name', a.item ->> 'ext', a.item ->> 'ref', nullif(left(coalesce(a.item ->> 'host', ''), 255), ''),
         coalesce((a.item ->> 'expiring')::boolean, false)
  from jsonb_array_elements(rows_in) x
  join private.historical_import_rows r on r.batch_id = bid and r.row_number = (x ->> 'row_number')::integer
  cross join lateral jsonb_array_elements(coalesce(x -> 'attachments', '[]'::jsonb)) with ordinality as a(item, ord)
  where r.kind in ('purchase', 'invalid') and r.status = 'staged';

  perform private.hist_refresh(bid);
  perform private.audit('historical_import.staged', 'import_batch', bid::text,
    jsonb_build_object('rows', n, 'orders', (private.hist_totals(bid) ->> 'orders')::integer));
  perform private.set_write_ctx(false);
  return jsonb_build_object('batch_id', bid, 'status', 'staged', 'reused', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Reading a batch (what the owner reviews) and listing batches
-- ---------------------------------------------------------------------------------------------------------------
-- Reading a STAGED batch first brings it up to date with the database as it is now (a purchase another batch has imported since is skipped here
-- too), so the owner always reviews, and confirms, what a commit would really do. A committed or discarded batch is only read.
create or replace function admin.hist_get_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  flags jsonb;
  blocking integer;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  select * into b from private.historical_import_batches where id = p_batch_id;
  if not found then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  if b.status = 'staged' then
    perform private.set_write_ctx(true);
    perform private.hist_refresh(b.id);
    perform private.set_write_ctx(false);
  end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.kind, f.flag_key), '[]'::jsonb), count(*) filter (where f.severity = 'error' and not f.resolved)::integer
    into flags, blocking from private.hist_flags(b.id) f;
  return jsonb_build_object(
    'batch', jsonb_build_object('id', b.id, 'status', b.status, 'created_at', b.created_at, 'date_format', b.date_format, 'date_format_reason', b.date_format_reason,
                                'qar_per_point_minor', b.qar_per_point_minor, 'notes', b.notes, 'source_label', b.source_label, 'committed_at', b.committed_at,
                                'discarded_at', b.discarded_at),
    'rate_now', (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::integer,
    'totals', private.hist_totals(b.id),
    'flags', flags,
    'blocking', blocking,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'row_number', r.row_number, 'kind', r.kind, 'customer_name', r.customer_name, 'phone', r.phone, 'happened_on', r.happened_on,
        'month_label', r.month_label, 'revenue_minor', r.revenue_minor, 'cost_minor', r.cost_minor, 'profit_minor', r.profit_minor, 'points', r.points,
        'issues', r.issues, 'decision', r.decision, 'skip_reason', r.skip_reason, 'status', r.status, 'corrected', r.corrected,
        'group_id', coalesce(g.merged_into, g.id), 'group_no', coalesce(mg.group_no, g.group_no),
        'order_ref', o.order_ref, 'order_id', r.order_id) order by r.row_number)
      from private.historical_import_rows r
      left join private.historical_import_groups g on g.id = r.group_id
      left join private.historical_import_groups mg on mg.id = g.merged_into
      left join public.orders o on o.id = r.order_id
      where r.batch_id = b.id), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'group_no', g.group_no, 'display_name', g.display_name, 'phone', g.phone, 'merged_into', g.merged_into,
        'customer_choice', g.customer_choice, 'existing_customer_id', g.existing_customer_id,
        'customer_code', c.customer_code,
        'orders', (select count(*) from private.historical_import_rows r join private.historical_import_groups rg on rg.id = r.group_id
                   where r.batch_id = b.id and r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped' and coalesce(rg.merged_into, rg.id) = g.id),
        'points', (select coalesce(sum(r.points), 0) from private.historical_import_rows r join private.historical_import_groups rg on rg.id = r.group_id
                   where r.batch_id = b.id and r.kind = 'purchase' and r.decision = 'import' and r.status <> 'skipped' and coalesce(rg.merged_into, rg.id) = g.id),
        'existing_balance_points', case when g.customer_choice = 'existing' then private.loyalty_balance(g.existing_customer_id) else 0 end)
        order by g.group_no)
      from private.historical_import_groups g
      left join public.customers c on c.id = coalesce(g.customer_id, g.existing_customer_id)
      where g.batch_id = b.id), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'row_id', a.row_id, 'position', a.position, 'file_name', a.file_name, 'declared_ext', a.declared_ext, 'status', a.status,
        'classification', a.classification, 'customer_visible', a.customer_visible, 'source_expiring', a.source_expiring, 'source_host', a.source_host,
        'source_ref', a.source_ref, 'byte_size', a.byte_size, 'mime', a.mime, 'unavailable_reason', a.unavailable_reason) order by a.row_id, a.position)
      from private.historical_import_attachments a where a.batch_id = b.id), '[]'::jsonb),
    'result', b.result);
end;
$$;

create or replace function admin.hist_list_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('import.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'status', b.status, 'created_at', b.created_at, 'committed_at', b.committed_at, 'discarded_at', b.discarded_at,
      'orders', (private.hist_totals(b.id) ->> 'orders')::integer, 'revenue_minor', (private.hist_totals(b.id) ->> 'revenue_minor')::bigint,
      'points', (private.hist_totals(b.id) ->> 'points')::bigint,
      'blocking', (select count(*) from private.hist_flags(b.id) f where f.severity = 'error' and not f.resolved)) order by b.created_at desc)
    from private.historical_import_batches b), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The owner's decisions (only while the batch is staged)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.hist_staged_batch(p_batch uuid)
returns private.historical_import_batches
language plpgsql
volatile
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
begin
  select * into b from private.historical_import_batches where id = p_batch for update;
  if not found then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  if b.status <> 'staged' then
    raise exception 'this import is %: it can no longer be changed', b.status using errcode = '55000';
  end if;
  return b;
end;
$$;
revoke all on function private.hist_staged_batch(uuid) from public;

-- A correction of one row, sent by the website after it re-read the owner's typed values with the same rules as the file. Only a purchase or an
-- invalid row can be corrected; the corrected row is a purchase again only if it has no error.
create or replace function admin.hist_update_row(p_batch_id uuid, p_row_id uuid, p_row jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  r private.historical_import_rows%rowtype;
  today date := private.qatar_today();
  e jsonb;
  gid uuid;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  select * into r from private.historical_import_rows where id = p_row_id and batch_id = b.id for update;
  if not found then
    raise exception 'row not found' using errcode = 'P0002';
  end if;
  if r.kind not in ('purchase', 'invalid') then
    raise exception 'only a purchase or an invalid row can be corrected' using errcode = '55000';
  end if;
  e := p_row || jsonb_build_object('row_number', r.row_number);
  perform private.hist_check_row(e, today);
  if e ->> 'kind' not in ('purchase', 'invalid') then
    raise exception 'a corrected row is a purchase, or still invalid' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  gid := case when e ->> 'kind' = 'purchase'
              then private.hist_group_for(b.id, e ->> 'customer_name', coalesce(e ->> 'name_key', ''), e ->> 'phone', coalesce(e ->> 'phone_key', '')) end;
  update private.historical_import_rows set
    kind = e ->> 'kind', customer_name = e ->> 'customer_name', name_key = coalesce(e ->> 'name_key', ''), phone = e ->> 'phone',
    phone_key = coalesce(e ->> 'phone_key', ''), happened_on = (e ->> 'happened_on')::date, month_label = left(e ->> 'month_label', 40),
    revenue_minor = (e ->> 'revenue_minor')::bigint, cost_minor = (e ->> 'cost_minor')::bigint, profit_minor = (e ->> 'profit_minor')::bigint,
    issues = coalesce((select jsonb_agg(jsonb_build_object('code', left(i ->> 'code', 60), 'severity', i ->> 'severity', 'message', left(coalesce(i ->> 'message', ''), 300),
                                                          'field', left(coalesce(i ->> 'field', ''), 20)))
                       from jsonb_array_elements(coalesce(e -> 'issues', '[]'::jsonb)) i), '[]'::jsonb),
    group_id = gid, corrected = true, decision = 'import', skip_reason = null, status = 'staged',
    -- the purchase shape needs these two while it is a purchase; hist_refresh makes them right a moment later
    occurrence = case when e ->> 'kind' = 'purchase' then 1 end,
    fingerprint = case when e ->> 'kind' = 'purchase' then repeat('0', 64) end
  where id = r.id;
  perform private.hist_refresh(b.id);
  perform private.audit('historical_import.row_corrected', 'import_batch', b.id::text, jsonb_build_object('row_number', r.row_number));
  perform private.set_write_ctx(false);
  return jsonb_build_object('row_id', r.id, 'batch_id', b.id);
end;
$$;

create or replace function admin.hist_set_row_decision(p_batch_id uuid, p_row_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  r private.historical_import_rows%rowtype;
  why text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  if p_decision not in ('import', 'skip') then
    raise exception 'the decision is import or skip' using errcode = '22023';
  end if;
  select * into r from private.historical_import_rows where id = p_row_id and batch_id = b.id for update;
  if not found then
    raise exception 'row not found' using errcode = 'P0002';
  end if;
  if r.kind not in ('purchase', 'invalid') then
    raise exception 'only a purchase or an invalid row can be skipped or restored' using errcode = '55000';
  end if;
  if p_decision = 'skip' and why is null then
    why := 'skipped by the owner';
  end if;
  if p_decision = 'import' and r.skip_reason like 'already imported%' then
    raise exception 'this purchase was already imported; it cannot be imported again' using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_rows set decision = p_decision, skip_reason = case when p_decision = 'skip' then why end,
         status = case when p_decision = 'skip' then 'skipped' else 'staged' end
   where id = r.id;
  perform private.audit('historical_import.row_decision', 'import_batch', b.id::text, jsonb_build_object('row_number', r.row_number, 'decision', p_decision));
  perform private.set_write_ctx(false);
end;
$$;

create or replace function admin.hist_merge_groups(p_batch_id uuid, p_from uuid, p_into uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  a private.historical_import_groups%rowtype;
  t private.historical_import_groups%rowtype;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  select * into a from private.historical_import_groups where id = p_from and batch_id = b.id for update;
  select * into t from private.historical_import_groups where id = p_into and batch_id = b.id for update;
  if a.id is null or t.id is null or a.id = t.id then
    raise exception 'choose two different customers of this import' using errcode = '22023';
  end if;
  if a.merged_into is not null or t.merged_into is not null then
    raise exception 'choose customers that are not already merged into another' using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_groups set merged_into = t.id where id = a.id or merged_into = a.id;
  update private.historical_import_groups set merged_into = null where id = t.id;
  -- the merged customer's own decision no longer matters; the surviving customer's decision stands
  update private.historical_import_groups set customer_choice = null, existing_customer_id = null where id = a.id;
  perform private.hist_refresh(b.id);
  perform private.audit('historical_import.groups_merged', 'import_batch', b.id::text, jsonb_build_object('from_group', a.group_no, 'into_group', t.group_no));
  perform private.set_write_ctx(false);
end;
$$;

create or replace function admin.hist_unmerge_group(p_batch_id uuid, p_group uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  g private.historical_import_groups%rowtype;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  select * into g from private.historical_import_groups where id = p_group and batch_id = b.id for update;
  if not found or g.merged_into is null then
    raise exception 'that customer is not merged into another' using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_groups set merged_into = null where id = g.id;
  perform private.hist_refresh(b.id);
  perform private.audit('historical_import.group_unmerged', 'import_batch', b.id::text, jsonb_build_object('group', g.group_no));
  perform private.set_write_ctx(false);
end;
$$;

-- The customer profile for a group: a NEW one, or an EXISTING one the owner names. The existing one must really match the group's phone number;
-- the match is a hint for the owner, never proof, which is why it is always an explicit choice.
create or replace function admin.hist_set_group_customer(p_batch_id uuid, p_group uuid, p_choice text, p_customer uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  g private.historical_import_groups%rowtype;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  select * into g from private.historical_import_groups where id = p_group and batch_id = b.id for update;
  if not found or g.merged_into is not null then
    raise exception 'customer not found in this import' using errcode = 'P0002';
  end if;
  if p_choice not in ('new', 'existing') then
    raise exception 'the choice is new or existing' using errcode = '22023';
  end if;
  if p_choice = 'existing' then
    if p_customer is null or g.phone_key = '' or not exists (select 1 from public.customers c where c.id = p_customer and private.hist_phone_key(c.phone) = g.phone_key) then
      raise exception 'that customer does not match this phone number' using errcode = '22023';
    end if;
  elsif p_customer is not null then
    raise exception 'a new profile has no existing customer' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_groups set customer_choice = p_choice, existing_customer_id = case when p_choice = 'existing' then p_customer end where id = g.id;
  perform private.audit('historical_import.customer_choice', 'import_batch', b.id::text, jsonb_build_object('group', g.group_no, 'choice', p_choice));
  perform private.set_write_ctx(false);
end;
$$;

create or replace function admin.hist_resolve_flag(p_batch_id uuid, p_flag_key text, p_resolution text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  f record;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  b := private.hist_staged_batch(p_batch_id);
  select * into f from private.hist_flags(b.id) x where x.flag_key = p_flag_key;
  if not found then
    raise exception 'that item no longer needs a decision' using errcode = 'P0002';
  end if;
  if not ((f.kind in ('shared_phone', 'same_name_other_phone') and p_resolution = 'keep_separate')
          or (f.kind = 'possible_duplicate' and p_resolution = 'import_anyway')) then
    raise exception 'that decision does not apply to this item' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  insert into private.historical_import_resolutions (batch_id, flag_key, resolution, note, resolved_by)
  values (b.id, p_flag_key, p_resolution, nullif(left(btrim(coalesce(p_note, '')), 300), ''), (select auth.uid()))
  on conflict (batch_id, flag_key) do update set resolution = excluded.resolution, note = excluded.note, resolved_by = excluded.resolved_by, resolved_at = now();
  perform private.audit('historical_import.flag_resolved', 'import_batch', b.id::text, jsonb_build_object('kind', f.kind, 'resolution', p_resolution));
  perform private.set_write_ctx(false);
end;
$$;

-- Throws a staged import away. Its personal data (names, phones, files) is purged; the batch record, who discarded it and why, stays.
create or replace function admin.hist_discard_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  why text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  if char_length(why) < 3 then
    raise exception 'say why the import is being discarded (at least 3 characters)' using errcode = '22023';
  end if;
  b := private.hist_staged_batch(p_batch_id);
  perform private.set_write_ctx(true);
  update private.historical_import_batches set status = 'discarded', discarded_at = now(), discarded_by = (select auth.uid()), discard_reason = left(why, 300) where id = b.id;
  perform set_config('m1.hist_purge', b.id::text, true);
  delete from private.historical_import_attachments where batch_id = b.id;
  delete from private.historical_import_resolutions where batch_id = b.id;
  delete from private.historical_import_rows where batch_id = b.id;
  update private.historical_import_groups set merged_into = null where batch_id = b.id;
  delete from private.historical_import_groups where batch_id = b.id;
  perform set_config('m1.hist_purge', '', true);
  perform private.audit('historical_import.discarded', 'import_batch', b.id::text, '{}'::jsonb);
  perform private.set_write_ctx(false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The commit: ONE transaction. All of it or none of it. Idempotent: the same batch committed again returns the same result.
-- ---------------------------------------------------------------------------------------------------------------

-- The next reference of a historical order: H-YYMM-NNNNN (the month of its historical date; the number runs across all historical orders).
-- Called inside the commit, which holds the import lock, so two commits can never take the same number.
create or replace function private.next_historical_ref(p_date date)
returns text
language sql
volatile
set search_path = ''
as $$
  select 'H-' || to_char(p_date, 'YYMM') || '-' || lpad((coalesce(max(substr(o.order_ref, 8)::integer), 0) + 1)::text, 5, '0')
  from public.orders o where o.order_ref ~ '^H-[0-9]{4}-[0-9]{5}$'
$$;
revoke all on function private.next_historical_ref(date) from public;

-- p_confirm: {"phrase": "IMPORT 25 ORDERS",
--             "attest": {"date_is_completion_date": true, "revenue_is_final_payable": true, "orders_fully_paid": true, "costs_complete": true|false},
--             "expected": {"orders": 25, "revenue_minor": ..., "cost_minor": ..., "points": ...}}
-- The three statements are the owner's attestation, recorded with who made it and when. "expected" is what the owner was shown: if the batch is
-- not exactly that any more, nothing is imported.
create or replace function admin.hist_commit_batch(p_batch_id uuid, p_confirm jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b private.historical_import_batches%rowtype;
  att jsonb := coalesce(p_confirm -> 'attest', '{}'::jsonb);
  expd jsonb := coalesce(p_confirm -> 'expected', '{}'::jsonb);
  totals jsonb;
  blocking integer;
  rate_now integer;
  uid uuid := (select auth.uid());
  costs_complete boolean;
  today date := private.qatar_today();
  res jsonb;
  g record;
  r record;
  cid uuid;
  cust_code text;
  oid uuid;
  ref text;
  lid uuid;
  pts integer;
  ts timestamptz;
  created_customers integer := 0;
  reused_customers integer := 0;
  n_imported integer := 0;
  points_total bigint := 0;
  per_order jsonb := '[]'::jsonb;
  customer_codes jsonb := '[]'::jsonb;
  reason text;
begin
  perform private.require_permission('import.manage');
  perform pg_advisory_xact_lock(727001);
  select * into b from private.historical_import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  if b.status = 'committed' then
    -- the same import confirmed again (a double click, a retry): the same answer, and nothing else happens
    return b.result || jsonb_build_object('replayed', true);
  end if;
  if b.status <> 'staged' then
    raise exception 'this import was discarded and cannot be committed' using errcode = '55000';
  end if;

  -- 1. what the owner attests: the three statements are required, and the costs statement must be answered either way
  if att -> 'date_is_completion_date' is distinct from 'true'::jsonb or att -> 'revenue_is_final_payable' is distinct from 'true'::jsonb
     or att -> 'orders_fully_paid' is distinct from 'true'::jsonb then
    raise exception 'confirm all three statements: the dates are the completion dates, the revenue is the final amount payable, and the orders were fully paid' using errcode = '22023';
  end if;
  if jsonb_typeof(att -> 'costs_complete') is distinct from 'boolean' then
    raise exception 'say whether the costs in the file are the complete direct costs of each order' using errcode = '22023';
  end if;
  costs_complete := (att ->> 'costs_complete')::boolean;

  -- 2. what is about to happen is exactly what was reviewed
  totals := private.hist_totals(b.id);
  if (totals ->> 'orders')::integer = 0 then
    raise exception 'there is nothing to import in this batch' using errcode = '55000';
  end if;
  if upper(btrim(coalesce(p_confirm ->> 'phrase', ''))) <> 'IMPORT ' || (totals ->> 'orders') || ' ORDERS' then
    raise exception 'type the confirmation exactly: IMPORT % ORDERS', totals ->> 'orders' using errcode = '22023';
  end if;
  if (expd ->> 'orders') is distinct from (totals ->> 'orders') or (expd ->> 'revenue_minor') is distinct from (totals ->> 'revenue_minor')
     or (expd ->> 'cost_minor') is distinct from (totals ->> 'cost_minor') or (expd ->> 'points') is distinct from (totals ->> 'points') then
    raise exception 'the import is no longer what you reviewed (orders, revenue, cost or points differ); reload the page and review it again' using errcode = '55000';
  end if;
  rate_now := (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::integer;
  if rate_now is distinct from b.qar_per_point_minor then
    raise exception 'the loyalty earning rate changed since this import was prepared; prepare it again' using errcode = '55000';
  end if;
  select count(*)::integer into blocking from private.hist_flags(b.id) f where f.severity = 'error' and not f.resolved;
  if blocking > 0 then
    raise exception '% item(s) still need your decision before this can be imported', blocking using errcode = '55000';
  end if;
  if exists (select 1 from private.historical_import_rows x where x.batch_id = b.id and x.kind = 'purchase' and x.decision = 'import' and x.status = 'staged' and x.happened_on > today) then
    raise exception 'a purchase is dated in the future' using errcode = '22023';
  end if;
  if exists (select 1 from private.historical_import_rows x join private.historical_orders h on h.source_fingerprint = x.fingerprint
             where x.batch_id = b.id and x.kind = 'purchase' and x.decision = 'import' and x.status = 'staged') then
    raise exception 'a purchase in this import was imported in the meantime; reload the page' using errcode = '55000';
  end if;

  reason := 'Historical import ' || left(b.id::text, 8) || ': the date was attested by the owner as the completion date';
  perform private.set_write_ctx(true);
  begin
    -- 3. the customers: one profile per person, no password, no account, no email. Existing ones only by the owner's explicit choice.
    for g in
      select eg.* from private.historical_import_groups eg
      where eg.batch_id = b.id and eg.merged_into is null
        and exists (select 1 from private.historical_import_rows x join private.historical_import_groups xg on xg.id = x.group_id
                    where x.batch_id = b.id and x.kind = 'purchase' and x.decision = 'import' and x.status = 'staged' and coalesce(xg.merged_into, xg.id) = eg.id)
      order by eg.group_no
    loop
      if g.customer_choice = 'existing' then
        cid := g.existing_customer_id;
        reused_customers := reused_customers + 1;
      else
        insert into public.customers (full_name, phone, source, marketing_consent, preferred_language)
        values (g.display_name, g.phone, 'whatsapp', false, 'en') returning id, customer_code into cid, cust_code;
        insert into private.historical_customers (customer_id, batch_id, name_key, phone_key) values (cid, b.id, g.name_key, g.phone_key)
        on conflict (name_key, phone_key) where phone_key <> '' do nothing;
        created_customers := created_customers + 1;
        customer_codes := customer_codes || to_jsonb(cust_code);
      end if;
      update private.historical_import_groups set customer_id = cid where id = g.id;
    end loop;

    -- 4. the orders, in date order: delivered, with their private cost, their completion record, their points and their provenance
    for r in
      select x.*, coalesce(xg.merged_into, xg.id) as root_group
      from private.historical_import_rows x join private.historical_import_groups xg on xg.id = x.group_id
      where x.batch_id = b.id and x.kind = 'purchase' and x.decision = 'import' and x.status = 'staged'
      order by x.happened_on, x.row_number
    loop
      select gg.customer_id into cid from private.historical_import_groups gg where gg.id = r.root_group;
      select c.customer_code into cust_code from public.customers c where c.id = cid;
      oid := gen_random_uuid();
      ts := (to_char(r.happened_on, 'YYYY-MM-DD') || ' 12:00:00+03')::timestamptz;
      ref := private.next_historical_ref(r.happened_on);

      perform set_config('m1.historical_import', oid::text, true);
      insert into public.orders (id, order_ref, customer_id, status, total_minor, deposit_required_minor, amount_paid_minor, placed_via, origin, workflow_version, completed_at)
      values (oid, ref, cid, 'delivered', r.revenue_minor, 0, r.revenue_minor, 'whatsapp', 'historical_import', 1, ts);
      perform set_config('m1.historical_import', '', true);

      insert into public.order_items (order_id, position, kind, description, quantity, unit_price_minor)
      values (oid, 1, 'other', 'Historical order (items not recorded)', 1, r.revenue_minor);
      insert into private.order_completions (order_id, completed_at, basis, history_id, gross_minor, discount_minor, loyalty_credit_minor, net_revenue_minor, recorded_by, reason)
      values (oid, ts, 'historical_import', null, r.revenue_minor, 0, 0, r.revenue_minor, uid, left(reason, 500));

      if r.cost_minor is not null then
        perform private.insert_order_cost(oid, jsonb_build_object('category', 'other', 'description', 'Historical direct cost (imported total)', 'amount_minor', r.cost_minor,
                                                                  'cost_kind', 'actual', 'supplier_ref', null, 'incurred_on', to_char(r.happened_on, 'YYYY-MM-DD'), 'notes', null),
                                          null, left(reason, 500));
        if costs_complete then
          insert into private.order_cost_state (order_id, costs_complete, changed_by) values (oid, true, uid);
          insert into private.order_cost_revisions (order_id, cost_id, action, old_values, new_values, reason, actor)
          values (oid, null, 'marked_complete', jsonb_build_object('costs_complete', false), jsonb_build_object('costs_complete', true), left(reason, 500), uid);
        end if;
      end if;

      -- the retroactive award: floor(net revenue / the earning rate), per order, once (the ledger itself allows one award per order)
      pts := (r.revenue_minor / b.qar_per_point_minor)::integer;
      lid := null;
      if pts > 0 then
        insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description)
        values (cid, oid, 'award', pts, 'Points earned on historical order ' || ref) returning id into lid;
        insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by) values (lid, 'Retroactive award for ' || left(reason, 400), uid);
      end if;

      insert into private.historical_orders (order_id, batch_id, row_id, source_fingerprint, source_row_number, historical_date, date_meaning, imported_by,
                                             revenue_minor, cost_minor, points_awarded, loyalty_entry_id)
      values (oid, b.id, r.id, r.fingerprint, r.row_number, r.happened_on, 'completion', uid, r.revenue_minor, r.cost_minor, pts, lid);
      update private.historical_import_rows set status = 'imported', order_id = oid where id = r.id;
      perform private.audit('historical_import.order', 'order', oid::text, jsonb_build_object('batch', b.id, 'points', pts));

      n_imported := n_imported + 1;
      points_total := points_total + pts;
      per_order := per_order || jsonb_build_object('row_number', r.row_number, 'order_ref', ref, 'customer_code', cust_code, 'points', pts);
    end loop;

    -- 5. the report, and the batch becomes committed
    res := jsonb_build_object(
      'batch_id', b.id, 'committed_at', now(),
      'orders', n_imported, 'customers_created', created_customers, 'customers_reused', reused_customers,
      'revenue_minor', (totals ->> 'revenue_minor')::bigint, 'cost_minor', (totals ->> 'cost_minor')::bigint, 'profit_minor', (totals ->> 'profit_minor')::bigint,
      'orders_with_cost', (totals ->> 'orders_with_cost')::integer, 'loss_orders', (totals ->> 'loss_orders')::integer,
      'points', points_total, 'qar_per_point_minor', b.qar_per_point_minor, 'costs_declared_complete', costs_complete,
      'skipped', jsonb_build_object('by_owner', (totals ->> 'skipped_by_owner')::integer, 'already_imported', (totals ->> 'skipped_already_imported')::integer),
      'exclusions', jsonb_build_object('ad_rows', (totals ->> 'ad_rows')::integer, 'ad_minor', (totals ->> 'ad_minor')::bigint,
                                       'invalid_summary_rows', (totals ->> 'invalid_summary_rows')::integer),
      'attachments', jsonb_build_object(
        'total', (select count(*) from private.historical_import_attachments a join private.historical_import_rows x on x.id = a.row_id where x.batch_id = b.id and x.status = 'imported'),
        'pending', (select count(*) from private.historical_import_attachments a join private.historical_import_rows x on x.id = a.row_id where x.batch_id = b.id and x.status = 'imported' and a.status = 'pending')),
      'warnings', coalesce((select jsonb_agg(jsonb_build_object('code', w.code, 'severity', w.severity, 'count', w.n) order by w.severity, w.code)
                            from (select i ->> 'code' as code, i ->> 'severity' as severity, count(*) as n
                                  from private.historical_import_rows x cross join lateral jsonb_array_elements(x.issues) i
                                  where x.batch_id = b.id and x.status = 'imported' and i ->> 'severity' in ('warning', 'info') group by 1, 2) w), '[]'::jsonb),
      'customer_codes', customer_codes, 'per_order', per_order);
    update private.historical_import_batches
       set status = 'committed', committed_at = now(), committed_by = uid, result = res,
           attestation = jsonb_build_object('date_is_completion_date', true, 'revenue_is_final_payable', true, 'orders_fully_paid', true,
                                            'costs_complete', costs_complete, 'attested_by', uid, 'attested_at', now())
     where id = b.id;
    if p_dry_run then
      -- everything above is real, so every constraint and trigger has been exercised; now undo all of it
      raise exception 'dry run' using errcode = 'M1D01';
    end if;
  exception when sqlstate 'M1D01' then
    null;
  end;
  perform private.set_write_ctx(false);

  if p_dry_run then
    perform private.audit('historical_import.dry_run', 'import_batch', b.id::text, jsonb_build_object('orders', n_imported, 'points', points_total));
    return res || jsonb_build_object('dry_run', true);
  end if;
  perform private.audit('historical_import.committed', 'import_batch', b.id::text,
    jsonb_build_object('orders', n_imported, 'points', points_total, 'customers_created', created_customers, 'customers_reused', reused_customers));
  return res;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Attachments: original PDFs and PNGs, private, validated, classified. A missing one never blocks anything.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.hist_file_kind(p_bytes bytea)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when substring(p_bytes from 1 for 5) = '\x255044462d'::bytea then 'application/pdf'
              when substring(p_bytes from 1 for 8) = '\x89504e470d0a1a0a'::bytea then 'image/png' end
$$;
revoke all on function private.hist_file_kind(bytea) from public;

create or replace function private.hist_check_file(p_bytes bytea, p_declared text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := coalesce(octet_length(p_bytes), 0);
  mime text;
begin
  if n = 0 then
    raise exception 'that file is empty' using errcode = '22023';
  end if;
  if n > 4194304 then
    raise exception 'that file is larger than 4 MB' using errcode = '22023';
  end if;
  mime := private.hist_file_kind(p_bytes);
  if mime is null then
    raise exception 'only PDF and PNG files can be attached' using errcode = '22023';
  end if;
  if (p_declared = 'pdf' and mime <> 'application/pdf') or (p_declared = 'png' and mime <> 'image/png') then
    raise exception 'this attachment is expected to be a %; the file is not', upper(p_declared) using errcode = '22023';
  end if;
  return mime;
end;
$$;
revoke all on function private.hist_check_file(bytea, text) from public;

-- Stores the file for a reference that came with the export (pending or unavailable). The file is checked by its bytes.
create or replace function admin.hist_store_attachment(p_attachment_id uuid, p_bytes bytea, p_classification text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a private.historical_import_attachments%rowtype;
  file_mime text;
  digest text;
  cls text;
begin
  perform private.require_permission('import.manage');
  select * into a from private.historical_import_attachments where id = p_attachment_id for update;
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.historical_import_batches x where x.id = a.batch_id and x.status = 'discarded') then
    raise exception 'that import was discarded' using errcode = '55000';
  end if;
  if a.status = 'stored' then
    raise exception 'a file is already stored here; attach another file instead' using errcode = '55000';
  end if;
  file_mime := private.hist_check_file(p_bytes, a.declared_ext);
  digest := encode(sha256(p_bytes), 'hex');
  if exists (select 1 from private.historical_import_attachments x where x.row_id = a.row_id and x.sha256 = digest) then
    raise exception 'this file is already attached to this order' using errcode = '23505';
  end if;
  cls := coalesce(p_classification, a.classification);
  if cls not in ('unclassified', 'customer_receipt', 'supplier_invoice') then
    raise exception 'unknown classification' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_attachments
     set status = 'stored', content = p_bytes, mime = file_mime, byte_size = octet_length(p_bytes), sha256 = digest, stored_by = (select auth.uid()), stored_at = now(),
         unavailable_reason = null, classification = cls, customer_visible = false
   where id = a.id;
  perform private.audit('historical_import.attachment_stored', 'import_batch', a.batch_id::text, jsonb_build_object('attachment', a.id, 'bytes', octet_length(p_bytes), 'sha256', digest));
  perform private.set_write_ctx(false);
  return jsonb_build_object('id', a.id, 'mime', file_mime, 'byte_size', octet_length(p_bytes), 'sha256', digest);
end;
$$;

-- Adds a file to a row that has no reference for it (a receipt found later). Same checks.
create or replace function admin.hist_add_attachment(p_row_id uuid, p_file_name text, p_bytes bytea, p_classification text default 'unclassified')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r private.historical_import_rows%rowtype;
  file_mime text;
  digest text;
  pos integer;
  new_id uuid := gen_random_uuid();
  name text := btrim(coalesce(p_file_name, ''));
begin
  perform private.require_permission('import.manage');
  select * into r from private.historical_import_rows where id = p_row_id for update;
  if not found or r.kind <> 'purchase' then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.historical_import_batches x where x.id = r.batch_id and x.status = 'discarded') then
    raise exception 'that import was discarded' using errcode = '55000';
  end if;
  if char_length(name) not between 1 and 120 or name ~ '[\x00-\x1f\x7f/\\]' then
    raise exception 'the file name is not valid' using errcode = '22023';
  end if;
  if p_classification not in ('unclassified', 'customer_receipt', 'supplier_invoice') then
    raise exception 'unknown classification' using errcode = '22023';
  end if;
  file_mime := private.hist_check_file(p_bytes, 'other');
  digest := encode(sha256(p_bytes), 'hex');
  if exists (select 1 from private.historical_import_attachments x where x.row_id = r.id and x.sha256 = digest) then
    raise exception 'this file is already attached to this order' using errcode = '23505';
  end if;
  select coalesce(max(x.position), 0) + 1 into pos from private.historical_import_attachments x where x.row_id = r.id;
  if pos > 50 then
    raise exception 'an order can have at most 50 attachments' using errcode = '54000';
  end if;
  perform private.set_write_ctx(true);
  insert into private.historical_import_attachments (id, batch_id, row_id, position, file_name, declared_ext, status, classification, mime, byte_size, content, sha256, stored_by, stored_at)
  values (new_id, r.batch_id, r.id, pos, name, case when file_mime = 'application/pdf' then 'pdf' else 'png' end, 'stored', p_classification, file_mime, octet_length(p_bytes), p_bytes, digest,
          (select auth.uid()), now());
  perform private.audit('historical_import.attachment_stored', 'import_batch', r.batch_id::text, jsonb_build_object('attachment', new_id, 'bytes', octet_length(p_bytes), 'sha256', digest));
  perform private.set_write_ctx(false);
  return jsonb_build_object('id', new_id, 'mime', file_mime, 'byte_size', octet_length(p_bytes), 'sha256', digest);
end;
$$;

create or replace function admin.hist_set_attachment_class(p_attachment_id uuid, p_classification text, p_customer_visible boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a private.historical_import_attachments%rowtype;
begin
  perform private.require_permission('import.manage');
  select * into a from private.historical_import_attachments where id = p_attachment_id for update;
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  if p_classification not in ('unclassified', 'customer_receipt', 'supplier_invoice') then
    raise exception 'unknown classification' using errcode = '22023';
  end if;
  if coalesce(p_customer_visible, false) and (p_classification <> 'customer_receipt' or a.status <> 'stored') then
    raise exception 'only a stored file classified as a customer receipt can be made visible to the customer; a supplier invoice never is' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_attachments set classification = p_classification, customer_visible = coalesce(p_customer_visible, false) where id = a.id;
  perform private.audit('historical_import.attachment_classified', 'import_batch', a.batch_id::text,
    jsonb_build_object('attachment', a.id, 'classification', p_classification, 'customer_visible', coalesce(p_customer_visible, false)));
  perform private.set_write_ctx(false);
end;
$$;

create or replace function admin.hist_mark_attachment_unavailable(p_attachment_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a private.historical_import_attachments%rowtype;
  why text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('import.manage');
  if char_length(why) not between 3 and 300 then
    raise exception 'say why the original is not available (3 to 300 characters)' using errcode = '22023';
  end if;
  select * into a from private.historical_import_attachments where id = p_attachment_id for update;
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  if a.status = 'stored' then
    raise exception 'a file is stored here, so it is available' using errcode = '55000';
  end if;
  perform private.set_write_ctx(true);
  update private.historical_import_attachments set status = 'unavailable', unavailable_reason = why where id = a.id;
  perform private.audit('historical_import.attachment_unavailable', 'import_batch', a.batch_id::text, jsonb_build_object('attachment', a.id));
  perform private.set_write_ctx(false);
end;
$$;

create or replace function admin.hist_get_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a private.historical_import_attachments%rowtype;
begin
  perform private.require_permission('import.manage');
  select * into a from private.historical_import_attachments where id = p_attachment_id and status = 'stored';
  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime', a.mime, 'byte_size', a.byte_size, 'content_base64', encode(a.content, 'base64'));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. The imported order, for the owner: where it came from, what was attested, which files it has. And enriching its item lines later.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.hist_order_info(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h private.historical_orders%rowtype;
  b private.historical_import_batches%rowtype;
begin
  perform private.require_permission('import.manage');
  select * into h from private.historical_orders where order_id = p_order_id;
  if not found then
    return null;
  end if;
  select * into b from private.historical_import_batches where id = h.batch_id;
  return jsonb_build_object(
    'order_id', h.order_id, 'batch_id', h.batch_id, 'source_row_number', h.source_row_number, 'historical_date', h.historical_date,
    'date_meaning', h.date_meaning, 'placement_date_known', h.placement_date_known, 'imported_at', h.imported_at,
    'imported_by_name', (select sm.display_name from private.staff_members sm where sm.user_id = h.imported_by),
    'paid_basis', h.paid_basis, 'points_awarded', h.points_awarded, 'attestation', b.attestation,
    'item_revisions', (select count(*) from private.historical_item_revisions v where v.order_id = h.order_id),
    'row_id', h.row_id,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'position', a.position, 'file_name', a.file_name, 'declared_ext', a.declared_ext, 'status', a.status,
                                          'classification', a.classification, 'customer_visible', a.customer_visible, 'source_expiring', a.source_expiring,
                                          'source_host', a.source_host, 'byte_size', a.byte_size, 'mime', a.mime, 'unavailable_reason', a.unavailable_reason)
                       order by a.position)
      from private.historical_import_attachments a where a.row_id = h.row_id), '[]'::jsonb));
end;
$$;

-- What an order is, for any staff member who may read orders: the label "Historical WhatsApp order" and the date it is listed by.
create or replace function admin.order_origin(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('origin', o.origin, 'order_date', o.order_date, 'completed_at', o.completed_at, 'created_at', o.created_at);
end;
$$;

-- Replaces the item lines of a historical order (the import creates one placeholder line) with the owner's description. The money cannot change:
-- the lines must add up to exactly the order's net payable amount. Every change keeps the old lines.
create or replace function admin.hist_set_order_items(p_order_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  why text := btrim(coalesce(p_reason, ''));
  old_items jsonb;
  item jsonb;
  pos integer := 0;
  total bigint := 0;
begin
  perform private.require_permission('import.manage');
  if char_length(why) not between 3 and 500 then
    raise exception 'say what this change is based on (3 to 500 characters)' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.origin <> 'historical_import' then
    raise exception 'only the items of a historical order can be edited here' using errcode = '55000';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 12 then
    raise exception 'give between 1 and 12 item lines' using errcode = '22023';
  end if;
  for item in select x from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(item) <> 'object' or char_length(btrim(coalesce(item ->> 'description', ''))) not between 1 and 300 or (item ->> 'description') ~ '[\x00-\x1f\x7f]'
       or coalesce(item ->> 'kind', 'other') not in ('component', 'build_service', 'delivery', 'other')
       or (item ->> 'quantity') !~ '^[0-9]{1,4}$' or (item ->> 'unit_price_minor') !~ '^[0-9]{1,11}$' or (item ->> 'quantity')::integer not between 1 and 1000 then
      raise exception 'an item line is not valid (description, quantity 1 to 1000, price of zero or more)' using errcode = '22023';
    end if;
    total := total + (item ->> 'quantity')::bigint * (item ->> 'unit_price_minor')::bigint;
  end loop;
  if total <> o.net_payable_minor then
    raise exception 'the lines add up to % minor units but the order is %; the order''s money cannot change', total, o.net_payable_minor using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'description', i.description, 'quantity', i.quantity, 'unit_price_minor', i.unit_price_minor) order by i.position), '[]'::jsonb)
    into old_items from public.order_items i where i.order_id = o.id;
  perform private.set_write_ctx(true);
  delete from public.order_items where order_id = o.id;
  for item in select x from jsonb_array_elements(p_items) x loop
    pos := pos + 1;
    insert into public.order_items (order_id, position, kind, description, quantity, unit_price_minor)
    values (o.id, pos, coalesce(item ->> 'kind', 'other'), btrim(item ->> 'description'), (item ->> 'quantity')::integer, (item ->> 'unit_price_minor')::bigint);
  end loop;
  insert into private.historical_item_revisions (order_id, old_items, new_items, reason, actor) values (o.id, old_items, p_items, left(why, 500), (select auth.uid()));
  perform private.audit('historical_import.items_edited', 'order', o.id::text, jsonb_build_object('lines', pos));
  perform private.set_write_ctx(false);
  return jsonb_build_object('order_id', o.id, 'lines', pos);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. The three existing staff functions that order or filter by date, re-stated to use order_date.
--    They are the earlier definitions, unchanged except that:
--      * the date an order is filtered and sorted by is orders.order_date (the creation date of every existing order, so their answers do not
--        change; the completion date of a historical order, whose placement date is not known), and
--      * each answer also carries `order_date` and `origin`, which the screens use to say "Historical WhatsApp order" and never "placed" for one.
--    Their signatures, permissions and every other line are as before. admin.list_orders_page (kept for the earlier websites) is not touched.
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
    and (from_ts is null or o.order_date >= from_ts)
    and (to_ts is null or o.order_date < to_ts);

  pages := greatest(1, ceil(total::numeric / size)::integer);
  page := least(greatest(coalesce(p_page, 1), 1), pages);

  with f as (
    select o.id, o.order_ref, o.created_at, o.order_date, o.origin, o.net_payable_minor, c.full_name as customer_name,
           coalesce(r.cost_state, 'missing') as cost_state,
           -- No entry at all: the cost is UNKNOWN (null), never zero.
           case when r.order_id is null then null else coalesce(r.actual_minor, 0) + coalesce(r.estimated_minor, 0) end as cost_minor
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join private.order_cost_rollup() r on fin and r.order_id = o.id
    where (status_code is null or o.status = status_code)
      and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
      and (from_ts is null or o.order_date >= from_ts)
      and (to_ts is null or o.order_date < to_ts)
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
               case when sort_key = 'oldest' then f.order_date end asc,
               case when sort_key <> 'oldest' then f.order_date end desc,
               case when sort_key = 'oldest' then f.id end asc,
               case when sort_key <> 'oldest' then f.id end desc) as rn
    from f
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('id', x.id, 'order_ref', x.order_ref, 'customer_name', x.customer_name, 'net_payable_minor', x.net_payable_minor, 'created_at', x.created_at, 'order_date', x.order_date, 'origin', x.origin)
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
    select extract(year from o.order_date at time zone 'Asia/Qatar')::integer as y from public.orders o
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

create or replace function admin.overview_summary(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  y integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Qatar'))::integer);
  fin boolean;
  rep jsonb;
  result jsonb;
begin
  perform private.require_permission('orders.read');
  if y < 2020 or y > 2100 then
    raise exception 'the year must be between 2020 and 2100' using errcode = '22023';
  end if;
  fin := private.has_permission('finance.read');
  rep := private.financial_report_data(y, null);
  result := jsonb_build_object(
    'year', y, 'years', rep -> 'years',
    'active_orders', (select count(*) from public.orders where status not in ('delivered', 'cancelled')),
    'completed_orders', (rep -> 'period' ->> 'completed_orders')::integer,
    'needs_attention', jsonb_build_object(
      'awaiting_confirmation', (select count(*) from public.orders where status = 'pending_confirmation'),
      'awaiting_deposit', (select count(*) from public.orders where status = 'awaiting_deposit'),
      'on_hold', (select count(*) from public.orders where status = 'on_hold'),
      'completion_to_verify', (rep -> 'needs_verification' ->> 'count')::bigint),
    'recent_orders', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.order_date desc, t.id)
      from (select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.net_payable_minor, o.created_at, o.order_date, o.origin, c.full_name as customer_name
            from public.orders o join public.customers c on c.id = o.customer_id join public.order_statuses s on s.code = o.status
            order by o.order_date desc, o.id limit 8) t), '[]'::jsonb));
  if private.has_permission('payments.read') then
    result := jsonb_set(result, '{needs_attention}', (result -> 'needs_attention') || jsonb_build_object(
      'deposit_shortfalls', (select count(*) from public.orders o
                             where o.deposit_fixed_at is not null and o.deposit_gate_status is not null and o.status not in ('on_hold', 'cancelled')
                               and private.status_order(o.status) >= private.status_order(o.deposit_gate_status) and o.amount_paid_minor < o.deposit_required_minor),
      'completed_with_balance', (select count(*) from public.orders where completed_at is not null and balance_due_minor > 0)));
  end if;
  if fin then
    result := result || jsonb_build_object('financial', jsonb_build_object(
      'net_revenue_minor', rep -> 'period' -> 'net_revenue_minor', 'profit_minor', rep -> 'period' -> 'profit_minor',
      'margin_bps', rep -> 'period' -> 'margin_bps', 'profit_state', rep -> 'period' -> 'profit_state',
      'completed_orders', rep -> 'period' -> 'completed_orders',
      'orders_costs_incomplete', (rep -> 'period' ->> 'orders_costs_incomplete')::integer, 'orders_costs_missing', (rep -> 'period' ->> 'orders_costs_missing')::integer,
      'orders_costs_complete', (rep -> 'period' ->> 'orders_costs_complete')::integer));
  end if;
  return result;
end;
$$;

create or replace function admin.customer_orders(p_customer_id uuid, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pay boolean;
  total bigint;
begin
  perform private.require_permission('customers.read');
  perform private.require_permission('orders.read');
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  pay := private.has_permission('payments.read');
  select count(*) into total from public.orders where customer_id = p_customer_id;
  return jsonb_build_object('total', total, 'limit', p_limit, 'offset', p_offset, 'orders', coalesce((
    select jsonb_agg(x.j order by x.order_date desc, x.id)
    from (
      select o.id, o.order_date,
        jsonb_build_object(
          'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'status_label', s.customer_label,
          'workflow_version', o.workflow_version, 'fulfillment_type', o.fulfillment_type, 'delivery_method', o.delivery_method,
          'created_at', o.created_at, 'order_date', o.order_date, 'origin', o.origin, 'completed_at', o.completed_at, 'needs_completion_verification', o.status = 'delivered' and o.completed_at is null,
          'gross_minor', o.total_minor, 'discount_minor', o.discount_minor, 'loyalty_points_redeemed', o.loyalty_points_redeemed,
          'loyalty_credit_minor', o.loyalty_credit_minor, 'net_payable_minor', o.net_payable_minor,
          'deposit_required_minor', o.deposit_required_minor,
          'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor,
          'items', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'kind', i.kind, 'description', i.description,
                       'quantity', i.quantity, 'unit_price_minor', i.unit_price_minor, 'line_total_minor', i.line_total_minor,
                       'discount_share_minor', n.discount_share_minor, 'credit_share_minor', n.credit_share_minor, 'net_line_minor', n.net_line_minor)
                       order by i.position)
                     from public.order_items i join private.order_line_net(o.id) n on n.line_position = i.position
                     where i.order_id = o.id), '[]'::jsonb),
          'history', coalesce((select jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'at', h.changed_at) order by h.id)
                     from private.order_status_history h where h.order_id = o.id), '[]'::jsonb),
          'tracking', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'message', e.message, 'location', e.location,
                       'occurred_at', e.occurred_at, 'published_at', e.published_at, 'event_kind', e.event_kind,
                       'retracted', r.event_id is not null) order by coalesce(e.occurred_at, e.published_at), e.published_at, e.id)
                     from public.order_tracking_events e left join private.tracking_event_retractions r on r.event_id = e.id
                     where e.order_id = o.id), '[]'::jsonb))
        || case when pay then jsonb_build_object('payments', coalesce((
             select jsonb_agg(jsonb_build_object('entry_type', p.entry_type, 'purpose', p.purpose, 'amount_minor', p.amount_minor, 'method', p.method,
                      'receipt_number', p.receipt_number, 'received_at', p.received_at,
                      'reversed', exists (select 1 from public.payments rv where rv.reverses_payment_id = p.id)) order by p.received_at, p.created_at)
             from public.payments p where p.order_id = o.id), '[]'::jsonb)) else '{}'::jsonb end as j
      from public.orders o join public.order_statuses s on s.code = o.status
      where o.customer_id = p_customer_id
      order by o.order_date desc, o.id
      limit p_limit offset p_offset
    ) x), '[]'::jsonb));
end;
$$;

-- The customer's page for staff: the same answer as before (permissions, columns, filters), except that each order also carries `order_date`
-- and `origin` and the list is ordered by order_date, so a historical order is shown by the date it was completed and never by the day it was imported.
create or replace function admin.get_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.customers%rowtype;
  result jsonb;
begin
  perform private.require_permission('customers.read');
  select * into c from public.customers where id = p_customer_id;
  if not found then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  result := jsonb_build_object(
    'id', c.id, 'customer_code', c.customer_code, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email,
    'source', c.source, 'preferred_language', c.preferred_language, 'delivery_address', c.delivery_address,
    'marketing_consent', c.marketing_consent, 'created_at', c.created_at,
    'linked_accounts', (select count(*) from public.customer_accounts a where a.customer_id = c.id));
  if private.has_permission('orders.read') then
    result := result || jsonb_build_object('orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'status_label', s.customer_label,
        'total_minor', o.total_minor, 'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor,
        'created_at', o.created_at, 'order_date', o.order_date, 'origin', o.origin) order by o.order_date desc, o.id)
      from public.orders o join public.order_statuses s on s.code = o.status
      where o.customer_id = c.id), '[]'::jsonb));
  end if;
  if private.has_permission('loyalty.read') then
    result := result || jsonb_build_object('loyalty_points', coalesce((select sum(l.points) from public.loyalty_ledger l where l.customer_id = c.id), 0));
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Privileges: signed-in staff sessions and the staff gateway only; never anon, never PUBLIC, never service_role.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.hist_stage_batch(jsonb)', 'admin.hist_get_batch(uuid)', 'admin.hist_list_batches()', 'admin.hist_update_row(uuid, uuid, jsonb)',
    'admin.hist_set_row_decision(uuid, uuid, text, text)', 'admin.hist_merge_groups(uuid, uuid, uuid)', 'admin.hist_unmerge_group(uuid, uuid)',
    'admin.hist_set_group_customer(uuid, uuid, text, uuid)', 'admin.hist_resolve_flag(uuid, text, text, text)', 'admin.hist_discard_batch(uuid, text)',
    'admin.hist_commit_batch(uuid, jsonb, boolean)', 'admin.hist_store_attachment(uuid, bytea, text)', 'admin.hist_add_attachment(uuid, text, bytea, text)',
    'admin.hist_set_attachment_class(uuid, text, boolean)', 'admin.hist_mark_attachment_unavailable(uuid, text)', 'admin.hist_get_attachment(uuid)',
    'admin.hist_order_info(uuid)', 'admin.order_origin(uuid)', 'admin.hist_set_order_items(uuid, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated, m1_staff_gateway', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Self-checks.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'admin' and (p.proname like 'hist\_%' or p.proname = 'order_origin')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
         or not has_function_privilege('m1_staff_gateway', p.oid, 'execute') or not p.prosecdef
         or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'));
  if bad is not null then
    raise exception 'historical import functions with wrong privileges or settings: %', bad;
  end if;
  if exists (select 1 from private.security_audit()) then
    raise exception 'security audit failed after the historical import migration: %', (select string_agg(check_name || ' ' || detail, '; ') from private.security_audit());
  end if;
end;
$$;
