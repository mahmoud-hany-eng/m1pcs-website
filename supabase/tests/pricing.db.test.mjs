// PLAT-0005: ORDER PRICING AND REWARDS, DATABASE layer. Real PostgreSQL 16, the real migrations, the real staff functions (admin.*), the
// real row level security, and the staff gateway role running the SAME SQL text the website sends (read out of src/lib/staff/gateway.ts).
// Every amount is an integer in QAR minor units (1 QAR = 100). Every name is synthetic. Harness-supplied JWT claims stand in for Supabase
// Auth, as in every database test in this folder: a pass here proves the DATABASE's behaviour given those claims, not the website screens
// and not the real second factor.
//
// What it proves, in the order of the owner's brief:
//   A  the five deposit tiers, every boundary, the rounding, and that a discount or redeemed points never lower the deposit;
//   B  discounts: fixed and percentage, owner only, who authorized them and why, nothing silently changes the gross value;
//   C  loyalty redemption: points are an ORDER CREDIT (not a payment), partial and full, never more than the balance or the price,
//      atomic with the order, idempotent, safe against two orders spending the same points;
//   D  points are EARNED on the net payable amount only, once, when the order is completed and fully settled;
//   E  cancellation gives redeemed points back by a compensating entry (once); payment reversals leave credit and ledger alone;
//   F  the situation that is a policy decision (the net payable is below the cash deposit) is BLOCKED with an explanation;
//   G  existing orders, existing deposits and both older entry points are unchanged;   H  security: owner only, MFA, RLS, append-only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { ONE, lines, makeHelpers, newKey, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

// The owner's schedule, written out independently of the database (this is the oracle the database is held to).
const TIERS = [
  { upTo: 300000n, bps: 1500n },
  { upTo: 500000n, bps: 2500n },
  { upTo: 1000000n, bps: 3500n },
  { upTo: 1500000n, bps: 5000n },
  { upTo: null, bps: 6000n },
];
const bpsFor = (total) => TIERS.find((t) => t.upTo === null || total <= t.upTo).bps;
const depositFor = (total) => (total * bpsFor(total) + 5000n) / 10000n; // nearest 0.01, a half rounds up
const fixed = (amount, reason = "owner discount for a returning customer") => ({ mode: "fixed", amount_minor: amount, reason });
const percent = (bps, reason = "owner discount for a returning customer") => ({ mode: "percent", percent_bps: bps, reason });

suite("order pricing and rewards (PLAT-0005): five deposit tiers, discounts, loyalty redemption (real PostgreSQL 16, real migrations, real RLS)", () => {
  let db;
  let h = {};
  let OLIVIA;
  let SAM;
  const scalar = (...a) => h.scalar(...a);
  const count = (...a) => h.count(...a);

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
    ({ OLIVIA, SAM } = h);
  });
  after(() => db?.stop());

  // ---- helpers -------------------------------------------------------------------------------------------------
  /** A synthetic customer (no sign-in) holding `points` loyalty points, given by the owner. */
  const newCustomer = (points = 0) => {
    const id = randomUUID();
    const n = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${id}', 'Rewards Test ${n}', '+974555${n}', '${id}@example.test', 'walk_in');`);
    if (points) db.commit(`${AS.olivia}select admin.adjust_loyalty('${id}', ${points}, 'test points');`);
    return id;
  };
  const balanceOf = (customer) => count(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${customer}'`);
  const orderRow = (id) => JSON.parse(scalar(`select row_to_json(o)::text from public.orders o where id = '${id}'`));
  /** The database's own quote (the oracle for figures a test does not hard-code). */
  const quote = (customer, gross, discount = null, points = 0) =>
    JSON.parse(scalar(`select private.order_pricing_quote('${customer}', ${gross}, ${discount ? `'${JSON.stringify(discount)}'::jsonb` : "null"}, ${points})::text`));
  /** Creates a priced order through the gateway, with the figures a screen would have shown (taken from the quote unless given). */
  // The figures a screen showed for a key are remembered, so a retry of the same form re-sends the SAME figures (as a browser does).
  const shown = new Map();
  const place = (who, customer, items, { discount = null, points = 0, key = newKey("po"), net, deposit, method = null, address = null } = {}) => {
    const gross = items.reduce((s, i) => s + (i.quantity ?? 1) * i.unit_price_minor, 0);
    if (net === undefined || deposit === undefined) {
      if (!shown.has(key)) {
        const q = quote(customer, gross, discount, points);
        shown.set(key, { net: q.net_payable_minor, deposit: q.deposit_minor });
      }
      net ??= shown.get(key).net;
      deposit ??= shown.get(key).deposit;
    }
    const r = h.viaGateway(who, "create_order_priced", [customer, JSON.stringify(items), method, address, key, discount ? JSON.stringify(discount) : null, points, net, deposit]);
    return { ...r, key };
  };
  const placeOk = (...a) => {
    const r = place(...a);
    assert.ok(r.ok, `expected the order to be created, got: ${r.err}`);
    return r.id;
  };
  const cancelOrder = (id) => db.commit(`${AS.sam}select admin.transition_order('${id}', 'cancelled', 'test cancellation');`);
  const confirm = (id) => db.commit(`${AS.sam}select admin.transition_order('${id}', 'awaiting_deposit');`);
  const pay = (id, amount, who = AS.olivia) => db.commit(`${who}select admin.record_payment('${id}', 'deposit', ${amount}, 'cash');`);
  const ledgerOf = (id) => lines(h.read(`select entry_type || ':' || points from public.loyalty_ledger where order_id = '${id}' order by created_at, id`)).join(",");
  const walkToDelivered = (id) =>
    db.commit(`${AS.olivia}
      select admin.transition_order('${id}', 'awaiting_deposit');
      select admin.transition_order('${id}', 'deposit_received');
      select admin.transition_order('${id}', 'sourcing');
      select admin.transition_order('${id}', 'building');
      select admin.transition_order('${id}', 'quality_check');
      select admin.transition_order('${id}', 'ready_for_delivery');
      select admin.transition_order('${id}', 'delivered');`);

  // =================================================================================================================
  describe("A. the five deposit tiers", () => {
    it("the shipped orders.deposit policy is the owner's five tiers (confirmed by the owner), and the earlier three tiers stay in the history", () => {
      const pol = JSON.parse(scalar("select value::text from private.business_policies where key = 'orders.deposit'"));
      assert.equal(pol.mode, "tiered");
      assert.deepEqual(pol.tiers, [
        { up_to_minor: 300000, percent_bps: 1500 }, { up_to_minor: 500000, percent_bps: 2500 }, { up_to_minor: 1000000, percent_bps: 3500 },
        { up_to_minor: 1500000, percent_bps: 5000 }, { percent_bps: 6000 },
      ]);
      assert.equal(scalar("select confirmation from private.business_policies where key = 'orders.deposit'"), "confirmed_by_owner");
      const history = JSON.parse(scalar("select jsonb_agg(value order by version)::text from private.business_policy_versions where key = 'orders.deposit'"));
      assert.ok(history.some((v) => v.tiers?.length === 3 && v.tiers[2].percent_bps === 3500), "the earlier 15/25/35 schedule is still in the version history");
      assert.equal(history.at(-1).tiers.length, 5);
    });

    // [gross, expected deposit, expected percentage in basis points]: the exact boundaries in the brief, and one cent either side.
    const BOUNDARIES = [
      [100000n, 15000n, 1500n], [300000n, 45000n, 1500n], [300001n, 75000n, 2500n], [500000n, 125000n, 2500n], [500001n, 175000n, 3500n],
      [1000000n, 350000n, 3500n], [1000001n, 500001n, 5000n], [1500000n, 750000n, 5000n], [1500001n, 900001n, 6000n], [2500000n, 1500000n, 6000n],
    ];
    for (const [gross, expected, bps] of BOUNDARIES) {
      it(`QAR ${Number(gross) / 100}: the deposit is ${Number(expected) / 100} (${Number(bps) / 100}% of the whole total)`, () => {
        assert.equal(depositFor(gross), expected, "the test's own oracle agrees with the owner's table");
        const q = JSON.parse(scalar(`select to_jsonb(private.deposit_quote(${gross}))::text`));
        assert.equal(BigInt(q.amount_minor), expected);
        assert.equal(BigInt(q.rate_bps), bps);
      });
    }

    it("the rounding is to the nearest QAR 0.01, a half rounding up: the brief's own order of QAR 4,350.55 needs QAR 1,087.64 (25% = 1,087.6375)", () => {
      assert.equal(scalar("select (private.deposit_quote(435055)).amount_minor"), "108764");
      // exact halves: 1,000,001 x 50% = 500,000.5 -> 500,001; and a value just below a half rounds down
      assert.equal(scalar("select (private.deposit_quote(1000001)).amount_minor"), "500001");
      assert.equal(scalar("select (private.deposit_quote(300003)).amount_minor"), "75001"); // 75000.75
      assert.equal(scalar("select (private.deposit_quote(300002)).amount_minor"), "75001"); // 75000.50
      assert.equal(scalar("select (private.deposit_quote(300001)).amount_minor"), "75000"); // 75000.25
    });

    it("every total from 0 to 20,000 minor units around each boundary agrees with the independent oracle (the percentage applies to the whole total, never to slices)", () => {
      const totals = [];
      for (const edge of [300000, 500000, 1000000, 1500000]) for (let d = -50; d <= 50; d++) totals.push(edge + d);
      for (let t = 0; t <= 60; t++) totals.push(t);
      const out = lines(h.read(`select t || ':' || (private.deposit_quote(t)).amount_minor from unnest(array[${totals.join(",")}]::bigint[]) t`));
      assert.equal(out.length, totals.length);
      for (const row of out) {
        const [t, d] = row.split(":");
        assert.equal(BigInt(d), depositFor(BigInt(t)), `total ${t}`);
      }
    });

    it("the deposit of a new order is worked out from the ORIGINAL GROSS total: a discount never lowers it (4,000 with 500 off -> 1,000; 12,000 with 1,000 off -> 6,000)", () => {
      const c = newCustomer();
      const a = placeOk(OLIVIA, c, ONE(400000), { discount: fixed(50000) });
      assert.equal(orderRow(a).deposit_required_minor, 100000, "25% of the gross 4,000.00, not of the 3,500.00 left");
      assert.equal(orderRow(a).total_minor, 400000, "the gross value is not reduced");
      assert.equal(orderRow(a).net_payable_minor, 350000);
      const b = placeOk(OLIVIA, c, ONE(1200000), { discount: fixed(100000) });
      assert.equal(orderRow(b).deposit_required_minor, 600000, "50% of the gross 12,000.00");
      assert.equal(orderRow(b).net_payable_minor, 1100000);
      // a discount that would drop the order into a LOWER tier still leaves the tier of the gross: 3,100 gross, 200 off -> 2,900 net, tier 2 (25%)
      const t = placeOk(OLIVIA, c, ONE(310000), { discount: fixed(20000) });
      assert.equal(orderRow(t).deposit_required_minor, 77500, "25% of 3,100.00, although the net payable is under 3,000.00");
    });

    it("redeemed loyalty points never lower the tier or the deposit either", () => {
      const c = newCustomer(5000);
      const o = placeOk(OLIVIA, c, ONE(1200000), { points: 4000 }); // 4,000 points = QAR 400.00
      assert.equal(orderRow(o).deposit_required_minor, 600000);
      assert.equal(orderRow(o).net_payable_minor, 1160000);
    });

    it("an order is confirmed at the deposit worked out from its gross total, and that is the deposit that gates it", () => {
      const c = newCustomer();
      const o = placeOk(OLIVIA, c, ONE(1200000), { discount: fixed(100000) });
      confirm(o);
      const row = orderRow(o);
      assert.equal(row.deposit_required_minor, 600000);
      assert.ok(row.deposit_fixed_at);
      assert.equal(row.status, "awaiting_deposit");
      assert.match(row.deposit_rule, /tier 4 of 5: 50\.00% of the whole order total/);
      // 599,999 is not enough to leave "awaiting deposit"; 600,000 is
      pay(o, 599999);
      assert.match(h.attempt(AS.sam, `select admin.transition_order('${o}', 'deposit_received')`), /deposit has not been fully paid/);
      pay(o, 1);
      db.commit(`${AS.sam}select admin.transition_order('${o}', 'deposit_received');`);
      assert.equal(orderRow(o).status, "deposit_received");
    });
  });

  // =================================================================================================================
  describe("B. discounts (owner only, recorded, never silent)", () => {
    it("a fixed discount: gross, discount, net payable, deposit and the cash left after the deposit are all kept apart", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000) });
      const o = orderRow(id);
      assert.deepEqual(
        [o.total_minor, o.discount_minor, o.loyalty_credit_minor, o.net_payable_minor, o.deposit_required_minor, o.amount_paid_minor, o.balance_due_minor],
        [435055, 10000, 0, 425055, 108764, 0, 425055],
      );
      const q = quote(c, 435055, fixed(10000));
      assert.equal(q.cash_balance_after_deposit_minor, 425055 - 108764);
    });

    it("a percentage discount is rounded to the nearest QAR 0.01 (a half rounds up) and the amount is stored explicitly", () => {
      const c = newCustomer();
      // 12.5% of 435,055 = 54,381.875 -> 54,382
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: percent(1250) });
      assert.equal(orderRow(id).discount_minor, 54382);
      assert.equal(orderRow(id).net_payable_minor, 435055 - 54382);
      // exactly half a minor unit: 10% (1000 bps) of 1,005 = 100.5 -> 101
      assert.equal(quote(c, 1005, percent(1000)).discount_minor, 101);
      // the percentage and the amount are both on the owner's record
      const rec = JSON.parse(scalar(`select to_jsonb(d)::text from private.order_discounts d where order_id = '${id}'`));
      assert.equal(rec.mode, "percent");
      assert.equal(rec.percent_bps, 1250);
      assert.equal(rec.amount_minor, 54382);
      assert.equal(rec.base_minor, 435055);
    });

    it("who authorized the discount and why is recorded, audited, and shown to staff; the customer sees the amount but not the record", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(200000), { discount: fixed(5000, "Goodwill after a delayed delivery") });
      const rec = JSON.parse(scalar(`select to_jsonb(d)::text from private.order_discounts d where order_id = '${id}'`));
      assert.equal(rec.authorized_by, ID.olivia);
      assert.equal(rec.reason, "Goodwill after a delayed delivery");
      const audit = lines(h.read(`select action from private.audit_log where entity_id = '${id}' order by id`));
      assert.ok(audit.includes("order.discount_applied"), audit.join(","));
      assert.ok(audit.includes("order.created"));
      const view = JSON.parse(scalar(`select admin.get_order('${id}')::text`, AS.olivia));
      assert.equal(view.discount_minor, 5000);
      assert.equal(view.net_payable_minor, 195000);
      assert.equal(view.discount_record.authorized_by, "Owner (test)");
      assert.equal(view.discount_record.reason, "Goodwill after a delayed delivery");
      assert.equal(view.total_minor, 200000, "get_order still reports the gross value as total_minor");
    });

    it("only the owner may discount: a staff member (without the permission) is refused, and nothing is created", () => {
      const c = newCustomer();
      const orders = count("select count(*) from public.orders");
      const discounts = count("select count(*) from private.order_discounts");
      const keys = count("select count(*) from private.idempotency_keys");
      const r = place(SAM, c, ONE(100000), { discount: fixed(1000), net: 99000, deposit: 15000 });
      assert.equal(r.ok, false);
      assert.equal(r.code, "42501");
      assert.equal(count("select count(*) from public.orders"), orders);
      assert.equal(count("select count(*) from private.order_discounts"), discounts);
      assert.equal(count("select count(*) from private.idempotency_keys"), keys, "a refused request does not even claim its key");
    });

    it("a staff member can still create an ordinary order through the new entry point (no discount, no points)", () => {
      const c = newCustomer();
      const id = placeOk(SAM, c, ONE(100000));
      const o = orderRow(id);
      assert.deepEqual([o.discount_minor, o.loyalty_credit_minor, o.net_payable_minor, o.deposit_required_minor], [0, 0, 100000, 15000]);
    });

    it("a discount needs the second factor like everything else: an owner session without it is refused", () => {
      const c = newCustomer();
      const out = h.attempt(AS.oliviaAal1, `select admin.create_order('${c}', '[{"kind":"component","description":"x","quantity":1,"unit_price_minor":100000}]'::jsonb, null, 'admin', null, null, 'aal1-key-0001', '{"mode":"fixed","amount_minor":1000,"reason":"owner discount"}'::jsonb, 0, 99000, 15000)`);
      assert.match(out, /^REFUSED: /);
      assert.match(out, /permission/i);
    });

    it("refuses what is not a sensible discount, with a reason in words", () => {
      const c = newCustomer();
      const bad = (discount, pattern, label) => {
        const r = place(OLIVIA, c, ONE(100000), { discount, net: 0, deposit: 0 });
        assert.equal(r.ok, false, label);
        assert.match(r.err, pattern, label);
      };
      bad(fixed(0), /at least 1/, "zero");
      bad(fixed(-5), /whole number/, "negative");
      bad(fixed(100001), /more than the order total/, "more than the order");
      bad(percent(0), /0\.01%/, "zero percent");
      bad(percent(10001), /0\.01%/, "over 100 percent");
      bad({ mode: "fixed", amount_minor: 1000 }, /reason is required/, "no reason");
      bad({ mode: "fixed", amount_minor: 1000, reason: "ok", surprise: 1 }, /not allowed/, "an unknown field");
      bad({ mode: "bogus", amount_minor: 1000, reason: "owner discount" }, /fixed or percent/, "an unknown mode");
      bad({ mode: "fixed", amount_minor: 1000, percent_bps: 10, reason: "owner discount" }, /carries an amount/, "both an amount and a percentage");
    });

    it("a discount line item is refused by the new entry point (discounts are entered, authorized and recorded in Pricing & Rewards)", () => {
      const c = newCustomer();
      const items = [{ kind: "component", description: "GPU", quantity: 1, unit_price_minor: 100000 }, { kind: "discount", description: "friends and family", quantity: 1, unit_price_minor: -10000 }];
      const r = place(OLIVIA, c, items, { net: 90000, deposit: 13500 });
      assert.equal(r.ok, false);
      assert.match(r.err, /discounts are entered under Pricing & Rewards/);
    });

    it("the discount of an order cannot be changed afterwards, by anyone, however the update is attempted", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(200000), { discount: fixed(5000) });
      const plain = h.make(ONE(200000), c);
      for (const sql of [
        `update public.orders set discount_minor = 9000 where id = '${id}'`,
        `update public.orders set loyalty_points_redeemed = 5, loyalty_credit_minor = 50 where id = '${id}'`,
        `update public.orders set total_minor = 1 where id = '${id}'`,
        // an order that carries none cannot be given one later either: pricing is set only in the transaction that creates the order
        `update public.orders set discount_minor = 1000 where id = '${plain}'`,
      ]) {
        const r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\n${sql};\nrollback;`);
        assert.equal(r.ok, false, sql);
        assert.match(r.err, /(can only be set when the order is created|cannot be changed)/, sql);
      }
      assert.equal(orderRow(id).discount_minor, 5000);
    });

    it("the discount record is append-only: it cannot be edited or deleted, and it is not readable by a customer or by anon", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(200000), { discount: fixed(5000) });
      for (const sql of [`update private.order_discounts set amount_minor = 1 where order_id = '${id}'`, `delete from private.order_discounts where order_id = '${id}'`, "truncate private.order_discounts"]) {
        const r = db.cluster.psql(`begin;\n${sql};\nrollback;`);
        assert.equal(r.ok, false, sql);
      }
      for (const who of [AS.anon, AS.alice, AS.service]) {
        assert.equal(h.rowsSeen(who, "select count(*) from private.order_discounts"), "DENIED");
      }
    });

    it("discounts are switched off, with a clear message, whenever the loyalty earning rule is not one that counts only payable money", () => {
      const c = newCustomer();
      db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "order_total", "rounding": "floor"}'::jsonb, 'unconfirmed_default', 'test: earning on the gross total');`);
      try {
        const r = place(OLIVIA, c, ONE(100000), { discount: fixed(1000), net: 99000, deposit: 15000 });
        assert.equal(r.ok, false);
        assert.match(r.err, /switched off until the loyalty rule/);
        // an order without a discount is unaffected
        placeOk(OLIVIA, c, ONE(100000));
      } finally {
        db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "net_payable", "rounding": "floor"}'::jsonb, 'confirmed_by_owner', 'test: restore');`);
      }
      placeOk(OLIVIA, c, ONE(100000), { discount: fixed(1000) });
    });
  });

  // =================================================================================================================
  describe("C. loyalty redemption: an order credit, not a payment", () => {
    it("the brief's example: gross 4,350.55, discount 100.00, 435 points (QAR 43.50) -> net 4,207.05, deposit 1,087.64 (25% of the ORIGINAL 4,350.55), cash left after the deposit 3,119.41", () => {
      const c = newCustomer(500);
      const q = quote(c, 435055, fixed(10000), 435); // what the screen shows, before anything is saved
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435 });
      const o = orderRow(id);
      assert.deepEqual(
        [o.total_minor, o.discount_minor, o.loyalty_points_redeemed, o.loyalty_credit_minor, o.net_payable_minor, o.deposit_required_minor, o.amount_paid_minor, o.balance_due_minor],
        [435055, 10000, 435, 4350, 420705, 108764, 0, 420705],
      );
      assert.equal(q.cash_balance_after_deposit_minor, 311941, "QAR 3,119.41 of cash is still to pay after the deposit");
      assert.equal(q.points_balance_before, 500);
      assert.equal(q.points_balance_after, 65);
    });

    it("a redeemed point is an ORDER CREDIT, not a payment: no payment row, no receipt, nothing counted as cash received", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435 });
      assert.equal(count(`select count(*) from public.payments where order_id = '${id}'`), 0);
      assert.equal(orderRow(id).amount_paid_minor, 0);
      assert.equal(count(`select count(*) from public.payments where receipt_number is not null and order_id = '${id}'`), 0);
      // staff see the credit as a credit, apart from the payments
      const view = JSON.parse(scalar(`select admin.get_order('${id}')::text`, AS.olivia));
      assert.deepEqual(view.payments, []);
      assert.equal(view.loyalty_credit_minor, 4350);
      assert.equal(view.redemption_record.points, 435);
      assert.equal(view.redemption_record.returned, false);
    });

    it("the redemption is a ledger entry on that order, written together with the order; the balance is the sum of the ledger", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { points: 435 });
      assert.equal(ledgerOf(id), "redemption:-435");
      assert.equal(balanceOf(c), 65);
      assert.match(scalar(`select description from public.loyalty_ledger where order_id = '${id}'`), /^Redeemed on order O-\d{4}-\d{5}: QAR 43\.50 credit$/);
    });

    it("partial and full redemption: some of the points, then every remaining point", () => {
      const c = newCustomer(1000);
      const a = placeOk(OLIVIA, c, ONE(2000000), { points: 300 });
      assert.equal(orderRow(a).loyalty_credit_minor, 3000);
      assert.equal(balanceOf(c), 700);
      const b = placeOk(OLIVIA, c, ONE(2000000), { points: 700 }); // the whole remaining balance
      assert.equal(orderRow(b).loyalty_credit_minor, 7000);
      assert.equal(balanceOf(c), 0);
    });

    it("a customer with no points cannot redeem any; the order is not created", () => {
      const c = newCustomer(0);
      const r = place(OLIVIA, c, ONE(100000), { points: 1, net: 99990, deposit: 15000 });
      assert.equal(r.ok, false);
      assert.match(r.err, /has 0 points, so 1 cannot be redeemed/);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 0);
    });

    it("more points than the balance are refused, and the balance is untouched", () => {
      const c = newCustomer(100);
      const r = place(OLIVIA, c, ONE(500000), { points: 101, net: 489900, deposit: 125000 });
      assert.equal(r.ok, false);
      assert.match(r.err, /has 100 points, so 101 cannot be redeemed/);
      assert.equal(balanceOf(c), 100);
    });

    it("more credit than is left to pay after the discount is refused, with the most that can be redeemed", () => {
      const c = newCustomer(5000);
      // gross 200.00, discount 50.00 -> 150.00 left; 1,501 points would be 150.10
      const r = place(OLIVIA, c, ONE(20000), { discount: fixed(5000), points: 1501, net: 0, deposit: 0 });
      assert.equal(r.ok, false);
      assert.match(r.err, /more than the QAR 150\.00 left to pay after the discount; redeem at most 1500 points/);
      assert.equal(balanceOf(c), 5000);
    });

    it("zero is 'no redemption': an order with 0 points carries no credit and writes no ledger entry", () => {
      const c = newCustomer(100);
      const id = placeOk(OLIVIA, c, ONE(100000), { points: 0 });
      assert.equal(orderRow(id).loyalty_points_redeemed, 0);
      assert.equal(ledgerOf(id), "");
      assert.equal(balanceOf(c), 100);
    });

    it("the ledger and the order refuse an inconsistent redemption on their own (the database is the last line, whatever calls it)", () => {
      const c = newCustomer(10);
      const id = h.make(ONE(100000), c);
      // an entry that spends more than the balance
      let r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\ninsert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values ('${c}', '${id}', 'redemption', -11, 'x');\nrollback;`);
      assert.equal(r.ok, false);
      assert.match(r.err, /not enough loyalty points/);
      // a redemption with the wrong sign, or without an order
      r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\ninsert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values ('${c}', '${id}', 'redemption', 5, 'x');\nrollback;`);
      assert.equal(r.ok, false);
      r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\ninsert into public.loyalty_ledger (customer_id, entry_type, points, description) values ('${c}', 'redemption', -5, 'x');\nrollback;`);
      assert.equal(r.ok, false);
      // credit without points on the order
      r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\nupdate public.orders set loyalty_credit_minor = 50 where id = '${id}';\nrollback;`);
      assert.equal(r.ok, false);
      // more discount and credit than the order is worth
      r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\nupdate public.orders set discount_minor = total_minor + 1 where id = '${id}';\nrollback;`);
      assert.equal(r.ok, false);
    });

    it("only the owner may redeem: a staff member is refused (and learns nothing about the customer's points)", () => {
      const c = newCustomer(500);
      const r = place(SAM, c, ONE(100000), { points: 100, net: 90000, deposit: 15000 });
      assert.equal(r.ok, false);
      assert.equal(r.code, "42501");
      assert.equal(balanceOf(c), 500);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 0);
    });

    it("what the order form is told: the point value, the deposit schedule, and the points only to someone who may redeem or read the ledger", () => {
      const c = newCustomer(250);
      const owner = JSON.parse(scalar(`select admin.order_pricing_context('${c}')::text`, AS.olivia));
      assert.equal(owner.point_value_minor, 10);
      assert.equal(owner.earn_qar_per_point_minor, 1000);
      assert.equal(owner.earning_base, "net_payable");
      assert.equal(owner.pricing_enabled, true);
      assert.equal(owner.can_discount, true);
      assert.equal(owner.can_redeem, true);
      assert.equal(owner.points_balance, 250);
      assert.equal(owner.deposit_policy.tiers.length, 5);
      const staff = JSON.parse(scalar(`select admin.order_pricing_context('${c}')::text`, AS.sam));
      assert.equal(staff.can_discount, false);
      assert.equal(staff.can_redeem, false);
      assert.equal(staff.points_balance, null, "a staff member without the permissions is not told the customer's balance");
      const zero = JSON.parse(scalar(`select admin.order_pricing_context('${newCustomer(0)}')::text`, AS.olivia));
      assert.equal(zero.points_balance, 0);
    });
  });

  // =================================================================================================================
  describe("C2. atomic, idempotent and safe against double spending", () => {
    it("a failed order creation does not consume points: a stale figure on the screen is refused before anything is written", () => {
      const c = newCustomer(500);
      const key = newKey("stale");
      const keys = count("select count(*) from private.idempotency_keys");
      const r = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key, net: 999999, deposit: 108764 });
      assert.equal(r.ok, false);
      assert.equal(r.code, "M1K03");
      assert.match(r.err, /the amount payable is now QAR 4,207\.05 but the screen showed QAR 9,999\.99; nothing was created/);
      assert.equal(balanceOf(c), 500);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 0);
      assert.equal(count("select count(*) from private.idempotency_keys"), keys, "the key was not consumed either");
      const r2 = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key, net: 999999 - 999999 + 420705, deposit: 108764 });
      assert.equal(r2.ok, true, "the same key can be used once the figures are right");
    });

    it("a refused attempt leaves no trace, so the same form (same key) can be corrected and sent again with a DIFFERENT discount and different points", () => {
      const c = newCustomer(500);
      const key = newKey("corrected");
      const first = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key, net: 111111, deposit: 108764 });
      assert.equal(first.ok, false);
      assert.equal(first.code, "M1K03");
      assert.equal(count(`select count(*) from private.idempotency_keys where idempotency_key = '${key}'`), 0, "the refusal left no key behind");
      const second = place(OLIVIA, c, ONE(435055), { discount: fixed(5000), points: 100, key });
      assert.ok(second.ok, second.err);
      assert.equal(orderRow(second.id).discount_minor, 5000);
      assert.equal(orderRow(second.id).loyalty_points_redeemed, 100);
      assert.equal(balanceOf(c), 400);
      // and only now is the key bound to what was created: another change under it is a different request
      const third = place(OLIVIA, c, ONE(435055), { discount: fixed(9000), points: 100, key });
      assert.equal(third.ok, false);
      assert.equal(third.code, "M1K01");
      assert.equal(balanceOf(c), 400);
    });

    it("a failure AFTER the points were spent undoes everything: no order, no discount record, no ledger entry, no claimed key", () => {
      const c = newCustomer(500);
      db.commit(`create function public.zz_fail_after() returns trigger language plpgsql as $f$ begin raise exception 'injected failure at the very end'; end $f$;
                 create trigger zz_fail_after before insert on private.audit_log for each row when (new.action = 'order.created') execute function public.zz_fail_after();`);
      try {
        const key = newKey("inject");
        const r = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key });
        assert.equal(r.ok, false);
        assert.equal(balanceOf(c), 500, "the points were not consumed");
        assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 0);
        assert.equal(count(`select count(*) from private.order_discounts where reason like 'owner discount%' and order_id not in (select id from public.orders)`), 0);
        assert.equal(count(`select count(*) from public.loyalty_ledger where customer_id = '${c}' and entry_type = 'redemption'`), 0);
        assert.equal(count(`select count(*) from private.idempotency_keys where idempotency_key = '${key}'`), 0);
      } finally {
        db.commit("drop trigger zz_fail_after on private.audit_log; drop function public.zz_fail_after();");
      }
    });

    it("duplicate submission (a double click, a retry): the SAME key returns the SAME order and the points are spent once", () => {
      const c = newCustomer(500);
      const key = newKey("dup");
      const first = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key });
      assert.ok(first.ok, first.err);
      assert.equal(first.replayed, false);
      const second = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key });
      assert.ok(second.ok, second.err);
      assert.equal(second.id, first.id);
      assert.equal(second.replayed, true, "the screen is told it was a repeat");
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 1);
      assert.equal(ledgerOf(first.id), "redemption:-435");
      assert.equal(balanceOf(c), 65);
      assert.equal(count(`select count(*) from private.order_discounts where order_id = '${first.id}'`), 1);
    });

    it("the same key with a different discount or different points is a DIFFERENT request: refused, and nothing changes", () => {
      const c = newCustomer(500);
      const key = newKey("diff");
      const first = place(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435, key });
      assert.ok(first.ok);
      for (const variant of [{ discount: fixed(10001), points: 435 }, { discount: fixed(10000), points: 100 }, { discount: null, points: 435 }, { discount: fixed(10000, "another reason entirely"), points: 435 }]) {
        const r = place(OLIVIA, c, ONE(435055), { ...variant, key });
        assert.equal(r.ok, false, JSON.stringify(variant));
        assert.equal(r.code, "M1K01", JSON.stringify(variant));
      }
      assert.equal(balanceOf(c), 65);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 1);
    });

    it("RACE: six parallel sessions submit the SAME order with points: all get the SAME order, the points are spent exactly once", async () => {
      const c = newCustomer(500);
      const key = newKey("race");
      const q = quote(c, 435055, fixed(10000), 435);
      const params = [c, JSON.stringify(ONE(435055)), null, null, key, JSON.stringify(fixed(10000)), 435, q.net_payable_minor, q.deposit_minor];
      const first = h.parallel(OLIVIA, "create_order_priced", params, { holdSeconds: 1.2 });
      await new Promise((r) => setTimeout(r, 300));
      const rest = Array.from({ length: 5 }, () => h.parallel(OLIVIA, "create_order_priced", params));
      const results = await Promise.all([first, ...rest]);
      for (const r of results) assert.ok(r.ok, r.err);
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 1);
      assert.equal(count(`select count(*) from public.loyalty_ledger where customer_id = '${c}' and entry_type = 'redemption'`), 1);
      assert.equal(balanceOf(c), 65);
    });

    it("RACE: two orders for one customer cannot spend the same points: 100 points, two orders of 60 -> exactly one succeeds, the balance is 40", async () => {
      const c = newCustomer(100);
      const mk = (points) => {
        const q = quote(c, 500000, null, points);
        return [c, JSON.stringify(ONE(500000)), null, null, newKey("two"), null, points, q.net_payable_minor, q.deposit_minor];
      };
      const a = h.parallel(OLIVIA, "create_order_priced", mk(60), { holdSeconds: 1.2 });
      await new Promise((r) => setTimeout(r, 300));
      const b = h.parallel(OLIVIA, "create_order_priced", mk(60));
      const [ra, rb] = await Promise.all([a, b]);
      assert.deepEqual([ra.ok, rb.ok].sort(), [false, true]);
      const loser = ra.ok ? rb : ra;
      assert.match(loser.err, /has 40 points, so 60 cannot be redeemed/);
      assert.equal(balanceOf(c), 40);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 1);
    });

    it("RACE: eight parallel orders of 30 points each against a balance of 100: exactly three succeed, the balance is 10, never negative", async () => {
      const c = newCustomer(100);
      const q = quote(c, 500000, null, 30);
      const mk = () => [c, JSON.stringify(ONE(500000)), null, null, newKey("eight"), null, 30, q.net_payable_minor, q.deposit_minor];
      const first = h.parallel(OLIVIA, "create_order_priced", mk(), { holdSeconds: 0.8 });
      await new Promise((r) => setTimeout(r, 250));
      const rest = Array.from({ length: 7 }, () => h.parallel(OLIVIA, "create_order_priced", mk()));
      const results = await Promise.all([first, ...rest]);
      assert.equal(results.filter((r) => r.ok).length, 3);
      assert.equal(balanceOf(c), 10);
      assert.equal(count(`select count(*) from public.loyalty_ledger where customer_id = '${c}' and entry_type = 'redemption'`), 3);
      assert.ok(balanceOf(c) >= 0);
    });

    it("RACE: a redemption and a negative adjustment of the same points at the same moment: one of them is refused, the balance never goes below zero", async () => {
      const c = newCustomer(100);
      const q = quote(c, 500000, null, 60);
      const order = h.parallel(OLIVIA, "create_order_priced", [c, JSON.stringify(ONE(500000)), null, null, newKey("mix"), null, 60, q.net_payable_minor, q.deposit_minor], { holdSeconds: 1.2 });
      await new Promise((r) => setTimeout(r, 300));
      const adjust = h.asyncPsql(`begin;\n${h.gatewayPrefix(OLIVIA.sub, OLIVIA.sid)}select admin.adjust_loyalty('${c}', -60, 'test removal', '${newKey("adj")}');\ncommit;`);
      const [ro, ra] = await Promise.all([order, adjust]);
      assert.deepEqual([ro.ok, ra.ok].sort(), [false, true]);
      assert.ok(balanceOf(c) >= 0);
      assert.equal(balanceOf(c), 40);
    });
  });

  // =================================================================================================================
  describe("D. points are earned on the NET payable amount only, once, when completed and fully settled", () => {
    it("the brief's example: net 4,207.05 -> floor(4,207.05 / 10) = 420 points (not 435 on the gross 4,350.55), awarded once the order is delivered and paid in full", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435 });
      pay(id, 420704); // one minor unit short of the net payable amount
      walkToDelivered(id);
      assert.equal(ledgerOf(id), "redemption:-435", "delivered but not fully settled: no points yet");
      pay(id, 1); // now the payable amount is settled
      assert.equal(ledgerOf(id), "redemption:-435,award:420");
      assert.equal(balanceOf(c), 500 - 435 + 420);
      assert.equal(orderRow(id).balance_due_minor, 0);
    });

    it("no points on discounted money: a 975.00 net after a 25.00 discount earns 97 points, not 100", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      pay(id, 97500);
      walkToDelivered(id);
      assert.equal(ledgerOf(id), "award:97");
    });

    it("an order with no discount and no redemption earns exactly as before: one point per QAR 10 of the total", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000));
      pay(id, 100000);
      walkToDelivered(id);
      assert.equal(ledgerOf(id), "award:100");
    });

    it("the amount payable is the earning base whatever the rule is called: if the owner switches the rule back to the earlier 'order total' placeholder, a discounted order STILL earns on what was payable (97, not 100)", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      pay(id, 97500);
      db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "order_total", "rounding": "floor"}'::jsonb, 'confirmed_by_owner', 'review test: the earlier placeholder rule');`);
      try {
        walkToDelivered(id);
        assert.equal(ledgerOf(id), "award:97");
      } finally {
        db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "net_payable", "rounding": "floor"}'::jsonb, 'confirmed_by_owner', 'review test: restored');`);
      }
    });

    it("points are awarded once only, however often the rule is evaluated again", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      pay(id, 97500);
      walkToDelivered(id);
      db.commit(`${AS.olivia}select admin.award_loyalty_for_order('${id}');`);
      db.commit(`${AS.olivia}select admin.award_loyalty_for_order('${id}');`);
      assert.equal(ledgerOf(id), "award:97");
      assert.equal(count(`select count(*) from public.loyalty_ledger where order_id = '${id}' and entry_type = 'award'`), 1);
    });

    it("a payment can never exceed the net payable amount: paying the gross is refused, with the figure in words", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      const out = h.attempt(AS.olivia, `select admin.record_payment('${id}', 'deposit', 100000, 'cash')`);
      assert.match(out, /^REFUSED: this payment would exceed the amount payable on this order \(QAR 975\.00 after the discount and loyalty credit\)/);
      pay(id, 97500);
      assert.equal(orderRow(id).balance_due_minor, 0);
      assert.match(h.attempt(AS.olivia, `select admin.record_payment('${id}', 'deposit', 1, 'cash')`), /exceed/);
    });

    it("the same refusal through the website's own statement, and the 10-argument keyed record_payment, count the discounted amount as the limit", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      const over = h.pay(OLIVIA, id, 97501, newKey("pay"));
      assert.equal(over.ok, false);
      assert.match(over.err, /exceed the amount payable/);
      const exact = h.pay(OLIVIA, id, 97500, newKey("pay"));
      assert.ok(exact.ok, exact.err);
    });
  });

  // =================================================================================================================
  describe("E. cancellation and reversals: compensating entries, never edits", () => {
    it("cancelling an order that redeemed points gives them back with a NEW compensating entry that points at the redemption", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435 });
      assert.equal(balanceOf(c), 65);
      cancelOrder(id);
      assert.equal(orderRow(id).status, "cancelled");
      assert.equal(ledgerOf(id), "redemption:-435,redemption_restore:435");
      assert.equal(balanceOf(c), 500);
      assert.equal(count(`select count(*) from public.loyalty_ledger r join public.loyalty_ledger o on o.id = r.reverses_entry_id where r.order_id = '${id}' and r.entry_type = 'redemption_restore' and o.entry_type = 'redemption'`), 1);
      assert.equal(orderRow(id).loyalty_points_redeemed, 435, "the order keeps the record of what was redeemed; only the ledger compensates");
      const view = JSON.parse(scalar(`select admin.get_order('${id}')::text`, AS.olivia));
      assert.equal(view.redemption_record.returned, true);
      assert.ok(lines(h.read(`select action from private.audit_log where entity_id = '${id}'`)).includes("loyalty.redemption_restored"));
    });

    it("the points are never restored twice: calling the restoration again writes nothing, and the database refuses a second restoration entry", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { points: 435 });
      cancelOrder(id);
      const again = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\nselect private.restore_redeemed_points('${id}', 'again');\ncommit;`);
      assert.ok(again.ok, again.err);
      assert.equal(ledgerOf(id), "redemption:-435,redemption_restore:435");
      const dup = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);
        insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, reverses_entry_id, description)
        select customer_id, order_id, 'redemption_restore', 435, id, 'manual duplicate' from public.loyalty_ledger where order_id = '${id}' and entry_type = 'redemption';\nrollback;`);
      assert.equal(dup.ok, false);
      assert.match(dup.err, /loyalty_one_restore_per_redemption/);
      assert.equal(balanceOf(c), 500);
    });

    it("cancelling an order that redeemed nothing writes no loyalty entry", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(1000) });
      cancelOrder(id);
      assert.equal(ledgerOf(id), "");
      assert.equal(balanceOf(c), 500);
    });

    it("the ledger stays append-only: the redemption and its restoration can be neither edited nor deleted", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { points: 435 });
      cancelOrder(id);
      for (const sql of [`update public.loyalty_ledger set points = -1 where order_id = '${id}'`, `delete from public.loyalty_ledger where order_id = '${id}'`]) {
        const r = db.cluster.psql(`begin;\n${sql};\nrollback;`);
        assert.equal(r.ok, false, sql);
      }
    });

    it("restoring never claws back earned points and never creates a negative balance, even when the customer has spent the restored points elsewhere", () => {
      const c = newCustomer(100);
      const id = placeOk(OLIVIA, c, ONE(500000), { points: 100 }); // spends all 100
      assert.equal(balanceOf(c), 0);
      cancelOrder(id);
      assert.equal(balanceOf(c), 100);
      const spent = placeOk(OLIVIA, c, ONE(500000), { points: 100 });
      assert.equal(balanceOf(c), 0);
      assert.ok(spent);
    });

    it("a payment reversal leaves the credit, the discount and the redemption ledger exactly as they were, and recomputes only the cash", () => {
      const c = newCustomer(500);
      const id = placeOk(OLIVIA, c, ONE(435055), { discount: fixed(10000), points: 435 });
      const payId = lines(db.commit(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 108764, 'cash');`)).pop().trim();
      assert.equal(orderRow(id).balance_due_minor, 420705 - 108764);
      db.commit(`${AS.olivia}select admin.reverse_payment('${payId}', 'recorded on the wrong order');`);
      const o = orderRow(id);
      assert.equal(o.amount_paid_minor, 0);
      assert.equal(o.balance_due_minor, 420705);
      assert.deepEqual([o.discount_minor, o.loyalty_points_redeemed, o.loyalty_credit_minor, o.net_payable_minor], [10000, 435, 4350, 420705]);
      assert.equal(ledgerOf(id), "redemption:-435");
      assert.equal(balanceOf(c), 65);
    });

    it("a payment reversal after the points were earned does not claw them back (that policy is the owner's to approve, and is not implemented)", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(2500) });
      const payId = lines(db.commit(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 97500, 'cash');`)).pop().trim();
      walkToDelivered(id);
      assert.equal(ledgerOf(id), "award:97");
      db.commit(`${AS.olivia}select admin.reverse_payment('${payId}', 'bank returned the transfer');`);
      assert.equal(ledgerOf(id), "award:97");
    });

    it("cancelling an order that redeemed points works whatever reason is typed: 'ok' (too short for the points entry), nothing, or a normal sentence; the points come back once", () => {
      for (const reason of ["ok", "", "customer changed their mind"]) {
        const c = newCustomer(300);
        const id = placeOk(OLIVIA, c, ONE(200000), { points: 100 });
        assert.equal(balanceOf(c), 200);
        const r = db.cluster.psql(`begin;\n${AS.sam}select admin.transition_order('${id}', 'cancelled', ${reason === "" ? "null" : `'${reason}'`});\ncommit;`);
        assert.ok(r.ok, `reason ${JSON.stringify(reason)}: ${r.err}`);
        assert.equal(orderRow(id).status, "cancelled");
        assert.equal(balanceOf(c), 300, `reason ${JSON.stringify(reason)}: the points are back`);
        assert.equal(ledgerOf(id), "redemption:-100,redemption_restore:100");
        const kept = lines(h.read(`select r.reason from private.loyalty_entry_reasons r join public.loyalty_ledger l on l.id = r.entry_id where l.order_id = '${id}' and l.entry_type = 'redemption_restore'`)).pop();
        assert.equal(kept, reason.length >= 3 ? reason : "order cancelled", `the reason kept with the points entry for ${JSON.stringify(reason)}`);
      }
    });
  });

  // =================================================================================================================
  describe("F. the policy decision: a net payable below the cash deposit is BLOCKED, never silently resolved", () => {
    const BLOCK = /leave QAR .* to pay, which is less than the QAR .* cash deposit/;

    it("a discount that leaves less than the gross-based deposit is refused with an explanation; nothing is created, the deposit is not lowered, no payment is invented", () => {
      const c = newCustomer();
      // gross 1,000.00 -> deposit 150.00 (15%); a 910.00 discount leaves 90.00 to pay
      const r = place(OLIVIA, c, ONE(100000), { discount: fixed(91000), net: 9000, deposit: 15000 });
      assert.equal(r.ok, false);
      assert.match(r.err, BLOCK);
      assert.match(r.err, /The deposit is not lowered automatically and no payment can be invented/);
      assert.equal(count(`select count(*) from public.orders where customer_id = '${c}'`), 0);
      assert.equal(count(`select count(*) from private.order_discounts where base_minor = 100000 and amount_minor = 91000`), 0);
    });

    it("exactly at the line it is allowed: a net payable equal to the deposit leaves nothing to pay after the deposit, and the deposit is unchanged", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(85000) });
      const o = orderRow(id);
      assert.deepEqual([o.net_payable_minor, o.deposit_required_minor], [15000, 15000]);
      assert.equal(quote(c, 100000, fixed(85000)).cash_balance_after_deposit_minor, 0);
      // one minor unit further is blocked
      const over = place(OLIVIA, c, ONE(100000), { discount: fixed(85001), net: 14999, deposit: 15000 });
      assert.equal(over.ok, false);
      assert.match(over.err, BLOCK);
    });

    it("a 100% discount is blocked the same way", () => {
      const c = newCustomer();
      const r = place(OLIVIA, c, ONE(100000), { discount: percent(10000), net: 0, deposit: 15000 });
      assert.equal(r.ok, false);
      assert.match(r.err, BLOCK);
    });

    it("redeemed points that leave less than the deposit are blocked as well, and the points stay with the customer", () => {
      const c = newCustomer(5000);
      // gross 200.00, deposit 30.00; 1,701 points = 170.10 credit -> 29.90 to pay
      const ok = placeOk(OLIVIA, c, ONE(20000), { points: 1700 });
      assert.equal(orderRow(ok).net_payable_minor, 3000);
      const r = place(OLIVIA, c, ONE(20000), { points: 1701, net: 2990, deposit: 3000 });
      assert.equal(r.ok, false);
      assert.match(r.err, BLOCK);
      assert.equal(balanceOf(c), 5000 - 1700);
    });

    it("if the owner changes the deposit schedule after the order was created, confirming an order whose net payable is now below its deposit is refused (and the status list says why)", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(10000) }); // net 900.00, deposit 150.00 under the five tiers
      db.commit(`${AS.olivia}select admin.set_policy('orders.deposit', '{"mode": "percent", "percent_bps": 10000, "minimum_minor": 0, "required_before_status": "deposit_received"}'::jsonb, 'unconfirmed_default', 'test: a 100 percent schedule');`);
      try {
        const out = h.attempt(AS.sam, `select admin.transition_order('${id}', 'awaiting_deposit')`);
        assert.match(out, /^REFUSED: the discount and loyalty credit leave QAR 900\.00 to pay, which is less than the QAR 1,000\.00 cash deposit worked out from the original order total/);
        assert.equal(orderRow(id).status, "pending_confirmation");
        const view = JSON.parse(scalar(`select admin.get_order('${id}')::text`, AS.sam));
        const move = view.next_statuses.find((m) => m.code === "awaiting_deposit");
        assert.match(move.blocked_reason, /cash deposit worked out from the original order total/);
      } finally {
        db.commit(`${AS.olivia}select admin.set_policy('orders.deposit', '{"mode": "tiered", "minimum_minor": 0, "required_before_status": "deposit_received", "tiers": [{"up_to_minor": 300000, "percent_bps": 1500}, {"up_to_minor": 500000, "percent_bps": 2500}, {"up_to_minor": 1000000, "percent_bps": 3500}, {"up_to_minor": 1500000, "percent_bps": 5000}, {"percent_bps": 6000}]}'::jsonb, 'confirmed_by_owner', 'test: restore the five tiers');`);
      }
      confirm(id);
      assert.equal(orderRow(id).deposit_required_minor, 15000);
    });

    it("the database itself refuses a confirmed order whose deposit exceeds its net payable amount, whatever function tries to produce it", () => {
      const c = newCustomer();
      const id = placeOk(OLIVIA, c, ONE(100000), { discount: fixed(10000) });
      const r = db.cluster.psql(`begin;\nselect private.set_write_ctx(true);\nupdate public.orders set status = 'awaiting_deposit', deposit_fixed_at = now(), deposit_required_minor = 90001, deposit_gate_status = 'deposit_received' where id = '${id}';\nrollback;`);
      assert.equal(r.ok, false);
      assert.match(r.err, /orders_confirmed_deposit_within_net/);
    });
  });

  // =================================================================================================================
  describe("G. existing orders, existing deposits, the earlier entry points and both workflows are unchanged", () => {
    it("a database that already holds orders keeps every deposit, payment and loyalty entry when the new policies arrive; only NEW and not-yet-confirmed orders follow the five tiers", () => {
      const old = startDatabase({ schedule: "confirmed", before: "20261123120200_pricing_rewards_policies.sql" });
      try {
        seedIdempotencyFixtures(old);
        const oh = makeHelpers(old);
        const cust = "00000000-0000-4000-8000-0000000000c9";
        assert.equal(oh.scalar("select jsonb_array_length(value -> 'tiers') from private.business_policies where key = 'orders.deposit'"), "3", "before the migration: the earlier three tiers");
        // a CONFIRMED order at 12,000.00 (the earlier schedule: 35% = 4,200.00), a PENDING one, and a delivered, paid, awarded one with loyalty history
        const confirmedId = oh.make(ONE(1200000), cust);
        old.commit(`${AS.sam}select admin.transition_order('${confirmedId}', 'awaiting_deposit');`);
        const pendingId = oh.make(ONE(1200000), cust);
        const doneId = oh.make(ONE(100000), cust);
        old.commit(`${AS.olivia}select admin.record_payment('${doneId}', 'deposit', 100000, 'cash');
          select admin.transition_order('${doneId}', 'awaiting_deposit'); select admin.transition_order('${doneId}', 'deposit_received'); select admin.transition_order('${doneId}', 'sourcing');
          select admin.transition_order('${doneId}', 'building'); select admin.transition_order('${doneId}', 'quality_check'); select admin.transition_order('${doneId}', 'ready_for_delivery');
          select admin.transition_order('${doneId}', 'delivered');`);
        const digest = () =>
          oh.scalar(`select md5(coalesce((select string_agg(to_jsonb(o)::text, ',' order by id) from public.orders o), '') || '|' ||
                            coalesce((select string_agg(to_jsonb(p)::text, ',' order by id) from public.payments p), '') || '|' ||
                            coalesce((select string_agg(to_jsonb(l)::text, ',' order by id) from public.loyalty_ledger l), ''))`);
        const confirmedBefore = oh.scalar(`select deposit_required_minor || ':' || deposit_policy_version || ':' || deposit_rule from public.orders where id = '${confirmedId}'`);
        assert.match(confirmedBefore, /^420000:\d+:tier 3 of 3: 35\.00%/);
        assert.equal(oh.scalar(`select count(*) from public.loyalty_ledger where order_id = '${doneId}' and entry_type = 'award' and points = 100`), "1");
        const before = digest();

        const sql = readFileSync(join(ROOT, "supabase/migrations/20261123120200_pricing_rewards_policies.sql"), "utf8");
        const applied = old.cluster.psql(`begin;\n${sql}\ncommit;`);
        assert.ok(applied.ok, applied.err);

        assert.equal(digest(), before, "no order, payment or loyalty entry changed by the policy migration");
        assert.equal(oh.scalar(`select deposit_required_minor || ':' || deposit_policy_version || ':' || deposit_rule from public.orders where id = '${confirmedId}'`), confirmedBefore, "a confirmed order keeps the deposit that was fixed when it was confirmed");
        assert.equal(oh.scalar("select jsonb_array_length(value -> 'tiers') from private.business_policies where key = 'orders.deposit'"), "5");
        // a NEW order at the same total is worked out under the five tiers: 50% = 6,000.00
        const fresh = oh.make(ONE(1200000), cust);
        old.commit(`${AS.sam}select admin.transition_order('${fresh}', 'awaiting_deposit');`);
        assert.equal(oh.scalar(`select deposit_required_minor from public.orders where id = '${fresh}'`), "600000");
        // the PENDING order was never fixed: it is worked out again, under the policy in force, when it is confirmed
        assert.equal(oh.scalar(`select deposit_required_minor from public.orders where id = '${pendingId}'`), "420000", "untouched until it is confirmed");
        old.commit(`${AS.sam}select admin.transition_order('${pendingId}', 'awaiting_deposit');`);
        assert.equal(oh.scalar(`select deposit_required_minor from public.orders where id = '${pendingId}'`), "600000");
        // every existing order: no discount, no credit, net payable = total, balance = total - paid
        assert.equal(oh.scalar("select count(*) from public.orders where discount_minor <> 0 or loyalty_credit_minor <> 0 or net_payable_minor <> total_minor or balance_due_minor <> total_minor - amount_paid_minor"), "0");
        // the policy history keeps the earlier schedule
        assert.equal(oh.scalar("select count(*) from private.business_policy_versions where key = 'orders.deposit'") >= "3", true);
      } finally {
        old.stop();
      }
    });

    it("the policy migration refuses to overwrite a deposit schedule the owner has changed since (it stops, and says why, instead of replacing the owner's edit)", () => {
      const old = startDatabase({ schedule: "example", before: "20261123120200_pricing_rewards_policies.sql" });
      try {
        const sql = readFileSync(join(ROOT, "supabase/migrations/20261123120200_pricing_rewards_policies.sql"), "utf8");
        const applied = old.cluster.psql(`begin;\n${sql}\ncommit;`);
        assert.equal(applied.ok, false);
        assert.match(applied.err, /orders\.deposit policy is not the schedule this migration replaces/);
        assert.equal(old.cluster.psql("select value ->> 'percent_bps' from private.business_policies where key = 'orders.deposit'").out, "5000", "nothing was changed");
      } finally {
        old.stop();
      }
    });

    it("the policy migration is rerunnable: applying it a second time changes nothing", () => {
      const sql = readFileSync(join(ROOT, "supabase/migrations/20261123120200_pricing_rewards_policies.sql"), "utf8");
      const versionBefore = scalar("select version from private.business_policies where key = 'orders.deposit'");
      const again = db.cluster.psql(`begin;\n${sql}\ncommit;`);
      assert.ok(again.ok, again.err);
      assert.equal(scalar("select version from private.business_policies where key = 'orders.deposit'"), versionBefore);
    });

    it("the earlier entry points still work as before: create_order with 6 and with 7 arguments (through the website's earlier statement), and both record_payment signatures", () => {
      const c = newCustomer();
      const six = lines(db.commit(`${AS.sam}select admin.create_order('${c}', '${JSON.stringify(ONE(100000))}'::jsonb);`)).pop().trim();
      assert.deepEqual([orderRow(six).discount_minor, orderRow(six).net_payable_minor, orderRow(six).deposit_required_minor], [0, 100000, 15000]);
      const seven = h.createOrder(OLIVIA, c, ONE(200000), newKey("old7"));
      assert.ok(seven.ok, seven.err);
      assert.deepEqual([orderRow(seven.id).discount_minor, orderRow(seven.id).net_payable_minor, orderRow(seven.id).deposit_required_minor], [0, 200000, 30000]);
      const eight = lines(db.commit(`${AS.olivia}select admin.record_payment('${six}', 'deposit', 15000, 'cash');`)).pop().trim();
      assert.ok(eight);
      const ten = h.pay(OLIVIA, seven.id, 30000, newKey("old10"));
      assert.ok(ten.ok, ten.err);
      assert.equal(orderRow(six).balance_due_minor, 85000);
      assert.equal(orderRow(seven.id).balance_due_minor, 170000);
    });

    it("the earlier entry point still accepts a legacy discount LINE (it lowers the gross, as it always did); only the new entry point refuses it", () => {
      const c = newCustomer();
      const items = [{ kind: "component", description: "GPU", quantity: 1, unit_price_minor: 100000 }, { kind: "discount", description: "legacy line", quantity: 1, unit_price_minor: -10000 }];
      const id = lines(db.commit(`${AS.sam}select admin.create_order('${c}', '${JSON.stringify(items)}'::jsonb);`)).pop().trim();
      assert.equal(orderRow(id).total_minor, 90000);
      assert.equal(orderRow(id).discount_minor, 0, "a line is not an ordinary discount: it is part of the gross value");
    });

    it("both workflows: an order on the current workflow (version 2) with a discount is gated by the deposit worked out from its GROSS total", () => {
      const c = newCustomer();
      db.commit(`${AS.olivia}select admin.set_policy('orders.workflow', '{"default_version": 2}'::jsonb, 'unconfirmed_default', 'test: new orders follow workflow 2');`);
      let id;
      try {
        id = placeOk(OLIVIA, c, ONE(400000), { discount: fixed(50000) });
        assert.equal(orderRow(id).workflow_version, 2);
        assert.equal(orderRow(id).deposit_required_minor, 100000);
      } finally {
        db.commit(`${AS.olivia}select admin.set_policy('orders.workflow', '{"default_version": 1}'::jsonb, 'unconfirmed_default', 'test: back to workflow 1');`);
      }
      confirm(id);
      pay(id, 99999);
      assert.match(h.attempt(AS.sam, `select admin.transition_order('${id}', 'deposit_received')`), /deposit has not been fully paid/);
      pay(id, 1);
      db.commit(`${AS.sam}select admin.transition_order('${id}', 'deposit_received');`);
      assert.equal(orderRow(id).status, "deposit_received");
      assert.equal(orderRow(id).net_payable_minor, 350000);
      assert.equal(orderRow(id).balance_due_minor, 250000);
    });

    it("the release switch is left where it was: the tests that change it put it back", () => {
      assert.equal(scalar("select value ->> 'default_version' from private.business_policies where key = 'orders.workflow'"), "1");
    });
  });

  // =================================================================================================================
  describe("H. security, visibility and the staff gateway", () => {
    const NEW_FUNCTIONS = [
      "admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)",
      "admin.order_pricing_context(uuid)",
    ];

    it("customers and anonymous callers cannot run the new staff functions, and cannot read or write the new tables or columns", () => {
      const c = ID.custA;
      for (const who of [AS.anon, AS.alice, AS.service]) {
        assert.match(h.attempt(who, `select admin.order_pricing_context('${c}')`), /^REFUSED: .*permission denied/);
        assert.match(h.attempt(who, `select admin.create_order('${c}', '[]'::jsonb, null, 'admin', null, null, 'secret-key-0001', null, 0, 0, 0)`), /^REFUSED: .*permission denied/);
        assert.equal(h.rowsSeen(who, "select count(*) from private.order_discounts"), "DENIED");
      }
      const id = h.make(ONE(100000), ID.custA);
      for (const sql of [`update public.orders set discount_minor = 500 where id = '${id}'`, `insert into public.loyalty_ledger (customer_id, entry_type, points, description) values ('${ID.custA}', 'adjustment', 999, 'x')`]) {
        assert.match(h.attempt(AS.alice, sql), /^REFUSED: .*permission denied/, sql);
      }
    });

    it("the staff gateway role can run the new functions, anon and customers cannot, and the functions are security definer with a fixed empty search_path", () => {
      for (const f of NEW_FUNCTIONS) {
        assert.equal(scalar(`select has_function_privilege('m1_staff_gateway', '${f}', 'execute')`), "t", f);
        assert.equal(scalar(`select has_function_privilege('authenticated', '${f}', 'execute')`), "t", `${f} (the signed-in role; the function itself checks the staff permission)`);
        assert.equal(scalar(`select has_function_privilege('anon', '${f}', 'execute')`), "f", f);
      }
      const rows = lines(h.read(`select p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'admin' and p.proname in ('create_order', 'order_pricing_context', 'get_order', 'list_orders'))
           or (n.nspname = 'private' and p.proname in ('order_pricing_quote', 'redeem_points_for_order', 'restore_redeemed_points', 'normalize_discount', 'loyalty_ledger_balance_guard', 'lock_customer_points', 'point_value_minor', 'rewards_pricing_ready', 'qar_text', 'guard_order_pricing'))`));
      assert.ok(rows.length >= 12, rows.join("\n"));
      for (const r of rows) assert.match(r, /search_path=""/, r);
      for (const r of rows.filter((x) => /^(create_order|order_pricing_context|get_order|list_orders|order_pricing_quote|redeem_points_for_order|restore_redeemed_points):/.test(x))) assert.match(r, /:true:/, `${r} is security definer`);
    });

    it("a customer sees their own order's price breakdown and their own redemption entries, and nobody else's", () => {
      db.commit(`${AS.olivia}select admin.adjust_loyalty('${ID.custA}', 500, 'test points for the customer view');`);
      const id = placeOk(OLIVIA, ID.custA, ONE(435055), { discount: fixed(10000, "private reason text"), points: 435 });
      const mine = JSON.parse(h.scalar(`select to_jsonb(o)::text from public.orders o where id = '${id}'`, AS.alice));
      assert.deepEqual([mine.total_minor, mine.discount_minor, mine.loyalty_points_redeemed, mine.loyalty_credit_minor, mine.net_payable_minor, mine.deposit_required_minor, mine.balance_due_minor],
        [435055, 10000, 435, 4350, 420705, 108764, 420705]);
      assert.equal(JSON.stringify(mine).includes("private reason text"), false, "the discount reason is staff-only");
      assert.equal(h.rowsSeen(AS.bob, `select count(*) from public.orders where id = '${id}'`), "0");
      assert.equal(h.rowsSeen(AS.alice, `select count(*) from public.loyalty_ledger where order_id = '${id}' and entry_type = 'redemption' and points = -435`), "1");
      assert.equal(h.rowsSeen(AS.bob, `select count(*) from public.loyalty_ledger where order_id = '${id}'`), "0");
      const bal = h.scalar("select balance_points from public.loyalty_balances", AS.alice);
      assert.equal(Number(bal), balanceOf(ID.custA));
      cancelOrder(id);
      assert.equal(h.rowsSeen(AS.alice, `select count(*) from public.loyalty_ledger where order_id = '${id}' and entry_type = 'redemption_restore'`), "1", "the customer sees the points come back");
    });

    it("the platform's own security audit reports no violation on a fresh database with every migration applied", () => {
      const fresh = startDatabase({ schedule: "confirmed" });
      try {
        assert.equal(fresh.ok("select count(*) from private.security_audit();"), "0");
      } finally {
        fresh.stop();
      }
    });

    it("the new permissions belong to the owner alone; staff hold exactly what they held before", () => {
      assert.equal(lines(h.read("select role_code from private.role_permissions where permission_code = 'orders.discount' order by 1")).join(","), "owner");
      assert.equal(lines(h.read("select role_code from private.role_permissions where permission_code = 'loyalty.redeem' order by 1")).join(","), "owner");
      assert.equal(count("select count(*) from private.role_permissions where role_code = 'staff'"), 10);
    });
  });

  // =================================================================================================================
  describe("I. the operator undo script (supabase/release/pricing_rewards_rollback.sql)", () => {
    const SCRIPT = "supabase/release/pricing_rewards_rollback.sql";
    const script = () => readFileSync(join(ROOT, SCRIPT), "utf8");
    const confirm = "set m1.confirm_pricing_rollback = 'new-website-retired';\n";
    const FUNCTIONS = [
      "private.transition_block_reason(public.orders, text, smallint)", "admin.transition_order(uuid, text, text)", "admin.get_order(uuid)",
      "admin.list_orders(text, text, integer, integer)", "admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text)",
      "admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)", "private.try_award_loyalty(uuid)", "private.award_loyalty_for_order(uuid, text)",
    ];
    const defs = (database) => lines(database.ok(`select md5(pg_get_functiondef('${FUNCTIONS.join("'::regprocedure)) || '|' || md5(pg_get_functiondef('")}'::regprocedure));`)).pop();

    it("is an operator script: outside supabase/migrations, and it deletes nothing", () => {
      assert.ok(script().length > 2000);
      assert.equal(readdirSync(join(ROOT, "supabase/migrations")).some((f) => /rollback|contract/i.test(f)), false);
      assert.doesNotMatch(script().replace(/--.*$/gm, ""), /\b(drop\s+(table|column|schema|function)|delete\s+from|truncate)\b/i);
    });

    it("refuses without the confirmation (M1P02) and changes nothing", () => {
      const before = defs(db);
      const r = db.cluster.psql(`\\set VERBOSITY verbose\n${script()}`);
      assert.equal(r.ok, false);
      assert.match(r.err, /M1P02/);
      assert.match(r.err, /set m1\.confirm_pricing_rollback = 'new-website-retired'/);
      assert.equal(defs(db), before);
    });

    it("refuses while an order carries a discount or redeemed points (M1P01), and changes nothing", () => {
      const c = newCustomer(100);
      placeOk(OLIVIA, c, ONE(100000), { discount: fixed(1000) });
      const before = defs(db);
      const r = db.cluster.psql(`\\set VERBOSITY verbose\n${confirm}${script()}`);
      assert.equal(r.ok, false);
      assert.match(r.err, /M1P01/);
      assert.equal(defs(db), before);
    });

    it("on a database with no priced orders it restores the eight functions BYTE FOR BYTE, the two policies as new versions, and takes away the new functions; then the migrations go forward again", () => {
      const deployed = startDatabase({ schedule: "confirmed", before: "20261123120100_pricing_rewards_functions.sql" });
      const own = startDatabase({ schedule: "confirmed" });
      try {
        const deployedDefs = defs(deployed);
        assert.notEqual(defs(own), deployedDefs, "the migrations really changed those functions");
        const policyVersion = (key) => Number(lines(own.ok(`select version from private.business_policies where key = '${key}';`)).pop());
        const [dv, ev] = [policyVersion("orders.deposit"), policyVersion("loyalty.earning_base")];
        const r = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(r.ok, r.err);
        assert.equal(defs(own), deployedDefs, "the functions are exactly what was deployed");
        const jsonOf = (database, key) => JSON.parse(lines(database.ok(`select value::text from private.business_policies where key = '${key}';`)).pop());
        assert.equal(jsonOf(own, "orders.deposit").tiers.length, 3);
        assert.deepEqual(jsonOf(own, "loyalty.earning_base"), { base: "order_total", rounding: "floor" });
        assert.deepEqual([policyVersion("orders.deposit"), policyVersion("loyalty.earning_base")], [dv + 1, ev + 1], "new versions, not edits");
        assert.equal(lines(own.ok("select has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute');")).pop(), "f");
        assert.equal(lines(own.ok("select has_function_privilege('m1_staff_gateway', 'admin.order_pricing_context(uuid)', 'execute');")).pop(), "f");
        // nothing was deleted: the new columns, the discount table and the permissions are still there
        assert.equal(lines(own.ok("select count(*) from information_schema.columns where table_name = 'orders' and column_name in ('discount_minor','loyalty_credit_minor','net_payable_minor');")).pop(), "3");
        assert.equal(lines(own.ok("select count(*) from private.role_permissions where permission_code in ('orders.discount','loyalty.redeem');")).pop(), "2");
        // a second run is harmless
        const again = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(again.ok, again.err);
        assert.equal(defs(own), deployedDefs);
        // going forward again: migration 2 (rerunnable) restores the functions and the grants, then migration 3 the policies
        for (const f of ["20261123120100_pricing_rewards_functions.sql", "20261123120200_pricing_rewards_policies.sql"]) {
          const forward = own.cluster.psql(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
          assert.ok(forward.ok, `${f}: ${forward.err}`);
        }
        assert.equal(jsonOf(own, "orders.deposit").tiers.length, 5);
        assert.deepEqual(jsonOf(own, "loyalty.earning_base"), { base: "net_payable", rounding: "floor" });
        assert.equal(lines(own.ok("select has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute');")).pop(), "t");
      } finally {
        deployed.stop();
        own.stop();
      }
    });

    it("leaves an owner's later edit of a policy alone", () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        own.commit(`${AS.olivia}select admin.set_policy('orders.deposit', '{"mode": "percent", "percent_bps": 4000, "minimum_minor": 0, "required_before_status": "deposit_received"}'::jsonb, 'confirmed_by_owner', 'owner edit after the release');`);
        const r = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(r.ok, r.err);
        assert.equal(lines(own.ok("select value ->> 'percent_bps' from private.business_policies where key = 'orders.deposit';")).pop(), "4000");
        assert.match(r.err, /orders\.deposit is not the five-tier schedule/);
      } finally {
        own.stop();
      }
    });

    // Each condition below is proven on its OWN fresh database. (The shared database of this file already holds many priced orders, so a refusal
    // there could not tell which condition caused it.)
    const itemsJson = JSON.stringify(ONE(100000));
    const discountJson = JSON.stringify(fixed(1000));
    const createPriced = (database, { discount = false, points = 0 } = {}) =>
      lines(database.commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${itemsJson}'::jsonb, null, 'admin', null, null, null, ${discount ? `'${discountJson}'::jsonb` : "null"}, ${points}, null, null) as o \\gset\nselect :'o';`)).pop().trim();
    const refusedOn = (database, label) => {
      const before = defs(database);
      const r = database.cluster.psql(`\\set VERBOSITY verbose\n${confirm}${script()}`);
      assert.equal(r.ok, false, `${label}: the undo must refuse`);
      assert.match(r.err, /M1P01/, label);
      assert.match(r.err, /NOTHING WAS CHANGED/, label);
      assert.equal(defs(database), before, `${label}: nothing changed`);
      assert.equal(lines(database.ok("select has_function_privilege('m1_staff_gateway', 'admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)', 'execute');")).pop(), "t", `${label}: the new function is still callable`);
    };
    const onFresh = (fn) => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        return fn(own);
      } finally {
        own.stop();
      }
    };

    it("refuses on its own for a DISCOUNT alone (no points involved)", () => {
      onFresh((own) => {
        createPriced(own, { discount: true });
        refusedOn(own, "discount only");
      });
    });

    it("refuses on its own for REDEEMED POINTS alone (no discount involved)", () => {
      onFresh((own) => {
        own.commit(`${AS.olivia}select admin.adjust_loyalty('${ID.custA}', 500, 'points for the undo test');`);
        createPriced(own, { points: 100 });
        refusedOn(own, "points only");
      });
    });

    it("keeps refusing after the priced order was CANCELLED and its points returned: that history is a financial record", () => {
      onFresh((own) => {
        own.commit(`${AS.olivia}select admin.adjust_loyalty('${ID.custA}', 500, 'points for the undo test');`);
        const id = createPriced(own, { discount: true, points: 100 });
        own.commit(`${AS.sam}select admin.transition_order('${id}', 'cancelled', 'cancelled before the undo');`);
        assert.equal(lines(own.ok(`select count(*) from public.loyalty_ledger where order_id = '${id}' and entry_type = 'redemption_restore';`)).pop(), "1");
        refusedOn(own, "cancelled priced order");
      });
    });

    it("an order made by the NEW function WITHOUT a discount or points does not block the undo, and the earlier functions then handle it correctly", () => {
      onFresh((own) => {
        const id = createPriced(own);
        const r = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(r.ok, r.err);
        own.commit(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 100000, 'cash');`);
        assert.equal(lines(own.ok(`select amount_paid_minor || ',' || balance_due_minor from public.orders where id = '${id}';`)).pop(), "100000,0");
      });
    });

    it("RACE: an order with a discount that is still being created when the undo starts: the undo WAITS for it, then refuses (it cannot slip in between the check and the replacement)", async () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        const hh = makeHelpers(own);
        const before = defs(own);
        const inflight = hh.asyncPsql(`begin;\n${AS.olivia}select admin.create_order('${ID.custA}', '${itemsJson}'::jsonb, null, 'admin', null, null, null, '${discountJson}'::jsonb, 0, null, null);\nselect pg_sleep(1.6);\ncommit;`);
        await new Promise((r) => setTimeout(r, 500));
        const started = Date.now();
        const undo = await hh.asyncPsql(`\\set VERBOSITY verbose\n${confirm}${script()}`);
        const waited = Date.now() - started;
        const created = await inflight;
        assert.ok(created.ok, created.err);
        assert.equal(undo.ok, false);
        assert.match(undo.err, /M1P01/);
        assert.ok(waited >= 600, `the undo waited for the order in flight (waited ${waited} ms)`);
        assert.equal(lines(own.ok("select count(*) from public.orders where discount_minor <> 0;")).pop(), "1", "the discounted order exists");
        assert.equal(defs(own), before, "and the earlier functions were NOT put back over it");
      } finally {
        own.stop();
      }
    });

    it("the undo script states its limits and inspects every kind of pricing history", () => {
      const text = script();
      assert.match(text, /ONLY BEFORE THE FIRST PRICING AND REWARDS TRANSACTION/);
      assert.match(text, /There is NO undo of this kind|NO undo of this kind/);
      assert.match(text, /from private\.order_discounts/);
      assert.match(text, /entry_type in \('redemption', 'redemption_restore'\)/);
      assert.match(text, /lock table public\.orders, public\.loyalty_ledger, private\.order_discounts in share row exclusive mode/);
    });

    it("the earlier rules are back in force: after the undo a payment is limited by the TOTAL again, as it was before this release", () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        const id = lines(own.commit(`${AS.sam}select admin.create_order('${ID.custA}', '${JSON.stringify(ONE(100000))}'::jsonb);`)).pop().trim();
        const r = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(r.ok, r.err);
        own.commit(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 100000, 'cash');`);
        assert.equal(lines(own.ok(`select amount_paid_minor from public.orders where id = '${id}';`)).pop(), "100000");
      } finally {
        own.stop();
      }
    });
  });

  // =================================================================================================================
  describe("J. the contract script for the EARLIER order-creation functions (supabase/release/pricing_legacy_orders_contract.sql): prepared, never applied", () => {
    const SCRIPT = "supabase/release/pricing_legacy_orders_contract.sql";
    const script = () => readFileSync(join(ROOT, SCRIPT), "utf8");
    const confirm = "set m1.confirm_legacy_order_contract = 'old-website-retired';\n";
    const LEGACY = ["admin.create_order(uuid, jsonb, uuid, text, text, text)", "admin.create_order(uuid, jsonb, uuid, text, text, text, text)"];
    const NEW11 = "admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint)";
    const can = (database, role, fn) => lines(database.ok(`select has_function_privilege('${role}', '${fn}', 'execute');`)).pop() === "t";
    const withDiscountLine = JSON.stringify([
      { kind: "component", description: "Contract test part", quantity: 1, unit_price_minor: 400000 },
      { kind: "discount", description: "Manual discount line", quantity: 1, unit_price_minor: -100000 },
    ]);
    const asStaff = (database, sql) => database.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${AS.sam}${sql}\ncommit;`);

    it("is an operator script outside supabase/migrations, and it deletes nothing", () => {
      assert.equal(readdirSync(join(ROOT, "supabase/migrations")).some((f) => /contract|rollback/i.test(f)), false);
      assert.doesNotMatch(script().replace(/--.*$/gm, ""), /\b(drop\s+(table|column|schema|function)|delete\s+from|truncate)\b/i);
      assert.match(script(), /m1\.confirm_legacy_order_contract/);
      assert.match(script(), /errcode = 'M1P03'/);
      assert.match(script(), /errcode = 'M1P04'/);
    });

    it("BEFORE it: any staff member can still create an order with a negative discount line through an earlier signature, with no owner authorization, and the deposit follows the LOWERED total (the hole this step closes)", () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        const r = asStaff(own, `select admin.create_order('${ID.custA}', '${withDiscountLine}'::jsonb, null, 'admin', null, null, null) as o \\gset\nselect total_minor || ':' || deposit_required_minor || ':' || discount_minor from public.orders where id = :'o';`);
        assert.ok(r.ok, r.err);
        assert.equal(lines(r.out).pop(), "300000:45000:0", "total 3,000.00, deposit 15 % of the lowered total, no discount record");
      } finally {
        own.stop();
      }
    });

    it("refuses without the confirmation (M1P03), and changes nothing", () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        const r = own.cluster.psql(`\\set VERBOSITY verbose\n${script()}`);
        assert.equal(r.ok, false);
        assert.match(r.err, /M1P03/);
        assert.match(r.err, /set m1\.confirm_legacy_order_contract = 'old-website-retired'/);
        for (const fn of LEGACY) assert.equal(can(own, "m1_staff_gateway", fn), true, `${fn} is still open`);
      } finally {
        own.stop();
      }
    });

    it("refuses (M1P04) when the 11-argument create_order is not there, so it can never leave the database with no way to create an order", () => {
      const before = startDatabase({ schedule: "confirmed", before: "20261123120100_pricing_rewards_functions.sql" });
      try {
        const r = before.cluster.psql(`\\set VERBOSITY verbose\n${confirm}${script()}`);
        assert.equal(r.ok, false);
        assert.match(r.err, /M1P04/);
        for (const fn of LEGACY) assert.equal(can(before, "m1_staff_gateway", fn), true, `${fn} is still open`);
      } finally {
        before.stop();
      }
    });

    it("AFTER it: the earlier signatures are closed to staff, the gateway and anon (permission denied), the 11-argument function and the website's own statement still create orders, and nothing was deleted", () => {
      const own = startDatabase({ schedule: "confirmed" });
      try {
        seedIdempotencyFixtures(own);
        const oh = makeHelpers(own);
        // history that must survive: a legacy order with a discount line made BEFORE the contract
        const legacyOrder = lines(own.commit(`${AS.sam}select admin.create_order('${ID.custA}', '${withDiscountLine}'::jsonb, null, 'admin', null, null, null) as o \\gset\nselect :'o';`)).pop().trim();
        const digest = () => lines(own.ok(`select md5(coalesce((select string_agg(to_jsonb(o)::text, ',' order by id) from public.orders o), '') || '|' || coalesce((select string_agg(to_jsonb(i)::text, ',' order by id) from public.order_items i), ''));`)).pop();
        const before = digest();

        const r = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(r.ok, r.err);
        assert.equal(digest(), before, "no order or item was changed");
        for (const fn of LEGACY) {
          for (const role of ["authenticated", "m1_staff_gateway", "anon"]) assert.equal(can(own, role, fn), false, `${role} cannot run ${fn}`);
        }
        assert.equal(can(own, "m1_staff_gateway", NEW11), true);
        assert.equal(can(own, "authenticated", NEW11), true);

        // the discount-line route is shut for staff, through both signatures
        for (const call of [
          `select admin.create_order('${ID.custA}', '${withDiscountLine}'::jsonb, null, 'admin', null, null, null);`,
          `select admin.create_order('${ID.custA}', '${withDiscountLine}'::jsonb, null, 'admin', null, null);`,
        ]) {
          const denied = asStaff(own, call);
          assert.equal(denied.ok, false);
          assert.match(denied.err, /42501|permission denied/i);
        }
        // the earlier website's own "Create order" statement is refused too (the reason to run this only when that website is retired)
        const old = oh.viaGateway(oh.SAM, "create_order", [ID.custA, JSON.stringify(ONE(100000)), null, null, newKey("legacy-after")]);
        assert.equal(old.ok, false);
        assert.equal(old.code, "42501");

        // the new route still works: an ordinary order for staff, a discounted order for the owner, through the website's own statement
        const plain = oh.viaGateway(oh.SAM, "create_order_priced", [ID.custA, JSON.stringify(ONE(100000)), null, null, newKey("plain"), null, 0, "100000", "15000"]);
        assert.ok(plain.ok, plain.err);
        const discounted = oh.viaGateway(oh.OLIVIA, "create_order_priced", [ID.custA, JSON.stringify(ONE(100000)), null, null, newKey("disc"), JSON.stringify(fixed(1000)), 0, "99000", "15000"]);
        assert.ok(discounted.ok, discounted.err);
        // and staff still cannot discount through it
        const staffDiscount = oh.viaGateway(oh.SAM, "create_order_priced", [ID.custA, JSON.stringify(ONE(100000)), null, null, newKey("sd"), JSON.stringify(fixed(1000)), 0, "99000", "15000"]);
        assert.equal(staffDiscount.ok, false);
        assert.ok(lines(own.ok(`select count(*) from public.orders where id = '${legacyOrder}';`)).pop() === "1", "the earlier order is still there");

        // a second run is harmless
        const again = own.cluster.psql(`${confirm}${script()}`);
        assert.ok(again.ok, again.err);
        for (const fn of LEGACY) assert.equal(can(own, "m1_staff_gateway", fn), false);

        // the undo returns the right (and only that)
        const undo = own.cluster.psql(`grant execute on function ${LEGACY[0]} to authenticated, m1_staff_gateway;\ngrant execute on function ${LEGACY[1]} to authenticated, m1_staff_gateway;`);
        assert.ok(undo.ok, undo.err);
        for (const fn of LEGACY) assert.equal(can(own, "m1_staff_gateway", fn), true);
      } finally {
        own.stop();
      }
    });
  });
});
