-- The staff member's own display name, for the public header (one new function, nothing existing is changed).
--
-- WHY THIS EXISTS: the website header now names the person who is signed in and links straight to their dashboard. For a staff member the only
-- verified name is private.staff_members.display_name, which the staff table holds and no existing function returns to the person themself
-- (admin.is_staff_member answers only yes or no; admin.list_staff needs staff.manage). Without this function the header could say only "Staff account".
--
-- WHAT IT ANSWERS, and only for the caller:
--   * null                          the caller is not an active staff member (or, through the gateway, the sign-in session is not live)
--   * {"display_name": "Name"}      the caller is an active staff member and this is the name the staff table holds for them
--   * {"display_name": null}        the caller is an active staff member and no name has been set yet (the header then shows a neutral label)
-- It is the SAME gate as admin.is_staff_member(): active staff row, and through the gateway a live, unexpired sign-in session of that user. It does not
-- need the second factor (like is_staff_member, it decides what to show before the second step, and it grants no access to any data); it returns no role,
-- no permission and no other person's information. A name is never taken from anything a browser sends: the caller is identified by auth.uid() alone.
--
-- Forward-only, additive and rerunnable. Privileges as for every staff function: signed-in sessions and the staff gateway only; never anon, PUBLIC or service_role.
create or replace function admin.my_staff_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sid uuid;
  member private.staff_members%rowtype;
begin
  if uid is null then
    return null;
  end if;
  if private.via_gateway() then
    begin
      sid := ((select auth.jwt()) ->> 'session_id')::uuid;
    exception when others then
      return null;
    end;
    if sid is null or not exists (
      select 1 from auth.sessions s
      where s.id = sid and s.user_id = uid and (s.not_after is null or s.not_after > now())
    ) then
      return null;
    end if;
  end if;
  select * into member from private.staff_members sm where sm.user_id = uid and sm.is_active;
  if not found then
    return null;
  end if;
  return jsonb_build_object('display_name', nullif(btrim(member.display_name), ''));
end;
$$;

comment on function admin.my_staff_profile() is
  'The caller''s own staff display name for the public header: null when the caller is not active staff (or the gateway session is not live), otherwise {"display_name": name or null}. Same gate as is_staff_member; returns no role or permission.';

revoke all on function admin.my_staff_profile() from public, anon, service_role;
grant execute on function admin.my_staff_profile() to authenticated, m1_staff_gateway;

-- Self-check: a mistake here fails the migration (one transaction, so nothing is left half-applied).
do $$
begin
  if to_regprocedure('admin.my_staff_profile()') is null then
    raise exception 'admin.my_staff_profile() must exist after this migration';
  end if;
  if has_function_privilege('anon', 'admin.my_staff_profile()', 'execute')
     or has_function_privilege('public', 'admin.my_staff_profile()', 'execute')
     or has_function_privilege('service_role', 'admin.my_staff_profile()', 'execute') then
    raise exception 'admin.my_staff_profile() must not be executable by anon, PUBLIC or service_role';
  end if;
  if not has_function_privilege('m1_staff_gateway', 'admin.my_staff_profile()', 'execute')
     or not has_function_privilege('authenticated', 'admin.my_staff_profile()', 'execute') then
    raise exception 'admin.my_staff_profile() must be executable by signed-in staff sessions and the staff gateway';
  end if;
  if to_regprocedure('admin.is_staff_member()') is null then
    raise exception 'the earlier admin.is_staff_member() must still exist; this migration does not replace it';
  end if;
end;
$$;
