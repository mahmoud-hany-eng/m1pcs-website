// THE WEBSITE THAT IS DEPLOYED TODAY, AGAINST EVERY STATE OF THE PRICING ROLLOUT (PLAT-0005 release review).
//
// The question: after EACH of the three pricing migrations, does the website deployed before this release (commit af498d2) still work against the
// database, with the same answers and the same refusals? The proof is made of two parts that cannot drift apart:
//   1. the deployed website's fixed SQL statements (src/lib/staff/gateway.ts at af498d2: 29 statements) are PINNED byte for byte in
//      support/deployed-staff-statements.json, and this test requires every one of them to still be present, unchanged, in the current gateway
//      (the release only ADDS two statements: create_order_priced and order_pricing_context);
//   2. ONE scripted session of the staff dashboard's real work (create an order with a key, repeat it, conflict it, confirm, pay with keys,
//      overpay, pay as staff, every status move, reads, the loyalty award, a reversal) is run THROUGH THOSE PINNED STATEMENTS, as the gateway role with
//      verified claims, against four disposable PostgreSQL 16 databases:
//        CONTROL = the database as deployed (every migration before the pricing ones),
//        AFTER 1 = plus the schema migration,
//        AFTER 2 = plus the functions migration (the state between "migrations 1 and 2 applied" and "policies applied"),
//        AFTER 3 = plus the policies migration (everything).
//      The transcripts (every success, every refusal and its words) and the answers of the read statements must be identical; the only differences
//      allowed are the ones the release documents on purpose, each asserted below.
// A LOCAL test with synthetic data. It proves the old statements still work against the new database; it does not prove anything about the
// hosted database, which still holds the control state until a migration is applied there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { norm } from "./support/differential.mjs";
import { ONE, lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const DEPLOYED = JSON.parse(readFileSync(join(ROOT, "supabase/tests/support/deployed-staff-statements.json"), "utf8")).statements;
const GATEWAY = readFileSync(join(ROOT, "src/lib/staff/gateway.ts"), "utf8");
const P1 = "20261123120000_pricing_rewards_schema.sql";
const P2 = "20261123120100_pricing_rewards_functions.sql";
const P3 = "20261123120200_pricing_rewards_policies.sql";
// This file proves the PRICING release (three migrations). Later releases are proven in their own files (compat.finance.deployed-statements.db.test.mjs),
// so "everything" here means "everything up to and including the pricing policies": the order-costs migrations are applied by that file's states.
const LATER = "20261124120000_order_costs_and_completion_schema.sql";
/** The statements the LATER release (order costs, completion dates, reports) adds to the gateway. They are not part of the pricing release. */
const LATER_RELEASE_STATEMENTS = [
  "add_order_cost", "create_order_costed", "customer_orders", "edit_order_cost", "financial_report", "list_completed_orders", "order_completion", "order_costs",
  "overview_summary", "set_order_costs_complete", "verify_historical_completion", "void_order_cost",
];
/** The one statement the still later Orders-list release (20261125120000, PLAT-0007) adds: the paged, filtered, sorted list. */
const ORDERS_LIST_RELEASE_STATEMENTS = ["list_orders_page"];
const LATER_STATEMENTS = [...LATER_RELEASE_STATEMENTS, ...ORDERS_LIST_RELEASE_STATEMENTS];

/** Keys the pricing release adds to the read answers (additive; the deployed pages ignore keys they do not know). */
const ADDED_KEYS = new Set([
  "discount_minor", "discount_record", "loyalty_credit_minor", "loyalty_points_redeemed", "net_payable_minor",
  "deposit_outstanding_minor", "cash_balance_after_deposit_minor", "redemption_record",
]);
/** Wording and version that legitimately change once the policy migration (five tiers) is applied. */
const POLICY_KEYS = new Set(["deposit_rule", "deposit_policy_version", "policy_version", "rule", "version", "label", "status_label"]);

function drive(db) {
  seedIdempotencyFixtures(db, { probes: false });
  const h = makeHelpers(db);
  const { OLIVIA, SAM } = h;
  const T = [];
  const reads = {};
  const call = (label, who, name, params, { read = null } = {}) => {
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${h.gatewayCall(who, name, params, DEPLOYED[name])}commit;`);
    const out = r.ok ? (lines(r.out).pop() ?? "").trim() : null;
    const code = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.err ?? "");
    T.push(`${label} => ${r.ok ? `OK ${read ? "(read)" : norm(out)}` : `ERR ${code ? `${code[1]} ${norm(code[2])}` : norm(r.err)}`}`);
    if (read && r.ok) {
      const text = out.split("|")[0];
      try {
        reads[read] = text === "" ? null : JSON.parse(text);
      } catch {
        reads[read] = text; // a bare boolean such as t / f
      }
    }
    return out;
  };
  const idOf = (out) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(out ?? "")?.[0] ?? null;
  const items = (price) => JSON.stringify(ONE(price));
  const pay = (label, who, id, amount, key, purpose = "deposit") => call(label, who, "record_payment", h.payParams(id, amount, key, { purpose, actor: who.sub }));
  const move = (label, who, id, to) => call(label, who, "transition_order", [id, to, "deployed statement test"]);

  call("who am I (owner)", OLIVIA, "is_staff_member", [], { read: "isStaffOwner" });
  call("my permissions (owner)", OLIVIA, "my_permissions", [], { read: "permsOwner" });
  call("my permissions (staff)", SAM, "my_permissions", [], { read: "permsStaff" });
  call("preview the deposit for QAR 2,000.00", SAM, "preview_deposit", [200000], { read: "preview2000" });
  call("search customers", SAM, "search_customers", ["", 25], { read: "customers" });
  call("get a customer", SAM, "get_customer", [ID.custA], { read: "customer" });

  const a = idOf(call("A create (keyed)", SAM, "create_order", [ID.custA, items(200000), null, null, "dep-order-A-0001"]));
  call("A create again, same key (a repeat)", SAM, "create_order", [ID.custA, items(200000), null, null, "dep-order-A-0001"]);
  call("A create, same key, different items (a conflict)", SAM, "create_order", [ID.custA, items(999900), null, null, "dep-order-A-0001"]);
  call("A create with no priced item", SAM, "create_order", [ID.custA, "[]", null, null, "dep-order-A-0002"]);
  call("similar orders", SAM, "similar_orders", [ID.custA, items(200000), "dep-similar-0001"]);
  move("A awaiting_deposit", SAM, a, "awaiting_deposit");
  move("A skip to building (invalid)", SAM, a, "building");
  move("A deposit_received with nothing paid (gate)", SAM, a, "deposit_received");
  pay("A pay the deposit 300.00 (keyed)", OLIVIA, a, 30000, "dep-pay-A-0001");
  pay("A pay again, same key (a repeat)", OLIVIA, a, 30000, "dep-pay-A-0001");
  pay("A pay, same key, other amount (a conflict)", OLIVIA, a, 12345, "dep-pay-A-0001");
  pay("A pay as staff (no payments.record)", SAM, a, 5000, "dep-pay-A-0002");
  pay("A pay beyond the total", OLIVIA, a, 999999999, "dep-pay-A-0003", "balance");
  pay("A pay zero", OLIVIA, a, 0, "dep-pay-A-0004");
  for (const to of ["deposit_received", "sourcing", "in_transit", "building", "quality_check", "building", "quality_check", "ready_for_delivery"]) move(`A ${to}`, SAM, a, to);
  move("A delivered with a balance still due", SAM, a, "delivered");
  pay("A pay the balance 1,700.00 (keyed)", OLIVIA, a, 170000, "dep-pay-A-0005", "balance");
  pay("A pay once it is paid in full (nothing is owed)", OLIVIA, a, 100, "dep-pay-A-0006", "balance");
  move("A delivered", SAM, a, "delivered");
  call("A loyalty list", OLIVIA, "list_loyalty", [ID.custA, 50], { read: "loyalty" });
  const paymentId = lines(db.ok(`select id from public.payments where order_id = '${a}' and purpose = 'balance' and entry_type = 'payment' order by created_at limit 1;`)).pop().trim();
  call("A reverse the balance payment", OLIVIA, "reverse_payment", [paymentId, "deployed statement test reversal"]);

  const b = idOf(call("B create (keyed)", SAM, "create_order", [ID.custA, items(150000), null, null, "dep-order-B-0001"]));
  move("B awaiting_deposit", SAM, b, "awaiting_deposit");
  pay("B pay the deposit", OLIVIA, b, 22500, "dep-pay-B-0001");
  for (const to of ["deposit_received", "sourcing", "on_hold"]) move(`B ${to}`, SAM, b, to);
  move("B resume at the wrong status", SAM, b, "in_transit");
  move("B resume at the right status", SAM, b, "sourcing");
  move("B hold again", SAM, b, "on_hold");
  move("B cancel while held", SAM, b, "cancelled");
  pay("B pay on a cancelled order", OLIVIA, b, 100, "dep-pay-B-0002", "balance");

  call("get order A", OLIVIA, "get_order", [a], { read: "getA" });
  call("get order B", OLIVIA, "get_order", [b], { read: "getB" });
  call("list orders", SAM, "list_orders", [null, null, 100, 0], { read: "list" });
  call("list payments", OLIVIA, "list_payments", [50, 0], { read: "payments" });
  call("dashboard (owner)", OLIVIA, "dashboard_summary", [], { read: "dashOwner" });
  call("dashboard (staff)", SAM, "dashboard_summary", [], { read: "dashStaff" });
  call("policies", OLIVIA, "list_policies", [], { read: "policies" });
  call("audit", OLIVIA, "list_audit", [200], { read: "audit" });
  call("preview the deposit for QAR 12,000.00", SAM, "preview_deposit", [1200000], { read: "preview12000" });

  const digest = (label, sql) => T.push(`STATE ${label}: ${norm(lines(db.ok(`${sql};`)).pop() ?? "").trim()}`);
  digest("orders", "select string_agg(order_ref || ':' || status || ':' || total_minor || ':' || amount_paid_minor || ':' || balance_due_minor, ' | ' order by order_ref) from public.orders");
  digest("payments", "select string_agg(o.order_ref || ':' || p.entry_type || ':' || p.purpose || ':' || p.amount_minor || ':' || p.method || ':' || p.receipt_number, ' | ' order by p.receipt_number, p.id) from public.payments p join public.orders o on o.id = p.order_id");
  digest("loyalty", "select string_agg(entry_type || ':' || points, ' | ' order by created_at, id) from public.loyalty_ledger");
  digest("audit actions", "select string_agg(action || ':' || n, ' | ' order by action) from (select action, count(*) n from private.audit_log group by action) s");
  digest("idempotency keys", "select count(*) || ':' || count(distinct operation) from private.idempotency_keys");
  return { T, reads, ids: { a, b } };
}

/** Removes the wording and the additive keys the release documents, so what is left must be identical. */
function plain(value, { dropPolicyKeys }) {
  if (Array.isArray(value)) return value.map((v) => plain(v, { dropPolicyKeys }));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (ADDED_KEYS.has(k)) continue;
      if (dropPolicyKeys && POLICY_KEYS.has(k)) continue;
      out[k] = plain(v, { dropPolicyKeys });
    }
    return out;
  }
  return value;
}
/** Every key of `after` that is not in `before` (anywhere), as a set of key names. */
function extraKeys(before, after, found = new Set()) {
  if (Array.isArray(after)) after.forEach((v, i) => extraKeys(Array.isArray(before) ? before[i] : undefined, v, found));
  else if (after && typeof after === "object") {
    for (const [k, v] of Object.entries(after)) {
      if (!before || typeof before !== "object" || !(k in before)) found.add(k);
      else extraKeys(before[k], v, found);
    }
  }
  return found;
}
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
const mask = (o) => JSON.parse(norm(JSON.stringify(o)));

suite("the website deployed before the pricing release, run statement by statement against every state of the rollout", () => {
  const states = {};
  const results = {};

  before(() => {
    states.control = startDatabase({ schedule: "confirmed", before: P1 });
    states.after1 = startDatabase({ schedule: "confirmed", before: P2 });
    states.after2 = startDatabase({ schedule: "confirmed", before: P3 });
    states.after3 = startDatabase({ schedule: "confirmed", before: LATER });
    for (const [name, db] of Object.entries(states)) results[name] = drive(db);
  });
  after(() => {
    for (const db of Object.values(states)) db?.stop();
  });

  it("the deployed website's 29 statements are pinned, and every one is still present, unchanged, in the current gateway; the pricing release only ADDS two (and a later release adds its own, listed separately)", () => {
    const pinned = Object.entries(DEPLOYED);
    assert.equal(pinned.length, 29);
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [name, sql] of pinned) {
      assert.ok(new RegExp(`^\\s*${name}: "${escape(sql)}",$`, "m").test(GATEWAY), `statement ${name} is unchanged`);
    }
    const current = [...GATEWAY.matchAll(/^\s*([a-z_]+): "(.+)",$/gm)].map((m) => m[1]).filter((n) => n !== "application_name");
    const added = current.filter((n) => !(n in DEPLOYED)).sort();
    assert.deepEqual(added.filter((n) => !LATER_STATEMENTS.includes(n)), ["create_order_priced", "order_pricing_context"]);
    assert.deepEqual(added.filter((n) => LATER_RELEASE_STATEMENTS.includes(n)), [...LATER_RELEASE_STATEMENTS].sort(), "and every statement of the later release is present");
    assert.deepEqual(added.filter((n) => ORDERS_LIST_RELEASE_STATEMENTS.includes(n)), ORDERS_LIST_RELEASE_STATEMENTS, "and the Orders-list release adds exactly its one");
  });

  it("the control really is the deployed shape (no pricing objects) and the others really have them", () => {
    const has = (db) => lines(db.ok("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'net_payable_minor';")).pop().trim();
    assert.equal(has(states.control), "0");
    for (const name of ["after1", "after2", "after3"]) assert.equal(has(states[name]), "1", name);
    const fn = (db) => lines(db.ok("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and p.proname = 'order_pricing_context';")).pop().trim();
    assert.deepEqual([fn(states.control), fn(states.after1), fn(states.after2), fn(states.after3)], ["0", "0", "1", "1"]);
  });

  it("the script exercised what it claims to: real successes AND real refusals through the pinned statements (not an empty comparison)", () => {
    const T = results.control.T;
    const ok = T.filter((l) => /=> OK/.test(l)).length;
    const err = T.filter((l) => /=> ERR/.test(l)).length;
    assert.ok(ok >= 35 && err >= 10, `${ok} successes, ${err} refusals`);
    for (const must of ["A pay beyond the total", "A pay as staff (no payments.record)", "A create, same key, different items (a conflict)", "B pay on a cancelled order"]) {
      assert.match(T.find((l) => l.startsWith(must)), /=> ERR/, must);
    }
    for (const must of ["A pay the balance 1,700.00 (keyed)", "A reverse the balance payment", "A delivered"]) {
      assert.match(T.find((l) => l.startsWith(must)), /=> OK/, must);
    }
    // a fully settled order is not asked for another payment, in EVERY state
    assert.match(T.find((l) => l.startsWith("A pay once it is paid in full")), /=> ERR \S+ .*exceed/i);
    assert.match(T.find((l) => l.startsWith("STATE loyalty")), /award:/, "the award happened");
  });

  it("every step of the deployed session ends the same way in EVERY state: the same successes, the same refusals, the same words, the same rows", () => {
    for (const name of ["after1", "after2", "after3"]) {
      assert.deepEqual(results[name].T, results.control.T, `${name}: transcript differs from the control`);
    }
  });

  it("the read statements answer identically: every earlier key keeps its value; the answers only GAIN the documented pricing keys", () => {
    for (const name of ["after1", "after2", "after3"]) {
      const dropPolicyKeys = name === "after3";
      for (const key of Object.keys(results.control.reads)) {
        if (key === "preview12000" && dropPolicyKeys) continue; // the five tiers change this amount ON PURPOSE: asserted exactly in the next test
        if (key === "policies" && dropPolicyKeys) continue; // the policy migration changes two policy VALUES on purpose (orders.deposit, loyalty.earning_base): asserted in pricing.db.test.mjs
        if (key === "permsOwner") continue; // the owner's list gains the two new owner-only permissions with migration 1: asserted exactly in the last test
        const before = mask(plain(results.control.reads[key], { dropPolicyKeys }));
        const now = mask(plain(results[name].reads[key], { dropPolicyKeys }));
        assert.equal(stable(now), stable(before), `${name}: read ${key} differs from the control`);
        const extra = extraKeys(results.control.reads[key], results[name].reads[key]);
        for (const k of extra) assert.ok(ADDED_KEYS.has(k), `${name}: read ${key} gained an unexpected key "${k}"`);
      }
    }
  });

  it("INTENDED difference: only AFTER the policy migration does the deposit for QAR 12,000.00 follow the five tiers; every state before it keeps the three", () => {
    const deposit = (name) => results[name].reads.preview12000.deposit_minor ?? results[name].reads.preview12000.amount_minor ?? results[name].reads.preview12000;
    assert.equal(JSON.stringify(deposit("control")), JSON.stringify(deposit("after1")));
    assert.equal(JSON.stringify(deposit("control")), JSON.stringify(deposit("after2")));
    assert.notEqual(JSON.stringify(deposit("control")), JSON.stringify(deposit("after3")));
    const text = (name) => JSON.stringify(results[name].reads.preview12000);
    assert.match(text("control"), /420000/);
    assert.match(text("after3"), /600000/);
    // and below QAR 3,000.00 the two schedules agree on the money (only the wording of the rule and the policy version differ), so the deployed session above could not tell them apart
    const money = (name) => [results[name].reads.preview2000.amount_minor, results[name].reads.preview2000.rate_bps];
    assert.deepEqual(money("after3"), money("control"));
    assert.deepEqual(money("control"), [30000, 1500]);
    assert.equal(results.control.reads.preview2000.policy_version + 1, results.after3.reads.preview2000.policy_version);
  });

  it("the deployed website's staff session gains no right it did not have: the permission lists differ only by the two new owner-only permissions", () => {
    const codes = (name, key) => (results[name].reads[key] ?? []).map((p) => p.permission_code ?? p.code ?? p).sort();
    for (const key of ["permsStaff"]) for (const name of ["after1", "after2", "after3"]) assert.deepEqual(codes(name, key), codes("control", key), `${name} staff permissions`);
    for (const name of ["after1", "after2", "after3"]) {
      const added = codes(name, "permsOwner").filter((p) => !codes("control", "permsOwner").includes(p));
      assert.deepEqual(added, ["loyalty.redeem", "orders.discount"].sort(), `${name}: the owner gains exactly the two new permissions`);
    }
  });
});
