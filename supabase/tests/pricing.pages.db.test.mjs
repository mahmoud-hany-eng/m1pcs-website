// PLAT-0005: THE SCREENS OF PRICING AND REWARDS, RENDERED FOR REAL with data from the REAL database functions. Real PostgreSQL 16, the real
// migrations, the real staff functions (admin.get_order, admin.order_pricing_context, ...), the real row level security for the customer's
// rows, and the REAL pages and components rendered with React's server renderer under the loader in support/page-render-loader.mjs (which
// emulates the server / client boundary, so the mistake that took the staff order page down on 2026-11-22 cannot hide here). Only the sign-in is
// stubbed: the pages run as they do for a signed-in owner, a signed-in staff member and a signed-in customer.
//
// What is proved: the staff order page shows the price breakdown (gross, discount and who authorized it, loyalty credit, net payable, deposit,
// cash left after it); the new-order page's Pricing & Rewards section starts in the right state for the owner, for a customer with ZERO points
// (the redemption switch is disabled), for a customer WITH points, for a staff member (owner-only controls locked) and while the owner's
// loyalty rule switches the features off; and the customer sees the statement of their order (credit is not a payment) and their points history.
// It cannot prove typing into the form in a browser: the staff dashboard needs a real second factor, so the interactions are proved on the
// form's state machine (pricing-lib.test.mjs) and the writes on the real gateway statements (pricing.db.test.mjs, gateway-outcomes.db.test.mjs).
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const lines = (out) => out.split("\n").filter((l) => l !== "");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&minus;/g, "−").replace(/\s+/g, " ");
const tag = (html, testId) => new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? null;
const inner = (html, testId) => {
  const m = new RegExp(`<([a-z]+)[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return m ? text(m[2]).trim() : null;
};
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);

suite("the pricing and rewards screens, rendered with the database's own answers (real functions, real components, server/client boundary emulated)", () => {
  let db;
  let ownerPerms;
  let staffPerms;
  let orderPage;
  let newPage;
  let dashboard;
  let vm;
  let pricedId;
  let plainId;
  const ZERO = "00000000-0000-4000-8000-0000000000d1";

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const apiFor = (who) => ({
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    getCustomer: async (cid) => q(`select admin.get_customer(${lit(cid)})::text`, who),
    orderPricingContext: async (cid) => q(`select admin.order_pricing_context(${lit(cid)})::text`, who),
    searchCustomers: async () => [],
  });
  async function render(module, args, { who = AS.olivia, permissions = ownerPerms } = {}) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who) };
    return renderToStaticMarkup(await module.default(args));
  }
  const newOrderHtml = (customer, opts) => render(newPage, { searchParams: Promise.resolve({ customer }) }, opts);

  before(async () => {
    db = startDatabase({ schedule: "confirmed" });
    db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${ZERO}', 'Zero Points Test', '+97455550044', 'zero@example.test', 'walk_in');`);
    db.commit(`${AS.olivia}select admin.adjust_loyalty('${ID.custA}', 500, 'points for the screens test');`);
    const items = JSON.stringify([{ kind: "component", description: "SYNTHETIC TEST — Custom Gaming PC", quantity: 1, unit_price_minor: 435055 }]);
    const discount = JSON.stringify({ mode: "fixed", amount_minor: 10000, reason: "private reason text from the owner" });
    pricedId = lines(db.commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${items}'::jsonb, null, 'admin', null, null, null, '${discount}'::jsonb, 435, null, null) as o \\gset
      select :'o';`)).pop().trim();
    plainId = lines(db.commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${items}'::jsonb, null, 'admin', null, null, null, null, 0, null, null) as o \\gset
      select :'o';`)).pop().trim();
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    staffPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.sam)));
    assert.ok(ownerPerms.has("orders.discount") && ownerPerms.has("loyalty.redeem"), "the owner holds the two pricing permissions");
    assert.ok(!staffPerms.has("orders.discount") && !staffPerms.has("loyalty.redeem"), "staff do not");
    orderPage = await import("../../src/app/admin/orders/[id]/page.tsx");
    newPage = await import("../../src/app/admin/orders/new/page.tsx");
    dashboard = await import("../../src/components/account/dashboard.tsx");
    vm = await import("../../src/lib/accounts/shared/view-models.ts");
  });
  after(() => db?.stop());

  describe("the staff order page", () => {
    it("an order with a discount and redeemed points shows the price breakdown: gross, discount, credit, net payable, and the cash left after the deposit", async () => {
      const html = await render(orderPage, { params: Promise.resolve({ id: pricedId }) });
      assert.ok(tag(html, "price-breakdown"), "the breakdown section is there");
      assert.equal(inner(html, "price-gross"), "QAR 4,350.55");
      assert.equal(inner(html, "price-discount"), "-QAR 100.00");
      assert.equal(inner(html, "price-credit"), "-QAR 43.50");
      assert.equal(inner(html, "price-net"), "QAR 4,207.05");
      assert.equal(inner(html, "price-balance"), "QAR 4,207.05");
      const t = text(html);
      assert.match(t, /Order total \(before discount\)/);
      assert.match(t, /Final amount payable/);
      assert.match(t, /Loyalty credit \(435 points\)/);
      assert.match(t, /Points used as a credit on this order\. Not a payment\./);
      assert.match(t, /After the deposit, QAR 3,119\.41 is still to pay in cash or Fawran/);
      assert.match(t, /\(25% of the whole original total\)|worked out from the order total before any discount or loyalty credit/);
    });

    it("who authorized the discount, when and why is shown to staff, with the redemption record", async () => {
      const t = text(await render(orderPage, { params: Promise.resolve({ id: pricedId }) }));
      assert.match(t, /Discount authorized by Owner \(test\) on .* Reason: private reason text from the owner/);
      assert.match(t, /435 loyalty points redeemed when the order was created\. They are returned to the customer if the order is cancelled\./);
    });

    it("an order without a discount or points shows no breakdown and the earlier four figures", async () => {
      const html = await render(orderPage, { params: Promise.resolve({ id: plainId }) });
      assert.equal(tag(html, "price-breakdown"), null);
      assert.match(text(html), /Order total/);
      assert.doesNotMatch(text(html), /Final amount payable|before discount/);
    });

    it("after a cancellation the page says the points were returned", async () => {
      db.commit(`${AS.sam}select admin.transition_order('${pricedId}', 'cancelled', 'test cancellation');`);
      const t = text(await render(orderPage, { params: Promise.resolve({ id: pricedId }) }));
      assert.match(t, /The order was cancelled and the points were returned to the customer\./);
    });
  });

  describe("the new-order page: the Pricing & Rewards section as the database describes the customer and the person", () => {
    it("the owner, a customer WITH points: balance and its value shown, the switch available, the discount controls present, the figures wait for items", async () => {
      const html = await newOrderHtml(ID.custA);
      assert.ok(tag(html, "pricing-rewards"));
      assert.match(inner(html, "points-available"), /Available: 500 points \(worth QAR 50\.00; 1 point = QAR 0\.10\)/);
      assert.doesNotMatch(tag(html, "redeem-toggle"), /\sdisabled=""/, "the switch is usable");
      assert.equal(inner(html, "redeem-locked"), null);
      assert.match(html, /<option value=""[^>]*>No discount<\/option><option value="fixed"[^>]*>Fixed amount \(QAR\)<\/option><option value="percent"[^>]*>Percentage \(%\)<\/option>/);
      assert.equal(inner(html, "pricing-empty"), "Add priced items to see the summary.");
      assert.match(text(html), /Pricing & Rewards/);
      assert.match(text(html), /The deposit is always worked out from the original order total\. A discount or redeemed points never lower it\./);
      assert.match(tag(html, "pricing-summary") ?? "", /data-testid="pricing-summary"/);
    });

    it("the owner, a customer with ZERO points: the redemption switch is greyed out and disabled, and says why", async () => {
      const html = await newOrderHtml(ZERO);
      assert.match(tag(html, "redeem-toggle"), /\sdisabled=""/);
      assert.match(tag(html, "redeem-toggle"), /aria-checked="false"/);
      assert.equal(inner(html, "redeem-locked"), "This customer has no loyalty points to redeem.");
      assert.match(inner(html, "points-available"), /Available: 0 points/);
      assert.equal(tag(html, "use-max"), null, "there is nothing to use");
    });

    it("the same page for a DIFFERENT customer shows that customer's own balance (the form is keyed by the customer)", async () => {
      const a = inner(await newOrderHtml(ID.custA), "points-available");
      const z = inner(await newOrderHtml(ZERO), "points-available");
      assert.notEqual(a, z);
      assert.match(a, /500 points/);
      assert.match(z, /0 points/);
    });

    it("a staff member: discounts and redemption are owner-only, locked with the reason, and the customer's points are not shown", async () => {
      const html = await newOrderHtml(ID.custA, { who: AS.sam, permissions: staffPerms });
      assert.equal(inner(html, "discount-locked"), "Discounts can be applied by the owner only.");
      assert.equal(inner(html, "redeem-locked"), "Loyalty redemption can be applied by the owner only.");
      assert.equal(inner(html, "points-available"), null, "a staff member without the permission is not shown the balance");
      assert.match(tag(html, "redeem-toggle"), /\sdisabled=""/);
      assert.doesNotMatch(html, /name="discount_mode"/);
    });

    it("while the owner's loyalty earning rule is not the net-payable one, both features are switched off with the reason (and come back with the rule)", async () => {
      db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "order_total", "rounding": "floor"}'::jsonb, 'unconfirmed_default', 'test: earning on the gross total');`);
      try {
        const html = await newOrderHtml(ID.custA);
        assert.match(inner(html, "discount-locked"), /switched off until the owner sets the loyalty earning rule/);
        assert.match(inner(html, "redeem-locked"), /switched off until the owner sets the loyalty earning rule/);
      } finally {
        db.commit(`${AS.olivia}select admin.set_policy('loyalty.earning_base', '{"base": "net_payable", "rounding": "floor"}'::jsonb, 'confirmed_by_owner', 'test: restore');`);
      }
      assert.equal(inner(await newOrderHtml(ID.custA), "discount-locked"), null);
    });

    it("the order items offer no 'Discount' type, delivery and address stay optional, and the form keeps its prices-checked confirmation", async () => {
      const html = await newOrderHtml(ID.custA);
      const itemKindSelect = /<select[^>]*name="item_kind_0"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1];
      const kinds = [...itemKindSelect.matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1]);
      assert.deepEqual(kinds.sort(), ["build_service", "component", "delivery", "other"]);
      assert.match(html, /<option value=""[^>]*>Not decided yet<\/option>/);
      assert.match(text(html), /I have checked every price against the current supplier price/);
      assert.match(html, /name="expected_net_minor" value=""/);
      assert.match(html, /name="expected_deposit_minor" value=""/);
    });
  });

  describe("what the customer sees (rows read through row level security as the customer)", () => {
    const row = (sql) => JSON.parse(read(sql, AS.alice));
    const statuses = () => JSON.parse(read("select jsonb_agg(to_jsonb(s))::text from public.order_statuses s", AS.alice));

    it("an order with a discount and points is a STATEMENT: order value, discount, loyalty credit (not a payment), total payable, paid, balance, and the deposit rule", async () => {
      const o = row(`select to_jsonb(o)::text from public.orders o where id = '${plainId}'`); // plain order: nothing taken off
      assert.equal(vm.buildOrderSummary(o, statuses()).adjusted, false);
      // a fresh priced order for the customer (the first was cancelled above)
      const items = JSON.stringify([{ kind: "component", description: "SYNTHETIC TEST — PC", quantity: 1, unit_price_minor: 435055 }]);
      const discount = JSON.stringify({ mode: "fixed", amount_minor: 10000, reason: "private reason text" });
      const id = lines(db.commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${items}'::jsonb, null, 'admin', null, null, null, '${discount}'::jsonb, 435, null, null) as o \\gset\nselect :'o';`)).pop().trim();
      db.commit(`${AS.sam}select admin.transition_order('${id}', 'awaiting_deposit');`);
      db.commit(`${AS.olivia}select admin.record_payment('${id}', 'deposit', 108764, 'fawran');`);
      const mine = row(`select to_jsonb(o)::text from public.orders o where id = '${id}'`);
      const summary = vm.buildOrderSummary(mine, statuses());
      const html = renderToStaticMarkup(dashboard.MoneySummary({ order: summary }));
      const t = text(html);
      assert.ok(tag(html, "order-statement"));
      assert.equal(inner(html, "statement-gross"), "QAR 4,350.55");
      assert.equal(inner(html, "statement-discount"), "-QAR 100.00");
      assert.equal(inner(html, "statement-credit"), "-QAR 43.50");
      assert.equal(inner(html, "statement-net"), "QAR 4,207.05");
      assert.equal(inner(html, "statement-paid"), "QAR 1,087.64");
      assert.equal(inner(html, "statement-balance"), "QAR 3,119.41");
      assert.match(t, /Order value \(before discount\)/);
      assert.match(t, /Loyalty credit \(435 points\)/);
      assert.match(t, /Points used as a credit on this order\. Not a payment\./);
      assert.match(t, /Paid so far Cash or Fawran received\./);
      assert.match(t, /Deposit required: QAR 1,087\.64\s*\. It is worked out from the order value before the discount, so a discount or loyalty credit does not lower it/);
      assert.equal(JSON.stringify(mine).includes("private reason text"), false, "the discount's reason never reaches the customer's row");
      // the order list's card shows what is payable
      const card = text(renderToStaticMarkup(dashboard.OrderCard({ order: summary })));
      assert.match(card, /Total payable QAR 4,207\.05/);
    });

    it("an ordinary order keeps the earlier four figures", async () => {
      const o = row(`select to_jsonb(o)::text from public.orders o where id = '${plainId}'`);
      const html = renderToStaticMarkup(dashboard.MoneySummary({ order: vm.buildOrderSummary(o, statuses()) }));
      assert.equal(tag(html, "order-statement"), null);
      assert.match(text(html), /Order total QAR 4,350\.55 Deposit required QAR 1,087\.64 Paid so far QAR 0\.00 Remaining balance QAR 4,350\.55/);
    });

    it("the points history lists the redemption and the return, and the balance is the database's", async () => {
      const ledger = row("select jsonb_agg(to_jsonb(l))::text from public.loyalty_ledger l");
      const balances = row("select jsonb_agg(to_jsonb(b))::text from public.loyalty_balances b");
      const loyalty = vm.buildLoyalty(balances, ledger);
      const html = text(renderToStaticMarkup(dashboard.LoyaltyHistory({ loyalty })));
      assert.match(html, /Points used on an order .*Redeemed on order O-\d{4}-\d{5}: QAR 43\.50 credit -435/);
      assert.match(html, /Points returned .*Points returned: order O-\d{4}-\d{5} was cancelled \+435/);
      assert.equal(loyalty.balance, Number(read(`select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = '${ID.custA}'`)));
    });
  });
});
