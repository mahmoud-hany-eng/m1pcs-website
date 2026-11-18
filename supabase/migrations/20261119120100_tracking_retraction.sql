-- PLAT-0002, migration 13: a wrongly published tracking update can be withdrawn without deleting anything.
--
-- Why. A tracking update is append-only (REQ-TRK-001), which is right for an audit trail but leaves no way to
-- take back an update that was published on the wrong order or says something untrue. The safe answer is not to
-- allow edits or deletes: the update stays in the database, and a retraction record hides it from the customer.
--
--   * private.tracking_event_retractions holds who withdrew an update, when, and why. It is append-only.
--   * The customer's read policy on public.order_tracking_events excludes a retracted update. Staff still see
--     every update, so the history of what was shown, and then withdrawn, is never lost.
--   * admin.retract_tracking_event needs the same permission as publishing (tracking.publish) and is audited.
--
-- A retraction hides the update from the customer-facing API; it does not rewrite history. To correct the
-- content, publish a new update after retracting the wrong one.

create table private.tracking_event_retractions (
  event_id uuid primary key references public.order_tracking_events (id) on delete restrict,
  retracted_by uuid,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  retracted_at timestamptz not null default now()
);
alter table private.tracking_event_retractions enable row level security;
revoke all on table private.tracking_event_retractions from anon, authenticated, service_role;
create trigger tracking_event_retractions_append_only before update or delete on private.tracking_event_retractions
  for each row execute function private.forbid_mutation();
create trigger tracking_event_retractions_no_truncate before truncate on private.tracking_event_retractions
  for each statement execute function private.forbid_mutation();

create function private.tracking_event_retracted(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from private.tracking_event_retractions where event_id = p_event_id) $$;
revoke all on function private.tracking_event_retracted(uuid) from public;
grant execute on function private.tracking_event_retracted(uuid) to authenticated;

drop policy order_tracking_events_select_own on public.order_tracking_events;
create policy order_tracking_events_select_own on public.order_tracking_events for select to authenticated
  using (private.owns_order(order_id) and not private.tracking_event_retracted(id));

create function admin.retract_tracking_event(p_event_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.order_tracking_events%rowtype;
begin
  perform private.require_permission('tracking.publish');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required to retract a tracking update' using errcode = '22023';
  end if;
  select * into ev from public.order_tracking_events where id = p_event_id;
  if not found then
    raise exception 'tracking update not found' using errcode = 'P0002';
  end if;
  if private.tracking_event_retracted(p_event_id) then
    raise exception 'this tracking update has already been retracted' using errcode = '23505';
  end if;
  insert into private.tracking_event_retractions (event_id, retracted_by, reason)
  values (p_event_id, (select auth.uid()), left(btrim(p_reason), 500));
  perform private.audit('tracking.retracted', 'order', ev.order_id::text, jsonb_build_object('event_id', p_event_id));
end;
$$;
revoke all on function admin.retract_tracking_event(uuid, text) from public;
revoke all on function admin.retract_tracking_event(uuid, text) from anon;
grant execute on function admin.retract_tracking_event(uuid, text) to authenticated;

do $audit$
declare
  problems integer;
begin
  select count(*) into problems from private.security_audit();
  if problems > 0 then
    raise exception 'security audit failed after the tracking retraction migration (% violation(s))', problems;
  end if;
end;
$audit$;
