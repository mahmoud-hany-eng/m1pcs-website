-- PLAT-0001, migration 8 of 11: deposits and payments in QAR, as an append-only ledger.
--
-- A deposit is paid when the ledger says so, never because a quotation was sent or a customer said so (nothing in
-- the customer's reach can create a ledger row). Only a member of staff with payments.record can add a payment,
-- through admin.record_payment. A mistake is never edited: it is reversed by a new negative row that points at the
-- original, and each payment can be reversed once. The order's paid amount is recomputed from this ledger.
--
-- public.payments holds what the customer may see about their own money: amount, method, date and a receipt number.
-- Everything internal (who recorded it, the bank or card reference, fees, internal notes) is in
-- private.payment_details and never reaches a customer.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  entry_type text not null check (entry_type in ('payment', 'reversal', 'refund')),
  purpose text not null check (purpose in ('deposit', 'balance', 'other')),
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null default 'QAR' check (currency = 'QAR'),
  method text not null check (method in ('cash', 'bank_transfer', 'card', 'other')),
  receipt_number text check (receipt_number is null or char_length(receipt_number) <= 60),
  received_at timestamptz not null default now(),
  reverses_payment_id uuid references public.payments (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payments_sign check (
    (entry_type = 'payment' and amount_minor > 0) or (entry_type in ('reversal', 'refund') and amount_minor < 0)),
  constraint payments_reversal_link check ((entry_type = 'reversal') = (reverses_payment_id is not null))
);
alter table public.payments enable row level security;
create index payments_order_idx on public.payments (order_id, received_at);
create unique index payments_one_reversal_per_payment on public.payments (reverses_payment_id)
  where reverses_payment_id is not null;
create trigger payments_insert_guard before insert on public.payments
  for each row execute function private.require_write_ctx();
create trigger payments_append_only before update or delete on public.payments
  for each row execute function private.forbid_mutation();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function private.forbid_mutation();

create table private.payment_details (
  payment_id uuid primary key references public.payments (id) on delete restrict,
  recorded_by uuid,
  internal_reference text check (internal_reference is null or char_length(internal_reference) <= 120),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 1000),
  processor_fee_minor bigint check (processor_fee_minor is null or processor_fee_minor >= 0)
);
alter table private.payment_details enable row level security;
revoke all on table private.payment_details from anon, authenticated, service_role;
create trigger payment_details_append_only before update or delete on private.payment_details
  for each row execute function private.forbid_mutation();

-- The one place the paid amount is computed. Runs inside the staff functions, with the write flag on.
create function private.recompute_order_paid(p_order_id uuid)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  paid bigint;
begin
  select coalesce(sum(amount_minor), 0) into paid from public.payments where order_id = p_order_id;
  update public.orders set amount_paid_minor = paid where id = p_order_id;
  return paid;
end;
$$;
revoke all on function private.recompute_order_paid(uuid) from public;

-- Read-only for the API roles.
revoke all on table public.payments from anon, authenticated, service_role;
grant select on public.payments to authenticated, service_role;

create policy payments_select_own on public.payments for select to authenticated
  using (private.owns_order(order_id));
create policy payments_select_staff on public.payments for select to authenticated
  using (private.has_permission('payments.read'));
