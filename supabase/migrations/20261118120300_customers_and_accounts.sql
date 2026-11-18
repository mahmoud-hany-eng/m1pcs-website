-- PLAT-0001, migration 4 of 11: customer profiles and account linking.
--
-- A CUSTOMER is a business record; an ACCOUNT is a Supabase Auth user. They are separate (REC-PLAT-004) so that a
-- WhatsApp customer or a guest quotation exists without any account, and a person who registers later is joined to
-- their history only through a single-use, expiring claim code or an explicit administrator action: never by
-- trusting an unverified email address or phone number (OQ-0003 is still open; this is the safe default).
--
-- Customers never have to register to ask for a quotation: nothing here is on the quotation path.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique default private.next_code('C'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,24}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ar')),
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  source text not null default 'website' check (source in ('website', 'whatsapp', 'instagram', 'walk_in', 'other')),
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

-- The code and the source are set once and never edited.
create function private.keep_customer_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_code is distinct from old.customer_code or new.source is distinct from old.source then
    raise exception 'customer_code and source cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger customers_keep_identity before update on public.customers
  for each row execute function private.keep_customer_identity();

create table public.customer_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  linked_via text not null check (linked_via in ('self_signup', 'claim_code', 'admin')),
  linked_at timestamptz not null default now()
);
alter table public.customer_accounts enable row level security;
create index customer_accounts_customer_id_idx on public.customer_accounts (customer_id);
create trigger customer_accounts_no_update before update on public.customer_accounts
  for each row execute function private.forbid_mutation();

-- Which customers does the signed-in user own? Definer, so a policy can ask without reading customer_accounts
-- through that table's own policy (no recursion, one place to audit).
create function private.current_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$ select ca.customer_id from public.customer_accounts ca where ca.user_id = (select auth.uid()) $$;
revoke all on function private.current_customer_ids() from public;
grant execute on function private.current_customer_ids() to authenticated;

create function private.owns_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_customer_id is not null and exists (
    select 1 from public.customer_accounts ca
    where ca.user_id = (select auth.uid()) and ca.customer_id = p_customer_id
  )
$$;
revoke all on function private.owns_customer(uuid) from public;
grant execute on function private.owns_customer(uuid) to authenticated;

-- ---- privileges: deny first, then grant exactly what the product needs ---------------------------------------
revoke all on table public.customers from anon, authenticated;
revoke all on table public.customer_accounts from anon, authenticated;
grant select, insert on public.customers to authenticated;
-- A customer may edit their own contact details; code, source, id and timestamps are not editable by any API role.
grant update (full_name, phone, email, preferred_language, delivery_address, marketing_consent)
  on public.customers to authenticated;
grant select on public.customer_accounts to authenticated;

-- ---- row level security ------------------------------------------------------------------------------------
create policy customers_select_own on public.customers for select to authenticated
  using (id in (select private.current_customer_ids()));
create policy customers_select_staff on public.customers for select to authenticated
  using (private.has_permission('customers.read'));
create policy customers_insert_staff on public.customers for insert to authenticated
  with check (private.has_permission('customers.manage'));
create policy customers_update_own on public.customers for update to authenticated
  using (id in (select private.current_customer_ids()))
  with check (id in (select private.current_customer_ids()));
create policy customers_update_staff on public.customers for update to authenticated
  using (private.has_permission('customers.manage'))
  with check (private.has_permission('customers.manage'));

create policy customer_accounts_select_own on public.customer_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy customer_accounts_select_staff on public.customer_accounts for select to authenticated
  using (private.has_permission('customers.read'));

-- ---------------------------------------------------------------------------------------------------------
-- Staff-only notes about a customer: never visible to the customer.
-- ---------------------------------------------------------------------------------------------------------
create table private.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author uuid,
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table private.customer_notes enable row level security;
revoke all on table private.customer_notes from anon, authenticated, service_role;
create trigger customer_notes_append_only before update or delete on private.customer_notes
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------------------
-- Account linking.
-- ---------------------------------------------------------------------------------------------------------
create table private.customer_claim_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  code_hash bytea not null unique,         -- sha-256 of the normalised code; the code itself is never stored
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((used_at is null) = (used_by is null))
);
alter table private.customer_claim_codes enable row level security;
revoke all on table private.customer_claim_codes from anon, authenticated, service_role;

create table private.claim_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  success boolean not null
);
alter table private.claim_attempts enable row level security;
revoke all on table private.claim_attempts from anon, authenticated, service_role;
create index claim_attempts_user_at_idx on private.claim_attempts (user_id, at);

-- A signed-in person with no customer record creates their own. This is NOT linking to existing history.
create function public.create_my_customer_profile(
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_preferred_language text default 'en'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if exists (select 1 from public.customer_accounts where user_id = uid) then
    raise exception 'this account already has a customer profile' using errcode = '23505';
  end if;
  insert into public.customers (full_name, phone, email, preferred_language, source)
  values (p_full_name, p_phone, p_email, coalesce(p_preferred_language, 'en'), 'website')
  returning id into new_id;
  insert into public.customer_accounts (user_id, customer_id, linked_via) values (uid, new_id, 'self_signup');
  perform private.audit('customer.self_signup', 'customer', new_id::text, '{}'::jsonb);
  return new_id;
end;
$$;
revoke all on function public.create_my_customer_profile(text, text, text, text) from public, anon;
grant execute on function public.create_my_customer_profile(text, text, text, text) to authenticated;

-- Joins the signed-in account to an existing customer with a code that staff issued. Returns the customer id, or
-- null when the code is wrong, expired, already used or the account is rate limited. The answer is deliberately the
-- same in every failure case so that it does not reveal which codes exist. Failures are counted, which is why the
-- function returns null instead of raising (a raised error would roll the count back).
create function public.claim_customer_profile(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  normalised text;
  hit private.customer_claim_codes%rowtype;
  recent_failures integer;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if exists (select 1 from public.customer_accounts where user_id = uid) then
    raise exception 'this account already has a customer profile' using errcode = '23505';
  end if;

  select count(*) into recent_failures
  from private.claim_attempts
  where user_id = uid and not success and at > now() - interval '1 hour';
  if recent_failures >= 5 then
    return null;
  end if;

  normalised := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(normalised) <> 20 then
    insert into private.claim_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  select * into hit
  from private.customer_claim_codes
  where code_hash = sha256(convert_to(normalised, 'UTF8'))
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    insert into private.claim_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  insert into public.customer_accounts (user_id, customer_id, linked_via) values (uid, hit.customer_id, 'claim_code');
  update private.customer_claim_codes set used_at = now(), used_by = uid where id = hit.id;
  insert into private.claim_attempts (user_id, success) values (uid, true);
  perform private.audit('customer.claim_code_used', 'customer', hit.customer_id::text, '{}'::jsonb);
  return hit.customer_id;
end;
$$;
revoke all on function public.claim_customer_profile(text) from public, anon;
grant execute on function public.claim_customer_profile(text) to authenticated;
