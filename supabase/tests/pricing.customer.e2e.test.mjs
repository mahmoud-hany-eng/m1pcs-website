// PRICING AND REWARDS as the customer sees them: a real production build of the website (next start), driven by a real browser (Playwright
// Chromium) at a desktop width (1280 x 900) and a phone width (390 x 844), reading a LOCAL database that has the REAL migrations and REAL row
// level security. The order, its discount and its redeemed points are created by the REAL staff function (admin.create_order with 11 arguments) with
// harness-supplied claims; the sign-in service is the local emulator (not Supabase Auth). The staff dashboard needs a real second factor, so it is
// covered by the database suites and the page render tests instead. Nothing here touches a hosted project; every name is synthetic.
//
// What it proves: the customer's order page is a STATEMENT (order value, discount, loyalty credit that is not a payment, total payable, paid so far,
// balance due, and the deposit worked out from the value before the discount), on a desktop and on a phone; the order list and the payments page show
// what is PAYABLE; the points history shows the points used and, after a cancellation, the points returned; the balance is the database's; the reason
// for a discount and who authorized it never reach the customer; and another customer cannot open the order.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { findPgBin } from "./harness.mjs";
import { AS, ID } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);

const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const SECRET_REASON = "PrivateDiscountReasonXYZ";

describe("pricing and rewards: the customer's statement (production build, real browser, local emulator, real RLS)", { skip, timeout: 900_000 }, () => {
  let emu;
  let site;
  let browser;
  const pages = {};
  const contexts = [];
  let bobPage;
  let orderId;
  let ref;

  const db = () => emu.db;
  const lines = (out) => out.split("\n").filter((l) => l !== "");
  const olivia = (sql) => db().commit(`${AS.olivia}${sql}`);
  const body = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  const open = async (page, path) => {
    await page.goto(`${site.base}${path}`);
    return body(page);
  };
  const eachSize = async (path, fn) => {
    for (const [name, page] of Object.entries(pages)) {
      try {
        await fn(await open(page, path), page, name);
      } catch (error) {
        error.message = `[${name} ${SIZES[name].width}px] ${error.message}`;
        throw error;
      }
    }
  };
  const testid = async (page, id) => (await page.locator(`[data-testid="${id}"]`).first().innerText()).replace(/\s+/g, " ").trim();
  async function signIn(page, user) {
    await page.goto(`${site.base}/auth/sign-in`);
    await page.fill("#signin-email", user.email);
    await page.fill("#signin-password", user.password);
    await page.click("form:has(#signin-email) button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
  }

  before(async () => {
    ensureBuild();
    emu = await startEmulator({ seed: false });
    olivia(`select admin.adjust_loyalty('${ID.custA}', 500, 'points for the customer pricing test');`);
    const items = JSON.stringify([{ kind: "component", description: "SYNTHETIC TEST — Custom Gaming PC", quantity: 1, unit_price_minor: 435055 }]);
    const discount = JSON.stringify({ mode: "fixed", amount_minor: 10000, reason: SECRET_REASON });
    orderId = lines(db().commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${items}'::jsonb, null, 'admin', null, null, null, '${discount}'::jsonb, 435, null, null) as o \\gset\nselect :'o';`)).pop().trim();
    ref = db().ok(`select order_ref from public.orders where id = '${orderId}';`);
    db().commit(`${AS.sam}select admin.transition_order('${orderId}', 'awaiting_deposit');`);
    olivia(`select admin.record_payment('${orderId}', 'deposit', 108764, 'fawran');`);
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
    const bobContext = await browser.newContext({ viewport: SIZES.desktop });
    contexts.push(bobContext);
    bobPage = await bobContext.newPage();
    await signIn(bobPage, emu.users.bob);
  });

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await site?.stop();
    await emu?.stop();
  });

  it("the order page is a statement: order value, discount, loyalty credit (not a payment), total payable, paid so far, balance due, and the deposit rule", async () => {
    await eachSize(`/account/orders/${ref}`, async (text, page) => {
      assert.equal(await page.locator('[data-testid="order-statement"]').count(), 1);
      assert.equal(await testid(page, "statement-gross"), "QAR 4,350.55");
      assert.equal(await testid(page, "statement-discount"), "-QAR 100.00");
      assert.equal(await testid(page, "statement-credit"), "-QAR 43.50");
      assert.equal(await testid(page, "statement-net"), "QAR 4,207.05");
      assert.equal(await testid(page, "statement-paid"), "QAR 1,087.64");
      assert.equal(await testid(page, "statement-balance"), "QAR 3,119.41");
      assert.match(text, /Order value \(before discount\)/);
      assert.match(text, /Loyalty credit \(435 points\)/);
      assert.match(text, /Points used as a credit on this order\. Not a payment\./);
      assert.match(text, /Deposit required: QAR 1,087\.64\. It is worked out from the order value before the discount/);
    });
  });

  it("the customer never sees the reason for the discount, who authorized it, or any staff-only text", async () => {
    await eachSize(`/account/orders/${ref}`, async (text) => {
      for (const hidden of [SECRET_REASON, "Owner (test)", "authorized", "Reason:", "private reason"]) assert.ok(!text.includes(hidden), `must not show: ${hidden}`);
    });
  });

  it("the order list and the payments page show what is PAYABLE, not the gross value", async () => {
    await eachSize("/account/orders", async (text) => {
      assert.match(text, /Total payable\s*QAR 4,207\.05/);
      assert.match(text, /QAR 3,119\.41/);
    });
    await eachSize("/account/payments", async (text) => {
      assert.match(text, new RegExp(`Order ${ref}`));
      assert.match(text, /Total payable QAR 4,207\.05 · Paid QAR 1,087\.64/);
      assert.match(text, /QAR 3,119\.41/);
    });
  });

  it("the points page shows the 435 points used on this order, the balance the database derived, and how points work", async () => {
    await eachSize("/account/loyalty", async (text) => {
      assert.match(text, /Points used on an order/);
      assert.match(text, /Redeemed on order O-\d{4}-\d{5}: QAR 43\.50 credit/);
      assert.match(text, /-435/);
      assert.match(text, /your points\s*65/i); // the label is upper-cased by the stylesheet, so innerText shows it in capitals
      assert.match(text, /Each point is worth QAR 0\.10 off a new order/);
    });
  });

  it("another customer cannot open the order, and sees none of its money", async () => {
    const text = await open(bobPage, `/account/orders/${ref}`);
    assert.doesNotMatch(text, /4,207\.05|4,350\.55|Loyalty credit/);
    const list = await open(bobPage, "/account/orders");
    assert.doesNotMatch(list, new RegExp(ref));
  });

  it("paying the net payable amount in full ends in 'Paid in full' (the gross was never owed)", async () => {
    olivia(`select admin.record_payment('${orderId}', 'balance', 311941, 'cash');`);
    await eachSize(`/account/orders/${ref}`, async (text, page) => {
      assert.equal(await testid(page, "statement-balance"), "Paid in full");
      assert.equal(await testid(page, "statement-paid"), "QAR 4,207.05");
    });
  });

  it("after a cancellation the points come back by a new entry, and the page says what is true", async () => {
    // a second order, cancelled before any money moved
    const items = JSON.stringify([{ kind: "component", description: "SYNTHETIC TEST — second PC", quantity: 1, unit_price_minor: 200000 }]);
    const second = lines(db().commit(`${AS.olivia}select admin.create_order('${ID.custA}', '${items}'::jsonb, null, 'admin', null, null, null, null, 60, null, null) as o \\gset\nselect :'o';`)).pop().trim();
    db().commit(`${AS.sam}select admin.transition_order('${second}', 'cancelled', 'customer changed their mind');`);
    await eachSize("/account/loyalty", async (text) => {
      assert.match(text, /Points returned/);
      assert.match(text, /\+60/);
      assert.match(text, /Points returned: order O-\d{4}-\d{5} was cancelled/);
    });
  });
});
