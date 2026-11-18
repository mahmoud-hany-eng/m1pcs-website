-- PLAT-0001, migration 1 of 11: schemas, shared helpers and the audit log.
--
-- Layout (REC-PLAT-006, REC-PLAT-007):
--   public   customer-safe tables only. Exposed through the Supabase API. Every table has row level security.
--   private  everything a customer must never reach: finance, supplier costs, staff notes, staff, policies,
--            audit. NOT exposed through the API and no API role has a table privilege here.
--   admin    the staff API: SECURITY DEFINER functions that check a permission from the staff tables first.
--            Not exposed through the API until the admin phase (supabase/config.toml lists the exposed schemas).
--
-- Nothing here contains a credential, a customer record or a business figure.

create schema if not exists private;
create schema if not exists admin;

revoke all on schema private from public;
revoke all on schema admin from public;

-- API roles may resolve names in these schemas (policies and staff functions live there) but they receive no
-- table privileges: see the explicit REVOKE statements after each table and the guard in the last migration.
grant usage on schema private to authenticated;
grant usage on schema admin to authenticated;

alter default privileges in schema private revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema private revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from anon, authenticated, service_role;
alter default privileges in schema admin revoke all on functions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Readable references (customer, quotation, order). Sequence based, so they cannot collide; access control
-- never depends on a reference being unguessable.
-- ---------------------------------------------------------------------------------------------------------
create sequence private.customer_code_seq;
create sequence private.quotation_code_seq;
create sequence private.order_code_seq;

create function private.next_code(p_prefix text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  n bigint;
begin
  case p_prefix
    when 'C' then n := nextval('private.customer_code_seq');
    when 'Q' then n := nextval('private.quotation_code_seq');
    when 'O' then n := nextval('private.order_code_seq');
    else raise exception 'unknown reference prefix %', p_prefix using errcode = '22023';
  end case;
  return p_prefix || '-' || to_char(now() at time zone 'Asia/Qatar', 'YYMM') || '-' || lpad(n::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Triggers shared by many tables.
-- ---------------------------------------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Ledgers and audit trails are append-only: a correction is a new row, never an edit. The trigger fires for every
-- role, including the table owner, so a buggy server route or a mistaken manual statement cannot rewrite history.
create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed (write a correcting row instead)',
    tg_table_schema || '.' || tg_table_name, tg_op
    using errcode = '55000';
end;
$$;

-- Money, status and ledger tables change only inside the staff functions, which switch this transaction-local
-- flag on. It is the second layer behind revoked table privileges, not the first.
create function private.write_ctx_on()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('m1.write_ctx', true), '') = 'on' $$;

create function private.set_write_ctx(p_on boolean)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('m1.write_ctx', case when p_on then 'on' else 'off' end, true);
end;
$$;

create function private.require_write_ctx()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.write_ctx_on() then
    raise exception '% may only be changed through the staff functions in schema admin (%)',
      tg_table_schema || '.' || tg_table_name, tg_op
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Audit log: who did what, for administrator and ledger actions. Staff only, append-only.
-- ---------------------------------------------------------------------------------------------------------
create table private.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null check (char_length(action) between 1 and 80),
  entity text not null check (char_length(entity) between 1 and 80),
  entity_id text check (entity_id is null or char_length(entity_id) <= 80),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
alter table private.audit_log enable row level security;
revoke all on table private.audit_log from anon, authenticated, service_role;
create trigger audit_log_append_only before update or delete on private.audit_log
  for each row execute function private.forbid_mutation();
create trigger audit_log_no_truncate before truncate on private.audit_log
  for each statement execute function private.forbid_mutation();

create function private.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.audit_log (actor, action, entity, entity_id, details)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function private.audit(text, text, text, jsonb) from public;
