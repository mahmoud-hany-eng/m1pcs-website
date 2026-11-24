-- PLAT-0006, order costs, completion dates and financial reporting, migration 2 of 2: the staff functions.
--
-- Everything below is NEW. No existing function is replaced, so the website that is live today (and the one that has the Pricing &
-- Rewards section) keeps working exactly as it does: it never calls these. The database, not the browser, works out every figure.
--
--   private helpers      qatar_today, normalize_costs, cost_values, insert_order_cost, order_cost_rollup, allocate_reduction,
--                        order_line_net, fin_row / fin_render, financial_report_data
--   costs (finance.*)    admin.order_costs, add_order_cost, edit_order_cost, void_order_cost, set_order_costs_complete
--   completion           admin.order_completion (orders.read), admin.verify_historical_completion (finance.verify)
--   reporting            admin.financial_report (finance.read), admin.list_completed_orders (orders.read; money columns need finance.read),
--                        admin.overview_summary (orders.read; the financial block needs finance.read)
--   customer history     admin.customer_orders (customers.read + orders.read; payments need payments.read)
--   order creation       admin.create_order with a 12th argument: the same order, plus optional private costs, in ONE transaction
--
-- SQLSTATEs used (mapped to staff messages by the website): 42501 no permission, 22023 invalid input, 55000 not allowed in this
-- state, P0002 not found, M1K01 an entry id reused for a different cost, M1K03 the entry changed while the person was working.
-- Rerunnable: create or replace everywhere, idempotent grants.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Small private helpers.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.qatar_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Qatar')::date $$;
revoke all on function private.qatar_today() from public;

-- Validates and normalizes a list of cost entries (from the order form or the add-cost form). Returns NULL for none. Never trusts the caller:
-- unknown fields, bad categories, bad amounts and bad dates are refused with a sentence written for staff.
create or replace function private.normalize_costs(p_costs jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  e record;
  c jsonb;
  out jsonb := '[]'::jsonb;
  amount text;
  day date;
  sref text;
  note text;
begin
  if p_costs is null or p_costs = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_costs) <> 'array' then
    raise exception 'costs must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_costs) = 0 then
    return null;
  end if;
  if jsonb_array_length(p_costs) > 30 then
    raise exception 'an order can take at most 30 cost entries at a time' using errcode = '22023';
  end if;
  for e in select x.value as item, x.ordinality::integer as pos from jsonb_array_elements(p_costs) with ordinality as x(value, ordinality) loop
    c := e.item;
    if jsonb_typeof(c) <> 'object' or (c - 'category' - 'description' - 'amount_minor' - 'cost_kind' - 'supplier_ref' - 'incurred_on' - 'notes') <> '{}'::jsonb then
      raise exception 'cost % has a field that is not allowed; allowed: category, description, amount_minor, cost_kind, supplier_ref, incurred_on, notes', e.pos using errcode = '22023';
    end if;
    if coalesce(c ->> 'category', '') not in ('components', 'international_shipping', 'customs_duties', 'assembly', 'local_delivery', 'payment_processing', 'other') then
      raise exception 'cost %: choose a category', e.pos using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(c ->> 'description', ''))) not between 1 and 200 then
      raise exception 'cost %: the description must be 1 to 200 characters', e.pos using errcode = '22023';
    end if;
    amount := c ->> 'amount_minor';
    if amount is null or amount !~ '^[0-9]{1,12}$' then
      raise exception 'cost %: the amount must be a whole number of QAR minor units, zero or more', e.pos using errcode = '22023';
    end if;
    if coalesce(c ->> 'cost_kind', '') not in ('estimated', 'actual') then
      raise exception 'cost %: say whether the amount is estimated or actual', e.pos using errcode = '22023';
    end if;
    sref := nullif(btrim(coalesce(c ->> 'supplier_ref', '')), '');
    if sref is not null and char_length(sref) > 120 then
      raise exception 'cost %: the supplier or reference is limited to 120 characters', e.pos using errcode = '22023';
    end if;
    note := nullif(btrim(coalesce(c ->> 'notes', '')), '');
    if note is not null and char_length(note) > 1000 then
      raise exception 'cost %: the note is limited to 1000 characters', e.pos using errcode = '22023';
    end if;
    if coalesce(c ->> 'incurred_on', '') = '' then
      day := private.qatar_today();
    else
      if (c ->> 'incurred_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'cost %: the date must be written YYYY-MM-DD', e.pos using errcode = '22023';
      end if;
      begin
        day := (c ->> 'incurred_on')::date;
      exception when others then
        raise exception 'cost %: that is not a real date', e.pos using errcode = '22023';
      end;
      if day not between date '2020-01-01' and date '2100-01-01' then
        raise exception 'cost %: the date is out of range', e.pos using errcode = '22023';
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'category', c ->> 'category', 'description', btrim(c ->> 'description'), 'amount_minor', amount::bigint,
      'cost_kind', c ->> 'cost_kind', 'supplier_ref', sref, 'incurred_on', day, 'notes', note));
  end loop;
  return out;
end;
$$;
revoke all on function private.normalize_costs(jsonb) from public;

-- The comparable values of one entry (what a revision stores as old / new).
create or replace function private.cost_values(c private.order_costs)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('category', c.category, 'description', c.description, 'amount_minor', c.amount_minor, 'cost_kind', c.cost_kind,
                            'supplier_ref', c.supplier_ref, 'incurred_on', c.incurred_on, 'notes', c.notes, 'status', c.status)
$$;
revoke all on function private.cost_values(private.order_costs) from public;

-- Adds one normalized entry and its first revision. Runs inside a staff function, with the write flag on and the order locked.
create or replace function private.insert_order_cost(p_order_id uuid, p_cost jsonb, p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  c private.order_costs%rowtype;
begin
  insert into private.order_costs (id, order_id, category, description, amount_minor, cost_kind, supplier_ref, incurred_on, notes, created_by)
  values (coalesce(p_entry_id, gen_random_uuid()), p_order_id, p_cost ->> 'category', p_cost ->> 'description', (p_cost ->> 'amount_minor')::bigint,
          p_cost ->> 'cost_kind', p_cost ->> 'supplier_ref', (p_cost ->> 'incurred_on')::date, p_cost ->> 'notes', (select auth.uid()))
  returning * into c;
  insert into private.order_cost_revisions (order_id, cost_id, action, revision, old_values, new_values, reason, actor)
  values (p_order_id, c.id, 'created', 1, null, private.cost_values(c), left(p_reason, 500), (select auth.uid()));
  return c.id;
end;
$$;
revoke all on function private.insert_order_cost(uuid, jsonb, uuid, text) from public;

-- Every order's recorded cost, from its ACTIVE entries only. An order with no active entry has NO row here: its cost is unknown,
-- never zero. cost_state: 'complete' = the owner declared the entries complete and no estimate remains; otherwise 'incomplete'.
create or replace function private.order_cost_rollup()
returns table (order_id uuid, actual_minor bigint, estimated_minor bigint, entries integer, estimated_entries integer, costs_complete boolean, cost_state text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.order_id,
         coalesce(sum(c.amount_minor) filter (where c.cost_kind = 'actual'), 0)::bigint,
         coalesce(sum(c.amount_minor) filter (where c.cost_kind = 'estimated'), 0)::bigint,
         count(*)::integer,
         (count(*) filter (where c.cost_kind = 'estimated'))::integer,
         coalesce(s.costs_complete, false),
         case when coalesce(s.costs_complete, false) and count(*) filter (where c.cost_kind = 'estimated') = 0 then 'complete' else 'incomplete' end
  from private.order_costs c
  left join private.order_cost_state s on s.order_id = c.order_id
  where c.status = 'active'
  group by c.order_id, s.costs_complete
$$;
revoke all on function private.order_cost_rollup() from public;

-- Clears the "costs complete" declaration after any change to the entries (recorded as a revision of its own).
create or replace function private.clear_costs_complete(p_order_id uuid, p_why text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if exists (select 1 from private.order_cost_state where order_id = p_order_id and costs_complete) then
    update private.order_cost_state set costs_complete = false, changed_by = (select auth.uid()), changed_at = now() where order_id = p_order_id;
    insert into private.order_cost_revisions (order_id, cost_id, action, old_values, new_values, reason, actor)
    values (p_order_id, null, 'marked_incomplete', jsonb_build_object('costs_complete', true), jsonb_build_object('costs_complete', false), left(p_why, 500), (select auth.uid()));
  end if;
end;
$$;
revoke all on function private.clear_costs_complete(uuid, text) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Spreading an order-level discount and loyalty credit over the item lines, for display. Deterministic and exact:
--    the largest-remainder method (ties go to the earlier line), the discount first and then the credit over what each line has left,
--    so no line ever goes below zero and the lines add up to the order's net payable amount to the last minor unit.
--    It changes nothing: the original line prices are never touched.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.allocate_reduction(p_reduction bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := coalesce(array_length(p_weights, 1), 0);
  base numeric;
  result bigint[];
begin
  if n = 0 then
    return '{}'::bigint[];
  end if;
  if coalesce(p_reduction, 0) <= 0 then
    return array_fill(0::bigint, array[n]);
  end if;
  select coalesce(sum(w), 0) into base from unnest(p_weights) w;
  if base <= 0 or p_reduction > base then
    raise exception 'the reduction is larger than the amount it is spread over' using errcode = '22023';
  end if;
  with w as (select ord::integer as i, v from unnest(p_weights) with ordinality as t(v, ord)),
       f as (select i, floor(p_reduction::numeric * v / base)::bigint as s,
                    (p_reduction::numeric * v) - floor(p_reduction::numeric * v / base) * base as r from w),
       ranked as (select i, s, row_number() over (order by r desc, i asc) as rn, p_reduction - sum(s) over () as leftover from f)
  select array_agg(s + case when rn <= leftover then 1 else 0 end order by i) into result from ranked;
  return result;
end;
$$;
revoke all on function private.allocate_reduction(bigint, bigint[]) from public;

create or replace function private.order_line_net(p_order_id uuid)
returns table (line_position integer, gross_line_minor bigint, discount_share_minor bigint, credit_share_minor bigint, net_line_minor bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  pos integer[];
  gross bigint[];
  w bigint[];
  rest bigint[];
  d bigint[];
  c bigint[];
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    return;
  end if;
  select array_agg(i.position order by i.position), array_agg(i.line_total_minor order by i.position),
         array_agg(case when i.kind = 'discount' then 0 else i.line_total_minor end order by i.position)
    into pos, gross, w
  from public.order_items i where i.order_id = p_order_id;
  if pos is null then
    return;
  end if;
  d := private.allocate_reduction(o.discount_minor, w);
  select array_agg(w[k] - d[k] order by k) into rest from generate_series(1, array_length(w, 1)) k;
  c := private.allocate_reduction(o.loyalty_credit_minor, rest);
  return query select pos[k], gross[k], d[k], c[k], gross[k] - d[k] - c[k] from generate_series(1, array_length(pos, 1)) k order by k;
end;
$$;
revoke all on function private.order_line_net(uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Order costs: read and write. Owner only (finance.read / finance.manage). Nothing here is reachable by a customer or by
--    ordinary staff, and none of it appears in any function that staff without those permissions can call.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.order_costs(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  oc private.order_completions%rowtype;
  r record;
  net bigint;
  recorded bigint;
  state text;
begin
  perform private.require_permission('finance.read');
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select * into oc from private.order_completions where order_id = o.id;
  select * into r from private.order_cost_rollup() x where x.order_id = o.id;
  -- Revenue: the snapshot taken at completion once the order is completed; otherwise what it WOULD be (not yet recognised).
  net := coalesce(oc.net_revenue_minor, o.net_payable_minor);
  recorded := coalesce(r.actual_minor, 0) + coalesce(r.estimated_minor, 0);
  state := coalesce(r.cost_state, 'missing');
  return jsonb_build_object(
    'order_id', o.id, 'order_ref', o.order_ref, 'status', o.status,
    'completed_at', o.completed_at, 'revenue_recognized', oc.order_id is not null,
    'needs_completion_verification', o.status = 'delivered' and o.completed_at is null,
    'can_edit', private.has_permission('finance.manage'),
    'summary', jsonb_build_object(
      'gross_minor', coalesce(oc.gross_minor, o.total_minor), 'discount_minor', coalesce(oc.discount_minor, o.discount_minor),
      'loyalty_credit_minor', coalesce(oc.loyalty_credit_minor, o.loyalty_credit_minor), 'net_revenue_minor', net,
      'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor,
      'actual_cost_minor', coalesce(r.actual_minor, 0), 'estimated_cost_minor', coalesce(r.estimated_minor, 0), 'recorded_cost_minor', recorded,
      'entries', coalesce(r.entries, 0), 'estimated_entries', coalesce(r.estimated_entries, 0),
      'cost_state', state, 'costs_complete', state = 'complete',
      -- No entry at all means the cost is UNKNOWN, so there is no profit to show (never revenue minus zero).
      'profit_minor', case when state = 'missing' then null else net - recorded end,
      'profit_is_provisional', state <> 'complete',
      'margin_bps', case when state <> 'missing' and net > 0 then round((net - recorded) * 10000.0 / net)::integer end),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'description', c.description,
        'amount_minor', c.amount_minor, 'cost_kind', c.cost_kind, 'supplier_ref', c.supplier_ref, 'incurred_on', c.incurred_on,
        'notes', c.notes, 'status', c.status, 'version', c.version, 'created_at', c.created_at, 'updated_at', c.updated_at)
        order by c.status, c.incurred_on, c.created_at, c.id)
      from private.order_costs c where c.order_id = o.id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'cost_id', v.cost_id, 'action', v.action, 'revision', v.revision,
        'old_values', v.old_values, 'new_values', v.new_values, 'reason', v.reason, 'by', sm.display_name, 'at', v.created_at) order by v.id desc)
      from (select * from private.order_cost_revisions where order_id = o.id order by id desc limit 300) v
      left join private.staff_members sm on sm.user_id = v.actor), '[]'::jsonb));
end;
$$;

create or replace function admin.add_order_cost(
  p_order_id uuid, p_entry_id uuid, p_category text, p_description text, p_amount_minor bigint, p_cost_kind text,
  p_supplier_ref text, p_incurred_on date, p_notes text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  nc jsonb;
  existing private.order_costs%rowtype;
  first_rev jsonb;
  new_id uuid := coalesce(p_entry_id, gen_random_uuid());
begin
  perform private.require_permission('finance.manage');
  if p_entry_id is null and private.via_gateway() then
    raise exception 'the cost entry needs the id the screen chose; reload the page and try again' using errcode = '22023';
  end if;
  nc := (private.normalize_costs(jsonb_build_array(jsonb_build_object(
    'category', p_category, 'description', p_description, 'amount_minor', p_amount_minor, 'cost_kind', p_cost_kind,
    'supplier_ref', p_supplier_ref, 'incurred_on', p_incurred_on, 'notes', p_notes))) -> 0);
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- A retry of the same form (same entry id, same content) returns the entry that was already saved and saves nothing.
  select * into existing from private.order_costs where id = new_id;
  if found then
    select r.new_values into first_rev from private.order_cost_revisions r where r.cost_id = existing.id and r.action = 'created';
    if existing.order_id = o.id and (first_rev - 'status') = nc then
      perform set_config('m1.replayed', 'true', true);
      return existing.id;
    end if;
    raise exception 'this cost entry id was already used for a different entry; nothing was changed' using errcode = 'M1K01';
  end if;
  perform set_config('m1.replayed', 'false', true);

  perform private.set_write_ctx(true);
  perform private.insert_order_cost(o.id, nc, new_id, null);
  insert into private.order_cost_state (order_id, costs_complete) values (o.id, false) on conflict (order_id) do nothing;
  perform private.clear_costs_complete(o.id, 'a cost entry was added after the costs were marked complete');
  perform private.audit('order.cost_added', 'order', o.id::text, jsonb_build_object('cost_id', new_id, 'category', nc ->> 'category', 'cost_kind', nc ->> 'cost_kind'));
  perform private.set_write_ctx(false);
  return new_id;
end;
$$;

create or replace function admin.edit_order_cost(
  p_cost_id uuid, p_expected_version integer, p_category text, p_description text, p_amount_minor bigint, p_cost_kind text,
  p_supplier_ref text, p_incurred_on date, p_notes text, p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c private.order_costs%rowtype;
  nc jsonb;
  old_vals jsonb;
  ord_id uuid;
  last_rev private.order_cost_revisions%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('finance.manage');
  if char_length(reason) < 3 then
    raise exception 'say why the cost is being changed (at least 3 characters); the reason is kept in the history' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'the version of the entry the screen showed must be supplied; reload the page and try again' using errcode = '22023';
  end if;
  nc := (private.normalize_costs(jsonb_build_array(jsonb_build_object(
    'category', p_category, 'description', p_description, 'amount_minor', p_amount_minor, 'cost_kind', p_cost_kind,
    'supplier_ref', p_supplier_ref, 'incurred_on', p_incurred_on, 'notes', p_notes))) -> 0);
  select order_id into ord_id from private.order_costs where id = p_cost_id;
  if not found then
    raise exception 'cost entry not found' using errcode = 'P0002';
  end if;
  perform 1 from public.orders where id = ord_id for update;
  select * into c from private.order_costs where id = p_cost_id for update;
  if c.status = 'voided' then
    raise exception 'a voided cost entry cannot be edited' using errcode = '55000';
  end if;

  -- The identical edit sent twice (a double click, a retry): the second one finds it already saved and reports so, changing nothing.
  select * into last_rev from private.order_cost_revisions r where r.cost_id = c.id order by r.id desc limit 1;
  if c.version = p_expected_version + 1 and last_rev.action = 'edited' and last_rev.actor is not distinct from (select auth.uid())
     and (last_rev.new_values - 'status') = nc and last_rev.reason = reason and last_rev.created_at > now() - interval '1 hour' then
    perform set_config('m1.replayed', 'true', true);
    return c.version;
  end if;
  perform set_config('m1.replayed', 'false', true);
  if c.version <> p_expected_version then
    raise exception 'this cost entry was changed by someone else while you were working on it; nothing was saved. Reload the page to see the current entry'
      using errcode = 'M1K03';
  end if;
  old_vals := private.cost_values(c);
  if (old_vals - 'status') = nc then
    raise exception 'nothing was changed: the entry already has these values' using errcode = '22023';
  end if;

  perform private.set_write_ctx(true);
  update private.order_costs
     set category = nc ->> 'category', description = nc ->> 'description', amount_minor = (nc ->> 'amount_minor')::bigint,
         cost_kind = nc ->> 'cost_kind', supplier_ref = nc ->> 'supplier_ref', incurred_on = (nc ->> 'incurred_on')::date,
         notes = nc ->> 'notes', version = c.version + 1
   where id = c.id
  returning * into c;
  insert into private.order_cost_revisions (order_id, cost_id, action, revision, old_values, new_values, reason, actor)
  values (c.order_id, c.id, 'edited', c.version, old_vals, private.cost_values(c), left(reason, 500), (select auth.uid()));
  perform private.clear_costs_complete(c.order_id, 'a cost entry was edited after the costs were marked complete');
  perform private.audit('order.cost_edited', 'order', c.order_id::text, jsonb_build_object('cost_id', c.id, 'version', c.version));
  perform private.set_write_ctx(false);
  return c.version;
end;
$$;

create or replace function admin.void_order_cost(p_cost_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c private.order_costs%rowtype;
  ord_id uuid;
  old_vals jsonb;
  reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('finance.manage');
  if char_length(reason) < 3 then
    raise exception 'say why the cost entry is being removed (at least 3 characters); the reason is kept in the history' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'the version of the entry the screen showed must be supplied; reload the page and try again' using errcode = '22023';
  end if;
  select order_id into ord_id from private.order_costs where id = p_cost_id;
  if not found then
    raise exception 'cost entry not found' using errcode = 'P0002';
  end if;
  perform 1 from public.orders where id = ord_id for update;
  select * into c from private.order_costs where id = p_cost_id for update;
  if c.status = 'voided' then
    -- Already removed (a double click or a retry): report it, change nothing.
    perform set_config('m1.replayed', 'true', true);
    return c.version;
  end if;
  perform set_config('m1.replayed', 'false', true);
  if c.version <> p_expected_version then
    raise exception 'this cost entry was changed by someone else while you were working on it; nothing was saved. Reload the page to see the current entry'
      using errcode = 'M1K03';
  end if;
  old_vals := private.cost_values(c);
  perform private.set_write_ctx(true);
  update private.order_costs set status = 'voided', version = c.version + 1 where id = c.id returning * into c;
  insert into private.order_cost_revisions (order_id, cost_id, action, revision, old_values, new_values, reason, actor)
  values (c.order_id, c.id, 'voided', c.version, old_vals, private.cost_values(c), left(reason, 500), (select auth.uid()));
  perform private.clear_costs_complete(c.order_id, 'a cost entry was removed after the costs were marked complete');
  perform private.audit('order.cost_voided', 'order', c.order_id::text, jsonb_build_object('cost_id', c.id));
  perform private.set_write_ctx(false);
  return c.version;
end;
$$;

create or replace function admin.set_order_costs_complete(p_order_id uuid, p_complete boolean, p_reason text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  r record;
  now_complete boolean;
  reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('finance.manage');
  if p_complete is null then
    raise exception 'say whether the costs are complete' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select coalesce(s.costs_complete, false) into now_complete from (select 1) x left join private.order_cost_state s on s.order_id = o.id;
  select * into r from private.order_cost_rollup() x where x.order_id = o.id;

  if p_complete then
    if coalesce(r.entries, 0) = 0 then
      raise exception 'there is no cost entry yet; costs cannot be complete while none are recorded. If this order really had no direct costs, record an entry of QAR 0.00 that says so' using errcode = '55000';
    end if;
    if coalesce(r.estimated_entries, 0) > 0 then
      raise exception 'estimated entries remain; change each to its actual amount (or remove it) before declaring the costs complete' using errcode = '55000';
    end if;
    if now_complete then
      return true;
    end if;
    perform private.set_write_ctx(true);
    insert into private.order_cost_state (order_id, costs_complete, changed_by) values (o.id, true, (select auth.uid()))
      on conflict (order_id) do update set costs_complete = true, changed_by = excluded.changed_by, changed_at = now();
    insert into private.order_cost_revisions (order_id, cost_id, action, old_values, new_values, reason, actor)
    values (o.id, null, 'marked_complete', jsonb_build_object('costs_complete', false), jsonb_build_object('costs_complete', true), nullif(left(reason, 500), ''), (select auth.uid()));
    perform private.audit('order.costs_complete', 'order', o.id::text, jsonb_build_object('entries', r.entries));
    perform private.set_write_ctx(false);
    return true;
  end if;

  if not now_complete then
    return false;
  end if;
  if char_length(reason) < 3 then
    raise exception 'say why the costs are being reopened (at least 3 characters); the reason is kept in the history' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  update private.order_cost_state set costs_complete = false, changed_by = (select auth.uid()), changed_at = now() where order_id = o.id;
  insert into private.order_cost_revisions (order_id, cost_id, action, old_values, new_values, reason, actor)
  values (o.id, null, 'marked_incomplete', jsonb_build_object('costs_complete', true), jsonb_build_object('costs_complete', false), left(reason, 500), (select auth.uid()));
  perform private.audit('order.costs_reopened', 'order', o.id::text, '{}'::jsonb);
  perform private.set_write_ctx(false);
  return false;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Completion: what staff may see, and the owner's one-time confirmation for an order whose date cannot be proven.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function admin.order_completion(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  oc private.order_completions%rowtype;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select * into oc from private.order_completions where order_id = o.id;
  return jsonb_build_object(
    'order_id', o.id, 'completed_at', o.completed_at, 'basis', oc.basis, 'basis_reason', oc.reason,
    'needs_verification', o.status = 'delivered' and o.completed_at is null,
    'can_verify', private.has_permission('finance.verify'),
    'delivered_moves', case when o.status = 'delivered' and o.completed_at is null then coalesce((
      select jsonb_agg(jsonb_build_object('from_status', h.from_status, 'at', h.changed_at, 'reason', h.reason) order by h.id)
      from private.order_status_history h where h.order_id = o.id and h.to_status = 'delivered'), '[]'::jsonb) end);
end;
$$;

create or replace function admin.verify_historical_completion(p_order_id uuid, p_completed_at timestamptz, p_reason text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('finance.verify');
  if char_length(reason) < 3 then
    raise exception 'say how the completion date was established (at least 3 characters); it is kept with the record' using errcode = '22023';
  end if;
  if p_completed_at is null then
    raise exception 'the completion date and time are required' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'delivered' then
    raise exception 'only a delivered order has a completion date' using errcode = '55000';
  end if;
  if o.completed_at is not null then
    raise exception 'this order already has a completion date, and it never changes' using errcode = '55000';
  end if;
  if p_completed_at < o.created_at or p_completed_at > now() then
    raise exception 'the completion date must be after the order was created and not in the future' using errcode = '22023';
  end if;
  perform private.set_write_ctx(true);
  perform set_config('m1.completion_verify', o.id::text, true);
  update public.orders set completed_at = p_completed_at where id = o.id;
  perform set_config('m1.completion_verify', '', true);
  insert into private.order_completions (order_id, completed_at, basis, history_id, gross_minor, discount_minor, loyalty_credit_minor,
                                         net_revenue_minor, recorded_by, reason)
  values (o.id, p_completed_at, 'owner_verified', null, o.total_minor, o.discount_minor, o.loyalty_credit_minor,
          o.total_minor - o.discount_minor - o.loyalty_credit_minor, (select auth.uid()), left(reason, 500));
  perform private.audit('order.completion_verified', 'order', o.id::text, jsonb_build_object('completed_at', p_completed_at));
  perform private.set_write_ctx(false);
  return p_completed_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Financial reporting. All grouping, filtering and arithmetic happen here, in the database, over every order (not a page of
--    them). The reporting date is completed_at, in Asia/Qatar months; the creation date plays no part.
-- ---------------------------------------------------------------------------------------------------------------
do $$
begin
  create type private.fin_row as (
    month integer, completed_orders integer, gross_minor bigint, discount_minor bigint, loyalty_credit_minor bigint, net_revenue_minor bigint,
    actual_cost_minor bigint, estimated_cost_minor bigint, orders_costs_complete integer, orders_costs_incomplete integer, orders_costs_missing integer,
    profit_basis_revenue_minor bigint, profit_raw_minor bigint, revenue_without_costs_minor bigint, outstanding_balance_minor bigint, cash_received_minor bigint);
exception when duplicate_object then null;
end;
$$;

-- Renders one bucket. profit_state: none (no completed order), unavailable (completed orders but none has any cost entry),
-- provisional (some order lacks complete costs), verified (every completed order has complete costs).
create or replace function private.fin_render(r private.fin_row)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'month', r.month, 'completed_orders', r.completed_orders,
    'gross_minor', r.gross_minor, 'discount_minor', r.discount_minor, 'loyalty_credit_minor', r.loyalty_credit_minor,
    'net_revenue_minor', r.net_revenue_minor,
    'actual_cost_minor', r.actual_cost_minor, 'estimated_cost_minor', r.estimated_cost_minor,
    'recorded_cost_minor', r.actual_cost_minor + r.estimated_cost_minor,
    'orders_costs_complete', r.orders_costs_complete, 'orders_costs_incomplete', r.orders_costs_incomplete, 'orders_costs_missing', r.orders_costs_missing,
    'profit_minor', case when r.orders_costs_complete + r.orders_costs_incomplete > 0 then r.profit_raw_minor end,
    'profit_basis_revenue_minor', r.profit_basis_revenue_minor,
    'margin_bps', case when r.orders_costs_complete + r.orders_costs_incomplete > 0 and r.profit_basis_revenue_minor > 0
                       then round(r.profit_raw_minor * 10000.0 / r.profit_basis_revenue_minor)::integer end,
    'revenue_without_costs_minor', r.revenue_without_costs_minor,
    'profit_state', case when r.completed_orders = 0 then 'none'
                         when r.orders_costs_complete + r.orders_costs_incomplete = 0 then 'unavailable'
                         when r.orders_costs_incomplete + r.orders_costs_missing > 0 then 'provisional'
                         else 'verified' end,
    'outstanding_balance_minor', r.outstanding_balance_minor, 'cash_received_minor', r.cash_received_minor)
$$;
revoke all on function private.fin_render(private.fin_row) from public;

create or replace function private.financial_report_data(p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  y integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Qatar'))::integer);
  year_from timestamptz;
  year_to timestamptz;
  months jsonb;
  period private.fin_row;
  month_rows private.fin_row[];
begin
  if y < 2020 or y > 2100 then
    raise exception 'the year must be between 2020 and 2100' using errcode = '22023';
  end if;
  if p_month is not null and p_month not between 1 and 12 then
    raise exception 'the month must be 1 to 12' using errcode = '22023';
  end if;
  year_from := make_timestamptz(y, 1, 1, 0, 0, 0, 'Asia/Qatar');
  year_to := make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'Asia/Qatar');

  with done as (
    select extract(month from c.completed_at at time zone 'Asia/Qatar')::integer as m,
           c.gross_minor, c.discount_minor, c.loyalty_credit_minor, c.net_revenue_minor,
           coalesce(r.actual_minor, 0) as actual_minor, coalesce(r.estimated_minor, 0) as estimated_minor,
           coalesce(r.cost_state, 'missing') as cost_state, o.balance_due_minor
    from private.order_completions c
    join public.orders o on o.id = c.order_id
    left join private.order_cost_rollup() r on r.order_id = c.order_id
    where c.completed_at >= year_from and c.completed_at < year_to
  ), agg as (
    select m, count(*)::integer as n,
           sum(gross_minor)::bigint as gross, sum(discount_minor)::bigint as disc, sum(loyalty_credit_minor)::bigint as credit,
           sum(net_revenue_minor)::bigint as revenue, sum(actual_minor)::bigint as actual, sum(estimated_minor)::bigint as estimated,
           (count(*) filter (where cost_state = 'complete'))::integer as n_complete,
           (count(*) filter (where cost_state = 'incomplete'))::integer as n_incomplete,
           (count(*) filter (where cost_state = 'missing'))::integer as n_missing,
           coalesce(sum(net_revenue_minor) filter (where cost_state <> 'missing'), 0)::bigint as base_revenue,
           coalesce(sum(net_revenue_minor - actual_minor - estimated_minor) filter (where cost_state <> 'missing'), 0)::bigint as profit,
           coalesce(sum(net_revenue_minor) filter (where cost_state = 'missing'), 0)::bigint as revenue_no_costs,
           coalesce(sum(balance_due_minor), 0)::bigint as outstanding
    from done group by m
  ), cash as (
    select extract(month from p.received_at at time zone 'Asia/Qatar')::integer as m, sum(p.amount_minor)::bigint as cash
    from public.payments p where p.received_at >= year_from and p.received_at < year_to group by 1
  )
  select array_agg((g.m, coalesce(a.n, 0), coalesce(a.gross, 0), coalesce(a.disc, 0), coalesce(a.credit, 0), coalesce(a.revenue, 0),
                    coalesce(a.actual, 0), coalesce(a.estimated, 0), coalesce(a.n_complete, 0), coalesce(a.n_incomplete, 0), coalesce(a.n_missing, 0),
                    coalesce(a.base_revenue, 0), coalesce(a.profit, 0), coalesce(a.revenue_no_costs, 0), coalesce(a.outstanding, 0), coalesce(ca.cash, 0))::private.fin_row
                   order by g.m)
    into month_rows
  from generate_series(1, 12) g(m) left join agg a on a.m = g.m left join cash ca on ca.m = g.m;

  select jsonb_agg(private.fin_render(f) order by f.month) into months from unnest(month_rows) f;
  period := (select (p_month, coalesce(sum(completed_orders), 0), coalesce(sum(gross_minor), 0), coalesce(sum(discount_minor), 0), coalesce(sum(loyalty_credit_minor), 0),
          coalesce(sum(net_revenue_minor), 0), coalesce(sum(actual_cost_minor), 0), coalesce(sum(estimated_cost_minor), 0),
          coalesce(sum(orders_costs_complete), 0), coalesce(sum(orders_costs_incomplete), 0), coalesce(sum(orders_costs_missing), 0),
          coalesce(sum(profit_basis_revenue_minor), 0), coalesce(sum(profit_raw_minor), 0), coalesce(sum(revenue_without_costs_minor), 0),
          coalesce(sum(outstanding_balance_minor), 0), coalesce(sum(cash_received_minor), 0))::private.fin_row
    from unnest(month_rows) f where p_month is null or f.month = p_month);

  return jsonb_build_object(
    'year', y, 'month', p_month, 'timezone', 'Asia/Qatar', 'currency', 'QAR',
    'period', private.fin_render(period), 'months', months,
    'years', (select coalesce(jsonb_agg(yy order by yy desc), '[]'::jsonb) from (
                select extract(year from c.completed_at at time zone 'Asia/Qatar')::integer as yy from private.order_completions c
                union select extract(year from (now() at time zone 'Asia/Qatar'))::integer union select y) s),
    'needs_verification', jsonb_build_object(
      'count', (select count(*) from public.orders where status = 'delivered' and completed_at is null),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'order_ref', o.order_ref) order by o.created_at)
                          from (select id, order_ref, created_at from public.orders where status = 'delivered' and completed_at is null order by created_at limit 20) o), '[]'::jsonb)),
    -- Costs recorded on orders that are NOT completed (as of now): money spent or expected that no revenue has been recognised against yet.
    'unrecognized_costs', (select jsonb_build_object(
        'open_orders_minor', coalesce(sum(r.actual_minor + r.estimated_minor) filter (where o.status not in ('cancelled', 'delivered')), 0),
        'cancelled_orders_minor', coalesce(sum(r.actual_minor + r.estimated_minor) filter (where o.status = 'cancelled'), 0),
        'delivered_unverified_minor', coalesce(sum(r.actual_minor + r.estimated_minor) filter (where o.status = 'delivered' and o.completed_at is null), 0))
      from private.order_cost_rollup() r join public.orders o on o.id = r.order_id));
end;
$$;
revoke all on function private.financial_report_data(integer, integer) from public;

create or replace function admin.financial_report(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('finance.read');
  return private.financial_report_data(p_year, p_month);
end;
$$;

create or replace function admin.list_completed_orders(p_year integer default null, p_month integer default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  y integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Qatar'))::integer);
  from_ts timestamptz;
  to_ts timestamptz;
  fin boolean;
  total bigint;
begin
  perform private.require_permission('orders.read');
  if y < 2020 or y > 2100 then
    raise exception 'the year must be between 2020 and 2100' using errcode = '22023';
  end if;
  if p_month is not null and p_month not between 1 and 12 then
    raise exception 'the month must be 1 to 12' using errcode = '22023';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  fin := private.has_permission('finance.read');
  from_ts := make_timestamptz(y, coalesce(p_month, 1), 1, 0, 0, 0, 'Asia/Qatar');
  to_ts := case when p_month is null or p_month = 12 then make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'Asia/Qatar')
                else make_timestamptz(y, p_month + 1, 1, 0, 0, 0, 'Asia/Qatar') end;
  select count(*) into total from private.order_completions c where c.completed_at >= from_ts and c.completed_at < to_ts;
  return jsonb_build_object('year', y, 'month', p_month, 'total', total, 'limit', p_limit, 'offset', p_offset, 'finance', fin,
    'years', (select coalesce(jsonb_agg(yy order by yy desc), '[]'::jsonb) from (
                select extract(year from c.completed_at at time zone 'Asia/Qatar')::integer as yy from private.order_completions c
                union select extract(year from (now() at time zone 'Asia/Qatar'))::integer union select y) s),
    'rows', coalesce((
    select jsonb_agg(rec order by (rec ->> 'completed_at') desc, (rec ->> 'id'))
    from (
      select jsonb_build_object(
          'id', o.id, 'order_ref', o.order_ref, 'customer_id', cu.id, 'customer_name', cu.full_name,
          'completed_at', c.completed_at, 'created_at', o.created_at, 'workflow_version', o.workflow_version, 'fulfillment_type', o.fulfillment_type,
          'gross_minor', c.gross_minor, 'discount_minor', c.discount_minor, 'loyalty_credit_minor', c.loyalty_credit_minor,
          'net_revenue_minor', c.net_revenue_minor, 'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor)
        || case when fin then jsonb_build_object(
          'actual_cost_minor', coalesce(r.actual_minor, 0), 'estimated_cost_minor', coalesce(r.estimated_minor, 0),
          'cost_state', coalesce(r.cost_state, 'missing'),
          'profit_minor', case when r.order_id is null then null else c.net_revenue_minor - r.actual_minor - r.estimated_minor end,
          'profit_is_provisional', coalesce(r.cost_state, 'missing') <> 'complete',
          'margin_bps', case when r.order_id is not null and c.net_revenue_minor > 0
                             then round((c.net_revenue_minor - r.actual_minor - r.estimated_minor) * 10000.0 / c.net_revenue_minor)::integer end)
        else '{}'::jsonb end as rec
      from private.order_completions c
      join public.orders o on o.id = c.order_id
      join public.customers cu on cu.id = o.customer_id
      left join private.order_cost_rollup() r on r.order_id = c.order_id
      where c.completed_at >= from_ts and c.completed_at < to_ts
      order by c.completed_at desc, o.id
      limit p_limit offset p_offset
    ) q), '[]'::jsonb));
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
      select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.net_payable_minor, o.created_at, c.full_name as customer_name
            from public.orders o join public.customers c on c.id = o.customer_id join public.order_statuses s on s.code = o.status
            order by o.created_at desc limit 8) t), '[]'::jsonb));
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The customer's order history for staff: one answer with each order's money, items (with the order-level discount and credit
--    spread over the lines for display), payments, and the status and tracking history. Never a cost, a margin or a supplier.
-- ---------------------------------------------------------------------------------------------------------------
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
    select jsonb_agg(x.j order by x.created_at desc, x.id)
    from (
      select o.id, o.created_at,
        jsonb_build_object(
          'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'status_label', s.customer_label,
          'workflow_version', o.workflow_version, 'fulfillment_type', o.fulfillment_type, 'delivery_method', o.delivery_method,
          'created_at', o.created_at, 'completed_at', o.completed_at, 'needs_completion_verification', o.status = 'delivered' and o.completed_at is null,
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
      order by o.created_at desc, o.id
      limit p_limit offset p_offset
    ) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. admin.create_order with a 12th argument: optional private costs, saved in the SAME transaction as the order.
--    A copy of the 11-argument function (which is not touched, so the website that calls it keeps working) plus the costs.
--    The costs need finance.manage; a person without it who sends costs is refused, never silently ignored. When no costs are
--    sent the idempotency fingerprint is byte-for-byte the 11-argument function's, so a retry is recognised by either.
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
  p_expected_deposit_minor bigint,
  p_costs jsonb
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
  costs jsonb;
  cost_count integer := 0;
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
  -- Costs are private to the owner: asking to save them needs the permission, and is refused (not ignored) without it.
  costs := private.normalize_costs(p_costs);
  if costs is not null then
    perform private.require_permission('finance.manage');
    cost_count := jsonb_array_length(costs);
  end if;
  if private.via_gateway() and (p_expected_net_minor is null or p_expected_deposit_minor is null) then
    raise exception 'the amounts shown on the screen must be supplied; reload the page and try again' using errcode = '22023';
  end if;

  replay := private.idempotency_claim('order.create', p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id, 'items', p_items, 'quotation_id', p_quotation_id,
      'placed_via', coalesce(p_placed_via, 'admin'), 'delivery_method', p_delivery_method, 'delivery_address', p_delivery_address,
      'discount', d, 'redeem_points', pts,
      'expected_net_minor', p_expected_net_minor, 'expected_deposit_minor', p_expected_deposit_minor)
    || case when costs is null then '{}'::jsonb else jsonb_build_object('costs', costs) end,
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

  -- The private costs, in the same transaction: the order exists with them or not at all. The audit log gets the COUNT only; the amounts
  -- live in the owner-only cost tables and their revision history.
  if costs is not null then
    for e in select x.value as item from jsonb_array_elements(costs) as x(value) loop
      perform private.insert_order_cost(new_id, e.item, null, 'entered when the order was created');
    end loop;
    insert into private.order_cost_state (order_id, costs_complete) values (new_id, false);
    perform private.audit('order.costs_entered', 'order', new_id::text, jsonb_build_object('entries', cost_count));
  end if;

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
-- 8. Privileges: signed-in staff sessions and the staff gateway only; never anon, never PUBLIC.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'admin.order_costs(uuid)',
    'admin.add_order_cost(uuid, uuid, text, text, bigint, text, text, date, text)',
    'admin.edit_order_cost(uuid, integer, text, text, bigint, text, text, date, text, text)',
    'admin.void_order_cost(uuid, integer, text)',
    'admin.set_order_costs_complete(uuid, boolean, text)',
    'admin.order_completion(uuid)',
    'admin.verify_historical_completion(uuid, timestamptz, text)',
    'admin.financial_report(integer, integer)',
    'admin.list_completed_orders(integer, integer, integer, integer)',
    'admin.overview_summary(integer)',
    'admin.customer_orders(uuid, integer, integer)',
    'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated, m1_staff_gateway', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Self-checks: a mistake here fails the migration (one transaction, so nothing is left half-applied).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
  alloc bigint[];
begin
  foreach f in array array[
    'admin.order_costs(uuid)', 'admin.add_order_cost(uuid, uuid, text, text, bigint, text, text, date, text)',
    'admin.edit_order_cost(uuid, integer, text, text, bigint, text, text, date, text, text)', 'admin.void_order_cost(uuid, integer, text)',
    'admin.set_order_costs_complete(uuid, boolean, text)', 'admin.order_completion(uuid)', 'admin.verify_historical_completion(uuid, timestamptz, text)',
    'admin.financial_report(integer, integer)', 'admin.list_completed_orders(integer, integer, integer, integer)', 'admin.overview_summary(integer)',
    'admin.customer_orders(uuid, integer, integer)', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint, jsonb)'
  ] loop
    if to_regprocedure(f) is null then
      raise exception 'the function % must exist after this migration', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') or has_function_privilege('service_role', f, 'execute') then
      raise exception '% must not be executable by anon, PUBLIC or service_role', f;
    end if;
    if not has_function_privilege('m1_staff_gateway', f, 'execute') then
      raise exception '% must be executable by the staff gateway', f;
    end if;
  end loop;
  foreach f in array array['admin.create_order(uuid, jsonb, uuid, text, text, text)', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text)',
                           'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)'] loop
    if to_regprocedure(f) is null then
      raise exception 'the earlier function % must still exist', f;
    end if;
  end loop;
  -- the spreading is exact: 3 lines of 100, discount 100, credit 50 -> lines add up to 150 and none goes below zero
  alloc := private.allocate_reduction(100, array[100, 100, 100]::bigint[]);
  if alloc <> array[34, 33, 33]::bigint[] then
    raise exception 'allocate_reduction gave % instead of {34,33,33}', alloc;
  end if;
  if (select sum(x) from unnest(private.allocate_reduction(7, array[1, 1, 1, 0, 4]::bigint[])) x) <> 7 then
    raise exception 'allocate_reduction does not add up';
  end if;
end;
$$;
