// M1 order workflow, DATABASE layer (layer A of the workflow test plan).
//
// WHAT THIS IS. The complete order lifecycle, the money arithmetic, the loyalty rules, the refusals, the idempotency
// behaviour and the authorization boundaries, executed against a REAL PostgreSQL 16 server that has the REAL migrations,
// the REAL staff functions (admin.*) and the REAL row level security. Every figure is an integer in QAR minor units
// (1 QAR = 100 dirham). Every name and address is synthetic.
//
// WHAT THIS IS NOT. A test of the website, of Supabase Auth, or of MFA itself: the harness supplies the JWT claims
// (as every database test in this folder does), so a pass here proves the DATABASE's behaviour given those claims. The
// real second factor and the staff screens are exercised only by the official-stack suite (tests/real) and on a hosted
// project. The customer pages are covered by workflow.customer.e2e.test.mjs, against the local emulator (not Supabase).
//
// Tests tagged [ASSUMPTION OQ-xxxx] pin a CURRENT DEFAULT that the owner has not confirmed (status wording OQ-0005,
// the payment/loyalty trigger OQ-0006, the loyalty base and rounding OQ-0007). They record behaviour; they do not
// decide it. Tests tagged [OBSERVED] record behaviour that may need a business decision; see WORKFLOW_TESTS.md.
// Tests tagged [PLAT-0004] record how the duplicate-protection work changed what a KEY-LESS direct call does (nothing); the
// protection itself is proved in idempotency.db.test.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { asRole, findPgBin } from "./harness.mjs";
import { AS, ID, SENTINEL, newOrder, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

// ---- identities and data -----------------------------------------------------------------------------------------
const CUST_C = "00000000-0000-4000-8000-0000000000c9"; // a walk-in customer with no sign-in account: used by the mechanics tests
const SID = "00000000-0000-4000-8000-0000000000e1";
const SID_OTHER = "00000000-0000-4000-8000-0000000000e2";

/** S1: four lines that sum to QAR 4,350.55 = 435 055 minor units (an odd figure on purpose: it exercises rounding). */
const S1_ITEMS = [
  { kind: "component", description: "Test graphics card", quantity: 1, unit_price_minor: 215000 },
  { kind: "component", description: "Test processor", quantity: 1, unit_price_minor: 130055 },
  { kind: "build_service", description: "Assembly and testing", quantity: 1, unit_price_minor: 80000 },
  { kind: "delivery", description: "Delivery in Doha", quantity: 1, unit_price_minor: 10000 },
];
const one = (price, qty = 1) => [{ kind: "component", description: "Test item", quantity: qty, unit_price_minor: price }];

// ---- the confirmed rules, restated in exact integer (BigInt) arithmetic so the database is checked against ONE
//      independent implementation. Deposit tiers apply to the WHOLE total: <= 300 000 -> 15 %, <= 500 000 -> 25 %, above -> 35 %.
const tierBps = (total) => (total <= 300000n ? 1500n : total <= 500000n ? 2500n : 3500n);
const expectedDeposit = (total) => (total * tierBps(total) + 5000n) / 10000n; // nearest minor unit, a half rounds up
const expectedPoints = (total) => total / 1000n; // 1 point per QAR 10.00, rounded down  [ASSUMPTION OQ-0007: base and rounding]

const FULL_PATH = ["awaiting_deposit", "deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery"];
const lines = (out) => out.split("\n").filter((l) => l !== "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

suite("M1 order workflow: database layer (real PostgreSQL 16, real migrations, real RLS; not the website, not Supabase Auth)", () => {
  let db;

  before(() => {
    // The owner-CONFIRMED tiered deposit schedule that the migrations ship; no test example replaces it.
    db = startDatabase({ schedule: "confirmed" });
    db.commit(`insert into public.customers (id, full_name, phone, email, source)
      values ('${CUST_C}', 'Carol Test (walk-in)', '+97455550003', 'carol@example.test', 'walk_in');`);
    // A helper that runs one statement and reports "OK" or "REFUSED: <the database's message>", so a script can probe a
    // refusal and keep going. It runs as the caller's role, so it sees exactly what that role would.
    db.commit(`create function public.zz_count(stmt text) returns text language plpgsql as $f$
      declare n bigint; begin execute stmt into n; return n::text; exception when others then return 'DENIED'; end $f$;`);
    db.commit(`create function public.zz_attempt(stmt text) returns text language plpgsql as $f$
      begin execute stmt; return 'OK'; exception when others then return 'REFUSED: ' || sqlerrm; end $f$;`);
  });
  after(() => db?.stop());

  // ---- helpers -------------------------------------------------------------------------------------------------
  const read = (sql, who = "") => db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who);
  const attempt = (who, sql) => lines(db.ok(`select public.zz_attempt('${sql.replaceAll("'", "''")}');`, who)).pop();
  /** "0" (RLS hides the rows), or "DENIED" (the role has no privilege at all): both mean nothing was readable. */
  const rowsSeen = (who, sql) => lines(db.ok(`select public.zz_count('${sql.replaceAll("'", "''")}');`, who)).pop();
  const refused = (result, pattern, label = "") => {
    if (process.env.WORKFLOW_TEST_VERBOSE) console.log(`REFUSAL [${label.slice(0, 90).replaceAll("\n", " ")}] => ${result.slice(0, 200)}`);
    assert.match(result, /^REFUSED: /, `${label} should have been refused but got: ${result}`);
    assert.match(result, pattern, label);
  };
  const act = (who, sql) => db.commit(`${who}${sql}`);
  const make = (items, { customer = ID.custA, who = AS.sam } = {}) => lines(db.commit(`${newOrder({ customer, items, into: "o", who })}select :'o';`)).pop().trim();
  const move = (id, to, reason) => act(AS.sam, `select admin.transition_order('${id}', '${to}'${reason ? `, '${reason}'` : ""});`);
  const pay = (id, amount, { method = "cash", purpose = "deposit", extra = "" } = {}) =>
    lines(act(AS.olivia, `select admin.record_payment('${id}', '${purpose}', ${amount}, '${method}'${extra});`)).pop().trim();
  const orderRow = (id) =>
    read(`select total_minor, deposit_required_minor, coalesce(deposit_rate_bps::text, 'null'), coalesce(deposit_policy_version::text, 'null'),
      deposit_fixed_at is not null, amount_paid_minor, balance_due_minor, status from public.orders where id = '${id}'`);
  const ledgerOf = (id) => lines(read(`select entry_type || ':' || points from public.loyalty_ledger where order_id = '${id}' order by created_at, id`));
  const paymentsOf = (id) => lines(read(`select amount_minor || ':' || method || ':' || purpose from public.payments where order_id = '${id}' order by amount_minor`));
  const historyOf = (id) =>
    lines(read(`select coalesce(from_status, '(creation)') || '>' || to_status from private.order_status_history where order_id = '${id}' order by id`));
  const auditCount = (id, action) =>
    Number(read(`select count(*) from private.audit_log where action = '${action}' and (entity_id = '${id}' or details ->> 'order_id' = '${id}')`));
  const asyncPsql = (sql) =>
    new Promise((resolve) => {
      const c = db.cluster;
      const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", c.dir, "-p", String(c.port), "-U", "postgres", "-t", "-A", "-F", "|", "-d", c.database, "-f", "-"];
      const child = spawn(join(c.bin, "psql"), args);
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
      child.stdin.end(sql);
    });
  /** Builds an order for `total`, confirms it, pays `paid` (all of it, by default), and moves it along the path. */
  function lifecycle(total, { customer = CUST_C, paid = total, through = FULL_PATH, deliver = true } = {}) {
    const id = make(one(total), { customer });
    move(id, "awaiting_deposit");
    if (paid > 0) pay(id, paid);
    for (const status of through.slice(1)) move(id, status);
    if (deliver) move(id, "delivered");
    return id;
  }

  // =================================================================================================================
  describe("S1: the whole lifecycle of one order, QAR 4,350.55 (435 055 minor units), step by step", () => {
    const S = {};

    it("1. create: staff price the order; the deposit is shown as PROVISIONAL, and the creation is recorded and audited", () => {
      S.id = make(S1_ITEMS, { customer: ID.custA, who: AS.sam });
      S.ref = read(`select order_ref from public.orders where id = '${S.id}'`);
      assert.match(S.ref, /^O-\d{4}-\d{5}$/);
      // 215000 + 130055 + 80000 + 10000 = 435055. 25 % tier: 435055 x 2500 = 1 087 637 500 -> /10000 = 108 763.75 -> 108 764 (a half rounds up).
      assert.equal(215000n + 130055n + 80000n + 10000n, 435055n);
      assert.equal(expectedDeposit(435055n), 108764n);
      assert.equal(orderRow(S.id), "435055|108764|null|null|f|0|435055|pending_confirmation", "provisional: no rate, no policy version, not fixed");
      assert.deepEqual(historyOf(S.id), ["(creation)>pending_confirmation"]);
      assert.equal(auditCount(S.id, "order.created"), 1);
      assert.equal(read(`select order_items_total from (select sum(line_total_minor) as order_items_total from public.order_items where order_id = '${S.id}') t`), "435055");
    });

    it("2. the deposit preview shows the same figure and the rule, and changes nothing", () => {
      const preview = JSON.parse(read(`select admin.preview_deposit(435055)::text`, AS.sam));
      assert.equal(preview.amount_minor, 108764);
      assert.equal(preview.rate_bps, 2500);
      assert.equal(preview.policy_version, 3);
      assert.equal(orderRow(S.id), "435055|108764|null|null|f|0|435055|pending_confirmation");
    });

    it("3. confirm: moving to awaiting_deposit FIXES the deposit (amount, 25 % rate, policy version 3) and audits it", () => {
      move(S.id, "awaiting_deposit");
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|0|435055|awaiting_deposit");
      assert.equal(read(`select details ->> 'deposit_minor' || '|' || (details ->> 'deposit_rate_bps') || '|' || (details ->> 'policy_version') from private.audit_log where action = 'order.transition' and entity_id = '${S.id}'`), "108764|2500|3");
      // [ASSUMPTION OQ-0005] the status vocabulary is a placeholder; the transition names are pinned as they are today.
    });

    it("4. the deposit gate refuses with nothing paid; a PART payment is not enough", () => {
      refused(attempt(AS.sam, `select admin.transition_order('${S.id}', 'deposit_received')`), /the deposit has not been fully paid \(0 of 108764 QAR minor units\)/, "nothing paid");
      pay(S.id, 50000, { extra: `, now(), null, '${SENTINEL.reference}', 'internal payment note'` }); // QAR 500.00 cash
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|50000|385055|awaiting_deposit");
      refused(attempt(AS.sam, `select admin.transition_order('${S.id}', 'deposit_received')`), /\(50000 of 108764 QAR minor units\)/, "part paid");
    });

    it("5. an over-payment is refused and records nothing", () => {
      refused(attempt(AS.olivia, `select admin.record_payment('${S.id}', 'balance', 400000, 'cash')`), /this payment would exceed the order total/, "over total");
      assert.deepEqual(paymentsOf(S.id), ["50000:cash:deposit"]);
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|50000|385055|awaiting_deposit");
    });

    it("6. the rest of the deposit by Fawran (58 764) completes it exactly; the gate now opens", () => {
      pay(S.id, 58764, { method: "fawran" });
      assert.equal(50000n + 58764n, 108764n);
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|108764|326291|awaiting_deposit");
      move(S.id, "deposit_received");
      assert.match(orderRow(S.id), /deposit_received$/);
    });

    it("7. sourcing -> in_transit -> building -> quality_check -> ready_for_delivery, in order; a skipped step is refused; NO points yet", () => {
      move(S.id, "sourcing");
      refused(attempt(AS.sam, `select admin.transition_order('${S.id}', 'building_x')`), /an order cannot move from sourcing to building_x/, "unknown status");
      refused(attempt(AS.sam, `select admin.transition_order('${S.id}', 'delivered')`), /an order cannot move from sourcing to delivered/, "skip to delivered");
      move(S.id, "in_transit");
      move(S.id, "building");
      refused(attempt(AS.sam, `select admin.transition_order('${S.id}', 'delivered')`), /an order cannot move from building to delivered/, "skip from building");
      move(S.id, "quality_check");
      move(S.id, "ready_for_delivery");
      assert.deepEqual(ledgerOf(S.id), [], "no points at any step before delivery");
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|108764|326291|ready_for_delivery");
    });

    it("8. the final payment (326 291) leaves a balance of exactly 0, and STILL no points: the order is not delivered", () => {
      pay(S.id, 326291, { purpose: "balance" });
      assert.equal(108764n + 326291n, 435055n);
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|435055|0|ready_for_delivery");
      assert.deepEqual(ledgerOf(S.id), []);
      refused(attempt(AS.olivia, `select admin.record_payment('${S.id}', 'balance', 1, 'cash')`), /exceed the order total/, "one dirham more");
    });

    it("9. delivered: exactly 435 points are awarded once, in the same transaction; the order is final [ASSUMPTION OQ-0006, OQ-0007]", () => {
      move(S.id, "delivered");
      assert.equal(expectedPoints(435055n), 435n);
      assert.deepEqual(ledgerOf(S.id), ["award:435"]);
      assert.equal(read(`select description from public.loyalty_ledger where order_id = '${S.id}'`), `Points earned on order ${S.ref}`);
      assert.match(orderRow(S.id), /delivered$/);
      for (const to of ["building", "cancelled", "on_hold", "awaiting_deposit"]) refused(attempt(AS.sam, `select admin.transition_order('${S.id}', '${to}')`), /an order cannot move from delivered to/, `delivered -> ${to}`);
    });

    it("10. the record: 9 status-history rows in order, the exact audit trail, and three payments that sum to the total", () => {
      assert.deepEqual(historyOf(S.id), [
        "(creation)>pending_confirmation",
        "pending_confirmation>awaiting_deposit", "awaiting_deposit>deposit_received", "deposit_received>sourcing", "sourcing>in_transit",
        "in_transit>building", "building>quality_check", "quality_check>ready_for_delivery", "ready_for_delivery>delivered",
      ]);
      assert.equal(auditCount(S.id, "order.created"), 1);
      assert.equal(auditCount(S.id, "order.transition"), 8);
      assert.equal(auditCount(S.id, "payment.recorded"), 3);
      // Who did it: staff Sam created and moved the order; owner Olivia recorded every payment.
      assert.equal(read(`select string_agg(distinct actor::text, ',') from private.audit_log where action in ('order.created','order.transition') and (entity_id = '${S.id}')`), ID.sam);
      assert.equal(read(`select string_agg(distinct actor::text, ',') from private.audit_log where action = 'payment.recorded' and details ->> 'order_id' = '${S.id}'`), ID.olivia);
      assert.deepEqual(paymentsOf(S.id), ["50000:cash:deposit", "58764:fawran:deposit", "326291:cash:balance"]);
      assert.equal(read(`select sum(amount_minor) from public.payments where order_id = '${S.id}' and entry_type = 'payment'`), "435055");
      assert.equal(read(`select count(distinct receipt_number) || ':' || bool_and(receipt_number ~ '^R-[0-9]{4}-[0-9]{5}$') from public.payments where order_id = '${S.id}'`), "3:true", "three distinct generated receipts");
    });

    it("11. the ledgers cannot be edited or deleted, even by the database superuser (a trigger refuses, not only the grants)", () => {
      for (const sql of [
        `update public.payments set amount_minor = 1 where order_id = '${S.id}'`,
        `delete from public.payments where order_id = '${S.id}'`,
        `update public.loyalty_ledger set points = 999 where order_id = '${S.id}'`,
        `delete from public.loyalty_ledger where order_id = '${S.id}'`,
        `update private.order_status_history set to_status = 'cancelled' where order_id = '${S.id}'`,
        `delete from private.audit_log where entity_id = '${S.id}'`,
        `update private.audit_log set action = 'x' where entity_id = '${S.id}'`,
      ]) refused(attempt("", sql), /is append-only: (UPDATE|DELETE) is not allowed/, sql);
      assert.deepEqual(ledgerOf(S.id), ["award:435"]);
      assert.equal(orderRow(S.id), "435055|108764|2500|3|t|435055|0|delivered");
    });

    it("12. the customer's own view (Alice): exactly her order, items, payments, timeline and points; nothing private", () => {
      // Three separate transactions, as three separate staff actions would be: events published in ONE transaction share a clock tick.
      act(AS.sam, `select admin.publish_tracking_event('${S.id}', 'Order confirmed', 'We confirmed your order and your deposit.', 'deposit_received');`);
      act(AS.sam, `select admin.publish_tracking_event('${S.id}', 'Your PC is being built', 'Our team has started the build.', 'building');`);
      act(AS.sam, `select admin.publish_tracking_event('${S.id}', 'Delivered', 'Delivered. Enjoy your new PC.', 'delivered');`);
      const as = (sql) => read(sql, AS.alice);
      assert.equal(as(`select total_minor || '|' || deposit_required_minor || '|' || amount_paid_minor || '|' || balance_due_minor || '|' || status from public.orders where id = '${S.id}'`), "435055|108764|435055|0|delivered");
      assert.equal(as(`select count(*) || ':' || sum(line_total_minor) from public.order_items where order_id = '${S.id}'`), "4:435055");
      assert.deepEqual(lines(as(`select amount_minor || ':' || method from public.payments where order_id = '${S.id}' order by amount_minor`)), ["50000:cash", "58764:fawran", "326291:cash"]);
      assert.deepEqual(lines(as(`select title from public.order_tracking_events where order_id = '${S.id}' order by published_at, id`)), ["Order confirmed", "Your PC is being built", "Delivered"]);
      assert.deepEqual(lines(as(`select entry_type || ':' || points from public.loyalty_ledger where order_id = '${S.id}'`)), ["award:435"]);
      assert.match(as(`select balance_points || ':' || entries from public.loyalty_balances`), /^435:1$/);
      const everything = as(`select to_jsonb(p)::text from public.payments p where order_id = '${S.id}'`) + as(`select to_jsonb(l)::text from public.loyalty_ledger l where order_id = '${S.id}'`);
      for (const secret of [SENTINEL.reference, "internal payment note", "recorded_by", "internal_reference", "internal_notes", "reason"]) assert.ok(!everything.includes(secret), `a customer must not see ${secret}`);
      S.aliceOrder = S.id;
    });
  });

  // =================================================================================================================
  describe("S2: delivered before the final payment: the points wait for the payment [ASSUMPTION OQ-0006]", () => {
    const S = {};

    it("1. delivered with a balance still due: 0 points, and the owner cannot award them by hand", () => {
      S.id = make(one(200000), { customer: ID.custA }); // QAR 2,000.00 -> 15 % tier -> deposit 30 000
      move(S.id, "awaiting_deposit");
      assert.equal(orderRow(S.id), "200000|30000|1500|3|t|0|200000|awaiting_deposit");
      pay(S.id, 30000);
      for (const s of FULL_PATH.slice(1)) move(S.id, s);
      move(S.id, "delivered"); // allowed: no status requires full payment today (orders.full_payment is null)  [ASSUMPTION OQ-0006]
      assert.equal(orderRow(S.id), "200000|30000|1500|3|t|30000|170000|delivered");
      assert.deepEqual(ledgerOf(S.id), []);
      const manual = read(`select admin.award_loyalty_for_order('${S.id}') is null`, AS.olivia);
      assert.equal(lines(manual).pop(), "t", "the manual award runs the SAME conditions: it cannot bypass them");
      assert.deepEqual(ledgerOf(S.id), []);
    });

    it("2. the final payment awards exactly 200 points, in that payment's own transaction", () => {
      pay(S.id, 170000, { purpose: "balance" });
      assert.equal(expectedPoints(200000n), 200n);
      assert.deepEqual(ledgerOf(S.id), ["award:200"]);
      assert.equal(read(`select (select created_at from public.loyalty_ledger where order_id = '${S.id}') = (select created_at from public.payments where order_id = '${S.id}' and amount_minor = 170000)`), "t", "same transaction");
      assert.equal(orderRow(S.id), "200000|30000|1500|3|t|200000|0|delivered");
    });

    it("3. repeating the payment or the award changes nothing: the payment is refused, the award returns the SAME entry", () => {
      refused(attempt(AS.olivia, `select admin.record_payment('${S.id}', 'balance', 170000, 'cash')`), /exceed the order total/, "repeat final payment");
      const first = read(`select id from public.loyalty_ledger where order_id = '${S.id}'`);
      const again = lines(read(`select admin.award_loyalty_for_order('${S.id}')`, AS.olivia)).pop();
      assert.equal(again, first, "the manual award returns the existing entry");
      assert.deepEqual(ledgerOf(S.id), ["award:200"]);
      assert.equal(read(`select count(*) from public.loyalty_ledger where order_id = '${S.id}' and entry_type = 'award'`), "1");
      S.delivered = S.id;
    });

    it("4. [OBSERVED] reversing the final payment AFTER the award leaves the points in place and the order delivered (decision D3)", () => {
      const payId = read(`select id from public.payments where order_id = '${S.id}' and amount_minor = 170000`);
      act(AS.olivia, `select admin.reverse_payment('${payId}', 'bank returned the payment');`);
      assert.equal(orderRow(S.id), "200000|30000|1500|3|t|30000|170000|delivered", "the money is owed again");
      assert.deepEqual(ledgerOf(S.id), ["award:200"], "the points are NOT clawed back automatically");
      refused(attempt(AS.olivia, `select admin.reverse_payment('${payId}', 'again')`), /already been reversed/, "second reversal");
      const reversalId = read(`select id from public.payments where reverses_payment_id = '${payId}'`);
      refused(attempt(AS.olivia, `select admin.reverse_payment('${reversalId}', 'reverse the reversal')`), /payment not found/, "reversal of a reversal");
      // The owner CAN take the points back by hand (loyalty.adjust), and that is audited.
      act(AS.olivia, `select admin.reverse_loyalty_award('${S.id}', 'payment was reversed');`);
      assert.deepEqual(ledgerOf(S.id), ["award:200", "reversal:-200"]);
    });
  });

  // =================================================================================================================
  describe("S3: money refusals (each probe is rolled back; nothing is recorded)", () => {
    let id;
    before(() => {
      id = make(one(100000), { customer: CUST_C });
      move(id, "awaiting_deposit");
    });
    const rec = (amount, method = "cash", extra = "") => `select admin.record_payment('${id}', 'deposit', ${amount}, '${method}'${extra})`;

    it("zero, negative, future-dated, unknown-method and over-total payments are refused; a payment up to one day ahead is allowed", () => {
      refused(attempt(AS.olivia, rec(0)), /must be greater than zero/, "zero");
      refused(attempt(AS.olivia, rec(-500)), /must be greater than zero/, "negative");
      refused(attempt(AS.olivia, rec(100, "cash", `, now() + interval '3 days'`)), /cannot be dated in the future/, "3 days ahead");
      assert.equal(attempt(AS.olivia, rec(100, "cash", `, now() + interval '2 hours'`)), "OK", "a few hours ahead tolerated: clock differences");
      refused(attempt(AS.olivia, rec(100, "bitcoin")), /violates check constraint "payments_method_check"/, "unknown method");
      refused(attempt(AS.olivia, rec(100001)), /exceed the order total/, "one over the total");
      assert.equal(attempt(AS.olivia, rec(100000)), "OK", "exactly the total is allowed");
      assert.deepEqual(paymentsOf(id), [], "every probe was rolled back");
    });

    it("a cancelled order cannot receive a payment", () => {
      const c = make(one(100000), { customer: CUST_C });
      move(c, "cancelled", "test");
      refused(attempt(AS.olivia, `select admin.record_payment('${c}', 'deposit', 100, 'cash')`), /a cancelled order cannot receive a payment/);
    });

    it("a reversal closes the deposit gate again", () => {
      const out = read(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 15000, 'cash') as pid \\gset
        select admin.transition_order('${id}', 'deposit_received');
        select 'moved|' || status from public.orders where id = '${id}';`);
      assert.match(out, /moved\|deposit_received/, "deposit 15 000 = 15 % of 100 000 opens the gate");
      const out2 = read(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 15000, 'cash') as pid \\gset
        select admin.reverse_payment(:'pid', 'wrong amount entered');
        select public.zz_attempt(format('select admin.transition_order(%L, %L)', '${id}', 'deposit_received'));`);
      refused(lines(out2).pop(), /the deposit has not been fully paid \(0 of 15000/, "after the reversal");
    });

    it("the staff functions refuse a payment for an unknown order and a reversal of an unknown payment", () => {
      refused(attempt(AS.olivia, `select admin.record_payment('00000000-0000-4000-8000-00000000dead', 'deposit', 100, 'cash')`), /order not found/);
      refused(attempt(AS.olivia, `select admin.reverse_payment('00000000-0000-4000-8000-00000000dead', 'because')`), /payment not found/);
      refused(attempt(AS.olivia, `select admin.reverse_payment('${S1_REVERSE_ID()}', '')`), /a reason is required to reverse a payment/, "an empty reason");
    });
  });

  // =================================================================================================================
  describe("S4: loyalty points are awarded only when the order qualifies [ASSUMPTION OQ-0006, OQ-0007]", () => {
    it("fully paid but NOT delivered: no points", () => {
      const id = lifecycle(300000, { deliver: false });
      assert.match(orderRow(id), /\|300000\|0\|ready_for_delivery$/);
      assert.deepEqual(ledgerOf(id), []);
      assert.equal(lines(read(`select admin.award_loyalty_for_order('${id}') is null`, AS.olivia)).pop(), "t");
    });

    it("cancelled after a deposit: no points", () => {
      const id = make(one(300000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      pay(id, 45000);
      move(id, "cancelled", "customer changed their mind");
      assert.deepEqual(ledgerOf(id), []);
    });

    it("an order of QAR 9.99 earns no entry at all; the points are floor(total / QAR 10): 999 -> 0, 1000 -> 1, 1999 -> 1, 2000 -> 2, 100000 -> 100", () => {
      const cases = [[999n, null], [1000n, "award:1"], [1999n, "award:1"], [2000n, "award:2"], [100000n, "award:100"]];
      for (const [total, expected] of cases) {
        const id = lifecycle(Number(total));
        assert.equal(expectedPoints(total) === 0n, expected === null);
        assert.deepEqual(ledgerOf(id), expected === null ? [] : [expected], `total ${total}`);
      }
    });

    it("ordinary staff cannot award or adjust points; only loyalty.adjust can", () => {
      const id = lifecycle(300000, { deliver: false });
      refused(attempt(AS.sam, `select admin.award_loyalty_for_order('${id}')`), /permission denied: loyalty.adjust is required/);
      refused(attempt(AS.sam, `select admin.adjust_loyalty('${CUST_C}', 50, 'a gift')`), /permission denied: loyalty.adjust is required/);
      assert.equal(attempt(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 50, 'goodwill adjustment')`), "OK");
    });
  });

  // =================================================================================================================
  describe("R4: deposit boundaries on the CONFIRMED schedule (15 % to QAR 3,000.00, 25 % to QAR 5,000.00, 35 % above), whole-total, nearest minor unit", () => {
    const cases = [
      [300000, 45000, 1500, "QAR 3,000.00: the top of the 15 % tier"],
      [300001, 75000, 2500, "QAR 3,000.01: one dirham over, so 25 % of the WHOLE total (75 000.25 -> 75 000)"],
      [500000, 125000, 2500, "QAR 5,000.00: the top of the 25 % tier"],
      [500001, 175000, 3500, "QAR 5,000.01: one dirham over, so 35 % of the WHOLE total (175 000.35 -> 175 000)"],
    ];
    for (const [total, deposit, bps, label] of cases) {
      it(`${label}`, () => {
        assert.equal(expectedDeposit(BigInt(total)), BigInt(deposit), "independent integer arithmetic agrees");
        assert.equal(tierBps(BigInt(total)), BigInt(bps));
        const preview = JSON.parse(read(`select admin.preview_deposit(${total})::text`, AS.sam));
        assert.deepEqual([preview.amount_minor, preview.rate_bps, preview.policy_version], [deposit, bps, 3], "the preview");
        const id = make(one(total), { customer: CUST_C });
        assert.equal(read(`select deposit_required_minor from public.orders where id = '${id}'`), String(deposit), "provisional figure at creation");
        move(id, "awaiting_deposit");
        assert.equal(orderRow(id), `${total}|${deposit}|${bps}|3|t|0|${total}|awaiting_deposit`, "fixed at confirmation, with its rate and version");
        // The gate is exactly the deposit: one dirham short is refused, the full amount opens it.
        pay(id, deposit - 1);
        refused(attempt(AS.sam, `select admin.transition_order('${id}', 'deposit_received')`), new RegExp(`\\(${deposit - 1} of ${deposit} QAR minor units\\)`), "one dirham short");
        pay(id, 1);
        move(id, "deposit_received");
        assert.match(orderRow(id), /deposit_received$/);
      });
    }

    it("the deposit never moves after confirmation, even when the policy changes afterwards", () => {
      const id = make(one(400000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      assert.equal(orderRow(id), "400000|100000|2500|3|t|0|400000|awaiting_deposit");
      const out = read(`${AS.olivia}select admin.set_policy('orders.deposit', '{"percent_bps": 9000, "minimum_minor": 0, "required_before_status": "deposit_received"}'::jsonb,
        'unconfirmed_default', 'TEST: a changed policy must not touch a confirmed order');
        reset role; select deposit_required_minor || '|' || deposit_rate_bps || '|' || deposit_policy_version from public.orders where id = '${id}';`);
      assert.equal(lines(out).pop(), "100000|2500|3", "the order keeps the schedule it was confirmed under");
    });
  });

  // =================================================================================================================
  describe("exact money: every amount is an integer number of QAR minor units, stored and returned", () => {
    it("every money column in the customer and ledger tables is an integer type; none is numeric, float or money", () => {
      const bad = read(`select table_schema || '.' || table_name || '.' || column_name || ':' || data_type from information_schema.columns
        where table_schema in ('public', 'private') and (column_name like '%\\_minor' or column_name in ('amount', 'price', 'total', 'balance'))
          and data_type not in ('bigint', 'integer', 'smallint') order by 1`);
      assert.equal(bad, "", `non-integer money columns: ${bad}`);
      const count = Number(read(`select count(*) from information_schema.columns where table_schema in ('public', 'private') and column_name like '%\\_minor'`));
      assert.ok(count >= 10, `found ${count} minor-unit columns`);
      assert.equal(read(`select count(*) from information_schema.columns where table_schema = 'public' and data_type in ('real', 'double precision', 'money')`), "0");
    });

    it("an order's figures are identical when computed by the database and by independent integer arithmetic, for awkward totals", () => {
      for (const total of [1n, 7n, 33n, 99n, 100n, 12345n, 299999n, 435055n, 999999n, 1234567n, 99999999n]) {
        const id = make(one(Number(total)), { customer: CUST_C });
        move(id, "awaiting_deposit");
        const dep = BigInt(read(`select deposit_required_minor from public.orders where id = '${id}'`));
        assert.equal(dep, expectedDeposit(total), `deposit for ${total}`);
        assert.ok(dep >= 0n && dep <= total, "never negative, never above the total");
      }
    });

    it("quantity x unit price is exact: 3 x 100 003 = 300 009, and the order total is the sum of line totals", () => {
      const id = make([{ kind: "component", description: "Three items", quantity: 3, unit_price_minor: 100003 }, { kind: "delivery", description: "Delivery", quantity: 1, unit_price_minor: 1 }], { customer: CUST_C });
      assert.equal(read(`select total_minor from public.orders where id = '${id}'`), "300010");
      assert.equal(read(`select sum(line_total_minor) from public.order_items where order_id = '${id}'`), "300010");
    });
  });

  // =================================================================================================================
  describe("repeated operations: duplicates, idempotency, and races (a REAL second session for the races)", () => {
    it("[PLAT-0004, GAP-1] a key-LESS direct database call is still not deduplicated (by design: the gateway, the only production path, REQUIRES a key; see idempotency.db.test.mjs)", () => {
      const id = make(one(200000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      pay(id, 20000);
      pay(id, 20000); // two identical direct calls with no key, as an owner at a SQL prompt could make
      assert.deepEqual(paymentsOf(id), ["20000:cash:deposit", "20000:cash:deposit"]);
      assert.equal(orderRow(id), "200000|30000|1500|3|t|40000|160000|awaiting_deposit");
    });

    it("a repeated payment WITH a receipt number is refused: the number is unique, so supplying it makes a retry safe", () => {
      const id = make(one(200000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      pay(id, 20000, { extra: `, now(), 'BANK-REF-7781'` });
      refused(attempt(AS.olivia, `select admin.record_payment('${id}', 'deposit', 20000, 'cash', now(), 'BANK-REF-7781')`), /violates unique constraint "payments_receipt_number_unique"/, "same receipt number");
      assert.deepEqual(paymentsOf(id), ["20000:cash:deposit"]);
    });

    it("[PLAT-0004, GAP-2] creating the same order twice WITHOUT a key (a direct call) still makes two orders; with a key it makes one (see idempotency.db.test.mjs)", () => {
      const a = make(one(150000), { customer: CUST_C });
      const b = make(one(150000), { customer: CUST_C });
      assert.notEqual(a, b);
      assert.notEqual(read(`select order_ref from public.orders where id = '${a}'`), read(`select order_ref from public.orders where id = '${b}'`));
    });

    it("[PLAT-0004] the staff screens now send an idempotency key with every payment and order (chosen by the page, kept across retries), and the receipt number is still generated server-side", () => {
      const forms = readFileSync(join(ROOT, "src/components/admin/forms.tsx"), "utf8");
      const actions = readFileSync(join(ROOT, "src/lib/staff/actions.ts"), "utf8");
      assert.match(forms, /<button type="submit" disabled=\{pending \|\| disabled\}/, "the submit button is still disabled while the action is pending (the first, cosmetic layer)");
      assert.equal((forms.match(/name="idempotency_key"/g) ?? []).length, 2, "the payment form and the order form each carry the key");
      const record = actions.slice(actions.indexOf("export async function recordPaymentAction"), actions.indexOf("export async function reversePaymentAction"));
      assert.match(record, /parseIdempotencyKey\(formData\)/, "recording a payment requires a key");
      assert.match(record, /api\.recordPayment\(orderId, purpose, amountMinor, method, reference, notes, idempotencyKey, expectedPaid\)/, "the screen passes an internal reference, the key and the balance it showed, never a receipt number");
      const create = actions.slice(actions.indexOf("export async function createOrderAction"), actions.indexOf("export async function", actions.indexOf("export async function createOrderAction") + 10));
      assert.match(create, /parseIdempotencyKey\(formData\)/, "creating an order requires a key");
    });

    it("repeating a status move is refused (safe), and confirming twice cannot re-fix or change the deposit", () => {
      const id = make(one(150000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      const fixed = orderRow(id);
      refused(attempt(AS.sam, `select admin.transition_order('${id}', 'awaiting_deposit')`), /an order cannot move from awaiting_deposit to awaiting_deposit/);
      assert.equal(orderRow(id), fixed);
      assert.equal(auditCount(id, "order.transition"), 1);
    });

    it("RACE: two payments of the whole balance at the same moment: exactly ONE is recorded (the order row is locked), paid never exceeds the total", async () => {
      const id = make(one(100000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      const first = `begin;\n${AS.olivia}select admin.record_payment('${id}', 'deposit', 100000, 'cash');\nselect pg_sleep(1.5);\ncommit;`;
      const second = `begin;\n${AS.olivia}select admin.record_payment('${id}', 'deposit', 100000, 'cash');\ncommit;`;
      const [a, b] = await Promise.all([asyncPsql(first), sleep(500).then(() => asyncPsql(second))]);
      assert.equal([a.ok, b.ok].filter(Boolean).length, 1, `exactly one succeeds: ${JSON.stringify({ a, b })}`);
      assert.match((a.ok ? b : a).err, /this payment would exceed the order total/);
      assert.equal(orderRow(id), "100000|15000|2500|3|t|100000|0|awaiting_deposit".replace("2500", "1500"));
      assert.equal(paymentsOf(id).length, 1);
    });

    it("RACE: the final payment and the delivery at the same moment, in either order: exactly ONE award", async () => {
      for (const first of ["payment", "delivery"]) {
        const id = lifecycle(300000, { paid: 45000, deliver: false });
        const payment = `${AS.olivia}select admin.record_payment('${id}', 'balance', 255000, 'cash');`;
        const delivery = `${AS.sam}select admin.transition_order('${id}', 'delivered');`;
        const [a, b] = await Promise.all([
          asyncPsql(`begin;\n${first === "payment" ? payment : delivery}\nselect pg_sleep(1.5);\ncommit;`),
          sleep(500).then(() => asyncPsql(`begin;\n${first === "payment" ? delivery : payment}\ncommit;`)),
        ]);
        assert.ok(a.ok && b.ok, `${first} first: ${JSON.stringify({ a, b })}`);
        assert.deepEqual(ledgerOf(id), ["award:300"], `${first} first`);
        assert.equal(orderRow(id), "300000|45000|1500|3|t|300000|0|delivered");
      }
    });

    it("RACE: two deliveries at the same moment: one wins, one is refused, and there is one history row and one award", async () => {
      const id = lifecycle(200000, { deliver: false });
      const deliver = (who) => `${who}select admin.transition_order('${id}', 'delivered');`;
      const [a, b] = await Promise.all([asyncPsql(`begin;\n${deliver(AS.sam)}\nselect pg_sleep(1.5);\ncommit;`), sleep(500).then(() => asyncPsql(`begin;\n${deliver(AS.olivia)}\ncommit;`))]);
      assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
      assert.match((a.ok ? b : a).err, /an order cannot move from delivered to delivered/);
      assert.equal(historyOf(id).filter((h) => h.endsWith(">delivered")).length, 1);
      assert.deepEqual(ledgerOf(id), ["award:200"]);
    });
  });

  // =================================================================================================================
  describe("S5: authorization. Staff cannot bypass the payment, MFA-claim or permission rules", () => {
    let id;
    let payId;
    before(() => {
      id = make(one(300000), { customer: CUST_C });
      move(id, "awaiting_deposit");
      payId = pay(id, 10000);
    });

    it("ordinary staff (10 permissions) can run the order desk; they cannot touch money, loyalty, finance, audit, policy or staff", () => {
      const allowed = [
        `select admin.create_customer('Walk-in Test', '+97455550077', null, 'walk_in', 'en', null)`,
        `select admin.list_orders(null, null, 10, 0)`,
        `select admin.get_order('${id}')`,
        `select admin.search_customers('Test', 10)`,
        `select admin.publish_tracking_event('${id}', 'Test update', 'A staff-published update.', 'awaiting_deposit')`,
        `select admin.add_order_note('${id}', 'an internal note')`,
      ];
      for (const sql of allowed) assert.equal(attempt(AS.sam, sql), "OK", sql);
      const forbidden = [
        ["payments.record", `select admin.record_payment('${id}', 'deposit', 100, 'cash')`],
        ["payments.reverse", `select admin.reverse_payment('${payId}', 'staff trying to reverse')`],
        ["payments.read", `select admin.list_payments(10, 0)`],
        ["loyalty.read", `select admin.list_loyalty(null, 10)`],
        ["loyalty.adjust", `select admin.adjust_loyalty('${CUST_C}', 10, 'staff trying')`],
        ["finance.read", `select * from admin.get_order_financials('${id}')`],
        ["audit.read", `select admin.list_audit(10)`],
        ["policies.read", `select * from admin.list_policies()`],
        ["policies.manage", `select admin.set_policy('orders.deposit', '{}'::jsonb, 'confirmed_by_owner', 'staff trying')`],
        ["staff.manage", `select admin.list_staff()`],
        ["staff.manage", `select admin.set_staff_member('${ID.sam}', 'owner', true, 'Sam', 'promote myself')`],
      ];
      for (const [permission, sql] of forbidden) refused(attempt(AS.sam, sql), new RegExp(`permission denied: ${permission.replace(".", "\\.")} is required`), sql);
      assert.deepEqual(paymentsOf(id), ["10000:cash:deposit"], "nothing leaked through");
    });

    it("the owner can do all of it", () => {
      for (const sql of [`select admin.list_payments(10, 0)`, `select admin.list_audit(10)`, `select admin.list_loyalty(null, 10)`, `select * from admin.list_policies()`, `select admin.record_payment('${id}', 'deposit', 100, 'cash')`])
        assert.equal(attempt(AS.olivia, sql), "OK", sql);
    });

    it("MFA claim: the same owner WITHOUT a verified second factor (aal1, or no aal claim at all) is refused everything, and has no permissions", () => {
      const aal1 = AS.oliviaAal1;
      const noAal = asRole({ sub: ID.olivia, aal: null });
      for (const who of [aal1, noAal]) {
        assert.equal(read(`select count(*) from admin.my_permissions()`, who), "0", "no permissions without aal2");
        for (const sql of [`select admin.list_payments(10, 0)`, `select admin.list_orders(null, null, 5, 0)`, `select admin.record_payment('${id}', 'deposit', 100, 'cash')`, `select admin.transition_order('${id}', 'on_hold')`, `select admin.create_customer('X', null, null, 'walk_in', 'en', null)`, `select admin.list_audit(5)`])
          refused(attempt(who, sql), /permission denied/, sql);
      }
      assert.equal(read(`select count(*) from admin.my_permissions()`, AS.olivia), "21");
      assert.equal(read(`select count(*) from admin.my_permissions()`, AS.sam), "10");
    });

    // REGRESSION (DEFECT-2, fixed by migration 20261121120000): admin.transition_order used to validate the move BEFORE it checked the
    // permission, so a caller signed in to the database with no permission (a stranger, a customer, inactive staff, an owner
    // without a second factor) who knew an order id was told its current status in the error text. Authorization now comes first.
    it("REGRESSION (DEFECT-2): a caller without permission learns nothing about an order from a refused move: the permission error comes first", () => {
      // 'delivered' is an INVALID move from awaiting_deposit; a caller with no permission must still be told only "permission denied".
      const probe = `select admin.transition_order('${id}', 'delivered')`;
      for (const [who, name] of [[AS.eve, "a signed-in stranger"], [AS.alice, "a customer"], [AS.oliviaAal1, "the owner without a second factor"], [AS.dana, "inactive staff"], [AS.forgedAdmin, "forged admin claims"]]) {
        const r = attempt(who, probe);
        if (process.env.WORKFLOW_TEST_VERBOSE) console.log(`REFUSAL [order-status probe by ${name}] => ${r}`);
        assert.match(r, /^REFUSED: permission denied/, `${name} must get a permission error, not an order status: ${r}`);
        assert.doesNotMatch(r, /awaiting_deposit/, `${name} must not learn the order's status`);
      }
      const anon = attempt(AS.anon, probe);
      assert.match(anon, /^REFUSED: /);
      assert.doesNotMatch(anon, /awaiting_deposit/);
    });

    it("forged claims change nothing: a customer carrying aal2 and admin/owner metadata is still a customer; a signed-in non-staff and an inactive staff member are refused", () => {
      for (const who of [AS.forgedAdmin, AS.eve, AS.dana]) {
        assert.equal(read(`select count(*) from admin.my_permissions()`, who), "0");
        refused(attempt(who, `select admin.list_orders(null, null, 5, 0)`), /permission denied/);
        refused(attempt(who, `select admin.record_payment('${id}', 'deposit', 100, 'cash')`), /permission denied/);
      }
    });

    it("through the gateway the database does not take the claims' word for the second factor: no session row, a first-factor row, or another person's row is refused; a live aal2 row works", () => {
      const gateway = ({ sub = ID.olivia, aal = "aal2", sid = SID } = {}) =>
        `reset role;\nreset session authorization;\nset session authorization m1_staff_gateway;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated", aal, session_id: sid })}', true);\n`;
      const session = (sid, user, aal = "aal2") => `reset role;\nreset session authorization;\ninsert into auth.sessions (id, user_id, aal) values ('${sid}', '${user}', '${aal}');\n`;
      const call = `select admin.list_payments(5, 0);`;
      const gatewayRefusal = (script, label) => {
        const r = db.run(script);
        assert.ok(!r.ok, `${label}: expected a refusal but the call succeeded`);
        if (process.env.WORKFLOW_TEST_VERBOSE) console.log(`REFUSAL [gateway: ${label}] => ${r.err.slice(0, 200)}`);
        assert.match(r.err, /permission denied/, label);
      };
      gatewayRefusal(`${gateway()}${call}`, "claims say aal2 but there is no session row");
      gatewayRefusal(`${session(SID, ID.olivia, "aal1")}${gateway()}${call}`, "the session row is first factor only");
      gatewayRefusal(`${session(SID_OTHER, ID.sam, "aal2")}${gateway({ sid: SID_OTHER })}${call}`, "another person's session row");
      gatewayRefusal(`${session(SID, ID.olivia, "aal2")}${gateway({ aal: "aal1" })}${call}`, "a live aal2 row but the token claims only aal1");
      assert.ok(db.run(`${session(SID, ID.olivia, "aal2")}${gateway()}${call}`).ok, "a live second-factor session of the same person works");
    });

    it("nobody can write money or status directly: not staff, not the owner at aal2, not the service role; the order is unchanged", () => {
      const before = orderRow(id);
      for (const who of [AS.sam, AS.olivia, AS.service, AS.alice])
        for (const sql of [
          `update public.orders set status = 'delivered' where id = '${id}'`,
          `update public.orders set amount_paid_minor = 300000 where id = '${id}'`,
          `update public.orders set balance_due_minor = 0 where id = '${id}'`,
          `update public.orders set total_minor = 1 where id = '${id}'`,
          `insert into public.payments (order_id, entry_type, purpose, amount_minor, method, receipt_number) values ('${id}', 'payment', 'balance', 290000, 'cash', 'FORGED-1')`,
          `insert into public.loyalty_ledger (customer_id, order_id, entry_type, points) values ('${CUST_C}', '${id}', 'award', 9999)`,
          `delete from public.orders where id = '${id}'`,
        ]) refused(attempt(who, sql), /permission denied for table|can only be updated to DEFAULT/, `${sql}`);
      assert.equal(orderRow(id), before);
      assert.deepEqual(ledgerOf(id), []);
    });
  });

  // =================================================================================================================
  describe("S6: isolation. Customers cannot reach other customers' data or any staff operation", () => {
    let aliceOrder;
    let bobOrder;
    before(() => {
      aliceOrder = lifecycle(200000, { customer: ID.custA }); // paid in full and delivered: it has items, payments, points
      bobOrder = lifecycle(100000, { customer: ID.custB });
      act(AS.sam, `select admin.publish_tracking_event('${aliceOrder}', 'Alice update', 'only for Alice', 'building');`);
    });

    it("Bob sees none of Alice's rows in any customer table, by filter or by guessing the id; Alice sees none of Bob's; a stranger and a visitor see none", () => {
      const tables = [["orders", "id"], ["order_items", "order_id"], ["payments", "order_id"], ["order_tracking_events", "order_id"], ["loyalty_ledger", "order_id"]];
      const probe = (table, column, id) => `select count(*) from public.${table} where ${column} = '${id}'`;
      for (const [table, column] of tables) {
        // A positive control first: the owner CAN read the rows, so a zero below means "hidden", not "never existed".
        assert.ok(Number(rowsSeen(AS.alice, probe(table, column, aliceOrder))) >= 1, `Alice reads her own ${table}`);
        assert.ok(Number(rowsSeen(AS.bob, probe(table, column, bobOrder))) >= 1 || table === "order_tracking_events", `Bob reads his own ${table}`);
        assert.equal(rowsSeen(AS.bob, probe(table, column, aliceOrder)), "0", `Bob reading ${table} of Alice's order`);
        assert.equal(rowsSeen(AS.alice, probe(table, column, bobOrder)), "0", `Alice reading ${table} of Bob's order`);
        assert.equal(rowsSeen(AS.eve, probe(table, column, aliceOrder)), "0", `a signed-in stranger reading ${table}`);
        assert.match(rowsSeen(AS.anon, probe(table, column, aliceOrder)), /^(0|DENIED)$/, `a visitor reading ${table}`);
      }
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.orders where customer_id = '${ID.custA}'`), "0");
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.customers where id = '${ID.custA}'`), "0", "Bob cannot read Alice's profile");
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.loyalty_balances where customer_id = '${ID.custA}'`), "0");
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.customer_accounts where user_id = '${ID.alice}'`), "0");
      assert.equal(rowsSeen(AS.alice, `select count(*) from public.loyalty_balances where customer_id = '${ID.custA}'`), "1", "Alice reads her own balance");
    });

    it("each customer sees exactly their own orders: Alice's list never includes Bob's, and the lifecycle points are only on the owner's balance", () => {
      const aliceOrders = lines(read(`select id from public.orders order by id`, AS.alice));
      assert.ok(aliceOrders.includes(aliceOrder) && !aliceOrders.includes(bobOrder));
      const bobOrders = lines(read(`select id from public.orders order by id`, AS.bob));
      assert.ok(bobOrders.includes(bobOrder) && !bobOrders.includes(aliceOrder));
      assert.ok(Number(read(`select coalesce(sum(balance_points), 0) from public.loyalty_balances`, AS.alice)) > 0);
      assert.equal(read(`select coalesce(sum(points), 0) from public.loyalty_ledger where order_id = '${aliceOrder}'`, AS.alice), "200");
    });

    it("a customer cannot run any staff function, read any private table, or write any order, payment, tracking or loyalty row", () => {
      for (const sql of [
        `select admin.list_orders(null, null, 5, 0)`,
        `select admin.record_payment('${aliceOrder}', 'deposit', 1, 'cash')`,
        `select admin.transition_order('${aliceOrder}', 'cancelled')`,
        `select admin.award_loyalty_for_order('${aliceOrder}')`,
        `select admin.list_audit(5)`,
        `select * from private.audit_log`,
        `select * from private.staff_members`,
        `select * from private.payment_details`,
        `select * from private.order_status_history`,
        `update public.orders set status = 'delivered' where id = '${aliceOrder}'`,
        `insert into public.payments (order_id, entry_type, purpose, amount_minor, method, receipt_number) values ('${aliceOrder}', 'payment', 'balance', 1, 'cash', 'X-1')`,
        `insert into public.order_tracking_events (order_id, title) values ('${aliceOrder}', 'forged')`,
        `insert into public.loyalty_ledger (customer_id, order_id, entry_type, points) values ('${ID.custA}', '${aliceOrder}', 'award', 5000)`,
      ]) {
        const r = attempt(AS.alice, sql);
        assert.match(r, /^REFUSED: /, `a customer must not be able to: ${sql} (${r})`);
      }
      assert.equal(read(`select count(*) from admin.my_permissions()`, AS.alice).trim(), "0");
    });

    it("a customer can edit only their own contact details, never their code, source, id or another customer's record", () => {
      refused(attempt(AS.alice, `update public.customers set source = 'instagram' where id = '${ID.custA}'`), /permission denied for table customers/, "source");
      refused(attempt(AS.alice, `update public.customers set customer_code = 'C-HACK' where id = '${ID.custA}'`), /permission denied for table customers/, "code");
      assert.equal(read(`with u as (update public.customers set full_name = 'Alice Renamed' where id = '${ID.custA}' returning 1) select count(*) from u`, AS.alice), "1", "positive control: she CAN edit her own name");
      assert.equal(read(`with u as (update public.customers set full_name = 'Alice Renamed' where id = '${ID.custB}' returning 1) select count(*) from u`, AS.alice), "0", "Bob's record: no row is touched");
    });
  });

  // =================================================================================================================
  describe("repeated loyalty operations, and the balance floor [ASSUMPTION OQ-0010: a balance may not go negative]", () => {
    const balanceOf = (customer) => Number(read(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${customer}'`));

    it("[PLAT-0004, GAP-3] the same manual adjustment submitted twice WITHOUT a key (a direct call) still records two entries; with a key it records one (see idempotency.db.test.mjs)", () => {
      const before = balanceOf(CUST_C);
      act(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 40, 'goodwill adjustment');`);
      act(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 40, 'goodwill adjustment');`);
      assert.equal(balanceOf(CUST_C), before + 80);
    });

    it("an adjustment of zero, without a reason, or for an unknown customer is refused", () => {
      refused(attempt(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 0, 'nothing')`), /non-zero number of points/);
      refused(attempt(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 10, '')`), /a reason is required for a loyalty adjustment/);
      refused(attempt(AS.olivia, `select admin.adjust_loyalty('00000000-0000-4000-8000-00000000dead', 10, 'who is this')`), /customer not found/);
    });

    it("a deduction larger than the balance is refused and changes nothing", () => {
      const before = balanceOf(CUST_C);
      refused(attempt(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', ${-(before + 1)}, 'too much')`), /would make the balance negative/);
      assert.equal(attempt(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', ${-before}, 'exactly the balance')`), "OK", "down to exactly zero is allowed");
      assert.equal(balanceOf(CUST_C), before, "the probe was rolled back");
    });

    it("an award is reversed once; a second reversal is refused; an order that earned nothing has nothing to reverse; and the award is not re-issued afterwards", () => {
      const id = lifecycle(100000, { customer: CUST_C }); // 100 points
      assert.deepEqual(ledgerOf(id), ["award:100"]);
      refused(attempt(AS.sam, `select admin.reverse_loyalty_award('${id}', 'staff trying')`), /permission denied: loyalty.adjust is required/);
      act(AS.olivia, `select admin.reverse_loyalty_award('${id}', 'order was returned');`);
      assert.deepEqual(ledgerOf(id), ["award:100", "reversal:-100"]);
      refused(attempt(AS.olivia, `select admin.reverse_loyalty_award('${id}', 'again')`), /this award has already been reversed/);
      assert.equal(lines(read(`select admin.award_loyalty_for_order('${id}') is not null`, AS.olivia)).pop(), "t");
      assert.deepEqual(ledgerOf(id), ["award:100", "reversal:-100"], "asking for the award again does not give the points back");
      const none = make(one(100000), { customer: CUST_C });
      refused(attempt(AS.olivia, `select admin.reverse_loyalty_award('${none}', 'nothing to reverse')`), /this order has no loyalty award to reverse/);
    });

    it("[OBSERVED] the automatic award leaves no audit row of its own (the delivery and the payment that triggered it are audited)", () => {
      const id = lifecycle(100000, { customer: CUST_C });
      assert.deepEqual(ledgerOf(id), ["award:100"]);
      assert.equal(auditCount(id, "loyalty.awarded"), 0);
      assert.equal(read(`select count(*) from private.audit_log where action like 'loyalty.%' and entity_id = '${id}'`), "0");
      assert.equal(auditCount(id, "order.transition") > 0, true);
    });
  });

  // =================================================================================================================
  describe("ledger-wide invariants: after every scenario above, over EVERY order, payment and loyalty entry in the database", () => {
    it("orders: paid equals the sum of payment rows, balance equals total minus paid, 0 <= paid <= total, deposit <= total", () => {
      const bad = read(`select o.order_ref || ' total=' || o.total_minor || ' paid=' || o.amount_paid_minor || ' balance=' || o.balance_due_minor || ' ledger=' || coalesce(p.s, 0)
        from public.orders o left join (select order_id, sum(amount_minor) s from public.payments group by order_id) p on p.order_id = o.id
        where o.amount_paid_minor is distinct from coalesce(p.s, 0) or o.balance_due_minor <> o.total_minor - o.amount_paid_minor
           or o.amount_paid_minor < 0 or o.amount_paid_minor > o.total_minor or o.deposit_required_minor < 0 or o.deposit_required_minor > o.total_minor
           or o.total_minor is distinct from (select coalesce(sum(i.line_total_minor), 0) from public.order_items i where i.order_id = o.id)`);
      assert.equal(bad, "", `orders that break an invariant: ${bad}`);
      assert.ok(Number(read(`select count(*) from public.orders`)) >= 30, "a meaningful number of orders were checked");
    });

    it("payments: every reversal is the exact negative of one payment, no payment is reversed twice, every payment has a unique receipt (a reversal has none)", () => {
      assert.equal(read(`select count(*) from public.payments r join public.payments o on o.id = r.reverses_payment_id where r.amount_minor <> -o.amount_minor`), "0");
      assert.equal(read(`select count(*) from (select reverses_payment_id from public.payments where reverses_payment_id is not null group by 1 having count(*) > 1) t`), "0");
      assert.equal(read(`select count(*) from public.payments where reverses_payment_id is null and amount_minor <= 0`), "0");
      const noReceipt = read(`select o.order_ref || ' ' || p.entry_type || ' ' || p.amount_minor || ' ' || p.method from public.payments p join public.orders o on o.id = p.order_id where p.entry_type = 'payment' and p.receipt_number is null`);
      assert.equal(noReceipt, "", `payments without a receipt number: ${noReceipt}`);
      assert.equal(read(`select count(receipt_number) - count(distinct receipt_number) from public.payments`), "0");
      // [OBSERVED] a reversal is a correcting row and carries no receipt number of its own.
      assert.equal(read(`select count(*) from public.payments where entry_type = 'reversal' and receipt_number is not null`), "0");
    });

    it("audit: every payment and every reversal is audited exactly once; every order was created once and its last history row is its status", () => {
      assert.equal(read(`select count(*) from public.payments p where p.reverses_payment_id is null and (select count(*) from private.audit_log a where a.action = 'payment.recorded' and a.entity_id = p.id::text) <> 1`), "0");
      assert.equal(read(`select count(*) from public.payments p where p.reverses_payment_id is not null and (select count(*) from private.audit_log a where a.action = 'payment.reversed' and a.entity_id = p.id::text) <> 1`), "0");
      assert.equal(read(`select count(*) from public.orders o where (select count(*) from private.audit_log a where a.action = 'order.created' and a.entity_id = o.id::text) <> 1`), "0");
      assert.equal(read(`select count(*) from public.orders o where o.status is distinct from (select to_status from private.order_status_history h where h.order_id = o.id order by h.id desc limit 1)`), "0");
    });

    it("loyalty: the balance view equals the sum of the ledger, no balance is negative, at most one award per order, and every award is on a delivered order for floor(total / 1000) points [ASSUMPTION OQ-0007]", () => {
      assert.equal(read(`select count(*) from public.loyalty_balances b where b.balance_points <> (select sum(points) from public.loyalty_ledger l where l.customer_id = b.customer_id)`), "0");
      assert.equal(read(`select count(*) from (select customer_id, sum(points) s from public.loyalty_ledger group by 1) t where s < 0`), "0");
      assert.equal(read(`select count(*) from (select order_id from public.loyalty_ledger where entry_type = 'award' group by 1 having count(*) > 1) t`), "0");
      assert.equal(read(`select count(*) from public.loyalty_ledger l join public.orders o on o.id = l.order_id where l.entry_type = 'award' and (o.status <> 'delivered' or l.points <> o.total_minor / 1000)`), "0");
      assert.ok(Number(read(`select count(*) from public.loyalty_ledger where entry_type = 'award'`)) >= 10);
    });
  });
});

/** An existing payment id is needed only for the "empty reason" probe; any well-formed uuid is refused first on the reason. */
function S1_REVERSE_ID() {
  return "00000000-0000-4000-8000-00000000beef";
}
