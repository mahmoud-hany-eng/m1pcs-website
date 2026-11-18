-- PLAT-0001, migration 9 of 11: the loyalty rewards ledger.
--
-- Every change to a customer's points is a row (REQ-LOY-001). There is no balance column to edit: the balance is
-- the sum of the ledger, so no client-supplied balance can exist (REC-PLAT-009). The database itself prevents a
-- duplicate award: one award per order and one reversal per award are unique partial indexes (REQ-LOY-005). The
-- award is written by the same transaction that moves the order to the awarding status (admin.transition_order).
--
-- NOT IN THIS PHASE: redeeming points. REQ-LOY-003 (a point is worth QAR 0.10) is stored as a policy for later, and
-- redemption rules are undecided (OQ-0008), so there is no redemption entry type and no function that spends points.

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  entry_type text not null check (entry_type in ('award', 'reversal', 'adjustment')),
  points integer not null check (points <> 0),
  reverses_entry_id uuid references public.loyalty_ledger (id) on delete restrict,
  -- A generic, customer-safe sentence written by the system. The staff reason is in private.loyalty_entry_reasons.
  description text not null check (char_length(description) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint loyalty_sign check (
    (entry_type = 'award' and points > 0) or (entry_type = 'reversal' and points < 0) or entry_type = 'adjustment'),
  constraint loyalty_award_has_order check (entry_type <> 'award' or order_id is not null),
  constraint loyalty_reversal_link check ((entry_type = 'reversal') = (reverses_entry_id is not null))
);
alter table public.loyalty_ledger enable row level security;
create index loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id, created_at);
create unique index loyalty_one_award_per_order on public.loyalty_ledger (order_id) where entry_type = 'award';
create unique index loyalty_one_reversal_per_entry on public.loyalty_ledger (reverses_entry_id)
  where entry_type = 'reversal';
create trigger loyalty_ledger_insert_guard before insert on public.loyalty_ledger
  for each row execute function private.require_write_ctx();
create trigger loyalty_ledger_append_only before update or delete on public.loyalty_ledger
  for each row execute function private.forbid_mutation();
create trigger loyalty_ledger_no_truncate before truncate on public.loyalty_ledger
  for each statement execute function private.forbid_mutation();

create table private.loyalty_entry_reasons (
  entry_id uuid primary key references public.loyalty_ledger (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  recorded_by uuid
);
alter table private.loyalty_entry_reasons enable row level security;
revoke all on table private.loyalty_entry_reasons from anon, authenticated, service_role;
create trigger loyalty_entry_reasons_append_only before update or delete on private.loyalty_entry_reasons
  for each row execute function private.forbid_mutation();

-- The balance is derived. security_invoker makes the view obey the ledger's row level security, so a customer's
-- query returns only their own balance.
create view public.loyalty_balances with (security_invoker = true) as
  select customer_id, sum(points)::bigint as balance_points, count(*)::integer as entries
  from public.loyalty_ledger
  group by customer_id;

revoke all on table public.loyalty_ledger from anon, authenticated, service_role;
revoke all on table public.loyalty_balances from anon, authenticated, service_role;
grant select on public.loyalty_ledger, public.loyalty_balances to authenticated, service_role;

create policy loyalty_ledger_select_own on public.loyalty_ledger for select to authenticated
  using (customer_id in (select private.current_customer_ids()));
create policy loyalty_ledger_select_staff on public.loyalty_ledger for select to authenticated
  using (private.has_permission('loyalty.read'));

-- ---------------------------------------------------------------------------------------------------------
-- Ledger routines. They run inside the staff functions (write flag on) and read the policies, never constants.
-- ---------------------------------------------------------------------------------------------------------
create function private.loyalty_balance(p_customer_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$ select coalesce(sum(points), 0)::bigint from public.loyalty_ledger where customer_id = p_customer_id $$;
revoke all on function private.loyalty_balance(uuid) from public;

create function private.negative_balance_allowed()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((private.policy('loyalty.negative_balance') ->> 'allowed')::boolean, false) $$;
revoke all on function private.negative_balance_allowed() from public;

-- Awards the points for an order exactly once. Returns the ledger entry id, or null when the order earns no
-- whole point. A second call returns the existing entry and writes nothing.
create function private.award_loyalty_for_order(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  rate bigint;
  base_kind text;
  rounding text;
  base bigint;
  pts bigint;
  entry_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  rate := (private.policy('loyalty.earn_rate') ->> 'qar_per_point_minor')::bigint;
  base_kind := private.policy('loyalty.earning_base') ->> 'base';
  rounding := private.policy('loyalty.earning_base') ->> 'rounding';
  if rate is null or rate < 1 or base_kind is null or rounding is null then
    raise exception 'the loyalty policies are incomplete' using errcode = '55000';
  end if;

  base := case base_kind when 'amount_paid' then o.amount_paid_minor else o.total_minor end;
  pts := case rounding
    when 'floor' then base / rate
    when 'ceil' then (base + rate - 1) / rate
    else round(base::numeric / rate)::bigint
  end;
  if pts < 1 then
    return null;
  end if;
  if pts > 2147483647 then
    raise exception 'points out of range' using errcode = '22003';
  end if;

  insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description)
  values (o.customer_id, o.id, 'award', pts::integer, 'Points earned on order ' || o.order_ref)
  on conflict (order_id) where entry_type = 'award' do nothing
  returning id into entry_id;

  if entry_id is null then
    select id into entry_id from public.loyalty_ledger where order_id = o.id and entry_type = 'award';
    return entry_id;
  end if;

  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, coalesce(nullif(btrim(p_reason), ''), 'award for fulfilled order'), (select auth.uid()));
  return entry_id;
end;
$$;
revoke all on function private.award_loyalty_for_order(uuid, text) from public;

-- Reverses the award of an order (for example after a refund). One reversal per award, by the unique index.
create function private.reverse_loyalty_award(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  award public.loyalty_ledger%rowtype;
  entry_id uuid;
begin
  select * into award from public.loyalty_ledger where order_id = p_order_id and entry_type = 'award';
  if not found then
    raise exception 'this order has no loyalty award to reverse' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.loyalty_ledger where reverses_entry_id = award.id) then
    raise exception 'this award has already been reversed' using errcode = '23505';
  end if;
  if not private.negative_balance_allowed()
     and private.loyalty_balance(award.customer_id) - award.points < 0 then
    raise exception 'reversing this award would make the balance negative; whether that is allowed is undecided (OQ-0010)'
      using errcode = '55000';
  end if;
  insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, reverses_entry_id, description)
  values (award.customer_id, award.order_id, 'reversal', -award.points, award.id, 'Points reversed')
  returning id into entry_id;
  insert into private.loyalty_entry_reasons (entry_id, reason, recorded_by)
  values (entry_id, coalesce(nullif(btrim(p_reason), ''), 'reversal'), (select auth.uid()));
  return entry_id;
end;
$$;
revoke all on function private.reverse_loyalty_award(uuid, text) from public;
