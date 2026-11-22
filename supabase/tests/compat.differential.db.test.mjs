// DIFFERENTIAL compatibility check for the order-workflow migrations (PLAT-0004 final release preparation).
//
// The question: do the two workflow migrations (20261122120000, 20261122120100) change the behaviour of ANY write path that the website
// deployed today relies on? This test answers it WITHOUT using the workflow feature tests: it builds two disposable PostgreSQL databases,
//   CONTROL    = every migration up to and including the idempotency expand (exactly what the hosted development database holds), and
//   TREATMENT  = the same plus the two workflow migrations,
// runs ONE identical script of earlier-workflow business operations against both (keyed and key-less payments and orders, every status
// move, the deposit gate, hold / resume / cancel, loyalty awards and adjustments, payment reversal, tracking publish and withdraw, and the
// refusals for a customer, an inactive staff member, a session without the second factor and a staff member without the permission), and
// requires the two transcripts, the resulting rows and the read functions' earlier fields to be IDENTICAL.
//
// The only differences allowed are the ones the release documents on purpose, each asserted explicitly at the end:
//   (1) the customer wording of five statuses (labels are therefore left out of every comparison),
//   (2) a HELD order's dropdown lists only its resume point and Cancel (the earlier database listed every earlier status, and the
//       transition function refused all but one),
//   (3) additive keys in the read functions' answers, and (4) two more owner-only permissions.
// Identifiers, timestamps and statement line numbers are normalised; amounts, receipts, references, statuses, messages and SQLSTATE texts are not.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, json, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const W1 = "20261122120000_order_workflow_v2_schema.sql";
const W2 = "20261122120100_order_workflow_v2_functions.sql";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TS = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?|Z)?/g;
const norm = (s) => String(s).replace(UUID, "<uuid>").replace(TS, "<ts>");
const lines = (out) => out.split("\n").filter((l) => l !== "");
const one = (price) => [{ kind: "component", description: "Differential test item", quantity: 1, unit_price_minor: price }];

/** Runs the scripted earlier-workflow scenario against one database and returns what happened, in order. */
function scenario(db) {
  const T = [];
  const run = (who, sql) => db.cluster.psql(`begin;\n${who}${sql}\ncommit;`);
  const firstError = (err) => (err.split("\n").find((l) => /ERROR:/.test(l)) ?? err.split("\n")[0]).replace(/^psql:<stdin>:\d+:\s*/, "");
  /** One step: records its outcome (normalised) and returns the raw last line of output on success, else null. */
  const step = (label, who, sql) => {
    const r = run(who, sql);
    const raw = r.ok ? (lines(r.out).pop() ?? "").trim() : null;
    T.push(`${label} => ${r.ok ? `OK ${norm(raw)}` : `ERR ${norm(firstError(r.err))}`}`);
    return raw;
  };
  const q = (sql, who = AS.superuser) => (lines(db.ok(sql.endsWith(";") ? sql : `${sql};`, who)).pop() ?? "").trim();

  const pay = (label, who, id, purpose, amount, method, extra = "") => step(label, who, `select admin.record_payment('${id}', '${purpose}', ${amount}, '${method}'${extra});`);
  const keyedPay = (label, who, id, amount, key, expected) =>
    step(label, who, `select admin.record_payment('${id}', 'deposit', ${amount}, 'cash', null, null, null, null, '${key}', ${expected});`);
  const move = (label, who, id, to) => step(label, who, `select admin.transition_order('${id}', '${to}', 'differential');`);
  const keyedOrder = (label, who, key, price) => step(label, who, `select admin.create_order('${ID.custA}', '${json(one(price))}'::jsonb, null, 'admin', null, null, '${key}');`);

  // ---- order A: the whole earlier path, money, loyalty ---------------------------------------------------------------------
  const a = keyedOrder("A create (keyed)", AS.sam, "diff-order-A-0001", 200000);
  keyedOrder("A create again, same key (a repeat)", AS.sam, "diff-order-A-0001", 200000);
  keyedOrder("A create, same key, different items (a conflict)", AS.sam, "diff-order-A-0001", 999900);
  step("A create as a customer", AS.alice, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-customer-key');`);
  step("A create as inactive staff", AS.dana, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-dana-key');`);
  step("A create without the second factor", AS.oliviaAal1, `select admin.create_order('${ID.custA}', '${json(one(1000))}'::jsonb, null, 'admin', null, null, 'diff-aal1-key');`);
  step("A create with no priced item", AS.sam, `select admin.create_order('${ID.custA}', '[]'::jsonb, null, 'admin', null, null, 'diff-empty-key');`);
  const keyless = step("A create (earlier key-less signature)", AS.sam, `select admin.create_order('${ID.custA}', '${json(one(100000))}'::jsonb);`);
  step("similar orders (read-only evidence)", AS.sam, `select count(*) from admin.similar_orders('${ID.custA}', '${json(one(200000))}'::jsonb, 'diff-similar-key');`);
  move("A awaiting_deposit", AS.sam, a, "awaiting_deposit");
  move("A skip to building (invalid)", AS.sam, a, "building");
  move("A deposit_received with nothing paid (gate)", AS.sam, a, "deposit_received");
  move("A move as a customer", AS.alice, a, "deposit_received");
  keyedPay("A pay 100.00 keyed", AS.olivia, a, 10000, "diff-pay-A-0001", 0);
  keyedPay("A pay again, same key (a repeat)", AS.olivia, a, 10000, "diff-pay-A-0001", 0);
  keyedPay("A pay, same key, other amount (a conflict)", AS.olivia, a, 12345, "diff-pay-A-0001", 0);
  keyedPay("A pay with a stale expected amount", AS.olivia, a, 5000, "diff-pay-A-0002", 0);
  pay("A pay as staff (no payments.record)", AS.sam, a, "deposit", 5000, "cash");
  pay("A pay as a customer", AS.alice, a, "deposit", 5000, "cash");
  pay("A pay beyond the total", AS.olivia, a, "balance", 999999999, "cash");
  pay("A pay zero", AS.olivia, a, "deposit", 0, "cash");
  pay("A pay 200.00 (earlier key-less 8-argument signature)", AS.olivia, a, "deposit", 20000, "fawran", ", now(), null, 'diff reference', 'diff note'");
  move("A deposit_received", AS.sam, a, "deposit_received");
  for (const to of ["sourcing", "in_transit", "building", "quality_check", "building", "quality_check", "ready_for_delivery"]) move(`A ${to}`, AS.sam, a, to);
  move("A delivered with a balance still due", AS.sam, a, "delivered");
  step("A loyalty ledger entries (expect none: balance due)", AS.superuser, `select count(*) from public.loyalty_ledger where order_id = '${a}';`);
  pay("A pay the balance", AS.olivia, a, "balance", 170000, "cash");
  step("A loyalty ledger after the balance (one award)", AS.superuser, `select string_agg(entry_type || ':' || points, ',') from public.loyalty_ledger where order_id = '${a}';`);
  step("A award by hand (idempotent)", AS.olivia, `select admin.award_loyalty_for_order('${a}') is null;`);
  step("A loyalty ledger after the second award", AS.superuser, `select count(*) from public.loyalty_ledger where order_id = '${a}';`);
  step("loyalty adjustment keyed", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 50, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment again, same key", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 50, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment, same key, other points", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', 70, 'goodwill', 'diff-loyalty-0001') is not null;`);
  step("loyalty adjustment as staff", AS.sam, `select admin.adjust_loyalty('${ID.custA}', 5, 'x', 'diff-loyalty-0002') is not null;`);
  step("loyalty adjustment below zero", AS.olivia, `select admin.adjust_loyalty('${ID.custA}', -100000, 'too much', 'diff-loyalty-0003') is not null;`);
  step("A reverse the balance payment", AS.olivia, `select admin.reverse_payment((select id from public.payments where order_id = '${a}' and purpose = 'balance' and entry_type = 'payment'), 'differential reversal') is not null;`);
  step("A paid amount after the reversal", AS.superuser, `select amount_paid_minor from public.orders where id = '${a}';`);

  // ---- tracking (earlier signature) ---------------------------------------------------------------------------------------
  const ev = step("A publish tracking (earlier four-argument signature)", AS.sam, `select admin.publish_tracking_event('${a}', 'Differential update', 'message', 'in_transit');`);
  step("A publish tracking with an empty title", AS.sam, `select admin.publish_tracking_event('${a}', '', 'message', null);`);
  step("A publish tracking as a customer", AS.alice, `select admin.publish_tracking_event('${a}', 'x', null, null);`);
  step("A publish tracking as inactive staff", AS.dana, `select admin.publish_tracking_event('${a}', 'x', null, null);`);
  step("A publish tracking on an unknown order", AS.sam, `select admin.publish_tracking_event('00000000-0000-4000-8000-00000000ffff', 'x', null, null);`);
  step("A withdraw the update", AS.sam, `select admin.retract_tracking_event('${ev}', 'differential withdrawal');`);
  step("A withdraw it again", AS.sam, `select admin.retract_tracking_event('${ev}', 'again');`);
  step("A withdraw without a reason", AS.sam, `select admin.retract_tracking_event('${ev}', '');`);

  // ---- order B: hold, resume, cancel -------------------------------------------------------------------------------------------
  const b = keyless;
  move("B awaiting_deposit", AS.sam, b, "awaiting_deposit");
  pay("B pay the deposit", AS.olivia, b, "deposit", 15000, "cash");
  for (const to of ["deposit_received", "sourcing", "on_hold"]) move(`B ${to}`, AS.sam, b, to);
  move("B resume at the wrong status", AS.sam, b, "in_transit");
  move("B resume at the right status", AS.sam, b, "sourcing");
  move("B hold again", AS.sam, b, "on_hold");
  move("B cancel while held", AS.sam, b, "cancelled");
  pay("B pay on a cancelled order", AS.olivia, b, "balance", 100, "cash");
  move("B leave cancelled", AS.sam, b, "awaiting_deposit");
  move("B an unknown status", AS.sam, b, "no_such_status");

  // ---- order C: left on hold, for the read comparison ------------------------------------------------------------------------------
  const c = keyedOrder("C create (keyed)", AS.sam, "diff-order-C-0001", 50000);
  move("C awaiting_deposit", AS.sam, c, "awaiting_deposit");
  pay("C pay the deposit", AS.olivia, c, "deposit", 7500, "cash");
  for (const to of ["deposit_received", "sourcing", "in_transit", "on_hold"]) move(`C ${to}`, AS.sam, c, to);

  // ---- the rows that resulted (every id and timestamp normalised, every amount, reference, status and message kept) ------------------
  const digest = (label, sql) => T.push(`STATE ${label}: ${norm(q(sql))}`);
  digest("orders", "select string_agg(order_ref || ':' || status || ':' || total_minor || ':' || deposit_required_minor || ':' || amount_paid_minor || ':' || balance_due_minor || ':' || coalesce(deposit_rate_bps::text, '-') || ':' || coalesce(deposit_gate_status, '-'), ' | ' order by order_ref) from public.orders where order_ref in (select order_ref from public.orders where created_at > now() - interval '1 hour') and id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("payments", "select string_agg(o.order_ref || ':' || p.entry_type || ':' || p.purpose || ':' || p.amount_minor || ':' || p.method || ':' || p.receipt_number, ' | ' order by p.receipt_number, p.id) from public.payments p join public.orders o on o.id = p.order_id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("history", "select string_agg(o.order_ref || ':' || coalesce(h.from_status, '-') || '>' || h.to_status || ':' || coalesce(h.reason, '-'), ' | ' order by o.order_ref, h.id) from private.order_status_history h join public.orders o on o.id = h.order_id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("tracking", "select string_agg(o.order_ref || ':' || e.title || ':' || coalesce(e.status_code, '-') || ':' || (r.event_id is not null), ' | ' order by o.order_ref, e.published_at, e.id) from public.order_tracking_events e join public.orders o on o.id = e.order_id left join private.tracking_event_retractions r on r.event_id = e.id where o.id in (select order_id from public.order_items where description = 'Differential test item')");
  digest("loyalty", "select string_agg(entry_type || ':' || points || ':' || coalesce(description, '-'), ' | ' order by created_at, id) from public.loyalty_ledger");
  digest("audit actions", "select string_agg(action || ':' || n, ' | ' order by action) from (select action, count(*) n from private.audit_log group by action) s");
  digest("idempotency keys", "select count(*) || ':' || count(distinct operation) from private.idempotency_keys");
  return { T, ids: { a, b, c } };
}

/** What the read functions answer, with the intentional wording and additive keys removed. */
function reads(db, ids) {
  const json = (sql, who) => JSON.parse(lines(db.ok(`${sql}::text;`, who)).pop());
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) if (!["label", "status_label"].includes(k)) out[k] = strip(x);
      return out;
    }
    return v;
  };
  const view = (sql, who) => strip(json(sql, who));
  return {
    getA: view(`select admin.get_order('${ids.a}')`, AS.olivia),
    getB: view(`select admin.get_order('${ids.b}')`, AS.sam),
    getC: view(`select admin.get_order('${ids.c}')`, AS.sam),
    list: view("select admin.list_orders(null, null, 100, 0)", AS.sam),
    listHeld: view("select admin.list_orders('on_hold', null, 100, 0)", AS.sam),
    dash: view("select admin.dashboard_summary()", AS.olivia),
    dashStaff: view("select admin.dashboard_summary()", AS.sam),
  };
}

suite("the workflow migrations preserve every earlier write path (differential: hosted-shape database versus the same plus the two migrations)", () => {
  let control;
  let partial;
  let treatment;
  let c;
  let p;
  let t;
  let cr;
  let tr;

  before(() => {
    control = startDatabase({ schedule: "confirmed", before: W1 });
    // The state BETWEEN the two migrations (the first applied, the second not yet or failed): the earlier website must work there too.
    partial = startDatabase({ schedule: "confirmed", before: W2 });
    treatment = startDatabase({ schedule: "confirmed" });
    c = scenario(control);
    p = scenario(partial);
    t = scenario(treatment);
    cr = reads(control, c.ids);
    tr = reads(treatment, t.ids);
  });
  after(() => {
    control?.stop();
    partial?.stop();
    treatment?.stop();
  });

  it("the control really is the hosted shape (no workflow objects) and the treatment really has them", () => {
    const has = (db) => lines(db.ok("select to_regclass('public.order_workflow_stages') is not null;")).pop();
    assert.equal(has(control), "f");
    assert.equal(has(treatment), "t");
  });

  it("the script exercised the paths it claims to (a transcript with real successes AND real refusals, not an empty comparison)", () => {
    const ok = c.T.filter((l) => /=> OK /.test(l)).length;
    const err = c.T.filter((l) => /=> ERR /.test(l)).length;
    assert.ok(ok >= 40 && err >= 25, `expected a meaningful transcript, got ${ok} successes and ${err} refusals`);
    for (const expected of [/replay|already/i, /M1K|used for a different request|different request/i, /permission denied/, /the deposit has not been fully paid/, /cannot move from/, /cancelled order cannot receive a payment/, /a held order can only resume at/, /amount paid on this order changed/]) {
      assert.ok(c.T.some((l) => expected.test(l)), `the transcript should contain a refusal matching ${expected}`);
    }
  });

  it("every step of the script ends the same way on both databases: the same successes, the same refusals, the same words", () => {
    assert.equal(t.T.length, c.T.length);
    const diffs = [];
    for (let i = 0; i < c.T.length; i++) if (c.T[i] !== t.T[i]) diffs.push(`control:   ${c.T[i]}\n   treatment: ${t.T[i]}`);
    assert.deepEqual(diffs, [], `the migrations changed the outcome of ${diffs.length} step(s):\n${diffs.join("\n")}`);
  });

  it("the state BETWEEN the two migrations is safe too: with only the first applied, every step, row and refusal is still identical (a failed second migration leaves the earlier website working)", () => {
    assert.equal(lines(partial.ok("select to_regclass('public.order_workflow_stages') is not null;")).pop(), "t", "the first migration is applied");
    assert.equal(lines(partial.ok("select pg_get_functiondef('admin.get_order(uuid)'::regprocedure) like '%order_next_statuses%';")).pop(), "f", "the second is not");
    assert.deepEqual(p.T, c.T);
  });

  it("the rows the script produced are identical: orders, amounts, receipts, history, tracking, loyalty, audit actions and idempotency keys", () => {
    const state = (x) => x.T.filter((l) => l.startsWith("STATE "));
    assert.equal(state(c).length, 7);
    assert.deepEqual(state(t), state(c));
  });

  it("the read functions still return every earlier field with the same value (wording and additive keys aside)", () => {
    const isSubset = (base, extended, path) => {
      if (Array.isArray(base)) {
        assert.ok(Array.isArray(extended), path);
        assert.equal(extended.length, base.length, `${path}: length`);
        base.forEach((x, i) => isSubset(x, extended[i], `${path}[${i}]`));
      } else if (base && typeof base === "object") {
        for (const key of Object.keys(base)) {
          assert.ok(key in extended, `${path}.${key} must still be returned`);
          isSubset(base[key], extended[key], `${path}.${key}`);
        }
      } else {
        assert.equal(norm(extended), norm(base), path);
      }
    };
    for (const name of ["getA", "getB", "list", "dash", "dashStaff"]) isSubset(cr[name], tr[name], name);
    isSubset(cr.listHeld, tr.listHeld, "listHeld");
  });

  it("INTENDED difference 1: a held order's dropdown lists only its resume point and Cancel; the earlier database listed every earlier status", () => {
    const codes = (r) => r.next_statuses.map((n) => n.code).sort();
    assert.deepEqual(codes(tr.getC), ["cancelled", "in_transit"]);
    assert.ok(codes(cr.getC).length > codes(tr.getC).length, "the earlier list was longer");
    for (const code of codes(tr.getC)) assert.ok(codes(cr.getC).includes(code), `${code} was already offered`);
  });

  it("INTENDED difference 2: every other order's dropdown lists exactly the same moves as before", () => {
    const codes = (r) => r.next_statuses.map((n) => n.code).sort();
    assert.deepEqual(codes(tr.getA), codes(cr.getA));
    assert.deepEqual(codes(tr.getB), codes(cr.getB));
  });

  it("INTENDED difference 3: the read answers only GAIN keys (and two permissions); nothing earlier is renamed or removed", () => {
    const keys = (db, sql, who) => Object.keys(JSON.parse(lines(db.ok(`${sql}::text;`, who)).pop())).sort();
    const getKeys = (db, id) => keys(db, `select admin.get_order('${id}')`, AS.olivia);
    const earlier = getKeys(control, c.ids.a);
    const later = getKeys(treatment, t.ids.a);
    assert.deepEqual(earlier.filter((k) => !later.includes(k)), [], "no earlier key was removed");
    assert.ok(later.length > earlier.length);
    const perms = (db) => Number(lines(db.ok("select count(*) from admin.my_permissions();", AS.olivia)).pop());
    assert.equal(perms(treatment) - perms(control), 2);
    assert.equal(Number(lines(treatment.ok("select count(*) from admin.my_permissions();", AS.sam)).pop()), Number(lines(control.ok("select count(*) from admin.my_permissions();", AS.sam)).pop()), "staff gain no permission");
  });

  it("the signatures of the write functions the deployed website calls are unchanged, and nobody gained or lost the right to run them", () => {
    const sigs = (db) =>
      lines(db.ok(`select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'null') || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname in
        ('create_order','record_payment','reverse_payment','adjust_loyalty','transition_order','publish_tracking_event','retract_tracking_event','similar_orders','award_loyalty_for_order','reverse_loyalty_award','get_order','list_orders','dashboard_summary','create_customer','issue_claim_code','revoke_claim_code','set_policy','add_order_note','set_order_item_cost') order by 1;`)).sort();
    assert.deepEqual(sigs(treatment), sigs(control));
  });

  it("the earlier website's functions all still exist after the migrations (nothing the deployed website calls has disappeared)", () => {
    const names = (db) => lines(db.ok("select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'admin'::regnamespace order by 1;"));
    const after = new Set(names(treatment));
    const missing = names(control).filter((n) => !after.has(n));
    assert.deepEqual(missing, []);
    assert.equal(names(treatment).length - names(control).length, 4, "exactly the four new staff functions were added");
  });

  it("the security and gateway audits report nothing on the treatment, exactly as on the control", () => {
    for (const db of [control, treatment]) {
      assert.equal(lines(db.ok("select count(*) from private.security_audit();")).pop(), "0");
      assert.equal(lines(db.ok("select count(*) from private.gateway_audit();")).pop(), "0");
    }
  });
});
