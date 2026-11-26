// THE STAFF ORDER PAGE, RENDERED FOR REAL with the data of the hosted synthetic order O-2611-00001.
//
// Why this exists: the first hosted use of order workflow v2 (2026-11-22, ~19:13 UTC) showed "This page could not load" on this page. The earlier-workflow
// view of the order rendered fine; the owner then moved the order onto the current workflow with the page's own form, and from that moment
// the page threw: it is a server component and CALLED `fulfillmentLabel`, an export of a "use client" module, which Next.js refuses
// ("Attempted to call fulfillmentLabel() from the server but fulfillmentLabel is on the client"). Nothing in the suite rendered this page with
// an order on the current workflow, so nothing could notice (TypeScript, lint and `next build` accept the call).
//
// What runs here: a database with the REAL migrations; the order rebuilt through the REAL staff functions with the values read (read-only) from the hosted
// development database (QAR 4,350.55; deposit 1,087.64 fixed at 25%; two Fawran payments with two receipts; four tracking updates that carry
// no location, no event time and no status code; five history rows; the owner has no display name; no phone; no delivery method; no loyalty); the
// REAL `admin.get_order` for it; and the REAL page and components rendered with React's server renderer under the loader in
// support/page-render-loader.mjs, which emulates the server / client boundary. Only the sign-in is stubbed: the page runs as it does for a signed-in owner.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, newOrder, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const lines = (out) => out.split("\n").filter((l) => l !== "");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const count = (html, needle) => html.split(needle).length - 1;

// The four updates exactly as the hosted order has them: no location, no event time, no status code.
const UPDATES = [
  ["Order Confirmed", "Updates for the order will show as soon as we receive them"],
  ["Nevada, US", "The parts are currently being processed in our facility in Nevada,US"],
  ["On its way", "Parts have been processed and is on its way to the next destination"],
  ["On its way to Qatar", "Items have been processed and are now on the way to Qatar"],
];

suite("the staff order page, rendered with the hosted synthetic order's data (real functions, real components, server/client boundary emulated)", () => {
  let db;
  let page;
  let id;
  let ownerPermissions;

  const act = (who, sql) => db.commit(`${who}${sql}`);
  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const getOrder = () => JSON.parse(read(`select admin.get_order('${id}')::text`, AS.olivia));

  // The page's data comes from the REAL staff functions, through the same statements the staff gateway runs (src/lib/staff/gateway.ts).
  const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
  const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
  const q = (sql) => JSON.parse(read(sql, AS.olivia));
  const api = {
    getOrder: async () => getOrder(),
    dashboard: async () => q("select admin.dashboard_summary()::text"),
    listOrders: async ({ status = null, search = null, limit = 50, offset = 0 } = {}) => q(`select admin.list_orders(${lit(status)}, ${lit(search)}, ${limit}, ${offset})::text`),
    listOrdersPage: async (o) => q(`select admin.list_orders_page(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`),
    listOrdersOverview: async (o) => q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`),
    getCustomer: async (cid) => q(`select admin.get_customer(${lit(cid)})::text`),
    claimCodes: async (cid) => q(`select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)::text from admin.list_claim_codes(${lit(cid)}) t`),
    listPayments: async (limit, offset) => q(`select admin.list_payments(${limit}, ${offset})::text`),
    audit: async (limit) => q(`select admin.list_audit(${limit})::text`),
    // The finance screens (PLAT-0006): the real owner-only functions, through the same statements the gateway runs.
    overview: async (year = null) => q(`select admin.overview_summary(${year === null ? "null" : Number(year)})::text`),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${year === null ? "null" : Number(year)}, ${month === null ? "null" : Number(month)})::text`),
    completedOrders: async (year = null, month = null, limit = 50, offset = 0) =>
      q(`select admin.list_completed_orders(${year === null ? "null" : Number(year)}, ${month === null ? "null" : Number(month)}, ${limit}, ${offset})::text`),
    customerOrders: async (cid, limit = 25, offset = 0) => q(`select admin.customer_orders(${lit(cid)}, ${limit}, ${offset})::text`),
    orderCosts: async (oid) => q(`select admin.order_costs(${lit(oid)})::text`),
    orderCompletion: async (oid) => q(`select admin.order_completion(${lit(oid)})::text`),
  };
  async function renderPage(module, args = {}, permissions = ownerPermissions) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api };
    return renderToStaticMarkup(await module.default(args));
  }
  const render = (permissions = ownerPermissions) => renderPage(page, { params: Promise.resolve({ id }) }, permissions);
  const others = {};

  before(async () => {
    db = startDatabase({ schedule: "confirmed" });
    // The hosted owner has no display name and the hosted customer no phone: the screens must cope.
    db.commit(`update private.staff_members set display_name = null where user_id = '${ID.olivia}';`);
    db.commit(`update public.customers set phone = null where id = '${ID.custA}';`);
    const items = [{ kind: "component", description: "SYNTHETIC TEST — Custom Gaming PC", quantity: 1, unit_price_minor: 435055 }];
    id = lines(db.commit(`${newOrder({ customer: ID.custA, items, into: "o", who: AS.olivia })}select :'o';`)).pop().trim();
    const move = (to, reason = "null") => act(AS.olivia, `select admin.transition_order('${id}', '${to}', ${reason});`);
    const publish = ([title, message]) => act(AS.olivia, `select admin.publish_tracking_event('${id}', '${title}', '${message}', null);`);
    move("awaiting_deposit", "'Synthetic test — order confirmed'");
    publish(UPDATES[0]);
    act(AS.olivia, `select admin.record_payment('${id}', 'deposit', 108764, 'fawran');`);
    move("deposit_received", "'Synthetic test — order Deposit received'");
    move("sourcing");
    publish(UPDATES[1]);
    publish(UPDATES[2]);
    publish(UPDATES[3]);
    move("in_transit");
    act(AS.olivia, `select admin.record_payment('${id}', 'balance', 326291, 'fawran');`);
    ownerPermissions = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    assert.ok(ownerPermissions.has("orders.adopt") && ownerPermissions.has("orders.transition"), "the owner holds the permissions the page checks");
    page = await import("../../src/app/admin/orders/[id]/page.tsx");
    others.overview = await import("../../src/app/admin/page.tsx");
    others.orders = await import("../../src/app/admin/orders/page.tsx");
    others.customer = await import("../../src/app/admin/customers/[id]/page.tsx");
    others.payments = await import("../../src/app/admin/payments/page.tsx");
    others.audit = await import("../../src/app/admin/audit/page.tsx");
  });
  after(() => db?.stop());

  /** Every other staff page that shows order data, rendered with the same data: none may throw, and each must show this order. */
  async function otherPagesShow({ statusLabel, auditAction, receipts }) {
    const order = getOrder();
    const overview = text(await renderPage(others.overview, { searchParams: Promise.resolve({}) }));
    assert.match(overview, /Overview/);
    assert.ok(overview.includes(order.order_ref), "the overview lists the order among the recent ones");
    const list = text(await renderPage(others.orders, { searchParams: Promise.resolve({}) }));
    assert.ok(list.includes(order.order_ref) && list.includes(statusLabel), `the orders list shows the order as ${statusLabel}`);
    const filtered = text(await renderPage(others.orders, { searchParams: Promise.resolve({ status: order.status }) }));
    assert.ok(filtered.includes(order.order_ref), "the status filter finds it");
    const customer = text(await renderPage(others.customer, { params: Promise.resolve({ id: order.customer.id }) }));
    assert.ok(customer.includes(order.customer.full_name) && customer.includes(order.order_ref), "the customer page lists the order");
    const payments = text(await renderPage(others.payments));
    for (const receipt of receipts) assert.ok(payments.includes(receipt), `${receipt} is on the payments page`);
    const audit = text(await renderPage(others.audit));
    assert.ok(audit.includes(auditAction), `the audit page shows ${auditAction}`);
  }

  describe("the order as it is while still on the earlier workflow (in_transit)", () => {
    it("the data is the hosted order's: earlier workflow, in transit, fully paid, two receipts, four updates, five history rows, no loyalty", () => {
      const order = getOrder();
      assert.deepEqual([order.workflow_version, order.status, order.total_minor, order.deposit_required_minor, order.amount_paid_minor, order.balance_due_minor], [1, "in_transit", 435055, 108764, 435055, 0]);
      assert.deepEqual([order.payments.length, order.tracking.length, order.history.length], [2, 4, 5]);
      assert.deepEqual(order.payments.map((p) => p.amount_minor), [108764, 326291]);
      assert.equal(read(`select count(*) from public.loyalty_ledger where order_id = '${id}'`), "0");
      assert.equal(order.stages.length, 9, "the nine stages of the earlier workflow");
      assert.ok(order.adoption_options.length >= 1 && order.adoption_options.some((o) => o.is_default), "the owner is offered where the order can be placed");
    });

    it("the page renders: earlier-workflow badge, the order's money, both receipts, all four updates, the history, the status controls and the adoption control", async () => {
      const html = await render();
      const words = text(html);
      const order = getOrder();
      assert.match(words, new RegExp(order.order_ref));
      assert.match(words, /Earlier workflow/);
      for (const amount of ["4,350.55", "1,087.64"]) assert.ok(words.includes(amount), `${amount} is shown`);
      for (const payment of order.payments) assert.ok(words.includes(payment.receipt_number), `${payment.receipt_number} is listed`);
      for (const [title, message] of UPDATES) assert.ok(words.includes(title) && words.includes(message), `${title} is shown`);
      assert.match(words, /Tracking updates shown to the customer/);
      assert.equal(count(html, 'data-testid="workflow-stage"'), 9);
      assert.match(html, /data-stage="in_transit" data-state="current"/);
      assert.ok(count(words, "order created") >= 1, "the history is listed (a table view and a card view, so it can appear twice)");
      assert.equal(count(html, 'data-testid="tracking-update"'), 0, "the earlier workflow keeps its flat list, not the nested one");
      assert.match(words, /Move to the current workflow/, "the owner's adoption control");
      assert.equal(count(html, 'data-testid="adopt-form"'), 1);
      assert.equal(count(html, 'data-testid="transition-form"'), 1);
      for (const next of order.next_statuses) assert.ok(words.includes(next.label), `the status control offers ${next.label}`);
      assert.equal(count(html, 'data-testid="fulfillment-form"'), 0, "no fulfilment-type control for an order that is not on the current workflow");
      assert.equal(count(html, 'data-testid="tracking-form"'), 1, "the earlier workflow keeps its single publish form");
      assert.doesNotMatch(words, /Not chosen yet/);
    });

    it("the other staff pages that show orders (overview, orders list and filter, customer, payments, audit) render, and show it as In transit", async () => {
      await otherPagesShow({ statusLabel: "In transit", auditAction: "payment.recorded", receipts: getOrder().payments.map((p) => p.receipt_number) });
    });
  });

  describe("the same order after the owner moved it onto the current workflow (live_tracking, type not chosen) - the state that failed on the hosted page", () => {
    before(() => {
      // exactly what the owner did on the hosted page: the page's own form, the default placement
      assert.equal(lines(db.commit(`${AS.olivia}select admin.adopt_new_workflow('${id}', ',km');`)).pop().trim(), "live_tracking");
    });

    it("the data: workflow 2, Live tracking, no type yet, the money, the payments and the four updates unchanged, one new history row", () => {
      const order = getOrder();
      assert.deepEqual([order.workflow_version, order.status, order.tracking_phase, order.fulfillment_type], [2, "live_tracking", "live", null]);
      assert.deepEqual([order.total_minor, order.deposit_required_minor, order.amount_paid_minor, order.payments.length, order.tracking.length, order.history.length], [435055, 108764, 435055, 2, 4, 6]);
      assert.equal(order.adoption_options, null);
    });

    it("the page RENDERS (it threw 'Attempted to call fulfillmentLabel() from the server' before the fix): Live tracking is current, the type is shown as not chosen, the four updates are nested", async () => {
      const html = await render();
      const words = text(html);
      assert.match(html, /data-stage="live_tracking" data-state="current"/);
      assert.match(words, /Not chosen yet/);
      assert.match(words, /Order type/);
      assert.equal(count(html, 'data-testid="tracking-update"'), 4);
      assert.equal(count(html, 'data-latest="true"'), 1);
      assert.match(words, /Tracking updates · 4 updates/);
      for (const [title, message] of UPDATES) assert.ok(words.includes(title) && words.includes(message), `${title} is shown`);
      assert.equal(count(html, 'data-testid="tracking-form"'), 1, "Live tracking is open: the owner can publish");
      assert.equal(count(html, 'data-testid="fulfillment-form"'), 1, "the owner can choose the order type");
      assert.equal(count(html, 'data-testid="adopt-form"'), 0, "an adopted order is not offered adoption again");
      assert.ok(words.includes("4,350.55") && words.includes("1,087.64"));
    });

    it("the page also renders for a role that cannot change the status (the second place the order type is written out)", async () => {
      const permissions = new Set([...ownerPermissions].filter((p) => p !== "orders.transition" && p !== "orders.adopt"));
      const html = await render(permissions);
      const words = text(html);
      assert.match(words, /Order type/);
      assert.match(words, /Not chosen yet/);
      assert.equal(count(html, 'data-testid="transition-form"'), 0, "no status control without the permission");
      assert.equal(count(html, 'data-testid="fulfillment-form"'), 0, "no type form without the permission");
    });

    it("the other staff pages that show orders render for the adopted order too, and the audit page shows the new action code", async () => {
      await otherPagesShow({ statusLabel: "Live tracking", auditAction: "order.workflow_adopted", receipts: getOrder().payments.map((p) => p.receipt_number) });
    });
  });
});
