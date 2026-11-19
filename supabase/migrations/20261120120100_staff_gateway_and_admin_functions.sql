-- PLAT-0003, migration 15: what the staff gateway needs in the database, and the staff functions the admin screens use.
--
--   1. A NOLOGIN role for the server-only staff gateway, and a database-side check that does not take the gateway's
--      word for who is signed in or at what assurance level.
--   2. Generated, unique receipt references; Fawran as a payment method.
--   3. Claim codes can be revoked. An account may be linked to more than one customer record (so a customer who made
--      a profile can still claim older WhatsApp orders) and every link is verified and audited. Nothing is ever
--      linked, or merged, because contact details match.
--   4. Staff functions: create a customer, search and read customers, orders, payments and loyalty, the dashboard
--      figures, staff management (never of oneself).
--
-- The role has no password and no login here. Making it able to log in is a manual step, on a development project
-- first (docs/project-memory/architecture/STAFF_GATEWAY.md). Nothing in this file contains a secret.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The gateway role and the verification of what it claims.
-- ---------------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'm1_staff_gateway') then
    create role m1_staff_gateway nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end;
$$;

-- Is this connection the staff gateway (or a login that was made a member of it)? session_user is the role that
-- logged in, whatever `set role` was run since, so the gateway cannot hide by switching role. A superuser is not
-- counted: it is not a gateway, and it can do anything anyway.
create function private.via_gateway()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select session_user = 'm1_staff_gateway'
      or exists (
        select 1
        from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles g on g.oid = m.roleid and g.rolname = 'm1_staff_gateway'
        join pg_catalog.pg_roles u on u.oid = m.member and u.rolname = session_user
      )
$$;
revoke all on function private.via_gateway() from public;

-- The claims that reach the database through the Data API were verified by PostgREST, which checked the token's
-- signature. The claims the gateway supplies were verified by server code, which the database cannot see. So for a
-- gateway connection the database checks them itself against the auth service's own record of the sign-in session:
-- the session must exist (signing out deletes it), belong to the same user, not have expired, and have completed the
-- second factor. A gateway that is lying about who is signed in, or at what level, must therefore hold a live
-- second-factor session id of that user, which only that user's token carries.
create function private.gateway_session_is_aal2()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  sid uuid;
begin
  begin
    sid := (claims ->> 'session_id')::uuid;
  exception when others then
    return false;
  end;
  if sid is null or (select auth.uid()) is null then
    return false;
  end if;
  return exists (
    select 1
    from auth.sessions s
    where s.id = sid
      and s.user_id = (select auth.uid())
      and s.aal::text = 'aal2'
      and (s.not_after is null or s.not_after > now())
  );
end;
$$;
revoke all on function private.gateway_session_is_aal2() from public;

create or replace function private.mfa_satisfied()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  required boolean;
begin
  select (value ->> 'required')::boolean into required from private.business_policies where key = 'admin.mfa';
  if required is null then
    required := true;
  end if;
  if not required then
    return true;
  end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    return false;
  end if;
  if private.via_gateway() then
    return private.gateway_session_is_aal2();
  end if;
  return true;
end;
$$;
revoke all on function private.mfa_satisfied() from public;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Receipts and Fawran.
-- ---------------------------------------------------------------------------------------------------------------
create sequence private.receipt_code_seq;

create or replace function private.next_code(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  case p_prefix
    when 'C' then n := nextval('private.customer_code_seq');
    when 'Q' then n := nextval('private.quotation_code_seq');
    when 'O' then n := nextval('private.order_code_seq');
    when 'R' then n := nextval('private.receipt_code_seq');
    else raise exception 'unknown reference prefix %', p_prefix using errcode = '22023';
  end case;
  return p_prefix || '-' || to_char(now() at time zone 'Asia/Qatar', 'YYMM') || '-' || lpad(n::text, 5, '0');
end;
$$;

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'fawran', 'bank_transfer', 'card', 'other'));
create unique index payments_receipt_number_unique on public.payments (receipt_number) where receipt_number is not null;

-- A payment gets a receipt reference that the system generates, unique and never reused. The person recording it
-- may add the processor's own reference (for example the Fawran transaction number) as the internal reference.
-- Recording a payment is the one way a deposit becomes "paid": it needs the payments.record permission, and nothing
-- a customer can reach can do it.
create or replace function admin.record_payment(
  p_order_id uuid,
  p_purpose text,
  p_amount_minor bigint,
  p_method text,
  p_received_at timestamptz default now(),
  p_receipt_number text default null,
  p_internal_reference text default null,
  p_internal_notes text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  pay_id uuid;
  receipt text;
begin
  perform private.require_permission('payments.record');
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'a payment amount must be greater than zero' using errcode = '22023';
  end if;
  if p_received_at > now() + interval '1 day' then
    raise exception 'a payment cannot be dated in the future' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status = 'cancelled' then
    raise exception 'a cancelled order cannot receive a payment' using errcode = '55000';
  end if;
  if o.amount_paid_minor + p_amount_minor > o.total_minor then
    raise exception 'this payment would exceed the order total' using errcode = '55000';
  end if;

  receipt := coalesce(nullif(btrim(p_receipt_number), ''), private.next_code('R'));

  perform private.set_write_ctx(true);
  insert into public.payments (order_id, entry_type, purpose, amount_minor, method, receipt_number, received_at)
  values (o.id, 'payment', p_purpose, p_amount_minor, p_method, receipt, p_received_at)
  returning id into pay_id;
  insert into private.payment_details (payment_id, recorded_by, internal_reference, internal_notes)
  values (pay_id, (select auth.uid()), p_internal_reference, p_internal_notes);
  perform private.recompute_order_paid(o.id);
  perform private.try_award_loyalty(o.id);
  perform private.audit('payment.recorded', 'payment', pay_id::text,
    jsonb_build_object('order_id', o.id, 'amount_minor', p_amount_minor, 'purpose', p_purpose, 'method', p_method, 'receipt', receipt));
  perform private.set_write_ctx(false);
  return pay_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Claim codes: revocation, and an account that may be linked to more than one customer record.
-- ---------------------------------------------------------------------------------------------------------------
alter table private.customer_claim_codes
  add column revoked_at timestamptz,
  add column revoked_by uuid,
  add column revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 3 and 500);
alter table private.customer_claim_codes
  add constraint claim_code_revoke_is_whole check ((revoked_at is null) = (revoked_reason is null));

alter table public.customer_accounts drop constraint customer_accounts_pkey;
alter table public.customer_accounts add constraint customer_accounts_pkey primary key (user_id, customer_id);

-- A limit, so linking cannot be used to sweep up records.
create function private.limit_account_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.customer_accounts where user_id = new.user_id) >= 5 then
    raise exception 'an account can be linked to at most 5 customer records' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_account_links() from public;
create trigger customer_accounts_limit before insert on public.customer_accounts
  for each row execute function private.limit_account_links();

-- Joins the signed-in account to an existing customer record with a code that staff issued. The account may already
-- have a profile of its own: the older record is ADDED, never merged into it, so no history is moved or rewritten.
-- The only proof of ownership is the single-use code; matching contact details prove nothing and are never looked at.
-- The answer is the same in every failure case (null), and failures are counted, which is why the function returns
-- null instead of raising (a raised error would roll the count back).
create or replace function public.claim_customer_profile(p_code text)
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
  links_before integer;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '28000';
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
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    insert into private.claim_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  if exists (select 1 from public.customer_accounts where user_id = uid and customer_id = hit.customer_id) then
    -- Already this account's own record: nothing to join, and the code is not spent.
    insert into private.claim_attempts (user_id, success) values (uid, false);
    return null;
  end if;

  select count(*) into links_before from public.customer_accounts where user_id = uid;
  begin
    insert into public.customer_accounts (user_id, customer_id, linked_via) values (uid, hit.customer_id, 'claim_code');
  exception when sqlstate '54000' then
    insert into private.claim_attempts (user_id, success) values (uid, false);
    return null;
  end;
  update private.customer_claim_codes set used_at = now(), used_by = uid where id = hit.id;
  insert into private.claim_attempts (user_id, success) values (uid, true);
  perform private.audit('customer.claim_code_used', 'customer', hit.customer_id::text,
    jsonb_build_object('user_id', uid, 'records_linked_before', links_before));
  return hit.customer_id;
end;
$$;

create function admin.revoke_claim_code(p_code_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c private.customer_claim_codes%rowtype;
begin
  perform private.require_permission('customers.manage');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to revoke a claim code' using errcode = '22023';
  end if;
  select * into c from private.customer_claim_codes where id = p_code_id for update;
  if not found then
    raise exception 'claim code not found' using errcode = 'P0002';
  end if;
  if c.used_at is not null then
    raise exception 'this claim code has already been used' using errcode = '55000';
  end if;
  if c.revoked_at is not null then
    raise exception 'this claim code has already been revoked' using errcode = '55000';
  end if;
  update private.customer_claim_codes
     set revoked_at = now(), revoked_by = (select auth.uid()), revoked_reason = left(btrim(p_reason), 500)
   where id = c.id;
  perform private.audit('customer.claim_code_revoked', 'customer', c.customer_id::text, jsonb_build_object('code_id', c.id));
end;
$$;

-- The codes themselves are never stored and never returned: only their state.
create function admin.list_claim_codes(p_customer_id uuid)
returns table (id uuid, created_at timestamptz, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.read');
  return query
    select c.id, c.created_at, c.expires_at, c.used_at, c.revoked_at,
           case when c.used_at is not null then 'used'
                when c.revoked_at is not null then 'revoked'
                when c.expires_at <= now() then 'expired'
                else 'active' end
    from private.customer_claim_codes c
    where c.customer_id = p_customer_id
    order by c.created_at desc
    limit 50;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Staff functions: customers.
-- ---------------------------------------------------------------------------------------------------------------
create function admin.create_customer(
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_source text default 'whatsapp',
  p_preferred_language text default 'en',
  p_delivery_address text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  perform private.require_permission('customers.manage');
  if p_source not in ('whatsapp', 'instagram', 'walk_in', 'other') then
    raise exception 'a customer created by staff has source whatsapp, instagram, walk_in or other' using errcode = '22023';
  end if;
  insert into public.customers (full_name, phone, email, source, preferred_language, delivery_address)
  values (btrim(p_full_name), nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), p_source,
          coalesce(p_preferred_language, 'en'), nullif(btrim(p_delivery_address), ''))
  returning id into new_id;
  perform private.audit('customer.created_by_staff', 'customer', new_id::text, jsonb_build_object('source', p_source));
  return new_id;
end;
$$;

-- Finds customers by name, phone, email, customer code or order reference. It only finds: it never links or merges.
create function admin.search_customers(p_query text default null, p_limit integer default 25)
returns table (id uuid, customer_code text, full_name text, phone text, email text, source text, created_at timestamptz,
               order_count bigint, linked_accounts bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
  digits text;
begin
  perform private.require_permission('customers.read');
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');
  return query
    select c.id, c.customer_code, c.full_name, c.phone, c.email, c.source, c.created_at,
           (select count(*) from public.orders o where o.customer_id = c.id),
           (select count(*) from public.customer_accounts a where a.customer_id = c.id)
    from public.customers c
    where q = ''
       or c.full_name ilike pattern
       or c.customer_code ilike pattern
       or coalesce(c.email, '') ilike pattern
       or (char_length(digits) >= 3 and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%')
       or exists (select 1 from public.orders o where o.customer_id = c.id and o.order_ref ilike pattern)
    order by c.created_at desc
    limit p_limit;
end;
$$;

create function admin.get_customer(p_customer_id uuid)
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
        'created_at', o.created_at) order by o.created_at desc)
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
-- 5. Staff functions: orders, payments, loyalty, the dashboard, the audit log.
-- ---------------------------------------------------------------------------------------------------------------
create function admin.list_orders(p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_search, ''));
  pattern text;
begin
  perform private.require_permission('orders.read');
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (
      select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.deposit_required_minor,
             (o.deposit_fixed_at is not null) as deposit_fixed,
             (o.deposit_fixed_at is not null and o.amount_paid_minor >= o.deposit_required_minor) as deposit_received,
             o.amount_paid_minor, o.balance_due_minor,
             o.created_at, c.id as customer_id, c.full_name as customer_name, c.customer_code
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.order_statuses s on s.code = o.status
      where (p_status is null or o.status = p_status)
        and (q = '' or o.order_ref ilike pattern or c.full_name ilike pattern or c.customer_code ilike pattern)
      order by o.created_at desc
      limit p_limit offset p_offset
    ) t), '[]'::jsonb);
end;
$$;

create function admin.get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  s public.order_statuses%rowtype;
  result jsonb;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  select * into c from public.customers where id = o.customer_id;
  select * into s from public.order_statuses where code = o.status;

  result := jsonb_build_object(
    'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'status_label', s.customer_label,
    'customer', jsonb_build_object('id', c.id, 'customer_code', c.customer_code, 'full_name', c.full_name, 'phone', c.phone, 'email', c.email),
    'total_minor', o.total_minor, 'deposit_required_minor', o.deposit_required_minor,
    'deposit_fixed', o.deposit_fixed_at is not null, 'deposit_fixed_at', o.deposit_fixed_at,
    -- Received means staff have recorded payments that cover it: nothing else ever counts a deposit as paid.
    'deposit_received', o.deposit_fixed_at is not null and o.amount_paid_minor >= o.deposit_required_minor,
    'deposit_rate_bps', o.deposit_rate_bps, 'deposit_policy_version', o.deposit_policy_version, 'deposit_rule', o.deposit_rule,
    'deposit_gate_status', o.deposit_gate_status,
    'amount_paid_minor', o.amount_paid_minor, 'balance_due_minor', o.balance_due_minor,
    'deposit_outstanding_minor', greatest(o.deposit_required_minor - o.amount_paid_minor, 0),
    'delivery_method', o.delivery_method, 'delivery_address', o.delivery_address, 'placed_via', o.placed_via,
    'created_at', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'kind', i.kind, 'description', i.description,
                 'quantity', i.quantity, 'unit_price_minor', i.unit_price_minor, 'line_total_minor', i.line_total_minor) order by i.position)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'at', h.changed_at,
                 'reason', h.reason, 'by', sm.display_name) order by h.id)
               from private.order_status_history h left join private.staff_members sm on sm.user_id = h.changed_by
               where h.order_id = o.id), '[]'::jsonb),
    'tracking', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'status_code', e.status_code, 'title', e.title, 'message', e.message,
                 'published_at', e.published_at, 'retracted', r.event_id is not null, 'retraction_reason', r.reason) order by e.published_at)
               from public.order_tracking_events e left join private.tracking_event_retractions r on r.event_id = e.id
               where e.order_id = o.id), '[]'::jsonb),
    'next_statuses', coalesce((select jsonb_agg(jsonb_build_object('code', t.to_code, 'label', ns.customer_label) order by ns.sort_order)
               from private.order_status_transitions t join public.order_statuses ns on ns.code = t.to_code
               where t.from_code = o.status and private.has_permission(t.requires_permission)), '[]'::jsonb));

  if private.has_permission('payments.read') then
    result := result || jsonb_build_object('payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'entry_type', p.entry_type, 'purpose', p.purpose, 'amount_minor', p.amount_minor, 'method', p.method,
        'receipt_number', p.receipt_number, 'received_at', p.received_at, 'reverses_payment_id', p.reverses_payment_id,
        'reversed', exists (select 1 from public.payments r where r.reverses_payment_id = p.id),
        'recorded_by', sm.display_name, 'internal_reference', d.internal_reference) order by p.received_at, p.created_at)
      from public.payments p
      left join private.payment_details d on d.payment_id = p.id
      left join private.staff_members sm on sm.user_id = d.recorded_by
      where p.order_id = o.id), '[]'::jsonb));
  end if;
  return result;
end;
$$;

create function admin.list_payments(p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('payments.read');
  p_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.received_at desc, t.created_at desc)
    from (
      select p.id, p.entry_type, p.purpose, p.amount_minor, p.method, p.receipt_number, p.received_at, p.created_at,
             p.reverses_payment_id, exists (select 1 from public.payments r where r.reverses_payment_id = p.id) as reversed,
             o.id as order_id, o.order_ref, c.id as customer_id, c.full_name as customer_name,
             sm.display_name as recorded_by, d.internal_reference
      from public.payments p
      join public.orders o on o.id = p.order_id
      join public.customers c on c.id = o.customer_id
      left join private.payment_details d on d.payment_id = p.id
      left join private.staff_members sm on sm.user_id = d.recorded_by
      order by p.received_at desc, p.created_at desc
      limit p_limit offset p_offset
    ) t), '[]'::jsonb);
end;
$$;

create function admin.list_loyalty(p_customer_id uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('loyalty.read');
  p_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  return jsonb_build_object(
    'balances', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.balance_points desc)
      from (select c.id as customer_id, c.customer_code, c.full_name, sum(l.points)::bigint as balance_points, count(*)::integer as entries
            from public.loyalty_ledger l join public.customers c on c.id = l.customer_id
            where p_customer_id is null or l.customer_id = p_customer_id
            group by c.id, c.customer_code, c.full_name
            order by sum(l.points) desc limit p_limit) b), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(row_to_json(e)::jsonb order by e.created_at desc)
      from (select l.id, l.customer_id, c.full_name, l.entry_type, l.points, l.description, l.created_at, o.order_ref
            from public.loyalty_ledger l join public.customers c on c.id = l.customer_id
            left join public.orders o on o.id = l.order_id
            where p_customer_id is null or l.customer_id = p_customer_id
            order by l.created_at desc limit p_limit) e), '[]'::jsonb));
end;
$$;

-- The figures on the dashboard. Money is shown only to someone who may read payments.
create function admin.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_permission('orders.read');
  select jsonb_build_object(
    'total_orders', count(*),
    'awaiting_confirmation', count(*) filter (where status = 'pending_confirmation'),
    'awaiting_deposit', count(*) filter (where status = 'awaiting_deposit'),
    'under_assembly', count(*) filter (where status in ('building', 'quality_check')),
    'ready_for_delivery', count(*) filter (where status = 'ready_for_delivery'),
    'delivered', count(*) filter (where status = 'delivered'),
    'on_hold', count(*) filter (where status = 'on_hold'),
    'cancelled', count(*) filter (where status = 'cancelled'))
  into result from public.orders;

  result := result || jsonb_build_object('customers', (select count(*) from public.customers));

  if private.has_permission('payments.read') then
    result := result || jsonb_build_object(
      'outstanding_balance_minor', coalesce((select sum(balance_due_minor) from public.orders where status not in ('pending_confirmation', 'cancelled')), 0),
      'orders_with_balance', (select count(*) from public.orders where status not in ('pending_confirmation', 'cancelled') and balance_due_minor > 0),
      -- Orders past the deposit gate with less than the deposit paid (for example after a reversal): they should be on hold.
      'deposit_shortfalls', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'order_ref', o.order_ref, 'status', o.status,
                 'deposit_required_minor', o.deposit_required_minor, 'amount_paid_minor', o.amount_paid_minor,
                 'customer_name', c.full_name) order by o.created_at)
        from public.orders o join public.customers c on c.id = o.customer_id
        where o.deposit_fixed_at is not null and o.deposit_gate_status is not null
          and o.status not in ('on_hold', 'cancelled')
          and private.status_order(o.status) >= private.status_order(o.deposit_gate_status)
          and o.amount_paid_minor < o.deposit_required_minor), '[]'::jsonb));
  end if;

  result := result || jsonb_build_object('recent_orders', coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (select o.id, o.order_ref, o.status, s.customer_label as status_label, o.total_minor, o.created_at, c.full_name as customer_name
          from public.orders o join public.customers c on c.id = o.customer_id join public.order_statuses s on s.code = o.status
          order by o.created_at desc limit 8) t), '[]'::jsonb));
  return result;
end;
$$;

create function admin.list_audit(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.read');
  p_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.id desc)
    from (select a.id, a.at, a.action, a.entity, a.entity_id, sm.display_name as actor, a.details
          from private.audit_log a left join private.staff_members sm on sm.user_id = a.actor
          order by a.id desc limit p_limit) t), '[]'::jsonb);
end;
$$;

-- Policies, including the deposit schedule and the history of every change to it.
create function admin.list_policy_versions(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('policies.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object('version', v.version, 'value', v.value, 'confirmation', v.confirmation,
             'changed_at', v.changed_at, 'changed_by', sm.display_name, 'reason', v.reason) order by v.version desc)
    from private.business_policy_versions v left join private.staff_members sm on sm.user_id = v.changed_by
    where v.key = p_key), '[]'::jsonb);
end;
$$;

-- What the deposit WOULD be for an order total under the policy in force now, so a person can see it before confirming.
-- It changes nothing and records nothing: the deposit is fixed only when an order is confirmed.
create function admin.preview_deposit(p_total_minor bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q private.deposit_quote_result;
begin
  perform private.require_permission('orders.read');
  q := private.deposit_quote(p_total_minor);
  return jsonb_build_object('amount_minor', q.amount_minor, 'rate_bps', q.rate_bps, 'policy_version', q.policy_version, 'rule', q.rule);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Staff management. Nobody changes their own role or status, and the last active owner cannot be removed.
-- ---------------------------------------------------------------------------------------------------------------
create function admin.list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', sm.user_id, 'email', u.email, 'display_name', sm.display_name,
             'role_code', sm.role_code, 'is_active', sm.is_active, 'created_at', sm.created_at) order by sm.created_at)
    from private.staff_members sm join auth.users u on u.id = sm.user_id), '[]'::jsonb);
end;
$$;

create function admin.set_staff_member(p_user_id uuid, p_role_code text, p_is_active boolean, p_display_name text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing private.staff_members%rowtype;
  was_existing boolean;
begin
  perform private.require_permission('staff.manage');
  if p_user_id = (select auth.uid()) then
    raise exception 'you cannot change your own role or status' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to change a staff member' using errcode = '22023';
  end if;
  if not exists (select 1 from private.staff_roles where code = p_role_code) then
    raise exception 'unknown staff role %', p_role_code using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  select * into existing from private.staff_members where user_id = p_user_id for update;
  was_existing := found;
  if was_existing and existing.role_code = 'owner' and existing.is_active
     and (p_role_code <> 'owner' or not coalesce(p_is_active, true))
     and (select count(*) from private.staff_members where role_code = 'owner' and is_active) <= 1 then
    raise exception 'the last active owner cannot be demoted or deactivated' using errcode = '55000';
  end if;
  insert into private.staff_members (user_id, role_code, display_name, is_active)
  values (p_user_id, p_role_code, nullif(btrim(p_display_name), ''), coalesce(p_is_active, true))
  on conflict (user_id) do update
    set role_code = excluded.role_code, display_name = excluded.display_name, is_active = excluded.is_active;
  perform private.audit('staff.changed', 'staff', p_user_id::text,
    jsonb_build_object('role', p_role_code, 'active', coalesce(p_is_active, true), 'new', not was_existing));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Execute rights. The API roles and the gateway may call the staff functions (each one checks the caller's own
--    permission and second factor). The gateway has no other privilege: no table, no private function.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'admin'
  loop
    execute format('revoke all on function %s from public', f.signature);
    execute format('revoke all on function %s from anon', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
    execute format('grant execute on function %s to m1_staff_gateway', f.signature);
  end loop;
end;
$$;
grant usage on schema admin to m1_staff_gateway;

revoke all on function public.claim_customer_profile(text) from public, anon;
grant execute on function public.claim_customer_profile(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. The audit of the gateway itself. It reports a violation for anything that widens what the role may do.
-- ---------------------------------------------------------------------------------------------------------------
create function private.gateway_audit()
returns table (check_name text, detail text)
language sql
stable
set search_path = ''
as $$
  select 'gateway_role_missing'::text, 'm1_staff_gateway'::text
  where not exists (select 1 from pg_roles where rolname = 'm1_staff_gateway')

  union all
  select 'gateway_role_too_powerful'::text, r.rolname
  from pg_roles r
  where r.rolname = 'm1_staff_gateway'
    and (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)

  union all
  -- It must not be able to become any API role: that would make it a general impersonator, not a function caller.
  select 'gateway_is_member_of_api_role'::text, g.rolname
  from pg_auth_members m
  join pg_roles u on u.oid = m.member and u.rolname = 'm1_staff_gateway'
  join pg_roles g on g.oid = m.roleid
  where g.rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin', 'authenticator')

  union all
  select 'gateway_has_table_privilege'::text, n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname in ('public', 'private', 'admin')
    and has_any_column_privilege('m1_staff_gateway', c.oid, 'select,insert,update,references')

  union all
  select 'gateway_has_sequence_privilege'::text, s.name
  from (
    select c.oid as seq_oid, n.nspname || '.' || c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname in ('public', 'private', 'admin')
    offset 0
  ) s
  where has_sequence_privilege('m1_staff_gateway', s.seq_oid, 'usage,select,update')

  union all
  -- Only functions of schema admin may be executed by it (no private helper, no public function).
  select 'gateway_can_execute_outside_admin'::text, n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('private', 'public')
    and has_function_privilege('m1_staff_gateway', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  union all
  select 'gateway_has_schema_privilege'::text, n.nspname
  from pg_namespace n
  where n.nspname in ('private', 'auth', 'storage') and has_schema_privilege('m1_staff_gateway', n.oid, 'usage,create')
$$;
revoke all on function private.gateway_audit() from public;

do $audit$
declare
  problems integer;
  more integer;
begin
  select count(*) into problems from private.security_audit();
  select count(*) into more from private.gateway_audit();
  if problems + more > 0 then
    raise exception 'security audit failed after the staff gateway migration (% violation(s))', problems + more;
  end if;
end;
$audit$;
