// THE ORDERS PAGE IN A REAL BROWSER, at a desktop (1280), a laptop (1024), a tablet (768) and a phone (390 and 360) width. The page is the real page, drawn
// with data from the real database functions (the same loader and sign-in stub as orders.pages.db.test.mjs) and styled with the website's own compiled
// stylesheet from a real production build. The staff dashboard needs a real second factor (see WORKFLOW_TESTS.md), so the page is not reached through
// a login; its markup and CSS are what is checked here.
//
// What it proves: the filter panel is one coherent block in three rows (search; month, year, from, to; status, sort, rows per page, apply, reset),
// followed by the count, the table (cards on a phone) and the pagination; the search field is never collapsed to a sliver (the earlier screen's
// defect); nothing scrolls sideways and every control is wide enough to read and tall enough to tap; on a phone every control is stacked; a custom date
// range is visibly in charge of the month and year. When M1_SCREENSHOT_DIR is set, screenshots are written for the owner's visual review.
import assert from "node:assert/strict";
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

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;

suite("the Orders page in a real browser: desktop, laptop, tablet and phone widths", { skip }, () => {
  let db;
  let browser;
  let css = "";
  let ownerPerms;
  let page;
  const html = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const api = {
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, AS.olivia),
    claimCodes: async () => [],
    listOrdersPage: async (o) => q(`select admin.list_orders_page(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, AS.olivia),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, AS.olivia),
  };
  async function draw(search) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions: ownerPerms, api };
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
    commit(`select admin.create_order('${ID.custB}', '${JSON.stringify([{ kind: "component", description: "Big build", quantity: 1, unit_price_minor: 8_000_000 }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, '${JSON.stringify({ mode: "fixed", amount_minor: 1_000_000, reason: "layout test discount" })}'::jsonb, 2000::bigint, null::bigint, null::bigint, null::jsonb);`);
    page = await import("../../src/app/admin/orders/page.tsx");
    html.plain = document(await draw({ fy: "2025" }));
    html.sorted = document(await draw({ fy: "2025", sort: "price_desc" })); // a non-default sort and no filter: every sort label must say so
    html.filtered = document(await draw({ fy: "2025", year: "2025", month: "3", status: "awaiting_deposit", sort: "price_desc", size: "10", q: "Alice" }));
    html.range = document(await draw({ fy: "2025", year: "2025", month: "3", from: "2025-03-05", to: "2025-03-20", sort: "oldest" }));
    html.invalid = document(await draw({ from: "2025-11-25", to: "2025-11-10" }));
    html.empty = document(await draw({ q: "zzzz no such customer" }));
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
  async function open(name, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p = await context.newPage();
    await p.setContent(html[name], { waitUntil: "load" });
    return { page: p, close: () => context.close() };
  }
  const box = async (p, selector) => {
    const b = await p.locator(selector).first().boundingBox();
    assert.ok(b, `${selector} is on the page and visible`);
    return b;
  };
  const SEL = {
    search: "#orders-search",
    searchButton: '[data-testid="orders-row-search"] button',
    month: "#orders-month",
    year: "#orders-year",
    from: "#orders-from",
    to: "#orders-to",
    status: "#orders-status",
    sort: "#orders-sort",
    size: "#orders-size",
    apply: '[data-testid="orders-apply"]',
    reset: '[data-testid="orders-reset"]',
    summary: '[data-testid="orders-summary-line"]',
    pagination: '[data-testid="orders-pagination"]',
  };

  for (const [label, viewport] of WIDTHS) {
    describe(`${label} (${viewport.width}px)`, () => {
      it("nothing scrolls sideways, on any state of the page", async () => {
        for (const name of ["plain", "sorted", "filtered", "range", "invalid", "empty"]) {
          const { page: p, close } = await open(name, viewport);
          try {
            const { scroll, inner } = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
            assert.ok(scroll <= inner, `${name} at ${viewport.width}px scrolls sideways: content is ${scroll}px wide on a ${inner}px screen`);
            if (SHOTS) {
              // The admin shell scrolls inside itself and the Financial performance section is long on a phone, so the Orders section is
              // photographed as an element (the page is scrolled to it), and the top of the page as the viewport shows it.
              if (name === "plain") await p.screenshot({ path: join(SHOTS, `orders-top-${label}.png`) });
              await p.setViewportSize({ width: viewport.width, height: viewport.width < 700 ? 2400 : 1500 });
              await p.locator("#orders-list").scrollIntoViewIfNeeded();
              await p.evaluate(() => document.querySelector("#orders-list").scrollIntoView({ block: "start" }));
              await p.screenshot({ path: join(SHOTS, `orders-${name}-${label}.png`) });
            }
          } finally {
            await close();
          }
        }
      });

      it("the controls are one panel in three rows, followed by the count, the table or cards, and the pagination", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const b = Object.fromEntries(await Promise.all(Object.entries(SEL).map(async ([k, s]) => [k, await box(p, s)])));
          const bottom = (x) => x.y + x.height;
          // row 1 -> row 2 -> row 3 -> count -> table -> pagination, strictly downwards
          assert.ok(bottom(b.search) <= b.month.y + 1 && bottom(b.searchButton) <= b.month.y + 1, "search comes above the dates");
          for (const k of ["month", "year", "from", "to"]) for (const j of ["status", "sort", "size", "apply", "reset"]) assert.ok(bottom(b[k]) <= b[j].y + 1, `${k} is above ${j}`);
          for (const j of ["status", "sort", "size", "apply", "reset"]) assert.ok(bottom(b[j]) <= b.summary.y + 1, `${j} is above the count`);
          const results = await p.evaluate(() => {
            const visibleY = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().top + window.scrollY);
            return { table: visibleY('#orders-list table tbody tr'), cards: visibleY("#orders-list ul > li") };
          });
          const rowsY = viewport.width >= 1280 ? results.table : results.cards;
          assert.ok(rowsY.length >= 5, `at least the five orders are drawn (${viewport.width >= 1280 ? "table" : "cards"})`);
          assert.ok(Math.min(...rowsY) >= b.summary.y + b.summary.height - 1, "the orders come after the count");
          assert.ok(b.pagination.y >= Math.max(...rowsY), "the pagination is below the orders");
        } finally {
          await close();
        }
      });

      it("the search field is a real field, never a sliver: it takes the width the row has, beside its button on wide screens and above it on a phone", async () => {
        const { page: p, close } = await open("filtered", viewport);
        try {
          const search = await box(p, SEL.search);
          const form = await box(p, '[data-testid="orders-filters"]');
          assert.ok(search.width >= (viewport.width >= 768 ? 360 : 250), `the search field is ${Math.round(search.width)}px wide at ${viewport.width}px`);
          assert.ok(search.width >= form.width * (viewport.width >= 768 ? 0.6 : 0.85), `the search field uses ${Math.round((search.width / form.width) * 100)}% of the panel`);
          assert.ok(search.height >= 44, `tall enough to tap (${Math.round(search.height)}px)`);
          const button = await box(p, SEL.searchButton);
          if (viewport.width >= 640) assert.ok(Math.abs(button.y + button.height / 2 - (search.y + search.height / 2)) < 30, "the Search button sits beside the field");
          else assert.ok(button.y >= search.y + search.height - 1, "on a phone the button is under the field");
          assert.ok(button.x + button.width <= viewport.width, "the button is fully on the screen");
        } finally {
          await close();
        }
      });

      it("month and year, the two dates, and the status, sort and rows controls sit together on wide screens and stack on a phone; each is readable and tappable", async () => {
        const { page: p, close } = await open("filtered", viewport);
        try {
          const b = Object.fromEntries(await Promise.all(["month", "year", "from", "to", "status", "sort", "size", "apply", "reset"].map(async (k) => [k, await box(p, SEL[k])])));
          for (const [k, x] of Object.entries(b)) {
            assert.ok(x.height >= 40, `${k} is at least 40px tall (${Math.round(x.height)}px)`);
            assert.ok(x.x >= 0 && x.x + x.width <= viewport.width, `${k} is inside the screen`);
          }
          for (const k of ["month", "year", "from", "to", "status", "sort", "size"]) assert.ok(b[k].width >= 110, `${k} is wide enough to read (${Math.round(b[k].width)}px)`);
          const sameRow = (a, c) => Math.abs(b[a].y - b[c].y) < 6;
          if (viewport.width >= 1280) {
            assert.ok(sameRow("month", "year") && sameRow("year", "from") && sameRow("from", "to"), "wide: month, year, from and to are on one row");
            assert.ok(sameRow("status", "sort") && sameRow("sort", "size") && sameRow("size", "apply"), "wide: status, sort, rows per page and the buttons are on one row");
          } else if (viewport.width >= 640) {
            assert.ok(sameRow("month", "year") && sameRow("from", "to"), "laptop and tablet: the pairs are side by side");
            assert.ok(b.from.y > b.month.y, "laptop and tablet: the two groups are stacked");
            assert.ok(sameRow("status", "sort") && sameRow("sort", "size"), "laptop and tablet: status, sort and rows per page share a row");
            assert.ok(b.apply.y > b.status.y, "laptop and tablet: the buttons are on a row of their own");
          } else {
            assert.ok(b.year.y > b.month.y && b.from.y > b.year.y && b.to.y > b.from.y, "phone: every control is stacked");
            assert.ok(b.sort.y > b.status.y, "phone: status above sort");
          }
          // the date fields show a whole date (not cut off)
          const clipped = await p.evaluate(() => [...document.querySelectorAll("#orders-from, #orders-to")].map((el) => el.scrollWidth > el.clientWidth + 2));
          assert.deepEqual(clipped, [false, false], "the date fields are wide enough for a whole date");
        } finally {
          await close();
        }
      });

      it("with a non-default sort and no filter every visible label names that sort, and the count and page labels stay true", async () => {
        const { page: p, close } = await open("sorted", viewport);
        try {
          const line = (await p.locator(SEL.summary).innerText()).replace(/\s+/g, " ");
          assert.match(line, /Showing 1–5 of \d+ orders · highest order price first/, line);
          assert.match(line, /Sorted: Highest order price first \(what the customer has to pay\)/, line);
          assert.doesNotMatch(line, /newest|oldest|lowest/i, `no other sort is named: ${line}`);
          assert.match((await p.locator(SEL.pagination).innerText()).replace(/\s+/g, " "), /Page 1 of \d+/);
          assert.equal(await p.locator(`${SEL.sort} option:checked`).innerText(), "Highest order price first", "and the Sort by control shows it too");
        } finally {
          await close();
        }
      });

      it("a custom date range is visibly in charge: the month and year group is dimmed and says it is ignored, the range group is highlighted", async () => {
        const { page: p, close } = await open("range", viewport);
        try {
          const state = await p.evaluate(() => {
            const period = document.querySelector('[data-testid="orders-period"]');
            const range = document.querySelector('[data-testid="orders-range"]');
            return {
              dim: Number(getComputedStyle(period).opacity),
              rangeBorder: getComputedStyle(range).borderTopColor,
              periodBorder: getComputedStyle(period).borderTopColor,
              periodText: period.innerText.replace(/\s+/g, " "),
              rangeText: range.innerText.replace(/\s+/g, " "),
            };
          });
          assert.ok(state.dim < 1, `the month and year group is dimmed (opacity ${state.dim})`);
          assert.match(state.periodText, /Placed in · ignored/i);
          assert.match(state.periodText, /Ignored while custom dates are set\./);
          assert.match(state.rangeText, /Or between two dates · in use/i);
          assert.match(state.rangeText, /takes precedence over the month and year/i);
          assert.notEqual(state.rangeBorder, state.periodBorder, "the range group has its own border colour");
          const text = await p.locator('[data-testid="orders-summary-line"]').innerText();
          assert.match(text.replace(/\s+/g, " "), /placed from 5 Mar 2025 to 20 Mar 2025/);
          assert.match(text.replace(/\s+/g, " "), /custom dates are used instead of the month and year/);
        } finally {
          await close();
        }
      });

      it("nothing in the orders table is cut off: where a table is drawn its scroll box does not need to scroll sideways", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const cut = await p.evaluate(() => [...document.querySelectorAll("#orders-list .overflow-x-auto")].filter((el) => el.getClientRects().length > 0).map((el) => el.scrollWidth - el.clientWidth));
          for (const overflow of cut) assert.ok(overflow <= 1, `the table is ${overflow}px wider than the room it has at ${viewport.width}px`);
        } finally {
          await close();
        }
      });

      it("the orders are a table from 1280px and cards below it, with the same orders and the price the customer pays", async () => {
        const { page: p, close } = await open("plain", viewport);
        try {
          const shown = await p.evaluate(() => ({
            table: [...document.querySelectorAll("#orders-list table")].some((el) => el.getClientRects().length > 0),
            cards: [...document.querySelectorAll("#orders-list ul")].some((el) => el.getClientRects().length > 0),
          }));
          if (viewport.width >= 1280) assert.deepEqual(shown, { table: true, cards: false }, "a table beside the sidebar from 1280px");
          else assert.deepEqual(shown, { table: false, cards: true }, "one card per order below that");
          assert.match(await p.locator("#orders-list").innerText(), /Showing 1–5 of \d+ orders/);
        } finally {
          await close();
        }
      });

      it("the explained error and the empty result are readable and keep the controls on the screen", async () => {
        for (const name of ["invalid", "empty"]) {
          const { page: p, close } = await open(name, viewport);
          try {
            const filters = await box(p, '[data-testid="orders-filters"]');
            assert.ok(filters.width > 250 && filters.x >= 0 && filters.x + filters.width <= viewport.width);
            const message = await p.locator("#orders-list").innerText();
            assert.match(message.replace(/\s+/g, " "), name === "invalid" ? /start date \(25 Nov 2025\) is after the end date \(10 Nov 2025\)/ : /No orders match/);
          } finally {
            await close();
          }
        }
      });
    });
  }
});
