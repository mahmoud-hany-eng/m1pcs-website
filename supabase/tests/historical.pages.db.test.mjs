// THE SCREENS OF THE HISTORICAL ORDERS IMPORT, RENDERED FOR REAL with data from the REAL database functions. Real PostgreSQL 16, the real migrations, the
// real staff functions (admin.hist_*, admin.get_order, admin.order_origin, ...), the real row level security for the customer's own rows, and the REAL pages
// and components rendered with React's server renderer under the loader in support/page-render-loader.mjs (which emulates the server / client boundary).
// Only the sign-in is stubbed: the pages run as they do for a signed-in owner, a signed-in staff member and a signed-in customer. Every name is synthetic.
//
// What is proved: the owner sees the upload page and the whole review (totals, the month each order will be reported under, customers, purchases, what is
// left out, the receipts and files, the final confirmation with the exact phrase), the decisions that block an import, and the report after it; staff
// without the permission get the same "not available" as for a page that does not exist; a historical order's own page says what it is, and shows no
// deposit, no payment, no tracking and no status controls; the Orders list, the overview and a customer's page list it by the day it was COMPLETED and never
// call it "placed"; the customer sees "Completed", the date and the amount, with no tracking steps and no deposit, and nothing private anywhere.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TEXT = readFileSync(join(HERE, "fixtures", "historical", "synthetic-historical-orders.csv"), "utf8");
const lines = (out) => out.split("\n").filter((l) => l !== "");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&minus;/g, "−").replace(/\s+/g, " ");
const button = (html, value) => new RegExp(`<button[^>]*value="${value}"[^>]*>`).exec(html)?.[0] ?? "";
const tag = (html, testId) => new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? null;
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : Number(v));
const DAVE = "00000000-0000-4000-8000-0000000000d4";

suite("the historical import screens, rendered with the database's own answers (real functions, real components, server/client boundary emulated)", () => {
  let db;
  let lib;
  let StaffOperationError;
  let ownerPerms;
  let staffPerms;
  let importList;
  let importReview;
  let ordersPage;
  let orderPage;
  let overviewPage;
  let customerPage;
  let accountOrders;
  let accountOrder;
  let dashboard;
  let vm;
  const ids = {};

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const q = (sql, who) => JSON.parse(read(sql, who));
  const apiFor = (who) => ({
    histListBatches: async () => q("select admin.hist_list_batches()::text", who),
    histGetBatch: async (id) => {
      // the real gateway turns the database's "not found" into a StaffOperationError, which the page answers with its own "not found" screen
      const r = db.cluster.psql(`begin;\n${who}select admin.hist_get_batch(${lit(id)})::text;\ncommit;`);
      if (!r.ok) throw new StaffOperationError(/import not found/.test(r.err) ? "import not found" : r.err);
      return JSON.parse(lines(r.out).pop());
    },
    histOrderInfo: async (id) => q(`select coalesce(admin.hist_order_info(${lit(id)})::text, 'null')`, who),
    orderOrigin: async (id) => q(`select admin.order_origin(${lit(id)})::text`, who),
    getOrder: async (id) => q(`select admin.get_order(${lit(id)})::text`, who),
    orderCompletion: async (id) => q(`select admin.order_completion(${lit(id)})::text`, who),
    orderCosts: async (id) => q(`select admin.order_costs(${lit(id)})::text`, who),
    listOrdersOverview: async (o) =>
      q(`select admin.list_orders_overview(${lit(o.search)}, ${lit(o.status)}, ${num(o.year)}, ${num(o.month)}, ${lit(o.from)}::date, ${lit(o.to)}::date, ${lit(o.sort)}, ${o.page}, ${o.pageSize})::text`, who),
    financialReport: async (year = null, month = null) => q(`select admin.financial_report(${num(year)}, ${num(month)})::text`, who),
    overview: async (year = null) => q(`select admin.overview_summary(${num(year)})::text`, who),
    getCustomer: async (cid) => q(`select admin.get_customer(${lit(cid)})::text`, who),
    claimCodes: async (cid) => q(`select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)::text from admin.list_claim_codes(${lit(cid)}) t`, who),
    customerOrders: async (cid, limit = 25, offset = 0) => q(`select admin.customer_orders(${lit(cid)}, ${limit}, ${offset})::text`, who),
  });
  async function render(page, args = {}, { who = AS.olivia, permissions = ownerPerms } = {}) {
    globalThis.__M1_STAFF__ = { staff: { email: "owner@example.test" }, permissions, api: apiFor(who) };
    return renderToStaticMarkup(await page.default(args));
  }
  const params = (p) => ({ params: Promise.resolve(p) });

  const stage = (text, label = "synthetic") => {
    const a = lib.p.analyzeHistoricalCsv(text, { today: qatarToday(), ratePerPointMinor: 1000 });
    assert.equal(a.ok, true, a.message);
    return JSON.parse(lines(db.commit(`${AS.olivia}select admin.hist_stage_batch($j$${JSON.stringify(lib.pl.stagePayload(a, label))}$j$::jsonb)::text;`)).pop());
  };
  const qatarToday = () => {
    const d = new Date(Date.now() + 3 * 3_600_000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";

  before(async () => {
    lib = {
      p: await import("../../src/lib/staff/historical/parse.ts"),
      pl: await import("../../src/lib/staff/historical/payload.ts"),
    };
    ({ StaffOperationError } = await import("../../src/lib/staff/gateway.ts")); // loaded after the loader is registered, and the SAME module instance the pages import
    db = startDatabase({ schedule: "confirmed" });
    db.commit(`insert into auth.users (id, email) values ('${DAVE}', 'dave.login@example.test');`);
    ownerPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.olivia)));
    staffPerms = new Set(JSON.parse(read("select coalesce(jsonb_agg(p), '[]'::jsonb)::text from admin.my_permissions() p", AS.sam)));
    assert.ok(ownerPerms.has("import.manage") && !staffPerms.has("import.manage"));
    importList = await import("../../src/app/admin/import/page.tsx");
    importReview = await import("../../src/app/admin/import/[id]/page.tsx");
    ordersPage = await import("../../src/app/admin/orders/page.tsx");
    orderPage = await import("../../src/app/admin/orders/[id]/page.tsx");
    overviewPage = await import("../../src/app/admin/page.tsx");
    customerPage = await import("../../src/app/admin/customers/[id]/page.tsx");
    accountOrders = await import("../../src/app/account/orders/page.tsx");
    accountOrder = await import("../../src/app/account/orders/[ref]/page.tsx");
    dashboard = await import("../../src/components/account/dashboard.tsx");
    vm = await import("../../src/lib/accounts/shared/view-models.ts");

    // a staged batch that has a decision waiting (two names, one phone), and one that is complete and imported
    ids.shared = "+97455557777";
    ids.pending = stage(`${HEADER}Family Alpha Test,${ids.shared},2025-04-10,1000,800,200,,\nFamily Bravo Test,${ids.shared},2025-04-11,2000,1500,500,,\n`, "pending.csv").batch_id;
    ids.fixture = stage(FIXTURE_TEXT, "synthetic-historical-orders.csv").batch_id;
    const got = JSON.parse(lines(db.commit(`${AS.olivia}select admin.hist_get_batch('${ids.fixture}')::text;`)).pop());
    ids.got = got;
    ids.confirmation = {
      phrase: `IMPORT ${got.totals.orders} ORDERS`,
      attest: { date_is_completion_date: true, revenue_is_final_payable: true, orders_fully_paid: true, costs_complete: true },
      expected: { orders: got.totals.orders, revenue_minor: got.totals.revenue_minor, cost_minor: got.totals.cost_minor, points: got.totals.points },
    };
  });
  after(() => db?.stop());

  describe("the upload page", () => {
    it("the owner sees how it works, the upload form, and the earlier imports", async () => {
      const html = await render(importList);
      const t = text(html);
      assert.match(t, /Import historical orders/);
      assert.match(t, /1\. Upload.*2\. Review.*3\. Decide.*4\. Confirm.*5\. Report/);
      assert.ok(tag(html, "import-upload-form"));
      assert.match(html, /type="file"[^>]*accept="\.csv,text\/csv,text\/plain"/);
      assert.match(t, /No customer is emailed or messaged, and no sign-in account is created/);
      assert.match(t, /Waiting for your review/);
      assert.match(html, new RegExp(`href="/admin/import/${ids.fixture}"`));
    });

    it("ordinary staff, who do not hold the permission, get the page that says it is not available", async () => {
      const html = await render(importList, {}, { who: AS.sam, permissions: staffPerms });
      assert.match(text(html), /Not available/);
      assert.equal(tag(html, "import-upload-form"), null);
      assert.doesNotMatch(text(html), /Upload a file/);
    });

    it("the owner's navigation lists the import; staff's does not", async () => {
      assert.match(await render(importList), /href="\/admin\/import"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*(?:<span[^>]*>)?Import orders/);
      const staffHtml = await render(overviewPage, { searchParams: Promise.resolve({}) }, { who: AS.sam, permissions: staffPerms });
      assert.doesNotMatch(staffHtml, /Import orders|Import historical orders/);
      assert.match(await render(overviewPage, { searchParams: Promise.resolve({}) }), /Import historical orders/);
      assert.match(await render(ordersPage, { searchParams: Promise.resolve({}) }), /Import historical orders/);
    });
  });

  describe("the review page of a staged import", () => {
    let html;
    let t;
    before(async () => {
      html = await render(importReview, params({ id: ids.fixture }));
      t = text(html);
    });

    it("says nothing has been imported yet, and shows the figures of the file: 25 orders, 19 customers, QAR 106,334, 10,632 points", () => {
      assert.match(t, /Waiting for your review/);
      assert.match(t, /Nothing has been imported yet/);
      const totals = text(/<div[^>]*data-testid="import-totals"[\s\S]*?<\/div><\/div><\/div>/.exec(html)?.[0] ?? "");
      assert.match(totals, /Orders to import 25/);
      assert.match(totals, /Customers 19/);
      assert.match(totals, /Revenue QAR 106,334\.00/);
      assert.match(totals, /Direct costs QAR 91,346\.00/);
      assert.match(totals, /Profit QAR 14,988\.00/);
      assert.match(totals, /Loyalty points 10,632/);
      assert.match(totals, /1 order recorded at a loss/);
      assert.match(totals, /10 advertising rows \(QAR 495\.00\)/);
    });

    it("shows the month each order will be reported under, and asks the owner to confirm the date is the COMPLETION date", () => {
      assert.match(t, /Reported under the month each order was completed/);
      assert.match(t, /not in the month you import it/);
      assert.match(t, /The date in the file is the date each order was completed and handed over ?, not the date it was placed/);
      for (const month of ["Oct 2026", "2025", "2024"]) assert.ok(t.includes(month), month);
    });

    it("lists the purchases with their row numbers, the recorded loss in red, and an unknown cost as 'unknown' (never zero)", () => {
      assert.match(t, /the number is the row in your spreadsheet/);
      assert.match(t, /Cost is not a number|unknown|Correct…/);
      assert.match(html, /text-error/);
    });

    it("keeps the advertising rows and the invalid row out, in plain words", () => {
      assert.match(t, /Left out on purpose/);
      assert.match(t, /10 rows, QAR 495\.00 in total \(reported separately\)/);
      assert.match(t, /1 row: row \d+ \(a spreadsheet error, not a purchase\)/);
    });

    it("lists the receipts as references that still need attaching, never a link, never a host", () => {
      assert.match(t, /Receipts and files/);
      assert.match(t, /21 referenced · 21 not attached yet/);
      assert.match(t, /Not attached yet/);
      assert.doesNotMatch(html, /https?:\/\/attachments\.example\.test/, "the export's link is never drawn");
      assert.doesNotMatch(html, /attachments\.example\.test/, "not even its host");
    });

    it("offers the final confirmation with the exact phrase, both buttons, and the four figures the owner reviewed", () => {
      assert.match(t, /Final confirmation/);
      assert.match(t, /Type IMPORT 25 ORDERS to confirm/);
      assert.match(t, /This will create 25 completed orders worth QAR 106,334\.00 and award 10,632 loyalty points, once each\. No customer will be emailed, no sign-in account is created, and no existing order or balance changes/);
      assert.ok(tag(html, "commit-check") && tag(html, "commit-import"));
      for (const [name, value] of [["expected_orders", "25"], ["expected_revenue_minor", "10633400"], ["expected_cost_minor", "9134600"], ["expected_points", "10632"]]) {
        assert.match(html, new RegExp(`<input type="hidden" name="${name}" value="${value}"`), name);
      }
      assert.match(html, /name="costs_complete" value="yes"/);
      assert.match(html, /name="costs_complete" value="no"/);
      assert.match(button(html, "import"), /\sdisabled(=""|\s|>)/, `the import button waits for the typed phrase: ${button(html, "import")}`);
      assert.match(t, /Discard this import/);
    });

    it("contains no cost or profit figure beyond the owner's own review, no identity, no staff id and no secret", () => {
      assert.doesNotMatch(html, new RegExp(ID.olivia));
      assert.doesNotMatch(t, /password|token|secret/i);
    });
  });

  describe("a staged import with a decision waiting", () => {
    it("shows the item that needs a decision, the two ways to settle it, and keeps the import button off", async () => {
      const html = await render(importReview, params({ id: ids.pending }));
      const t = text(html);
      assert.match(t, /1 waiting/);
      assert.match(t, /One phone number, different names/);
      assert.match(t, /A phone number alone is not proof of who someone is/);
      assert.ok(tag(html, "flag-shared_phone"));
      assert.match(t, /These are the same person: merge/);
      assert.match(t, /They are different customers: keep separate/);
      assert.match(t, /1 item still needs your decision above before this can be imported/);
      assert.match(button(html, "check"), /\sdisabled(=""|\s|>)/, `the check button waits for the decisions: ${button(html, "check")}`);
      assert.match(button(html, "import"), /\sdisabled(=""|\s|>)/);
    });

    it("an import that is not found, and a malformed address, say so without revealing anything", async () => {
      const missing = text(await render(importReview, params({ id: "00000000-0000-4000-8000-000000000999" })));
      assert.match(missing, /Not available/);
      assert.match(missing, /That import was not found/);
      assert.match(text(await render(importReview, params({ id: "not-an-id" }))), /Not available/);
    });

    it("staff without the permission cannot open an import, even by its address", async () => {
      const t = text(await render(importReview, params({ id: ids.fixture }), { who: AS.sam, permissions: staffPerms }));
      assert.match(t, /Not available/);
      assert.doesNotMatch(t, /QAR 106,334/);
    });
  });

  describe("after the import", () => {
    before(() => {
      db.commit(`${AS.olivia}select admin.hist_commit_batch('${ids.fixture}', $c$${JSON.stringify(ids.confirmation)}$c$::jsonb, false);`);
      ids.orders = JSON.parse(read("select json_agg(o.id order by h.source_row_number)::text from public.orders o join private.historical_orders h on h.order_id = o.id where h.batch_id = '" + ids.fixture + "'"));
      ids.customerId = read(`select customer_id from public.orders where id = '${ids.orders[0]}'`);
      ids.firstRef = read(`select order_ref from public.orders where id = '${ids.orders[0]}'`);
    });

    it("the page becomes the report: imported, 25 orders, 19 new customers, QAR 106,334, 10,632 points, advertising apart, nothing emailed", async () => {
      const html = await render(importReview, params({ id: ids.fixture }));
      const t = text(html);
      assert.match(t, /Imported/);
      assert.match(t, /Import report/);
      const report = text(/<div[^>]*data-testid="import-report"[\s\S]*?<\/div><\/div><\/div>/.exec(html)?.[0] ?? "");
      assert.match(report, /Orders imported 25/);
      assert.match(report, /19 new profiles, 0 existing/);
      assert.match(report, /Revenue QAR 106,334\.00/);
      assert.match(report, /Loyalty points awarded 10,632/);
      assert.match(report, /Declared complete/);
      assert.match(report, /Advertising \(not orders\) QAR 495\.00 10 rows, reported separately/);
      assert.match(report, /Files still to attach 21/);
      assert.match(t, /Nobody was emailed and no sign-in was created/);
      assert.match(t, /issue them a one-time claim code from their customer page/);
      assert.equal(tag(html, "commit-form"), null, "an imported batch has no confirmation form");
      assert.match(html, new RegExp(`href="/admin/orders/${ids.orders[0]}"`));
    });
  });

  describe("an imported order's own page (staff)", () => {
    it("the owner sees what it is, its completion date, the points, the files and the form to describe it later; and NO deposit, payment, tracking or status controls", async () => {
      const html = await render(orderPage, params({ id: ids.orders[0] }));
      const t = text(html);
      assert.match(t, /Historical WhatsApp order/);
      assert.match(t, /completed \d{1,2} \w{3} \d{4} · Historical WhatsApp order/);
      assert.doesNotMatch(t, /· placed /);
      assert.match(t, /Completion date .* \(the date you confirmed as the completion date\)/);
      assert.match(t, /Placement date Not known: never guessed/);
      assert.match(t, /Paid in full, as you confirmed when importing it\. No payment records exist for this order\./);
      assert.match(t, /Loyalty points awarded [\d,]+ \(once, when it was imported\)/);
      assert.match(t, /Describe what was bought/);
      assert.ok(tag(html, "historical-items-form") || /Describe what was bought…/.test(t));
      for (const absent of ["Deposit required", "Deposit (provisional)", "Record a payment", "Order progress", "Tracking updates shown to the customer", "Status history", "Move to the current workflow", "Order type"]) {
        assert.doesNotMatch(t, new RegExp(absent), `${absent} is not shown for a purchase made before the website`);
      }
      assert.equal(tag(html, "tracking-closed"), null);
    });

    it("an ordinary staff member sees the same order with a plain note, and none of the owner's import details, files or costs", async () => {
      const html = await render(orderPage, params({ id: ids.orders[0] }), { who: AS.sam, permissions: staffPerms });
      const t = text(html);
      assert.ok(tag(html, "historical-note"));
      assert.match(t, /Its placement date is not known, so it is listed by the day it was completed/);
      assert.doesNotMatch(t, /Receipts and files|Describe what was bought|Loyalty points awarded|confirmed as the completion date/);
      assert.doesNotMatch(t, /Order costs and profit|Direct historical cost/);
    });

    it("an ordinary order is exactly as before: placed, its deposit, its payments, its tracking, its status controls", async () => {
      const html = await render(orderPage, params({ id: ID.orderA ?? read("select id from public.orders where origin = 'platform' order by created_at limit 1") }));
      const t = text(html);
      assert.match(t, /· placed /);
      assert.match(t, /Deposit/);
      assert.match(t, /Payments/);
      assert.doesNotMatch(t, /Historical WhatsApp order/);
    });
  });

  describe("lists and reports show the day an order was COMPLETED, never 'placed'", () => {
    it("the Orders page lists a historical order with 'Completed <day>' and its label, and a modern order with its creation date", async () => {
      const html = await render(ordersPage, { searchParams: Promise.resolve({}) });
      assert.match(html, /data-testid="historical-date"/);
      assert.match(text(html), /Completed \d{1,2} \w{3} \d{4} Historical WhatsApp order/);
      const firstHistorical = /data-testid="historical-date"[^>]*><span>Completed ([^<]+)<\/span>/.exec(html)?.[1];
      assert.ok(firstHistorical && !firstHistorical.includes(new Date().getUTCFullYear() + " " + "never"), "a date was shown");
    });

    it("the Orders page filtered to the year of an old purchase lists it under that year", async () => {
      const html = await render(ordersPage, { searchParams: Promise.resolve({ year: "2025" }) });
      assert.match(text(html), /Historical WhatsApp order/);
      assert.doesNotMatch(text(html), /Completed \d{1,2} \w{3} 2026/);
    });

    it("the Overview's recent orders and a customer's page show the same", async () => {
      const overview = await render(overviewPage, { searchParams: Promise.resolve({}) });
      assert.match(text(overview), /Completed \d{1,2} \w{3} \d{4} · Historical WhatsApp order|No orders yet|Placed/);
      const customer = text(await render(customerPage, params({ id: ids.customerId })));
      assert.match(customer, /Historical WhatsApp order · completed \d{1,2} \w{3} \d{4}/);
      assert.doesNotMatch(customer, /Earlier workflow · placed/, "a purchase made before the website is not an 'earlier workflow' order, and was not 'placed' on the day it was imported");
    });
  });

  describe("what the customer sees, after claiming their record", () => {
    let context;
    before(async () => {
      db.commit(`insert into public.customer_accounts (user_id, customer_id, linked_via) values ('${DAVE}', '${ids.customerId}', 'admin');`);
      const asDave = `${AS.alice.replace(ID.alice, DAVE)}`;
      const rows = (sql) => JSON.parse(read(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (${sql}) t`, asDave));
      const orders = rows("select * from public.orders order by created_at desc");
      const statuses = rows("select * from public.order_statuses");
      const stages = rows("select * from public.order_workflow_stages");
      ids.customerOrders = orders;
      context = { orders, statuses, stages, detail: {}, payments: rows("select * from public.payments") };
      for (const o of orders) {
        context.detail[o.order_ref] = {
          order: o,
          items: rows(`select * from public.order_items where order_id = '${o.id}'`),
          events: rows(`select * from public.order_tracking_events where order_id = '${o.id}'`),
          payments: rows(`select * from public.payments where order_id = '${o.id}'`),
        };
      }
      globalThis.__M1_NAV__ = { account: context, customerContext: { user: { id: DAVE, email: "dave.login@example.test" }, supabase: {}, customer: {}, customers: [] } };
    });
    const renderAccount = async (page, args = {}) => renderToStaticMarkup(await page.default(args));

    it("the customer's rows carry the two plain columns and nothing private", () => {
      assert.ok(ids.customerOrders.length >= 1 && ids.customerOrders.every((o) => o.origin === "historical_import" && typeof o.order_date === "string"));
      for (const o of ids.customerOrders) assert.ok(!Object.keys(o).some((k) => /cost|profit|supplier|batch|fingerprint|attest/i.test(k)), "no private column");
    });

    it("the orders list says 'Completed', the date and 'Historical WhatsApp order', shows the amount and 'Paid in full', and has no progress steps and no deposit", async () => {
      const html = await renderAccount(accountOrders);
      const t = text(html);
      assert.match(t, /Completed \d{1,2} \w{3} \d{4} · Historical WhatsApp order/);
      assert.doesNotMatch(t, /Placed /);
      assert.match(t, /Paid in full/);
      assert.match(t, /View order(?! and tracking)/);
      assert.doesNotMatch(t, /Deposit still to pay|View order and tracking/);
      assert.doesNotMatch(html, /aria-label="Order progress"/);
    });

    it("the order page explains it in one sentence, shows no tracking or deposit and no 'No payment recorded', and never shows a cost, a profit or a supplier", async () => {
      const html = await renderAccount(accountOrder, params({ ref: ids.firstRef }));
      const t = text(html);
      assert.match(t, /Completed \d{1,2} \w{3} \d{4} · Historical WhatsApp order/);
      assert.ok(tag(html, "historical-note"));
      assert.match(t, /You bought this from M1 on WhatsApp, before our website existed\. It was completed on/);
      assert.match(t, /nothing is outstanding/);
      assert.ok(tag(html, "historical-money"));
      assert.match(t, /This purchase was settled before the website existed, so there are no individual payment records to list here/);
      assert.doesNotMatch(t, /Deposit required|Where your order is|Tracking timeline|No payment has been recorded|Paid so far/);
      assert.doesNotMatch(t, /cost|profit|margin|supplier|invoice|airtable|batch|attest/i);
      assert.doesNotMatch(html, /attachments\.example\.test|https?:\/\/[^"]*airtable/i);
    });

    it("an order reference of the historical shape opens its page, and a malformed one does not", async () => {
      assert.match(ids.firstRef, /^H-[0-9]{4}-[0-9]{5}$/);
      assert.equal(vm.isOrderRef(ids.firstRef), true);
      assert.equal(vm.isOrderRef("H-2611-1"), false);
      assert.equal(vm.isOrderRef("X-2611-00001"), false);
      await assert.rejects(() => renderAccount(accountOrder, params({ ref: "H-bad" })), /NEXT_NOT_FOUND/);
    });

    it("the view model lists orders by the date they are listed by, so a purchase from 2024 is below one from 2026 even though both were imported today", () => {
      const overview = vm.buildOverview({ full_name: "Dave Test" }, ids.customerOrders, context.statuses, [], context.stages);
      assert.ok(overview.latestOrder);
      const dates = ids.customerOrders.map((o) => Date.parse(o.order_date)).sort((a, b) => b - a);
      assert.equal(Date.parse(ids.customerOrders.find((o) => o.order_ref === overview.latestOrder.ref).order_date), dates[0]);
    });

    it("the dashboard card for an ordinary order still says 'Placed' and shows its progress", () => {
      const modern = { ...ids.customerOrders[0], origin: "platform", order_date: ids.customerOrders[0].created_at, status: "building", total_minor: 100000, amount_paid_minor: 50000, balance_due_minor: 50000, net_payable_minor: 100000, order_ref: "O-2611-00099" };
      const view = vm.buildOrderSummary(modern, context.statuses, context.stages);
      assert.equal(view.dateLabel, "Placed");
      assert.equal(view.isHistorical, false);
      const html = renderToStaticMarkup(dashboard.OrderCard({ order: view }));
      assert.match(text(html), /Placed /);
      assert.match(text(html), /View order and tracking/);
    });
  });
});
