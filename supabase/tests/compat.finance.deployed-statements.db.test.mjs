// THE WEBSITE DEPLOYED TODAY (the Pricing & Rewards Preview, commit 4916867), AGAINST EVERY STATE OF THE ORDER-COSTS ROLLOUT (PLAT-0006).
//
// The question: when the two order-costs migrations are applied to the development database BEFORE the new website is deployed (the order the
// release proposal uses), does the website that is live at that moment keep working, with the same answers and the same refusals?
// The proof has two parts that cannot drift apart:
//   1. the live website's 31 fixed SQL statements (src/lib/staff/gateway.ts at 4916867) are PINNED byte for byte in
//      support/deployed-staff-statements.pricing.json, and every one must still be present, unchanged, in the current gateway;
//   2. ONE scripted session of the staff dashboard's real work (priced order with a discount and redeemed points, keys and repeats, deposit,
//      payments, overpayment, reversal, every move to Delivered, the loyalty award, the reads) is run THROUGH THOSE PINNED STATEMENTS, as the
//      gateway role with verified claims, against three disposable PostgreSQL 16 databases:
//        CONTROL = the database as deployed (every migration before the order-costs ones),
//        AFTER 1 = plus the schema migration (completed_at, the private cost tables, the completion trigger),
//        AFTER 2 = plus the functions migration (everything).
//      The transcripts and the answers of the read statements must be IDENTICAL: this release adds columns and functions, it changes none the live
//      website calls.
// A LOCAL test with synthetic data; it proves nothing about the hosted database, which is unchanged until a migration is applied there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { norm } from "./support/differential.mjs";
import { ONE, lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const PINNED = JSON.parse(readFileSync(join(ROOT, "supabase/tests/support/deployed-staff-statements.pricing.json"), "utf8"));
const DEPLOYED = PINNED.statements;
const GATEWAY = readFileSync(join(ROOT, "src/lib/staff/gateway.ts"), "utf8");
const F1 = "20261124120000_order_costs_and_completion_schema.sql";
const F2 = "20261124120100_financial_reporting_functions.sql";
const NEW_STATEMENTS = [
  "add_order_cost", "create_order_costed", "customer_orders", "edit_order_cost", "financial_report", "list_completed_orders", "order_completion", "order_costs",
  "overview_summary", "set_order_costs_complete", "verify_historical_completion", "void_order_cost",
  // the Orders page's paged list (a later release, one migration of its own; earlier websites never call it)
  "list_orders_page",
];

function drive(db) {
  seedIdempotencyFixtures(db, { probes: false });
  db.commit(`${AS.olivia}select admin.adjust_loyalty('${ID.custA}', 300, 'points for the compatibility session');`);
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
        reads[read] = text;
      }
    }
    return out;
  };
  const idOf = (out) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(out ?? "")?.[0] ?? null;
  const items = (price) => JSON.stringify(ONE(price));
  const pay = (label, who, id, amount, key, purpose = "deposit") => call(label, who, "record_payment", h.payParams(id, amount, key, { purpose, actor: who.sub }));
  const move = (label, who, id, to) => call(label, who, "transition_order", [id, to, "compatibility session"]);
  const discount = JSON.stringify({ mode: "fixed", amount_minor: 10000, reason: "owner discount for the compatibility session" });

  call("who am I (owner)", OLIVIA, "is_staff_member", [], { read: "isStaffOwner" });
  call("my permissions (staff)", SAM, "my_permissions", [], { read: "permsStaff" });
  call("the pricing context for a customer (owner)", OLIVIA, "order_pricing_context", [ID.custA], { read: "context" });
  call("preview the deposit for QAR 2,000.00", SAM, "preview_deposit", [200000], { read: "preview2000" });

  // 2,000.00 gross, 100.00 off, 100 points (QAR 10.00): net 1,900.00; the deposit is 15% of the ORIGINAL 2,000.00 = 300.00
  const a = idOf(call("A create priced (discount and points)", OLIVIA, "create_order_priced", [ID.custA, items(200000), null, null, "fin-order-A-0001", discount, 100, 189000, 30000]));
  call("A create priced again, same key (a repeat)", OLIVIA, "create_order_priced", [ID.custA, items(200000), null, null, "fin-order-A-0001", discount, 100, 189000, 30000]);
  call("A create priced, same key, other points (a conflict)", OLIVIA, "create_order_priced", [ID.custA, items(200000), null, null, "fin-order-A-0001", discount, 50, 189500, 30000]);
  call("A create priced as staff with a discount (owner only)", SAM, "create_order_priced", [ID.custA, items(200000), null, null, "fin-order-A-0002", discount, 0, 190000, 30000]);
  call("A create priced with a stale net amount", OLIVIA, "create_order_priced", [ID.custA, items(200000), null, null, "fin-order-A-0003", null, 0, 123, 30000]);
  call("similar orders", SAM, "similar_orders", [ID.custA, items(200000), "fin-similar-0001"]);
  move("A awaiting_deposit", SAM, a, "awaiting_deposit");
  pay("A pay the deposit 300.00 (keyed)", OLIVIA, a, 30000, "fin-pay-A-0001");
  pay("A pay again, same key (a repeat)", OLIVIA, a, 30000, "fin-pay-A-0001");
  pay("A pay beyond the amount payable", OLIVIA, a, 999999, "fin-pay-A-0002", "balance");
  pay("A pay as staff (no payments.record)", SAM, a, 5000, "fin-pay-A-0003");
  for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery"]) move(`A ${to}`, SAM, a, to);
  move("A delivered with a balance still due", SAM, a, "delivered");
  pay("A pay the balance 1,590.00 (keyed)", OLIVIA, a, 159000, "fin-pay-A-0004", "balance");
  pay("A pay once it is settled", OLIVIA, a, 100, "fin-pay-A-0005", "balance");
  move("A delivered", SAM, a, "delivered");
  move("A cancelled after delivery (not possible)", OLIVIA, a, "cancelled");
  call("A loyalty list", OLIVIA, "list_loyalty", [ID.custA, 50], { read: "loyalty" });
  const paymentId = lines(db.ok(`select id from public.payments where order_id = '${a}' and purpose = 'balance' and entry_type = 'payment' order by created_at limit 1;`)).pop().trim();
  call("A reverse the balance payment", OLIVIA, "reverse_payment", [paymentId, "compatibility session reversal"]);

  const b = idOf(call("B create (keyed, earlier statement)", SAM, "create_order", [ID.custA, items(150000), null, null, "fin-order-B-0001"]));
  move("B awaiting_deposit", SAM, b, "awaiting_deposit");
  move("B cancelled", SAM, b, "cancelled");
  pay("B pay on a cancelled order", OLIVIA, b, 100, "fin-pay-B-0001", "balance");

  call("get order A", OLIVIA, "get_order", [a], { read: "getA" });
  call("get order B", OLIVIA, "get_order", [b], { read: "getB" });
  call("list orders", SAM, "list_orders", [null, null, 100, 0], { read: "list" });
  call("list payments", OLIVIA, "list_payments", [50, 0], { read: "payments" });
  call("dashboard (owner)", OLIVIA, "dashboard_summary", [], { read: "dashOwner" });
  call("dashboard (staff)", SAM, "dashboard_summary", [], { read: "dashStaff" });
  call("get a customer", SAM, "get_customer", [ID.custA], { read: "customer" });
  call("policies", OLIVIA, "list_policies", [], { read: "policies" });
  call("audit", OLIVIA, "list_audit", [200], { read: "audit" });

  const digest = (label, sql) => T.push(`STATE ${label}: ${norm(lines(db.ok(`${sql};`)).pop() ?? "").trim()}`);
  digest("orders", "select string_agg(order_ref || ':' || status || ':' || total_minor || ':' || discount_minor || ':' || loyalty_credit_minor || ':' || deposit_required_minor || ':' || amount_paid_minor || ':' || balance_due_minor, ' | ' order by order_ref) from public.orders");
  digest("payments", "select string_agg(o.order_ref || ':' || p.entry_type || ':' || p.purpose || ':' || p.amount_minor || ':' || p.method || ':' || p.receipt_number, ' | ' order by p.receipt_number, p.id) from public.payments p join public.orders o on o.id = p.order_id");
  digest("loyalty", "select string_agg(entry_type || ':' || points, ' | ' order by created_at, id) from public.loyalty_ledger");
  digest("audit actions", "select string_agg(action || ':' || n, ' | ' order by action) from (select action, count(*) n from private.audit_log group by action) s");
  digest("idempotency keys", "select count(*) || ':' || count(distinct operation) from private.idempotency_keys");
  return { T, reads };
}

suite("the website deployed today (Pricing & Rewards), run statement by statement against every state of the order-costs rollout", () => {
  const states = {};
  const results = {};
  before(() => {
    states.control = startDatabase({ schedule: "confirmed", before: F1 });
    states.after1 = startDatabase({ schedule: "confirmed", before: F2 });
    states.after2 = startDatabase({ schedule: "confirmed" });
    for (const [name, db] of Object.entries(states)) results[name] = drive(db);
  });
  after(() => {
    for (const db of Object.values(states)) db?.stop();
  });

  it("the deployed website's 31 statements are pinned and every one is still present, unchanged, in the current gateway; the release only ADDS its own", () => {
    const pinned = Object.entries(DEPLOYED);
    assert.equal(pinned.length, 31);
    assert.equal(PINNED.commit, "4916867b02948b3d78308f9e9776a0c8929e0f2d");
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [name, sql] of pinned) assert.ok(new RegExp(`^\\s*${name}: "${escape(sql)}",$`, "m").test(GATEWAY), `statement ${name} is unchanged`);
    const current = [...GATEWAY.matchAll(/^\s*([a-z_]+): "(.+)",$/gm)].map((m) => m[1]).filter((n) => n !== "application_name");
    assert.deepEqual(current.filter((n) => !(n in DEPLOYED)).sort(), [...NEW_STATEMENTS].sort());
  });

  it("the control is the deployed shape and the others really have the new objects", () => {
    const has = (db) => lines(db.ok("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'completed_at';")).pop().trim();
    assert.equal(has(states.control), "0");
    for (const name of ["after1", "after2"]) assert.equal(has(states[name]), "1", name);
    const fn = (db) => lines(db.ok("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and p.proname = 'financial_report';")).pop().trim();
    assert.deepEqual([fn(states.control), fn(states.after1), fn(states.after2)], ["0", "0", "1"]);
  });

  it("the script exercised what it claims to: real successes AND real refusals, including a delivered order that cannot be cancelled", () => {
    const T = results.control.T;
    assert.ok(T.filter((l) => /=> OK/.test(l)).length >= 30 && T.filter((l) => /=> ERR/.test(l)).length >= 8);
    for (const must of ["A create priced as staff with a discount", "A create priced with a stale net amount", "A pay beyond the amount payable", "A create priced, same key, other points", "A cancelled after delivery", "B pay on a cancelled order"]) {
      assert.match(T.find((l) => l.startsWith(must)), /=> ERR/, must);
    }
    for (const must of ["A create priced (discount and points)", "A delivered", "A pay the balance 1,590.00 (keyed)", "A reverse the balance payment"]) assert.match(T.find((l) => l.startsWith(must)), /=> OK/, must);
    assert.match(T.find((l) => l.startsWith("STATE orders")), /:10000:1000:30000:/, "the discount and the loyalty credit were recorded, and the deposit comes from the gross");
  });

  it("every step of the live session ends the same way in EVERY state: the same successes, the same refusals, the same words, the same rows", () => {
    for (const name of ["after1", "after2"]) assert.deepEqual(results[name].T, results.control.T, `${name}: transcript differs from the control`);
  });

  it("every read statement answers byte for byte the same in every state (no key added, none removed, none changed)", () => {
    const stable = (o) => JSON.stringify(JSON.parse(norm(JSON.stringify(o))), (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
    for (const name of ["after1", "after2"]) {
      assert.deepEqual(Object.keys(results[name].reads).sort(), Object.keys(results.control.reads).sort());
      for (const key of Object.keys(results.control.reads)) assert.equal(stable(results[name].reads[key]), stable(results.control.reads[key]), `${name}: read ${key}`);
    }
  });
});
