// PLAT-0004 correction cycle: what the idempotency replay window, the expected paid amount, the duplicate-order evidence and the
// security ordering actually guarantee, proved against a REAL PostgreSQL server with the REAL migrations and the REAL staff
// gateway role (the website's own SQL text, read out of src/lib/staff/gateway.ts).
//
// The rules under test (docs/project-memory/architecture/IDEMPOTENCY.md):
//   * a repeat is answered with the original record ONLY while that is still true: under an hour old, payment not reversed,
//     order not cancelled. Otherwise it is REFUSED (M1K02) and nothing is created or reported as done;
//   * keys are kept forever, so an old key can never be accepted again as a NEW operation (same data -> M1K02, other data -> M1K01);
//   * the paid amount the person saw must still be the real balance, checked under the order lock in the same transaction (M1K03);
//   * the duplicate-order check only WARNS; the database never rejects a valid second order;
//   * permission and the second factor are checked BEFORE anything about the order, the key or the replay is revealed.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { CUST_C, ONE, PAT, SESSION, makeHelpers, newKey, seedIdempotencyFixtures, sleep } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;
const ZERO = "00000000-0000-4000-8000-000000000000";

suite("idempotency window, expected paid amount, duplicate evidence and security ordering (PLAT-0004 corrections)", () => {
  let db;
  let h;
  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
  });
  after(() => db?.stop());

  const refusedWith = (r, code, pattern, label = "") => {
    assert.equal(r.ok, false, `${label}: should have been refused`);
    assert.equal(r.code, code, `${label}: SQLSTATE (${r.err})`);
    assert.match(r.err, pattern, label);
  };
  const O = () => h.OLIVIA;

  // =================================================================================================================
  describe("C2: a repeat is answered with the original ONLY while it is still true", () => {
    it("a payment that was REVERSED is never answered with 'recorded': the repeat is refused, nothing is recorded, and a new key works", () => {
      const order = h.confirmed(100000);
      const key = newKey("rev");
      const first = h.pay(O(), order, 30000, key);
      assert.ok(first.ok, first.err);
      h.reverse(order, first.id);
      assert.equal(h.paidOf(order), 0, "the reversal restored the balance");
      const stale = h.pay(O(), order, 30000, key);
      refusedWith(stale, "M1K02", /has since been reversed, so it was not recorded again/, "stale replay after a reversal");
      assert.equal(h.paymentsOf(order), 1, "no new payment was recorded by the stale replay");
      assert.equal(h.paidOf(order), 0);
      assert.equal(h.keyRows(key), 1, "the key is still retained (never forgotten)");
      // The same key with different data is a conflict, not a replay.
      refusedWith(h.pay(O(), order, 30001, key), "M1K01", /different request/, "other data after a reversal");
      // The intended recovery: a NEW key (the form was told to retire this one) records the payment.
      const fresh = h.pay(O(), order, 30000, newKey("rev"));
      assert.ok(fresh.ok, fresh.err);
      assert.notEqual(fresh.id, first.id);
      assert.equal(h.paidOf(order), 30000);
    });

    it("an order that was CANCELLED after it was created is never answered with 'created': the repeat is refused and no second order appears", () => {
      const key = newKey("cancel");
      const created = h.createOrder(h.SAM, CUST_C, ONE(54321), key);
      assert.ok(created.ok, created.err);
      db.commit(`${AS.sam}select admin.transition_order('${created.id}', 'cancelled', 'customer changed their mind');`);
      const before = h.count(`select count(*) from public.orders`);
      const stale = h.createOrder(h.SAM, CUST_C, ONE(54321), key);
      refusedWith(stale, "M1K02", /has since been cancelled, so it was not created again/, "stale replay after a cancellation");
      assert.equal(h.count(`select count(*) from public.orders`), before, "nothing was created");
    });

    it("a payment on a cancelled order still stands, so its repeat is still answered (the payment was not reversed)", () => {
      const order = h.confirmed(100000);
      const key = newKey("stands");
      const first = h.pay(O(), order, 20000, key);
      db.commit(`${AS.sam}select admin.transition_order('${order}', 'cancelled', 'test');`);
      const again = h.pay(O(), order, 20000, key);
      assert.ok(again.ok, again.err);
      assert.equal(again.id, first.id);
      assert.equal(again.replayed, true);
    });

    it("a loyalty adjustment is a ledger fact that cannot be reversed here, so its repeat is answered within the window", () => {
      const key = newKey("loy");
      const first = h.adjustViaGateway(O(), CUST_C, 11, "window check adjustment", key);
      assert.ok(first.ok, first.err);
      const again = h.adjustViaGateway(O(), CUST_C, 11, "window check adjustment", key);
      assert.equal(again.id, first.id);
      assert.equal(again.replayed, true);
    });
  });

  // =================================================================================================================
  describe("C5 (exact expiry semantics): one hour to confirm a repeat, keys kept forever, an old key is never a new operation", () => {
    it("59 minutes 59 seconds old: still a repeat; 61 minutes old: refused (M1K02), nothing recorded, the key stays", () => {
      const order = h.confirmed(200000);
      const key = newKey("exp");
      const first = h.pay(O(), order, 25000, key);
      h.ageKey(key, "59 minutes 59 seconds");
      const inside = h.pay(O(), order, 25000, key);
      assert.ok(inside.ok, inside.err);
      assert.equal(inside.id, first.id);
      assert.equal(inside.replayed, true);
      h.ageKey(key, "61 minutes");
      const expired = h.pay(O(), order, 25000, key);
      refusedWith(expired, "M1K02", /more than an hour ago and can no longer be confirmed automatically; nothing was changed/, "expired");
      assert.equal(h.paymentsOf(order), 1, "an expired repeat creates nothing");
      assert.equal(h.keyRows(key), 1, "the key is retained, not forgotten");
    });

    it("an EXPIRED key can never be reused as a NEW operation: other data is a conflict, the same data is refused, and neither records anything", () => {
      const order = h.confirmed(200000);
      const key = newKey("exp");
      assert.ok(h.pay(O(), order, 25000, key).ok);
      h.ageKey(key, "26 hours");
      for (const [amount, code] of [[25000, "M1K02"], [25001, "M1K01"], [1, "M1K01"]]) {
        const r = h.pay(O(), order, amount, key);
        assert.equal(r.ok, false, `amount ${amount}`);
        assert.equal(r.code, code, `amount ${amount}: ${r.err}`);
      }
      assert.equal(h.paymentsOf(order), 1);
      assert.equal(h.paidOf(order), 25000);
      assert.equal(h.keyRows(key), 1, "still one claim: nothing was overwritten");
    });

    it("the same holds for orders and loyalty adjustments: an expired key is refused and creates nothing", () => {
      const okey = newKey("exp");
      const o = h.createOrder(h.SAM, CUST_C, ONE(31415), okey);
      assert.ok(o.ok, o.err);
      h.ageKey(okey, "3 hours");
      const orders = h.count(`select count(*) from public.orders`);
      refusedWith(h.createOrder(h.SAM, CUST_C, ONE(31415), okey), "M1K02", /more than an hour ago/, "expired order key");
      assert.equal(h.count(`select count(*) from public.orders`), orders);
      const lkey = newKey("exp");
      const l = h.adjustViaGateway(O(), CUST_C, 3, "expiry check adjustment", lkey);
      assert.ok(l.ok, l.err);
      h.ageKey(lkey, "3 hours");
      const balance = h.count(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${CUST_C}'`);
      const again = h.adjustViaGateway(O(), CUST_C, 3, "expiry check adjustment", lkey);
      assert.equal(again.ok, false);
      assert.match(again.err, /more than an hour ago/);
      assert.equal(h.count(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${CUST_C}'`), balance, "the balance did not move");
    });

    it("a key that was NEVER claimed (its first attempt failed) is still a fresh key, however long ago it was first sent", () => {
      const order = h.confirmed(100000);
      const key = newKey("never");
      const tooMuch = h.pay(O(), order, 100001, key);
      assert.equal(tooMuch.ok, false);
      assert.equal(h.keyRows(key), 0);
      const ok = h.pay(O(), order, 10000, key);
      assert.ok(ok.ok, ok.err);
    });

    it("the claim table is never purged: old rows stay and keep every key refused", () => {
      assert.ok(h.count(`select count(*) from private.idempotency_keys where created_at < now() - interval '1 hour'`) >= 3, "rows older than the window still exist");
    });
  });

  // =================================================================================================================
  describe("C3: the expected paid amount is checked inside the transaction, under the order lock", () => {
    it("a payment is recorded only when the balance the person saw is the balance; the refusal says both amounts and leaves no claim", () => {
      const order = h.confirmed(200000);
      assert.ok(h.pay(O(), order, 50000, newKey("ep")).ok);
      const key = newKey("ep");
      const stale = h.pay(O(), order, 50000, key, { expected: 0 });
      refusedWith(stale, "M1K03", /you saw QAR 0\.00, it is now QAR 500\.00\); nothing was recorded/, "stale expected amount");
      assert.equal(h.paymentsOf(order), 1);
      assert.equal(h.keyRows(key), 0, "the refused attempt left no claim: the same key can be sent again with the right amount");
      const fixed = h.pay(O(), order, 50000, key, { expected: 50000 });
      assert.ok(fixed.ok, fixed.err);
      assert.equal(h.paidOf(order), 100000);
    });

    it("TWO TABS: both opened at paid = 0; the first records, the second (a different key) is refused instead of paying twice", () => {
      const order = h.confirmed(100000);
      const tab1 = h.pay(O(), order, 60000, newKey("tab"), { expected: 0 });
      const tab2 = h.pay(O(), order, 60000, newKey("tab"), { expected: 0 });
      assert.ok(tab1.ok, tab1.err);
      refusedWith(tab2, "M1K03", /changed while you were working/, "the stale second tab");
      assert.equal(h.paymentsOf(order), 1);
      assert.equal(h.paidOf(order), 60000);
    });

    it("a DUPLICATED tab (same key, same form): the repeat is answered with the original and is not refused for the balance having moved", () => {
      const order = h.confirmed(100000);
      const key = newKey("dup");
      const first = h.pay(O(), order, 40000, key, { expected: 0 });
      const duplicated = h.pay(O(), order, 40000, key, { expected: 0 });
      assert.ok(first.ok && duplicated.ok, JSON.stringify([first.err, duplicated.err]));
      assert.equal(duplicated.id, first.id);
      assert.equal(duplicated.replayed, true);
      assert.equal(h.paymentsOf(order), 1);
    });

    it("a legitimate retry still works after OTHER payments moved the balance: a lost response, then someone else pays, then the first person retries", () => {
      const order = h.confirmed(300000);
      const key = newKey("retry");
      const lost = h.pay(O(), order, 50000, key, { expected: 0 }); // the answer never reached the browser
      assert.ok(lost.ok);
      assert.ok(h.pay(h.PATRICK, order, 70000, newKey("other"), { expected: 50000 }).ok, "a colleague paid in the meantime");
      const retry = h.pay(O(), order, 50000, key, { expected: 0 });
      assert.ok(retry.ok, retry.err);
      assert.equal(retry.id, lost.id);
      assert.equal(h.paymentsOf(order), 2);
      assert.equal(h.paidOf(order), 120000);
    });

    it("the same key with a DIFFERENT expected amount is a different request (a reloaded page must not turn a deliberate second payment into a repeat)", () => {
      const order = h.confirmed(100000);
      const key = newKey("bind");
      assert.ok(h.pay(O(), order, 30000, key, { expected: 0 }).ok);
      refusedWith(h.pay(O(), order, 30000, key, { expected: 30000 }), "M1K01", /different request/, "the balance the page showed changed");
      assert.equal(h.paymentsOf(order), 1);
      assert.ok(h.pay(O(), order, 30000, newKey("bind"), { expected: 30000 }).ok, "a new decision with a new key records");
      assert.equal(h.paymentsOf(order), 2);
    });

    it("a reversal moves the balance too: a form that still shows the old balance is refused", () => {
      const order = h.confirmed(100000);
      const p = h.pay(O(), order, 30000, newKey("rv"), { expected: 0 });
      const staleAfterReversal = h.pay(h.PATRICK, order, 20000, newKey("rv"), { expected: 30000 });
      assert.ok(staleAfterReversal.ok, "while the balance is still 30 000 the form is right");
      h.reverse(order, p.id);
      const stale = h.pay(O(), order, 10000, newKey("rv"), { expected: 50000 });
      refusedWith(stale, "M1K03", /you saw QAR 500\.00, it is now QAR 200\.00/, "after the reversal");
    });

    it("RACE (two staff members): both saw paid = 0 and both submit 30 000 on a 100 000 order at the same moment: exactly one is recorded, the other is refused M1K03", async () => {
      const order = h.confirmed(100000);
      const first = h.parallel(O(), "record_payment", h.payParams(order, 30000, newKey("two"), { expected: 0, actor: ID.olivia }), { holdSeconds: 1.2 });
      await sleep(300);
      const second = h.parallel(h.PATRICK, "record_payment", h.payParams(order, 30000, newKey("two"), { expected: 0, actor: PAT }));
      const [a, b] = await Promise.all([first, second]);
      assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a.err, b.err]));
      const loser = [a, b].find((r) => !r.ok);
      assert.match(loser.err, /changed while you were working/);
      assert.equal(h.paymentsOf(order), 1);
      assert.equal(h.paidOf(order), 30000, "the order was not paid twice");
    });

    it("RACE (one person, several tabs, one form): eight tabs send the same key and the same expected amount: one payment, every tab told the truth", async () => {
      const order = h.confirmed(100000);
      const params = h.payParams(order, 20000, newKey("tabs"), { expected: 0, actor: ID.olivia });
      const first = h.parallel(O(), "record_payment", params, { holdSeconds: 1.2 });
      await sleep(300);
      const rest = Array.from({ length: 7 }, () => h.parallel(O(), "record_payment", params));
      const results = await Promise.all([first, ...rest]);
      assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.err)));
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      assert.equal(results.filter((r) => r.replayed).length, 7, "seven of them are reported as repeats");
      assert.equal(h.paymentsOf(order), 1);
    });

    it("a direct database caller may omit the expected amount (NULL: no balance check, as before); the gateway may not; a negative one is refused", () => {
      const order = h.confirmed(100000);
      const direct = (expected) => `${AS.olivia}select admin.record_payment('${order}', 'deposit', 5000, 'cash', null::timestamptz, null::text, null::text, null::text, '${newKey("dir")}', ${expected});`;
      assert.ok(db.run(direct("null::bigint")).ok);
      assert.ok(db.run(direct("12345::bigint")).ok === false, "a wrong expected amount is refused for a direct caller too");
      assert.equal(h.stateOf(AS.olivia, `select admin.record_payment('${order}', 'deposit', 5000, 'cash', null::timestamptz, null::text, null::text, null::text, '${newKey("dir")}', -1::bigint)`), "22023");
      const viaGateway = h.viaGateway(O(), "record_payment", [order, "deposit", 5000, "cash", null, null, newKey("gw"), null]);
      refusedWith(viaGateway, "22023", /the amount already paid on the order must be supplied/, "gateway without expected amount");
    });
  });

  // =================================================================================================================
  describe("C4: duplicate-order EVIDENCE is read-only and never blocks a valid order", () => {
    const items = [{ kind: "component", description: "  Test GPU  ", quantity: 1, unit_price_minor: 123400 }, { kind: "delivery", description: "Delivery", quantity: 1, unit_price_minor: 5000 }];
    const sameDifferently = [{ kind: "delivery", description: "delivery", quantity: "1", unit_price_minor: 5000 }, { kind: "component", description: "test gpu", unit_price_minor: 123400 }];

    it("the SAME customer's recent order with the same items is reported, ignoring order, case, spaces and defaults; the evidence names it", () => {
      const key = newKey("sim");
      const first = h.createOrder(h.SAM, ID.custB, items, key);
      assert.ok(first.ok, first.err);
      const r = h.similar(h.SAM, ID.custB, sameDifferently, newKey("other"));
      assert.ok(r.ok, r.err);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].order_id, first.id);
      assert.match(r.rows[0].order_ref, /^O-/);
      assert.equal(r.rows[0].total_minor, 128400);
      assert.equal(r.rows[0].status, "pending_confirmation");
    });

    it("the order THIS key already created is not reported (a retry is answered by the create itself, not warned about)", () => {
      const key = newKey("sim");
      const first = h.createOrder(h.SAM, ID.custA, ONE(98765, 1, "Own-key item"), key);
      assert.ok(first.ok, first.err);
      assert.equal(h.similar(h.SAM, ID.custA, ONE(98765, 1, "Own-key item"), key).rows.length, 0, "same key: excluded");
      assert.equal(h.similar(h.SAM, ID.custA, ONE(98765, 1, "Own-key item"), newKey("fresh")).rows.length, 1, "a new key: reported");
    });

    it("different customer, quantity, price, description, a cancelled order and an order older than 24 hours are NOT reported", () => {
      const base = ONE(11111, 1, "Evidence item");
      const o = h.createOrder(h.SAM, CUST_C, base, newKey("sim"));
      assert.ok(o.ok, o.err);
      const asks = (customer, its) => h.similar(h.SAM, customer, its, newKey("ask")).rows.length;
      assert.equal(asks(CUST_C, base), 1);
      assert.equal(asks(ID.custA, base), 0, "another customer");
      assert.equal(asks(CUST_C, ONE(11111, 2, "Evidence item")), 0, "quantity");
      assert.equal(asks(CUST_C, ONE(11112, 1, "Evidence item")), 0, "price");
      assert.equal(asks(CUST_C, ONE(11111, 1, "Evidence item!")), 0, "description");
      assert.equal(asks(CUST_C, [{ ...base[0], kind: "other" }]), 0, "kind");
      h.ageOrder(o.id, "25 hours");
      assert.equal(asks(CUST_C, base), 0, "older than 24 hours");
      const o2 = h.createOrder(h.SAM, CUST_C, base, newKey("sim"));
      assert.equal(asks(CUST_C, base), 1);
      db.commit(`${AS.sam}select admin.transition_order('${o2.id}', 'cancelled', 'test');`);
      assert.equal(asks(CUST_C, base), 0, "a cancelled order");
    });

    it("it NEVER blocks: the database creates a second identical order for the same customer without any confirmation, and the evidence is then two orders", () => {
      const its = ONE(22222, 1, "Legitimate repeat purchase");
      const a = h.createOrder(h.SAM, ID.custB, its, newKey("legit"));
      const b = h.createOrder(h.SAM, ID.custB, its, newKey("legit"));
      assert.ok(a.ok && b.ok, JSON.stringify([a.err, b.err]));
      assert.notEqual(a.id, b.id);
      assert.equal(h.similar(h.SAM, ID.custB, its, newKey("ask")).rows.length, 2);
    });

    it("it lists at most five orders, writes nothing, and returns nothing for malformed items (create_order reports the precise error)", () => {
      const its = ONE(33333, 1, "Many copies");
      for (let i = 0; i < 6; i++) assert.ok(h.createOrder(h.SAM, ID.custB, its, newKey("many")).ok);
      const before = h.count(`select count(*) from public.orders`) + h.count(`select count(*) from private.idempotency_keys`) + h.count(`select count(*) from private.audit_log`);
      assert.equal(h.similar(h.SAM, ID.custB, its, newKey("ask")).rows.length, 5);
      for (const bad of [[], [{ kind: "component", description: "x", quantity: "x", unit_price_minor: 1 }], [{ nope: 1 }], [{ kind: "component", description: "x", quantity: 1, unit_price_minor: 1, extra: true }]]) {
        assert.deepEqual(h.similar(h.SAM, ID.custB, bad, newKey("ask")).rows, [], JSON.stringify(bad));
      }
      assert.equal(h.count(`select count(*) from public.orders`) + h.count(`select count(*) from private.idempotency_keys`) + h.count(`select count(*) from private.audit_log`), before, "evidence is read-only");
    });

    it("who may ask: staff with orders.create; customers, strangers, inactive staff, forged claims, aal1 and visitors may not", () => {
      const call = `select * from admin.similar_orders('${ID.custB}'::uuid, '[{"kind":"component","description":"x","quantity":1,"unit_price_minor":1}]'::jsonb, null::text)`;
      for (const [who, name] of [[AS.alice, "a customer"], [AS.eve, "a stranger"], [AS.dana, "inactive staff"], [AS.forgedAdmin, "forged claims"], [AS.oliviaAal1, "the owner at aal1"], [AS.anon, "a visitor"]]) {
        h.refused(h.attempt(who, call), /permission denied/, name);
      }
      assert.equal(h.attempt(AS.sam, call), "OK");
      assert.equal(h.attempt(AS.olivia, call), "OK");
    });
  });

  // =================================================================================================================
  describe("C8: security ordering - permission and the second factor come before anything about the order, the key or the replay", () => {
    it("a caller without the permission learns NOTHING about whether an order exists: a real order and a made-up one get the same refusal", () => {
      const real = h.confirmed();
      for (const orderId of [real, ZERO]) {
        const direct = h.attempt(AS.sam, `select admin.record_payment('${orderId}'::uuid, 'deposit'::text, 1::bigint, 'cash'::text, null::timestamptz, null::text, null::text, null::text, '${newKey("probe")}'::text, 0::bigint)`);
        h.refused(direct, /permission denied: payments\.record is required/, `ordinary staff, order ${orderId === ZERO ? "does not exist" : "exists"}`);
        const gateway = h.pay(h.SAM, orderId, 1, newKey("probe"), { expected: 0 });
        refusedWith(gateway, "42501", /permission denied: payments\.record is required/, "gateway");
      }
      // the same for the transition (permission-first since migration 20261121120000) and for create_order with a made-up customer
      h.refused(h.attempt(AS.alice, `select admin.transition_order('${ZERO}'::uuid, 'awaiting_deposit'::text, null::text)`), /permission denied/);
      for (const who of [AS.alice, AS.eve, AS.anon]) {
        h.refused(h.attempt(who, `select admin.create_order('${ZERO}'::uuid, '[]'::jsonb, null::uuid, 'admin'::text, null::text, null::text, '${newKey("probe")}'::text)`), /permission denied/);
      }
    });

    it("a replay is NOT a way around revoked access: once the person is deactivated or lacks the second factor, the same key gets 'permission denied', never the original id", () => {
      const order = h.confirmed(100000);
      const key = newKey("revoked");
      const first = h.pay(h.PATRICK, order, 10000, key, { expected: 0 });
      assert.ok(first.ok, first.err);
      db.commit(`update private.staff_members set is_active = false where user_id = '${PAT}';`);
      try {
        const replay = h.pay(h.PATRICK, order, 10000, key, { expected: 0 });
        refusedWith(replay, "42501", /permission denied/, "deactivated owner replaying");
        assert.doesNotMatch(replay.err, new RegExp(first.id));
      } finally {
        db.commit(`update private.staff_members set is_active = true where user_id = '${PAT}';`);
      }
      assert.ok(h.pay(h.PATRICK, order, 10000, key, { expected: 0 }).ok, "restored access: the repeat is answered again");
      // the owner without a second factor (aal1), direct path, same key
      const okey = newKey("aal1");
      assert.ok(h.pay(O(), order, 5000, okey, { expected: 10000 }).ok);
      const aal1 = h.attempt(AS.oliviaAal1, `select admin.record_payment('${order}'::uuid, 'deposit'::text, 5000::bigint, 'cash'::text, null::timestamptz, null::text, null::text, null::text, '${okey}'::text, 10000::bigint)`);
      h.refused(aal1, /permission denied/, "owner at aal1 replaying");
      // and a gateway session whose auth session is no longer second-factor
      db.commit(`update auth.sessions set aal = 'aal1' where id = '${SESSION.pat}';`);
      try {
        refusedWith(h.pay(h.PATRICK, order, 10000, key, { expected: 0 }), "42501", /permission denied|second factor|aal2/i, "gateway session that lost its second factor");
      } finally {
        db.commit(`update auth.sessions set aal = 'aal2' where id = '${SESSION.pat}';`);
      }
    });

    it("TIMEOUT WHILE WAITING FOR A CLAIM: a second session with the same key gives up at its own statement timeout, records nothing, and the first still commits exactly one payment", async () => {
      const order = h.confirmed(100000);
      const key = newKey("wait");
      const params = h.payParams(order, 15000, key, { expected: 0, actor: ID.olivia });
      const holder = h.parallel(O(), "record_payment", params, { holdSeconds: 2 });
      await sleep(400);
      const started = Date.now();
      const waiter = await h.parallel(O(), "record_payment", params, { timeoutMs: 500 });
      const waited = Date.now() - started;
      assert.equal(waiter.ok, false);
      assert.match(waiter.err, /statement timeout/);
      assert.ok(waited >= 400 && waited < 1900, `the waiter really waited for the claim (${waited} ms) and gave up at its own limit`);
      assert.ok((await holder).ok);
      assert.equal(h.paymentsOf(order), 1);
      const retry = h.pay(O(), order, 15000, key, { expected: 0 });
      assert.equal(retry.id, (await holder).id);
      assert.equal(retry.replayed, true);
    });

    it("THE LOSERS REALLY WAIT: sessions with the same key and other data are not answered until the first one has committed, and then see a conflict, never the original", async () => {
      const order = h.confirmed(100000);
      const key = newKey("losers");
      const winner = h.parallel(O(), "record_payment", h.payParams(order, 15000, key, { expected: 0, actor: ID.olivia }), { holdSeconds: 1.5 });
      await sleep(300);
      const started = Date.now();
      const losers = await Promise.all([15001, 15002, 15003].map((amount) => h.parallel(O(), "record_payment", h.payParams(order, amount, key, { expected: 0, actor: ID.olivia, ...{} }))));
      const waited = Date.now() - started;
      assert.ok(waited >= 900, `the losers were held until the winner committed (${waited} ms)`);
      for (const r of losers) assert.match(r.err, /different request/);
      assert.ok((await winner).ok);
      assert.equal(h.paymentsOf(order), 1);
    });
  });

  // =================================================================================================================
  describe("C9: every field of a request is part of its fingerprint, and the clock is not", () => {
    const direct = (order, key, { purpose = "deposit", amount = 5000, method = "cash", received = "null::timestamptz", receipt = "null::text", ref = "null::text", notes = "null::text", expected = "null::bigint", orderId = order } = {}) =>
      `select admin.record_payment('${orderId}', '${purpose}', ${amount}, '${method}', ${received}, ${receipt}, ${ref}, ${notes}, '${key}', ${expected});`;

    it("PAYMENT: changing the order, purpose, amount, method, date, receipt number, reference, note or expected amount under the SAME key is a conflict (M1K01)", () => {
      const order = h.confirmed(500000);
      const other = h.confirmed(500000);
      const key = newKey("fp");
      db.commit(`${AS.olivia}${direct(order, key, { received: "'2026-11-01T10:00:00Z'::timestamptz", receipt: "'RCPT-FP-1'", ref: "'ref-a'", notes: "'note-a'", expected: "0::bigint" })}`);
      const variants = {
        order: { orderId: other }, purpose: { purpose: "balance" }, amount: { amount: 5001 }, method: { method: "fawran" },
        received: { received: "'2026-11-02T10:00:00Z'::timestamptz" }, receipt: { receipt: "'RCPT-FP-2'" }, reference: { ref: "'ref-b'" },
        note: { notes: "'note-b'" }, expected: { expected: "1::bigint" },
      };
      const base = { received: "'2026-11-01T10:00:00Z'::timestamptz", receipt: "'RCPT-FP-1'", ref: "'ref-a'", notes: "'note-a'", expected: "0::bigint" };
      for (const [label, change] of Object.entries(variants)) {
        assert.equal(h.stateOf(AS.olivia, direct(order, key, { ...base, ...change }).replace(/;$/, "")), "M1K01", label);
      }
      assert.equal(h.paymentsOf(order), 1);
      assert.equal(h.paymentsOf(other), 0);
      // unchanged data (a repeat), and a receipt number with only surrounding spaces, are the SAME request
      assert.equal(h.stateOf(AS.olivia, direct(order, key, base).replace(/;$/, "")), "OK");
      assert.equal(h.stateOf(AS.olivia, direct(order, key, { ...base, receipt: "'  RCPT-FP-1  '" }).replace(/;$/, "")), "OK");
      assert.equal(h.paymentsOf(order), 1);
    });

    it("SERVER CLOCK: a payment sent without a date is dated by the database when the FIRST attempt runs; a later repeat returns that payment and does not re-date it", async () => {
      const order = h.confirmed(100000);
      const key = newKey("clock");
      const first = h.pay(O(), order, 10000, key, { expected: 0 });
      const dated = h.scalar(`select received_at::text from public.payments where id = '${first.id}'`);
      await sleep(1200);
      const again = h.pay(O(), order, 10000, key, { expected: 0 });
      assert.equal(again.id, first.id);
      assert.equal(h.scalar(`select received_at::text from public.payments where id = '${first.id}'`), dated, "the date did not move");
      assert.equal(h.paymentsOf(order), 1);
    });

    it("ORDER: customer, any item field, the quotation, who placed it, delivery method and address are all part of the fingerprint", () => {
      const key = newKey("fpo");
      const base = { customer: ID.custA, items: [{ kind: "component", description: "Fingerprint item", quantity: 2, unit_price_minor: 1500 }], quotation: "null::uuid", placed: "'admin'", method: "'delivery'", address: "'Doha'" };
      const sql = ({ customer, items, quotation, placed, method, address }) =>
        `select admin.create_order('${customer}'::uuid, '${JSON.stringify(items)}'::jsonb, ${quotation}, ${placed}::text, ${method}::text, ${address}::text, '${key}'::text)`;
      db.commit(`${AS.sam}${sql(base)};`);
      const it0 = base.items[0];
      const changes = {
        customer: { customer: ID.custB }, kind: { items: [{ ...it0, kind: "other" }] }, description: { items: [{ ...it0, description: "Other" }] },
        quantity: { items: [{ ...it0, quantity: 3 }] }, price: { items: [{ ...it0, unit_price_minor: 1501 }] }, extra_item: { items: [it0, it0] },
        quotation: { quotation: `'${ZERO}'::uuid` }, placed: { placed: "'website'" }, method: { method: "'collection'" }, address: { address: "'Lusail'" },
      };
      for (const [label, change] of Object.entries(changes)) assert.equal(h.stateOf(AS.sam, sql({ ...base, ...change })), "M1K01", label);
      assert.equal(h.stateOf(AS.sam, sql(base)), "OK", "an unchanged repeat");
      assert.equal(h.count(`select count(*) from public.orders where customer_id = '${ID.custA}' and delivery_address = 'Doha' and total_minor = 3000`), 1);
    });

    it("LOYALTY: customer, points and reason are part of the fingerprint; surrounding spaces in the reason are not", () => {
      const key = newKey("fpl");
      const sql = (customer, points, reason) => `select admin.adjust_loyalty('${customer}'::uuid, ${points}, '${reason}'::text, '${key}'::text)`;
      db.commit(`${AS.olivia}${sql(CUST_C, 9, "reason text")};`);
      assert.equal(h.stateOf(AS.olivia, sql(CUST_C, 9, "  reason text  ")), "OK", "trimmed: the same request");
      for (const [c, p, r] of [[ID.custB, 9, "reason text"], [CUST_C, 8, "reason text"], [CUST_C, 9, "other reason"]]) assert.equal(h.stateOf(AS.olivia, sql(c, p, r)), "M1K01", `${c} ${p} ${r}`);
    });

    it("the key's SHAPE is the same everywhere: 8 to 100 of letters, digits . _ : - ; and a key is scoped to the operation too (the same text for a payment and an order are independent)", () => {
      const key = newKey("shared");
      const order = h.confirmed(100000);
      assert.ok(h.pay(O(), order, 10000, key, { expected: 0 }).ok);
      assert.ok(h.createOrder(O(), CUST_C, ONE(7777), key).ok, "the same text used for another operation is its own key");
      assert.equal(h.count(`select count(*) from private.idempotency_keys where idempotency_key = '${key}'`), 2);
    });
  });

  // =================================================================================================================
  describe("C5: privileges are tight and the platform audits are clean", () => {
    it("the new functions are executable by authenticated staff and the gateway only; the claim helper and key table by nobody", () => {
      const fns = [
        "admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)", "admin.create_order(uuid, jsonb, uuid, text, text, text, text)",
        "admin.adjust_loyalty(uuid, integer, text, text)", "admin.similar_orders(uuid, jsonb, text)",
      ];
      for (const f of fns) {
        for (const role of ["public", "anon", "service_role"]) assert.equal(h.scalar(`select has_function_privilege('${role}', '${f}', 'execute')`), "f", `${role} on ${f}`);
        for (const role of ["authenticated", "m1_staff_gateway"]) assert.equal(h.scalar(`select has_function_privilege('${role}', '${f}', 'execute')`), "t", `${role} on ${f}`);
      }
      for (const role of ["public", "anon", "authenticated", "service_role", "m1_staff_gateway"]) {
        assert.equal(h.scalar(`select has_function_privilege('${role}', 'private.idempotency_claim(text, text, jsonb, uuid)', 'execute')`), "f", role);
        assert.equal(h.scalar(`select has_table_privilege('${role}', 'private.idempotency_keys', 'select,insert,update,delete,truncate,references,trigger')`), "f", role);
      }
    });

    it("the platform security audit and the gateway audit report nothing", () => {
      // (The suite's own probe helpers in schema public are test fixtures, not part of the platform.)
      assert.equal(h.count(`select count(*) from private.security_audit() where detail !~ '^public[.]zz_'`), 0);
      assert.equal(h.count(`select count(*) from private.gateway_audit() where detail !~ '^public[.]zz_'`), 0);
    });

    it("every error code the website maps is raised with the documented SQLSTATE and a message written for staff (no table, column or function names)", () => {
      const order = h.confirmed(100000);
      const samples = [
        h.pay(O(), order, 5000, newKey("e"), { expected: 77 }), // M1K03
        (() => { const k = newKey("e"); h.pay(O(), order, 5000, k, { expected: 0 }); return h.pay(O(), order, 5001, k, { expected: 0 }); })(), // M1K01
        (() => { const k = newKey("e"); h.pay(O(), order, 5000, k, { expected: 5000 }); h.ageKey(k, "2 hours"); return h.pay(O(), order, 5000, k, { expected: 5000 }); })(), // M1K02
      ];
      assert.deepEqual(samples.map((s) => s.code), ["M1K03", "M1K01", "M1K02"]);
      for (const s of samples) {
        const message = /ERROR:\s+[0-9A-Z]{5}:\s+(.*)/.exec(s.err)[1];
        assert.doesNotMatch(message, /\b(private|public|admin)\.|idempotency_keys|request_hash|result_id|pg_|constraint|relation/i, message);
      }
    });
  });

  it("ledger invariants still hold over everything this suite created", () => {
    assert.equal(h.read(`select o.order_ref from public.orders o left join (select order_id, sum(amount_minor) s from public.payments group by order_id) p on p.order_id = o.id
      where o.amount_paid_minor is distinct from coalesce(p.s, 0) or o.balance_due_minor <> o.total_minor - o.amount_paid_minor or o.amount_paid_minor < 0 or o.amount_paid_minor > o.total_minor`), "");
    assert.equal(h.count(`select count(*) from public.payments p where p.reverses_payment_id is null and p.entry_type = 'payment' and (select count(*) from private.audit_log a where a.action = 'payment.recorded' and a.entity_id = p.id::text) <> 1`), 0);
    assert.equal(h.count(`select count(*) from public.orders o where (select count(*) from private.audit_log a where a.action = 'order.created' and a.entity_id = o.id::text) <> 1`), 0);
    assert.equal(h.count(`select count(*) from private.idempotency_keys k where k.operation = 'payment.record' and not exists (select 1 from public.payments p where p.id = k.result_id)`), 0);
  });
});
