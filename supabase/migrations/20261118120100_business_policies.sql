-- PLAT-0001, migration 2 of 11: configurable business policies.
--
-- M1's deposit, payment, loyalty and security rules are DATA, not code: they live in one table, are validated
-- when written, keep a history, and carry an explicit confirmation flag. The seeded values in the later
-- migrations are provisional defaults chosen to fail safe; they are NOT business decisions. Each one names the
-- open question (OQ-nnnn) that the owner still has to answer. Nothing in the website or in the functions repeats
-- these numbers.

create table private.business_policies (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  description text not null check (char_length(description) between 10 and 400),
  -- 'unconfirmed_default' means a developer picked a safe placeholder; only the owner confirms a policy.
  confirmation text not null default 'unconfirmed_default'
    check (confirmation in ('unconfirmed_default', 'confirmed_by_owner')),
  open_question text check (open_question is null or open_question ~ '^(OQ|REQ)-[A-Z0-9-]+$'),
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
alter table private.business_policies enable row level security;
revoke all on table private.business_policies from anon, authenticated, service_role;

create table private.business_policy_versions (
  id bigint generated always as identity primary key,
  key text not null,
  version integer not null check (version >= 1),
  value jsonb not null,
  confirmation text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 500),
  unique (key, version)
);
alter table private.business_policy_versions enable row level security;
revoke all on table private.business_policy_versions from anon, authenticated, service_role;
create trigger business_policy_versions_append_only before update or delete on private.business_policy_versions
  for each row execute function private.forbid_mutation();
create trigger business_policy_versions_no_truncate before truncate on private.business_policy_versions
  for each statement execute function private.forbid_mutation();

-- Small, side-effect free helpers for the validation below. The checks are written as separate statements so
-- that no numeric cast is ever evaluated on a value that failed the shape test.
create function private.is_uint(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$ select v is not null and jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]{1,15}$' $$;

create function private.is_posint(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$ select v is not null and jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[1-9][0-9]{0,14}$' $$;

-- Structural validation per key. Returns a message when the value is wrong, null when it is acceptable.
-- A policy that names an order status is also checked against the status table by admin.set_policy.
create function private.policy_error(p_key text, p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return 'a policy value must be a JSON object';
  end if;

  case p_key
    when 'orders.deposit' then
      -- percent_bps: basis points of the order total (5000 = 50 %); minimum_minor: floor in QAR minor units;
      -- required_before_status: the first status that needs the deposit to be fully paid.
      if (p_value - 'percent_bps' - 'minimum_minor' - 'required_before_status') <> '{}'::jsonb then
        return 'orders.deposit allows only percent_bps, minimum_minor and required_before_status';
      end if;
      v := p_value -> 'percent_bps';
      if not private.is_uint(v) then
        return 'percent_bps must be an integer from 0 to 10000';
      end if;
      if (v #>> '{}')::bigint > 10000 then
        return 'percent_bps must be an integer from 0 to 10000';
      end if;
      if not private.is_uint(p_value -> 'minimum_minor') then
        return 'minimum_minor must be a non-negative integer';
      end if;
      v := p_value -> 'required_before_status';
      if v is null or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 40 then
        return 'required_before_status must be a status code';
      end if;

    when 'orders.full_payment' then
      if (p_value - 'required_before_status') <> '{}'::jsonb then
        return 'orders.full_payment allows only required_before_status';
      end if;
      v := p_value -> 'required_before_status';
      if v is null or (jsonb_typeof(v) not in ('string', 'null')) then
        return 'required_before_status must be a status code or null (no full-payment gate)';
      end if;

    when 'loyalty.earn_rate' then
      if (p_value - 'qar_per_point_minor') <> '{}'::jsonb then
        return 'loyalty.earn_rate allows only qar_per_point_minor';
      end if;
      if not private.is_posint(p_value -> 'qar_per_point_minor') then
        return 'qar_per_point_minor must be a positive integer (QAR minor units that earn one point)';
      end if;

    when 'loyalty.point_value' then
      if (p_value - 'point_value_minor') <> '{}'::jsonb then
        return 'loyalty.point_value allows only point_value_minor';
      end if;
      if not private.is_posint(p_value -> 'point_value_minor') then
        return 'point_value_minor must be a positive integer (QAR minor units one point is worth)';
      end if;

    when 'loyalty.earning_base' then
      if (p_value - 'base' - 'rounding') <> '{}'::jsonb then
        return 'loyalty.earning_base allows only base and rounding';
      end if;
      if coalesce(p_value ->> 'base', '') not in ('order_total', 'amount_paid') then
        return 'base must be order_total or amount_paid';
      end if;
      if coalesce(p_value ->> 'rounding', '') not in ('floor', 'round', 'ceil') then
        return 'rounding must be floor, round or ceil';
      end if;

    when 'loyalty.award_trigger' then
      if (p_value - 'on_status' - 'require_full_payment') <> '{}'::jsonb then
        return 'loyalty.award_trigger allows only on_status and require_full_payment';
      end if;
      v := p_value -> 'on_status';
      if v is null or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 40 then
        return 'on_status must be a status code';
      end if;
      if jsonb_typeof(p_value -> 'require_full_payment') is distinct from 'boolean' then
        return 'require_full_payment must be true or false';
      end if;

    when 'loyalty.negative_balance' then
      if (p_value - 'allowed') <> '{}'::jsonb then
        return 'loyalty.negative_balance allows only allowed';
      end if;
      if jsonb_typeof(p_value -> 'allowed') is distinct from 'boolean' then
        return 'allowed must be true or false';
      end if;

    when 'admin.mfa' then
      if (p_value - 'required') <> '{}'::jsonb then
        return 'admin.mfa allows only required';
      end if;
      if jsonb_typeof(p_value -> 'required') is distinct from 'boolean' then
        return 'required must be true or false';
      end if;

    else
      return 'unknown policy key ' || coalesce(p_key, '<null>');
  end case;

  return null;
end;
$$;

alter table private.business_policies
  add constraint business_policies_value_valid check (private.policy_error(key, value) is null);

-- Reads one policy. Definer, so the staff functions can read it whichever role calls them.
create function private.policy(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select value from private.business_policies where key = p_key $$;
revoke all on function private.policy(text) from public;

-- Every change leaves a version row. The first insert is version 1.
create function private.record_policy_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.business_policy_versions (key, version, value, confirmation, changed_by, reason)
  values (new.key, new.version, new.value, new.confirmation, (select auth.uid()), nullif(current_setting('m1.policy_reason', true), ''));
  return new;
end;
$$;
create trigger business_policies_version after insert or update on private.business_policies
  for each row execute function private.record_policy_version();
