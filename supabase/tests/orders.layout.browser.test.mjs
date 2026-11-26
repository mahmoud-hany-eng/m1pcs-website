// THE SIMPLIFIED ORDERS PAGE IN A REAL BROWSER, at a desktop (1280), a laptop (1024), a tablet (768) and a phone (390 and 360) width. The page is the real
// page, drawn with data from the real database functions (the same loader and sign-in stub as orders.pages.db.test.mjs) and styled with the website's own
// compiled stylesheet from a real production build. The staff dashboard needs a real second factor (see WORKFLOW_TESTS.md), so the page is not reached
// through a login; its markup and CSS are what is checked here, and the menus and the receipts panel are operated by real clicks and key presses.
//
// What it proves: the screen is a search field, a Sort button and a Filter button above the table (cards below 1280px); nothing scrolls sideways in any
// state, with any menu or panel open; every control is readable and tappable; the Sort and Filter menus open ON TOP of the table without moving it, are
// opaque, stay inside the screen, and only one is open at a time; a press outside or Escape closes them (the page's own behaviour script, run for real);
// the receipts button opens a compact centred panel (list, view, download, remove, drop area) that closes with its button, Escape or a press outside;
// the drop area is the browser's own file field stretched over the zone; the monthly report is collapsed below the list; an ordinary staff member gets four
// columns and none of the finance controls. When M1_SCREENSHOT_DIR is set, screenshots are written for the owner's visual review.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, ROOT } from "./support/browser.mjs";
import { lines, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const playwright = loadPlaywright();
const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const skip = !playwright ? "Playwright is not installed (it is not a project dependency); CI installs a pinned copy" : !haveServer ? "no PostgreSQL server programs" : false;
const suite = skip ? describe.skip : describe;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;
const T = (id) => `[data-testid="${id}"]`;
const pdf = (seed) => `\\x${Buffer.from(`%PDF-1.4\n% ${seed}\n%%EOF\n`).toString("hex")}`;

// The page's own behaviour script for the menus (src/lib/menu-dismiss.ts), compiled and run in the page exactly as the browser runs it.
const DISMISS = `${ts.transpileModule(readFileSync(join(ROOT, "src/lib/menu-dismiss.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText.replace(/^export /m, "")}\nwindow.__dismiss = attachMenuDismiss(document);`;

suite("the simplified Orders page in a real browser: desktop, laptop, tablet and phone widths", { skip }, () => {
  let db;
  let browser;
  let css = "";
  let ownerPerms;
  let staffPerms;
  let page;
  const html = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const apiFor = (who) => ({
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    claimCodes: async () => [],
    listOrdersOverview: async (o) => q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, who),
  });
  async function draw(search, who = AS.olivia, permissions = ownerPerms) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who) };
    return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(search) }));
  }
  const document = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;

  before(async () => {
    ensureBuild();
    const cssDir = join(ROOT, ".next", "static", "css");
    css = readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n");
    assert.ok(css.length > 10_000, "the compiled stylesheet was found");
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    staffPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.sam)));
    commit(`do $$ declare i integer; begin
      for i in 1..14 loop
        perform admin.create_order(case when i % 2 = 0 then '${ID.custA}'::uuid else '${ID.custB}'::uuid end,
          jsonb_build_array(jsonb_build_object('kind', 'component', 'description', 'Item ' || i, 'quantity', 1, 'unit_price_minor', 250000 + i * 37000)),
          null::uuid, 'admin'::text, null::text, null::text, null::text, null::jsonb, 0::bigint, null::bigint, null::bigint, null::jsonb);
      end loop; end $$;`);
    rewrite(`with n as (select id, row_number() over (order by order_ref) as i from public.orders)
             update public.orders o set created_at = timestamptz '2025-03-01 09:00:00+03' + (n.i * interval '37 hours'),
                    status = case when n.i % 4 = 0 then 'awaiting_deposit' else o.status end from n where n.id = o.id;`);
    commit(`select admin.adjust_loyalty('${ID.custB}', 2000, 'points for the layout test');`);
    commit(`select admin.create_order('${ID.custB}', '${JSON.stringify([{ kind: "component", description: "Big build", quantity: 1, unit_price_minor: 8_000_000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, '${JSON.stringify({ mode: "fixed", amount_minor: 1_500_000, reason: "owner discount for the layout test" })}'::jsonb, 2000::bigint, null::bigint, null::bigint, null::jsonb);`);
    // The five newest orders get realistic cost and receipt data: a firm profit, no cost, an estimate, a loss, and receipts (two on one, one with an Arabic name).
    const newest = read("select string_agg(id::text, ',' order by created_at desc, id desc) from (select id, created_at from public.orders order by created_at desc, id desc limit 5) x").split(",");
    commit(`select admin.add_order_cost('${newest[0]}', '${randomUUID()}', 'components', 'Parts', 2000000, 'actual', null, null, null);
            select admin.set_order_costs_complete('${newest[0]}', true, null);
            select admin.add_order_cost('${newest[2]}', '${randomUUID()}', 'components', 'Parts', 120000, 'estimated', null, null, null);
            select admin.add_order_cost('${newest[3]}', '${randomUUID()}', 'components', 'Parts', 1500000, 'actual', null, null, null);
            select admin.add_order_receipt('${newest[1]}', '${randomUUID()}', 'Fawran transfer - deposit 35 percent - 12 Nov 2026 - long file name to test wrapping.pdf', '${pdf("a")}'::bytea);
            select admin.add_order_receipt('${newest[1]}', '${randomUUID()}', 'Cash receipt 0042.pdf', '${pdf("b")}'::bytea);
            select admin.add_order_receipt('${newest[3]}', '${randomUUID()}', 'إيصال الدفع.pdf', '${pdf("c")}'::bytea);`);
    page = await import("../../src/app/admin/orders/page.tsx");
    html.plain = document(await draw({}));
    html.sorted = document(await draw({ sort: "profit_desc" })); // a non-default sort and no filter
    html.filtered = document(await draw({ year: "2025", month: "3", status: "awaiting_deposit", sort: "oldest", q: "Alice" }));
    html.range = document(await draw({ year: "2025", month: "3", from: "2025-03-05", to: "2025-03-20", sort: "oldest" }));
    html.invalid = document(await draw({ from: "2025-11-25", to: "2025-11-10" }));
    html.empty = document(await draw({ q: "zzzz no such customer" }));
    html.report = document(await draw({ fy: "2025", fm: "3" }));
    html.staff = document(await draw({}, AS.sam, staffPerms));
    browser = await playwright.chromium.launch({ args: ["--no-sandbox"] });
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    db?.stop();
  });

  const WIDTHS = [
    ["desktop", { width: 1280, height: 900 }],
    ["laptop", { width: 1024, height: 768 }],
    ["tablet", { width: 768, height: 1024 }],
    ["phone", { width: 390, height: 844 }],
    ["small-phone", { width: 360, height: 740 }],
  ];
  async function open(name, viewport, { script = false } = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p = await context.newPage();
    await p.setContent(html[name], { waitUntil: "load" });
    if (script) await p.addScriptTag({ content: DISMISS });
    return { page: p, close: () => context.close() };
  }
  const box = async (p, selector) => {
    const b = await p.locator(selector).first().boundingBox();
    assert.ok(b, `${selector} is on the page and visible`);
    return b;
  };
  const sideways = (p) => p.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, shell: Math.max(0, ...[...document.querySelectorAll(".admin-root")].map((el) => el.scrollWidth - el.clientWidth)) }));
  const isOpen = (p, selector) => p.locator(selector).first().evaluate((el) => el.open === true);
  const popoverOpen = (p, id) => p.evaluate((x) => document.getElementById(x).matches(":popover-open"), id);
  /** The topmost element at the middle of `selector` belongs to `selector` (nothing covers it, nothing clips it). */
  const onTop = (p, selector) =>
    p.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit) && el.contains(hit);
    });
  const inside = (b, viewport, label) => {
    assert.ok(b.x >= -0.5 && b.x + b.width <= viewport.width + 0.5, `${label} is inside the screen (x ${Math.round(b.x)}, width ${Math.round(b.width)} of ${viewport.width})`);
  };

  for (const [label, viewport] of WIDTHS) {
    describe(`${label} (${viewport.width}px)`, () => {
      it("nothing scrolls sideways, in any state of the page (and any menu or panel open)", async () => {
        for (const name of ["plain", "sorted", "filtered", "range", "invalid", "empty", "report", "staff"]) {
          const { page: p, close } = await open(name, viewport);
          try {
            const x = await sideways(p);
            assert.ok(x.page <= 0 && x.shell <= 0, `${name} at ${viewport.width}px scrolls sideways (${JSON.stringify(x)})`);
            if (name === "plain") {
              for (const menu of ["orders-sort-button", "orders-filter-button"]) {
                await p.locator(T(menu)).click();
                const open = await sideways(p);
                assert.ok(open.page <= 0 && open.shell <= 0, `${menu} open scrolls sideways (${JSON.stringify(open)})`);
              }
              await p.locator(T("orders-filter-button")).click(); // close it again (it covers the rows)
              await p.locator(T("receipts-button")).filter({ visible: true }).first().click();
              const withPanel = await sideways(p);
              assert.ok(withPanel.page <= 0 && withPanel.shell <= 0, `the receipts panel open scrolls sideways (${JSON.stringify(withPanel)})`);
            }
          } finally {
            await close();
          }
        }
      });

      it("above the table: the search field, then the Sort and Filter buttons; the table or cards, then the pager, then the collapsed report", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const b = {
            search: await box(p, "#orders-search-q"),
            searchButton: await box(p, `${T("orders-search")} button`),
            sort: await box(p, T("orders-sort-button")),
            filter: await box(p, T("orders-filter-button")),
            summary: await box(p, T("orders-summary-line")),
            pager: await box(p, T("orders-pager")),
            report: await box(p, T("financial-toggle")),
          };
          for (const [k, x] of Object.entries(b)) inside(x, viewport, k);
          const bottom = (x) => x.y + x.height;
          const middle = (x) => x.y + x.height / 2;
          if (viewport.width >= 640) {
            for (const k of ["searchButton", "sort", "filter"]) assert.ok(Math.abs(middle(b[k]) - middle(b.search)) < 8, `${k} shares a row with the search field`);
            assert.ok(b.search.width >= 240, `the search field is a real field (${Math.round(b.search.width)}px)`);
            assert.ok(b.sort.x > b.search.x + b.search.width - 1 && b.filter.x > b.sort.x, "search, then Sort, then Filter, left to right");
          } else {
            assert.ok(b.sort.y >= bottom(b.search) - 1 && b.filter.y >= bottom(b.search) - 1, "on a phone Sort and Filter are on the row under the search field");
            assert.ok(Math.abs(b.sort.y - b.filter.y) < 6 && b.filter.x > b.sort.x, "side by side");
            assert.ok(b.search.width >= 240, `the search field is wide on a phone (${Math.round(b.search.width)}px)`);
          }
          for (const k of ["search", "searchButton", "sort", "filter"]) assert.ok(b[k].height >= 40, `${k} is tall enough to tap (${Math.round(b[k].height)}px)`);
          assert.ok(b.sort.width >= 64 && b.filter.width >= 64);
          const rows = await p.evaluate(() => {
            const y = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().top);
            return { table: y("#orders-list table tbody tr"), cards: y("#orders-list > ul > li") };
          });
          const rowsY = viewport.width >= 1280 ? rows.table : rows.cards;
          assert.equal(rowsY.length, 5, `the latest five orders (${viewport.width >= 1280 ? "table" : "cards"})`);
          assert.ok(Math.min(...rowsY) >= bottom(b.summary) - 1, "the orders come after the count");
          assert.ok(b.pager.y >= Math.max(...rowsY), "the pager is below the orders");
          assert.ok(b.report.y >= bottom(b.pager) - 1, "the monthly report toggle is below the list");
          assert.ok(!(await isOpen(p, T("financial-details"))), "and collapsed");
        } finally {
          await close();
        }
      });

      it("the orders are a table from 1280px with seven columns that all fit, and cards below it; the order number is a link in both", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const shown = await p.evaluate(() => ({
            table: [...document.querySelectorAll("#orders-list table")].some((el) => el.getClientRects().length > 0),
            cards: [...document.querySelectorAll("#orders-list > ul > li")].some((el) => el.getClientRects().length > 0),
          }));
          if (viewport.width >= 1280) {
            assert.deepEqual(shown, { table: true, cards: false }, "a table beside the sidebar from 1280px");
            const cols = await p.locator("#orders-list table th").evaluateAll((els) => els.map((el) => ({ text: el.innerText.trim(), width: el.getBoundingClientRect().width })));
            assert.deepEqual(cols.map((c) => c.text.toUpperCase()), ["ORDER", "CUSTOMER", "ORDER PRICE", "COST", "PROFIT", "PLACED", "RECEIPTS"]);
            for (const c of cols) assert.ok(c.width >= 60, `${c.text} is wide enough (${Math.round(c.width)}px)`);
            const cut = await p.evaluate(() => [...document.querySelectorAll("#orders-list .overflow-x-auto")].filter((el) => el.getClientRects().length > 0).map((el) => el.scrollWidth - el.clientWidth));
            for (const overflow of cut) assert.ok(overflow <= 1, `the table is ${overflow}px wider than the room it has`);
            const wrapped = await p.locator("#orders-list table tbody tr").first().evaluate((row) => [...row.children].map((c) => c.getBoundingClientRect().height));
            assert.ok(Math.max(...wrapped) <= 90, `a row stays compact (${Math.round(Math.max(...wrapped))}px)`);
          } else {
            assert.deepEqual(shown, { table: false, cards: true }, "one card per order below 1280px");
            const card = await p.locator("#orders-list > ul > li").first().innerText();
            for (const word of ["Customer", "Order price", "Cost", "Profit", "Placed", "Receipts"]) assert.match(card.toUpperCase(), new RegExp(word.toUpperCase()), `the card shows ${word}`);
          }
          const link = await p.locator("#orders-list a[href^='/admin/orders/']").filter({ visible: true }).first();
          assert.match(await link.innerText(), /^O-\d{4}-\d{5}$/);
          const b = await link.boundingBox();
          assert.ok(b.height >= 14 && b.width >= 60, `the order number is a readable link (${Math.round(b.width)}x${Math.round(b.height)}px)`);
        } finally {
          await close();
        }
      });

      it("the Sort menu opens ON TOP of the table without moving it, is opaque and inside the screen, lists the six sorts with the current one marked, and each choice is tall enough to tap", async () => {
        const { page: p, close } = await open("sorted", viewport);
        try {
          const firstRow = viewport.width >= 1280 ? "#orders-list table tbody tr" : "#orders-list > ul > li";
          const before = await box(p, firstRow);
          assert.ok(!(await isOpen(p, T("orders-sort-menu"))), "closed until clicked");
          assert.equal((await p.locator(T("orders-sort-button")).getAttribute("aria-label")), "Sort: Profit: high to low");
          await p.locator(T("orders-sort-button")).click();
          assert.ok(await isOpen(p, T("orders-sort-menu")));
          const panel = await box(p, T("orders-sort-panel"));
          inside(panel, viewport, "the sort menu");
          assert.ok(panel.width >= 200, `wide enough to read (${Math.round(panel.width)}px)`);
          const after = await box(p, firstRow);
          assert.ok(Math.abs(after.y - before.y) < 1.5 && Math.abs(after.height - before.height) < 1.5, "the table did not move: the menu overlays it");
          const items = await p.locator(`${T("orders-sort-panel")} a`).evaluateAll((els) => els.map((el) => ({ text: el.innerText.trim(), h: el.getBoundingClientRect().height, current: el.getAttribute("aria-current") })));
          assert.deepEqual(items.map((i) => i.text), ["Newest first", "Oldest first", "Price: low to high", "Price: high to low", "Profit: low to high", "Profit: high to low"]);
          for (const i of items) assert.ok(i.h >= 40, `${i.text} is ${Math.round(i.h)}px tall`);
          assert.deepEqual(items.filter((i) => i.current === "true").map((i) => i.text), ["Profit: high to low"]);
          const alpha = await p.locator(T("orders-sort-panel")).evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.match(alpha, /^rgb\(/, `the menu is opaque (${alpha}), so the table never shows through`);
          assert.ok(await onTop(p, `${T("orders-sort-panel")} li:last-child a`), "the last choice is on top of the table (nothing covers or clips it)");
          if (SHOTS) {
            await p.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 900) });
            await p.screenshot({ path: join(SHOTS, `orders-sort-open-${label}.png`) });
          }
        } finally {
          await close();
        }
      });

      it("the Filter panel opens on top too: status, month, year, from and to are all there, readable, tappable and inside the screen; the dates show a whole date; Apply is on top", async () => {
        const { page: p, close } = await open("filtered", viewport);
        try {
          assert.ok(!(await isOpen(p, T("orders-filter-menu"))), "closed until clicked");
          assert.equal((await p.locator(T("orders-filter-count")).innerText()).trim(), "2", "the button shows how many filters are in use (a status, a period)");
          await p.locator(T("orders-filter-button")).click();
          const panel = await box(p, T("orders-filter-panel"));
          inside(panel, viewport, "the filter panel");
          assert.ok(panel.width >= 280, `the panel is ${Math.round(panel.width)}px wide`);
          const fields = ["orders-filter-status", "orders-filter-month", "orders-filter-year", "orders-filter-from", "orders-filter-to", "orders-filter-apply", "orders-filter-clear"];
          for (const id of fields) {
            const b = await box(p, T(id));
            inside(b, viewport, id);
            assert.ok(b.height >= (id === "orders-filter-clear" ? 18 : 38), `${id} is ${Math.round(b.height)}px tall`);
          }
          for (const id of ["orders-filter-status", "orders-filter-month", "orders-filter-year", "orders-filter-from", "orders-filter-to"]) assert.ok((await box(p, T(id))).width >= 110, `${id} is wide enough to read`);
          const clipped = await p.evaluate(() => [...document.querySelectorAll('[data-testid="orders-filter-from"], [data-testid="orders-filter-to"]')].map((el) => el.scrollWidth > el.clientWidth + 2));
          assert.deepEqual(clipped, [false, false], "the date fields are wide enough for a whole date");
          assert.ok(await onTop(p, T("orders-filter-apply")), "Apply is on top of the table");
          assert.equal(await p.locator(T("orders-filter-status")).evaluate((el) => el.options[el.selectedIndex].text), "Awaiting deposit", "the choices are shown back");
          assert.equal(await p.locator(T("orders-filter-month")).evaluate((el) => el.options[el.selectedIndex].text), "March");
          assert.equal(await p.locator(T("orders-filter-year")).evaluate((el) => el.value), "2025");
          assert.equal(await p.locator("#orders-search-q").inputValue(), "Alice", "and the search text stays in its field");
          if (SHOTS) {
            await p.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 1000) });
            await p.screenshot({ path: join(SHOTS, `orders-filter-open-${label}.png`) });
          }
        } finally {
          await close();
        }
      });

      it("only one menu is open at a time: opening Filter closes Sort, with or without the page's script", async () => {
        for (const script of [false, true]) {
          const { page: p, close } = await open("plain", viewport, { script });
          try {
            await p.locator(T("orders-sort-button")).click();
            assert.ok(await isOpen(p, T("orders-sort-menu")));
            await p.locator(T("orders-filter-button")).click();
            assert.ok(await isOpen(p, T("orders-filter-menu")), `Filter opened (script ${script})`);
            assert.ok(!(await isOpen(p, T("orders-sort-menu"))), `Sort closed (script ${script})`);
          } finally {
            await close();
          }
        }
      });

      it("a press outside a menu closes it, Escape closes it and puts focus back on its button, and a press inside the panel keeps it open (the page's behaviour script, run for real)", async () => {
        const { page: p, close } = await open("plain", viewport, { script: true });
        try {
          await p.locator(T("orders-sort-button")).click();
          assert.ok(await isOpen(p, T("orders-sort-menu")));
          await p.locator("h1").first().click();
          assert.ok(!(await isOpen(p, T("orders-sort-menu"))), "a press on the page closes the Sort menu");
          await p.locator(T("orders-filter-button")).click();
          await p.locator(`${T("orders-filter-panel")} p`).first().click();
          assert.ok(await isOpen(p, T("orders-filter-menu")), "a press inside the panel keeps it open");
          await p.keyboard.press("Escape");
          assert.ok(!(await isOpen(p, T("orders-filter-menu"))), "Escape closes the Filter panel");
          assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-testid")), "orders-filter-button", "focus is back on the button");
          await p.locator(T("orders-sort-button")).click();
          await p.locator("#orders-search-q").click();
          assert.ok(!(await isOpen(p, T("orders-sort-menu"))), "a press on the search field closes the open menu");
        } finally {
          await close();
        }
      });

      it("the receipts button opens a compact centred panel with the list, View, Download, Remove and the drop area; it closes with its Close button, Escape or a press outside; the table behind stays put", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const button = p.locator(`${T("receipts-button")}[aria-label*="2 attached"]`).filter({ visible: true }).first();
          const size = await button.boundingBox();
          assert.ok(size.height >= (viewport.width >= 1280 ? 30 : 38) && size.width >= 44, `the receipts button is a comfortable target (${Math.round(size.width)}x${Math.round(size.height)}px)`);
          assert.match(await button.innerText(), /^\s*2\s*$/, "it shows the count");
          const id = await button.getAttribute("popovertarget");
          assert.ok(id && id.startsWith("receipts-"), "it names the panel it opens");
          assert.ok(!(await popoverOpen(p, id)), "closed until clicked");
          await button.click();
          assert.ok(await popoverOpen(p, id), "the panel opened");
          const panel = await box(p, `#${id} > div`);
          assert.ok(panel.x >= 0 && panel.x + panel.width <= viewport.width && panel.y >= 0 && panel.y + panel.height <= viewport.height + 1, `the panel is inside the screen (${Math.round(panel.x)},${Math.round(panel.y)} ${Math.round(panel.width)}x${Math.round(panel.height)})`);
          assert.ok(panel.width >= 300 && panel.width <= 420, `compact: ${Math.round(panel.width)}px wide`);
          assert.ok(Math.abs(panel.x + panel.width / 2 - viewport.width / 2) < 3, "centred");
          const bg = await p.locator(`#${id} > div`).evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.match(bg, /^rgb\(/, `the panel is opaque (${bg})`);
          const names = await p.locator(`#${id} ${T("receipt-item")} a.truncate`).evaluateAll((els) => els.map((el) => el.innerText.trim()));
          assert.equal(names.length, 2);
          assert.ok(names.includes("Cash receipt 0042.pdf"));
          for (const verb of ["View", "Download"]) assert.equal(await p.locator(`#${id} ${T("receipt-item")} a:text-is("${verb}")`).count(), 2, `${verb} on each receipt`);
          assert.equal(await p.locator(`#${id} ${T("receipt-remove")} summary`).count(), 2, "Remove on each receipt");
          // a long file name is cut with an ellipsis, never pushed over its neighbours
          const itemBox = await box(p, `#${id} ${T("receipt-item")}`);
          const longName = await p.locator(`#${id} ${T("receipt-item")} a.truncate`).first().boundingBox();
          assert.ok(longName.x + longName.width <= itemBox.x + itemBox.width + 1, "the file name stays inside its row");
          // the drop area: a real zone with the browser's own file field stretched over it (so dropping a file on it works without any script)
          const zone = await box(p, `#${id} ${T("receipt-dropzone")}`);
          assert.ok(zone.height >= 80 && zone.width >= 240, `a real drop area (${Math.round(zone.width)}x${Math.round(zone.height)}px)`);
          const field = await p.locator(`#${id} ${T("receipt-dropzone")} input[type=file]`).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, opacity: getComputedStyle(el).opacity, accept: el.accept, pointer: getComputedStyle(el).cursor };
          });
          assert.ok(Math.abs(field.x - zone.x) < 2 && Math.abs(field.y - zone.y) < 2 && Math.abs(field.w - zone.width) < 3 && Math.abs(field.h - zone.height) < 3, "the file field covers the whole zone");
          assert.equal(field.opacity, "0");
          assert.equal(field.accept, "application/pdf,.pdf");
          assert.ok(await onTop(p, `#${id} ${T("receipt-dropzone")} input[type=file]`), "a dropped file lands on the field");
          const upload = await box(p, `#${id} button[type=submit]:text-is("Upload PDF")`);
          assert.ok(upload.height >= 40, `the Upload button is ${Math.round(upload.height)}px tall`);
          if (SHOTS) {
            await p.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 900) });
            await p.screenshot({ path: join(SHOTS, `orders-receipts-open-${label}.png`) });
          }
          // closing: the panel's Close button, Escape, and a press outside
          await p.locator(`#${id} button[aria-label="Close"]`).click();
          assert.ok(!(await popoverOpen(p, id)), "the Close button closes it");
          await button.click();
          await p.keyboard.press("Escape");
          assert.ok(!(await popoverOpen(p, id)), "Escape closes it");
          assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-testid")), "receipts-button", "focus returns to the button that opened it");
          await button.click();
          await p.mouse.click(2, 2);
          assert.ok(!(await popoverOpen(p, id)), "a press outside closes it");
        } finally {
          await close();
        }
      });

      it("an order with no receipt shows 'Add' and its panel says so; the drop area is only ever inside a panel, never in a row", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const add = p.locator(`${T("receipts-button")}`).filter({ hasText: "Add" }).filter({ visible: true }).first();
          const id = await add.getAttribute("popovertarget");
          await add.click();
          assert.ok(await popoverOpen(p, id));
          assert.match(await p.locator(`#${id} ${T("receipt-empty")}`).innerText(), /No receipts attached yet/);
          assert.equal(await p.locator(`#${id} ${T("receipt-dropzone")}`).count(), 1);
          await p.keyboard.press("Escape");
          const rowZones = await p.evaluate(() => [...document.querySelectorAll('[data-testid="receipt-dropzone"]')].filter((el) => el.getClientRects().length > 0 && !el.closest("[popover]")).length);
          assert.equal(rowZones, 0, "no drop area is visible outside a panel");
          const strays = await p.evaluate(() => [...document.querySelectorAll('input[type="file"]')].filter((el) => !el.closest("[popover]")).length);
          assert.equal(strays, 0);
        } finally {
          await close();
        }
      });

      it("the monthly financial report is one click away below the list: collapsed by default, it opens on a click and then fits the screen; chosen from its own form it is open", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const toggle = await box(p, T("financial-toggle"));
          assert.ok(toggle.height >= 40, `the toggle is ${Math.round(toggle.height)}px tall`);
          assert.equal(await p.locator("#financial-performance").isVisible(), false, "collapsed: the figures are not drawn");
          await p.locator(T("financial-toggle")).click();
          assert.equal(await p.locator("#financial-performance").isVisible(), true, "opened by a click");
          const x = await sideways(p);
          assert.ok(x.page <= 0 && x.shell <= 0, `the open report does not scroll sideways (${JSON.stringify(x)})`);
        } finally {
          await close();
        }
        const second = await open("report", viewport);
        try {
          assert.equal(await second.page.locator("#financial-performance").isVisible(), true, "open once a period was chosen");
        } finally {
          await second.close();
        }
      });

      it("a custom date range, the explained error and the empty result are readable and keep the toolbar on the screen", async () => {
        for (const [name, pattern] of [
          ["range", /placed from 5 Mar 2025 to 20 Mar 2025 · dates are used instead of the month and year/],
          ["invalid", /start date \(25 Nov 2025\) is after the end date \(10 Nov 2025\)/],
          ["empty", /No orders match/],
        ]) {
          const { page: p, close } = await open(name, viewport);
          try {
            for (const id of ["orders-search", "orders-sort-button", "orders-filter-button"]) inside(await box(p, T(id)), viewport, `${name}: ${id}`);
            assert.match((await p.locator("#orders-list").innerText()).replace(/\s+/g, " "), pattern, name);
          } finally {
            await close();
          }
        }
      });

      it("an ordinary staff member gets the four columns and no cost, profit or receipt control, and the Sort menu lists four sorts", async () => {
        const { page: p, close } = await open("staff", viewport);
        try {
          const shown = await p.locator("#orders-list").innerText();
          assert.doesNotMatch(shown, /Cost|Profit|Receipt|provisional|Monthly financial report/i);
          assert.equal(await p.locator(T("receipts-button")).count(), 0);
          assert.equal(await p.locator("[popover]").count(), 0);
          assert.equal(await p.locator(T("financial-toggle")).count(), 0);
          if (viewport.width >= 1280) assert.deepEqual((await p.locator("#orders-list table th").allInnerTexts()).map((t) => t.trim().toUpperCase()), ["ORDER", "CUSTOMER", "ORDER PRICE", "PLACED"]);
          await p.locator(T("orders-sort-button")).click();
          assert.equal(await p.locator(`${T("orders-sort-panel")} a`).count(), 4);
          const x = await sideways(p);
          assert.ok(x.page <= 0 && x.shell <= 0);
        } finally {
          await close();
        }
      });

      if (SHOTS) {
        it("screenshots for the owner's visual review", async () => {
          for (const name of ["plain", "staff", "report"]) {
            const { page: p, close } = await open(name, viewport);
            try {
              await p.screenshot({ path: join(SHOTS, `orders-${name}-top-${label}.png`) });
              await p.setViewportSize({ width: viewport.width, height: viewport.width < 700 ? 2200 : 1300 });
              await p.screenshot({ path: join(SHOTS, `orders-${name}-${label}.png`) });
            } finally {
              await close();
            }
          }
        });
      }
    });
  }
});
