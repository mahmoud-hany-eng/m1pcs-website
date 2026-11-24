// PLAT-0004: durable idempotency of the three operations that create money or ledger records (record a payment, create an
// order, adjust loyalty points), proved against a REAL PostgreSQL 16 server with the REAL migrations and the REAL staff gateway role.
// This suite runs on the database in its EXPAND state (every migration applied, the contract step NOT applied): the state the first
// release leaves behind. supabase/tests/release.db.test.mjs proves the expand/contract sequence itself, and
// supabase/tests/idempotency.window.db.test.mjs proves the replay window, reversed payments, the expected paid amount, two-person
// and multi-tab behaviour and the security ordering.
//
// What is exercised, and how:
//   * the PRODUCTION statements: the SQL text for create_order and record_payment is read out of src/lib/staff/gateway.ts and
//     executed under the m1_staff_gateway role (PREPARE / EXECUTE), with the second-factor session row the database re-checks,
//     so a drift between the website and the database fails here;
//   * replay: an identical repeat returns the ORIGINAL record and creates nothing (no second payment, order, ledger entry,
//     receipt, history row or audit row);
//   * conflict: the same key with different data is refused and creates nothing, and says nothing about the original;
//   * races: many REAL parallel sessions submitting the same key (identical, and conflicting);
//   * timeouts and retries: a statement that times out, a client that is killed mid-transaction, a response that is lost;
//   * isolation: keys belong to one staff member, never return another person's record, and are unreadable to every API role.
//
// It says nothing about the website screens (they need a real second factor; see WORKFLOW_TESTS.md) or about Supabase Auth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { CUST_C, ONE, PAT, SESSION, UUID, lines, lit, makeHelpers, newKey, seedIdempotencyFixtures, sleep } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

suite("idempotency (PLAT-0004): a repeated or retried request never creates a second payment, order or loyalty entry", () => {
  let db;
  let h = {};
  // Late-bound shortcuts to the shared helpers (the database exists only once `before` has run).
  const read = (...a) => h.read(...a);
  const scalar = (...a) => h.scalar(...a);
  const attempt = (...a) => h.attempt(...a);
  const rowsSeen = (...a) => h.rowsSeen(...a);
  const refused = (...a) => h.refused(...a);
  const confirmed = (...a) => h.confirmed(...a);
  const count = (...a) => h.count(...a);
  const paymentsOf = (...a) => h.paymentsOf(...a);
  const keyRows = (...a) => h.keyRows(...a);
  const gatewayPrefix = (...a) => h.gatewayPrefix(...a);
  const productionSql = (...a) => h.productionSql(...a);
  const gatewayCall = (...a) => h.gatewayCall(...a);
  const viaGateway = (...a) => h.viaGateway(...a);
  const pay = (...a) => h.pay(...a);
  const createOrder = (...a) => h.createOrder(...a);
  const adjustViaGateway = (...a) => h.adjustViaGateway(...a);
  const asyncPsql = (...a) => h.asyncPsql(...a);
  const parallel = (...a) => h.parallel(...a);
  let OLIVIA;
  let SAM;
  let PATRICK;

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
    ({ OLIVIA, SAM, PATRICK } = h);
  });
  after(() => db?.stop());

  // =================================================================================================================
  describe("the production path: the gateway REQUIRES a key, and the website's own statements carry one", () => {
    it("the website's record_payment and create_order statements carry the key (and the expected paid amount), report whether the answer is a repeat, and work end to end under the gateway role", () => {
      const sql = productionSql("record_payment");
      assert.match(sql, /\$7::text, \$8::bigint\) as r\) select r, coalesce\(current_setting\('m1\.replayed', true\), ''\) = 'true' as replayed from c$/, "record_payment passes the key as its 7th parameter and the expected paid amount as its 8th");
      assert.match(productionSql("create_order"), /\$5::text\) as r\) select r, coalesce\(current_setting\('m1\.replayed', true\), ''\) = 'true' as replayed from c$/, "create_order passes the key as its 5th parameter");
      assert.match(productionSql("similar_orders"), /admin\.similar_orders\(\$1::uuid, \$2::jsonb, \$3::text\)/);
      const order = confirmed(200000);
      const key = newKey("pay");
      const p = pay(OLIVIA, order, 30000, key);
      assert.ok(p.ok, p.err);
      assert.match(p.id, UUID);
      assert.equal(p.replayed, false, "a first answer is not a repeat");
      assert.equal(paymentsOf(order), 1);
      const again = pay(OLIVIA, order, 30000, key);
      assert.equal(again.id, p.id);
      assert.equal(again.replayed, true, "the repeat says it is one, so the screen can say 'already recorded'");
      const o = createOrder(SAM, ID.custA, ONE(50000), newKey("ord"));
      assert.ok(o.ok, o.err);
      assert.match(o.id, UUID);
      assert.equal(o.replayed, false);
    });

    it("a request WITHOUT a key or WITHOUT the expected paid amount is refused through the gateway (the new statements fail closed); nothing is recorded or created", () => {
      const order = confirmed();
      const before = count(`select count(*) from public.payments`);
      const orders = count(`select count(*) from public.orders`);
      const noKey = viaGateway(OLIVIA, "record_payment", [order, "deposit", 15000, "cash", null, null, null, 0]);
      assert.equal(noKey.ok, false);
      assert.match(noKey.err, /an idempotency key is required/);
      const noExpected = viaGateway(OLIVIA, "record_payment", [order, "deposit", 15000, "cash", null, null, newKey("pay"), null]);
      assert.equal(noExpected.ok, false);
      assert.match(noExpected.err, /the amount already paid on the order must be supplied/);
      const noOrderKey = viaGateway(OLIVIA, "create_order", [CUST_C, JSON.stringify(ONE(1000)), null, null, null]);
      assert.equal(noOrderKey.ok, false);
      assert.match(noOrderKey.err, /an idempotency key is required/);
      const noLoyalty = adjustViaGateway(OLIVIA, CUST_C, 5, "goodwill adjustment", null);
      assert.equal(noLoyalty.ok, false);
      assert.match(noLoyalty.err, /an idempotency key is required/);
      assert.equal(count(`select count(*) from public.payments`), before, "nothing was recorded");
      assert.equal(count(`select count(*) from public.orders`), orders, "nothing was created");
    });

    it("EXPAND state: the deployed PLAT-0003 website's key-less statements still work through the gateway, exactly as before (the contract step, not this one, closes them)", () => {
      const order = confirmed();
      const oldPayment = viaGateway(OLIVIA, "record_payment", [order, "deposit", 15000, "cash", null, null], "select admin.record_payment($1::uuid, $2::text, $3::bigint, $4::text, now(), null, $5::text, $6::text) as r");
      assert.ok(oldPayment.ok, oldPayment.err);
      assert.equal(paymentsOf(order), 1);
      const oldOrder = viaGateway(SAM, "create_order", [CUST_C, JSON.stringify(ONE(1000)), null, null], "select admin.create_order($1::uuid, $2::jsonb, null, 'admin', $3::text, $4::text) as r");
      assert.ok(oldOrder.ok, oldOrder.err);
      assert.match(oldOrder.id, UUID);
    });

    it("a malformed key is refused before anything is touched", () => {
      const order = confirmed();
      for (const bad of ["short", "x".repeat(101), "has space in it", "semi;colon-key-12345", "quote'key-12345678", "new\nline-key-123456"]) {
        const r = pay(OLIVIA, order, 15000, bad);
        assert.equal(r.ok, false, JSON.stringify(bad));
        assert.match(r.err, /the idempotency key must be 8 to 100 letters, digits or \. _ : -/, JSON.stringify(bad));
      }
      assert.equal(paymentsOf(order), 0);
    });

    it("a direct database caller (not the gateway) may omit the key, as before: no protection, and no change in behaviour", () => {
      const order = confirmed();
      db.commit(`${AS.olivia}select admin.record_payment('${order}', 'deposit', 5000, 'cash');`);
      db.commit(`${AS.olivia}select admin.record_payment('${order}', 'deposit', 5000, 'cash');`);
      assert.equal(paymentsOf(order), 2, "key-less direct calls are not deduplicated (documented)");
      assert.equal(count(`select count(*) from private.idempotency_keys where result_id in (select id from public.payments where order_id = '${order}')`), 0);
    });
  });

  // =================================================================================================================
  describe("GAP-1: recording a payment", () => {
    it("the same request twice returns the SAME payment: one payment row, one receipt, one audit entry, paid counted once", () => {
      const order = confirmed(200000);
      const key = newKey("pay");
      const first = pay(OLIVIA, order, 30000, key, { reference: "FAWRAN-REF-1", notes: "internal note" });
      const second = pay(OLIVIA, order, 30000, key, { reference: "FAWRAN-REF-1", notes: "internal note" });
      const third = pay(OLIVIA, order, 30000, key, { reference: "FAWRAN-REF-1", notes: "internal note" });
      assert.ok(first.ok && second.ok && third.ok, JSON.stringify([first.err, second.err, third.err]));
      assert.equal(second.id, first.id);
      assert.equal(third.id, first.id);
      assert.equal(paymentsOf(order), 1);
      assert.equal(count(`select amount_paid_minor from public.orders where id = '${order}'`), 30000);
      assert.equal(count(`select count(*) from private.audit_log where action = 'payment.recorded' and details ->> 'order_id' = '${order}'`), 1);
      assert.equal(count(`select count(*) from private.payment_details where payment_id = '${first.id}'`), 1);
      assert.equal(count(`select count(distinct receipt_number) from public.payments where order_id = '${order}'`), 1);
      assert.equal(keyRows(key), 1);
    });

    it("a retry still succeeds after the order has moved on: replay is checked before the order's state (paid in full, cancelled)", () => {
      const order = confirmed(100000);
      const key = newKey("pay");
      const first = pay(OLIVIA, order, 100000, key);
      assert.ok(first.ok, first.err);
      // Another payment of the same size would now exceed the total, but the RETRY of the original is not another payment.
      assert.equal(pay(OLIVIA, order, 100000, newKey("pay")).ok, false, "a genuinely new payment is still refused by the cap");
      const retry = pay(OLIVIA, order, 100000, key);
      assert.ok(retry.ok, retry.err);
      assert.equal(retry.id, first.id);
      db.commit(`${AS.sam}select admin.transition_order('${order}', 'on_hold', 'test');`);
      db.commit(`${AS.sam}select admin.transition_order('${order}', 'cancelled', 'test');`);
      assert.equal(pay(OLIVIA, order, 100000, key).id, first.id, "even after cancellation, the retry returns the original");
      assert.equal(paymentsOf(order), 1);
    });

    it("the same key with ANY different data is refused and records nothing: amount, order, purpose, method, reference, note", () => {
      const order = confirmed(300000, CUST_C);
      const other = confirmed(300000, CUST_C);
      const key = newKey("pay");
      const first = pay(OLIVIA, order, 10000, key);
      assert.ok(first.ok, first.err);
      const variants = [
        [order, 10001, {}, "amount"],
        [other, 10000, {}, "order"],
        [order, 10000, { purpose: "balance" }, "purpose"],
        [order, 10000, { method: "fawran" }, "method"],
        [order, 10000, { reference: "other-ref" }, "reference"],
        [order, 10000, { notes: "a different note" }, "note"],
        [order, 10000, { expected: 5 }, "expected paid amount"],
      ];
      for (const [orderId, amount, extra, label] of variants) {
        const r = pay(OLIVIA, orderId, amount, key, extra);
        assert.equal(r.ok, false, label);
        assert.match(r.err, /this idempotency key was already used for a different request; nothing was changed/, label);
        assert.doesNotMatch(r.err, new RegExp(first.id), `${label}: the conflict says nothing about the original record`);
      }
      assert.equal(paymentsOf(order), 1);
      assert.equal(paymentsOf(other), 0, "the other order was not touched");
      assert.equal(count(`select amount_minor from public.payments where id = '${first.id}'`), 10000, "the original is unchanged");
      assert.equal(keyRows(key), 1);
    });

    it("a FAILED attempt does not use up its key: the failure rolls the claim back, and the corrected retry with the same key succeeds", () => {
      const order = confirmed(100000);
      const key = newKey("pay");
      const tooMuch = pay(OLIVIA, order, 100001, key);
      assert.equal(tooMuch.ok, false);
      assert.match(tooMuch.err, /this payment would exceed the order total/);
      assert.equal(keyRows(key), 0, "no claim survived the failure");
      const fixed = pay(OLIVIA, order, 15000, key);
      assert.ok(fixed.ok, fixed.err);
      assert.equal(paymentsOf(order), 1);
      assert.equal(keyRows(key), 1);
    });

    it("two DIFFERENT keys with identical data are two intended payments (the database cannot know otherwise); the order-total cap still protects the order", () => {
      const order = confirmed(100000);
      assert.ok(pay(OLIVIA, order, 60000, newKey("pay")).ok);
      assert.ok(pay(OLIVIA, order, 60000, newKey("pay")).ok === false, "the second 60 000 would exceed the 100 000 total");
      assert.equal(paymentsOf(order), 1);
      assert.ok(pay(OLIVIA, order, 20000, newKey("pay")).ok);
      assert.ok(pay(OLIVIA, order, 20000, newKey("pay")).ok);
      assert.equal(paymentsOf(order), 3);
      assert.equal(count(`select amount_paid_minor from public.orders where id = '${order}'`), 100000);
    });

    it("loyalty and the ledger stay exact: a retried FINAL payment on a delivered order awards the points once", () => {
      const order = confirmed(200000);
      db.commit(`${AS.olivia}select admin.record_payment('${order}', 'deposit', 30000, 'cash');`);
      for (const s of ["deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"]) db.commit(`${AS.sam}select admin.transition_order('${order}', '${s}');`);
      assert.equal(count(`select count(*) from public.loyalty_ledger where order_id = '${order}'`), 0, "delivered with a balance due: no points yet");
      const key = newKey("final");
      for (let i = 0; i < 4; i++) assert.ok(pay(OLIVIA, order, 170000, key, { purpose: "balance" }).ok);
      assert.equal(scalar(`select string_agg(entry_type || ':' || points, ',') from public.loyalty_ledger where order_id = '${order}'`), "award:200");
      assert.equal(count(`select amount_paid_minor from public.orders where id = '${order}'`), 200000);
    });

    it("RACE: eight parallel sessions submit the SAME payment: all succeed with the SAME id, exactly one payment exists", async () => {
      const order = confirmed(100000);
      const key = newKey("race");
      const params = [order, "deposit", 15000, "cash", null, null, key, 0];
      const first = parallel(OLIVIA, "record_payment", params, { holdSeconds: 1.2 }); // holds the claim while the others arrive
      await sleep(300);
      const rest = Array.from({ length: 7 }, () => parallel(OLIVIA, "record_payment", params));
      const results = await Promise.all([first, ...rest]);
      assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.err)));
      assert.equal(new Set(results.map((r) => r.id)).size, 1, "everyone got the same payment id");
      assert.equal(paymentsOf(order), 1);
      assert.equal(count(`select amount_paid_minor from public.orders where id = '${order}'`), 15000);
      assert.equal(keyRows(key), 1);
    });

    it("RACE: parallel sessions with the SAME key but DIFFERENT amounts: exactly one is recorded, the rest are refused as a different request", async () => {
      const order = confirmed(100000);
      const key = newKey("race");
      const slow = parallel(OLIVIA, "record_payment", [order, "deposit", 15000, "cash", null, null, key, 0], { holdSeconds: 1.2 });
      await sleep(300);
      const others = [15001, 15002, 15003].map((amount) => parallel(OLIVIA, "record_payment", [order, "deposit", amount, "cash", null, null, key, 0]));
      const [winner, ...losers] = await Promise.all([slow, ...others]);
      assert.ok(winner.ok, winner.err);
      for (const r of losers) {
        assert.equal(r.ok, false);
        assert.match(r.err, /this idempotency key was already used for a different request/);
      }
      assert.equal(paymentsOf(order), 1);
      assert.equal(count(`select amount_minor from public.payments where order_id = '${order}'`), 15000);
    });

    it("RACE: parallel sessions with DIFFERENT keys that together exceed the total: the order row lock still lets exactly the fitting ones through", async () => {
      const order = confirmed(100000);
      const keys = Array.from({ length: 4 }, () => newKey("race"));
      const slow = parallel(OLIVIA, "record_payment", [order, "deposit", 60000, "cash", null, null, keys[0], 0], { holdSeconds: 1.2 });
      await sleep(300);
      const rest = keys.slice(1).map((k) => parallel(OLIVIA, "record_payment", [order, "deposit", 60000, "cash", null, null, k, 0]));
      const results = await Promise.all([slow, ...rest]);
      assert.equal(results.filter((r) => r.ok).length, 1, "only one 60 000 fits in 100 000");
      assert.equal(paymentsOf(order), 1);
      assert.ok(count(`select amount_paid_minor from public.orders where id = '${order}'`) <= 100000);
      const failedKeys = keys.filter((k, i) => !results[i].ok);
      for (const k of failedKeys) assert.equal(keyRows(k), 0, "a refused attempt leaves no claim behind");
    });

    it("TIMEOUT: a call that exceeds its statement timeout rolls back completely (no payment, no claim); retrying with the same key then records exactly one", async () => {
      const order = confirmed(100000);
      const key = newKey("timeout");
      const params = [order, "deposit", 15000, "cash", null, null, key, 0];
      const timedOut = await parallel(OLIVIA, "record_payment", params, { holdSeconds: 2, timeoutMs: 600 });
      assert.equal(timedOut.ok, false);
      assert.match(timedOut.err, /statement timeout/);
      assert.equal(paymentsOf(order), 0);
      assert.equal(keyRows(key), 0, "the claim rolled back with the failed transaction");
      const retry = pay(OLIVIA, order, 15000, key);
      assert.ok(retry.ok, retry.err);
      assert.equal(paymentsOf(order), 1);
    });

    it("NETWORK LOSS: the client is killed mid-transaction; the immediate retry waits for the dead session, then records exactly one payment", async () => {
      const order = confirmed(100000);
      const key = newKey("netloss");
      const params = [order, "deposit", 15000, "cash", null, null, key, 0];
      // Kill the client process while its transaction is open (the database only sees the connection drop).
      const killed = asyncPsql(`begin;\n${gatewayCall(OLIVIA, "record_payment", params)}select pg_sleep(2);\ncommit;`, { killAfterMs: 500 });
      await sleep(700);
      const retry = await parallel(OLIVIA, "record_payment", params); // sent while the dead session may still hold the claim
      const k = await killed;
      assert.equal(k.killed, true, "the client really was killed");
      assert.ok(retry.ok, retry.err);
      assert.equal(paymentsOf(order), 1, "exactly one payment, however many attempts were made");
      assert.equal(keyRows(key), 1);
    });

    it("LOST RESPONSE: the payment committed but the client never saw the answer; the retry returns the original and records nothing new", () => {
      const order = confirmed(100000);
      const key = newKey("lost");
      const committed = pay(OLIVIA, order, 15000, key); // the answer is thrown away, as if the response never arrived
      assert.ok(committed.ok);
      const retry = pay(OLIVIA, order, 15000, key);
      assert.equal(retry.id, committed.id);
      assert.equal(paymentsOf(order), 1);
    });
  });

  // =================================================================================================================
  describe("GAP-2: creating an order", () => {
    it("the same request twice returns the SAME order: one order, one set of items, one history row, one audit entry, one reference", () => {
      const key = newKey("ord");
      const items = [{ kind: "component", description: "Test graphics card", quantity: 1, unit_price_minor: 215000 }, { kind: "delivery", description: "Delivery", quantity: 1, unit_price_minor: 10000 }];
      const ordersBefore = count(`select count(*) from public.orders`);
      const first = createOrder(SAM, ID.custA, items, key, { method: "delivery", address: "Doha, test address" });
      const second = createOrder(SAM, ID.custA, items, key, { method: "delivery", address: "Doha, test address" });
      const third = createOrder(SAM, ID.custA, items, key, { method: "delivery", address: "Doha, test address" });
      assert.ok(first.ok && second.ok && third.ok, JSON.stringify([first.err, second.err, third.err]));
      assert.equal(second.id, first.id);
      assert.equal(third.id, first.id);
      assert.equal(count(`select count(*) from public.orders`), ordersBefore + 1);
      assert.equal(count(`select count(*) from public.order_items where order_id = '${first.id}'`), 2);
      assert.equal(count(`select total_minor from public.orders where id = '${first.id}'`), 225000);
      assert.equal(count(`select count(*) from private.order_status_history where order_id = '${first.id}'`), 1);
      assert.equal(count(`select count(*) from private.audit_log where action = 'order.created' and entity_id = '${first.id}'`), 1);
    });

    it("the same items written differently (key order, spacing) are the SAME request; a changed item, customer or address is a DIFFERENT one and is refused", () => {
      const key = newKey("ord");
      const a = `[{"kind":"component","description":"Test item","quantity":2,"unit_price_minor":1500}]`;
      const b = `[ { "unit_price_minor": 1500, "quantity": 2, "description": "Test item", "kind": "component" } ]`;
      const first = db.commit(`${AS.sam}select admin.create_order('${CUST_C}', '${a}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, '${key}'::text);`).split("\n").pop().trim();
      const same = db.commit(`${AS.sam}select admin.create_order('${CUST_C}', '${b}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, '${key}'::text);`).split("\n").pop().trim();
      assert.equal(same, first);
      const ordersBefore = count(`select count(*) from public.orders`);
      for (const [customer, items, address, label] of [
        [CUST_C, ONE(1501, 2), null, "price"],
        [CUST_C, ONE(1500, 3), null, "quantity"],
        [ID.custB, ONE(1500, 2), null, "customer"],
        [CUST_C, ONE(1500, 2), "somewhere else", "delivery address"],
      ]) {
        const r = createOrder(SAM, customer, items, key, { address });
        assert.equal(r.ok, false, label);
        assert.match(r.err, /this idempotency key was already used for a different request; nothing was changed/, label);
      }
      assert.equal(count(`select count(*) from public.orders`), ordersBefore, "no order was created by the conflicting attempts");
    });

    it("one customer's key can never reach another customer's order: the same key for another customer is a conflict that reveals nothing", () => {
      const key = newKey("ord");
      const mine = createOrder(SAM, ID.custA, ONE(777700), key);
      assert.ok(mine.ok, mine.err);
      const theirs = createOrder(SAM, ID.custB, ONE(777700), key);
      assert.equal(theirs.ok, false);
      assert.match(theirs.err, /different request/);
      assert.doesNotMatch(theirs.err, new RegExp(`${mine.id}|Alice|${ID.custA}`), "nothing about the first customer or order appears in the refusal");
      assert.equal(count(`select count(*) from public.orders where customer_id = '${ID.custB}' and total_minor = 777700`), 0);
    });

    it("a FAILED attempt does not use up its key: an invalid order is rolled back completely, and the corrected retry with the same key succeeds", () => {
      const key = newKey("ord");
      const ordersBefore = count(`select count(*) from public.orders`);
      const bad = createOrder(SAM, CUST_C, [{ kind: "component", description: "x", quantity: 0.5, unit_price_minor: 100 }], key);
      assert.equal(bad.ok, false);
      assert.equal(count(`select count(*) from public.orders`), ordersBefore, "no half-built order survived");
      assert.equal(keyRows(key), 0);
      const good = createOrder(SAM, CUST_C, ONE(100), key);
      assert.ok(good.ok, good.err);
      assert.equal(count(`select count(*) from public.orders`), ordersBefore + 1);
    });

    it("RACE: six parallel sessions create the SAME order: all succeed with the SAME id, exactly one order exists", async () => {
      const key = newKey("race");
      const params = [CUST_C, JSON.stringify(ONE(424200)), null, null, key];
      const ordersBefore = count(`select count(*) from public.orders`);
      const first = parallel(SAM, "create_order", params, { holdSeconds: 1.2 });
      await sleep(300);
      const rest = Array.from({ length: 5 }, () => parallel(SAM, "create_order", params));
      const results = await Promise.all([first, ...rest]);
      assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.err)));
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      assert.equal(count(`select count(*) from public.orders`), ordersBefore + 1);
      assert.equal(count(`select count(*) from public.orders where total_minor = 424200 and customer_id = '${CUST_C}'`), 1);
    });

    it("TIMEOUT and NETWORK LOSS: a timed-out or killed create leaves nothing behind; the retry with the same key creates exactly one order", async () => {
      const key = newKey("timeout");
      const params = [CUST_C, JSON.stringify(ONE(515100)), null, null, key];
      const timedOut = await parallel(SAM, "create_order", params, { holdSeconds: 2, timeoutMs: 600 });
      assert.equal(timedOut.ok, false);
      assert.equal(count(`select count(*) from public.orders where total_minor = 515100`), 0);
      const killed = asyncPsql(`begin;\n${gatewayCall(SAM, "create_order", params)}select pg_sleep(2);\ncommit;`, { killAfterMs: 500 });
      await sleep(600);
      const retry = await parallel(SAM, "create_order", params);
      assert.equal((await killed).killed, true);
      assert.ok(retry.ok, retry.err);
      assert.equal(count(`select count(*) from public.orders where total_minor = 515100`), 1);
    });
  });

  // =================================================================================================================
  describe("GAP-3: adjusting loyalty points", () => {
    const balance = (customer) => count(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${customer}'`);

    it("the same adjustment twice applies ONCE: one ledger entry, one reason, one audit row, the balance moves once", () => {
      const key = newKey("loy");
      const before = balance(CUST_C);
      const first = adjustViaGateway(OLIVIA, CUST_C, 40, "goodwill adjustment", key);
      const second = adjustViaGateway(OLIVIA, CUST_C, 40, "goodwill adjustment", key);
      assert.ok(first.ok && second.ok, JSON.stringify([first.err, second.err]));
      assert.equal(second.id, first.id);
      assert.equal(balance(CUST_C), before + 40);
      assert.equal(count(`select count(*) from public.loyalty_ledger where id = '${first.id}'`), 1);
      assert.equal(count(`select count(*) from private.loyalty_entry_reasons where entry_id = '${first.id}'`), 1);
    });

    it("the same key with a different customer, number of points or reason is refused and changes nothing", () => {
      const key = newKey("loy");
      const first = adjustViaGateway(OLIVIA, CUST_C, 25, "first reason here", key);
      assert.ok(first.ok, first.err);
      const before = balance(CUST_C);
      for (const [customer, points, reason, label] of [[ID.custB, 25, "first reason here", "customer"], [CUST_C, 26, "first reason here", "points"], [CUST_C, 25, "another reason", "reason"]]) {
        const r = adjustViaGateway(OLIVIA, customer, points, reason, key);
        assert.equal(r.ok, false, label);
        assert.match(r.err, /this idempotency key was already used for a different request/, label);
      }
      assert.equal(balance(CUST_C), before);
      assert.equal(balance(ID.custB), 0);
    });

    it("a retry still succeeds after the balance has changed; a genuinely new deduction that would go below zero is still refused [OQ-0010 assumption]", () => {
      const customer = ID.custB;
      assert.ok(adjustViaGateway(OLIVIA, customer, 50, "starting balance", newKey("loy")).ok);
      const key = newKey("loy");
      const deduction = adjustViaGateway(OLIVIA, customer, -50, "remove everything", key);
      assert.ok(deduction.ok, deduction.err);
      assert.equal(balance(customer), 0);
      const retry = adjustViaGateway(OLIVIA, customer, -50, "remove everything", key);
      assert.ok(retry.ok, "the retry is not a new deduction, so the balance floor does not apply to it");
      assert.equal(retry.id, deduction.id);
      assert.equal(balance(customer), 0, "applied once, not twice");
      const fresh = adjustViaGateway(OLIVIA, customer, -50, "remove everything", newKey("loy"));
      assert.equal(fresh.ok, false);
      assert.match(fresh.err, /would make the balance negative/);
    });

    it("RACE: six parallel sessions apply the SAME adjustment: all return the same entry, the balance moves once", async () => {
      const customer = CUST_C;
      const key = newKey("race");
      const before = balance(customer);
      const call = (hold) => asyncPsql(`begin;\n${gatewayPrefix(OLIVIA.sub, OLIVIA.sid)}prepare q as select admin.adjust_loyalty($1::uuid, $2::integer, $3::text, $4::text) as r;\nexecute q(${[customer, 7, "parallel adjustment", key].map(lit).join(", ")});\n${hold ? `select pg_sleep(${hold});\n` : ""}commit;`);
      const first = call(1.2);
      await sleep(300);
      const results = await Promise.all([first, ...Array.from({ length: 5 }, () => call(0))]);
      assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.err)));
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      assert.equal(balance(customer), before + 7);
    });
  });

  // =================================================================================================================
  describe("keys belong to one person and never leak: scoping, privileges, append-only", () => {
    it("a key is scoped to the staff member: another owner using the SAME key and data gets their OWN independent record, never the first person's", () => {
      const order = confirmed(300000);
      const key = newKey("scope");
      const mine = pay(OLIVIA, order, 10000, key);
      const theirs = pay(PATRICK, order, 10000, key);
      assert.ok(mine.ok && theirs.ok, JSON.stringify([mine.err, theirs.err]));
      assert.notEqual(theirs.id, mine.id, "the second owner did NOT receive the first owner's payment id");
      assert.equal(paymentsOf(order), 2);
      assert.equal(count(`select count(*) from private.idempotency_keys where idempotency_key = '${key}' and actor in ('${ID.olivia}', '${PAT}')`), 2);
      // Each can replay their own; neither can replay the other's.
      assert.equal(pay(OLIVIA, order, 10000, key).id, mine.id);
      assert.equal(pay(PATRICK, order, 10000, key).id, theirs.id);
      assert.equal(paymentsOf(order), 2);
      // The same holds for orders created by two different staff members.
      const orderKey = newKey("scope");
      const a = createOrder(SAM, CUST_C, ONE(123400), orderKey);
      const b = createOrder(OLIVIA, CUST_C, ONE(123400), orderKey);
      assert.ok(a.ok && b.ok);
      assert.notEqual(a.id, b.id);
    });

    it("customers, strangers, inactive staff, forged claims and the owner without a second factor cannot use the key operations at all, and leave no key behind", () => {
      const order = confirmed(300000);
      const key = newKey("deny");
      const call = `select admin.record_payment('${order}'::uuid, 'deposit'::text, 100::bigint, 'cash'::text, null::timestamptz, null::text, null::text, null::text, '${key}'::text, 0::bigint)`;
      for (const [who, name] of [[AS.alice, "a customer"], [AS.eve, "a stranger"], [AS.dana, "inactive staff"], [AS.forgedAdmin, "forged claims"], [AS.oliviaAal1, "the owner at aal1"], [AS.sam, "ordinary staff (no payments.record)"], [AS.anon, "a visitor"]]) {
        refused(attempt(who, call), /permission denied/, name);
      }
      const order2 = `select admin.create_order('${CUST_C}'::uuid, '[{"kind":"component","description":"x","quantity":1,"unit_price_minor":100}]'::jsonb, null::uuid, 'admin'::text, null::text, null::text, '${key}'::text)`;
      for (const [who, name] of [[AS.alice, "a customer"], [AS.eve, "a stranger"], [AS.dana, "inactive staff"], [AS.forgedAdmin, "forged claims"], [AS.oliviaAal1, "the owner at aal1"], [AS.anon, "a visitor"]]) {
        refused(attempt(who, order2), /permission denied/, name);
      }
      assert.equal(keyRows(key), 0, "no key was recorded for any refused caller");
      assert.equal(paymentsOf(order), 0);
    });

    it("no API role, no customer and not even the staff gateway can read the key table or call the claim helper directly", () => {
      for (const [who, name] of [[AS.anon, "anon"], [AS.alice, "a customer"], [AS.service, "service_role"], [AS.olivia, "the owner (aal2)"]]) {
        assert.match(rowsSeen(who, `select count(*) from private.idempotency_keys`), /^DENIED$/, `${name} reading the table`);
        refused(attempt(who, `select private.idempotency_claim('payment.record', 'abcdefgh1234', '{}'::jsonb, gen_random_uuid())`), /permission denied/, `${name} calling the helper`);
      }
      const gw = db.cluster.psql(`begin;\n${gatewayPrefix(ID.olivia, SESSION.olivia)}select count(*) from private.idempotency_keys;\ncommit;`);
      assert.equal(gw.ok, false);
      assert.match(gw.err, /permission denied/);
      const gwHelper = db.cluster.psql(`begin;\n${gatewayPrefix(ID.olivia, SESSION.olivia)}select private.idempotency_claim('payment.record', 'abcdefgh1234', '{}'::jsonb, gen_random_uuid());\ncommit;`);
      assert.equal(gwHelper.ok, false);
      assert.match(gwHelper.err, /permission denied/);
    });

    it("the key table is append-only, even for the database superuser (a trigger refuses, not only the grants)", () => {
      const key = newKey("append");
      const order = confirmed();
      assert.ok(pay(OLIVIA, order, 15000, key).ok);
      for (const sql of [`update private.idempotency_keys set request_hash = repeat('0', 64) where idempotency_key = '${key}'`, `delete from private.idempotency_keys where idempotency_key = '${key}'`, `truncate private.idempotency_keys`]) {
        refused(attempt("", sql), /is append-only: (UPDATE|DELETE|TRUNCATE) is not allowed/, sql);
      }
      assert.equal(keyRows(key), 1);
    });

    it("the stored fingerprint is a SHA-256 of the request data and holds no payment or order data itself", () => {
      const key = newKey("hash");
      const order = confirmed();
      assert.ok(pay(OLIVIA, order, 15000, key, { reference: "FAWRAN-SECRET-REF" }).ok);
      const row = scalar(`select request_hash || '|' || operation || '|' || (actor = '${ID.olivia}')::text from private.idempotency_keys where idempotency_key = '${key}'`);
      assert.match(row, /^[0-9a-f]{64}\|payment\.record\|true$/);
      assert.equal(count(`select count(*) from private.idempotency_keys k where to_jsonb(k)::text like '%FAWRAN-SECRET-REF%'`), 0);
    });
  });

  // =================================================================================================================
  describe("what did NOT change: permissions, money, deposit tiers, append-only accounting", () => {
    it("payments are still the owner's alone: ordinary staff cannot record a payment with or without a key, through the gateway or directly", () => {
      const order = confirmed();
      const r = pay(SAM, order, 15000, newKey("staff"));
      assert.equal(r.ok, false);
      assert.match(r.err, /permission denied: payments\.record is required/);
      refused(attempt(AS.sam, `select admin.record_payment('${order}', 'deposit', 15000, 'cash')`), /permission denied: payments\.record is required/);
      assert.equal(paymentsOf(order), 0);
    });

    it("the confirmed deposit tiers, the gate and exact integer arithmetic are unchanged by the new overloads: QAR 4,350.55 confirms at 108 764 (25 %) and the gate wants exactly that", () => {
      const key = newKey("tier");
      const created = createOrder(SAM, ID.custA, [{ kind: "component", description: "A", quantity: 1, unit_price_minor: 215000 }, { kind: "component", description: "B", quantity: 1, unit_price_minor: 130055 }, { kind: "build_service", description: "C", quantity: 1, unit_price_minor: 80000 }, { kind: "delivery", description: "D", quantity: 1, unit_price_minor: 10000 }], key);
      assert.ok(created.ok, created.err);
      db.commit(`${AS.sam}select admin.transition_order('${created.id}', 'awaiting_deposit');`);
      assert.equal(scalar(`select total_minor || '|' || deposit_required_minor || '|' || deposit_rate_bps || '|' || deposit_policy_version from public.orders where id = '${created.id}'`), "435055|108764|2500|4");
      assert.ok(pay(OLIVIA, created.id, 108763, newKey("tier")).ok);
      refused(attempt(AS.sam, `select admin.transition_order('${created.id}', 'deposit_received')`), /\(108763 of 108764 QAR minor units\)/);
      assert.ok(pay(OLIVIA, created.id, 1, newKey("tier")).ok);
      db.commit(`${AS.sam}select admin.transition_order('${created.id}', 'deposit_received');`);
    });

    it("the three ORIGINAL signatures still behave exactly as before for direct callers, and the payments, orders and ledgers stay append-only", () => {
      const order = confirmed();
      const committed = (who, sql) => lines(db.commit(`${who}${sql}`)).pop().trim();
      const id = committed(AS.olivia, `select admin.record_payment('${order}', 'deposit', 15000, 'cash', now(), 'RCPT-OLD-SIG-1', 'ref', 'note');`);
      assert.match(id, UUID);
      assert.equal(scalar(`select receipt_number from public.payments where id = '${id}'`), "RCPT-OLD-SIG-1");
      assert.match(committed(AS.sam, `select admin.create_order('${CUST_C}', '[{"kind":"component","description":"x","quantity":1,"unit_price_minor":100}]'::jsonb);`), UUID);
      assert.match(committed(AS.olivia, `select admin.adjust_loyalty('${CUST_C}', 3, 'old signature');`), UUID);
      for (const sql of [`update public.payments set amount_minor = 1 where id = '${id}'`, `delete from public.payments where id = '${id}'`, `update public.loyalty_ledger set points = 99 where customer_id = '${CUST_C}'`, `delete from public.loyalty_ledger where customer_id = '${CUST_C}'`]) {
        refused(attempt("", sql), /is append-only/, sql);
      }
    });

    it("ledger-wide invariants still hold over everything this suite created: paid = sum of payments, balance = total - paid, one award per order, balances = ledger sums", () => {
      assert.equal(read(`select o.order_ref from public.orders o left join (select order_id, sum(amount_minor) s from public.payments group by order_id) p on p.order_id = o.id
        where o.amount_paid_minor is distinct from coalesce(p.s, 0) or o.balance_due_minor <> o.total_minor - o.amount_paid_minor or o.amount_paid_minor < 0 or o.amount_paid_minor > o.total_minor`), "");
      assert.equal(count(`select count(*) from (select order_id from public.loyalty_ledger where entry_type = 'award' group by 1 having count(*) > 1) t`), 0);
      assert.equal(count(`select count(*) from public.loyalty_balances b where b.balance_points <> (select sum(points) from public.loyalty_ledger l where l.customer_id = b.customer_id)`), 0);
      assert.equal(count(`select count(receipt_number) - count(distinct receipt_number) from public.payments`), 0);
      assert.equal(count(`select count(*) from public.payments p where p.reverses_payment_id is null and (select count(*) from private.audit_log a where a.action = 'payment.recorded' and a.entity_id = p.id::text) <> 1`), 0, "every payment is audited exactly once, so no replay audited twice");
      assert.equal(count(`select count(*) from public.orders o where (select count(*) from private.audit_log a where a.action = 'order.created' and a.entity_id = o.id::text) <> 1`), 0);
      assert.equal(count(`select count(*) from private.idempotency_keys k where k.operation = 'payment.record' and not exists (select 1 from public.payments p where p.id = k.result_id)`), 0, "every payment key points at a real payment");
      assert.equal(count(`select count(*) from private.idempotency_keys k where k.operation = 'order.create' and not exists (select 1 from public.orders o where o.id = k.result_id)`), 0, "every order key points at a real order");
      assert.equal(count(`select count(*) from private.idempotency_keys k where k.operation = 'loyalty.adjust' and not exists (select 1 from public.loyalty_ledger l where l.id = k.result_id)`), 0, "every loyalty key points at a real entry");
      assert.ok(count(`select count(*) from private.idempotency_keys`) >= 20, "a meaningful number of keys were exercised");
    });
  });

  // =================================================================================================================
  describe("the website side (static checks of the source; the browser behaviour is tested in idempotency.hook.browser.test.mjs)", () => {
    const forms = readFileSync(join(ROOT, "src/components/admin/forms.tsx"), "utf8");
    const hook = readFileSync(join(ROOT, "src/components/admin/use-idempotency-key.ts"), "utf8");
    const actions = readFileSync(join(ROOT, "src/lib/staff/order-actions.ts"), "utf8");
    const api = readFileSync(join(ROOT, "src/lib/staff/api.ts"), "utf8");

    it("the payment, order and add-cost forms carry a hidden idempotency_key through the shared hook; the payment form also carries the balance it showed", () => {
      // PLAT-0006 added the third: the add-cost form sends the id of the entry it is creating (chosen once per intended entry, replaced after it is saved),
      // so sending the same form twice saves one cost. It uses the same hook, bound to the number of entries the page showed.
      assert.equal((forms.match(/name="idempotency_key"/g) ?? []).length, 3, "the payment form, the order form and the add-cost form");
      assert.match(forms, /useIdempotencyKey\(`cost:\$\{orderId\}`, entryId, String\(entries\), state\)/);
      assert.match(forms, /useIdempotencyKey\(`payment:\$\{orderId\}`, idempotencyKey, String\(expectedPaidMinor\), state\)/);
      assert.match(forms, /useIdempotencyKey\(`order:\$\{customerId\}`, idempotencyKey, "", state\)/);
      assert.match(forms, /<input type="hidden" name="expected_paid_minor" value=\{String\(expectedPaidMinor\)\} \/>/);
      assert.match(forms, /disabled=\{pending \|\| disabled\}/, "the disabled button is kept as the first, cosmetic layer");
      assert.match(hook, /chooseKey\(/);
      assert.match(hook, /rotateKey\(/);
    });

    it("the order form is locked after the order was created, and the duplicate warning offers an explicit override", () => {
      assert.match(forms, /<fieldset disabled=\{created\}/);
      assert.match(forms, /name="confirm_duplicate"/);
      assert.match(forms, /disabled=\{created\}/);
    });

    it("the pages choose the first key on the server, per render, and the payment page passes the balance it shows", () => {
      for (const file of ["src/app/admin/orders/[id]/page.tsx", "src/app/admin/orders/new/page.tsx"]) {
        const source = readFileSync(join(ROOT, file), "utf8");
        assert.match(source, /import \{ randomUUID \} from "node:crypto"/, file);
        assert.match(source, /idempotencyKey=\{randomUUID\(\)\}/, file);
      }
      assert.match(readFileSync(join(ROOT, "src/app/admin/orders/[id]/page.tsx"), "utf8"), /expectedPaidMinor=\{order\.amount_paid_minor\}/);
    });

    it("the action bodies refuse a form without a valid key (and, for payments, a valid expected amount) before any database call, and pass both on (behaviour: gateway-outcomes.db.test.mjs)", () => {
      for (const name of ["createOrderWork", "recordPaymentWork"]) {
        const start = actions.indexOf(`export async function ${name}`);
        const body = actions.slice(start, actions.indexOf("\nexport async function", start + 10) === -1 ? undefined : actions.indexOf("\nexport async function", start + 10));
        assert.match(body, /parseIdempotencyKey\(formData\)/, name);
        assert.match(body, /STALE_FORM_MESSAGE/, name);
        assert.match(body, /idempotencyKey/, `${name} passes the key to the API`);
      }
      const payment = actions.slice(actions.indexOf("export async function recordPaymentWork"));
      assert.match(payment, /parseExpectedPaid\(formData\)/);
      assert.match(payment, /idempotencyKey, expectedPaid\)/);
      assert.match(api, /recordPayment: async \([\s\S]*idempotencyKey: string, expectedPaidMinor: number/);
      assert.match(api, /createOrder: async \(.*idempotencyKey: string\)/);
    });

    it("the duplicate check only warns: the body returns the warning before creating, never blocks a confirmed order, and an advisory failure does not stop an order (behaviour: gateway-outcomes.db.test.mjs)", () => {
      const order = actions.slice(actions.indexOf("export async function createOrderWork"), actions.indexOf("export async function recordPaymentWork"));
      assert.match(order, /confirm_duplicate/);
      assert.match(order, /return duplicateWarning\(similar\)/);
      assert.match(order, /catch \(error\) \{\s*if \(error instanceof StaffPermissionError\) throw error;/, "only a permission failure stops the order; the advice failing does not");
      assert.ok(order.indexOf("duplicateWarning") < order.indexOf("api.createOrderPriced("), "the warning comes before the create");
    });
  });
});
