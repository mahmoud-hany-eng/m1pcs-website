// M1 order workflow, CUSTOMER WEBSITE layer (layer B of the workflow test plan).
//
// WHAT THIS IS. A real production build of the website (next start), driven by a real browser (Playwright Chromium) at a
// desktop width (1280 x 900) and a phone width (390 x 844), reading a LOCAL database that has the REAL migrations and
// REAL row level security. The orders are created and moved by the REAL staff functions (admin.*), exactly as in
// workflow.db.test.mjs, and after each step the customer's pages are read in both browsers and the exact figures are
// compared with the independent integer arithmetic. Every amount is an integer number of QAR minor units, shown as "QAR 4,350.55".
//
// WHAT THIS IS NOT. A test of Supabase Auth, of MFA, or of the STAFF screens: the sign-in service is the local emulator
// (supabase/emulator: a mock of the auth and data APIs; no MFA), and the staff dashboard needs a real second factor, so it is
// not exercised here (a signed-in CUSTOMER is checked to have no way into it). Staff actions are performed by calling the real
// staff functions in the database with the harness-supplied claims, as the database tests do. Nothing here touches a hosted
// project. Every name and figure is synthetic.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { findPgBin } from "./harness.mjs";
import { AS, ID, SENTINEL, newOrder } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);
const SHOTS = process.env.WORKFLOW_E2E_SHOTS || null;
const VERBOSE = Boolean(process.env.WORKFLOW_TEST_VERBOSE);

const PRIVATE_STRINGS = [SENTINEL.note, SENTINEL.supplier, SENTINEL.reference, SENTINEL.reason, SENTINEL.cost, "internal payment note", "an internal order note", "cost note"];
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const NOT_FOUND = "We could not find that";
const owedEntry = (ref) => new RegExp(`Order ${ref}\\n+[^\\n]*· Total`);

const S1_ITEMS = [
  { kind: "component", description: "Test graphics card", quantity: 1, unit_price_minor: 215000 },
  { kind: "component", description: "Test processor", quantity: 1, unit_price_minor: 130055 },
  { kind: "build_service", description: "Assembly and testing", quantity: 1, unit_price_minor: 80000 },
  { kind: "delivery", description: "Delivery in Doha", quantity: 1, unit_price_minor: 10000 },
];
const S2_ITEMS = [{ kind: "component", description: "Test console PC", quantity: 1, unit_price_minor: 200000 }];

/** Integer minor units to the string the website shows: 435055 -> "QAR 4,350.55". */
const qar = (minor) => {
  const n = BigInt(minor);
  const whole = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `QAR ${whole}.${(n % 100n).toString().padStart(2, "0")}`;
};
/** The same figure as a regular expression that tolerates the space the page may render as a non-breaking one. */
const money = (minor) => new RegExp(qar(minor).replace(/[.]/g, "\\.").replace(" ", "\\s"));

describe("M1 order workflow: the customer website at desktop and phone widths (production build, real browser, local emulator, real RLS)", { skip, timeout: 900_000 }, () => {
  let emu;
  let site;
  let browser;
  const pages = {}; // name -> Alice's page
  const contexts = [];
  const S = {}; // S1 order
  const T = {}; // S2 order

  // ---- helpers ---------------------------------------------------------------------------------------------------
  const db = () => emu.db;
  const lines = (out) => out.split("\n").filter((l) => l !== "");
  const last = (out) => lines(out).pop().trim();
  const staff = (who, sql) => db().commit(`${who}${sql}`);
  const sam = (sql) => staff(AS.sam, sql);
  const olivia = (sql) => staff(AS.olivia, sql);
  const create = (items, customer = ID.custA) => last(db().commit(`${newOrder({ customer, items, into: "o", who: AS.sam })}select :'o';`));
  const refOf = (id) => db().ok(`select order_ref from public.orders where id = '${id}';`);
  const label = (code) => db().ok(`select customer_label from public.order_statuses where code = '${code}';`);
  const move = (id, to) => sam(`select admin.transition_order('${id}', '${to}');`);
  const pay = (id, amount, { method = "cash", purpose = "deposit", receipt = null, ref = null, note = null } = {}) =>
    olivia(`select admin.record_payment('${id}', '${purpose}', ${amount}, '${method}', now(), ${receipt ? `'${receipt}'` : "null"}, ${ref ? `'${ref}'` : "null"}, ${note ? `'${note}'` : "null"});`);
  const publish = (id, title, message, status) => sam(`select admin.publish_tracking_event('${id}', '${title}', '${message}', '${status}');`);
  const receiptsOf = (id) => lines(db().ok(`select receipt_number from public.payments where order_id = '${id}' order by amount_minor;`));

  const text = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  const show = (name, path, body) => {
    if (VERBOSE) console.log(`\n=== ${name} ${path}\n${body.replace(/\n{2,}/g, "\n").slice(0, 1800)}`);
  };
  /** Reads one customer page in BOTH browsers and returns { desktop, phone } texts. */
  async function both(path) {
    const out = {};
    for (const [name, page] of Object.entries(pages)) {
      await page.goto(`${site.base}${path}`);
      out[name] = await text(page);
      show(name, path, out[name]);
    }
    return out;
  }
  /** Runs one assertion on the text from each browser, naming the browser in any failure. */
  const each = (texts, fn) => {
    for (const [name, body] of Object.entries(texts)) {
      try {
        fn(body, name);
      } catch (error) {
        error.message = `[${name} ${SIZES[name].width}px] ${error.message}`;
        throw error;
      }
    }
  };
  const noPrivateData = (texts) => each(texts, (body) => { for (const secret of PRIVATE_STRINGS) assert.ok(!body.includes(secret), `a customer page showed an internal string: ${secret}`); });
  const noSideScroll = async (path) => {
    for (const [name, page] of Object.entries(pages)) {
      await page.goto(`${site.base}${path}`);
      await text(page);
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
      assert.ok(scroll <= width + 1, `${path} is ${scroll}px wide on a ${width}px ${name} screen`);
    }
  };
  async function shot(name, page, path) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.goto(`${site.base}${path}`);
    await text(page);
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  }
  async function signIn(page, user) {
    await page.goto(`${site.base}/auth/sign-in`);
    await page.fill("#signin-email", user.email);
    await page.fill("#signin-password", user.password);
    await page.click("form:has(#signin-email) button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
  }

  before(async () => {
    ensureBuild();
    emu = await startEmulator({ seed: false, tcp: true }); // no demonstration data: this suite creates exactly the orders it checks (tcp: one test also runs the staff gateway)
    emu.exec("alter role m1_staff_gateway login;"); // the disposable database trusts the loopback login; the production role is a login role too
    site = await startWebsite({
      CUSTOMER_ACCOUNTS_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: emu.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey,
      CUSTOMER_ACCOUNTS_PREVIEW_LABEL: "Local emulator preview: demonstration data, not real orders",
    });
    browser = await playwright.chromium.launch();
    for (const [name, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      pages[name] = await context.newPage();
      await signIn(pages[name], emu.users.alice);
    }
  });

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await site?.stop();
    await emu?.stop();
  });

  // =================================================================================================================
  describe("S1 as the customer sees it: one order of QAR 4,350.55, from the quote to the delivery", () => {
    it("1. created by staff: the customer sees the order, its four items summing to the exact total, and a pending status", async () => {
      S.id = create(S1_ITEMS);
      S.ref = refOf(S.id);
      sam(`select admin.add_order_note('${S.id}', 'an internal order note');`);
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => {
        assert.match(body, money(435055), "order total");
        assert.match(body, new RegExp(label("pending_confirmation")), "the pending status label");
        for (const item of S1_ITEMS) assert.match(body, new RegExp(item.description), item.description);
        for (const line of [215000, 130055, 80000, 10000]) assert.match(body, money(line), `line ${line}`);
        assert.match(body, /Paid so far\s+QAR 0\.00/);
        assert.match(body, /Remaining balance\s+QAR 4,350\.55/);
        assert.doesNotMatch(body, /Paid in full/);
      });
      noPrivateData(detail);
      const orders = await both("/account/orders");
      each(orders, (body) => assert.match(body, new RegExp(S.ref)));
      await shot("s1-1-created-desktop", pages.desktop, `/account/orders/${S.ref}`);
    });

    it("2. confirmed, deposit fixed at QAR 1,087.64 (25 %), QAR 500.00 paid: the deposit still to pay is exactly QAR 587.64", async () => {
      move(S.id, "awaiting_deposit");
      pay(S.id, 50000, { receipt: null, ref: SENTINEL.reference, note: "internal payment note" });
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => {
        assert.match(body, new RegExp(label("awaiting_deposit")));
        assert.match(body, /Deposit required\s+QAR 1,087\.64/);
        assert.match(body, /Paid so far\s+QAR 500\.00/);
        assert.match(body, /Remaining balance\s+QAR 3,850\.55/);
        assert.match(body, new RegExp(receiptsOf(S.id)[0]), "the generated receipt number");
      });
      noPrivateData(detail);
      const orders = await both("/account/orders");
      each(orders, (body) => assert.match(body, /Deposit still to pay:\s+QAR 587\.64/));
      const payments = await both("/account/payments");
      each(payments, (body) => assert.match(body, /Still to pay/));
      noPrivateData(payments);
    });

    it("3. deposit complete (QAR 587.64 by Fawran) through to ready for delivery: paid QAR 1,087.64, balance QAR 3,262.91, no deposit warning", async () => {
      pay(S.id, 58764, { method: "fawran" });
      move(S.id, "deposit_received");
      publish(S.id, "Order confirmed", "We confirmed your order and your deposit.", "deposit_received");
      for (const status of ["sourcing", "in_transit", "building"]) move(S.id, status);
      publish(S.id, "Your PC is being built", "Our team has started the build.", "building");
      for (const status of ["quality_check", "ready_for_delivery"]) move(S.id, status);
      publish(S.id, "Ready for delivery", "Built, tested and ready. We will arrange delivery with you.", "ready_for_delivery");
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => {
        assert.match(body, new RegExp(label("ready_for_delivery")));
        assert.match(body, /Paid so far\s+QAR 1,087\.64/);
        assert.match(body, /Remaining balance\s+QAR 3,262\.91/);
        assert.doesNotMatch(body, /Paid in full/);
      });
      const orders = await both("/account/orders");
      each(orders, (body) => assert.doesNotMatch(body, /Deposit still to pay/));
      // The timeline lists the published updates, oldest first.
      for (const [name, page] of Object.entries(pages)) {
        await page.goto(`${site.base}/account/orders/${S.ref}`);
        await text(page);
        const timeline = await page.locator("ol").first().innerText();
        const order = ["Order confirmed", "Your PC is being built", "Ready for delivery"].map((title) => timeline.indexOf(title));
        assert.ok(order.every((p) => p >= 0), `${name}: every update is shown`);
        assert.deepEqual([...order].sort((a, b) => a - b), order, `${name}: oldest first`);
      }
    });

    it("4. final payment QAR 3,262.91 recorded, order NOT yet delivered: Paid in full, balance 0, and NO loyalty points on the loyalty page", async () => {
      pay(S.id, 326291, { purpose: "balance" });
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => {
        assert.match(body, /Remaining balance\s+Paid in full/);
        assert.match(body, /Paid so far\s+QAR 4,350\.55/);
      });
      const loyalty = await both("/account/loyalty");
      each(loyalty, (body) => {
        assert.doesNotMatch(body, new RegExp(`Points earned on order ${S.ref}`), "no award before delivery");
        assert.doesNotMatch(body, /\+435/);
      });
      const overview = await both("/account");
      noPrivateData(overview);
    });

    it("5. delivered: the customer sees 435 points earned on this order, the full payment history and the finished timeline", async () => {
      move(S.id, "delivered");
      publish(S.id, "Delivered", "Delivered. Enjoy your new PC.", "delivered");
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => {
        assert.match(body, new RegExp(label("delivered")));
        assert.match(body, /Remaining balance\s+Paid in full/);
      });
      const loyalty = await both("/account/loyalty");
      each(loyalty, (body) => {
        assert.match(body, /435/);
        assert.match(body, new RegExp(`Points earned on order ${S.ref}`));
        assert.match(body, /\+435/);
      });
      const payments = await both("/account/payments");
      each(payments, (body) => {
        for (const receipt of receiptsOf(S.id)) assert.match(body, new RegExp(receipt), `receipt ${receipt}`);
        for (const amount of [50000, 58764, 326291]) assert.match(body, money(amount), `payment ${amount}`);
        // An order that is still owed is listed as "Order <ref> / <status> · Total … · Paid …"; a payment group starts with the
        // same "Order <ref>" line but continues with the payment. This order is fully paid, so it has no "owed" entry.
        // (The fixture order O-...-00001 is still owed, so the "Still to pay" heading itself is expected to be present.)
        assert.doesNotMatch(body, owedEntry(S.ref), "a fully paid order is not listed as owed");
      });
      noPrivateData(payments);
      noPrivateData(detail);
      noPrivateData(loyalty);
      await shot("s1-5-delivered-desktop", pages.desktop, `/account/orders/${S.ref}`);
      await shot("s1-5-delivered-phone", pages.phone, `/account/orders/${S.ref}`);
    });
  });

  describe("regression: defects found by the first round of testing", () => {
    it("REGRESSION (DEFECT-1): a Fawran payment is shown to the customer as Fawran, not as \"Other method\"", async () => {
      const payments = await both("/account/payments");
      each(payments, (body) => {
        assert.match(body, /Fawran/i, "the Fawran payment of QAR 587.64 is labelled with its method");
        assert.doesNotMatch(body, /Other method/, "no payment in this scenario uses an unknown method");
      });
      const detail = await both(`/account/orders/${S.ref}`);
      each(detail, (body) => assert.match(body, /Fawran/i, "the order page labels it too"));
    });
  });

  // =================================================================================================================
  describe("S2 as the customer sees it: delivered before the final payment", () => {
    it("1. delivered with QAR 1,700.00 still owed: the balance is shown, it is NOT Paid in full, and no points are shown for it", async () => {
      T.id = create(S2_ITEMS);
      T.ref = refOf(T.id);
      move(T.id, "awaiting_deposit");
      pay(T.id, 30000);
      for (const status of ["deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"]) move(T.id, status);
      const detail = await both(`/account/orders/${T.ref}`);
      each(detail, (body) => {
        assert.match(body, /Deposit required\s+QAR 300\.00/);
        assert.match(body, /Paid so far\s+QAR 300\.00/);
        assert.match(body, /Remaining balance\s+QAR 1,700\.00/);
        assert.doesNotMatch(body, /Paid in full/);
      });
      const loyalty = await both("/account/loyalty");
      each(loyalty, (body) => {
        assert.doesNotMatch(body, new RegExp(`Points earned on order ${T.ref}`));
        assert.match(body, new RegExp(`Points earned on order ${S.ref}`), "the first order's points are still there");
      });
      const payments = await both("/account/payments");
      each(payments, (body) => {
        assert.match(body, /Still to pay/);
        assert.match(body, owedEntry(T.ref), "the delivered order that is still owed is in the owed list");
        assert.match(body, /QAR 1,700\.00/);
      });
      const overview = await both("/account");
      each(overview, (body) => assert.match(body, /QAR 1,700\.00/, "the overview shows what is still owed"));
    });

    it("2. after the final payment of QAR 1,700.00 the same pages show Paid in full and 200 more points (635 in all)", async () => {
      pay(T.id, 170000, { purpose: "balance" });
      const detail = await both(`/account/orders/${T.ref}`);
      each(detail, (body) => {
        assert.match(body, /Remaining balance\s+Paid in full/);
        assert.match(body, /Paid so far\s+QAR 2,000\.00/);
      });
      const loyalty = await both("/account/loyalty");
      each(loyalty, (body) => {
        assert.match(body, new RegExp(`Points earned on order ${T.ref}`));
        assert.match(body, /\+200/);
        assert.match(body, /635/, "435 + 200");
      });
      const overview = await both("/account");
      each(overview, (body) => assert.match(body, /635/));
    });
  });

  describe("S2 continued: [OBSERVED, owner decision pending] a payment reversed AFTER the points were awarded", () => {
    it("the customer owes the balance again and the order stays delivered, but the 200 points stay (see PROPOSAL_PAYMENT_REVERSAL_AND_LOYALTY.md; nothing here is a decision)", async () => {
      const payId = lines(db().ok(`select id from public.payments where order_id = '${T.id}' and amount_minor = 170000;`)).pop().trim();
      olivia(`select admin.reverse_payment('${payId}', 'bank returned the payment');`);
      const detail = await both(`/account/orders/${T.ref}`);
      each(detail, (body) => {
        assert.match(body, /Remaining balance\s+QAR 1,700\.00/);
        assert.doesNotMatch(body, /Paid in full/);
        assert.match(body, new RegExp(label("delivered")), "the order stays delivered");
      });
      const loyalty = await both("/account/loyalty");
      each(loyalty, (body) => {
        assert.match(body, new RegExp(`Points earned on order ${T.ref}`), "the award is still listed");
        assert.match(body, /\+200/);
        assert.match(body, /635/, "the balance still counts the 200 points");
      });
      const payments = await both("/account/payments");
      each(payments, (body) => {
        assert.match(body, /reversed/i, "the reversal is listed");
        assert.match(body, owedEntry(T.ref), "the order is owed again");
      });
    });
  });

  // =================================================================================================================
  describe("the layout on a phone: nothing scrolls sideways and every price is on the screen", () => {
    it("no customer page is wider than the screen, at either width", async () => {
      for (const path of ["/account", "/account/orders", `/account/orders/${S.ref}`, `/account/orders/${T.ref}`, "/account/payments", "/account/loyalty"]) await noSideScroll(path);
    });

    it("on the phone, the line totals and amounts of an order are inside the visible screen", async () => {
      const page = pages.phone;
      await page.goto(`${site.base}/account/orders/${S.ref}`);
      await text(page);
      const hidden = await page.evaluate(() => {
        const out = [];
        for (const element of document.querySelectorAll("main li p, main td, main dd")) {
          const box = element.getBoundingClientRect();
          if (box.width > 0 && box.right > window.innerWidth + 1) out.push(element.textContent.trim().slice(0, 40));
        }
        return out;
      });
      assert.deepEqual(hidden, [], "nothing in the order is pushed off the right edge");
      const body = await text(page);
      for (const amount of [435055, 215000, 130055, 80000, 10000]) assert.match(body, money(amount));
    });
  });

  // =================================================================================================================
  describe("isolation in the browser: another customer cannot see this order, its payments or its points", () => {
    it("Bob (signed in) gets the same not-found for Alice's order as for an order that does not exist; his lists show none of it", async () => {
      for (const [name, viewport] of Object.entries(SIZES)) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await signIn(page, emu.users.bob);
        for (const ref of [S.ref, T.ref]) {
          await page.goto(`${site.base}/account/orders/${ref}`);
          const others = await text(page);
          assert.match(others, new RegExp(NOT_FOUND), `${name}: ${ref}`);
          await page.goto(`${site.base}/account/orders/O-2699-99999`);
          assert.equal(await text(page), others, `${name}: Alice's order looks exactly like one that does not exist`);
          assert.doesNotMatch(others, money(435055));
        }
        for (const path of ["/account", "/account/orders", "/account/payments", "/account/loyalty"]) {
          await page.goto(`${site.base}${path}`);
          const body = await text(page);
          for (const needle of [S.ref, T.ref, ...receiptsOf(S.id), "Test graphics card", "Points earned on order", "435"]) assert.ok(!body.includes(needle), `${name}: Bob's ${path} must not contain "${needle}"`);
        }
        await context.close();
      }
    });

    it("a visitor with no session is sent to sign in and is shown nothing of the order", async () => {
      const context = await browser.newContext({ viewport: SIZES.desktop });
      const page = await context.newPage();
      await page.goto(`${site.base}/account/orders/${S.ref}`);
      await page.waitForURL((url) => url.pathname.startsWith("/auth/"), { timeout: 20_000 });
      const body = await text(page);
      for (const needle of [S.ref, "Test graphics card", "435", "QAR 4,350"]) assert.ok(!body.includes(needle), `the sign-in page must not contain "${needle}"`);
      await context.close();
    });

    it("the data API agrees: Bob's own token reads none of Alice's order, items, payments or points; Alice's token reads them", async () => {
      const token = async (user) => (await (await fetch(`${emu.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: emu.anonKey }, body: JSON.stringify(user) })).json()).access_token;
      const get = async (jwt, path) => (await fetch(`${emu.url}/rest/v1/${path}`, { headers: { apikey: emu.anonKey, authorization: `Bearer ${jwt}` } })).json();
      const [alice, bob] = [await token(emu.users.alice), await token(emu.users.bob)];
      for (const path of [`orders?select=id&id=eq.${S.id}`, `order_items?select=id&order_id=eq.${S.id}`, `payments?select=id&order_id=eq.${S.id}`, `loyalty_ledger?select=id&order_id=eq.${S.id}`]) {
        assert.deepEqual(await get(bob, path), [], `Bob: ${path}`);
        assert.ok((await get(alice, path)).length >= 1, `Alice: ${path}`);
      }
      const orders = await get(alice, `orders?select=total_minor,deposit_required_minor,amount_paid_minor,balance_due_minor,status&id=eq.${S.id}`);
      assert.deepEqual(orders, [{ total_minor: 435055, deposit_required_minor: 108764, amount_paid_minor: 435055, balance_due_minor: 0, status: "delivered" }], "integer minor units all the way to the API");
    });

    it("a signed-in customer has no way into the staff dashboard: every /admin address is the site's ordinary 404", async () => {
      for (const [name, page] of Object.entries(pages)) {
        for (const path of ["/admin", "/admin/orders", "/admin/payments", "/admin/loyalty", "/admin/mfa"]) {
          const response = await page.goto(`${site.base}${path}`);
          assert.equal(response.status(), 404, `${name}: ${path}`);
          const body = await text(page);
          assert.doesNotMatch(body, /Record payment|Admin dashboard/i, `${name}: ${path}`);
        }
      }
    });

    it("the same holds with the staff dashboard switched ON: a signed-in customer still gets the ordinary 404 (not a 200 with a loading placeholder) for every /admin address", async () => {
      // The admin area streams a loading placeholder while a page is prepared. A response that has started streaming can no longer become
      // a 404, so the admin layout decides the 404 for non-staff first. With the dashboard ON (and a real gateway connection), a customer
      // must therefore still get the site's ordinary not-found page, byte for byte, so nothing says that an admin area exists.
      const adminSite = await startWebsite({
        CUSTOMER_ACCOUNTS_ENABLED: "true",
        STAFF_ADMIN_ENABLED: "true",
        STAFF_GATEWAY_DATABASE_URL: `postgresql://m1_staff_gateway@127.0.0.1:${emu.db.cluster.port}/${emu.db.cluster.database}`,
        NEXT_PUBLIC_SUPABASE_URL: emu.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey,
      });
      const context = await browser.newContext({ viewport: SIZES.desktop });
      try {
        const page = await context.newPage();
        await page.goto(`${adminSite.base}/auth/sign-in`);
        await page.fill("#signin-email", emu.users.alice.email);
        await page.fill("#signin-password", emu.users.alice.password);
        await page.click("form:has(#signin-email) button[type=submit]");
        await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
        const unknown = await page.goto(`${adminSite.base}/this-address-does-not-exist`);
        assert.equal(unknown.status(), 404);
        // The page's CONTENT is compared (the <main> area): the site's header is the same on every page and, since the header names the signed-in person (it asks
        // who is signed in after the page has loaded), its text depends on when it arrives, which is not what this test is about.
        const content = async () => {
          await page.waitForLoadState("networkidle");
          await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
          return page.locator("main").innerText();
        };
        const reference = await content();
        for (const path of ["/admin", "/admin/orders", "/admin/orders/00000000-0000-4000-8000-000000000001", "/admin/payments", "/admin/loyalty", "/admin/policies", "/admin/audit", "/admin/mfa"]) {
          const response = await page.goto(`${adminSite.base}${path}`);
          assert.equal(response.status(), 404, `${path} must answer 404 before anything is streamed`);
          const body = await content();
          assert.equal(body, reference, `${path} must render exactly the ordinary 404`);
          assert.doesNotMatch(await text(page), /M1 Staff|Staff dashboard|Loading/i, path);
        }
      } finally {
        await context.close();
        await adminSite.stop();
      }
    });
  });
});
