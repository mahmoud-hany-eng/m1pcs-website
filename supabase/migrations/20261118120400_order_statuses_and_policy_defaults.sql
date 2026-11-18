-- PLAT-0001, migration 5 of 11: order statuses, allowed transitions, and the provisional policy defaults.
--
-- THE STATUS VOCABULARY IS A PLACEHOLDER (OQ-0005 is open: which stages exist, which the customer sees, and the
-- exact wording). It follows the public site's own process copy (requirements, U.S. sourcing, review, deposit and
-- payment, build, delivery) and is stored as data so that the owner's final wording needs a data migration, not a
-- code change. Every row is flagged is_provisional. Customers read only the label and the description; the rules
-- about who may move an order where are staff-only.

create table public.order_statuses (
  code text primary key check (code ~ '^[a-z][a-z_]{1,39}$'),
  sort_order integer not null unique check (sort_order > 0),
  customer_label text not null check (char_length(customer_label) between 1 and 80),
  customer_description text not null check (char_length(customer_description) between 1 and 300),
  is_terminal boolean not null default false,
  is_provisional boolean not null default true
);
alter table public.order_statuses enable row level security;
revoke all on table public.order_statuses from anon, authenticated, service_role;
grant select on public.order_statuses to anon, authenticated;
create policy order_statuses_read on public.order_statuses for select to anon, authenticated using (true);

create table private.order_status_transitions (
  from_code text not null references public.order_statuses (code),
  to_code text not null references public.order_statuses (code),
  requires_permission text not null default 'orders.transition' references private.permissions (code),
  primary key (from_code, to_code),
  check (from_code <> to_code)
);
alter table private.order_status_transitions enable row level security;
revoke all on table private.order_status_transitions from anon, authenticated, service_role;

insert into public.order_statuses (code, sort_order, customer_label, customer_description, is_terminal) values
  ('pending_confirmation', 10, 'Order received', 'We have received your order and are confirming the details with you.', false),
  ('awaiting_deposit', 20, 'Awaiting deposit', 'We are waiting for the deposit before we begin.', false),
  ('deposit_received', 30, 'Deposit received', 'Your deposit has been received.', false),
  ('sourcing', 40, 'Sourcing your parts', 'We are sourcing the components you selected.', false),
  ('in_transit', 50, 'On its way to Qatar', 'Your components are on their way to Qatar.', false),
  ('building', 60, 'Building your PC', 'Your order is being prepared and built.', false),
  ('quality_check', 70, 'Final checks', 'We are running the final checks on your order.', false),
  ('ready_for_delivery', 80, 'Ready for delivery or collection', 'Your order is ready. We will arrange delivery or collection with you.', false),
  ('delivered', 90, 'Delivered', 'Your order has been delivered.', true),
  ('on_hold', 900, 'On hold', 'Your order is on hold. We will contact you.', false),
  ('cancelled', 910, 'Cancelled', 'This order has been cancelled.', true);

insert into private.order_status_transitions (from_code, to_code) values
  ('pending_confirmation', 'awaiting_deposit'), ('pending_confirmation', 'cancelled'),
  ('awaiting_deposit', 'deposit_received'), ('awaiting_deposit', 'on_hold'), ('awaiting_deposit', 'cancelled'),
  ('deposit_received', 'sourcing'), ('deposit_received', 'on_hold'), ('deposit_received', 'cancelled'),
  ('sourcing', 'in_transit'), ('sourcing', 'building'), ('sourcing', 'on_hold'), ('sourcing', 'cancelled'),
  ('in_transit', 'building'), ('in_transit', 'on_hold'), ('in_transit', 'cancelled'),
  ('building', 'quality_check'), ('building', 'on_hold'), ('building', 'cancelled'),
  ('quality_check', 'ready_for_delivery'), ('quality_check', 'building'), ('quality_check', 'on_hold'), ('quality_check', 'cancelled'),
  ('ready_for_delivery', 'delivered'), ('ready_for_delivery', 'on_hold'), ('ready_for_delivery', 'cancelled'),
  -- A held order can only resume at the status it was held from (enforced by admin.transition_order).
  ('on_hold', 'awaiting_deposit'), ('on_hold', 'deposit_received'), ('on_hold', 'sourcing'), ('on_hold', 'in_transit'),
  ('on_hold', 'building'), ('on_hold', 'quality_check'), ('on_hold', 'ready_for_delivery'), ('on_hold', 'cancelled');

-- ---------------------------------------------------------------------------------------------------------
-- Provisional policy defaults. 'unconfirmed_default' means a developer chose a safe placeholder; it is NOT a
-- business decision. The two loyalty rates that the owner has confirmed (REQ-LOY-002, REQ-LOY-003) are marked so.
-- ---------------------------------------------------------------------------------------------------------
insert into private.business_policies (key, value, description, confirmation, open_question) values
  ('orders.deposit',
   '{"percent_bps": 5000, "minimum_minor": 0, "required_before_status": "deposit_received"}',
   'Placeholder deposit rule: a share of the order total, in basis points, that must be fully paid before the order may reach the named status. No deposit rule has been confirmed by the owner.',
   'unconfirmed_default', null),
  ('orders.full_payment',
   '{"required_before_status": null}',
   'Placeholder: no status requires full payment. Whether delivery or loyalty needs full payment first is undecided.',
   'unconfirmed_default', 'OQ-0006'),
  ('loyalty.earn_rate',
   '{"qar_per_point_minor": 1000}',
   'One point for every QAR 10 spent, expressed in QAR minor units (1000 = QAR 10.00). Confirmed requirement.',
   'confirmed_by_owner', 'REQ-LOY-002'),
  ('loyalty.point_value',
   '{"point_value_minor": 10}',
   'Each point is worth QAR 0.10, in QAR minor units. Confirmed requirement. Stored for the later redemption phase; nothing redeems points yet.',
   'confirmed_by_owner', 'REQ-LOY-003'),
  ('loyalty.earning_base',
   '{"base": "order_total", "rounding": "floor"}',
   'Placeholder: points are earned on the order total and rounded down. What counts (delivery, discounts, deposits) and the rounding are undecided.',
   'unconfirmed_default', 'OQ-0007'),
  ('loyalty.award_trigger',
   '{"on_status": "delivered", "require_full_payment": true}',
   'Placeholder: points are awarded once, when the order reaches the named status and is fully paid. What counts as fulfilled is undecided.',
   'unconfirmed_default', 'OQ-0006'),
  ('loyalty.negative_balance',
   '{"allowed": false}',
   'Placeholder: a reversal or adjustment that would make a balance negative is refused. Whether a balance may go negative is undecided.',
   'unconfirmed_default', 'OQ-0010'),
  ('admin.mfa',
   '{"required": true}',
   'Staff must have completed a second factor (aal2) for any staff permission to apply. Recommended, not yet confirmed by the owner.',
   'unconfirmed_default', null);
