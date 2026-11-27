// PLAT-0006: THE FINANCE SCREENS, RENDERED FOR REAL with data from the REAL database functions. Real PostgreSQL 16, the real migrations, the real
// owner-only finance functions, and the REAL pages and components rendered with React's server renderer under the loader in
// support/page-render-loader.mjs (which emulates the server / client boundary). Only the sign-in is stubbed: each page runs as it does for a
// signed-in owner, and for a signed-in staff member WITHOUT the finance permissions, whose database answers come from the same real functions.
//
// What is proved:
//   * Orders: Financial performance sits above the operational list; year / month selectors; the net revenue, direct cost, order profit,
//     completed-order count and margin are the database's; a full January-December table; a month is chosen by COMPLETION date (an order placed
//     in February and completed in March is a March order); incomplete or missing costs are visible, in the totals and in each month's Costs column;
//     more than 100 completed orders are all counted; the operational list below is independent of the period (and there is no separate
//     completed-orders table any more); the table has the phone-card layout too. The list's own filters are in orders.pages.db.test.mjs.
//   * Order page: the cost editor, the costs indicator, the history with old and new values, the completion note and the verification form.
//   * Overview: Operations / Financial performance / Needs attention groups, the year selector, no cost data for ordinary staff.
//   * Customer page: each order with the FINAL NET PAYABLE up front, the original total, the discount and credit, paid and outstanding.
//   * New order page: the optional costs section for the owner only.
//   * Nothing a customer-appropriate view must not carry (a cost, a supplier, a margin, a profit, a private note) appears for ordinary staff.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ONE, lines, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ");
const inner = (html, testId) => {
  const m = new RegExp(`<([a-z0-9]+)[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return m ? text(m[2]).trim() : null;
};
const has = (html, testId) => new RegExp(`data-testid="${testId}"`).test(html);
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));

const SUPPLIER = "PageSupplierSentinelZ7";
const NOTE = "PagePrivateNoteSentinelZ7";
const SECRET_AMOUNT = 4_444_404; // appears as "44,444.04" for the owner, never for anyone else
const YEAR = 2025; // a past year, so the tests do not depend on today's date

suite("the finance screens, rendered with the database's own answers (real functions, real components, server/client boundary emulated)", () => {
  let db;
  let ownerPerms;
  let staffPerms;
  const pages = {};
  const ids = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const apiFor = (who) => ({
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    getCustomer: async (cid) => q(`select admin.get_customer(${lit(cid)})::text`, who),
    claimCodes: async () => [],
    orderPricingContext: async (cid) => q(`select admin.order_pricing_context(${lit(cid)})::text`, who),
    searchCustomers: async () => [],
    listOrders: async ({ status = null, search = null, limit = 50, offset = 0 } = {}) => q(`select admin.list_orders(${lit(status)}, ${lit(search)}, ${limit}, ${offset})::text`, who),
    listOrdersPage: async (o) => q(`select admin.list_orders_page(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who),
    listOrdersOverview: async (o) => q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who),
    overview: async (year = null) => q(`select admin.overview_summary(${num(year)})::text`, who),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, who),
    completedOrders: async (year = null, month = null, limit = 50, offset = 0) => q(`select admin.list_completed_orders(${num(year)}, ${num(month)}, ${limit}, ${offset})::text`, who),
    customerOrders: async (cid, limit = 25, offset = 0) => q(`select admin.customer_orders(${lit(cid)}, ${limit}, ${offset})::text`, who),
    orderCosts: async (oid) => q(`select admin.order_costs(${lit(oid)})::text`, who),
    orderCompletion: async (oid) => q(`select admin.order_completion(${lit(oid)})::text`, who),
    orderOrigin: async (oid) => q(`select admin.order_origin(${lit(oid)})::text`, who),
  });
  async function render(page, args = {}, { who = AS.olivia, permissions = ownerPerms } = {}) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who) };
    return renderToStaticMarkup(await page.default(args));
  }
  /** The Orders section alone (the monthly report sits below it, collapsed), from its start to the report's toggle. */
  const ordersPart = (html) => html.slice(html.indexOf('id="orders-list"'), html.indexOf('data-testid="financial-details"') > 0 ? html.indexOf('data-testid="financial-details"') : undefined);
  const ordersHtml = (search = {}, opts) => render(pages.orders, { searchParams: Promise.resolve(search) }, opts);
  const overviewHtml = (search = {}, opts) => render(pages.overview, { searchParams: Promise.resolve(search) }, opts);
  const orderHtml = (id, opts) => render(pages.order, { params: Promise.resolve({ id }) }, opts);
  const customerHtml = (id, opts) => render(pages.customer, { params: Promise.resolve({ id }) }, opts);
  const staffOpts = () => ({ who: AS.sam, permissions: staffPerms });

  const mkOrder = ({ total = 100000, customer = ID.custA, discount = null, points = 0, costs = null } = {}) =>
    lines(commit(`select admin.create_order('${customer}', '${JSON.stringify(ONE(total))}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, ${discount ? `'${JSON.stringify(discount)}'::jsonb` : "null::jsonb"}, ${points}::bigint, null::bigint, null::bigint, ${costs ? `'${JSON.stringify(costs)}'::jsonb` : "null::jsonb"});`)).pop().trim();
  const complete = (id) => {
    commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
    const net = Number(read(`select net_payable_minor from public.orders where id = '${id}'`));
    commit(`select admin.record_payment('${id}', 'balance', ${net}, 'cash');`);
    for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
  };
  const place = (id, created, completed) => {
    rewrite(`update public.orders set created_at = '${created}', completed_at = '${completed}' where id = '${id}';`);
    rewrite(`update private.order_completions set completed_at = '${completed}' where order_id = '${id}';`);
  };
  const addCost = (orderId, amount, over = {}) => {
    const c = { category: "components", description: "Graphics card", kind: "actual", supplier: null, note: null, ...over };
    commit(`select admin.add_order_cost('${orderId}', '${randomUUID()}', '${c.category}', ${lit(c.description)}, ${amount}, '${c.kind}', ${lit(c.supplier)}, null::date, ${lit(c.note)});`);
  };
  const markComplete = (orderId) => commit(`select admin.set_order_costs_complete('${orderId}', true, null);`);
  const completed = (iso, { total = 100000, cost = null, done = false, created, customer } = {}) => {
    const id = mkOrder({ total, customer });
    complete(id);
    place(id, created ?? new Date(new Date(iso).getTime() - 4 * 86400000).toISOString(), iso);
    if (cost !== null) addCost(id, cost, { supplier: SUPPLIER, note: NOTE });
    if (done) markComplete(id);
    return id;
  };

  before(async () => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    staffPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.sam)));
    assert.ok(ownerPerms.has("finance.read") && ownerPerms.has("finance.manage") && ownerPerms.has("finance.verify"), "the owner holds the three finance permissions");
    assert.ok(![...staffPerms].some((p) => p.startsWith("finance.")), "ordinary staff hold none of them");

    // 2025: February placed + March completed (cost complete), March complete (cost estimated only), April with no cost, January with a big secret cost
    ids.jan = completed(`${YEAR}-01-20T09:00:00+03:00`, { total: 500000, cost: SECRET_AMOUNT, done: true });
    ids.febToMar = completed(`${YEAR}-03-02T10:00:00+03:00`, { total: 200000, cost: 120000, done: true, created: `${YEAR}-02-27T10:00:00+03:00` });
    ids.mar = completed(`${YEAR}-03-15T15:00:00+03:00`, { total: 300000 });
    addCost(ids.mar, 90000, { kind: "estimated", description: "Estimated freight" });
    ids.apr = completed(`${YEAR}-04-10T12:00:00+03:00`, { total: 150000 });
    // a December order completed just before the Qatar new year (still 2025 in Qatar), and one just after (2026)
    ids.dec = completed(`${YEAR}-12-31T23:30:00+03:00`, { total: 100000, cost: 60000, done: true });
    ids.next = completed(`${YEAR + 1}-01-01T00:30:00+03:00`, { total: 100000, cost: 10000, done: true });
    // an open order with a cost, and an order delivered before dates were recorded
    ids.open = mkOrder({ total: 250000 });
    addCost(ids.open, 70000, { kind: "estimated", description: "Parts on order" });
    ids.legacy = mkOrder({ total: 80000 });
    commit(`select admin.transition_order('${ids.legacy}', 'awaiting_deposit');`);
    rewrite(`update public.orders set status = 'delivered' where id = '${ids.legacy}';`);

    pages.orders = await import("../../src/app/admin/orders/page.tsx");
    pages.order = await import("../../src/app/admin/orders/[id]/page.tsx");
    pages.overview = await import("../../src/app/admin/page.tsx");
    pages.customer = await import("../../src/app/admin/customers/[id]/page.tsx");
    pages.newOrder = await import("../../src/app/admin/orders/new/page.tsx");
  });
  after(() => db?.stop());

  describe("Orders: the monthly Financial performance report below the operational list (collapsed)", () => {
    it("the section is BELOW the Orders list (in the collapsed monthly report), with the year and month selectors and the five figures from the database", async () => {
      const html = await ordersHtml({ fy: String(YEAR) });
      assert.ok(html.indexOf('id="financial-performance"') > html.indexOf('id="orders-list"'), "the list comes first, the report is one click below it");
      assert.ok(has(html, "period-selector"));
      for (const month of ["January", "June", "December"]) assert.ok(html.includes(`<option value="${["January", "June", "December"].indexOf(month) * 5 + 1}"`) || html.includes(month), month);
      const report = q(`select admin.financial_report(${YEAR}, null)::text`, AS.olivia);
      assert.equal(report.period.completed_orders, 5, "January, two in March, April, December 31st (the 2026 one is not in 2025)");
      assert.equal(inner(html, "fin-count"), "Completed orders 5");
      assert.ok(inner(html, "fin-net-revenue").includes("12,500.00"), `net revenue ${inner(html, "fin-net-revenue")}`); // 5000 + 2000 + 3000 + 1500 + 1000
      assert.ok(/provisional/i.test(inner(html, "fin-profit")), "the profit is provisional while costs are incomplete");
      assert.equal(inner(html, "fin-period-title"), String(YEAR));
    });

    it("every month January to December is a row, with the completed count and the revenue of that month by COMPLETION date", async () => {
      const html = await ordersHtml({ fy: String(YEAR) });
      const table = /<table[\s\S]*?<\/table>/.exec(html.slice(html.indexOf('id="financial-performance"')))[0];
      const rows = [...table.matchAll(/<tr class="group">([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]).trim());
      assert.equal(rows.length, 12, "twelve month rows");
      const row = (month) => rows.find((r) => r.startsWith(month));
      assert.match(row("January"), /^January 1 /);
      assert.match(row("February"), /^February 0 /, "the order PLACED in February is not a February order");
      assert.match(row("March"), /^March 2 /, "it was completed in March");
      assert.match(row("April"), /^April 1 /);
      assert.match(row("December"), /^December 1 /, "completed at 23:30 on 31 December Qatar time");
      assert.match(row("June"), /^June 0 /);
    });

    it("a month is chosen by completion date: the figures are those of the orders COMPLETED in it, and the operational list below is not filtered by it", async () => {
      const html = await ordersHtml({ fy: String(YEAR), fm: "3" });
      assert.equal(inner(html, "fin-period-title"), `March ${YEAR}`);
      assert.equal(inner(html, "fin-count"), "Completed orders 2", "both March completions are counted, including the one placed in February");
      assert.ok(inner(html, "fin-net-revenue").includes("5,000.00"), `net revenue ${inner(html, "fin-net-revenue")}`); // 2000 + 3000
      // There is no separate completed-orders table any more, and nothing points at one.
      assert.ok(!html.includes('id="completed-orders"') && !/Orders completed in/.test(text(html)), "the redundant completed-orders section is gone");
      assert.ok(!html.includes("#completed-orders") && !html.includes("completed-orders"), "no link or anchor to it is left");
      assert.ok(html.includes('id="financial-performance"') && html.includes("#financial-performance"), "the month links lead to the Financial performance section");
      const ref = (id) => read(`select order_ref from public.orders where id = '${id}'`);
      const list = ordersPart(html);
      assert.ok(list.includes('data-testid="orders-summary"'), "the operational list has its own summary");
      // (the table and the phone cards both link each order, so count the DIFFERENT orders linked)
      assert.equal(new Set(list.match(/href="\/admin\/orders\/[0-9a-f-]{36}"/g) ?? []).size <= 5, true, "the operational list shows one page of at most 5");
      // Choosing the month changed the report only: the list is the same page as with no month chosen.
      const without = await ordersHtml({ fy: String(YEAR) });
      assert.equal(text(list), text(ordersPart(without)).replace(/\s+/g, " "), "the list is identical whatever month the report shows");
      assert.ok(ref(ids.jan).length > 0);
    });

    it("incomplete and missing costs are visible: in the warning and in each month's Costs column", async () => {
      const html = await ordersHtml({ fy: String(YEAR) });
      const warning = inner(html, "fin-incomplete-warning");
      assert.ok(warning && /Provisional/.test(warning), warning);
      assert.ok(/a missing cost is never counted as zero/i.test(warning));
      const table = /<table[\s\S]*?<\/table>/.exec(html.slice(html.indexOf('id="financial-performance"')))[0];
      const rows = [...table.matchAll(/<tr class="group">([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]).trim());
      const row = (month) => rows.find((r) => r.startsWith(month));
      assert.match(row("March"), /1 incomplete/, "the March order with an estimated freight entry is flagged");
      assert.match(row("April"), /1 with none/, "an order without any cost says so");
      assert.match(row("December"), /Complete/, "and a month whose orders all have complete costs says so");
      const april = await ordersHtml({ fy: String(YEAR), fm: "4" });
      assert.ok(/Not available/.test(inner(april, "fin-profit")), "and shows no profit for it");
    });

    it("profit and margin follow the definitions: a month with only complete costs is verified; one with a missing cost leaves it out of the profit", async () => {
      const dec = await ordersHtml({ fy: String(YEAR), fm: "12" });
      assert.ok(/Verified/.test(inner(dec, "fin-profit")), inner(dec, "fin-profit"));
      assert.ok(inner(dec, "fin-profit").includes("400.00"), "1,000.00 revenue less 600.00 cost");
      assert.equal(inner(dec, "fin-margin"), "Margin 40.0% Order profit ÷ net revenue");
      assert.ok(!has(dec, "fin-incomplete-warning"), "no warning when every completed order has complete costs");
      const apr = await ordersHtml({ fy: String(YEAR), fm: "4" });
      assert.ok(/Not available/.test(inner(apr, "fin-profit")), "no cost recorded: no profit, not revenue minus zero");
      assert.equal(inner(apr, "fin-margin").startsWith("Margin —"), true);
    });

    it("the Qatar new year is the boundary: 23:30 on 31 December is 2025, 00:30 on 1 January is 2026", async () => {
      const a = await ordersHtml({ fy: String(YEAR), fm: "12" });
      const b = await ordersHtml({ fy: String(YEAR + 1), fm: "1" });
      assert.equal(inner(a, "fin-count"), "Completed orders 1");
      assert.equal(inner(b, "fin-count"), "Completed orders 1");
      assert.notEqual(inner(a, "fin-net-revenue"), undefined);
    });

    it("an order delivered before dates were recorded is not in any month and is listed as needing verification", async () => {
      const html = await ordersHtml({ fy: String(YEAR) });
      const warning = inner(html, "fin-needs-verification");
      assert.ok(warning && /1 delivered order needs historical verification/.test(warning), warning);
      assert.ok(warning.includes(read(`select order_ref from public.orders where id = '${ids.legacy}'`)));
    });

    it("the year defaults to the current Qatar year automatically", async () => {
      const html = await ordersHtml({});
      const currentYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric" }).format(new Date());
      assert.equal(inner(html, "fin-period-title"), currentYear);
      assert.ok(html.includes(`<option value="${currentYear}" selected`) || html.includes(`value="${currentYear}"`), "the selector offers it");
    });

    it("garbage in the query string is ignored, never an error", async () => {
      for (const search of [{ fy: "abc" }, { fy: "1999" }, { fm: "13" }, { fy: "2025", fm: "0" }, { fy: ["2025", "2024"] }, { fp: "-3" }, { fp: "99999" }]) {
        const html = await ordersHtml(search);
        assert.ok(html.includes("Financial performance"), JSON.stringify(search));
      }
    });

    it("the layout works on a phone: the month table is also drawn as cards, with the same figures", async () => {
      const html = await ordersHtml({ fy: String(YEAR) });
      const section = html.slice(html.indexOf('id="financial-performance"'));
      assert.ok(section.includes("hidden overflow-x-auto md:block"), "the table for wide screens");
      assert.ok(section.includes("flex flex-col gap-3 md:hidden"), "the cards for phones");
      assert.equal((section.match(/<li class="rounded-glass-sm border border-border bg-white\/\[0\.025\] p-4">/g) ?? []).length >= 12, true, "twelve month cards");
      assert.ok(!/<table[^>]*>(?:(?!<\/table>)[\s\S])*min-w-\[(?!30rem)/.test(section), "no wide fixed table");
    });
  });

  describe("Orders: more than 100 completed orders are all counted, by the database", () => {
    it("120 completed orders in one month are all in the totals, and the operational list counts every order, though it shows one page of 5", async () => {
      const customer = ID.custA;
      const values = [];
      for (let i = 0; i < 120; i += 1) values.push(`('${randomUUID()}'::uuid, '${customer}'::uuid, 'BULK-${String(i).padStart(4, "0")}', 10000)`);
      // Arranged in bulk (a real transition per order would take minutes): rows and completions in the shape the real functions produce.
      rewrite(`
        insert into public.orders (id, customer_id, order_ref, status, total_minor, created_at, completed_at, workflow_version)
        select v.id, v.cust, v.ref, 'delivered', v.total, timestamptz '${YEAR}-08-01 09:00+03', timestamptz '${YEAR}-08-05 10:00+03', 1
        from (values ${values.join(",")}) as v(id, cust, ref, total);
        insert into private.order_completions (order_id, completed_at, basis, gross_minor, discount_minor, loyalty_credit_minor, net_revenue_minor)
        select id, completed_at, 'transition', total_minor, 0, 0, total_minor from public.orders where order_ref like 'BULK-%';`);
      const html = await ordersHtml({ fy: String(YEAR), fm: "8" });
      assert.equal(inner(html, "fin-count"), "Completed orders 120");
      assert.ok(inner(html, "fin-net-revenue").includes("12,000.00"));
      // The operational list is a page of 5, counted over ALL orders (the 120 included), not the first 100 of them.
      const total = Number(read("select count(*) from public.orders"));
      assert.ok(total > 120);
      assert.match(text(html), new RegExp(`Latest 5 of ${total} orders`));
      rewrite(`delete from private.order_completions where order_id in (select id from public.orders where order_ref like 'BULK-%'); delete from public.orders where order_ref like 'BULK-%';`);
    });
  });

  describe("an ordinary staff member (no finance permission): the operational screens, with no cost, profit or margin anywhere", () => {
    it("the Orders page shows the operational list, and no Financial performance, completed-orders table, cost, profit or margin", async () => {
      const html = await ordersHtml({ fy: String(YEAR), fm: "3" }, staffOpts());
      assert.ok(!html.includes('id="financial-performance"') && !has(html, "fin-profit"));
      assert.ok(!html.includes("completed-orders") && !/Orders completed in/.test(text(html)));
      assert.ok(!/Direct cost|Order profit|Margin|Costs complete|Costs incomplete|No costs recorded/.test(text(html)), "no finance column or word");
      assert.ok(html.includes('id="orders-list"') && has(html, "orders-summary"), "the list and its summary are there for ordinary staff");
      assert.ok(!has(html, "period-selector"), "the report's period selector belongs to the Financial performance section, which this person does not have");
    });

    it("no cost, supplier, note or secret amount reaches any ordinary staff screen: Orders, Order, Overview, Customer, New order", async () => {
      const everything = [
        await ordersHtml({ fy: String(YEAR) }, staffOpts()),
        await ordersHtml({ fy: String(YEAR), fm: "1" }, staffOpts()),
        await orderHtml(ids.jan, staffOpts()),
        await overviewHtml({ year: String(YEAR) }, staffOpts()),
        await customerHtml(ID.custA, staffOpts()),
        await render(pages.newOrder, { searchParams: Promise.resolve({ customer: ID.custA }) }, staffOpts()),
      ].join("\n");
      for (const needle of [SUPPLIER, NOTE, "44,444.04", "4444404", "Order costs", "Order profit", "Direct costs", "Cost history", "add-cost-form", "costs-section"]) {
        assert.ok(!everything.includes(needle), `ordinary staff must not see ${needle}`);
      }
    });

    it("the order page shows the completion note, and a staff member can see that an old delivery needs the owner to verify its date", async () => {
      const done = await orderHtml(ids.jan, staffOpts());
      assert.ok(/Completed .*2025/.test(inner(done, "completion-note")), inner(done, "completion-note"));
      const legacy = await orderHtml(ids.legacy, staffOpts());
      assert.ok(has(legacy, "completion-needs-verification") && !has(legacy, "verify-completion-form"), "the form is the owner's");
    });

    it("the Overview shows Operations and Needs attention, and no Financial performance group", async () => {
      const html = await overviewHtml({ year: String(YEAR) }, staffOpts());
      assert.ok(has(html, "overview-operations") && !has(html, "overview-financial"));
      assert.ok(!text(html).includes("Total net revenue"));
    });
  });

  describe("Order page: the cost editor for the owner", () => {
    it("shows the costs indicator, the summary, every entry, the add / edit / remove forms and the complete / reopen control", async () => {
      const html = await orderHtml(ids.mar);
      assert.ok(has(html, "cost-indicator") && /Costs incomplete/.test(inner(html, "cost-indicator")), "an estimated entry keeps the order incomplete");
      assert.ok(inner(html, "cost-net-revenue").includes("3,000.00"));
      assert.ok(inner(html, "cost-recorded").includes("900.00") && /estimated/.test(inner(html, "cost-recorded")));
      assert.ok(/provisional/i.test(inner(html, "cost-profit")));
      assert.ok(has(html, "add-cost-form") && has(html, "costs-complete-form"));
      assert.ok(text(html).includes("Estimated freight"));
      assert.ok(/Edit/.test(text(html)) && /Remove/.test(text(html)));
    });

    it("an order with no cost recorded says so: no profit, a clear indicator, never zero", async () => {
      const html = await orderHtml(ids.apr);
      assert.ok(/No costs recorded/.test(inner(html, "cost-indicator")));
      assert.ok(/None recorded/.test(inner(html, "cost-recorded")));
      assert.ok(/Not available/.test(inner(html, "cost-profit")));
      assert.equal(inner(html, "cost-margin").startsWith("Margin —"), true);
    });

    it("a complete order shows verified profit and margin; the history shows the old and the new value, who, and why, after an edit", async () => {
      const id = ids.febToMar;
      const entry = q(`select admin.order_costs('${id}')::text`, AS.olivia).entries[0];
      commit(`select admin.edit_order_cost('${entry.id}', ${entry.version}, 'components', 'Graphics card (final invoice)', 125000, 'actual', null, null, null, 'the supplier invoice changed the price');`);
      const html = await orderHtml(id);
      assert.ok(/Costs incomplete/.test(inner(html, "cost-indicator")), "an edit after completion reopens the costs: the owner declares them complete again");
      const history = inner(html, "cost-history");
      assert.ok(history.includes("Amount: QAR 1,200.00 → QAR 1,250.00"), history);
      assert.ok(history.includes("Description: Graphics card → Graphics card (final invoice)"), history);
      assert.ok(history.includes("Reason: the supplier invoice changed the price"));
      assert.ok(/Costs reopened/.test(history), "the automatic reopening is in the history too");
      markComplete(id);
      const again = await orderHtml(id);
      assert.ok(/Costs complete/.test(inner(again, "cost-indicator")));
      assert.ok(/Verified|Costs complete/.test(inner(again, "cost-profit")));
    });

    it("a removed entry leaves the totals, stays listed as removed, and keeps its history", async () => {
      const id = mkOrder({ total: 90000 });
      addCost(id, 5000, { description: "Wrong order entry" });
      const entry = q(`select admin.order_costs('${id}')::text`, AS.olivia).entries[0];
      commit(`select admin.void_order_cost('${entry.id}', ${entry.version}, 'entered on the wrong order');`);
      const html = await orderHtml(id);
      assert.ok(/1 removed entry/.test(text(html)));
      assert.ok(/None recorded/.test(inner(html, "cost-recorded")), "the voided entry is not counted");
      assert.ok(/Removed from the totals: Wrong order entry/.test(inner(html, "cost-history")));
    });

    it("an owner sees the verification form for an order delivered before dates were recorded; it is not in any month until verified", async () => {
      const html = await orderHtml(ids.legacy);
      assert.ok(has(html, "verify-completion-form"));
      assert.ok(/Needs historical verification/.test(text(html)));
    });
  });

  describe("Overview: grouped, with the year selector", () => {
    it("Operations (active and completed orders), Financial performance (net revenue and order profit), Needs attention, Recent orders - and not a wall of status cards", async () => {
      const html = await overviewHtml({ year: String(YEAR) });
      const t = text(html);
      for (const heading of ["Operations", "Financial performance", "Needs attention", "Recent orders"]) assert.ok(t.includes(heading), heading);
      assert.ok(t.includes("Active orders") && t.includes(`Completed orders, ${YEAR}`));
      assert.ok(t.includes("Total net revenue") && t.includes("Total order profit"));
      assert.ok(!/Under assembly|Total orders|Awaiting scheduling/.test(t), "the twelve status cards are gone");
      assert.equal((html.match(/glass glass-flat/g) ?? []).length < 12, true);
      assert.ok(has(html, "overview-profit-warning") && /Missing costs are never counted as zero/.test(inner(html, "overview-profit-warning")));
      assert.ok(has(html, "overview-reports-link"));
      assert.ok(has(html, "overview-year"));
    });

    it("active orders are the current workload whatever year is chosen; completed orders and the money follow the year", async () => {
      const a = await overviewHtml({ year: String(YEAR) });
      const b = await overviewHtml({ year: String(YEAR - 5) });
      const active = (html) => /Active orders\s*<\/span><span[^>]*>(\d+)</.exec(html)?.[1] ?? text(html).match(/Active orders (\d+)/)?.[1];
      assert.equal(active(a), active(b), "the same workload");
      assert.ok(/Completed orders, 2020 0|Completed orders, 2020\s*0/.test(text(b)) || text(b).includes(`Completed orders, ${YEAR - 5} 0`));
      assert.ok(text(a).includes(`Completed orders, ${YEAR} 5`));
    });

    it("the Qatar current year is the default", async () => {
      const html = await overviewHtml({});
      const currentYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric" }).format(new Date());
      assert.ok(text(html).includes(`Completed orders, ${currentYear}`));
    });

    it("Needs attention lists only what is open, with counts", async () => {
      const html = await overviewHtml({ year: String(YEAR) });
      const t = inner(html, "overview-attention");
      assert.ok(/1 Completion date to verify/.test(t), t);
    });
  });

  describe("Customer page: the order history with the final net payable up front", () => {
    let customer;
    let netId;
    let money;
    const fmt = (minor) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(minor / 100);
    before(() => {
      customer = randomUUID();
      db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${customer}', 'History Test Customer', '+97455559911', '${customer}@example.test', 'walk_in');`);
      // gross 10,000.00, a fixed discount of 500.00, and 200 loyalty points redeemed (their credit is whatever the owner's point value makes it)
      commit(`select admin.adjust_loyalty('${customer}', 300, 'points for the history test');`);
      netId = mkOrder({ total: 1000000, customer, discount: { mode: "fixed", amount_minor: 50000, reason: "private internal reason text" }, points: 200 });
      commit(`select admin.transition_order('${netId}', 'awaiting_deposit');`);
      commit(`select admin.record_payment('${netId}', 'deposit', 100000, 'cash');`);
      const row = JSON.parse(read(`select row_to_json(o)::text from public.orders o where id = '${netId}'`));
      assert.ok(row.loyalty_credit_minor > 0 && row.discount_minor === 50000, "the order has both a discount and a credit");
      money = {
        gross: row.total_minor,
        credit: row.loyalty_credit_minor,
        net: row.total_minor - row.discount_minor - row.loyalty_credit_minor,
      };
      assert.equal(row.net_payable_minor, money.net, "the database's net payable is the plain subtraction");
    });

    it("shows original total, discount, loyalty credit, FINAL NET PAYABLE, paid and outstanding for each order", async () => {
      const html = await customerHtml(customer);
      const card = html.slice(html.indexOf('data-testid="customer-order"'));
      const t = text(card);
      assert.ok(t.includes("10,000.00") && t.includes("500.00") && t.includes(fmt(money.credit)), "gross, discount and credit");
      assert.ok(inner(card, "net-payable").includes(fmt(money.net)), inner(card, "net-payable"));
      assert.ok(t.includes("1,000.00"), "paid so far");
      assert.ok(t.includes(fmt(money.net - 100000)), "outstanding");
      assert.ok(/not money received/.test(t), "a payable amount is never presented as received");
    });

    it("the expandable details list the items with the discount and credit spread so the lines add up to the net payable, the payments with receipts and the history", async () => {
      const html = await customerHtml(customer);
      assert.ok(html.includes("<details"), "expandable");
      const t = text(html);
      assert.ok(/Order details/.test(t) && /Payments/.test(t) && /Status history/.test(t));
      assert.ok(/The original prices are never changed/.test(t));
      const data = q(`select admin.customer_orders('${customer}')::text`, AS.olivia);
      const order = data.orders[0];
      assert.equal(order.items.reduce((s, i) => s + i.net_line_minor, 0), order.net_payable_minor, "the line nets reconcile exactly");
      assert.equal(order.items.reduce((s, i) => s + i.line_total_minor, 0), order.gross_minor, "original prices untouched");
    });

    it("the page carries no internal discount reason, cost, supplier, margin or profit - even for the owner", async () => {
      const html = await customerHtml(customer);
      for (const needle of ["private internal reason text", "Order profit", "Margin", "Direct cost", SUPPLIER, NOTE]) assert.ok(!html.includes(needle), needle);
    });

    it("a staff member without payments.read sees the amounts payable but no payments and no paid/outstanding figures", async () => {
      const permissions = new Set([...staffPerms].filter((p) => p !== "payments.read"));
      const html = await customerHtml(customer, { who: AS.sam, permissions });
      assert.ok(inner(html, "net-payable").includes(fmt(money.net)));
      const details = text(html.slice(html.indexOf("Order details")));
      assert.ok(!/Payments/.test(details), "no payment rows");
    });

    it("the history has the phone layout too: cells are in a grid that collapses to two columns", async () => {
      const html = await customerHtml(customer);
      assert.ok(html.includes("grid grid-cols-2") && html.includes("sm:grid-cols-3"));
    });
  });

  describe("New order page: the optional costs section", () => {
    it("the owner sees the optional, private Direct order costs section with every category and both kinds; it is closed by default", async () => {
      const html = await render(pages.newOrder, { searchParams: Promise.resolve({ customer: ID.custA }) });
      assert.ok(has(html, "costs-section"));
      const t = text(html);
      assert.ok(/Direct order costs/.test(t) && /optional, private to the owner/.test(t));
      for (const label of ["Components / supplier purchases", "International shipping", "Customs and import duties", "Assembly expenses", "Local delivery", "Payment processing charges", "Other direct order expenses", "Estimated", "Actual"]) {
        assert.ok(t.includes(label), label);
      }
      assert.ok(!/<details[^>]*data-testid="costs-section"[^>]* open/.test(html), "closed until used");
    });
  });
});
