-- PLAT-0001, migration 3 of 11: staff roles and permissions.
--
-- Administrator privileges are decided on the server, from these tables, and from nothing the user can edit
-- (REC-PLAT-003). A JWT claim such as app_metadata.role, or any user metadata, is never consulted. A staff member
-- is a row in private.staff_members; their role grants permissions through private.role_permissions.
--
-- WHICH ROLES EXIST AND WHO MAY SEE COSTS IS AN OPEN QUESTION (OQ-0011). The two roles below are provisional
-- placeholders that follow least privilege (the owner can do everything; staff cannot touch money, costs, policies
-- or other staff). They are data: change them with a migration or an owner-only statement, not with code.

create table private.permissions (
  code text primary key check (code ~ '^[a-z]+\.[a-z]+$'),
  description text not null check (char_length(description) between 5 and 200)
);
alter table private.permissions enable row level security;
revoke all on table private.permissions from anon, authenticated, service_role;

create table private.staff_roles (
  code text primary key check (code ~ '^[a-z][a-z_]{1,31}$'),
  description text not null check (char_length(description) between 5 and 200),
  is_provisional boolean not null default true
);
alter table private.staff_roles enable row level security;
revoke all on table private.staff_roles from anon, authenticated, service_role;

create table private.role_permissions (
  role_code text not null references private.staff_roles (code) on delete cascade,
  permission_code text not null references private.permissions (code) on delete cascade,
  primary key (role_code, permission_code)
);
alter table private.role_permissions enable row level security;
revoke all on table private.role_permissions from anon, authenticated, service_role;

create table private.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role_code text not null references private.staff_roles (code),
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.staff_members enable row level security;
revoke all on table private.staff_members from anon, authenticated, service_role;
create trigger staff_members_touch before update on private.staff_members
  for each row execute function private.touch_updated_at();

insert into private.permissions (code, description) values
  ('customers.read', 'See customer profiles'),
  ('customers.manage', 'Create and edit customer profiles; issue account-claim codes'),
  ('quotations.read', 'See quotations and their lines'),
  ('quotations.manage', 'Create, price and move quotations'),
  ('orders.read', 'See orders, items and the tracking timeline'),
  ('orders.create', 'Create orders manually, for example for WhatsApp customers'),
  ('orders.transition', 'Move an order to its next status'),
  ('payments.read', 'See payment entries'),
  ('payments.record', 'Record a received deposit or payment'),
  ('payments.reverse', 'Reverse a recorded payment'),
  ('finance.read', 'See supplier costs, margins and other private financial records'),
  ('finance.manage', 'Record and change supplier costs'),
  ('notes.read', 'Read private staff notes'),
  ('notes.write', 'Write private staff notes'),
  ('tracking.publish', 'Publish a customer-visible tracking update'),
  ('loyalty.read', 'See loyalty ledger entries'),
  ('loyalty.adjust', 'Award, reverse or adjust loyalty points'),
  ('policies.read', 'Read business policies'),
  ('policies.manage', 'Change business policies'),
  ('staff.manage', 'Manage staff members and roles'),
  ('audit.read', 'Read the audit log');

insert into private.staff_roles (code, description) values
  ('owner', 'Provisional: every permission (OQ-0011)'),
  ('staff', 'Provisional: day-to-day order handling without money, costs, policies or staff management (OQ-0011)');

insert into private.role_permissions (role_code, permission_code)
select 'owner', code from private.permissions;

insert into private.role_permissions (role_code, permission_code) values
  ('staff', 'customers.read'), ('staff', 'customers.manage'),
  ('staff', 'quotations.read'), ('staff', 'quotations.manage'),
  ('staff', 'orders.read'), ('staff', 'orders.create'), ('staff', 'orders.transition'),
  ('staff', 'tracking.publish'), ('staff', 'notes.read'), ('staff', 'notes.write');

-- Multi-factor authentication. A real Supabase session carries aal1 (one factor) or aal2 (a second factor was
-- verified) in its token. The policy admin.mfa says whether staff need aal2; if the policy row is missing the
-- answer is "required" (fail closed). Local tests set the claim by hand; the real behaviour needs a Supabase project.
create function private.mfa_satisfied()
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
  return (not required) or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
end;
$$;
revoke all on function private.mfa_satisfied() from public;

-- True only for an active staff member whose role holds the permission, and who passed the MFA rule.
create function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.staff_members sm
    join private.role_permissions rp on rp.role_code = sm.role_code
    where sm.user_id = (select auth.uid())
      and sm.is_active
      and rp.permission_code = p_permission
  ) and private.mfa_satisfied();
$$;
revoke all on function private.has_permission(text) from public;
grant execute on function private.has_permission(text) to authenticated;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.staff_members sm where sm.user_id = (select auth.uid()) and sm.is_active
  ) and private.mfa_satisfied();
$$;
revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

create function private.require_permission(p_permission text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_permission(text) from public;
