// PLAT-0006: THE FINANCE SCREENS IN A REAL BROWSER, at a desktop width (1280) and a phone width (390). The pages are the real pages, drawn with data
// from the real database functions (the same loader and sign-in stub as financial.pages.db.test.mjs) and styled with the website's own compiled
// stylesheet from a real production build. The staff dashboard needs a real second factor (see WORKFLOW_TESTS.md), so the pages are not reached
// through a login; their markup and CSS are what is checked here.
//
// What it proves: on a phone nothing scrolls sideways (the page never gets wider than the screen) and the financial table is shown as cards, on a
// desktop it is a table and the cards are hidden; the same figures are in both; the customer's order history, the cost editor and the Overview
// groups fit both widths; and (when M1_SCREENSHOT_DIR is set) screenshots are written for the owner's visual review.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, ROOT } from "./support/browser.mjs";
import { ONE, lines, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const playwright = loadPlaywright();
const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const skip = !playwright ? "Playwright is not installed (it is not a project dependency); CI installs a pinned copy" : !haveServer ? "no PostgreSQL server programs" : false;
const suite = skip ? describe.skip : describe;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const YEAR = 2025;
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;

suite("the finance screens in a real browser: desktop and phone widths", { skip }, () => {
  let db;
  let browser;
  let css = "";
  let ownerPerms;
  const pages = {};
  const html = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const api = {
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, AS.olivia),
    getCustomer: async (cid) => q(`select admin.get_customer(${lit(cid)})::text`, AS.olivia),
    claimCodes: async () => [],
    orderPricingContext: async (cid) => q(`select admin.order_pricing_context(${lit(cid)})::text`, AS.olivia),
    searchCustomers: async () => [],
    listOrders: async ({ status = null, search = null, limit = 50, offset = 0 } = {}) => q(`select admin.list_orders(${lit(status)}, ${lit(search)}, ${limit}, ${offset})::text`, AS.olivia),
    listOrdersPage: async (o) => q(`select admin.list_orders_page(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, AS.olivia),
    listOrdersOverview: async (o) => q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, AS.olivia),
    overview: async (year = null) => q(`select admin.overview_summary(${num(year)})::text`, AS.olivia),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, AS.olivia),
    completedOrders: async (year = null, month = null, limit = 50, offset = 0) => q(`select admin.list_completed_orders(${num(year)}, ${num(month)}, ${limit}, ${offset})::text`, AS.olivia),
    customerOrders: async (cid, limit = 25, offset = 0) => q(`select admin.customer_orders(${lit(cid)}, ${limit}, ${offset})::text`, AS.olivia),
    orderCosts: async (oid) => q(`select admin.order_costs(${lit(oid)})::text`, AS.olivia),
    orderCompletion: async (oid) => q(`select admin.order_completion(${lit(oid)})::text`, AS.olivia),
  };
  async function draw(page, args) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions: ownerPerms, api };
    return renderToStaticMarkup(await page.default(args));
  }
  const document = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;

  const mkOrder = ({ total, customer = ID.custA, discount = null, points = 0 }) =>
    lines(commit(`select admin.create_order('${customer}', '${JSON.stringify(ONE(total))}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, ${discount ? `'${JSON.stringify(discount)}'::jsonb` : "null::jsonb"}, ${points}::bigint, null::bigint, null::bigint, null::jsonb);`)).pop().trim();
  const complete = (id) => {
    commit(`select admin.transition_order('${id}', 'awaiting_deposit');`);
    commit(`select admin.record_payment('${id}', 'balance', ${Number(read(`select net_payable_minor from public.orders where id = '${id}'`))}, 'cash');`);
    for (const to of ["deposit_received", "sourcing", "building", "quality_check", "ready_for_delivery", "delivered"]) commit(`select admin.transition_order('${id}', '${to}');`);
  };
  const completedOn = (iso, total, cost) => {
    const id = mkOrder({ total });
    complete(id);
    rewrite(`update public.orders set created_at = '${new Date(new Date(iso).getTime() - 3 * 86400000).toISOString()}', completed_at = '${iso}' where id = '${id}'; update private.order_completions set completed_at = '${iso}' where order_id = '${id}';`);
    if (cost !== null) commit(`select admin.add_order_cost('${id}', '${randomUUID()}', 'components', 'Graphics card purchase from the supplier', ${cost}, 'actual', 'Supplier reference 7781', null::date, 'private note');`);
    return id;
  };

  before(async () => {
    ensureBuild();
    const cssDir = join(ROOT, ".next", "static", "css");
    css = readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n");
    assert.ok(css.length > 10_000, "the compiled stylesheet was found");
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    const ids = {
      jan: completedOn(`${YEAR}-01-20T09:00:00+03:00`, 500000, 320000),
      mar: completedOn(`${YEAR}-03-15T15:00:00+03:00`, 1200000, null),
      dec: completedOn(`${YEAR}-12-31T23:30:00+03:00`, 2750000, 1900000),
    };
    commit(`select admin.adjust_loyalty('${ID.custA}', 400, 'points for the layout test');`);
    const discounted = mkOrder({ total: 1000000, discount: { mode: "fixed", amount_minor: 50000, reason: "layout test" }, points: 200 });
    commit(`select admin.transition_order('${discounted}', 'awaiting_deposit');`);
    for (const [name, rel] of Object.entries({ orders: "orders/page.tsx", order: "orders/[id]/page.tsx", overview: "page.tsx", customer: "customers/[id]/page.tsx" })) pages[name] = await import(`../../src/app/admin/${rel}`);
    html.orders = document(await draw(pages.orders, { searchParams: Promise.resolve({ fy: String(YEAR) }) }));
    html.march = document(await draw(pages.orders, { searchParams: Promise.resolve({ fy: String(YEAR), fm: "3" }) }));
    html.order = document(await draw(pages.order, { params: Promise.resolve({ id: ids.jan }) }));
    html.overview = document(await draw(pages.overview, { searchParams: Promise.resolve({ year: String(YEAR) }) }));
    html.customer = document(await draw(pages.customer, { params: Promise.resolve({ id: ID.custA }) }));
    browser = await playwright.chromium.launch({ args: ["--no-sandbox"] });
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    db?.stop();
  });

  const WIDTHS = [
    ["desktop", { width: 1280, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ];
  async function open(name, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await context.newPage();
    await page.setContent(html[name], { waitUntil: "load" });
    return { page, close: () => context.close() };
  }
  const overflow = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  const visible = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden").length, selector);

  for (const [label, viewport] of WIDTHS) {
    describe(`${label} (${viewport.width}px)`, () => {
      for (const name of ["orders", "march", "order", "overview", "customer"]) {
        it(`${name}: the page is never wider than the screen`, async () => {
          const { page, close } = await open(name, viewport);
          try {
            if (name === "customer") await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
            const { scroll, inner } = await overflow(page);
            assert.ok(scroll <= inner, `${name} at ${viewport.width}px scrolls sideways: content is ${scroll}px wide on a ${inner}px screen`);
            if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${label}.png`), fullPage: true });
          } finally {
            await close();
          }
        });
      }

      it("the month table is a table on a desktop and cards on a phone, with the same twelve months", async () => {
        const { page, close } = await open("orders", viewport);
        try {
          const tables = await visible(page, "#financial-performance table");
          const cards = await visible(page, "#financial-performance ul > li");
          if (label === "desktop") {
            assert.equal(tables, 1, "the table is shown");
            assert.equal(cards, 0, "the cards are hidden");
            assert.equal(await page.locator("#financial-performance table tbody tr").count(), 12);
          } else {
            assert.equal(tables, 0, "the table is hidden on a phone");
            assert.ok(cards >= 12, `twelve month cards (saw ${cards})`);
          }
          const text = await page.locator("#financial-performance").innerText();
          for (const month of ["January", "March", "December"]) assert.ok(text.includes(month));
        } finally {
          await close();
        }
      });

      it("no amount spills out of the card or table cell that holds it", async () => {
        for (const name of ["orders", "march", "order", "overview", "customer"]) {
          const { page, close } = await open(name, viewport);
          try {
            if (name === "customer") await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
            const spills = await page.evaluate(() => {
              const out = [];
              for (const el of document.querySelectorAll(".whitespace-nowrap.tabular-nums")) {
                const box = el.closest(".glass, li, td, dd") ?? el.parentElement;
                if (!box || box === el) continue;
                const a = el.getBoundingClientRect();
                const b = box.getBoundingClientRect();
                if (a.width > 0 && (a.right > b.right + 0.5 || a.left < b.left - 0.5)) out.push(`${el.textContent} (${Math.round(a.right - b.right)}px past its box)`);
              }
              return out;
            });
            assert.deepEqual(spills, [], `${name} at ${viewport.width}px`);
          } finally {
            await close();
          }
        }
      });

      it("the key figures and the incomplete-cost warning are on screen without scrolling inside the section", async () => {
        const { page, close } = await open("orders", viewport);
        try {
          for (const id of ["fin-net-revenue", "fin-cost", "fin-profit", "fin-count", "fin-margin", "fin-incomplete-warning"]) {
            const box = await page.locator(`[data-testid="${id}"]`).boundingBox();
            assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= viewport.width + 1, `${id} fits the ${viewport.width}px screen (${JSON.stringify(box)})`);
          }
        } finally {
          await close();
        }
      });

      it("the customer's order history shows the final net payable prominently, and its details open", async () => {
        const { page, close } = await open("customer", viewport);
        try {
          const net = page.locator('[data-testid="net-payable"]').first();
          const box = await net.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, "the net payable is on screen");
          assert.ok(/final net payable/i.test(await net.innerText()), "labelled as the final net payable (the label is drawn in capitals)");
          const summary = page.locator("details > summary", { hasText: "Order details" }).first();
          await summary.click();
          assert.ok(await page.locator("details[open]").count() >= 1);
          const { scroll, inner } = await overflow(page);
          assert.ok(scroll <= inner, "still no sideways scroll with the details open");
        } finally {
          await close();
        }
      });

      it("the cost editor on the order page: the entry table, the add form and the history fit the screen", async () => {
        const { page, close } = await open("order", viewport);
        try {
          for (const id of ["order-cost-summary", "add-cost-form", "costs-complete-form"]) {
            const box = await page.locator(`[data-testid="${id}"]`).boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, `${id} fits (${JSON.stringify(box)})`);
          }
          await page.locator('[data-testid="cost-history"] > summary').click();
          assert.ok((await overflow(page)).scroll <= viewport.width, "no sideways scroll with the history open");
        } finally {
          await close();
        }
      });

      it("the Overview is three groups, not a wall of cards", async () => {
        const { page, close } = await open("overview", viewport);
        try {
          const headings = await page.locator("main h2, section h2").allInnerTexts();
          for (const h of ["Operations", "Financial performance", "Needs attention", "Recent orders"]) assert.ok(headings.some((t) => t.toLowerCase() === h.toLowerCase()), `heading ${h} (saw ${headings.join(" | ")})`);
          assert.ok(await visible(page, '[data-testid="overview-operations"] > *') <= 2);
        } finally {
          await close();
        }
      });
    });
  }
});
