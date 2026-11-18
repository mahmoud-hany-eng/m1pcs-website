// Synthetic preview data for the LOCAL EMULATOR. Everything here is invented: example.test addresses, reserved
// +9745555xxxx numbers, "(demo item)" parts. It is written through the same staff functions a real order would use, so
// the database rules (deposit gate, ledgers, loyalty award) run for real. It is never real customer data.
import { AS, ID, SENTINEL, json, newOrder } from "../tests/fixtures.mjs";

export const WENDY = { customer: "00000000-0000-4000-8000-0000000000c3", email: "wendy@example.test", phone: "+97455550003" };

const DELIVERED_ITEMS = [
  { kind: "component", description: "Graphics card (demo item)", quantity: 1, unit_price_minor: 450000 },
  { kind: "component", description: "Processor (demo item)", quantity: 1, unit_price_minor: 180000 },
  { kind: "build_service", description: "Assembly and stress testing", quantity: 1, unit_price_minor: 40000 },
];
const WENDY_ITEMS = [
  { kind: "component", description: "Gaming monitor 27 inch (demo item)", quantity: 1, unit_price_minor: 180000 },
  { kind: "component", description: "Mechanical keyboard (demo item)", quantity: 1, unit_price_minor: 70000 },
  { kind: "delivery", description: "Delivery in Doha", quantity: 1, unit_price_minor: 10000 },
];

/** Spreads an order's tracking updates over time so a timeline reads like a real one. Preview data only. */
function backdate(orderVar, daysAgo, stepDays) {
  return `
    ${AS.superuser}
    select private.set_write_ctx(true);
    update public.orders set created_at = now() - interval '${daysAgo} days' where id = :'${orderVar}';
    select private.set_write_ctx(false);
    alter table public.order_tracking_events disable trigger order_tracking_events_append_only;
    -- The updates were published in one go, so they share a timestamp; put them in the order of their stages.
    with ev as (
      select t.id, row_number() over (order by s.sort_order nulls last, t.id) as n
      from public.order_tracking_events t left join public.order_statuses s on s.code = t.status_code
      where t.order_id = :'${orderVar}'
    )
      update public.order_tracking_events e set published_at = now() - interval '${daysAgo} days' + (ev.n - 1) * interval '${stepDays} days' from ev where e.id = ev.id;
    alter table public.order_tracking_events enable trigger order_tracking_events_append_only;
  `;
}

export function seedPreviewData(db) {
  // A WhatsApp customer who has never signed in. Staff create their orders; a claim code later joins them to an account.
  db.commit(`
    insert into public.customers (id, full_name, phone, email, source, preferred_language)
      values ('${WENDY.customer}', 'Wendy Demo', '${WENDY.phone}', '${WENDY.email}', 'whatsapp', 'en');
  `);

  // Alice's delivered, fully paid order: earns loyalty points through the real award routine.
  db.commit(`
    ${newOrder({ customer: ID.custA, items: DELIVERED_ITEMS, into: "a2" })}
    ${AS.olivia}
    select admin.record_payment(:'a2', 'deposit', 335000, 'bank_transfer', now() - interval '23 days', 'DEMO-RCPT-0102', 'internal reference that must not reach a customer', 'internal payment note');
    select admin.transition_order(:'a2', 'awaiting_deposit');
    select admin.publish_tracking_event(:'a2', 'Order confirmed', 'We confirmed your order and your deposit.', 'deposit_received');
    select admin.transition_order(:'a2', 'deposit_received');
    select admin.transition_order(:'a2', 'sourcing');
    select admin.publish_tracking_event(:'a2', 'Parts ordered', 'Your graphics card and processor are on their way to us from the U.S.', 'sourcing');
    select admin.transition_order(:'a2', 'building');
    select admin.publish_tracking_event(:'a2', 'Your PC is being built', 'Our team has started the build.', 'building');
    select admin.transition_order(:'a2', 'quality_check');
    select admin.transition_order(:'a2', 'ready_for_delivery');
    select admin.publish_tracking_event(:'a2', 'Ready for delivery', 'Built, tested and ready. We will arrange delivery with you.', 'ready_for_delivery');
    select admin.record_payment(:'a2', 'balance', 335000, 'cash', now() - interval '3 days', 'DEMO-RCPT-0103');
    select admin.transition_order(:'a2', 'delivered');
    select admin.publish_tracking_event(:'a2', 'Delivered', 'Delivered. Enjoy your new PC.', 'delivered');
    ${backdate("a2", 24, 4)}
  `);

  // Alice's order that was cancelled before any money moved.
  db.commit(`
    ${newOrder({ customer: ID.custA, items: [{ kind: "component", description: "Headset (demo item)", quantity: 1, unit_price_minor: 60000 }], into: "a3" })}
    ${AS.olivia}
    select admin.transition_order(:'a3', 'cancelled', 'customer changed their mind');
    select admin.publish_tracking_event(:'a3', 'Order cancelled', 'This order was cancelled at your request.', 'cancelled');
    ${backdate("a3", 40, 1)}
  `);

  // The fixtures' own order for Alice (deposit part paid) is made to look a few days old.
  db.commit(`${backdate("orderA", 6, 2)}`);

  // Wendy's WhatsApp order, with private data a customer must never see, so a leak would be visible.
  db.commit(`
    \\set custW '${WENDY.customer}'
    ${newOrder({ customer: WENDY.customer, items: WENDY_ITEMS, into: "w1" })}
    ${AS.olivia}
    select admin.add_order_note(:'w1', '${SENTINEL.note} Wendy asked for a discount');
    select admin.set_order_item_cost((select id from public.order_items where order_id = :'w1' and position = 1), '${SENTINEL.supplier}', ${SENTINEL.cost}, 'USD', 'cost note');
    select admin.record_payment(:'w1', 'deposit', 130000, 'bank_transfer', now() - interval '5 days', 'DEMO-RCPT-0201', '${SENTINEL.reference}', 'internal');
    select admin.transition_order(:'w1', 'awaiting_deposit', '${SENTINEL.reason}');
    select admin.publish_tracking_event(:'w1', 'Order confirmed', 'Thank you Wendy. We received your deposit.', 'deposit_received');
    select admin.transition_order(:'w1', 'deposit_received');
    select admin.transition_order(:'w1', 'sourcing');
    select admin.publish_tracking_event(:'w1', 'Parts ordered', 'Your items have been ordered.', 'sourcing');
    ${backdate("w1", 7, 3)}
  `);

  const refs = db.cluster.psql(`select string_agg(o.order_ref || ':' || c.full_name || ':' || o.status, ',' order by o.created_at) from public.orders o join public.customers c on c.id = o.customer_id;`).out;
  return { refs: refs.split(",") };
}

export { json };
