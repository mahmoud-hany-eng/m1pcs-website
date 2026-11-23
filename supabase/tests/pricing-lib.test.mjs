// PLAT-0005: the pricing logic the SCREENS use (src/lib/platform/pricing.ts, src/lib/staff/pricing-form.ts) and the customer's statement,
// tested two ways:
//   1. directly, as pure functions: the owner's five tiers, the example in the brief, every refusal, the form's state machine (toggle
//      disabled with no points, "Use Maximum", an incomplete discount, the owner-only controls, a different customer's balance);
//   2. DIFFERENTIALLY against the database: a grid of orders (including every deposit boundary) is priced by the TypeScript code and by
//      `private.order_pricing_quote` in a real PostgreSQL 16 with the real migrations, and the two must agree to the minor unit, refusal for
//      refusal. The screen is advice and the database is the authority; this is what keeps the advice honest.
// LOCAL tests with synthetic data; they say nothing about the website screens in a browser or about Supabase Auth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import { after, before, describe, test } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";

register("./support/alias-loader.mjs", import.meta.url);

let load = null;
let skip = false;
try {
  load = {
    p: await import("../../src/lib/platform/pricing.ts"),
    f: await import("../../src/lib/staff/pricing-form.ts"),
    vm: await import("../../src/lib/accounts/shared/view-models.ts"),
  };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { p, f, vm } = load ?? {};

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const dbSuite = haveServer && !skip ? describe : describe.skip;

// The owner's schedule exactly as the database stores it.
const POLICY = {
  mode: "tiered",
  minimum_minor: 0,
  required_before_status: "deposit_received",
  tiers: [
    { up_to_minor: 300000, percent_bps: 1500 }, { up_to_minor: 500000, percent_bps: 2500 }, { up_to_minor: 1000000, percent_bps: 3500 },
    { up_to_minor: 1500000, percent_bps: 5000 }, { percent_bps: 6000 },
  ],
};
const input = (over = {}) => ({ grossMinor: 435055, discount: null, pointsToRedeem: 0, pointsBalance: 0, pointValueMinor: 10, depositPolicy: POLICY, ...over });
const CTX = { pointValueMinor: 10, pointsBalance: 500, canDiscount: true, canRedeem: true, pricingEnabled: true, earnQarPerPointMinor: 1000, depositPolicy: POLICY };
const E = f ? f.EMPTY_PRICING_FORM : null;

describe("the deposit, from the ORIGINAL gross total (the owner's five tiers)", { skip }, () => {
  test("every boundary of the brief, one minor unit either side", () => {
    const cases = [
      [100000, 15000, 1500, 1], [300000, 45000, 1500, 1], [300001, 75000, 2500, 2], [500000, 125000, 2500, 2], [500001, 175000, 3500, 3],
      [1000000, 350000, 3500, 3], [1000001, 500001, 5000, 4], [1500000, 750000, 5000, 4], [1500001, 900001, 6000, 5], [2500000, 1500000, 6000, 5],
    ];
    for (const [gross, deposit, bps, tier] of cases) {
      const q = p.depositQuote(gross, POLICY);
      assert.deepEqual([q.amountMinor, q.rateBps, q.tier, q.tierCount], [deposit, bps, tier, 5], `gross ${gross}`);
    }
  });
  test("the rounding is to the nearest 0.01, a half rounding up: 4,350.55 needs 1,087.64", () => {
    assert.equal(p.depositQuote(435055, POLICY).amountMinor, 108764);
    assert.equal(p.depositQuote(1000001, POLICY).amountMinor, 500001); // 500,000.5
    assert.equal(p.depositQuote(300002, POLICY).amountMinor, 75001); // 75,000.50
    assert.equal(p.depositQuote(300001, POLICY).amountMinor, 75000); // 75,000.25
  });
  test("no intermediate product loses precision, even at the largest total the form accepts", () => {
    const big = 999999999999999; // QAR 9,999,999,999,999.99
    assert.equal(p.depositQuote(big, POLICY).amountMinor, 599999999999999);
  });
  test("an unconfigured or missing schedule prices nothing; the other schedule modes behave as the database does", () => {
    assert.equal(p.depositQuote(100000, null), null);
    assert.equal(p.depositQuote(100000, { mode: "unconfigured" }), null);
    assert.equal(p.depositQuote(80000, { mode: "percent", percent_bps: 2500, minimum_minor: 0 }).amountMinor, 20000);
    assert.equal(p.depositQuote(10000, { mode: "fixed", fixed_minor: 30000 }).amountMinor, 10000, "never more than the total");
    assert.equal(p.depositQuote(50000, { mode: "tiered", tiers: [{ percent_bps: 1000 }] }).amountMinor, 5000);
    assert.equal(p.depositQuote(1, { mode: "percent", percent_bps: 1500, minimum_minor: 500 }).amountMinor, 1, "the minimum is capped by the total");
  });
});

describe("the pricing of an order", { skip }, () => {
  test("the brief's example: gross 4,350.55, discount 100.00, 435 points -> net 4,207.05, deposit 1,087.64, cash after deposit 3,119.41, 420 points earned", () => {
    const r = p.computePricing(input({ discount: { mode: "fixed", amountMinor: 10000 }, pointsToRedeem: 435, pointsBalance: 500 }));
    assert.equal(r.ok, true);
    const g = r.figures;
    assert.deepEqual(
      [g.grossMinor, g.discountMinor, g.afterDiscountMinor, g.creditMinor, g.netPayableMinor, g.depositMinor, g.cashBalanceAfterDepositMinor, g.pointsBalanceAfter],
      [435055, 10000, 425055, 4350, 420705, 108764, 311941, 65],
    );
    assert.equal(p.pointsEarned(g.netPayableMinor, 1000), 420, "floor(4,207.05 / 10), not 435 on the gross");
  });
  test("a discount or points never lower the tier or the deposit (4,000 with 500 off -> 1,000; 12,000 with 1,000 off -> 6,000)", () => {
    assert.equal(p.computePricing(input({ grossMinor: 400000, discount: { mode: "fixed", amountMinor: 50000 } })).figures.depositMinor, 100000);
    assert.equal(p.computePricing(input({ grossMinor: 1200000, discount: { mode: "fixed", amountMinor: 100000 } })).figures.depositMinor, 600000);
    assert.equal(p.computePricing(input({ grossMinor: 1200000, pointsToRedeem: 4000, pointsBalance: 5000 })).figures.depositMinor, 600000);
  });
  test("a percentage discount rounds to the nearest 0.01, a half rounding up", () => {
    assert.equal(p.discountAmount(435055, { mode: "percent", percentBps: 1250 }), 54382);
    assert.equal(p.discountAmount(1005, { mode: "percent", percentBps: 1000 }), 101);
    assert.equal(p.discountAmount(435055, { mode: "fixed", amountMinor: 7 }), 7);
    assert.equal(p.discountAmount(435055, null), 0);
  });
  test("what is refused, in words, with a code the screen can act on", () => {
    const bad = (over) => p.computePricing(input(over));
    let r = bad({ discount: { mode: "fixed", amountMinor: 435056 } });
    assert.deepEqual([r.ok, r.code], [false, "discount_exceeds_total"]);
    r = bad({ pointsToRedeem: 101, pointsBalance: 100 });
    assert.deepEqual([r.ok, r.code], [false, "points_exceed_balance"]);
    assert.match(r.problem, /has 100 points, so 101 cannot be redeemed/);
    r = bad({ grossMinor: 20000, discount: { mode: "fixed", amountMinor: 5000 }, pointsToRedeem: 1501, pointsBalance: 5000 });
    assert.deepEqual([r.ok, r.code], [false, "credit_exceeds_remaining"]);
    assert.match(r.problem, /redeem at most 1500 points/i);
    r = bad({ grossMinor: 100000, discount: { mode: "fixed", amountMinor: 91000 } });
    assert.deepEqual([r.ok, r.code], [false, "net_below_deposit"]);
    assert.match(r.problem, /The deposit is not lowered automatically and no payment can be invented/);
    r = bad({ depositPolicy: { mode: "unconfigured" } });
    assert.deepEqual([r.ok, r.code], [false, "no_deposit_policy"]);
  });
  test("a net payable equal to the deposit is allowed (nothing left after the deposit); one minor unit less is not", () => {
    assert.equal(p.computePricing(input({ grossMinor: 100000, discount: { mode: "fixed", amountMinor: 85000 } })).ok, true);
    assert.equal(p.computePricing(input({ grossMinor: 100000, discount: { mode: "fixed", amountMinor: 85001 } })).ok, false);
  });
  test("the largest points that can be redeemed: the balance, the price left after the discount, and the most that keeps the deposit payable", () => {
    // gross 200.00 (deposit 30.00), no discount, 5,000 points: the price allows 2,000 points; to keep 30.00 payable in cash, 1,700
    const g = p.computePricing(input({ grossMinor: 20000, pointsBalance: 5000 })).figures;
    assert.equal(g.maxPoints, 2000);
    assert.equal(g.maxPointsKeepingDeposit, 1700);
    assert.equal(p.maxRedeemablePoints(20000, 50, 10), 50, "the balance is the limit");
    assert.equal(p.maxRedeemablePoints(0, 50, 10), 0);
  });
  test("points are earned on the NET payable amount only, one per QAR 10, rounded down", () => {
    assert.equal(p.pointsEarned(420705, 1000), 420);
    assert.equal(p.pointsEarned(999, 1000), 0);
    assert.equal(p.pointsEarned(1000, 1000), 1);
    assert.equal(p.pointsEarned(-1, 1000), 0);
  });
});

describe("the statement of an order: how a discount and a loyalty credit appear (screens, receipts and customer statements)", { skip }, () => {
  const order = { total_minor: 435055, discount_minor: 10000, loyalty_points_redeemed: 435, loyalty_credit_minor: 4350, net_payable_minor: 420705, deposit_required_minor: 108764, amount_paid_minor: 108764, balance_due_minor: 311941 };
  test("order value, discount, loyalty credit, total payable, paid so far, balance due: in that order, with the credit never called a payment", () => {
    const lines = p.orderStatement(order);
    assert.deepEqual(lines.map((l) => [l.key, l.label, l.amountMinor]), [
      ["gross", "Order value (before discount)", 435055], ["discount", "Discount", -10000], ["credit", "Loyalty credit (435 points)", -4350],
      ["net", "Total payable", 420705], ["paid", "Paid so far", 108764], ["balance", "Balance due", 311941],
    ]);
    assert.match(lines.find((l) => l.key === "credit").note, /Not a payment/);
    assert.match(lines.find((l) => l.key === "paid").note, /Cash or Fawran received/);
    // the lines add up: gross - discount - credit = net; net - paid = balance
    assert.equal(435055 - 10000 - 4350, 420705);
    assert.equal(420705 - 108764, 311941);
  });
  test("an order with nothing taken off keeps the plain statement (order total, paid, balance)", () => {
    const lines = p.orderStatement({ total_minor: 100000, deposit_required_minor: 15000, amount_paid_minor: 0, balance_due_minor: 100000 });
    assert.deepEqual(lines.map((l) => l.key), ["gross", "paid", "balance"]);
    assert.equal(lines[0].label, "Order total");
  });
  test("a single point is '1 point'; only a discount shows no credit line", () => {
    const one = p.orderStatement({ ...order, loyalty_points_redeemed: 1, loyalty_credit_minor: 10, discount_minor: 0, net_payable_minor: 435045 });
    assert.equal(one.find((l) => l.key === "credit").label, "Loyalty credit (1 point)");
    const only = p.orderStatement({ ...order, loyalty_points_redeemed: 0, loyalty_credit_minor: 0, net_payable_minor: 425055 });
    assert.equal(only.some((l) => l.key === "credit"), false);
  });
});

describe("the Pricing & Rewards section's state machine", { skip }, () => {
  const view = (form = {}, gross = 435055, ctx = CTX) => f.derivePricingView({ ...E, ...form }, gross, ctx);

  test("nothing to price until the items give a positive total", () => {
    for (const gross of [null, 0, -5]) {
      const v = view({}, gross);
      assert.deepEqual([v.active, v.canSubmit, v.expectedNet, v.expectedDeposit], [false, false, "", ""]);
      assert.equal(v.submitHint, "Add at least one priced item.");
    }
  });
  test("no discount and no points: the order can be created at once, and the form carries the two figures it showed", () => {
    const v = view();
    assert.equal(v.canSubmit, true);
    assert.deepEqual([v.expectedNet, v.expectedDeposit], ["435055", "108764"]);
    assert.equal(v.figures.cashBalanceAfterDepositMinor, 435055 - 108764);
  });
  test("a customer with ZERO points: the redemption switch is disabled and says why; nothing can be redeemed", () => {
    const v = view({ redeemOn: true, points: "5" }, 435055, { ...CTX, pointsBalance: 0 });
    assert.match(v.redeemLocked, /no loyalty points to redeem/);
    assert.equal(v.figures.pointsRedeemed, 0, "a switch that is locked redeems nothing, whatever was typed");
    assert.equal(v.pointsAvailable, 0);
  });
  test("a customer WITH points: the switch is available, and the balance and its QAR value are shown", () => {
    const v = view({}, 435055, CTX);
    assert.equal(v.redeemLocked, null);
    assert.deepEqual([v.pointsAvailable, v.pointsAvailableMinor], [500, 5000]);
  });
  test("the balance and the switch follow the CUSTOMER: another customer's context gives another balance and another state", () => {
    const a = view({}, 435055, { ...CTX, pointsBalance: 0 });
    const b = view({}, 435055, { ...CTX, pointsBalance: 1200 });
    assert.notEqual(a.redeemLocked, null);
    assert.equal(b.redeemLocked, null);
    assert.equal(b.pointsAvailable, 1200);
    assert.equal(b.pointsAvailableMinor, 12000);
  });
  test("switching redemption on needs a number; partial redemption updates every figure at once; the balance after it is shown", () => {
    const on = view({ redeemOn: true });
    assert.equal(on.canSubmit, false);
    assert.equal(on.incomplete, true);
    assert.equal(on.submitHint, "Choose how many points to redeem, or switch redemption off.");
    const some = view({ redeemOn: true, points: "100" });
    assert.equal(some.canSubmit, true);
    assert.deepEqual([some.figures.creditMinor, some.figures.netPayableMinor, some.figures.pointsBalanceAfter], [1000, 434055, 400]);
    assert.equal(some.expectedNet, "434055");
  });
  test("Use Maximum is the largest number the balance, the price and the discount allow, and the database accepts it", () => {
    // 4,350.55 less a 4,300.00 discount leaves QAR 50.55 to pay: 505 points at QAR 0.10, although the customer holds 100,000
    const form = { redeemOn: true, discountMode: "fixed", discountAmount: "4,300", discountReason: "Returning customer" };
    const ctx = { ...CTX, pointsBalance: 100000 };
    const max = view(form, 435055, ctx).figures.maxPoints;
    assert.equal(max, 505);
    // the balance is the other limit
    assert.equal(view({ redeemOn: true }, 435055, { ...CTX, pointsBalance: 37 }).figures.maxPoints, 37);
    // typing the maximum is a valid choice for the price (it may still be blocked by the deposit, which is a separate rule)
    const atMax = view({ ...form, points: String(max) }, 435055, ctx);
    assert.equal(atMax.figures.creditMinor, 5050);
    assert.equal(atMax.figures.netPayableMinor, 5);
    assert.notEqual(atMax.result.code, "credit_exceeds_remaining");
    assert.equal(view({ ...form, points: String(max + 1) }, 435055, ctx).result.code, "credit_exceeds_remaining");
  });
  test("more points than the balance, or than the price allows, are refused on the screen with the database's words", () => {
    const over = view({ redeemOn: true, points: "501" });
    assert.equal(over.canSubmit, false);
    assert.match(over.submitHint, /has 500 points, so 501 cannot be redeemed/);
    const tooMuch = view({ redeemOn: true, points: "60" }, 500, { ...CTX, pointsBalance: 100 }); // 60 points are worth QAR 6.00 on a QAR 5.00 order
    assert.equal(tooMuch.canSubmit, false);
    assert.match(tooMuch.submitHint, /left to pay after the discount/);
  });
  test("a fixed or a percentage discount, an unfinished one, an invalid one, and the reason it needs", () => {
    const fixed = view({ discountMode: "fixed", discountAmount: "100", discountReason: "Returning customer" });
    assert.equal(fixed.canSubmit, true);
    assert.equal(fixed.figures.discountMinor, 10000);
    const pct = view({ discountMode: "percent", discountPercent: "12.5", discountReason: "Returning customer" });
    assert.equal(pct.figures.discountMinor, 54382);
    assert.equal(pct.expectedNet, String(435055 - 54382));
    const unfinished = view({ discountMode: "fixed", discountAmount: "100" });
    assert.equal(unfinished.canSubmit, false);
    assert.equal(unfinished.submitHint, "Finish the discount (amount and reason), or choose No discount.");
    assert.equal(view({ discountMode: "fixed", discountAmount: "", discountReason: "Returning customer" }).canSubmit, false);
    assert.match(view({ discountMode: "fixed", discountAmount: "12.345", discountReason: "Returning customer" }).discountError, /exact|QAR/i);
    assert.match(view({ discountMode: "percent", discountPercent: "0", discountReason: "Returning customer" }).discountError, /0\.01 to 100/);
    assert.match(view({ discountMode: "fixed", discountAmount: "100", discountReason: "ab" }).reasonError, /at least 3 characters/);
  });
  test("the order is BLOCKED, with the owner-decision explanation, when the net payable is below the gross-based deposit; no figures are sent", () => {
    const v = view({ discountMode: "fixed", discountAmount: "910", discountReason: "Returning customer" }, 100000);
    assert.equal(v.canSubmit, false);
    assert.equal(v.result.code, "net_below_deposit");
    assert.match(v.submitHint, /cash deposit worked out from the original order total/);
    assert.deepEqual([v.expectedNet, v.expectedDeposit], ["", ""]);
    assert.equal(v.figures.maxPointsKeepingDeposit, 0);
  });
  test("only the owner sees the controls: a staff member's discount and points are locked (and nothing they typed is used)", () => {
    const staff = { ...CTX, canDiscount: false, canRedeem: false, pointsBalance: null };
    const v = view({ discountMode: "fixed", discountAmount: "100", discountReason: "Returning customer", redeemOn: true, points: "10" }, 435055, staff);
    assert.match(v.discountLocked, /owner only/);
    assert.match(v.redeemLocked, /owner only/);
    assert.equal(v.pointsAvailable, null);
    assert.equal(v.figures.discountMinor, 0);
    assert.equal(v.figures.pointsRedeemed, 0);
    assert.equal(v.canSubmit, true, "an ordinary order is still fine");
  });
  test("discounts and redemption are switched off, with the reason, while the loyalty earning rule is not the net-payable one", () => {
    const off = { ...CTX, pricingEnabled: false };
    const v = view({ discountMode: "fixed", discountAmount: "100", discountReason: "Returning customer", redeemOn: true, points: "10" }, 435055, off);
    assert.match(v.discountLocked, /switched off/);
    assert.match(v.redeemLocked, /switched off/);
    assert.equal(v.figures.netPayableMinor, 435055);
  });
  test("with no deposit schedule the order cannot be priced and cannot be created", () => {
    const v = view({}, 435055, { ...CTX, depositPolicy: { mode: "unconfigured" } });
    assert.equal(v.canSubmit, false);
    assert.equal(v.result.code, "no_deposit_policy");
  });
  test("the points the customer will earn are shown on the NET payable amount", () => {
    assert.equal(view({ discountMode: "fixed", discountAmount: "100", discountReason: "Returning customer", redeemOn: true, points: "435" }).pointsToEarn, 420);
    assert.equal(view().pointsToEarn, 435);
  });
  test("the database's context, in its own snake case, becomes the form's context", () => {
    const ctx = f.toContextView({
      point_value_minor: 10, earn_qar_per_point_minor: 1000, earning_base: "net_payable", pricing_enabled: true, can_discount: true, can_redeem: false,
      points_balance: null, deposit_policy: POLICY, deposit_policy_version: 4,
    });
    assert.deepEqual([ctx.pointValueMinor, ctx.canRedeem, ctx.pointsBalance, ctx.pricingEnabled, ctx.depositPolicy.tiers.length], [10, false, null, true, 5]);
  });
});

describe("the customer's own view of an order's money", { skip }, () => {
  const row = {
    id: "o1", order_ref: "O-2611-00007", customer_id: "c1", status: "awaiting_deposit", currency: "QAR", total_minor: 435055, deposit_required_minor: 108764,
    discount_minor: 10000, loyalty_points_redeemed: 435, loyalty_credit_minor: 4350, net_payable_minor: 420705, amount_paid_minor: 108764, balance_due_minor: 311941,
    created_at: "2026-11-23T10:00:00Z", workflow_version: 1,
  };
  const statuses = [{ code: "awaiting_deposit", customer_label: "Awaiting deposit", customer_description: "", sort_order: 20, is_terminal: false }];
  test("the summary keeps the gross value and the deposit, and adds the net payable amount and the statement", () => {
    const s = vm.buildOrderSummary(row, statuses);
    assert.equal(s.adjusted, true);
    assert.deepEqual([s.total, s.netPayable, s.depositRequired, s.paid, s.balanceDue], ["QAR 4,350.55", "QAR 4,207.05", "QAR 1,087.64", "QAR 1,087.64", "QAR 3,119.41"]);
    assert.deepEqual(s.statement.map((l) => [l.key, l.amount]), [
      ["gross", "QAR 4,350.55"], ["discount", "-QAR 100.00"], ["credit", "-QAR 43.50"], ["net", "QAR 4,207.05"], ["paid", "QAR 1,087.64"], ["balance", "QAR 3,119.41"],
    ]);
  });
  test("an order with nothing taken off, or from a database without the pricing columns, is unchanged", () => {
    const old = { ...row };
    for (const key of ["discount_minor", "loyalty_points_redeemed", "loyalty_credit_minor", "net_payable_minor"]) delete old[key];
    const s = vm.buildOrderSummary({ ...old, balance_due_minor: 326291 }, statuses);
    assert.equal(s.adjusted, false);
    assert.equal(s.netPayable, s.total);
    assert.deepEqual(s.statement.map((l) => l.key), ["gross", "paid", "balance"]);
    assert.equal(vm.buildOrderSummary({ ...row, discount_minor: 0, loyalty_points_redeemed: 0, loyalty_credit_minor: 0, net_payable_minor: 435055 }, statuses).adjusted, false);
  });
  test("an order paid in full of the NET amount is 'paid in full' (the gross was never owed)", () => {
    const paid = vm.buildOrderSummary({ ...row, amount_paid_minor: 420705, balance_due_minor: 0 }, statuses);
    assert.equal(paid.fullyPaid, true);
  });
  test("the loyalty history names redemptions and returns, and the running balance follows them", () => {
    const entry = (id, entry_type, points, at, description) => ({ id, customer_id: "c1", order_id: "o1", entry_type, points, reverses_entry_id: null, description, created_at: at });
    const ledger = [
      entry("1", "adjustment", 500, "2026-11-20T10:00:00Z", "Points adjustment"),
      entry("2", "redemption", -435, "2026-11-23T10:00:00Z", "Redeemed on order O-2611-00007: QAR 43.50 credit"),
      entry("3", "redemption_restore", 435, "2026-11-24T10:00:00Z", "Points returned: order O-2611-00007 was cancelled"),
    ];
    const view = vm.buildLoyalty([{ customer_id: "c1", balance_points: 500, entries: 3 }], ledger);
    assert.equal(view.balance, 500);
    assert.deepEqual(view.entries.map((e) => [e.label, e.pointsText, e.runningBalance]), [["Points returned", "+435", 500], ["Points used on an order", "-435", 65], ["Adjustment", "+500", 500]]);
  });
});

describe("static checks of the screens", { skip }, () => {
  const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
  test("the new-order page keys the form by the customer, so a different customer is a fresh form with their own points", () => {
    const page = read("src/app/admin/orders/new/page.tsx");
    assert.match(page, /<OrderForm key=\{customer\.id\}/);
    assert.match(page, /orderPricingContext\(customerId\)/);
  });
  test("the screens carry no deposit percentage and no tier limit of their own: the schedule is read from the database", () => {
    for (const rel of ["src/components/admin/forms.tsx", "src/lib/staff/pricing-form.ts", "src/lib/platform/pricing.ts", "src/app/admin/orders/new/page.tsx", "src/lib/accounts/shared/view-models.ts"]) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.doesNotMatch(code, /up_to_minor:\s*\d|percent_bps:\s*\d|\b(300000|500000|1000000|1500000)\b/, rel);
    }
  });
  test("the redemption switch is disabled when it is locked, and 'Use Maximum' is offered", () => {
    const forms = read("src/components/admin/forms.tsx");
    assert.match(forms, /data-testid="redeem-toggle"[\s\S]{0,200}disabled=\{view\.redeemLocked !== null\}/);
    assert.match(forms, /Use Maximum/);
    assert.match(forms, /name="expected_net_minor"/);
    assert.match(forms, /name="expected_deposit_minor"/);
  });
  test("the create button is disabled while the pricing is invalid, incomplete or blocked", () => {
    assert.match(read("src/components/admin/forms.tsx"), /<Submit pending=\{pending\} disabled=\{created \|\| !pricingView\.canSubmit\}/);
  });
  test("the order form no longer offers a discount line, and the delivery fields stay optional", () => {
    const forms = read("src/components/admin/forms.tsx");
    assert.match(forms, /NEW_ORDER_ITEM_KINDS\.map/);
    assert.match(forms, /<option value="">Not decided yet<\/option>/);
    assert.doesNotMatch(forms.slice(forms.indexOf("export function OrderForm")), /required\b[^>]*name="delivery_/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The differential: the TypeScript pricing and the database's, over a grid
// ---------------------------------------------------------------------------------------------------------------
dbSuite("the screen's pricing agrees with the database's, to the minor unit, refusal for refusal (a grid including every deposit boundary)", () => {
  let db;
  let customer;
  const POINTS = 800;

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    customer = "00000000-0000-4000-8000-0000000000c9";
    db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${customer}', 'Grid Test', '+97455550009', 'grid@example.test', 'walk_in');`);
    db.commit(`${AS.olivia}select admin.adjust_loyalty('${customer}', ${POINTS}, 'grid points');`);
    // a test-only wrapper that returns the quote or the refusal as text, so a whole grid runs in one query
    db.commit(`create function public.zz_quote(g bigint, d jsonb, pts bigint) returns jsonb language plpgsql as $f$
      begin return private.order_pricing_quote('${customer}', g, d, pts);
      exception when others then return jsonb_build_object('refused', sqlerrm); end $f$;`);
  });
  after(() => db?.stop());

  const CODE = [
    [/more than the order total/, "discount_exceeds_total"],
    [/cannot be redeemed/, "points_exceed_balance"],
    [/left to pay after the discount/, "credit_exceeds_remaining"],
    [/cash deposit that is worked out/, "net_below_deposit"],
  ];

  test("500+ orders: deposits at every boundary, fixed and percentage discounts, points from none to too many", () => {
    const grosses = [1, 100, 1005, 20000, 100000, 299999, 300000, 300001, 435055, 499999, 500000, 500001, 999999, 1000000, 1000001, 1499999, 1500000, 1500001, 2500000];
    const discounts = [null, { mode: "fixed", amount_minor: 1 }, { mode: "fixed", amount_minor: 10000 }, { mode: "fixed", amount_minor: 91000 }, { mode: "percent", percent_bps: 1 },
      { mode: "percent", percent_bps: 1250 }, { mode: "percent", percent_bps: 5000 }, { mode: "percent", percent_bps: 10000 }];
    const points = [0, 1, 100, 435, 800, 801, 5000];
    const cases = [];
    for (const gross of grosses) for (const d of discounts) for (const pts of points) cases.push({ gross, d, pts });
    assert.ok(cases.length >= 500, String(cases.length));
    const withReason = (d) => (d ? { ...d, reason: "grid test discount" } : null);
    const values = cases.map(({ gross, d, pts }, i) => `(${i}, ${gross}, ${d ? `'${JSON.stringify(withReason(d))}'::jsonb` : "null::jsonb"}, ${pts})`).join(",");
    const rows = JSON.parse(db.ok(`select jsonb_agg(jsonb_build_object('i', v.i, 'q', public.zz_quote(v.g, v.d, v.p)) order by v.i)::text from (values ${values}) as v (i, g, d, p);`).split("\n").pop());
    assert.equal(rows.length, cases.length);
    let agreedOk = 0;
    let agreedRefused = 0;
    for (const { i, q } of rows) {
      const { gross, d, pts } = cases[i];
      const ts = p.computePricing({
        grossMinor: gross,
        discount: d ? (d.mode === "fixed" ? { mode: "fixed", amountMinor: d.amount_minor } : { mode: "percent", percentBps: d.percent_bps }) : null,
        pointsToRedeem: pts,
        pointsBalance: POINTS,
        pointValueMinor: 10,
        depositPolicy: POLICY,
      });
      const label = `gross ${gross} discount ${JSON.stringify(d)} points ${pts}`;
      if (q.refused) {
        // a discount that rounds to nothing is refused by the database only (the screen's own input check refuses it first)
        if (/works out to less than QAR 0\.01/.test(q.refused)) continue;
        const code = CODE.find(([re]) => re.test(q.refused))?.[1];
        assert.ok(code, `${label}: an unexpected refusal from the database: ${q.refused}`);
        assert.equal(ts.ok, false, `${label}: the database refuses (${q.refused}) but the screen accepts`);
        assert.equal(ts.code, code, `${label}: ${ts.code} vs ${code}`);
        agreedRefused += 1;
      } else {
        assert.equal(ts.ok, true, `${label}: the database accepts but the screen refuses (${ts.problem})`);
        const g = ts.figures;
        assert.deepEqual(
          [g.grossMinor, g.discountMinor, g.creditMinor, g.netPayableMinor, g.depositMinor, g.cashBalanceAfterDepositMinor, g.pointsBalanceAfter],
          [q.gross_minor, q.discount_minor, q.credit_minor, q.net_payable_minor, q.deposit_minor, q.cash_balance_after_deposit_minor, q.points_balance_after],
          label,
        );
        assert.equal(g.depositRateBps, q.deposit_rate_bps, label);
        agreedOk += 1;
      }
    }
    assert.ok(agreedOk > 150 && agreedRefused > 150, `a meaningful grid: ${agreedOk} accepted and ${agreedRefused} refused, in agreement`);
  });

  test("the deposit alone, for every total in a window around each boundary, equals the database's", () => {
    const totals = [];
    for (const edge of [300000, 500000, 1000000, 1500000]) for (let d = -30; d <= 30; d++) totals.push(edge + d);
    const rows = db.ok(`select t || ':' || (private.deposit_quote(t)).amount_minor || ':' || coalesce((private.deposit_quote(t)).rate_bps::text, '-') from unnest(array[${totals.join(",")}]::bigint[]) t;`).split("\n");
    for (const row of rows) {
      const [t, amount, bps] = row.split(":");
      const q = p.depositQuote(Number(t), POLICY);
      assert.deepEqual([q.amountMinor, String(q.rateBps)], [Number(amount), bps], `total ${t}`);
    }
  });
});
