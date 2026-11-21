// Test support: a migrated disposable database, a small cast of fixed identities, and helpers that run a SQL
// script as one of them. Every identity uses a reserved example address and synthetic data: nothing real.
import assert from "node:assert/strict";
import { applyShimAndMigrations, asRole, startCluster } from "./harness.mjs";

export const ID = {
  alice: "00000000-0000-4000-8000-0000000000a1", // signed-in customer, owns customer A
  bob: "00000000-0000-4000-8000-0000000000a2", // signed-in customer, owns customer B
  eve: "00000000-0000-4000-8000-0000000000a3", // signed in, no customer record, same email as Alice's profile
  olivia: "00000000-0000-4000-8000-0000000000b1", // staff, role owner
  sam: "00000000-0000-4000-8000-0000000000b2", // staff, role staff
  dana: "00000000-0000-4000-8000-0000000000b3", // staff, role staff, deactivated
  custA: "00000000-0000-4000-8000-0000000000c1",
  custB: "00000000-0000-4000-8000-0000000000c2",
};

export const SENTINEL = {
  note: "NoteSentinelXYZ",
  supplier: "SupplierSentinelXYZ",
  reference: "RefSentinelXYZ",
  reason: "ReasonSentinelXYZ",
  cost: "7654321",
};

/** Ready-made role prefixes. Staff sessions carry aal2 (a verified second factor), as the MFA policy expects. */
export const AS = {
  anon: asRole({ role: "anon" }),
  service: asRole({ role: "service_role" }),
  alice: asRole({ sub: ID.alice }),
  bob: asRole({ sub: ID.bob }),
  eve: asRole({ sub: ID.eve }),
  olivia: asRole({ sub: ID.olivia, aal: "aal2" }),
  oliviaAal1: asRole({ sub: ID.olivia, aal: "aal1" }),
  sam: asRole({ sub: ID.sam, aal: "aal2" }),
  dana: asRole({ sub: ID.dana, aal: "aal2" }),
  // Claims a malicious user might forge. They must change nothing: authorization never reads them.
  forgedAdmin: asRole({
    sub: ID.alice,
    aal: "aal2",
    claims: { app_metadata: { role: "admin", permissions: ["finance.read"] }, user_metadata: { role: "owner", is_admin: true } },
  }),
  superuser: "reset role;\n",
};

export const itemsA = [
  { kind: "component", description: "Test graphics card", quantity: 1, unit_price_minor: 350000 },
  { kind: "build_service", description: "Assembly and testing", quantity: 1, unit_price_minor: 50000 },
];
export const itemsB = [{ kind: "component", description: "Test keyboard", quantity: 2, unit_price_minor: 50000 }];

export const json = (value) => JSON.stringify(value).replaceAll("'", "''");

/** A script fragment that creates an order as the owner and stores its id in the psql variable `into`. */
export function newOrder({ customer = ID.custA, items = itemsA, into = "oid", who = AS.olivia, extra = "" } = {}) {
  return `${who}select admin.create_order('${customer}', '${json(items)}'::jsonb${extra}) as ${into} \\gset\n`;
}

/**
 * Starts a throwaway database with the migrations and the fixtures. `schedule` picks the deposit schedule: "example" (the
 * default, an arbitrary labelled flat 50 percent for the mechanics tests) or "confirmed" (the owner-confirmed tiers that
 * the migrations ship, used by the preview data and the browser tests).
 */
export function startDatabase({ schedule = "example", before = null, tcp = false } = {}) {
  const cluster = startCluster({ tcp });
  try {
    applyShimAndMigrations(cluster, { before });
  } catch (error) {
    cluster.stop();
    throw error;
  }
  const vars = { ...ID };

  /** Runs a script in a transaction that is rolled back, with the fixture ids available as :'name'. */
  function run(script, who = "") {
    const preamble = Object.entries(vars).map(([k, v]) => `\\set ${k} '${v}'`).join("\n");
    return cluster.psql(`begin;\n${preamble}\n${who}${script}\nrollback;`);
  }
  /** Runs a script that must succeed and returns its output. */
  function ok(script, who = "") {
    const result = run(script, who);
    assert.ok(result.ok, `expected success, got: ${result.err}`);
    return result.out;
  }
  /** Runs a script that must fail with an error that matches the pattern. */
  function denied(script, who = "", pattern = /ERROR/) {
    const result = run(script, who);
    assert.ok(!result.ok, `expected an error but the script succeeded with output: ${result.out}`);
    assert.match(result.err, pattern);
  }
  /** Runs a script and commits it (used only to build the fixtures). */
  function commit(script) {
    const preamble = Object.entries(vars).map(([k, v]) => `\\set ${k} '${v}'`).join("\n");
    const result = cluster.psql(`begin;\n${preamble}\n${script}\ncommit;`);
    assert.ok(result.ok, `fixture failed: ${result.err}`);
    return result.out;
  }

  // ---- identities, customers, staff -------------------------------------------------------------------------
  commit(`
    insert into auth.users (id, email) values
      (:'alice', 'alice.login@example.test'), (:'bob', 'bob.login@example.test'), (:'eve', 'alice@example.test'),
      (:'olivia', 'olivia@example.test'), (:'sam', 'sam@example.test'), (:'dana', 'dana@example.test');
    insert into private.staff_members (user_id, role_code, display_name, is_active) values
      (:'olivia', 'owner', 'Owner (test)', true), (:'sam', 'staff', 'Staff (test)', true), (:'dana', 'staff', 'Inactive (test)', false);
    insert into public.customers (id, full_name, phone, email, source) values
      (:'custA', 'Alice Test', '+97455550001', 'alice@example.test', 'whatsapp'),
      (:'custB', 'Bob Test', '+97455550002', 'bob@example.test', 'website');
    insert into public.customer_accounts (user_id, customer_id, linked_via) values
      (:'alice', :'custA', 'admin'), (:'bob', :'custB', 'admin');
  `);

  // ---- a TEST EXAMPLE schedule, for the generic deposit-mechanics tests only ----------------------------------------
  // The migrations ship orders.deposit as the owner-CONFIRMED tiered schedule (15 / 25 / 35 percent by order total).
  // Most Phase 1 tests exercise deposit MECHANICS (gates, snapshots, reversals) and want round numbers, so this
  // fixture replaces the schedule with an arbitrary flat 50 percent EXAMPLE. It is not M1's policy and nothing outside
  // the tests depends on it. Dedicated tests restore the confirmed schedule from the migration's own version history
  // and check it (boundaries, rounding, snapshot at confirmation). The preview data and the browser tests do NOT
  // use this example: they run on the confirmed schedule, so no demonstration implies the withdrawn 50 percent.
  if (schedule === "example") {
    commit(`${AS.olivia}select admin.set_policy('orders.deposit',
      '{"percent_bps": 5000, "minimum_minor": 0, "required_before_status": "deposit_received"}'::jsonb,
      'unconfirmed_default', 'TEST EXAMPLE ONLY: an arbitrary flat 50 percent for round numbers; not an M1 decision');`);
  }

  // ---- orders for A and B, with private data that must never reach a customer -------------------------------
  const orderA = commit(`${newOrder({ into: "oa" })}select :'oa';`).trim();
  const orderB = commit(`${newOrder({ customer: ID.custB, items: itemsB, into: "ob" })}select :'ob';`).trim();
  vars.orderA = orderA;
  vars.orderB = orderB;

  commit(`
    ${AS.olivia}
    select admin.add_order_note(:'orderA', '${SENTINEL.note} internal note about the buyer');
    select admin.set_order_item_cost((select id from public.order_items where order_id = :'orderA' and position = 1),
      '${SENTINEL.supplier}', ${SENTINEL.cost}, 'USD', 'internal cost note');
    select admin.transition_order(:'orderA', 'awaiting_deposit', '${SENTINEL.reason}');
    select admin.record_payment(:'orderA', 'deposit', 100000, 'bank_transfer', now(), 'RCPT-TEST-1', '${SENTINEL.reference}', 'internal payment note');
    select admin.publish_tracking_event(:'orderA', 'Order confirmed', 'We have confirmed your order.', 'awaiting_deposit');
    select admin.publish_tracking_event(:'orderB', 'Order received', 'We received the order of the other customer.', 'pending_confirmation');
  `);

  // ---- quotations: Alice's quoted one, Alice's still-in-review one, Bob's, and a guest one ----------------------
  commit(`
    reset role;
    insert into public.quotations (id, customer_id, category, quantity, product_preference, requested_specs)
      values ('00000000-0000-4000-8000-0000000000d1', :'custA', 'Complete Custom PC', 1, 'Not sure', '{"use":"gaming"}');
    update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000d1';
    update public.quotations set status = 'quoted', quoted_total_minor = 400000 where id = '00000000-0000-4000-8000-0000000000d1';
    insert into public.quotation_lines (quotation_id, position, description, quantity, unit_price_minor)
      values ('00000000-0000-4000-8000-0000000000d1', 1, 'Quoted build', 1, 400000);
    insert into public.quotations (id, customer_id, category, quantity, product_preference)
      values ('00000000-0000-4000-8000-0000000000d2', :'custA', 'Monitor', 1, 'Not sure');
    update public.quotations set status = 'in_review' where id = '00000000-0000-4000-8000-0000000000d2';
    insert into public.quotation_lines (quotation_id, position, description, quantity, unit_price_minor)
      values ('00000000-0000-4000-8000-0000000000d2', 1, 'Draft price that must stay hidden', 1, 99900);
    insert into public.quotations (id, customer_id, category, quantity, product_preference)
      values ('00000000-0000-4000-8000-0000000000d3', :'custB', 'Mouse', 1, 'Not sure');
    insert into public.quotations (id, customer_id, guest_name, guest_phone, category, quantity, product_preference)
      values ('00000000-0000-4000-8000-0000000000d4', null, 'Guest Test', '+97455550009', 'Keyboard', 1, 'Not sure');
  `);

  return { cluster, vars, run, ok, denied, commit, stop: () => cluster.stop() };
}
