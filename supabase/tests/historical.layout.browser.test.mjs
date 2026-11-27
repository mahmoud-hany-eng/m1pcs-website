// THE HISTORICAL IMPORT SCREENS IN A REAL BROWSER, at a desktop width (1280) and a phone width (390). The pages are the real pages, drawn with data from the
// real database functions (the same loader and sign-in stub as historical.pages.db.test.mjs) and styled with the website's own compiled stylesheet from a
// real production build. The staff dashboard needs a real second factor (see WORKFLOW_TESTS.md), so the pages are not reached through a login; their
// markup and CSS are what is checked here.
//
// What it proves: on a phone nothing scrolls sideways and the tables are shown as cards, on a desktop they are tables; the upload form, the decision
// buttons and the final confirmation fit the screen and can be reached; the import button starts switched off and is a comfortable target; the
// forms inside a row open and close and are labelled; the customer's historical order shows no steps and nothing outside its box; and (when
// M1_SCREENSHOT_DIR is set) screenshots are written for the owner's visual review. (The typed-phrase gate itself needs the page's script, which static
// markup does not run: historical-forms.tsx is covered by historical.static.test.mjs and the commit action by historical.db.test.mjs.)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire, register } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, ROOT } from "./support/browser.mjs";
import { lines } from "./support/idempotency-helpers.mjs";

const playwright = loadPlaywright();
const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const skip = !playwright ? "Playwright is not installed (it is not a project dependency); CI installs a pinned copy" : !haveServer ? "no PostgreSQL server programs" : false;
const suite = skip ? describe.skip : describe;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TEXT = readFileSync(join(HERE, "fixtures", "historical", "synthetic-historical-orders.csv"), "utf8");
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(Number(v)));
const DAVE = "00000000-0000-4000-8000-0000000000d4";
const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";

suite("the historical import screens in a real browser: desktop and phone widths", { skip }, () => {
  let db;
  let browser;
  let css = "";
  let ownerPerms;
  let lib;
  const html = {};
  const ids = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const api = {
    histListBatches: async () => q("select admin.hist_list_batches()::text", AS.olivia),
    histGetBatch: async (id) => JSON.parse(lines(db.commit(`${AS.olivia}select admin.hist_get_batch(${lit(id)})::text;`)).pop()),
    histOrderInfo: async (id) => q(`select coalesce(admin.hist_order_info(${lit(id)})::text, 'null')`, AS.olivia),
    orderOrigin: async (id) => q(`select admin.order_origin(${lit(id)})::text`, AS.olivia),
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, AS.olivia),
    orderCompletion: async (id) => q(`select admin.order_completion(${lit(id)})::text`, AS.olivia),
    orderCosts: async (id) => q(`select admin.order_costs(${lit(id)})::text`, AS.olivia),
    listOrdersOverview: async (o) =>
      q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, AS.olivia),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, AS.olivia),
  };
  async function draw(page, args) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions: ownerPerms, api };
    return renderToStaticMarkup(await page.default(args));
  }
  const document = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
  const params = (p) => ({ params: Promise.resolve(p) });
  const today = () => {
    const d = new Date(Date.now() + 3 * 3_600_000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const stage = (text, label) => {
    const a = lib.p.analyzeHistoricalCsv(text, { today: today(), ratePerPointMinor: 1000 });
    assert.equal(a.ok, true, a.message);
    return JSON.parse(lines(db.commit(`${AS.olivia}select admin.hist_stage_batch($j$${JSON.stringify(lib.pl.stagePayload(a, label))}$j$::jsonb)::text;`)).pop());
  };

  before(async () => {
    ensureBuild();
    const cssDir = join(ROOT, ".next", "static", "css");
    css = readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n");
    assert.ok(css.length > 10_000, "the compiled stylesheet was found");
    lib = { p: await import("../../src/lib/staff/historical/parse.ts"), pl: await import("../../src/lib/staff/historical/payload.ts") };
    db = startDatabase({ schedule: "confirmed" });
    db.commit(`insert into auth.users (id, email) values ('${DAVE}', 'dave.login@example.test');`);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));

    ids.pending = stage(`${HEADER}Family Alpha Test,+97455557777,2025-04-10,1000,800,200,,\nFamily Bravo Test,+97455557777,2025-04-11,2000,1500,500,,\n`, "pending.csv").batch_id;
    ids.fixture = stage(FIXTURE_TEXT, "synthetic-historical-orders.csv").batch_id;
    const pages = {};
    for (const [name, rel] of Object.entries({ list: "import/page.tsx", review: "import/[id]/page.tsx", orders: "orders/page.tsx", order: "orders/[id]/page.tsx" })) pages[name] = await import(`../../src/app/admin/${rel}`);

    html.list = document(await draw(pages.list, {}));
    html.review = document(await draw(pages.review, params({ id: ids.fixture })));
    html.pending = document(await draw(pages.review, params({ id: ids.pending })));

    const got = JSON.parse(lines(db.commit(`${AS.olivia}select admin.hist_get_batch('${ids.fixture}')::text;`)).pop());
    const confirmation = {
      phrase: `IMPORT ${got.totals.orders} ORDERS`,
      attest: { date_is_completion_date: true, revenue_is_final_payable: true, orders_fully_paid: true, costs_complete: true },
      expected: { orders: got.totals.orders, revenue_minor: got.totals.revenue_minor, cost_minor: got.totals.cost_minor, points: got.totals.points },
    };
    db.commit(`${AS.olivia}select admin.hist_commit_batch('${ids.fixture}', $c$${JSON.stringify(confirmation)}$c$::jsonb, false);`);
    html.report = document(await draw(pages.review, params({ id: ids.fixture })));
    ids.order = read(`select order_id from private.historical_orders where batch_id = '${ids.fixture}' order by source_row_number limit 1`);
    html.order = document(await draw(pages.order, params({ id: ids.order })));
    html.orders = document(await draw(pages.orders, { searchParams: Promise.resolve({}) }));

    // the customer's own page, after they claim their record
    const customerId = read(`select customer_id from public.orders where id = '${ids.order}'`);
    const ref = read(`select order_ref from public.orders where id = '${ids.order}'`);
    db.commit(`insert into public.customer_accounts (user_id, customer_id, linked_via) values ('${DAVE}', '${customerId}', 'admin');`);
    const asDave = AS.alice.replace(ID.alice, DAVE);
    const rows = (sql) => JSON.parse(read(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (${sql}) t`, asDave));
    const orders = rows("select * from public.orders order by created_at desc");
    const detail = {};
    for (const o of orders) {
      detail[o.order_ref] = {
        order: o,
        items: rows(`select * from public.order_items where order_id = '${o.id}'`),
        events: rows(`select * from public.order_tracking_events where order_id = '${o.id}'`),
        payments: rows(`select * from public.payments where order_id = '${o.id}'`),
      };
    }
    globalThis.__M1_NAV__ = {
      account: { orders, statuses: rows("select * from public.order_statuses"), stages: rows("select * from public.order_workflow_stages"), detail, payments: [] },
      customerContext: { user: { id: DAVE, email: "dave.login@example.test" }, supabase: {}, customer: {}, customers: [] },
    };
    const accountOrder = await import("../../src/app/account/orders/[ref]/page.tsx");
    const accountOrders = await import("../../src/app/account/orders/page.tsx");
    html.accountOrder = document(renderToStaticMarkup(await accountOrder.default(params({ ref }))));
    html.accountOrders = document(renderToStaticMarkup(await accountOrders.default({})));

    browser = await playwright.chromium.launch({ args: ["--no-sandbox"] });
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    db?.stop();
  });

  // 1280 and 390 are the two the owner uses; 768 and 1024 are the widths between, where a dashboard sidebar leaves the least room for a table or four tiles.
  const WIDTHS = [
    ["desktop", { width: 1280, height: 900 }],
    ["laptop", { width: 1024, height: 800 }],
    ["tablet", { width: 768, height: 1024 }],
    ["phone", { width: 390, height: 844 }],
  ];
  const NAMES = ["list", "review", "pending", "report", "order", "orders", "accountOrder", "accountOrders"];
  async function open(name, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await context.newPage();
    await page.setContent(html[name], { waitUntil: "load" });
    return { page, close: () => context.close() };
  }
  // A very long page (the review of twenty-five purchases) at two-times scale is taller than the browser can capture in one picture: keep the top of it.
  const screenshot = async (page, path, width) => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const most = 7000;
    await page.screenshot(height > most ? { path, clip: { x: 0, y: 0, width, height: most } } : { path, fullPage: true });
  };
  const overflow = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  const visible = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden").length, selector);

  for (const [label, viewport] of WIDTHS) {
    describe(`${label} (${viewport.width}px)`, () => {
      for (const name of NAMES) {
        it(`${name}: the page is never wider than the screen`, async () => {
          const { page, close } = await open(name, viewport);
          try {
            if (SHOTS) await screenshot(page, join(SHOTS, `historical-${name}-${label}.png`), viewport.width);
            await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
            const { scroll, inner } = await overflow(page);
            assert.ok(scroll <= inner, `${name} at ${viewport.width}px scrolls sideways: content is ${scroll}px wide on a ${inner}px screen`);
          } finally {
            await close();
          }
        });
      }

      it("the purchases are a table on a wide screen and cards below it, with the same twenty-five rows", async () => {
        const { page, close } = await open("review", viewport);
        try {
          const tables = await visible(page, "#purchases table");
          const cards = await visible(page, "#purchases ul.flex-col.gap-3 > li.p-4");
          if (viewport.width >= 1280) {
            assert.equal(tables, 1, "the table is shown");
            assert.equal(cards, 0, "the cards are hidden");
            assert.ok((await page.locator("#purchases table tbody tr").count()) >= 25);
          } else {
            assert.equal(tables, 0, "the table is hidden below the wide layout");
            assert.ok(cards >= 25, `a card per purchase (saw ${cards})`);
          }
          const text = await page.locator("#purchases").innerText();
          assert.ok(/QAR/.test(text) && /Correct…/.test(text));
        } finally {
          await close();
        }
      });

      it("the totals, the decision list and the final confirmation are all on the page and fit the screen", async () => {
        const { page, close } = await open("review", viewport);
        try {
          for (const selector of ['[data-testid="import-totals"]', "#decisions", "#months", "#customers", "#purchases", "#attachments", "#confirm", '[data-testid="commit-form"]']) {
            const box = await page.locator(selector).first().boundingBox();
            assert.ok(box && box.width > 0 && box.x >= -1 && box.x + box.width <= viewport.width + 1, `${selector} fits the ${viewport.width}px screen (${JSON.stringify(box)})`);
          }
        } finally {
          await close();
        }
      });

      it("the import button starts switched off and is a comfortable target, and the phrase field takes typing", async () => {
        const { page, close } = await open("review", viewport);
        try {
          const importBtn = page.locator('button[name="intent"][value="import"]');
          await importBtn.scrollIntoViewIfNeeded();
          assert.equal(await importBtn.isDisabled(), true, "the import button starts off");
          const waiting = await page.locator('[data-testid^="flag-"]').count();
          assert.equal(await page.locator('button[name="intent"][value="check"]').isDisabled(), waiting > 0, "the check button is off only while a decision is waiting");
          const phrase = page.locator("#commit-phrase");
          await phrase.fill("IMPORT 25 ORDERS");
          assert.equal(await phrase.inputValue(), "IMPORT 25 ORDERS");
          const box = await importBtn.boundingBox();
          assert.ok(box && box.height >= 40 && box.width >= 120 && box.x + box.width <= viewport.width + 1, `the import button is a comfortable target and fits (${JSON.stringify(box)})`);
        } finally {
          await close();
        }
      });

      it("a decision waiting is impossible to miss: shown first, both ways to settle it, and both buttons off", async () => {
        const { page, close } = await open("pending", viewport);
        try {
          const flag = page.locator('[data-testid="flag-shared_phone"]');
          const box = await flag.boundingBox();
          assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1);
          assert.ok((await flag.innerText()).includes("keep separate"));
          assert.equal(await page.locator('button[name="intent"][value="check"]').isDisabled(), true);
          assert.equal(await page.locator('button[name="intent"][value="import"]').isDisabled(), true);
        } finally {
          await close();
        }
      });

      it("a row's correction and skip forms open and close, and every field inside has a visible label and a comfortable height", async () => {
        const { page, close } = await open("review", viewport);
        try {
          const details = page.locator('#purchases details:visible').filter({ has: page.locator('input[name="customer"]') }).first();
          await details.locator("summary").click();
          assert.equal(await details.evaluate((el) => el.open), true, "the form opens");
          const fields = details.locator("input:not([type=hidden])");
          assert.ok((await fields.count()) >= 5);
          for (let i = 0; i < (await fields.count()); i += 1) {
            const field = fields.nth(i);
            const box = await field.boundingBox();
            assert.ok(box && box.height >= 40, `field ${i} is at least 40px tall (${box?.height})`);
            const id = await field.getAttribute("id");
            assert.ok(id && (await page.locator(`label[for="${id}"]`).count()) === 1, `field ${i} has its label`);
          }
          await details.locator("summary").click();
          assert.equal(await details.evaluate((el) => el.open), false, "and closes again");
        } finally {
          await close();
        }
      });

      it("the receipts are listed without a link, and every 'attach' form fits and is labelled", async () => {
        const { page, close } = await open("review", viewport);
        try {
          assert.equal(await page.locator('a[href*="attachments.example.test"]').count(), 0, "no outside link is on the page");
          assert.ok(!(await page.locator("body").innerText()).includes("attachments.example.test"), "and the export's host is not shown");
          const first = page.locator("#attachments details:visible").filter({ has: page.locator('input[type="file"]') }).first();
          await first.locator("summary").click();
          const input = first.locator('input[type="file"]').first();
          assert.equal(await input.getAttribute("accept"), "application/pdf,image/png,.pdf,.png");
          const box = await input.boundingBox();
          assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1);
        } finally {
          await close();
        }
      });

      it("the upload page: the file field and the date-order choice are reachable, and the earlier import is listed with its status", async () => {
        const { page, close } = await open("list", viewport);
        try {
          const file = page.locator('input[type="file"]');
          const box = await file.boundingBox();
          assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.height >= 40);
          assert.ok((await page.locator("select[name=date_format] option").count()) === 4);
          assert.ok((await page.locator("main, body").first().innerText()).includes("Waiting for your review"));
        } finally {
          await close();
        }
      });

      it("the report shows what was imported, each order links to its page, and nothing spills out of its box", async () => {
        const { page, close } = await open("report", viewport);
        try {
          const text = (await page.locator('[data-testid="import-report"]').innerText()).toLowerCase();
          for (const word of ["Orders imported", "Loyalty points awarded", "Advertising"]) assert.ok(text.includes(word.toLowerCase()), word);
          assert.ok((await page.locator('a[href^="/admin/orders/"]').count()) >= 25);
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
          assert.deepEqual(spills, []);
        } finally {
          await close();
        }
      });

      it("a historical order's page and the Orders list say 'Completed' and 'Historical WhatsApp order', and the order page has no deposit, payment, tracking or status block", async () => {
        const { page, close } = await open("order", viewport);
        try {
          const text = await page.locator("body").innerText();
          assert.ok(/Historical WhatsApp order/i.test(text));
          for (const absent of ["Record a payment", "Order progress", "Status history", "Deposit"]) assert.ok(!text.includes(absent), `${absent} is not shown`);
        } finally {
          await close();
        }
        const list = await open("orders", viewport);
        try {
          assert.ok((await visible(list.page, '[data-testid="historical-date"]')) >= 1);
          const t = await list.page.locator("body").innerText();
          assert.ok(/Completed \d{1,2} \w{3} \d{4}/.test(t) && /Historical WhatsApp order/i.test(t));
        } finally {
          await list.close();
        }
      });

      it("the customer's page: Completed, the date and the amount, one sentence of explanation, no steps, no deposit, nothing outside its box", async () => {
        const { page, close } = await open("accountOrder", viewport);
        try {
          const text = await page.locator("body").innerText();
          assert.ok(/Completed \d{1,2} \w{3} \d{4}/.test(text));
          assert.ok(/before our website existed/.test(text));
          for (const absent of ["Deposit required", "Tracking timeline", "Where your order is", "cost", "profit", "supplier"]) assert.ok(!text.toLowerCase().includes(absent.toLowerCase()), `${absent} is not shown to a customer`);
          const { scroll, inner } = await overflow(page);
          assert.ok(scroll <= inner);
        } finally {
          await close();
        }
      });
    });
  }
});
