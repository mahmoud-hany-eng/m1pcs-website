// THE ORDERS PAGE, RENDERED FOR REAL with the database's own answers: a real PostgreSQL 16, the real migrations, the real staff functions
// (admin.list_orders_page and admin.financial_report), and the REAL page and components rendered with React's server renderer under the loader in
// support/page-render-loader.mjs (which emulates the server / client boundary). Only the sign-in is stubbed: the page runs as it does for a signed-in
// owner, and for a signed-in staff member WITHOUT the finance permissions.
//
// What is proved:
//   * the redundant "Orders completed in ..." table is gone, with its anchor, its pagination and every link that pointed at it; the Financial
//     performance section above the list is untouched (figures, January-December table, year and month selectors);
//   * the default list: the 5 newest orders, newest first, "Showing 1-5 of N orders", Previous / Next, "Page 1 of K";
//   * the layout: row 1 search and its button; row 2 month, year, from, to; row 3 status, sort, rows per page, apply, reset; then the count and the
//     table; then the pagination;
//   * every choice is kept in the address bar and shown back (month, year, dates, status, sort, size, page); a custom date range is visibly in
//     charge of the month and year; an invalid range is explained and shows no list;
//   * filtering the list never changes the report and choosing the report period never changes the list (the two carry each other's choices);
//   * a changed filter starts again at page 1 (the form carries no page); the paging links carry everything else;
//   * the price shown and sorted is what the customer has to pay; the earlier-workflow statuses still filter and display;
//   * an ordinary staff member gets the same list and none of the finance section.
import assert from "node:assert/strict";
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
const orderLinks = (html) => [...new Set(html.match(/href="\/admin\/orders\/[0-9a-f-]{36}"/g) ?? [])];
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const YEAR = 2025;

suite("the Orders page: the redundant table gone, and the list filtered, sorted and paged by the database", () => {
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
  const apiFor = (who) => ({
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    claimCodes: async () => [],
    listOrdersPage: async (o) => q(`select admin.list_orders_page(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, who),
  });
  async function render(search = {}, { who = AS.olivia, permissions = ownerPerms } = {}) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who) };
    return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(search) }));
  }
  const staffOpts = () => ({ who: AS.sam, permissions: staffPerms });
  const list = (html) => html.slice(html.indexOf('id="orders-list"'));

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
    // an order with a big gross, a discount and redeemed credit, so the amount to pay differs from the order value
    commit(`select admin.adjust_loyalty('${ID.custB}', 2000, 'points for the page test');`);
    ids.discounted = lines(
      commit(`select admin.create_order('${ID.custB}', '${JSON.stringify([{ kind: "component", description: "Big build", quantity: 1, unit_price_minor: 8_000_000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, '${JSON.stringify({ mode: "fixed", amount_minor: 1_000_000, reason: "owner discount for the page test" })}'::jsonb, 2000::bigint, null::bigint, null::bigint, null::jsonb);`),
    ).pop().trim();
    rewrite(`update public.orders set created_at = timestamptz '2025-12-20 09:00:00+03' where id = '${ids.discounted}';`);
    // one completed order, placed in February and completed in March, so the report has something to show
    ids.done = lines(commit(`select admin.create_order('${ID.custA}', '${JSON.stringify([{ kind: "component", description: "Done", quantity: 1, unit_price_minor: 300000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, null::jsonb, 0::bigint, null::bigint, null::bigint, null::jsonb);`)).pop().trim();
    commit(`select admin.transition_order('${ids.done}', 'awaiting_deposit');`);
    commit(`select admin.record_payment('${ids.done}', 'balance', 300000, 'cash');`);
    for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${ids.done}', '${to}');`);
    rewrite(`update public.orders set created_at = timestamptz '${YEAR}-02-20 09:00+03', completed_at = timestamptz '${YEAR}-03-05 10:00+03' where id = '${ids.done}';
             update private.order_completions set completed_at = timestamptz '${YEAR}-03-05 10:00+03' where order_id = '${ids.done}';`);
    total = Number(read("select count(*) from public.orders"));
    page = await import("../../src/app/admin/orders/page.tsx");
  });
  after(() => db?.stop());

  describe("the redundant completed-orders table is gone; Financial performance stays", () => {
    it("there is no 'Orders completed in ...' section, no anchor for one, and nothing links to one, with or without a month chosen", async () => {
      for (const search of [{}, { fy: String(YEAR) }, { fy: String(YEAR), fm: "3" }, { fy: String(YEAR), fm: "3", fp: "2" }, { status: "delivered", page: "2" }]) {
        const html = await render(search);
        assert.ok(!html.includes('id="completed-orders"'), JSON.stringify(search));
        assert.ok(!html.includes("completed-orders"), `no reference to the old anchor: ${JSON.stringify(search)}`);
        assert.ok(!/Orders completed in/.test(text(html)), JSON.stringify(search));
        assert.ok(!/Completed orders pages|← Newer|Older →/.test(text(html)), "its pagination is gone too");
      }
    });

    it("the Financial performance section keeps its year and month selectors, the five figures, and the January to December table, above the list", async () => {
      const html = await render({ fy: String(YEAR), fm: "3" });
      const fin = html.indexOf('id="financial-performance"');
      assert.ok(fin > -1 && fin < html.indexOf('id="orders-list"'), "Financial performance comes first");
      assert.ok(has(html, "period-selector"));
      assert.equal(inner(html, "fin-period-title"), `March ${YEAR}`);
      assert.equal(inner(html, "fin-count"), "Completed orders 1", "by COMPLETION date: placed in February, completed in March");
      assert.ok(inner(html, "fin-net-revenue").includes("3,000.00"));
      for (const id of ["fin-cost", "fin-profit", "fin-margin"]) assert.ok(has(html, id), id);
      const table = /<table[\s\S]*?<\/table>/.exec(html.slice(fin))[0];
      assert.equal([...table.matchAll(/<tr class="group">/g)].length, 12, "twelve month rows");
      // A month link changes the report only, and leads to the Financial performance section (not to a list that is gone).
      assert.match(table, /href="\/admin\/orders\?fy=2025&amp;fm=4#financial-performance"/);
    });

    it("the Overview's links to the completed orders now lead to the Financial performance section (or the delivered orders for staff without it)", async () => {
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

  describe("the default list", () => {
    it("shows exactly the 5 newest orders, newest first, with 'Showing 1–5 of N orders' and a page count", async () => {
      const html = await render({});
      assert.equal(inner(html, "orders-summary").startsWith(`Showing 1–5 of ${total} orders`), true, inner(html, "orders-summary"));
      assert.match(inner(html, "orders-summary"), /newest orders first/);
      const expected = q("select admin.list_orders_page()::text", AS.olivia).rows.map((r) => r.id);
      assert.deepEqual(orderLinks(list(html)).map((l) => /([0-9a-f-]{36})/.exec(l)[1]), [...expected], "the same 5 orders, in the database's order");
      assert.equal(orderLinks(list(html)).length, 5, "one page of five");
      assert.equal(inner(html, "orders-page-of"), `Page 1 of ${Math.ceil(total / 5)}`);
      assert.equal(inner(html, "orders-sort-note"), "Sorted: Newest orders first");
      // The newest order is first in the table.
      const newestRef = read("select order_ref from public.orders order by created_at desc, id desc limit 1");
      assert.ok(text(list(html).slice(list(html).indexOf("<tbody"))).startsWith(newestRef) || text(list(html)).indexOf(newestRef) < text(list(html)).indexOf(read(`select order_ref from public.orders order by created_at desc, id desc limit 1 offset 1`)));
    });

    it("Previous is disabled on page 1 and Next leads to page 2 with the same choices; page 2 has Previous back to page 1", async () => {
      const html = await render({});
      assert.match(tag(html, "orders-prev"), /aria-disabled="true"/);
      assert.equal(hrefOf(html, "orders-next"), "/admin/orders?page=2#orders-list");
      const second = await render({ page: "2" });
      assert.equal(inner(second, "orders-summary").startsWith(`Showing 6–10 of ${total} orders`), true);
      assert.equal(hrefOf(second, "orders-prev"), "/admin/orders#orders-list", "page 1 is the default and is left out of the address");
      assert.equal(hrefOf(second, "orders-next"), "/admin/orders?page=3#orders-list");
      const lastPageNumber = Math.ceil(total / 5);
      const last = await render({ page: String(lastPageNumber) });
      assert.match(tag(last, "orders-next"), /aria-disabled="true"/, "no Next on the last page");
      const beyond = await render({ page: "9999" });
      assert.equal(inner(beyond, "orders-page-of"), `Page ${lastPageNumber} of ${lastPageNumber}`, "a page past the end shows the last page");
    });

    it("the rows follow the sort chosen: each of the four sorts puts the orders in the database's order for it, and the four orders differ", async () => {
      const seen = [];
      for (const sort of ["newest", "oldest", "price_asc", "price_desc"]) {
        const html = await render(sort === "newest" ? {} : { sort });
        const expected = q(`select admin.list_orders_page(null, null, null, null, null, null, '${sort}', 1, 5)::text`, AS.olivia).rows.map((r) => r.id);
        const shown = orderLinks(list(html)).map((l) => /([0-9a-f-]{36})/.exec(l)[1]);
        assert.deepEqual(shown, expected, `the rows are in the ${sort} order`);
        seen.push(shown.join());
      }
      assert.equal(new Set(seen).size, 4, "the four sorts really are four different orders in this data, so this test can tell them apart");
    });

    it("every visible sort label names the sort that was actually chosen, never a fixed phrase: the summary line and the 'Sorted:' note under each of the four sorts", async () => {
      const SORTS = [
        ["newest", "Newest orders first", "newest"],
        ["oldest", "Oldest orders first", "oldest"],
        ["price_asc", "Lowest order price first", "lowest"],
        ["price_desc", "Highest order price first", "highest"],
      ];
      for (const [sort, label, word] of SORTS) {
        const html = await render(sort === "newest" ? {} : { sort });
        assert.equal(inner(html, "orders-summary-order"), `· ${label.toLowerCase()}`, `${sort}: the summary line says how the list is ordered`);
        assert.equal(inner(html, "orders-sort-note").startsWith(`Sorted: ${label}`), true, `${sort}: the note says the same`);
        const line = inner(html, "orders-summary-line");
        for (const [, , other] of SORTS) assert.equal(new RegExp(other, "i").test(line), other === word, `${sort}: the line names "${word}" and none of the other three (${line})`);
      }
    });

    it("under each of the four sorts the count and the page labels stay true on the first, second and last page, and the paging links keep the sort", async () => {
      const pages = Math.ceil(total / 5);
      assert.ok(pages >= 3, "enough orders for a first, a second and a last page");
      for (const sort of ["newest", "oldest", "price_asc", "price_desc"]) {
        const choice = (extra = {}) => ({ ...(sort === "newest" ? {} : { sort }), ...extra });
        for (const n of [1, 2, pages]) {
          const where = `${sort}, page ${n}`;
          const html = await render(choice(n === 1 ? {} : { page: String(n) }));
          assert.equal(inner(html, "orders-summary").startsWith(`Showing ${(n - 1) * 5 + 1}–${Math.min(n * 5, total)} of ${total} orders`), true, `${where}: ${inner(html, "orders-summary")}`);
          assert.equal(inner(html, "orders-page-of"), `Page ${n} of ${pages}`, where);
          const sortOf = (href) => new URLSearchParams(href.split("?")[1]?.split("#")[0] ?? "").get("sort");
          const expectedSort = sort === "newest" ? null : sort;
          if (n < pages) {
            const next = hrefOf(html, "orders-next");
            assert.equal(new URLSearchParams(next.split("?")[1].split("#")[0]).get("page"), String(n + 1), `${where}: Next goes to the next page`);
            assert.equal(sortOf(next), expectedSort, `${where}: Next keeps the sort`);
          } else assert.match(tag(html, "orders-next"), /aria-disabled="true"/, `${where}: no Next on the last page`);
          if (n > 1) assert.equal(sortOf(hrefOf(html, "orders-prev")), expectedSort, `${where}: Previous keeps the sort`);
        }
        const wide = await render(choice({ size: "25" }));
        assert.equal(inner(wide, "orders-summary").startsWith(`Showing 1–25 of ${total} orders`), true, `${sort}: 25 per page`);
      }
    });

    it("with filters chosen the summary names the filters, the 'Sorted:' note still names the sort, and the counts are the database's", async () => {
      const awaiting = Number(read("select count(*) from public.orders where status = 'awaiting_deposit'"));
      assert.ok(awaiting > 5, "enough awaiting-deposit orders to need a second page");
      for (const [sort, label] of [["oldest", "Oldest orders first"], ["price_desc", "Highest order price first"], ["price_asc", "Lowest order price first"]]) {
        const html = await render({ status: "awaiting_deposit", sort });
        assert.equal(inner(html, "orders-summary").startsWith(`Showing 1–5 of ${awaiting} orders`), true, `${sort}: ${inner(html, "orders-summary")}`);
        assert.match(inner(html, "orders-summary"), /status: Awaiting deposit/);
        assert.equal(has(html, "orders-summary-order"), false, `${sort}: with filters the summary names them, and the sort is named once, in the note`);
        assert.equal(inner(html, "orders-sort-note").startsWith(`Sorted: ${label}`), true, sort);
        assert.equal(inner(html, "orders-page-of"), `Page 1 of ${Math.ceil(awaiting / 5)}`, sort);
      }
    });

    it("every other choice reaches the database too: a status, a month with a year, a range and a page size change the rows", async () => {
      const rowsFor = async (search) => orderLinks(list(await render(search))).map((l) => /([0-9a-f-]{36})/.exec(l)[1]);
      const expectFor = (a) => q(`select admin.list_orders_page(${lit(a.search ?? null)}, ${lit(a.status ?? null)}, ${num(a.year)}, ${num(a.month)}, ${lit(a.from ?? null)}::date, ${lit(a.to ?? null)}::date, ${lit(a.sort ?? "newest")}, ${a.page ?? 1}, ${a.size ?? 5})::text`, AS.olivia).rows.map((r) => r.id);
      assert.deepEqual(await rowsFor({ status: "awaiting_deposit" }), expectFor({ status: "awaiting_deposit" }));
      assert.deepEqual(await rowsFor({ year: String(YEAR), month: "3" }), expectFor({ year: YEAR, month: 3 }));
      assert.deepEqual(await rowsFor({ from: `${YEAR}-03-10`, to: `${YEAR}-03-20`, sort: "oldest" }), expectFor({ from: `${YEAR}-03-10`, to: `${YEAR}-03-20`, sort: "oldest" }));
      assert.deepEqual(await rowsFor({ q: "Alice", size: "10", page: "2" }), expectFor({ search: "Alice", size: 10, page: 2 }));
      assert.equal((await rowsFor({ size: "25" })).length, 25);
      assert.notDeepEqual(await rowsFor({ status: "awaiting_deposit" }), await rowsFor({}), "so the status really changed the rows");
    });

    it("the price column is what the customer has to PAY, with the order value shown as 'was' when a discount or credit was taken off", async () => {
      const html = await render({ sort: "price_desc" });
      const row = list(html);
      assert.match(row, /Order price/);
      assert.ok(!/<th[^>]*>\s*Total\s*<\/th>/.test(row), "the column is no longer called Total");
      const top = text(row);
      assert.ok(top.includes("69,800.00"), `payable 80,000.00 - 10,000.00 - 200.00 = 69,800.00 is the price shown: ${top.slice(0, 400)}`);
      assert.ok(/69,800\.00 was QAR 80,000\.00|69,800\.00 was 80,000\.00|69,800\.00 was.{0,12}80,000\.00/.test(top), "and the order value is shown as 'was'");
    });
  });

  describe("the layout and the choices", () => {
    it("is arranged in rows: search and its button; month, year, from, to; status, sort, rows per page, apply and reset; then the count and the table", async () => {
      const html = await render({});
      const inList = list(html); // (the Financial performance section above has a table of its own)
      const at = (needle) => {
        const i = inList.indexOf(needle);
        assert.ok(i > -1, needle);
        return i;
      };
      const order = ['data-testid="orders-filters"', 'data-testid="orders-row-search"', 'id="orders-search"', 'data-testid="orders-row-dates"', 'id="orders-month"', 'id="orders-year"', 'id="orders-from"', 'id="orders-to"', 'data-testid="orders-row-controls"', 'id="orders-status"', 'id="orders-sort"', 'id="orders-size"', 'data-testid="orders-apply"', 'data-testid="orders-reset"', 'data-testid="orders-summary"', "<table", 'data-testid="orders-pagination"'];
      const positions = order.map(at);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the controls, the count, the table and the pagination come in that order");
      assert.match(html, /placeholder="Search by order number or customer"/);
      assert.ok(html.indexOf('id="financial-performance"') < html.indexOf('data-testid="orders-row-search"'), "the list's controls come after the Financial performance section");
      // one form: every control submits together, and the form carries no page number, so a change always starts again at page 1
      const form = /<form[^>]*data-testid="orders-filters"[\s\S]*?<\/form>/.exec(html)[0];
      assert.match(form, /method="get"/);
      assert.match(form, /action="\/admin\/orders#orders-list"/);
      assert.ok(!/name="page"/.test(form), "no page field: filtering or sorting goes back to page 1");
      for (const name of ["q", "month", "year", "from", "to", "status", "sort", "size"]) assert.match(form, new RegExp(`name="${name}"`), name);
      assert.equal((form.match(/type="submit"/g) ?? []).length, 2, "Search (row 1) and Apply filters (row 3) both submit the one form");
    });

    it("the month list is All months then January to December, the year list is All years then the years with orders, and the sort and size lists are as asked (5 first and the default)", async () => {
      const html = await render({});
      const select = (id) => [...(/<select id="${id}"[\s\S]*?<\/select>/.exec(html.replace(`<select id="${id}"`, `<select id="${id}"`))?.[0] ?? "").matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
      const grab = (id) => {
        const start = html.indexOf(`<select id="${id}"`);
        const block = html.slice(start, html.indexOf("</select>", start));
        return [...block.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], /selected/.test(m[2])]);
      };
      void select;
      const month = grab("orders-month");
      assert.deepEqual(month.map((o) => o[1]), ["All months", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
      const years = grab("orders-year");
      assert.equal(years[0][1], "All years");
      assert.ok(years.slice(1).map((o) => o[1]).includes(String(YEAR)), "the year orders were placed in is offered");
      const sort = grab("orders-sort");
      assert.deepEqual(sort.map((o) => o[1]), ["Newest orders first", "Oldest orders first", "Lowest order price first", "Highest order price first"]);
      assert.equal(sort.find((o) => o[2])?.[0], "newest", "newest first is the default");
      const size = grab("orders-size");
      assert.deepEqual(size.map((o) => o[0]), ["5", "10", "25"]);
      assert.equal(size.find((o) => o[2])?.[0], "5", "5 per page is the default");
      const status = grab("orders-status");
      assert.equal(status.length, 18, "every status, including the two that only the earlier workflow uses");
      assert.ok(status.some((o) => /earlier workflow/.test(o[1])));
    });

    it("every choice made is shown back and kept in the address: month, year, status, sort, size, search", async () => {
      const search = { q: "Alice", status: "awaiting_deposit", year: String(YEAR), month: "3", sort: "price_asc", size: "10" };
      const html = await render(search);
      const form = /<form[^>]*data-testid="orders-filters"[\s\S]*?<\/form>/.exec(html)[0];
      assert.match(form, /name="q"[^>]*value="Alice"|value="Alice"[^>]*name="q"/);
      for (const [id, value] of [["orders-month", "3"], ["orders-year", String(YEAR)], ["orders-status", "awaiting_deposit"], ["orders-sort", "price_asc"], ["orders-size", "10"]]) {
        const start = form.indexOf(`<select id="${id}"`);
        const block = form.slice(start, form.indexOf("</select>", start));
        assert.match(block, new RegExp(`<option value="${value}"[^>]*selected`), `${id} shows ${value}`);
      }
      assert.match(inner(html, "orders-summary"), /placed in March 2025/);
      assert.match(inner(html, "orders-summary"), /status: Awaiting deposit/);
      assert.match(inner(html, "orders-summary"), /matching “Alice”/);
      assert.equal(inner(html, "orders-sort-note"), "Sorted: Lowest order price first (what the customer has to pay)");
      // the paging links carry all of it
      const next = hrefOf(await render({ ...search, size: "5" }), "orders-next");
      if (next) {
        const params = new URLSearchParams(next.split("?")[1].split("#")[0]);
        assert.equal(params.get("status"), "awaiting_deposit");
        assert.equal(params.get("sort"), "price_asc");
        assert.equal(params.get("month"), "3");
        assert.equal(params.get("year"), String(YEAR));
        assert.equal(params.get("q"), "Alice");
        assert.equal(params.get("page"), "2");
      }
    });

    it("a month chosen with no year is the current Qatar year, and the year list shows it selected", async () => {
      const html = await render({ month: "6" });
      const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric" }).format(new Date());
      const start = html.indexOf('<select id="orders-year"');
      const block = html.slice(start, html.indexOf("</select>", start));
      assert.match(block, new RegExp(`<option value="${year}"[^>]*selected`));
      assert.match(inner(html, "orders-summary"), new RegExp(`June ${year}|No orders match`));
    });

    it("a custom date range is shown as in charge: the month and year are marked ignored, the range is highlighted, and the sentence says custom dates are used", async () => {
      const html = await render({ year: String(YEAR), month: "3", from: `${YEAR}-03-05`, to: `${YEAR}-03-20` });
      assert.match(tag(html, "orders-period"), /data-overridden="true"/);
      assert.match(tag(html, "orders-range"), /data-active="true"/);
      assert.match(text(html), /Placed in · ignored/);
      assert.match(inner(html, "orders-period-hint"), /^Ignored while custom dates are set\.$/);
      assert.match(text(html), /Or between two dates · in use/);
      assert.match(inner(html, "orders-range-hint"), /A date range takes precedence over the month and year\./);
      assert.match(inner(html, "orders-summary"), /placed from 5 Mar 2025 to 20 Mar 2025/);
      assert.match(inner(html, "orders-sort-note"), /custom dates are used instead of the month and year/);
      assert.match(inner(html, "orders-range-hint"), /Both days are included \(Qatar time\)/);
      const plain = await render({ year: String(YEAR), month: "3" });
      assert.match(tag(plain, "orders-period"), /data-overridden="false"/);
      assert.match(tag(plain, "orders-range"), /data-active="false"/);
      assert.ok(!/ignored/i.test(text(plain)) && !/in use/.test(text(plain)));
      assert.match(inner(plain, "orders-period-hint"), /A month with no year means that month of the current year/);
      // an open-ended range counts as a range
      const open = await render({ from: `${YEAR}-12-01` });
      assert.match(tag(open, "orders-range"), /data-active="true"/);
      assert.match(inner(open, "orders-summary"), /placed on or after 1 Dec 2025/);
    });

    it("an invalid range is explained in words, no list is shown, and the controls still hold what was typed so it can be fixed", async () => {
      const html = await render({ from: "2025-11-25", to: "2025-11-10", status: "delivered" });
      assert.match(text(html), /The start date \(25 Nov 2025\) is after the end date \(10 Nov 2025\)\. Swap them, or change one of them\./);
      assert.ok(!has(html, "orders-summary") && !has(html, "orders-pagination") && !list(html).includes("<table"), "no list for a range that cannot be read");
      assert.match(html, /id="orders-from"[^>]*value="2025-11-25"|value="2025-11-25"[^>]*id="orders-from"/);
      assert.match(html, /id="orders-to"[^>]*value="2025-11-10"|value="2025-11-10"[^>]*id="orders-to"/);
      const notReal = await render({ from: "2025-02-30" });
      assert.match(text(notReal), /“2025-02-30” is not a real date/);
      assert.ok(has(await render({}), "orders-summary"), "and a fine address shows the list again");
    });

    it("Reset filters goes to the plain list, keeping only the report's own choices", async () => {
      assert.equal(hrefOf(await render({ q: "x", status: "delivered", sort: "oldest", size: "25", month: "3", year: String(YEAR), page: "2" }), "orders-reset"), "/admin/orders#orders-list");
      assert.equal(hrefOf(await render({ fy: String(YEAR), fm: "3", q: "x", sort: "oldest", from: "2025-01-01" }), "orders-reset"), `/admin/orders?fy=${YEAR}&fm=3#orders-list`);
    });

    it("nothing matches: a plain empty message, no pagination, and the filters are still there to change", async () => {
      const html = await render({ q: "no such customer anywhere" });
      assert.equal(inner(html, "orders-summary").startsWith("No orders match"), true);
      assert.match(text(html), /No orders match these filters\./);
      assert.ok(!has(html, "orders-pagination"));
      assert.ok(has(html, "orders-filters"));
    });

    it("an earlier-workflow status still filters, and its orders still say 'Earlier workflow'; searching an order number finds that order; every row leads to its order page", async () => {
      const early = await render({ status: "sourcing" });
      assert.match(inner(early, "orders-summary"), /Showing 1–1 of 1 order/);
      assert.match(text(list(early)), /Sourcing/);
      assert.match(text(list(early)), /Earlier workflow/);
      const ref = read("select order_ref from public.orders order by created_at desc limit 1");
      const found = await render({ q: ref });
      assert.match(inner(found, "orders-summary"), /Showing 1–1 of 1 order/);
      assert.equal(orderLinks(list(found)).length, 1);
      assert.ok(orderLinks(list(found))[0].includes("/admin/orders/"), "the row leads to the order page");
    });
  });

  describe("the list and the financial report do not interfere with each other", () => {
    const figures = (html) => ["fin-period-title", "fin-count", "fin-net-revenue", "fin-cost", "fin-profit", "fin-margin"].map((id) => inner(html, id));

    it("no choice made in the list changes a figure in the Financial performance section", async () => {
      const base = figures(await render({ fy: String(YEAR), fm: "3" }));
      assert.ok(base.every((v) => v !== null));
      for (const search of [
        { q: "zzz" },
        { status: "delivered", sort: "price_desc" },
        { year: "2026", month: "11", size: "25", page: "2" },
        { from: `${YEAR}-01-01`, to: `${YEAR}-01-31`, sort: "oldest" },
        { from: "2025-11-25", to: "2025-11-10" }, // even an invalid range
      ]) {
        assert.deepEqual(figures(await render({ fy: String(YEAR), fm: "3", ...search })), base, JSON.stringify(search));
      }
    });

    it("the report's period never filters the list, and each form carries the other's choices", async () => {
      const a = await render({ sort: "oldest", status: "awaiting_deposit" });
      const b = await render({ sort: "oldest", status: "awaiting_deposit", fy: String(YEAR), fm: "3" });
      assert.equal(text(list(a)).replace(/Page \d+ of \d+/, ""), text(list(b)).replace(/Page \d+ of \d+/, ""), "the list is the same whatever period the report shows");
      // the list's form carries the report's choices ...
      const filters = /<form[^>]*data-testid="orders-filters"[\s\S]*?<\/form>/.exec(b)[0];
      assert.match(filters, /type="hidden" name="fy" value="2025"/);
      assert.match(filters, /type="hidden" name="fm" value="3"/);
      // ... and the report's selector and month links carry the list's
      const period = /<form[^>]*data-testid="period-selector"[\s\S]*?<\/form>/.exec(b)[0];
      assert.match(period, /type="hidden" name="status" value="awaiting_deposit"/);
      assert.match(period, /type="hidden" name="sort" value="oldest"/);
      assert.match(b, /href="\/admin\/orders\?fy=2025&amp;fm=4&amp;status=awaiting_deposit&amp;sort=oldest#financial-performance"/);
      // the paging links carry the report's choices
      assert.ok(hrefOf(b, "orders-next").startsWith("/admin/orders?fy=2025&fm=3&status=awaiting_deposit&sort=oldest&page=2"), hrefOf(b, "orders-next"));
    });
  });

  describe("an ordinary staff member (no finance permission)", () => {
    it("gets the same list, filters, sort and paging, and none of the finance section", async () => {
      const html = await render({ sort: "price_asc", month: "3", year: String(YEAR) }, staffOpts());
      assert.ok(!html.includes('id="financial-performance"') && !has(html, "fin-profit") && !has(html, "period-selector"));
      assert.ok(has(html, "orders-filters") && has(html, "orders-summary") && has(html, "orders-pagination"));
      assert.match(inner(html, "orders-summary"), /placed in March 2025/);
      assert.ok(!/Direct cost|Order profit|Margin|Net revenue|Costs complete|Costs incomplete|No costs recorded/.test(text(html)), "no finance word anywhere");
      const owner = await render({ sort: "price_asc", month: "3", year: String(YEAR) });
      assert.equal(orderLinks(list(html)).join(), orderLinks(list(owner)).join(), "the same orders, in the same order");
    });
  });
});
