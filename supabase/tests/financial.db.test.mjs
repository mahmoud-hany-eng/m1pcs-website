// PLAT-0006: ORDER COSTS, COMPLETION DATES AND FINANCIAL REPORTING, DATABASE layer. Real PostgreSQL 16, the real migrations, the real staff
// functions (admin.*), the real row level security, and the staff gateway role running the SAME SQL text the website sends (read out of
// src/lib/staff/gateway.ts). Every amount is an integer in QAR minor units. Every name is synthetic.
//
// What it proves, in the order of the owner's brief:
//   A  who can see and change what: costs, profit and margin are owner-only; customers, anonymous users, ordinary staff and every
//      customer-facing API receive none of it (sentinel values are searched for everywhere they must not appear);
//   B  costs: several entries, estimated or actual, at every stage and after completion; missing is never zero; a clear complete / incomplete
//      state; immutable revisions with old value, new value, actor and reason; nothing deleted, nothing silently rewritten;
//   C  completion: completed_at is set by the database when an order FIRST reaches Delivered / Collected, in either workflow, and never
//      changes; the creation date is untouched; historical backfill only where the status history proves the moment;
//   D  reporting: the exact definitions (net revenue, direct cost, order profit, margin), Asia/Qatar month and year boundaries, the
//      completion month rather than the creation month, deposits never counted as revenue, more than 100 orders, annual totals;
//   E  the customer's order history for staff: exact line allocation of the discount and credit;
//   F  everything that existed before is unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { ONE, lines, makeHelpers, newKey, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const COST_SUPPLIER = "CostSupplierSentinelQ9";
const COST_NOTE = "CostNoteSentinelQ9";
const COST_AMOUNT = 7_700_077; // a distinctive amount that must never reach a customer or a staff member without finance.read
const cost = (over = {}) => ({ category: "components", description: "Graphics card purchase", amount_minor: 30000, cost_kind: "actual", supplier_ref: null, incurred_on: null, notes: null, ...over });
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);

suite("order costs, completion dates and financial reporting (PLAT-0006): real PostgreSQL 16, real migrations, real RLS", () => {
  let db;
  let h = {};
  let OLIVIA;
  let SAM;
  const J = (script, who = AS.olivia) => JSON.parse(lines(db.ok(/;\s*$/.test(script) ? script : `${script};`, who)).pop());
  const scalar = (...a) => h.scalar(...a);
  const count = (...a) => h.count(...a);
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  /** Runs a statement as a superuser with every trigger bypassed: used ONLY to arrange history (older dates, pre-migration states). */
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
    ({ OLIVIA, SAM } = h);
  });
  after(() => db?.stop());

  // ---- helpers -------------------------------------------------------------------------------------------------
  const newCustomer = () => {
    const id = randomUUID();
    const n = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${id}', 'Finance Test ${n}', '+974555${n}', '${id}@example.test', 'walk_in');`);
    return id;
  };
  /** A new order made by the 12-argument function (the one the new order form calls). Returns its id. */
  const mkOrder = ({ total = 100000, who = AS.olivia, customer = ID.custA, items = ONE(total), costs = null, discount = null, points = 0, key = null } = {}) =>
    lines(commit(`select admin.create_order('${customer}', '${JSON.stringify(items)}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, ${q(key)}::text, ${discount ? `'${JSON.stringify(discount)}'::jsonb` : "null::jsonb"}, ${points}::bigint, null::bigint, null::bigint, ${costs ? `'${JSON.stringify(costs)}'::jsonb` : "null::jsonb"});`, who)).pop().trim();
  const orderRow = (id) => JSON.parse(scalar(`select row_to_json(o)::text from public.orders o where id = '${id}'`));
  const payFull = (id) => {
    const net = Number(scalar(`select net_payable_minor from public.orders where id = '${id}'`));
    const paid = Number(scalar(`select amount_paid_minor from public.orders where id = '${id}'`));
    if (net - paid > 0) commit(`select admin.record_payment('${id}', 'balance', ${net - paid}, 'cash');`);
  };
  /** The earlier (version 1) workflow, to Delivered. The order is paid in full first. */
  const completeV1 = (id) => {
    commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
    payFull(id);
    for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
  };
  /** The owner-defined (version 2) workflow, to Delivered. */
  const completeV2 = (id) => {
    commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
    payFull(id);
    for (const to of ["deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"]) commit(`select admin.transition_order('${id}', '${to}');`);
    commit(`select admin.set_order_fulfillment_type('${id}', 'custom_pc_build', null);`);
    for (const to of ["building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
  };
  /** Puts an order's creation and completion at chosen instants (arrangement only: the database would otherwise use now()). */
  const placeInTime = (id, { created, completed }) => {
    // One statement: the table's own checks (a completion can never precede the creation) hold at every instant, even for arranged data.
    const sets = [created ? `created_at = '${created}'` : null, completed ? `completed_at = '${completed}'` : null].filter(Boolean).join(", ");
    if (sets) rewrite(`update public.orders set ${sets} where id = '${id}';`);
    if (completed) rewrite(`update private.order_completions set completed_at = '${completed}' where order_id = '${id}';`);
  };
  const addCost = (orderId, c = cost(), who = AS.olivia, entryId = randomUUID()) => {
    commit(`select admin.add_order_cost('${orderId}', '${entryId}', ${q(c.category)}, ${q(c.description)}, ${c.amount_minor}, ${q(c.cost_kind)}, ${q(c.supplier_ref)}, ${q(c.incurred_on)}::date, ${q(c.notes)});`, who);
    return entryId;
  };
  const costsOf = (orderId) => J(`select admin.order_costs('${orderId}')`);
  const report = (year, month = null) => J(`select admin.financial_report(${year}, ${month ?? "null"})`);
  const listCompleted = (year, month, who = AS.olivia, limit = 50, offset = 0) => J(`select admin.list_completed_orders(${year}, ${month ?? "null"}, ${limit}, ${offset})`, who);
  /** An order that is completed, priced, costed and placed at a chosen time. */
  const completedAt = (iso, { total = 100000, costs = null, complete = completeV1, created = null, customer = ID.custA } = {}) => {
    const id = mkOrder({ total, costs, customer });
    complete(id);
    placeInTime(id, { created: created ?? new Date(new Date(iso).getTime() - 5 * 86400000).toISOString(), completed: iso });
    return id;
  };

  // =================================================================================================================
  describe("A. who can see and change what", () => {
    const FUNCTIONS = [
      "admin.order_costs(uuid)", "admin.add_order_cost(uuid, uuid, text, text, bigint, text, text, date, text)",
      "admin.edit_order_cost(uuid, integer, text, text, bigint, text, text, date, text, text)", "admin.void_order_cost(uuid, integer, text)",
      "admin.set_order_costs_complete(uuid, boolean, text)", "admin.financial_report(integer, integer)", "admin.verify_historical_completion(uuid, timestamptz, text)",
    ];
    const PRIVATE_TABLES = ["private.order_costs", "private.order_cost_revisions", "private.order_cost_state", "private.order_completions"];

    it("the finance permissions are held by the owner role only; ordinary staff hold none of them", () => {
      for (const p of ["finance.read", "finance.manage", "finance.verify"]) {
        assert.equal(scalar(`select string_agg(role_code, ',' order by role_code) from private.role_permissions where permission_code = '${p}'`), "owner", p);
      }
    });

    it("every new private table has row level security and no privilege for any API role; the new functions are closed to anon and PUBLIC", () => {
      for (const t of PRIVATE_TABLES) {
        assert.equal(scalar(`select relrowsecurity from pg_class where oid = '${t}'::regclass`), "t", t);
        for (const role of ["anon", "authenticated", "service_role"]) {
          assert.equal(scalar(`select has_any_column_privilege('${role}', '${t}', 'select,insert,update,references')`), "f", `${role} on ${t}`);
        }
      }
      for (const f of [...FUNCTIONS, "admin.order_completion(uuid)", "admin.list_completed_orders(integer, integer, integer, integer)", "admin.overview_summary(integer)", "admin.customer_orders(uuid, integer, integer)"]) {
        assert.equal(scalar(`select has_function_privilege('anon', '${f}', 'execute')`), "f", f);
        assert.equal(scalar(`select has_function_privilege('public', '${f}', 'execute')`), "f", f);
        assert.equal(scalar(`select has_function_privilege('m1_staff_gateway', '${f}', 'execute')`), "t", f);
      }
    });

    it("ordinary staff, an inactive staff member, a second-factor-less owner, a signed-in customer and an anonymous caller are all refused every finance function", () => {
      const id = mkOrder();
      const eid = randomUUID();
      const calls = [
        `select admin.order_costs('${id}')`,
        `select admin.add_order_cost('${id}', '${eid}', 'components', 'x', 100, 'actual', null, null, null)`,
        `select admin.financial_report(2026, null)`,
        `select admin.set_order_costs_complete('${id}', true, null)`,
        `select admin.verify_historical_completion('${id}', now(), 'a reason')`,
      ];
      for (const who of [AS.sam, AS.dana, AS.oliviaAal1, AS.alice, AS.anon, AS.forgedAdmin]) {
        for (const call of calls) db.denied(`${call};`, who, /permission denied|must be owner|not allowed|ERROR/i);
      }
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${id}'`), 0, "nothing was written by a refused caller");
    });

    it("a customer reads their own order, but not one cost, margin, profit or supplier value anywhere the API roles can reach", () => {
      const id = mkOrder({ customer: ID.custA, costs: [cost({ supplier_ref: COST_SUPPLIER, notes: COST_NOTE, amount_minor: COST_AMOUNT })] });
      completeV1(id);
      commit(`select admin.add_order_cost('${id}', '${randomUUID()}', 'assembly', 'Assembly labour', ${COST_AMOUNT + 1}, 'actual', '${COST_SUPPLIER}', null, '${COST_NOTE}');`);
      // The customer-readable tables, row by row, as the customer. (A column that carried a cost would show up here.)
      for (const t of ["public.orders", "public.order_items", "public.payments", "public.order_tracking_events", "public.loyalty_ledger", "public.order_workflow_stages"]) {
        const dump = scalar(`select coalesce(jsonb_agg(to_jsonb(t))::text, '[]') from ${t} t`, AS.alice);
        for (const needle of [COST_SUPPLIER, COST_NOTE, String(COST_AMOUNT), String(COST_AMOUNT + 1), "margin", "profit", "supplier", "cost_"]) {
          assert.ok(!dump.toLowerCase().includes(needle.toLowerCase()), `${t} must not mention ${needle}`);
        }
      }
      // The only new column the customer sees is the completion date.
      const own = JSON.parse(scalar(`select to_jsonb(o)::text from public.orders o where id = '${id}'`, AS.alice));
      assert.ok(own.completed_at, "the customer sees when their order was completed");
      for (const t of PRIVATE_TABLES) db.denied(`select count(*) from ${t};`, AS.alice, /permission denied/);
      for (const t of PRIVATE_TABLES) db.denied(`select count(*) from ${t};`, AS.anon, /permission denied/);
    });

    it("staff WITHOUT finance.read can use every order and customer function, and none of them carries a cost, a profit, a margin or a supplier", () => {
      const id = mkOrder({ customer: ID.custA, costs: [cost({ supplier_ref: COST_SUPPLIER, notes: COST_NOTE, amount_minor: COST_AMOUNT })] });
      completeV1(id);
      const seen = [
        scalar(`select admin.get_order('${id}')`, AS.sam), scalar(`select admin.list_orders(null, null, 100, 0)`, AS.sam),
        scalar(`select admin.dashboard_summary()`, AS.sam), scalar(`select admin.order_completion('${id}')`, AS.sam),
        scalar(`select admin.list_completed_orders(null, null, 200, 0)`, AS.sam), scalar(`select admin.overview_summary(null)`, AS.sam),
        scalar(`select admin.customer_orders('${ID.custA}', 50, 0)`, AS.sam), scalar(`select admin.get_customer('${ID.custA}')`, AS.sam),
        scalar(`select coalesce(jsonb_agg(row_to_json(t)::jsonb)::text, '[]') from admin.search_customers('Alice', 25) t`, AS.sam),
      ].join("\n").toLowerCase();
      for (const needle of [COST_SUPPLIER, COST_NOTE, String(COST_AMOUNT), "profit", "margin", "supplier", "cost_state", "actual_cost", "estimated_cost", "recorded_cost"]) {
        assert.ok(!seen.includes(needle.toLowerCase()), `staff without finance.read must not receive ${needle}`);
      }
      // ... and the report block of the overview is simply absent for them.
      assert.equal(J(`select admin.overview_summary(null)`, AS.sam).financial, undefined);
      assert.equal(J(`select admin.list_completed_orders(null, null, 10, 0)`, AS.sam).finance, false);
    });

    it("the legacy per-item cost table and its functions are untouched and play no part in the new profit", () => {
      const id = mkOrder();
      completeV1(id);
      db.commit(`${AS.olivia}select admin.set_order_item_cost((select id from public.order_items where order_id = '${id}' limit 1), 'LegacySupplier', 1, 'QAR', null);`);
      const view = costsOf(id);
      assert.equal(view.summary.cost_state, "missing", "a legacy item cost is not an order cost");
      assert.equal(view.summary.profit_minor, null);
    });
  });

  // =================================================================================================================
  describe("B. costs: entries, stages, missing is not zero, complete / incomplete, immutable history", () => {
    it("an order with no cost entry has an UNKNOWN cost: no profit is shown, and it is never revenue minus zero", () => {
      const id = mkOrder({ total: 100000 });
      const s = costsOf(id).summary;
      assert.equal(s.cost_state, "missing");
      assert.equal(s.profit_minor, null);
      assert.equal(s.margin_bps, null);
      assert.equal(s.recorded_cost_minor, 0);
      assert.equal(s.profit_is_provisional, true);
    });

    it("several entries (every category, estimated and actual) add up automatically, and the total follows every change", () => {
      const id = mkOrder({ total: 100000 });
      const kinds = [
        ["components", "estimated", 40000], ["international_shipping", "actual", 5000], ["customs_duties", "actual", 2500], ["assembly", "estimated", 1000],
        ["local_delivery", "actual", 700], ["payment_processing", "actual", 300], ["other", "actual", 100],
      ];
      for (const [category, cost_kind, amount_minor] of kinds) addCost(id, cost({ category, cost_kind, amount_minor, description: `${category} entry` }));
      let s = costsOf(id).summary;
      assert.equal(s.actual_cost_minor, 5000 + 2500 + 700 + 300 + 100);
      assert.equal(s.estimated_cost_minor, 41000);
      assert.equal(s.recorded_cost_minor, 49600);
      assert.equal(s.entries, 7);
      assert.equal(s.cost_state, "incomplete");
      assert.equal(s.profit_minor, 100000 - 49600, "the profit is provisional but arithmetically exact");
      assert.equal(s.profit_is_provisional, true);
      const first = costsOf(id).entries.find((e) => e.category === "components");
      commit(`select admin.edit_order_cost('${first.id}', ${first.version}, 'components', 'Graphics card (actual invoice)', 38000, 'actual', null, null, null, 'the invoice arrived');`);
      s = costsOf(id).summary;
      assert.equal(s.actual_cost_minor, 5000 + 2500 + 700 + 300 + 100 + 38000);
      assert.equal(s.estimated_cost_minor, 1000);
    });

    it("costs can be added at EVERY stage: before confirmation, while awaiting the deposit, in sourcing, building, ready, after delivery", () => {
      const id = mkOrder({ total: 100000 });
      const stage = (label) => addCost(id, cost({ description: `at ${label}`, amount_minor: 100 }));
      stage("pending_confirmation");
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      stage("awaiting_deposit");
      payFull(id);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) {
        commit(`select admin.transition_order('${id}', '${to}');`);
        stage(to);
      }
      // ... and long after the order is completed and fully settled
      stage("a later correction");
      const view = costsOf(id);
      assert.equal(view.entries.length, 9);
      assert.equal(view.summary.recorded_cost_minor, 900);
      assert.ok(view.completed_at, "the order is completed, and a cost was still accepted");
    });

    it("an order that is on hold or cancelled can carry costs too (money was spent), and they are reported separately, never as profit", () => {
      const held = mkOrder();
      commit(`select admin.transition_order('${held}', 'awaiting_deposit');`);
      commit(`select admin.transition_order('${held}', 'on_hold', 'waiting');`);
      addCost(held, cost({ amount_minor: 4200 }));
      const dead = mkOrder();
      commit(`select admin.transition_order('${dead}', 'cancelled', 'customer withdrew');`);
      addCost(dead, cost({ amount_minor: 9100 }));
      const r = report(2026);
      assert.ok(r.unrecognized_costs.cancelled_orders_minor >= 9100);
      assert.ok(r.unrecognized_costs.open_orders_minor >= 4200);
    });

    it("an entry is validated: category, kind, amount, date, length and unknown fields are refused with a sentence staff can read, and nothing is saved", () => {
      const id = mkOrder();
      const bad = (c, pattern) => db.denied(`${AS.olivia}select admin.add_order_cost('${id}', '${randomUUID()}', ${q(c.category)}, ${q(c.description)}, ${c.amount_minor}, ${q(c.cost_kind)}, ${q(c.supplier_ref)}, ${q(c.incurred_on)}::date, ${q(c.notes)});`, "", pattern);
      bad(cost({ category: "gifts" }), /choose a category/);
      bad(cost({ cost_kind: "guess" }), /estimated or actual/);
      bad(cost({ amount_minor: -1 }), /whole number of QAR minor units, zero or more/);
      bad(cost({ description: "   " }), /description must be 1 to 200/);
      bad(cost({ description: "x".repeat(201) }), /description must be 1 to 200/);
      bad(cost({ supplier_ref: "s".repeat(121) }), /limited to 120/);
      bad(cost({ notes: "n".repeat(1001) }), /limited to 1000/);
      bad(cost({ incurred_on: "1999-01-01" }), /out of range/);
      db.denied(`${AS.olivia}select admin.create_order('${ID.custA}', '${JSON.stringify(ONE(1000))}'::jsonb, null::uuid, 'admin', null, null, null, null::jsonb, 0::bigint, null::bigint, null::bigint, '[{"category":"components","description":"x","amount_minor":1,"cost_kind":"actual","price":9}]'::jsonb);`, "", /field that is not allowed/);
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${id}'`), 0);
      // zero is a real, explicit amount ("no cost"), and a QAR 0.00 entry is accepted
      addCost(id, cost({ amount_minor: 0, description: "No direct cost on this order" }));
      assert.equal(costsOf(id).summary.entries, 1);
    });

    it("editing keeps the past: the entry, its new version, and a revision with the OLD value, the NEW value, the person, the time and the reason", () => {
      const id = mkOrder();
      const eid = addCost(id, cost({ amount_minor: 10000, description: "Card", supplier_ref: "INV-1" }));
      const before = costsOf(id).entries[0];
      assert.equal(before.version, 1);
      commit(`select admin.edit_order_cost('${eid}', 1, 'components', 'Card (final invoice)', 12500, 'actual', 'INV-2', null, 'corrected', 'the supplier invoice changed the price');`);
      const view = costsOf(id);
      assert.equal(view.entries[0].version, 2);
      assert.equal(view.entries[0].amount_minor, 12500);
      const edit = view.revisions.find((r) => r.action === "edited");
      assert.equal(edit.old_values.amount_minor, 10000);
      assert.equal(edit.new_values.amount_minor, 12500);
      assert.equal(edit.old_values.supplier_ref, "INV-1");
      assert.equal(edit.new_values.supplier_ref, "INV-2");
      assert.equal(edit.reason, "the supplier invoice changed the price");
      assert.equal(edit.by, "Owner (test)");
      assert.ok(edit.at);
      assert.equal(view.revisions.filter((r) => r.action === "created").length, 1, "the creation is kept as its own revision");
    });

    it("an edit needs a reason, and a no-op edit is refused; a stale screen is refused (someone else changed the entry) and saves nothing", () => {
      const id = mkOrder();
      const eid = addCost(id, cost({ amount_minor: 1000 }));
      db.denied(`${AS.olivia}select admin.edit_order_cost('${eid}', 1, 'components', 'x', 2000, 'actual', null, null, null, '  ');`, "", /say why the cost is being changed/);
      db.denied(`${AS.olivia}select admin.edit_order_cost('${eid}', 1, 'components', 'Graphics card purchase', 1000, 'actual', null, null, null, 'same values');`, "", /nothing was changed/);
      commit(`select admin.edit_order_cost('${eid}', 1, 'components', 'x', 2000, 'actual', null, null, null, 'first edit');`);
      // a second person (or tab) still holding version 1
      db.denied(`${AS.olivia}select admin.edit_order_cost('${eid}', 1, 'components', 'y', 3000, 'actual', null, null, null, 'stale edit');`, "", /changed by someone else/);
      assert.equal(costsOf(id).entries[0].amount_minor, 2000);
    });

    it("an entry is never deleted: it is voided with a reason, stays visible in the history, and drops out of the totals", () => {
      const id = mkOrder();
      const eid = addCost(id, cost({ amount_minor: 5000 }));
      addCost(id, cost({ amount_minor: 700, description: "second" }));
      db.denied(`${AS.olivia}select admin.void_order_cost('${eid}', 1, '');`, "", /say why/);
      commit(`select admin.void_order_cost('${eid}', 1, 'entered on the wrong order');`);
      const view = costsOf(id);
      assert.equal(view.summary.recorded_cost_minor, 700, "the voided amount no longer counts");
      assert.equal(view.entries.find((e) => e.id === eid).status, "voided", "but it is still there");
      assert.ok(view.revisions.some((r) => r.action === "voided" && r.reason === "entered on the wrong order" && r.old_values.status === "active"));
      db.denied(`${AS.olivia}select admin.edit_order_cost('${eid}', 2, 'components', 'x', 1, 'actual', null, null, null, 'try');`, "", /voided cost entry cannot be edited/);
      // the database itself refuses to delete or rewrite history, even for a superuser
      assert.match(db.cluster.psql(`delete from private.order_costs where id = '${eid}';`).err, /never deleted/);
      assert.match(db.cluster.psql(`update private.order_cost_revisions set reason = 'rewritten';`).err, /append-only|not allowed|immutable|cannot/i);
      assert.match(db.cluster.psql(`delete from private.order_cost_revisions;`).err, /append-only|not allowed|immutable|cannot/i);
      assert.match(db.cluster.psql(`truncate private.order_cost_revisions;`).err, /append-only|not allowed|immutable|cannot|truncate/i);
    });

    it("a repeat of the SAME add (same entry id) saves nothing and says so; the same id with different data is refused", () => {
      const id = mkOrder();
      const eid = randomUUID();
      const add = (amount) => lines(db.ok(`select admin.add_order_cost('${id}', '${eid}', 'components', 'Card', ${amount}, 'actual', null, null, null);`, AS.olivia)).pop();
      commit(`select admin.add_order_cost('${id}', '${eid}', 'components', 'Card', 1000, 'actual', null, null, null);`);
      assert.equal(add(1000), eid, "a repeat returns the entry that was already saved");
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${id}'`), 1);
      db.denied(`${AS.olivia}select admin.add_order_cost('${id}', '${eid}', 'components', 'Card', 2000, 'actual', null, null, null);`, "", /already used for a different entry/);
      // a stale retry of an edit is recognised too (the double click)
      commit(`select admin.edit_order_cost('${eid}', 1, 'components', 'Card', 1500, 'actual', null, null, null, 'price fixed');`);
      assert.equal(lines(db.ok(`select admin.edit_order_cost('${eid}', 1, 'components', 'Card', 1500, 'actual', null, null, null, 'price fixed');`, AS.olivia)).pop(), "2");
      assert.equal(count(`select count(*) from private.order_cost_revisions where cost_id = '${eid}' and action = 'edited'`), 1);
    });

    it("COMPLETE needs at least one entry and no estimate; any later change reopens it (visibly); reopening by hand needs a reason", () => {
      const id = mkOrder();
      db.denied(`${AS.olivia}select admin.set_order_costs_complete('${id}', true, null);`, "", /no cost entry yet/);
      const est = addCost(id, cost({ cost_kind: "estimated", amount_minor: 900 }));
      db.denied(`${AS.olivia}select admin.set_order_costs_complete('${id}', true, null);`, "", /estimated entries remain/);
      commit(`select admin.edit_order_cost('${est}', 1, 'components', 'Graphics card purchase', 950, 'actual', null, null, null, 'actual invoice');`);
      commit(`select admin.set_order_costs_complete('${id}', true, 'all invoices received');`);
      assert.equal(costsOf(id).summary.cost_state, "complete");
      assert.equal(costsOf(id).summary.profit_is_provisional, false);
      // adding an entry to a complete order reopens it, and says so in the history
      addCost(id, cost({ amount_minor: 10, description: "a late fee" }));
      assert.equal(costsOf(id).summary.cost_state, "incomplete");
      assert.ok(costsOf(id).revisions.some((r) => r.action === "marked_incomplete" && /added after the costs were marked complete/.test(r.reason)));
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      commit(`select admin.edit_order_cost('${est}', 2, 'components', 'Graphics card purchase', 960, 'actual', null, null, null, 'fixed a typo');`);
      assert.equal(costsOf(id).summary.cost_state, "incomplete", "an edit reopens it too");
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      db.denied(`${AS.olivia}select admin.set_order_costs_complete('${id}', false, '');`, "", /say why/);
      commit(`select admin.set_order_costs_complete('${id}', false, 'an invoice is missing');`);
      assert.equal(costsOf(id).summary.cost_state, "incomplete");
      // declaring complete twice is harmless
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      assert.equal(count(`select count(*) from private.order_cost_revisions where order_id = '${id}' and action = 'marked_complete'`), 4);
    });
  });

  // =================================================================================================================
  describe("C. completion dates: recorded by the database, once, in either workflow", () => {
    it("the first arrival at Delivered / Collected sets completed_at (same instant as the status history), and the creation date is untouched", () => {
      const id = mkOrder();
      const created = orderRow(id).created_at;
      assert.equal(orderRow(id).completed_at, null, "an order that is not delivered has no completion date");
      completeV1(id);
      const o = orderRow(id);
      assert.ok(o.completed_at);
      assert.equal(o.created_at, created, "the original order creation date is unchanged");
      assert.equal(scalar(`select o.completed_at = (select h.changed_at from private.order_status_history h where h.order_id = o.id and h.to_status = 'delivered') from public.orders o where o.id = '${id}'`), "t");
      const c = JSON.parse(scalar(`select to_jsonb(c)::text from private.order_completions c where order_id = '${id}'`));
      assert.equal(c.basis, "transition");
      assert.equal(c.net_revenue_minor, 100000);
      assert.equal(c.gross_minor, 100000);
    });

    it("the owner-defined workflow (version 2) records it the same way", () => {
      commit(`select admin.set_policy('orders.workflow', '{"default_version": 2}'::jsonb, 'unconfirmed_default', 'test: version 2 orders');`);
      try {
        const id = mkOrder();
        assert.equal(orderRow(id).workflow_version, 2);
        assert.equal(orderRow(id).completed_at, null);
        completeV2(id);
        const o = orderRow(id);
        assert.equal(o.status, "delivered");
        assert.ok(o.completed_at, "a version-2 order has a completion date");
        assert.equal(scalar(`select basis from private.order_completions where order_id = '${id}'`), "transition");
      } finally {
        commit(`select admin.set_policy('orders.workflow', '{"default_version": 1}'::jsonb, 'unconfirmed_default', 'test: back to version 1');`);
      }
    });

    it("the date cannot be typed in, changed, cleared or backdated; a completed order cannot change status; an order cannot be created completed", () => {
      const open = mkOrder();
      const done = mkOrder();
      completeV1(done);
      const attempt = (sql) => db.cluster.psql(sql).err;
      assert.match(attempt(`update public.orders set completed_at = now() where id = '${open}';`), /recorded by the system/);
      assert.match(attempt(`update public.orders set completed_at = now() - interval '9 days' where id = '${done}';`), /never changes/);
      assert.match(attempt(`update public.orders set completed_at = null where id = '${done}';`), /never changes/);
      assert.match(attempt(`update public.orders set status = 'cancelled' where id = '${done}';`), /completed order cannot change status/);
      assert.match(attempt(`insert into public.orders (customer_id, completed_at) values ('${ID.custA}', now());`), /cannot be created already completed/);
      // the same refusals as a staff session, through the functions, and the workflow itself has no move out of Delivered
      db.denied(`${AS.olivia}select admin.transition_order('${done}', 'cancelled', 'cancel after completion');`, "", /cannot move from delivered to cancelled/);
      assert.match(attempt(`update private.order_completions set completed_at = now() where order_id = '${done}';`), /append-only|not allowed|cannot|immutable/i);
    });

    it("an order that is cancelled or on hold never has a completion date, and a payment reversal after completion changes neither the date nor the revenue", () => {
      const dead = mkOrder();
      commit(`select admin.transition_order('${dead}', 'cancelled', 'withdrawn');`);
      assert.equal(orderRow(dead).completed_at, null);
      const id = mkOrder({ total: 50000 });
      completeV1(id);
      const before = orderRow(id).completed_at;
      const pay = scalar(`select id from public.payments where order_id = '${id}' and entry_type = 'payment' order by created_at desc limit 1`);
      commit(`select admin.reverse_payment('${pay}', 'the transfer bounced');`);
      assert.equal(orderRow(id).completed_at, before);
      assert.equal(Number(scalar(`select net_revenue_minor from private.order_completions where order_id = '${id}'`)), 50000, "the recognised revenue is not erased by the reversal");
      assert.ok(Number(orderRow(id).balance_due_minor) > 0, "the money owed shows again");
    });

    // The backfill is the migration's own text, run here against states that look like the database before completion dates existed.
    const backfillSql = () => {
      const text = readFileSync(join(ROOT, "supabase/migrations/20261124120000_order_costs_and_completion_schema.sql"), "utf8");
      const start = text.indexOf("do $$\ndeclare\n  r record;");
      const end = text.indexOf("-- 6. Self-checks");
      assert.ok(start > 0 && end > start);
      return text.slice(start, end);
    };

    it("HISTORICAL BACKFILL: only an exact, recorded transition into Delivered gives a date; the earlier move wins over a later workflow move; no history means NO date", () => {
      const proved = mkOrder();
      completeV1(proved);
      const adopted = mkOrder();
      completeV1(adopted);
      const noHistory = randomUUID();
      // The state before completion dates existed: no date, no record. The "adopted" order also has the later delivered -> delivered row that
      // adopting an order onto the new workflow writes; the first REAL move (ready_for_delivery -> delivered) is the proof.
      rewrite(`update public.orders set completed_at = null where id in ('${proved}', '${adopted}');
               delete from private.order_completions where order_id in ('${proved}', '${adopted}');
               insert into private.order_status_history (order_id, from_status, to_status, reason) values ('${adopted}', 'delivered', 'delivered', 'Moved to the current workflow: test');
               insert into public.orders (id, customer_id, status, total_minor, created_at) values ('${noHistory}', '${ID.custA}', 'delivered', 70000, now() - interval '30 days');`);
      const proofOf = (id) => scalar(`select min(changed_at) from private.order_status_history where order_id = '${id}' and to_status = 'delivered' and from_status is distinct from to_status`);
      const expectedProved = proofOf(proved);
      const expectedAdopted = proofOf(adopted);
      const r = db.cluster.psql(backfillSql());
      assert.ok(r.ok, r.err);
      assert.match(r.err, /proved from the status history/);
      assert.equal(orderRow(proved).completed_at, JSON.parse(scalar(`select to_jsonb(changed_at)::text from (select ${q(expectedProved)}::timestamptz as changed_at) x`)));
      assert.equal(scalar(`select o.completed_at = ${q(expectedAdopted)}::timestamptz from public.orders o where o.id = '${adopted}'`), "t", "the adoption row is not mistaken for the completion");
      assert.equal(scalar(`select basis from private.order_completions where order_id = '${proved}'`), "status_history");
      assert.equal(orderRow(noHistory).completed_at, null, "no proof, no date: it is not invented");
      assert.equal(count(`select count(*) from private.order_completions where order_id = '${noHistory}'`), 0);
      const flagged = J(`select admin.order_completion('${noHistory}')`);
      assert.equal(flagged.needs_verification, true);
      assert.equal(J(`select admin.order_completion('${proved}')`).needs_verification, false);
      // running it again changes nothing
      assert.ok(db.cluster.psql(backfillSql()).ok);
      assert.equal(count(`select count(*) from private.order_completions where order_id = '${proved}'`), 1);
      assert.equal(orderRow(noHistory).completed_at, null);
    });

    it("HISTORICAL VERIFICATION: only the owner, with a reason, once, for a delivered order with no proven date, never in the future or before the order existed", () => {
      const id = randomUUID();
      rewrite(`insert into public.orders (id, customer_id, status, total_minor, created_at) values ('${id}', '${ID.custA}', 'delivered', 64000, '2026-05-01T09:00:00Z');`);
      const verify = (iso, reason, who = AS.olivia) => `${who}select admin.verify_historical_completion('${id}', '${iso}', ${q(reason)});`;
      db.denied(verify("2026-05-20T10:00:00Z", "from the delivery note", AS.sam), "", /permission denied/);
      db.denied(verify("2026-05-20T10:00:00Z", "ok"), "", /say how the completion date was established/);
      db.denied(verify("2026-04-30T10:00:00Z", "from the delivery note"), "", /after the order was created/);
      db.denied(verify("2999-01-01T10:00:00Z", "from the delivery note"), "", /not in the future/);
      assert.equal(orderRow(id).completed_at, null, "every refusal left the order unchanged");
      const open = mkOrder();
      db.denied(`${AS.olivia}select admin.verify_historical_completion('${open}', now(), 'not delivered yet');`, "", /only a delivered order/);
      commit(`select admin.verify_historical_completion('${id}', '2026-05-20T10:00:00Z', 'the customer signed the delivery note on 20 May');`);
      const c = JSON.parse(scalar(`select to_jsonb(c)::text from private.order_completions c where order_id = '${id}'`));
      assert.equal(c.basis, "owner_verified");
      assert.equal(c.net_revenue_minor, 64000);
      assert.match(c.reason, /delivery note/);
      assert.equal(new Date(orderRow(id).completed_at).toISOString(), "2026-05-20T10:00:00.000Z");
      db.denied(verify("2026-05-21T10:00:00Z", "a second attempt"), "", /already has a completion date/);
      assert.equal(count(`select count(*) from private.audit_log where action = 'order.completion_verified' and entity_id = '${id}'`), 1);
    });
  });

  // =================================================================================================================
  describe("D. reporting: exact definitions, Asia/Qatar months, the completion month, deposits never double counted", () => {
    const bucket = (r, month) => r.months[month - 1];

    it("net revenue = gross - discount - redeemed credit; profit = revenue - actual direct costs; margin = profit / revenue (QAR 1,000 order, QAR 100 discount, 200 points = QAR 20)", () => {
      const cust = newCustomer();
      commit(`select admin.adjust_loyalty('${cust}', 200, 'points for the report test');`);
      const id = mkOrder({ total: 100000, customer: cust, discount: { mode: "fixed", amount_minor: 10000, reason: "owner discount for the test" }, points: 200 });
      assert.equal(orderRow(id).net_payable_minor, 100000 - 10000 - 2000);
      addCost(id, cost({ amount_minor: 25000, description: "Components" }));
      addCost(id, cost({ amount_minor: 5000, category: "international_shipping", description: "Air freight" }));
      commit(`select admin.set_order_costs_complete('${id}', true, 'invoices received');`);
      completeV1(id);
      placeInTime(id, { created: "2031-03-01T08:00:00Z", completed: "2031-03-15T09:00:00Z" });
      const m = bucket(report(2031), 3);
      assert.equal(m.completed_orders, 1);
      assert.equal(m.gross_minor, 100000);
      assert.equal(m.discount_minor, 10000);
      assert.equal(m.loyalty_credit_minor, 2000);
      assert.equal(m.net_revenue_minor, 88000);
      assert.equal(m.actual_cost_minor, 30000);
      assert.equal(m.recorded_cost_minor, 30000);
      assert.equal(m.profit_minor, 58000);
      assert.equal(m.margin_bps, 6591, "58,000 / 88,000 = 65.909 percent");
      assert.equal(m.profit_state, "verified");
      assert.equal(m.orders_costs_complete, 1);
      const view = costsOf(id).summary;
      assert.equal(view.net_revenue_minor, 88000);
      assert.equal(view.profit_minor, 58000);
      assert.equal(view.margin_bps, 6591);
      assert.equal(view.profit_is_provisional, false);
    });

    it("an order with no cost entry still counts in revenue, but its profit is UNAVAILABLE: it is neither zero cost nor included in profit", () => {
      const id = completedAt("2031-05-10T09:00:00Z", { total: 80000 });
      const m = bucket(report(2031), 5);
      assert.equal(m.completed_orders, 1);
      assert.equal(m.net_revenue_minor, 80000);
      assert.equal(m.profit_minor, null);
      assert.equal(m.margin_bps, null);
      assert.equal(m.profit_state, "unavailable");
      assert.equal(m.orders_costs_missing, 1);
      assert.equal(m.revenue_without_costs_minor, 80000);
      assert.equal(costsOf(id).summary.cost_state, "missing");
    });

    it("a month mixing complete, incomplete and missing costs is PROVISIONAL, and the profit covers only the orders that have cost entries", () => {
      const a = mkOrder({ total: 100000, costs: [cost({ amount_minor: 40000, cost_kind: "actual" })] });
      commit(`select admin.set_order_costs_complete('${a}', true, null);`);
      const b = mkOrder({ total: 50000, costs: [cost({ amount_minor: 10000, cost_kind: "estimated" })] });
      const c = mkOrder({ total: 70000 });
      for (const [id, day] of [[a, 3], [b, 4], [c, 5]]) {
        completeV1(id);
        placeInTime(id, { created: "2031-07-01T08:00:00Z", completed: `2031-07-0${day}T09:00:00Z` });
      }
      const m = bucket(report(2031), 7);
      assert.equal(m.completed_orders, 3);
      assert.equal(m.net_revenue_minor, 220000);
      assert.equal(m.orders_costs_complete, 1);
      assert.equal(m.orders_costs_incomplete, 1);
      assert.equal(m.orders_costs_missing, 1);
      assert.equal(m.actual_cost_minor, 40000);
      assert.equal(m.estimated_cost_minor, 10000);
      assert.equal(m.profit_minor, (100000 - 40000) + (50000 - 10000), "only the two orders with entries");
      assert.equal(m.profit_basis_revenue_minor, 150000);
      assert.equal(m.margin_bps, Math.round((100000 * 10000) / 150000));
      assert.equal(m.revenue_without_costs_minor, 70000);
      assert.equal(m.profit_state, "provisional");
    });

    it("a negative profit is legitimate and is reported as negative, with a negative margin", () => {
      const id = mkOrder({ total: 100000, costs: [cost({ amount_minor: 120000 })] });
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      completeV1(id);
      placeInTime(id, { created: "2031-09-01T08:00:00Z", completed: "2031-09-09T09:00:00Z" });
      const m = bucket(report(2031), 9);
      assert.equal(m.profit_minor, -20000);
      assert.equal(m.margin_bps, -2000);
      assert.equal(m.profit_state, "verified");
      assert.equal(costsOf(id).summary.profit_minor, -20000);
    });

    it("ASIA/QATAR BOUNDARIES: 23:59:59 on the last day of a month is that month, 00:00:00 local is the next; the same across the year end", () => {
      const at = (iso, total) => completedAt(iso, { total });
      const jan = at("2032-01-31T20:59:59Z", 10000); // 23:59:59 in Qatar (UTC+3)
      const feb = at("2032-01-31T21:00:00Z", 20000); // 00:00:00 on 1 February in Qatar
      const dec = at("2032-12-31T20:59:59Z", 30000);
      const nextYear = at("2032-12-31T21:00:00Z", 40000); // 00:00:00 on 1 January 2033 in Qatar
      const r32 = report(2032);
      assert.equal(bucket(r32, 1).completed_orders, 1);
      assert.equal(bucket(r32, 1).net_revenue_minor, 10000);
      assert.equal(bucket(r32, 2).completed_orders, 1);
      assert.equal(bucket(r32, 2).net_revenue_minor, 20000);
      assert.equal(bucket(r32, 12).net_revenue_minor, 30000);
      assert.equal(r32.period.completed_orders, 3, "the 2033 order is not in 2032");
      assert.equal(bucket(report(2033), 1).net_revenue_minor, 40000);
      assert.deepEqual(listCompleted(2032, 1).rows.map((x) => x.id), [jan]);
      assert.deepEqual(listCompleted(2032, 2).rows.map((x) => x.id), [feb]);
      assert.deepEqual(listCompleted(2033, 1).rows.map((x) => x.id), [nextYear]);
      assert.equal(listCompleted(2032, 12).rows[0].id, dec);
    });

    it("THE COMPLETION MONTH, NOT THE CREATION MONTH: created 20 November, completed 3 December -> December's revenue, cost and profit, nothing in November", () => {
      const id = mkOrder({ total: 90000, costs: [cost({ amount_minor: 30000 })] });
      commit(`select admin.set_order_costs_complete('${id}', true, null);`);
      completeV1(id);
      placeInTime(id, { created: "2033-11-20T08:00:00Z", completed: "2033-12-03T09:00:00Z" });
      const r = report(2033);
      assert.equal(bucket(r, 11).completed_orders, 0, "created in November is not completed in November");
      assert.equal(bucket(r, 11).net_revenue_minor, 0);
      assert.equal(bucket(r, 12).completed_orders, 1);
      assert.equal(bucket(r, 12).net_revenue_minor, 90000);
      assert.equal(bucket(r, 12).actual_cost_minor, 30000);
      assert.equal(bucket(r, 12).profit_minor, 60000);
      assert.deepEqual(listCompleted(2033, 11).rows, []);
      assert.deepEqual(listCompleted(2033, 12).rows.map((x) => x.id), [id]);
      assert.equal(new Date(orderRow(id).created_at).toISOString(), "2033-11-20T08:00:00.000Z", "the creation date is untouched");
    });

    it("a cost edited much later updates the profit of the COMPLETION month and leaves the completion date and month alone", () => {
      const id = mkOrder({ total: 90000 });
      const eid = addCost(id, cost({ amount_minor: 30000 }));
      completeV1(id);
      placeInTime(id, { created: "2034-11-20T08:00:00Z", completed: "2034-12-03T09:00:00Z" });
      assert.equal(bucket(report(2034), 12).profit_minor, 60000);
      commit(`select admin.edit_order_cost('${eid}', 1, 'components', 'Graphics card purchase', 36000, 'actual', null, '2035-01-12', null, 'the supplier added a handling fee in January');`);
      assert.equal(bucket(report(2034), 12).profit_minor, 54000, "December 2034 now shows the corrected profit");
      assert.equal(report(2035).period.completed_orders, 0, "nothing moved into January");
      assert.equal(new Date(orderRow(id).completed_at).toISOString(), "2034-12-03T09:00:00.000Z");
      assert.equal(costsOf(id).entries[0].incurred_on, "2035-01-12", "the cost keeps its own date");
    });

    it("DEPOSITS ARE NOT REVENUE: the order's net revenue counts once, in the completion month; cash is reported separately by payment date; a later reversal does not erase revenue", () => {
      const id = mkOrder({ total: 100000 });
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      commit(`select admin.record_payment('${id}', 'deposit', 15000, 'cash');`);
      commit(`select admin.record_payment('${id}', 'balance', 85000, 'cash');`);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
      placeInTime(id, { created: "2036-05-01T08:00:00Z", completed: "2036-06-10T09:00:00Z" });
      const [deposit, balance] = lines(scalar(`select string_agg(id::text, ',' order by amount_minor) from public.payments where order_id = '${id}'`).replaceAll(",", "\n"));
      rewrite(`update public.payments set received_at = '2036-05-20T10:00:00Z' where id = '${deposit}'; update public.payments set received_at = '2036-06-09T10:00:00Z' where id = '${balance}';`);
      const r = report(2036);
      assert.equal(bucket(r, 5).net_revenue_minor, 0, "the deposit month has no revenue");
      assert.equal(bucket(r, 5).cash_received_minor, 15000, "but it has the cash, by payment date");
      assert.equal(bucket(r, 6).net_revenue_minor, 100000, "revenue is counted once, not 15,000 + 85,000 + 100,000");
      assert.equal(bucket(r, 6).cash_received_minor, 85000);
      assert.equal(r.period.net_revenue_minor, 100000);
      assert.equal(r.period.cash_received_minor, 100000);
      // the balance bounces after completion: revenue stays recognised, the money owed shows up
      commit(`select admin.reverse_payment('${balance}', 'the bank returned the transfer');`);
      const after = report(2036);
      assert.equal(bucket(after, 6).net_revenue_minor, 100000);
      assert.equal(bucket(after, 6).completed_orders, 1);
      assert.equal(bucket(after, 6).outstanding_balance_minor, 85000, "the completed order owes 85,000 again, visibly");
    });

    it("REVENUE IS THE NET PAYABLE AT COMPLETION, NOT CASH: an order delivered with only its deposit paid recognizes its whole net revenue, shows the rest as still owed, and is not changed when the balance is paid later", () => {
      const cust = newCustomer();
      commit(`select admin.adjust_loyalty('${cust}', 100, 'points');`);
      // gross 2,000.00; discount 100.00 and 100 points redeemed -> net payable well below gross; the deposit is taken from the GROSS (15 percent = 300.00)
      const id = mkOrder({ customer: cust, total: 200000, discount: { mode: "fixed", amount_minor: 10000, reason: "owner discount for the test" }, points: 100 });
      const net = Number(scalar(`select net_payable_minor from public.orders where id = '${id}'`));
      assert.ok(net < 200000 - 10000, "the loyalty credit lowers it further");
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      commit(`select admin.record_payment('${id}', 'deposit', 30000, 'cash');`);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
      placeInTime(id, { created: "2041-02-01T09:00:00Z", completed: "2041-02-20T09:00:00Z" });
      // the deposit was received on 5 February 2041 (the payment date is its own date; arranged like the completion date above)
      rewrite(`update public.payments set received_at = timestamptz '2041-02-05 09:00:00+00' where order_id = '${id}';`);
      const completion = J(`select to_jsonb(c) from private.order_completions c where order_id = '${id}'`, AS.superuser ?? AS.olivia);
      assert.equal(completion.net_revenue_minor, net, "revenue is the net payable: not the 300.00 received, not the gross");
      assert.equal(completion.gross_minor, 200000);
      const r = report(2041, 2);
      assert.equal(r.period.net_revenue_minor, net);
      assert.equal(r.period.cash_received_minor, 30000, "cash is its own figure");
      assert.equal(r.period.outstanding_balance_minor, net - 30000, "the unpaid part is reported as still owed");
      // the rest is paid later: revenue does not move, the owed amount goes to zero, and the cash figure follows the payment date
      commit(`select admin.record_payment('${id}', 'balance', ${net - 30000}, 'cash');`);
      const after = report(2041, 2);
      assert.equal(after.period.net_revenue_minor, net, "paying later never changes recognized revenue");
      assert.equal(after.period.outstanding_balance_minor, 0);
    });

    it("MORE THAN 100 ORDERS: the figures, the month list and the paging are computed in the database over all of them, not over a page", () => {
      const customer = newCustomer();
      const n = 130;
      rewrite(`
        insert into public.orders (id, customer_id, status, total_minor, created_at, completed_at)
          select gen_random_uuid(), '${customer}', 'delivered', 100000, timestamptz '2037-03-01 08:00:00+00' + (g * interval '1 hour'),
                 timestamptz '2037-04-10 06:00:00+00' + (g * interval '1 hour') from generate_series(1, ${n}) g;
        insert into private.order_completions (order_id, completed_at, basis, gross_minor, discount_minor, loyalty_credit_minor, net_revenue_minor)
          select id, completed_at, 'transition', total_minor, 0, 0, total_minor from public.orders where customer_id = '${customer}';
        insert into private.order_costs (order_id, category, description, amount_minor, cost_kind, incurred_on)
          select o.id, 'components', 'bulk cost', 40000, 'actual', date '2037-04-10' from (select id from public.orders where customer_id = '${customer}' order by created_at limit 40) o;`);
      const r = report(2037, 4);
      assert.equal(r.period.completed_orders, n);
      assert.equal(r.period.net_revenue_minor, n * 100000);
      assert.equal(r.period.orders_costs_incomplete, 40);
      assert.equal(r.period.orders_costs_missing, 90);
      assert.equal(r.period.profit_minor, 40 * (100000 - 40000));
      assert.equal(r.period.revenue_without_costs_minor, 90 * 100000);
      const third = listCompleted(2037, 4, AS.olivia, 50, 100);
      assert.equal(third.total, n);
      assert.equal(third.rows.length, 30);
      assert.equal(listCompleted(2037, 4, AS.olivia, 50, 0).rows.length, 50);
      const operational = J(`select admin.list_orders(null, null, 100, 0)`, AS.sam);
      assert.ok(operational.length <= 100 && n > 100, "the operational list is a page of 100; the report is not");
      // every order is listed exactly once across the pages
      const ids = new Set();
      for (let offset = 0; offset < n; offset += 50) for (const row of listCompleted(2037, 4, AS.olivia, 50, offset).rows) ids.add(row.id);
      assert.equal(ids.size, n);
    });

    it("ANNUAL AGGREGATION: a January-December table whose months add up exactly to the year; the year list and the default year are right", () => {
      const totals = [11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 21000, 22000, 23000];
      totals.forEach((total, i) => completedAt(`2038-${String(i + 1).padStart(2, "0")}-10T09:00:00Z`, { total }));
      const r = report(2038);
      assert.equal(r.months.length, 12);
      r.months.forEach((m, i) => assert.equal(m.net_revenue_minor, totals[i]));
      const sum = (key) => r.months.reduce((acc, m) => acc + m[key], 0);
      for (const key of ["completed_orders", "gross_minor", "net_revenue_minor", "actual_cost_minor", "cash_received_minor"]) assert.equal(r.period[key], sum(key), key);
      assert.equal(r.period.net_revenue_minor, totals.reduce((a, b) => a + b, 0));
      const month = report(2038, 6);
      assert.equal(month.period.net_revenue_minor, 16000);
      assert.equal(month.months.length, 12, "the year table is always whole, whatever month is selected");
      assert.ok(r.years.includes(2038) && r.years.includes(2037) && r.years.includes(2031));
      const currentQatarYear = Number(scalar(`select extract(year from now() at time zone 'Asia/Qatar')`));
      assert.equal(report(null).year, currentQatarYear, "the default year is the current calendar year in Qatar");
      assert.ok(report(null).years.includes(currentQatarYear));
      db.denied(`${AS.olivia}select admin.financial_report(1999, null);`, "", /between 2020 and 2100/);
      db.denied(`${AS.olivia}select admin.financial_report(2038, 13);`, "", /1 to 12/);
    });

    it("the Overview: active orders do not depend on the year; completed orders and the financial block do; staff without finance.read get the first, not the second", () => {
      const o2038 = J(`select admin.overview_summary(2038)`);
      const o2031 = J(`select admin.overview_summary(2031)`);
      assert.equal(o2038.active_orders, o2031.active_orders);
      assert.equal(o2038.completed_orders, 12);
      assert.equal(o2038.financial.net_revenue_minor, report(2038).period.net_revenue_minor);
      assert.equal(o2038.financial.profit_state, "unavailable");
      assert.equal(o2038.financial.profit_minor, null, "no cost recorded: the profit is not invented");
      assert.equal(o2038.financial.orders_costs_missing, 12);
      const staffView = J(`select admin.overview_summary(2038)`, AS.sam);
      assert.equal(staffView.completed_orders, 12);
      assert.equal(staffView.financial, undefined);
      assert.equal(staffView.active_orders, o2038.active_orders);
      assert.equal(count(`select count(*) from public.orders where status not in ('delivered', 'cancelled')`), o2038.active_orders);
    });

    it("the completed-order list is keyed by completed_at; money columns need finance.read and are simply absent without it", () => {
      const own = listCompleted(2038, 6);
      assert.equal(own.finance, true);
      assert.equal(own.rows[0].cost_state, "missing");
      assert.equal(own.rows[0].profit_minor, null);
      const staff = listCompleted(2038, 6, AS.sam);
      assert.equal(staff.finance, false);
      for (const key of ["actual_cost_minor", "estimated_cost_minor", "cost_state", "profit_minor", "margin_bps"]) assert.ok(!(key in staff.rows[0]), `staff must not receive ${key}`);
      assert.equal(staff.rows[0].net_revenue_minor, 16000);
    });
  });

  // =================================================================================================================
  describe("E. an order with optional private costs, in one transaction", () => {
    const itemsJson = JSON.stringify(ONE(100000));
    const costed = (key, costs, who = OLIVIA, customer = ID.custA) => h.viaGateway(who, "create_order_costed", [customer, itemsJson, null, null, key, null, 0, 100000, 15000, costs ? JSON.stringify(costs) : null]);

    it("costs are optional: an order is created without them, and with them the entries, their revisions and the incomplete state exist from the first moment", () => {
      const plain = mkOrder();
      assert.equal(costsOf(plain).summary.cost_state, "missing");
      const id = mkOrder({ costs: [cost({ cost_kind: "estimated", amount_minor: 70000 }), cost({ category: "international_shipping", cost_kind: "estimated", amount_minor: 5000, supplier_ref: "DHL-1", incurred_on: "2026-11-30", notes: "quoted" })] });
      const v = costsOf(id);
      assert.equal(v.summary.entries, 2);
      assert.equal(v.summary.estimated_cost_minor, 75000);
      assert.equal(v.summary.cost_state, "incomplete");
      assert.equal(v.entries.find((e) => e.category === "international_shipping").incurred_on, "2026-11-30");
      assert.equal(v.revisions.filter((r) => r.action === "created").length, 2);
      assert.match(v.revisions[0].reason, /entered when the order was created/);
      // QAR 0.00 and an empty list are both "no costs entered": nothing is invented
      assert.equal(costsOf(mkOrder({ costs: [] })).summary.entries, 0);
    });

    it("the audit log gets the NUMBER of cost entries and never an amount", () => {
      mkOrder({ costs: [cost({ amount_minor: 4_242_424 })] });
      const rows = scalar(`select string_agg(details::text, ' ') from private.audit_log where action in ('order.costs_entered', 'order.cost_added', 'order.created')`);
      assert.ok(!rows.includes("4242424"));
      assert.match(scalar(`select details::text from private.audit_log where action = 'order.costs_entered' order by id desc limit 1`), /"entries": 1/);
    });

    it("a person without finance.manage who sends costs is REFUSED and no order is created; the same person can still create an ordinary order", () => {
      const before = count(`select count(*) from public.orders`);
      db.denied(`${AS.sam}select admin.create_order('${ID.custA}', '${itemsJson}'::jsonb, null::uuid, 'admin', null, null, null, null::jsonb, 0::bigint, null::bigint, null::bigint, '${JSON.stringify([cost()])}'::jsonb);`, "", /permission denied: finance.manage is required/);
      assert.equal(count(`select count(*) from public.orders`), before);
      const ok = mkOrder({ who: AS.sam });
      assert.equal(orderRow(ok).status, "pending_confirmation");
      assert.equal(costsOf(ok).summary.entries, 0);
    });

    it("one bad cost entry stops the whole order: no order, no costs, no discount, no points spent", () => {
      const customer = newCustomer();
      commit(`select admin.adjust_loyalty('${customer}', 100, 'points');`);
      const before = [count(`select count(*) from public.orders`), count(`select count(*) from private.order_costs`), count(`select count(*) from public.loyalty_ledger`)];
      db.denied(`${AS.olivia}select admin.create_order('${customer}', '${itemsJson}'::jsonb, null::uuid, 'admin', null, null, null, '${JSON.stringify({ mode: "fixed", amount_minor: 1000, reason: "owner discount" })}'::jsonb, 50::bigint, null::bigint, null::bigint, '${JSON.stringify([cost(), cost({ category: "nope" })])}'::jsonb);`, "", /choose a category/);
      assert.deepEqual([count(`select count(*) from public.orders`), count(`select count(*) from private.order_costs`), count(`select count(*) from public.loyalty_ledger`)], before);
    });

    it("A RETRY (same key) creates one order and saves the costs once; the same key with different costs is refused; the earlier signature's retry is still recognised", () => {
      const key = newKey("costed");
      const first = costed(key, [cost({ amount_minor: 5000 })]);
      assert.ok(first.ok, first.err);
      assert.equal(first.replayed, false);
      const again = costed(key, [cost({ amount_minor: 5000 })]);
      assert.ok(again.ok, again.err);
      assert.equal(again.replayed, true);
      assert.equal(again.id, first.id);
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${first.id}'`), 1, "the costs were saved once");
      const different = costed(key, [cost({ amount_minor: 6000 })]);
      assert.equal(different.ok, false);
      assert.equal(different.code, "M1K01");
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${first.id}'`), 1);
      // an order made WITHOUT costs by the 11-argument statement is recognised as the same request by the 12-argument one
      const key2 = newKey("plain");
      const viaOld = h.viaGateway(OLIVIA, "create_order_priced", [ID.custA, itemsJson, null, null, key2, null, 0, 100000, 15000]);
      assert.ok(viaOld.ok, viaOld.err);
      const viaNew = costed(key2, null);
      assert.ok(viaNew.ok, viaNew.err);
      assert.equal(viaNew.id, viaOld.id);
      assert.equal(viaNew.replayed, true);
    });

    it("the earlier statements are untouched: the 6-, 7- and 11-argument create_order still exist with their own privileges and behave as before", () => {
      for (const f of ["admin.create_order(uuid, jsonb, uuid, text, text, text)", "admin.create_order(uuid, jsonb, uuid, text, text, text, text)", "admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)"]) {
        assert.equal(scalar(`select to_regprocedure('${f}') is not null`), "t", f);
        assert.equal(scalar(`select has_function_privilege('m1_staff_gateway', '${f}', 'execute')`), "t", f);
      }
      const r = h.viaGateway(OLIVIA, "create_order_priced", [ID.custA, itemsJson, null, null, newKey("old"), null, 0, 100000, 15000]);
      assert.ok(r.ok, r.err);
      assert.equal(costsOf(r.id).summary.entries, 0);
    });
  });

  // =================================================================================================================
  describe("F. the customer's order history for staff: amounts, items and an exact, deterministic net price per line", () => {
    // An independent oracle for the largest-remainder spreading.
    const allocate = (reduction, weights) => {
      const base = weights.reduce((a, b) => a + b, 0n);
      if (reduction === 0n) return weights.map(() => 0n);
      const parts = weights.map((w, i) => ({ i, share: (reduction * w) / base, rem: (reduction * w) % base }));
      let left = reduction - parts.reduce((a, p) => a + p.share, 0n);
      const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
      const extra = new Set(order.slice(0, Number(left)).map((p) => p.i));
      return parts.map((p) => p.share + (extra.has(p.i) ? 1n : 0n));
    };

    it("the spreading is exact for 250 random orders: the lines add up to the net payable amount to the last unit, none goes below zero, and it matches an independent implementation", () => {
      let seed = 20261124;
      const rnd = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const cases = [];
      for (let k = 0; k < 250; k += 1) {
        const n = 1 + rnd(8);
        const weights = Array.from({ length: n }, () => BigInt(rnd(4) === 0 ? 0 : 1 + rnd(2_000_000)));
        if (weights.every((w) => w === 0n)) weights[0] = 1n + BigInt(rnd(1000));
        const total = weights.reduce((a, b) => a + b, 0n);
        const discount = BigInt(rnd(5) === 0 ? 0 : rnd(Number(total) + 1));
        const credit = BigInt(rnd(3) === 0 ? 0 : rnd(Number(total - discount) + 1));
        cases.push({ weights, discount, credit });
      }
      const sqlFor = ({ weights, discount, credit }) => {
        const w = `array[${weights.join(",")}]::bigint[]`;
        return `with d as (select private.allocate_reduction(${discount}, ${w}) as a)
                select a::text, private.allocate_reduction(${credit}, (select array_agg(w - a[i] order by i) from unnest(${w}) with ordinality t(w, i), d)) ::text from d;`;
      };
      const out = lines(db.ok(cases.map(sqlFor).join("\n")));
      assert.equal(out.length, cases.length);
      const parse = (text) => text.replace(/[{}]/g, "").split(",").filter(Boolean).map(BigInt);
      cases.forEach((c, k) => {
        const [aText, bText] = out[k].split("|");
        const d = parse(aText);
        const cr = parse(bText);
        assert.deepEqual(d, allocate(c.discount, c.weights), `discount case ${k}`);
        const rest = c.weights.map((w, i) => w - d[i]);
        assert.deepEqual(cr, allocate(c.credit, rest), `credit case ${k}`);
        c.weights.forEach((w, i) => assert.ok(w - d[i] - cr[i] >= 0n, `line ${i} of case ${k} stays at or above zero`));
        assert.equal(c.weights.reduce((a, b) => a + b, 0n) - c.discount - c.credit, c.weights.reduce((acc, w, i) => acc + (w - d[i] - cr[i]), 0n), `case ${k} reconciles to the net payable amount`);
      });
    });

    it("an order's lines carry their share of the discount and the credit, add up to the net payable amount, and the original line prices are never touched", () => {
      const cust = newCustomer();
      commit(`select admin.adjust_loyalty('${cust}', 150, 'points');`);
      const items = [
        { kind: "component", description: "Graphics card", quantity: 1, unit_price_minor: 30000 },
        { kind: "component", description: "Memory", quantity: 2, unit_price_minor: 10000 },
        { kind: "build_service", description: "Assembly and testing", quantity: 1, unit_price_minor: 50000 },
      ];
      const id = mkOrder({ customer: cust, items, discount: { mode: "fixed", amount_minor: 10000, reason: "InternalReasonSentinel" }, points: 150 });
      const page = J(`select admin.customer_orders('${cust}', 25, 0)`);
      const o = page.orders[0];
      assert.equal(o.id, id);
      assert.equal(o.gross_minor, 100000);
      assert.equal(o.discount_minor, 10000);
      assert.equal(o.loyalty_credit_minor, 1500);
      assert.equal(o.net_payable_minor, 88500);
      assert.deepEqual(o.items.map((i) => [i.position, i.line_total_minor, i.discount_share_minor, i.credit_share_minor, i.net_line_minor]), [
        [1, 30000, 3000, 450, 26550], [2, 20000, 2000, 300, 17700], [3, 50000, 5000, 750, 44250],
      ]);
      assert.equal(o.items.reduce((a, i) => a + i.net_line_minor, 0), o.net_payable_minor);
      assert.deepEqual(scalar(`select string_agg(unit_price_minor::text || '/' || line_total_minor::text, ',' order by position) from public.order_items where order_id = '${id}'`), "30000/30000,10000/20000,50000/50000");
      // an uneven case that needs the remainder rule: 100 off three equal lines of 100 -> 34 / 33 / 33, in line order
      const odd = mkOrder({ customer: cust, items: [1, 2, 3].map((n) => ({ kind: "component", description: `Part ${n}`, quantity: 1, unit_price_minor: 100 })), discount: { mode: "fixed", amount_minor: 100, reason: "owner discount for the test" } });
      const oddLines = J(`select admin.customer_orders('${cust}', 25, 0)`).orders.find((x) => x.id === odd).items;
      assert.deepEqual(oddLines.map((i) => i.discount_share_minor), [34, 33, 33]);
      assert.deepEqual(oddLines.map((i) => i.net_line_minor), [66, 67, 67]);
    });

    it("an order with no discount and no credit shows net = gross on every line; an earlier order with a legacy discount line is shown as it was sold", () => {
      const id = mkOrder({ total: 40000, customer: ID.custB });
      const o = J(`select admin.customer_orders('${ID.custB}', 25, 0)`).orders.find((x) => x.id === id);
      assert.deepEqual(o.items.map((i) => i.net_line_minor), [40000]);
      assert.equal(o.net_payable_minor, o.gross_minor);
      const legacy = lines(db.commit(`${AS.olivia}select admin.create_order('${ID.custB}', '${JSON.stringify([
        { kind: "component", description: "Card", quantity: 1, unit_price_minor: 90000 }, { kind: "discount", description: "Legacy discount line", quantity: 1, unit_price_minor: -10000 }])}'::jsonb);`)).pop().trim();
      const lo = J(`select admin.customer_orders('${ID.custB}', 50, 0)`).orders.find((x) => x.id === legacy);
      assert.equal(lo.gross_minor, 80000, "the earlier order's total is what it always was");
      assert.deepEqual(lo.items.map((i) => i.net_line_minor), [90000, -10000], "its own lines are shown untouched");
      assert.equal(lo.items.reduce((a, i) => a + i.net_line_minor, 0), lo.net_payable_minor);
    });

    it("what the staff screen needs per order: status and type, original total, discount, credit, the FINAL payable, what was actually paid, what is still owed, created and completion dates; payments only for payments.read; no internal reason, no cost", () => {
      const cust = newCustomer();
      commit(`select admin.adjust_loyalty('${cust}', 100, 'points');`);
      const id = mkOrder({ customer: cust, total: 100000, discount: { mode: "fixed", amount_minor: 5000, reason: "InternalReasonSentinel" }, points: 100, costs: [cost({ supplier_ref: COST_SUPPLIER, amount_minor: COST_AMOUNT })] });
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      commit(`select admin.record_payment('${id}', 'deposit', 15000, 'cash', now(), 'RCPT-HIST-1', null, null);`);
      let o = J(`select admin.customer_orders('${cust}', 25, 0)`).orders[0];
      assert.equal(o.status, "awaiting_deposit");
      assert.equal(o.net_payable_minor, 100000 - 5000 - 1000);
      assert.equal(o.amount_paid_minor, 15000, "only the cash actually received counts as paid");
      assert.equal(o.balance_due_minor, 94000 - 15000);
      assert.equal(o.completed_at, null);
      assert.equal(o.payments.length, 1);
      assert.equal(o.payments[0].receipt_number, "RCPT-HIST-1");
      assert.ok(o.payments.every((p) => p.method !== "loyalty"), "the loyalty credit is not a payment");
      payFull(id);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
      o = J(`select admin.customer_orders('${cust}', 25, 0)`).orders[0];
      assert.ok(o.completed_at);
      assert.equal(o.balance_due_minor, 0);
      assert.ok(o.history.length >= 6 && o.history.at(-1).to_status === "delivered");
      // staff without payments.read: no payments key; nobody gets the internal discount reason or any cost
      const staff = J(`select admin.customer_orders('${cust}', 25, 0)`, AS.sam);
      assert.equal(staff.orders[0].payments, undefined);
      for (const body of [JSON.stringify(staff), JSON.stringify(o)]) {
        assert.ok(!body.includes("InternalReasonSentinel") && !body.includes(COST_SUPPLIER) && !body.includes(String(COST_AMOUNT)), "no internal reason, no supplier, no cost");
      }
      db.denied(`select admin.customer_orders('${cust}', 25, 0);`, AS.alice, /permission denied/);
      db.denied(`select admin.customer_orders('${cust}', 25, 0);`, AS.anon, /permission denied|ERROR/);
    });

    it("the history is paged in the database: a customer with 60 orders is read 25 at a time, newest first, with the total", () => {
      const cust = newCustomer();
      rewrite(`insert into public.orders (customer_id, status, total_minor, created_at) select '${cust}', 'pending_confirmation', 1000 + g, now() - (g * interval '1 hour') from generate_series(1, 60) g;`);
      const first = J(`select admin.customer_orders('${cust}', 25, 0)`);
      const last = J(`select admin.customer_orders('${cust}', 25, 50)`);
      assert.equal(first.total, 60);
      assert.equal(first.orders.length, 25);
      assert.equal(last.orders.length, 10);
      assert.ok(first.orders[0].created_at > first.orders[24].created_at);
    });
  });

  // =================================================================================================================
  describe("G. everything that existed before is unchanged", () => {
    const MIGRATIONS = ["20261124120000_order_costs_and_completion_schema.sql", "20261124120100_financial_reporting_functions.sql"];
    const count0 = (database, sql) => Number(lines(database.cluster.psql(sql).out).pop());
    it("applying both migrations to a database that already holds orders, payments, a discount, points and a delivered order changes none of them; only the delivered order gains its PROVEN date", () => {
      const own = startDatabase({ schedule: "confirmed", before: MIGRATIONS[0] });
      try {
        seedIdempotencyFixtures(own);
        const run = (script, who = AS.olivia) => own.commit(`${who}${script}`);
        const mk = (items, customer = ID.custA) => lines(run(`select admin.create_order('${customer}', '${JSON.stringify(items)}'::jsonb) as o;`)).pop().trim();
        const walk = (id, total) => {
          run(`select admin.transition_order('${id}', 'awaiting_deposit');`);
          run(`select admin.record_payment('${id}', 'deposit', ${Math.ceil(total * 0.15)}, 'cash');`);
          run(`select admin.record_payment('${id}', 'balance', ${total - Math.ceil(total * 0.15)}, 'cash');`);
          for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) run(`select admin.transition_order('${id}', '${to}');`);
        };
        const delivered = mk(ONE(120000));
        walk(delivered, 120000);
        const open = mk(ONE(50000), ID.custB);
        run(`select admin.transition_order('${open}', 'awaiting_deposit');`);
        run(`select admin.record_payment('${open}', 'deposit', 7500, 'fawran');`);
        run(`select admin.adjust_loyalty('${ID.custB}', 40, 'seed points');`);
        const digest = () => {
          const r = own.cluster.psql(`select concat_ws('|',
          (select md5(coalesce(string_agg((to_jsonb(o) - 'completed_at' - 'updated_at')::text, '|' order by o.id), '')) from public.orders o),
          (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.payments p),
          (select md5(coalesce(string_agg(to_jsonb(d)::text, '|' order by d.payment_id), '')) from private.payment_details d),
          (select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.loyalty_ledger l),
          (select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) from public.order_items i),
          (select md5(coalesce(string_agg(to_jsonb(h)::text, '|' order by h.id), '')) from private.order_status_history h),
          (select md5(coalesce(string_agg((to_jsonb(b) - 'updated_at')::text, '|' order by b.key), '')) from private.business_policies b),
          (select md5(coalesce(string_agg(to_jsonb(v)::text, '|' order by v.key, v.version), '')) from private.business_policy_versions v));`);
          assert.ok(r.ok, `the digest query failed: ${r.err}`);
          return lines(r.out).pop();
        };
        const before = digest();
        assert.match(before ?? "", /^[0-9a-f]{32}(\|[0-9a-f]{32}){7}$/, "the digest really was computed (eight table digests), so the comparison below cannot pass on nothing");
        assert.ok(count0(own, "select count(*) from public.orders") >= 2 && count0(own, "select count(*) from public.payments") >= 3);
        const proof = lines(own.cluster.psql(`select changed_at from private.order_status_history where order_id = '${delivered}' and to_status = 'delivered' and from_status is distinct from to_status order by id limit 1;`).out).pop();
        for (const f of MIGRATIONS) {
          const r = own.cluster.psql(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
          assert.ok(r.ok, `${f}: ${r.err}`);
        }
        assert.match(digest() ?? "", /^[0-9a-f]{32}(\|[0-9a-f]{32}){7}$/);
        assert.equal(digest(), before, "orders, payments, payment details, points, items, status history and policies are byte-for-byte what they were");
        const row = (id) => JSON.parse(lines(own.cluster.psql(`select to_jsonb(o)::text from public.orders o where id = '${id}'`).out).pop());
        assert.equal(row(delivered).completed_at.replace("T", " ").replace("+00:00", "+00"), proof.replace("+00", "+00"), "the delivered order's date is the status history's own moment");
        assert.equal(row(open).completed_at, null);
        assert.equal(row(delivered).total_minor, 120000);
        assert.equal(row(delivered).amount_paid_minor, 120000);
        assert.equal(lines(own.cluster.psql(`select count(*) from private.order_completions;`).out).pop(), "1");
        // and a second run changes nothing (the migrations are rerunnable)
        for (const f of MIGRATIONS) assert.ok(own.cluster.psql(readFileSync(join(ROOT, "supabase/migrations", f), "utf8")).ok, f);
        assert.equal(digest(), before);
      } finally {
        own.stop();
      }
    });

    it("the five deposit tiers, fixed deposits, discounts and redemptions behave exactly as before a cost or a completion date exists", () => {
      const cust = newCustomer();
      commit(`select admin.adjust_loyalty('${cust}', 100, 'points');`);
      const id = mkOrder({ customer: cust, total: 1500001, discount: { mode: "fixed", amount_minor: 100000, reason: "owner discount for the test" }, points: 100, costs: [cost({ amount_minor: 1 })] });
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      const o = orderRow(id);
      assert.equal(o.deposit_required_minor, 900001, "60 percent of the ORIGINAL gross, not of the net");
      assert.equal(o.deposit_rate_bps, 6000);
      assert.equal(o.net_payable_minor, 1500001 - 100000 - 1000);
      assert.equal(count(`select count(*) from public.loyalty_ledger where order_id = '${id}' and entry_type = 'redemption'`), 1);
      // costs and completion never touch the deposit, the totals or the ledger
      addCost(id, cost({ amount_minor: 99 }));
      assert.equal(orderRow(id).deposit_required_minor, 900001);
      assert.equal(orderRow(id).total_minor, 1500001);
    });
  });

  // =================================================================================================================
  describe("H. the website's gateway statements (as the staff gateway role) and concurrency", () => {
    it("the finance statements work through the gateway for the owner, and are refused for ordinary staff with the permission error the website maps", () => {
      const id = mkOrder({ total: 100000 });
      const entryId = randomUUID();
      const params = [id, entryId, "components", "Card", 25000, "actual", "REF-1", "2026-11-24", "note"];
      const first = h.viaGateway(OLIVIA, "add_order_cost", params);
      assert.ok(first.ok, first.err);
      assert.equal(first.id, entryId);
      assert.equal(first.replayed, false);
      assert.equal(h.viaGateway(OLIVIA, "add_order_cost", params).replayed, true, "the same form sent again saves nothing and says so");
      assert.equal(h.viaGateway(SAM, "add_order_cost", [id, randomUUID(), ...params.slice(2)]).code, "42501");
      assert.equal(h.viaGateway(SAM, "order_costs", [id]).code, "42501");
      assert.equal(h.viaGateway(SAM, "financial_report", [null, null]).code, "42501");
      const read = h.viaGateway(OLIVIA, "order_costs", [id]);
      assert.ok(read.ok);
      const edit = h.viaGateway(OLIVIA, "edit_order_cost", [entryId, 1, "components", "Card", 26000, "actual", "REF-1", "2026-11-24", "note", "invoice corrected"]);
      assert.ok(edit.ok, edit.err);
      assert.equal(edit.id, "2");
      assert.equal(h.viaGateway(OLIVIA, "edit_order_cost", [entryId, 1, "components", "Card", 26000, "actual", "REF-1", "2026-11-24", "note", "invoice corrected"]).replayed, true);
      const stale = h.viaGateway(OLIVIA, "edit_order_cost", [entryId, 1, "components", "Card", 27000, "actual", "REF-1", "2026-11-24", "note", "another change"]);
      assert.equal(stale.ok, false);
      assert.equal(stale.code, "M1K03");
      const voided = h.viaGateway(OLIVIA, "void_order_cost", [entryId, 2, "entered twice"]);
      assert.ok(voided.ok, voided.err);
      assert.equal(h.viaGateway(OLIVIA, "void_order_cost", [entryId, 2, "entered twice"]).replayed, true);
      assert.ok(h.viaGateway(OLIVIA, "set_order_costs_complete", [id, false, null]).ok);
      for (const [name, args] of [["order_completion", [id]], ["list_completed_orders", [null, null, 10, 0]], ["overview_summary", [null]], ["customer_orders", [ID.custA, 5, 0]]]) {
        assert.ok(h.viaGateway(SAM, name, args).ok, `${name} works for staff without finance.read`);
      }
      assert.ok(h.viaGateway(OLIVIA, "financial_report", [2026, null]).ok);
      assert.equal(h.viaGateway(SAM, "add_order_cost", params.slice(0, 1).concat(["not-a-uuid"])).ok, false);
    });

    it("two people editing the same entry at the same moment: exactly one edit is saved, the other is told it changed; two adds of the same entry id save one entry", async () => {
      const id = mkOrder({ total: 100000 });
      const entryId = addCost(id, cost({ amount_minor: 1000 }));
      const edit = (amount, reason) => [entryId, 1, "components", "Graphics card purchase", amount, "actual", null, null, null, reason];
      const slow = h.parallel(OLIVIA, "edit_order_cost", edit(2000, "first writer"), { holdSeconds: 1.5 });
      await new Promise((r) => setTimeout(r, 400));
      const quick = await h.parallel(OLIVIA, "edit_order_cost", edit(3000, "second writer"));
      const slowResult = await slow;
      assert.ok(slowResult.ok, slowResult.err);
      assert.equal(quick.ok, false, "the second writer was working from version 1, which no longer exists");
      assert.match(quick.err, /changed by someone else|M1K03/);
      assert.equal(costsOf(id).entries[0].amount_minor, 2000);
      assert.equal(count(`select count(*) from private.order_cost_revisions where cost_id = '${entryId}' and action = 'edited'`), 1);

      const dup = randomUUID();
      const order2 = mkOrder({ total: 100000 });
      const args = [order2, dup, "components", "Card", 500, "actual", null, null, null];
      const a = h.parallel(OLIVIA, "add_order_cost", args, { holdSeconds: 1 });
      await new Promise((r) => setTimeout(r, 300));
      const b = await h.parallel(OLIVIA, "add_order_cost", args);
      const aResult = await a;
      assert.ok(aResult.ok && b.ok, `${aResult.err} ${b.err}`);
      assert.equal(count(`select count(*) from private.order_costs where order_id = '${order2}'`), 1);
    });

    it("a cost edit and a delivery at the same moment do not corrupt each other: the completion date is set once and the cost total is exact", async () => {
      const id = mkOrder({ total: 100000 });
      const entryId = addCost(id, cost({ amount_minor: 4000 }));
      commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
      payFull(id);
      for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery"]) commit(`select admin.transition_order('${id}', '${to}');`);
      const deliver = h.parallel(OLIVIA, "transition_order", [id, "delivered", null], { holdSeconds: 1 });
      await new Promise((r) => setTimeout(r, 300));
      const edit = await h.parallel(OLIVIA, "edit_order_cost", [entryId, 1, "components", "Graphics card purchase", 4500, "actual", null, null, null, "late invoice"]);
      const delivered = await deliver;
      assert.ok(delivered.ok && edit.ok, `${delivered.err} ${edit.err}`);
      assert.equal(count(`select count(*) from private.order_completions where order_id = '${id}'`), 1);
      assert.ok(orderRow(id).completed_at);
      assert.equal(costsOf(id).summary.actual_cost_minor, 4500);
    });
  });
});
