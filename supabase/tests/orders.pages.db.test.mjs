// THE SIMPLIFIED ORDERS PAGE, RENDERED FOR REAL with the database's own answers: a real PostgreSQL 16, the real migrations, the real staff functions
// (admin.list_orders_overview and admin.financial_report), and the REAL page and components rendered with React's server renderer under the loader in
// support/page-render-loader.mjs (which emulates the server / client boundary). Only the sign-in is stubbed: the page runs as it does for a signed-in
// owner, and for a signed-in staff member WITHOUT the finance and payments permissions.
//
// What is proved:
//   * the page keeps only a search field, a Sort button, a Filter button and the table: Sort and Filter are closed menus (nothing else is on the screen),
//     there is no always-visible filter form and no rows-per-page control;
//   * the table has exactly the seven columns the owner asked for (Order, Customer, Order price, Cost, Profit, Placed, Receipts) and an ordinary staff member
//     gets four (no Cost, Profit or Receipts, and nothing of them anywhere in the page);
//   * the default is the latest 5 orders, newest first; the order number leads to the order's page; the price is what the customer PAYS;
//   * the Sort menu lists the six sorts (four for a person who may not see costs) and says which is in force; every sort puts the rows in the
//     database's order; a profit sort in the address of a person without finance falls back to newest;
//   * the Filter panel (status, month, year, from, to): no filter shows the latest 5, a month and year filter by the date PLACED, a date range overrides
//     them and says so, an invalid range is explained, and every choice is kept in the address and carried by every link and form;
//   * cost and profit: unknown is a dash (never zero), a loss is shown as a loss, an estimate is "provisional", and the figures are the database's;
//   * receipts: a small button with the count (or "Add") in each row, never a drop area; the panel has the list, view and download, remove, and the drop
//     area for another; a person who may not manage receipts gets no upload or remove control;
//   * the monthly financial report is one click away below the list, never changes with the list's choices, and the list never changes with it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { lines, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
const inner = (html, testId) => {
  const m = new RegExp(`<([a-z0-9]+)[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return m ? text(m[2]) : null;
};
const has = (html, testId) => new RegExp(`data-testid="${testId}"`).test(html);
const tag = (html, testId) => new RegExp(`<[a-z0-9]+ [^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? null;
const hrefOf = (html, testId) => {
  const t = tag(html, testId);
  const m = t && /href="([^"]*)"/.exec(t);
  return m ? m[1].replaceAll("&amp;", "&") : null;
};
/** The order ids the page links to, in the order they appear (the table first, then the phone cards repeat them). */
const orderLinks = (html) => [...new Set((html.match(/href="\/admin\/orders\/[0-9a-f-]{36}"/g) ?? []).map((h) => h.slice(6, -1).replace("/admin/orders/", "")))];
const ordersPart = (html) => html.slice(html.indexOf('id="orders-list"'), html.indexOf('data-testid="financial-details"') > 0 ? html.indexOf('data-testid="financial-details"') : undefined);
const headers = (html) => [...ordersPart(html).matchAll(/<th [^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const qar = (minor) => `${minor < 0 ? "-" : ""}QAR ${(Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const YEAR = 2025;
const pdf = (seed) => `\\x${Buffer.from(`%PDF-1.4\n% ${seed}\n%%EOF\n`).toString("hex")}`;
const OWNER_COLUMNS = ["Order", "Customer", "Order price", "Cost", "Profit", "Placed", "Receipts"];
const STAFF_COLUMNS = ["Order", "Customer", "Order price", "Placed"];
const SORTS = ["newest", "oldest", "price_asc", "price_desc", "profit_asc", "profit_desc"];

suite("the simplified Orders page: search, Sort, Filter and a seven-column table, drawn with the database's own answers", () => {
  let db;
  let ownerPerms;
  let staffPerms;
  let page;
  let total;
  const ids = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  /** The ids a `select string_agg(id::text, ',' order by ...)` gives, as an array. */
  const idsOf = (sql) => (read(sql) ? read(sql).split(",") : []);
  const apiFor = (who, tweak = (answer) => answer) => ({
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    claimCodes: async () => [],
    listOrdersOverview: async (o) => tweak(q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who)),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, who),
  });
  async function render(search = {}, { who = AS.olivia, permissions = ownerPerms, tweak } = {}) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who, tweak) };
    return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(search) }));
  }
  const staffOpts = () => ({ who: AS.sam, permissions: staffPerms });
  const section = (html) => /<section id="orders-list"[\s\S]*?<\/section>/.exec(html)[0];
  const newestFive = "select string_agg(id::text, ',' order by created_at desc, id desc) from (select id, created_at from public.orders order by created_at desc, id desc limit 5) x";

  before(async () => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    staffPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.sam)));
    // 36 orders for two customers, 31 hours apart from 1 March 2025; every 6th is awaiting a deposit; one order was moved to an earlier-workflow status.
    commit(`do $$
      declare i integer;
      begin
        for i in 1..36 loop
          perform admin.create_order(case when i % 2 = 0 then '${ID.custA}'::uuid else '${ID.custB}'::uuid end,
                                     jsonb_build_array(jsonb_build_object('kind', 'component', 'description', 'Item ' || i, 'quantity', 1, 'unit_price_minor', 20000 + (i % 9) * 10000)),
                                     null::uuid, 'admin'::text, null::text, null::text, null::text, null::jsonb, 0::bigint, null::bigint, null::bigint, null::jsonb);
        end loop;
      end $$;`);
    rewrite(`with n as (select id, row_number() over (order by order_ref) as i from public.orders)
             update public.orders o set created_at = timestamptz '2025-03-01 09:00:00+03' + (n.i * interval '31 hours'),
                    status = case when n.i = 5 then 'sourcing' when n.i % 6 = 0 then 'awaiting_deposit' else o.status end
               from n where n.id = o.id;`);
    // an order with a big gross, a discount and redeemed credit, so the amount to pay differs from the order value; the newest order of all
    commit(`select admin.adjust_loyalty('${ID.custB}', 2000, 'points for the page test');`);
    ids.discounted = lines(
      commit(`select admin.create_order('${ID.custB}', '${JSON.stringify([{ kind: "component", description: "Big build", quantity: 1, unit_price_minor: 8_000_000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, '${JSON.stringify({ mode: "fixed", amount_minor: 1_500_000, reason: "owner discount for the page test" })}'::jsonb, 2000::bigint, null::bigint, null::bigint, null::jsonb);`),
    ).pop().trim();
    rewrite(`update public.orders set created_at = timestamptz '2025-12-20 09:00:00+03' where id = '${ids.discounted}';`);
    // one completed order, placed in February and completed in March, so the report has something to show
    ids.done = lines(commit(`select admin.create_order('${ID.custA}', '${JSON.stringify([{ kind: "component", description: "Done", quantity: 1, unit_price_minor: 300000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, null::jsonb, 0::bigint, null::bigint, null::bigint, null::jsonb);`)).pop().trim();
    commit(`select admin.transition_order('${ids.done}', 'awaiting_deposit');`);
    commit(`select admin.record_payment('${ids.done}', 'balance', 300000, 'cash');`);
    for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${ids.done}', '${to}');`);
    rewrite(`update public.orders set created_at = timestamptz '${YEAR}-02-20 09:00+03', completed_at = timestamptz '${YEAR}-03-05 10:00+03' where id = '${ids.done}';
             update private.order_completions set completed_at = timestamptz '${YEAR}-03-05 10:00+03' where order_id = '${ids.done}';`);
    // costs on the newest orders: an actual cost declared complete (n1, the discounted one), none on n2, an estimate (n3), a loss (n4)
    [ids.n1, ids.n2, ids.n3, ids.n4, ids.n5] = idsOf(newestFive);
    commit(`select admin.add_order_cost('${ids.n1}', '${randomUUID()}', 'components', 'Parts', 2000000, 'actual', null, null, null);
            select admin.set_order_costs_complete('${ids.n1}', true, null);`);
    commit(`select admin.add_order_cost('${ids.n3}', '${randomUUID()}', 'components', 'Parts', 20000, 'estimated', null, null, null);`);
    commit(`select admin.add_order_cost('${ids.n4}', '${randomUUID()}', 'components', 'Parts', 999000, 'actual', null, null, null);`);
    // receipts: two on n2, one (with an Arabic name) on n4
    commit(`select admin.add_order_receipt('${ids.n2}', '${randomUUID()}', 'Fawran transfer - deposit.pdf', '${pdf("a")}'::bytea);
            select admin.add_order_receipt('${ids.n2}', '${randomUUID()}', 'Cash receipt 0042.pdf', '${pdf("b")}'::bytea);
            select admin.add_order_receipt('${ids.n4}', '${randomUUID()}', 'إيصال الدفع.pdf', '${pdf("c")}'::bytea);`);
    total = Number(read("select count(*) from public.orders"));
    page = await import("../../src/app/admin/orders/page.tsx");
  });
  after(() => db?.stop());

  // =================================================================================================================
  describe("the screen keeps only the search, the Sort and Filter buttons and the table", () => {
    it("above the table there is a search field, a Sort button and a Filter button, and nothing else: both menus are closed, and no filter form, status list or rows-per-page control is on the screen", async () => {
      const html = await render();
      const toolbar = html.slice(html.indexOf('data-testid="orders-toolbar"'), html.indexOf('data-testid="orders-summary-line"'));
      assert.equal(count(toolbar, /<input[^>]*name="q"/g), 1, "one search field");
      assert.ok(has(toolbar, "orders-sort-button") && has(toolbar, "orders-filter-button"));
      for (const id of ["orders-sort-menu", "orders-filter-menu"]) assert.doesNotMatch(tag(toolbar, id), /\sopen(=|\s|>)/, `${id} is closed until clicked`);
      // Everything else in the toolbar lives inside the two closed menus: take them out and only the search remains.
      const outside = toolbar.replace(/<details[\s\S]*?<\/details>/g, "");
      assert.equal(count(outside, /<select/g), 0, "no always-visible select");
      assert.equal(count(outside, /<input(?![^>]*type="hidden")/g), 1, "the only visible input is the search");
      assert.ok(!/Rows per page|Reset filters|data-testid="orders-filters"|orders-row-search/.test(html), "the old filter panel is gone");
      assert.ok(!has(html, "orders-sort-note") && !has(html, "orders-summary-order"), "the old 'Sorted:' note is gone");
    });

    it("the table has exactly seven columns for the owner, in this order, and four for an ordinary staff member", async () => {
      assert.deepEqual(headers(await render()), OWNER_COLUMNS);
      assert.deepEqual(headers(await render({}, staffOpts())), STAFF_COLUMNS);
    });

    it("the default is the latest 5 orders, newest first; the summary says so; every order number leads to the order's page", async () => {
      const html = await render();
      const expected = idsOf(newestFive);
      assert.deepEqual(orderLinks(html), expected);
      assert.equal(inner(html, "orders-summary"), `Latest 5 of ${total} orders`);
      assert.equal(expected[0], ids.discounted, "the newest order of all comes first");
      for (const id of expected) assert.match(html, new RegExp(`<a [^>]*href="/admin/orders/${id}"[^>]*>(\\s|<[^>]+>)*O-[0-9A-Z-]+`), "the order number is the link");
      // Both layouts (table and phone cards) carry the same five.
      assert.equal(count(ordersPart(html), /<tr class="group">/g), 5);
      assert.equal(count(ordersPart(html), /<li class="rounded-glass-sm border border-border bg-white\/\[0\.025\] p-4">/g), 5);
    });

    it("the order price is what the customer has to PAY (after the discount and redeemed credit), never the original total, and there is no 'was' figure", async () => {
      const html = await render();
      const row = /<tr class="group">[\s\S]*?<\/tr>/.exec(html)[0];
      assert.ok(row.includes("QAR 64,800.00"), "8,000,000 - 1,500,000 - 20,000 minor units = QAR 64,800.00");
      assert.ok(!text(html).includes("QAR 80,000.00"), "the original total is nowhere on the page");
      assert.ok(!/\bwas QAR/.test(text(html)), "no 'was' figure: the order's own page shows the breakdown");
    });

    it("the placed date is the Qatar date, and no status, type, paid or balance column is drawn", async () => {
      const html = await render();
      assert.ok(text(html).includes("20 Dec 2025"), "the newest order was placed on 20 December 2025");
      const h = headers(html);
      for (const gone of ["Status", "Type", "Paid", "Balance"]) assert.ok(!h.includes(gone), gone);
      assert.ok(!/Earlier workflow|Custom PC build|Parts only|Not chosen/.test(text(section(html))), "no workflow detail in the list");
    });
  });

  // =================================================================================================================
  describe("the Sort menu", () => {
    const sortLinks = (html) => SORTS.filter((s) => has(html, `orders-sort-${s}`));
    const LABELS = ["Newest first", "Oldest first", "Price: low to high", "Price: high to low", "Profit: low to high", "Profit: high to low"];

    it("lists the six sorts for the owner and four for a person who may not see costs, with the labels the owner asked for; the sort in force is marked and named on the button", async () => {
      const owner = await render();
      assert.deepEqual(sortLinks(owner), SORTS);
      assert.deepEqual(SORTS.map((s) => inner(owner, `orders-sort-${s}`)), LABELS);
      assert.deepEqual(sortLinks(await render({}, staffOpts())), ["newest", "oldest", "price_asc", "price_desc"]);
      for (const [i, sort] of SORTS.entries()) {
        const html = await render({ sort });
        assert.equal(inner(html, "orders-sort-current"), LABELS[i], `the button names ${sort}`);
        assert.match(tag(html, "orders-sort-button"), new RegExp(`aria-label="Sort: ${LABELS[i]}"`));
        assert.match(tag(html, `orders-sort-${sort}`), /aria-current="true"/, "the sort in force is marked");
        assert.equal(count(html, /aria-current="true"/g), 1, "and only that one");
      }
    });

    it("every choice is a link that keeps the search, the filters and the report's period, and starts again at page 1", async () => {
      const html = await render({ q: "Alice", status: "awaiting_deposit", year: String(YEAR), month: "3", fy: "2025", page: "2" });
      for (const sort of ["oldest", "price_desc", "profit_asc"]) {
        const params = new URL(hrefOf(html, `orders-sort-${sort}`), "http://x").searchParams;
        assert.equal(params.get("sort"), sort);
        for (const [k, v] of [["q", "Alice"], ["status", "awaiting_deposit"], ["year", "2025"], ["month", "3"], ["fy", "2025"]]) assert.equal(params.get(k), v, `${sort} keeps ${k}`);
        assert.equal(params.get("page"), null, "a new sort starts at page 1");
      }
      assert.equal(new URL(hrefOf(html, "orders-sort-newest"), "http://x").searchParams.get("sort"), null, "the default sort is left out of the address");
    });

    it("every sort puts the rows in the database's order for it, and the six sorts give six different pages", async () => {
      const profit = "(select o2.net_payable_minor - sum(c.amount_minor) from public.orders o2 join private.order_costs c on c.order_id = o2.id and c.status = 'active' where o2.id = o.id group by o2.id)";
      const order = {
        newest: "created_at desc, id desc",
        oldest: "created_at asc, id asc",
        price_asc: "net_payable_minor asc, created_at desc, id desc",
        price_desc: "net_payable_minor desc, created_at desc, id desc",
        profit_desc: `${profit} desc nulls last, created_at desc, id desc`,
        profit_asc: `${profit} asc nulls last, created_at desc, id desc`,
      };
      const seen = new Set();
      for (const [sort, by] of Object.entries(order)) {
        const expected = idsOf(`select string_agg(id::text, ',' order by ord) from (select id, row_number() over (order by ${by}) as ord from public.orders o) x where ord <= 5`);
        assert.deepEqual(orderLinks(await render({ sort })), expected, sort);
        seen.add(expected.join());
      }
      assert.equal(seen.size, 6);
    });

    it("a profit sort in the address of a person who may not see costs falls back to the newest, with no error and no profit anywhere", async () => {
      const html = await render({ sort: "profit_desc" }, staffOpts());
      assert.equal(inner(html, "orders-sort-current"), "Newest first");
      assert.deepEqual(orderLinks(html), orderLinks(await render({}, staffOpts())));
      assert.ok(!/not allowed|permission|profit/i.test(text(html)));
    });
  });

  // =================================================================================================================
  describe("the Filter panel", () => {
    const select = (html, id) => new RegExp(`<select[^>]*data-testid="${id}"[\\s\\S]*?</select>`).exec(html)[0];

    it("is closed until clicked; it holds Status, Month, Year, From and To with Apply and Clear, and keeps the search, the sort and the report's period as hidden fields", async () => {
      const html = await render({ q: "Alice", sort: "oldest", fy: "2025", fm: "3" });
      assert.doesNotMatch(tag(html, "orders-filter-menu"), /\sopen(=|\s|>)/);
      const panel = /<form[^>]*data-testid="orders-filter-form"[\s\S]*?<\/form>/.exec(html)[0];
      for (const id of ["orders-filter-status", "orders-filter-month", "orders-filter-year", "orders-filter-from", "orders-filter-to", "orders-filter-apply", "orders-filter-clear"]) assert.ok(has(panel, id), id);
      assert.equal(count(panel, /<select/g), 3, "status, month, year");
      assert.equal(count(panel, /type="date"/g), 2, "from, to");
      for (const [name, value] of [["q", "Alice"], ["sort", "oldest"], ["fy", "2025"], ["fm", "3"]]) assert.match(panel, new RegExp(`type="hidden" name="${name}" value="${value}"`), name);
      assert.doesNotMatch(panel, /type="hidden" name="(status|month|year|from|to|page)"/, "the form's own fields are not duplicated as hidden ones, and no page is carried");
      assert.match(select(panel, "orders-filter-month"), /<option value=""[^>]*>Any<\/option><option value="1">January<\/option>[\s\S]*<option value="12">December<\/option>/);
      assert.match(select(panel, "orders-filter-status"), /<option value=""[^>]*>All statuses<\/option>[\s\S]*<option value="delivered">Delivered \/ Collected<\/option>/);
    });

    it("the Filter button counts the filters in use (status, a period, a date range) and says nothing when there are none", async () => {
      assert.ok(!has(await render(), "orders-filter-count"));
      assert.equal(inner(await render({ status: "delivered" }), "orders-filter-count"), "1");
      assert.equal(inner(await render({ year: "2025", month: "3" }), "orders-filter-count"), "1");
      assert.equal(inner(await render({ status: "delivered", month: "3", from: "2025-01-01", to: "2025-01-31" }), "orders-filter-count"), "3");
      assert.ok(!has(await render({ q: "Alice", sort: "oldest" }), "orders-filter-count"), "the search and the sort are not filters");
      assert.match(tag(await render({ status: "delivered" }), "orders-filter-button"), /aria-label="Filter, 1 in use"/);
    });

    it("no filters show the latest 5; a month and year filter by the date the order was PLACED; the choices are shown back and kept in the address", async () => {
      const march = "created_at >= timestamptz '2025-03-01 00:00+03' and created_at < timestamptz '2025-04-01 00:00+03'";
      const html = await render({ month: "3", year: String(YEAR) });
      const expected = idsOf(`select string_agg(id::text, ',' order by created_at desc, id desc) from (select id, created_at from public.orders where ${march} order by created_at desc, id desc limit 5) x`);
      assert.deepEqual(orderLinks(html), expected);
      const inMarch = Number(read(`select count(*) from public.orders where ${march}`));
      assert.equal(inner(html, "orders-summary"), `Showing 1–5 of ${inMarch} orders · placed in March 2025`);
      assert.match(select(html, "orders-filter-month"), /<option value="3" selected="">March<\/option>/);
      assert.match(select(html, "orders-filter-year"), /<option value="2025" selected="">2025<\/option>/);
      assert.ok(hrefOf(html, "orders-next").startsWith("/admin/orders?year=2025&month=3&page=2"), hrefOf(html, "orders-next"));
    });

    it("a status filter and a search reach the database too, and the summary names them", async () => {
      const html = await render({ status: "awaiting_deposit", q: "Alice" });
      const expected = idsOf(`select string_agg(x.id::text, ',' order by x.created_at desc, x.id desc) from (select o.id, o.created_at from public.orders o join public.customers c on c.id = o.customer_id where o.status = 'awaiting_deposit' and c.full_name ilike '%alice%' order by o.created_at desc, o.id desc limit 5) x`);
      assert.ok(expected.length > 0);
      assert.deepEqual(orderLinks(html), expected);
      assert.match(inner(html, "orders-summary"), /status: Awaiting deposit · matching “Alice”/);
      assert.deepEqual(orderLinks(await render({ q: "O-9999-99999" })), [], "an order number that does not exist matches nothing");
      const some = read("select order_ref from public.orders order by created_at asc limit 1");
      assert.equal(orderLinks(await render({ q: some })).length, 1, "searching an order number finds that order");
    });

    it("a custom date range is used INSTEAD of the month and year, inclusive at both ends, and the summary says so", async () => {
      const html = await render({ from: `${YEAR}-03-05`, to: `${YEAR}-03-09`, month: "1", year: String(YEAR) });
      const expected = idsOf(`select string_agg(id::text, ',' order by created_at desc, id desc) from (select id, created_at from public.orders where created_at >= timestamptz '2025-03-05 00:00+03' and created_at < timestamptz '2025-03-10 00:00+03' order by created_at desc, id desc limit 5) x`);
      assert.deepEqual(orderLinks(html), expected);
      assert.match(inner(html, "orders-summary"), /placed from 5 Mar 2025 to 9 Mar 2025 · dates are used instead of the month and year/);
      assert.equal(inner(html, "orders-filter-count"), "2", "a period and a range are two filters");
    });

    it("an invalid range is explained in words, no list is shown, and the toolbar is still there to fix it", async () => {
      const html = await render({ from: "2025-11-25", to: "2025-11-10" });
      assert.match(text(html), /The start date \(25 Nov 2025\) is after the end date \(10 Nov 2025\)/);
      assert.ok(!has(html, "orders-summary") && !has(html, "orders-pager") && count(ordersPart(html), /<tr class="group">/g) === 0);
      assert.ok(has(html, "orders-search") && has(html, "orders-filter-form"));
      assert.match(tag(html, "orders-filter-from"), /value="2025-11-25"/, "what was typed is still in the field");
      assert.match(text(await render({ from: "2025-02-30" })), /is not a real date/);
    });

    it("nothing matches: a plain empty message, no pager, and the controls are still there", async () => {
      const html = await render({ q: "zzzz no such customer" });
      assert.match(text(html), /No orders match these filters\./);
      assert.equal(inner(html, "orders-summary"), "No orders match · matching “zzzz no such customer”");
      assert.ok(!has(html, "orders-pager") && has(html, "orders-search") && has(html, "orders-filter-button"));
    });

    it("'Clear search and filters' goes back to the latest 5, keeping the sort and only the report's own choices; it is shown only when something is narrowed; the panel's Clear keeps the search", async () => {
      assert.ok(!has(await render({ sort: "oldest" }), "orders-clear"), "a sort alone narrows nothing");
      const html = await render({ q: "Alice", status: "delivered", month: "3", year: "2025", sort: "oldest", fy: "2025", fm: "3", page: "2" });
      assert.equal(hrefOf(html, "orders-clear"), "/admin/orders?fy=2025&fm=3&sort=oldest");
      assert.equal(hrefOf(html, "orders-filter-clear"), "/admin/orders?fy=2025&fm=3&q=Alice&sort=oldest");
    });

    it("Previous is disabled on page 1 and Next leads to page 2 with the same choices; page 2 has Previous back; the last page has no Next; no pager when there is one page", async () => {
      const p1 = await render({ sort: "price_desc", fy: "2025" });
      assert.match(tag(p1, "orders-prev"), /aria-disabled="true"/);
      assert.equal(inner(p1, "orders-page-of"), `Page 1 of ${Math.ceil(total / 5)}`);
      assert.equal(hrefOf(p1, "orders-next"), "/admin/orders?fy=2025&sort=price_desc&page=2");
      const p2 = await render({ sort: "price_desc", fy: "2025", page: "2" });
      assert.equal(hrefOf(p2, "orders-prev"), "/admin/orders?fy=2025&sort=price_desc");
      assert.equal(inner(p2, "orders-summary"), `Showing 6–10 of ${total} orders`);
      const last = await render({ page: String(Math.ceil(total / 5)) });
      assert.match(tag(last, "orders-next"), /aria-disabled="true"/);
      assert.ok(!has(await render({ q: "zzzz" }), "orders-pager"));
      assert.deepEqual(orderLinks(await render({ page: "9999" })), orderLinks(last), "a page past the end shows the last page");
    });
  });

  // =================================================================================================================
  describe("cost, profit and receipts (only for the people who may see them)", () => {
    const rowOf = (html, id) => new RegExp(`<tr class="group">(?:(?!</tr>)[\\s\\S])*?href="/admin/orders/${id}"[\\s\\S]*?</tr>`).exec(html)[0];
    const cells = (row) => [...row.matchAll(/<td [^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    const net = (id) => Number(read(`select net_payable_minor from public.orders where id = '${id}'`));

    it("cost and profit: a dash when no cost was entered (never zero), the figures when one was, a loss in red, 'provisional' until every cost is actual and declared complete", async () => {
      const html = await render();
      const c = (id) => cells(rowOf(html, id));
      assert.deepEqual(c(ids.n2).slice(3, 5), ["—", "—"], "no cost entry: unknown, not zero");
      assert.deepEqual(c(ids.n1).slice(3, 5), ["QAR 20,000.00", "QAR 44,800.00"], "an actual cost declared complete: a firm profit (64,800 - 20,000)");
      assert.deepEqual(c(ids.n3).slice(3, 5), ["QAR 200.00", `${qar(net(ids.n3) - 20000)} provisional`], "an estimate is provisional");
      assert.equal(cells(rowOf(html, ids.n4))[4], `${qar(net(ids.n4) - 999000)} provisional`);
      assert.ok(net(ids.n4) - 999000 < 0 && /text-error/.test(rowOf(html, ids.n4)), "a loss is a negative profit, in red");
      assert.match(rowOf(html, ids.n1), /text-success/, "a gain in green");
      assert.ok(!/provisional/.test(cells(rowOf(html, ids.n1))[4]), "a firm profit is not marked");
    });

    it("the cost and profit on the screen are the ones the order's own cost page shows", async () => {
      const html = await render();
      for (const id of [ids.n1, ids.n3, ids.n4]) {
        const summary = q(`select admin.order_costs('${id}')::text`, AS.olivia).summary;
        const row = cells(rowOf(html, id));
        assert.equal(row[3], qar(summary.recorded_cost_minor), id);
        assert.ok(row[4].startsWith(qar(summary.profit_minor)), id);
        assert.equal(row[2], qar(summary.net_revenue_minor), id);
      }
    });

    it("receipts: a small button in every row with the count, or 'Add' when there is none; the drop area is inside the panel the button opens, never in a row", async () => {
      const html = await render();
      const buttons = (id) => [...rowOf(html, id).matchAll(/<button[^>]*data-testid="receipts-button"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]));
      assert.deepEqual(buttons(ids.n2), ["2"]);
      assert.deepEqual(buttons(ids.n4), ["1"]);
      assert.deepEqual(buttons(ids.n1), ["Add"]);
      assert.match(rowOf(html, ids.n2), /aria-label="Receipts for O-[0-9A-Z-]+: 2 attached"/);
      assert.match(rowOf(html, ids.n1), /aria-label="Attach a receipt to O-[0-9A-Z-]+"/);
      // One panel and one drop area per order and view (table and phone card); no file field and no drop area exists anywhere else.
      const panels = count(html, /data-testid="receipts-panel"/g);
      assert.equal(panels, 10, "five orders, two views");
      assert.equal(count(html, /data-testid="receipt-dropzone"/g), panels);
      assert.equal(count(html, /type="file"/g), panels);
      const outsidePanels = html.replace(/<div id="receipts-[^>]*data-testid="receipts-panel">[\s\S]*?<\/form><\/div><\/div>/g, "");
      assert.ok(!/receipt-dropzone|type="file"/.test(outsidePanels), "no drop area or file field outside a panel");
    });

    it("the panel of an order lists its receipts (name, size, date) with View and Download, a Remove form with a reason, and the upload form with a drop area", async () => {
      const html = await render();
      const start = html.indexOf(`<div id="receipts-table-${ids.n2}"`);
      assert.ok(start > 0);
      const panel = html.slice(start, html.indexOf("</form></div></div>", start) + 19);
      assert.match(panel, /popover="auto"/);
      assert.match(panel, /role="dialog"/);
      assert.equal(count(panel, /data-testid="receipt-item"/g), 2);
      assert.deepEqual([...panel.matchAll(/<a [^>]*class="block truncate[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]).sort(), ["Cash receipt 0042.pdf", "Fawran transfer - deposit.pdf"]);
      for (const m of panel.matchAll(/href="(\/admin\/receipts\/[^"]*)"/g)) assert.match(m[1], /^\/admin\/receipts\/[0-9a-f-]{36}(\?download=1)?$/);
      assert.equal(count(panel, /href="\/admin\/receipts\/[0-9a-f-]{36}\?download=1"/g), 2, "Download");
      assert.equal(count(panel, /data-testid="receipt-remove"/g), 2);
      assert.equal(count(panel, /name="reason"/g), 2, "removing asks why");
      const upload = /<form[^>]*data-testid="receipt-upload-form"[\s\S]*?<\/form>/.exec(panel)[0];
      assert.match(upload, /name="order_id" value="[0-9a-f-]{36}"/);
      assert.match(upload, /name="idempotency_key" value="[0-9a-f-]{36}"/, "the upload carries the id the server chose for it");
      assert.match(upload, /<input[^>]*type="file"[^>]*accept="application\/pdf,\.pdf"/);
      assert.match(text(upload), /Drop a PDF here or click to choose PDF only, up to 4 MB Upload PDF/);
      // The trigger button opens exactly this panel; the phone card has its own, so the two ids never clash.
      // (React writes the attribute as popoverTarget; HTML attribute names are not case-sensitive, so the browser reads it as popovertarget.)
      assert.match(html, new RegExp(`popovertarget="receipts-table-${ids.n2}"`, "i"));
      assert.match(html, new RegExp(`popovertarget="receipts-card-${ids.n2}"`, "i"));
    });

    it("the Arabic file name reads correctly; an order with no receipts says so in its panel", async () => {
      const html = await render();
      assert.ok(html.includes("إيصال الدفع.pdf"));
      assert.match(text(html.slice(html.indexOf(`<div id="receipts-table-${ids.n1}"`))), /^Receipts O-[0-9A-Z-]+ No receipts attached yet\. Drop a PDF here/);
    });

    it("every order's upload form starts with its own receipt id, so two uploads are never the same request", async () => {
      const keys = [...(await render()).matchAll(/name="idempotency_key" value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
      assert.equal(keys.length, 10, "five orders, table and card");
      assert.equal(new Set(keys.slice(0, 5)).size, 5, "five different orders, five different ids");
      assert.deepEqual(keys.slice(5), keys.slice(0, 5), "the phone card of an order starts with the same id as its table row (only one of the two is on screen)");
    });

    it("a person who may not manage receipts (the database says can_manage_receipts = false) gets the list, View and Download but no upload form, no drop area and no Remove; an order with none shows a dash", async () => {
      const html = await render({}, { tweak: (answer) => ({ ...answer, can_manage_receipts: false }) });
      assert.equal(count(html, /data-testid="receipt-upload-form"/g), 0);
      assert.equal(count(html, /type="file"/g), 0);
      assert.equal(count(html, /data-testid="receipt-remove"/g), 0);
      assert.equal(count(html, /href="\/admin\/receipts\/[0-9a-f-]{36}\?download=1"/g), 6, "the three receipts, in both views, can still be opened and downloaded");
      assert.equal(cells(rowOf(html, ids.n1))[6], "—");
      assert.ok(!/data-testid="receipts-button"/.test(rowOf(html, ids.n1)));
      assert.ok(/data-testid="receipts-button"/.test(rowOf(html, ids.n2)));
    });

    it("an ordinary staff member sees none of it: no cost, profit, receipt, drop area, panel or finance word anywhere in the page, and the same orders in the same order", async () => {
      const html = await render({ sort: "price_asc" }, staffOpts());
      const owner = await render({ sort: "price_asc" });
      assert.deepEqual(orderLinks(html), orderLinks(owner));
      assert.ok(!/receipt|Receipt|dropzone|popover|type="file"|\/admin\/receipts/.test(html), "no receipt anywhere");
      assert.ok(!/profit|Profit|provisional|Provisional|Cost|cost_|margin|Margin|supplier|Net revenue|Monthly financial report/.test(html), "no cost, profit or finance word anywhere");
      assert.ok(!has(html, "financial-details") && !html.includes('id="financial-performance"') && !has(html, "period-selector"));
      assert.deepEqual(headers(html), STAFF_COLUMNS);
    });
  });

  // =================================================================================================================
  describe("the monthly financial report", () => {
    const figures = (html) => ["fin-period-title", "fin-count", "fin-net-revenue", "fin-cost", "fin-profit", "fin-margin"].map((id) => inner(html, id));

    it("is one click away BELOW the list (collapsed), opens by itself once a period was chosen in it, and keeps its selectors, five figures and January to December table", async () => {
      const plain = await render();
      assert.ok(plain.indexOf('id="orders-list"') < plain.indexOf('data-testid="financial-details"'), "the list comes first");
      assert.doesNotMatch(tag(plain, "financial-details"), /\sopen(=|\s|>)/, "collapsed by default");
      assert.equal(inner(plain, "financial-toggle"), "Monthly financial report");
      const html = await render({ fy: String(YEAR), fm: "3" });
      assert.match(tag(html, "financial-details"), /\sopen(=|\s|>)/, "open once a period was chosen");
      assert.ok(has(html, "period-selector"));
      assert.equal(inner(html, "fin-period-title"), `March ${YEAR}`);
      assert.equal(inner(html, "fin-count"), "Completed orders 1", "by COMPLETION date: placed in February, completed in March");
      assert.ok(inner(html, "fin-net-revenue").includes("3,000.00"));
      for (const id of ["fin-cost", "fin-profit", "fin-margin"]) assert.ok(has(html, id), id);
      const table = /<table[\s\S]*?<\/table>/.exec(html.slice(html.indexOf('id="financial-performance"')))[0];
      assert.equal([...table.matchAll(/<tr class="group">/g)].length, 12, "twelve month rows");
      assert.match(table, /href="\/admin\/orders\?fy=2025&amp;fm=4#financial-performance"/);
    });

    it("no choice made in the list changes a figure in the report", async () => {
      const base = figures(await render({ fy: String(YEAR), fm: "3" }));
      assert.ok(base.every((v) => v !== null));
      for (const search of [
        { q: "zzz" },
        { status: "delivered", sort: "price_desc" },
        { year: "2026", month: "11", page: "2" },
        { from: `${YEAR}-01-01`, to: `${YEAR}-01-31`, sort: "oldest" },
        { sort: "profit_desc" },
        { from: "2025-11-25", to: "2025-11-10" }, // even an invalid range
      ]) {
        assert.deepEqual(figures(await render({ fy: String(YEAR), fm: "3", ...search })), base, JSON.stringify(search));
      }
    });

    it("the report's period never filters the list, and each form carries the other's choices", async () => {
      const a = await render({ sort: "oldest", status: "awaiting_deposit" });
      const b = await render({ sort: "oldest", status: "awaiting_deposit", fy: String(YEAR), fm: "3" });
      assert.equal(text(section(a)).replace(/Page \d+ of \d+/, ""), text(section(b)).replace(/Page \d+ of \d+/, ""), "the list is the same whatever period the report shows");
      // the list's forms carry the report's choices ...
      for (const form of [/<form[^>]*data-testid="orders-search"[\s\S]*?<\/form>/, /<form[^>]*data-testid="orders-filter-form"[\s\S]*?<\/form>/]) {
        const html = form.exec(b)[0];
        assert.match(html, /type="hidden" name="fy" value="2025"/);
        assert.match(html, /type="hidden" name="fm" value="3"/);
      }
      // ... and the report's selector and month links carry the list's
      const period = /<form[^>]*data-testid="period-selector"[\s\S]*?<\/form>/.exec(b)[0];
      assert.match(period, /type="hidden" name="status" value="awaiting_deposit"/);
      assert.match(period, /type="hidden" name="sort" value="oldest"/);
      assert.match(b, /href="\/admin\/orders\?fy=2025&amp;fm=4&amp;status=awaiting_deposit&amp;sort=oldest#financial-performance"/);
      // the paging links carry the report's choices
      assert.ok(hrefOf(b, "orders-next").startsWith("/admin/orders?fy=2025&fm=3&status=awaiting_deposit&sort=oldest&page=2"), hrefOf(b, "orders-next"));
    });

    it("the Overview's links to the completed orders lead to the report section (or the delivered orders for staff without finance)", async () => {
      const overview = await import("../../src/app/admin/page.tsx");
      globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions: ownerPerms, api: { overview: async (year) => q(`select admin.overview_summary(${num(year)})::text`, AS.olivia) } };
      const owner = renderToStaticMarkup(await overview.default({ searchParams: Promise.resolve({ year: String(YEAR) }) }));
      assert.ok(!owner.includes("completed-orders"));
      assert.ok(owner.includes(`href="/admin/orders?fy=${YEAR}#financial-performance"`));
      globalThis.__M1_STAFF__ = { staff: { email: "staff@example.test" }, permissions: staffPerms, api: { overview: async (year) => q(`select admin.overview_summary(${num(year)})::text`, AS.sam) } };
      const staff = renderToStaticMarkup(await overview.default({ searchParams: Promise.resolve({ year: String(YEAR) }) }));
      assert.ok(!staff.includes("completed-orders") && !staff.includes("#financial-performance"), "staff without finance.read have no such section to be sent to");
      assert.ok(staff.includes('href="/admin/orders?status=delivered#orders-list"'));
    });
  });
});
