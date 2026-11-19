// BROWSER JOURNEYS FOR STAFF, AGAINST THE OFFICIAL SUPABASE LOCAL STACK.
//
// A real production build of the website, a real browser, the real Auth service (sign-in, real authenticator codes,
// real sessions), the real database reached only through the server-only staff gateway. Every person, address and
// amount is synthetic. Screenshots (desktop and phone width) are written when REAL_E2E_SHOTS names a folder.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { loadPlaywright, startRealSite } from "./site.mjs";
import { makeApi, makeMail, PASSWORD, readStack, signUpConfirmed, totp, uniqueEmail } from "./stack.mjs";

const playwright = loadPlaywright();
const stack = readStack();
const skip = !stack ? "the official Supabase local stack is not running" : !playwright ? "Playwright is not installed" : false;
const SHOTS = process.env.REAL_E2E_SHOTS || null;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

describe("staff, in a real browser, against the official Supabase local stack", { skip, timeout: 900_000 }, () => {
  let site, browser, api, mail, db;
  let owner, ownerSecret, customerUser;
  let desk, phone; // signed-in staff contexts (second step done)
  const ids = {};

  const body = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  const shot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };
  const noSideways = async (page, label) => {
    const overflow = await page.evaluate(() => {
      const root = document.querySelector(".admin-root") ?? document.documentElement;
      const wide = [...root.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("[class*='overflow-x-auto']");
      });
      return { scroll: root.scrollWidth - root.clientWidth, wide: wide.slice(0, 3).map((e) => e.tagName + "." + String(e.className).slice(0, 60)) };
    });
    assert.ok(overflow.scroll <= 1 && overflow.wide.length === 0, `${label}: content wider than the screen ${JSON.stringify(overflow)}`);
  };

  /** Waits for a condition on the page; on a timeout, says what the page's alerts said (a form's own error), not just "timeout". */
  async function waitFor(page, fn, label, arg = null) {
    try {
      await page.waitForFunction(fn, arg, { timeout: 20_000 });
    } catch (error) {
      const notes = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
      throw new Error(`${label}: ${error.message.split("\n")[0]}; the page's notices: ${JSON.stringify(notes)}`);
    }
  }

  /** After a form reports an error React still clears the form once; a person is slower than that, a script is not. */
  const settle = async (page) => {
    await page.locator('button[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
  };

  async function signInBrowser(page, email, password = PASSWORD, next = "/admin") {
    await page.goto(`${site.base}/auth/sign-in?next=${encodeURIComponent(next)}`);
    await page.fill("#signin-email", email);
    await page.fill("#signin-password", password);
    await page.click("form:has(#signin-email) button[type=submit]");
  }
  /** Signs in and completes the second step with a real one-time code. `secret` is null for the first enrolment. */
  async function staffSession(viewport) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await signInBrowser(page, owner.email);
    await page.waitForURL("**/admin/mfa", { timeout: 30_000 });
    if (!ownerSecret) {
      await page.click('button:has-text("Set up an authenticator app")');
      await page.waitForSelector("img[alt^='QR code']", { timeout: 20_000 });
      ownerSecret = (await page.locator("code.select-all").first().innerText()).trim();
      assert.match(ownerSecret, /^[A-Z2-7]{16,}$/);
      await shot(page, `admin-00-mfa-setup-${viewport.width}`);
    }
    await page.fill("#m-code", totp(ownerSecret));
    await page.click('button:has-text("Verify")');
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 30_000 });
    return { context, page };
  }

  before(async () => {
    site = await startRealSite();
    db = site.db;
    api = makeApi(site.stack);
    mail = makeMail(site.stack);
    browser = await playwright.chromium.launch();
    owner = await signUpConfirmed({ api, mail, email: uniqueEmail("boss") });
    customerUser = await signUpConfirmed({ api, mail, email: uniqueEmail("buyer") });
    await db.query("insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1,'owner','Owner (test)',true)", [owner.userId]);
  });
  after(async () => {
    await desk?.context.close();
    await phone?.context.close();
    await browser?.close();
    await site?.stop();
  });

  it("the admin area does not exist for the public, for a signed-out visitor, or for a signed-in customer", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    // Signed out: sent to sign in, and back to the admin address afterwards.
    await page.goto(`${site.base}/admin/orders`);
    await page.waitForURL(/\/auth\/sign-in\?reason=required&next=%2Fadmin%2Forders/);
    // A signed-in customer: the ordinary not-found page for every admin address, including the second-step page.
    await signInBrowser(page, customerUser.email, PASSWORD, "/account");
    await page.waitForURL("**/account", { timeout: 30_000 });
    const missing = await (async () => {
      await page.goto(`${site.base}/definitely-not-a-page`);
      return body(page);
    })();
    for (const path of ["/admin", "/admin/orders", "/admin/customers/new", "/admin/payments", "/admin/policies", "/admin/audit", "/admin/mfa", "/admin/orders/00000000-0000-4000-8000-000000000001"]) {
      await page.goto(`${site.base}${path}`);
      assert.equal(await body(page), missing, `${path} must look like any other missing page`);
    }
    // Server actions cannot be driven by a customer either: a forged POST to the second-step page is refused.
    const probe = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/admin/mfa`, { method: "POST", headers: { "next-action": "00".repeat(20), "content-type": "text/plain;charset=UTF-8" }, body: "[]" });
      return r.status;
    }, site.base);
    assert.ok([404, 400, 405, 500].includes(probe) && probe !== 200, `a forged server-action post answered ${probe}`);
    await context.close();
  });

  it("a staff member signs in, is sent to the second step, sets up an authenticator and enters a real code", async () => {
    desk = await staffSession(DESKTOP);
    const text = await body(desk.page);
    assert.match(text, /Overview/);
    assert.match(text, /total orders/i);
    assert.match(text, /awaiting deposit/i);
    assert.match(text, /outstanding balances/i);
    // The public site's header, footer and chat button are not on the admin screen.
    for (const selector of ["body > header", "body > footer", 'a[aria-label="Chat with M1 on WhatsApp"]']) {
      assert.equal(await desk.page.locator(selector).first().isVisible().catch(() => false), false, selector);
    }
    await shot(desk.page, "admin-01-overview-desktop");
    // The staff session is not visible to script on the page.
    assert.equal(await desk.page.evaluate(() => document.cookie), "");
  });

  it("a wrong second-step code is refused, and the right one is needed again in a new sign-in", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signInBrowser(page, owner.email);
    await page.waitForURL("**/admin/mfa", { timeout: 30_000 });
    assert.match(await body(page), /Enter your code/);
    await page.fill("#m-code", "000000");
    await page.click('button:has-text("Verify")');
    await page.waitForFunction(() => document.body.innerText.includes("did not work"), null, { timeout: 15_000 });
    // Still no access: every admin address leads back to the second step.
    await page.goto(`${site.base}/admin/orders`);
    await page.waitForURL("**/admin/mfa", { timeout: 15_000 });
    await context.close();
  });

  it("customers: create a WhatsApp customer, find them by search, issue a claim code shown once", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin/customers/new`);
    await page.fill("#c-name", "Browser Customer");
    await page.fill("#c-phone", "+97455550144");
    await shot(page, "admin-02-new-customer-desktop");
    await page.click('button:has-text("Create customer")');
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    ids.customer = page.url().split("/").pop();
    assert.match(await body(page), /Browser Customer/);

    await page.goto(`${site.base}/admin/customers?q=Browser`);
    assert.match(await body(page), /Browser Customer/);
    await page.goto(`${site.base}/admin/customers?q=zzzz-nobody`);
    assert.match(await body(page), /No customer matches/);

    await page.goto(`${site.base}/admin/customers/${ids.customer}`);
    await page.click('button:has-text("Issue a claim code")');
    const code = (await page.locator('[data-testid="claim-code"]').innerText()).trim();
    assert.match(code, /^[A-Z0-9-]{20,}$/);
    ids.claimCode = code;
    await shot(page, "admin-03-customer-claim-code-desktop");
    // Shown once: after a reload only a hash-based status row exists.
    await page.reload();
    const again = await body(page);
    assert.ok(!again.includes(code), "the code must not be shown again");
    assert.match(again, /active/);
    const stored = await db.query("select code_hash is not null as hashed, (select count(*) from information_schema.columns where table_schema='private' and table_name='customer_claim_codes' and column_name ilike '%code') as code_cols from private.customer_claim_codes limit 1");
    assert.equal(stored.rows[0].hashed, true);
  });

  it("orders: create with verified prices, see the provisional deposit, confirm it, and the deposit is fixed at the confirmed schedule", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin/orders/new?customer=${ids.customer}`);
    await page.fill("#i-desc-1", "Example graphics card");
    await page.fill("#i-price-1", "2,000");
    await page.click('button:has-text("Add an item")');
    await page.fill("#i-desc-2", "Example case");
    await page.fill("#i-price-2", "1000.50");
    assert.equal((await page.locator('[data-testid="order-total"]').innerText()).trim(), "QAR 3,000.50");
    await page.click('button:has-text("Check the deposit")');
    await page.waitForFunction(() => document.querySelector('[data-testid="deposit-preview"]')?.textContent?.includes("QAR"), null, { timeout: 15_000 });
    const preview = await page.locator('[data-testid="deposit-preview"]').innerText();
    assert.match(preview, /QAR 750\.13/, "25 percent of 3,000.50 (just above the QAR 3,000 boundary), to the nearest dirham... see the rule text");
    await shot(page, "admin-04-new-order-desktop");

    // Without ticking that the prices were checked, nothing is created.
    await page.click('button:has-text("Create order")');
    await page.waitForFunction(() => document.body.innerText.includes("Confirm that you have checked the prices"), null, { timeout: 15_000 });
    await settle(page);
    await page.check("#o-verified");
    await page.click('button:has-text("Create order")');
    await page.waitForURL(/\/admin\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    ids.order = page.url().split("/").pop();
    const created = await body(page);
    assert.match(created, /deposit \(provisional\)/i);
    assert.match(created, /QAR 3,000\.50/);
    await shot(page, "admin-05-order-provisional-desktop");

    // Confirm the order: the deposit is fixed once, from the confirmed schedule.
    await page.selectOption("#t-status", "awaiting_deposit");
    await page.click('button:has-text("Update status")');
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("deposit required"), null, { timeout: 20_000 });
    const confirmed = await body(page);
    assert.match(confirmed, /Fixed /);
    const row = (await db.query("select deposit_required_minor, deposit_rate_bps, deposit_fixed_at is not null as fixed from public.orders where id = $1", [ids.order])).rows[0];
    assert.equal(row.fixed, true);
    assert.equal(Number(row.deposit_rate_bps), 2500);
    assert.equal(Number(row.deposit_required_minor), 75013, "25 percent of QAR 3,000.50 = 750.125, rounded to 750.13 (nearest minor unit, half up)");
    assert.match(confirmed, /Deposit not received yet/);
    await shot(page, "admin-06-order-confirmed-desktop");
  });

  it("payments: cash and Fawran, a receipt number each, a reversal that keeps the original, and the money figures follow", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin/orders/${ids.order}`);
    // Not ticking the confirmation records nothing.
    await page.fill("#p-amount", "750.13");
    await page.selectOption("#p-method", "fawran");
    await page.fill("#p-ref", "FAWRAN-E2E-001");
    await page.click('button:has-text("Record payment")');
    await page.waitForFunction(() => document.body.innerText.includes("Confirm that you have received this payment"), null, { timeout: 15_000 });
    await settle(page);
    assert.equal((await db.query("select count(*)::int as n from public.payments where order_id = $1", [ids.order])).rows[0].n, 0);
    await page.check("#p-confirm");
    await page.click('button:has-text("Record payment")');
    await waitFor(page, () => document.body.innerText.includes("Deposit received (recorded by staff)"), "after the Fawran payment");
    let text = await body(page);
    assert.match(text, /R-\d{4}-\d{5}/);
    assert.match(text, /Fawran/);

    // A cash payment for the balance (the form defaults to what is still due).
    await page.selectOption("#p-purpose", "balance");
    await page.fill("#p-amount", "1000");
    await page.selectOption("#p-method", "cash");
    await page.fill("#p-ref", "");
    await page.check("#p-confirm");
    await page.click('button:has-text("Record payment")');
    await waitFor(page, () => (document.body.innerText.match(/R-\d{4}-\d{5}/g) ?? []).length >= 2, "after the cash payment");
    const receipts = (await body(page)).match(/R-\d{4}-\d{5}/g);
    assert.equal(new Set(receipts).size, 2, "every payment has its own receipt number");
    await shot(page, "admin-07-order-payments-desktop");

    // Reverse the cash payment: reason + typed word. The original stays.
    await page.locator("details:has(summary:has-text('Reverse')):visible").last().locator("summary").click();
    const reason = page.locator("input[id*='-rp-']:visible").last();
    await reason.fill("Recorded in error");
    await page.locator("input[id*='-rpc-']:visible").last().fill("REVERSE");
    await page.locator('button:has-text("Reverse payment"):visible').click();
    await waitFor(page, () => document.body.innerText.includes("Reversed"), "after the reversal");
    const rows = (await db.query("select entry_type, amount_minor::int as a from public.payments where order_id = $1 order by created_at", [ids.order])).rows;
    assert.deepEqual(rows.map((r) => [r.entry_type, r.a]), [["payment", 75013], ["payment", 100000], ["reversal", -100000]]);
    const order = (await db.query("select amount_paid_minor::int as paid, balance_due_minor::int as due from public.orders where id = $1", [ids.order])).rows[0];
    assert.equal(order.paid, 75013);
    assert.equal(order.due, 300050 - 75013);

    // Only cash and Fawran are offered.
    const options = await page.locator("#p-method option").allInnerTexts();
    assert.deepEqual(options.map((o) => o.trim()).filter((o) => !o.startsWith("Choose")), ["Cash", "Fawran"]);
  });

  it("tracking: publish a milestone the customer will see, withdraw one, history is kept", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin/orders/${ids.order}`);
    await page.fill("#tr-title", "Parts ordered");
    await page.fill("#tr-msg", "Your components have been ordered from our supplier.");
    await page.click('button:has-text("Publish to customer")');
    await page.waitForFunction(() => document.body.innerText.includes("Parts ordered") && document.body.innerText.includes("Withdraw"), null, { timeout: 20_000 });
    await page.fill("#tr-title", "Posted too early");
    await page.click('button:has-text("Publish to customer")');
    await page.waitForFunction(() => document.body.innerText.includes("Posted too early"), null, { timeout: 20_000 });
    const early = page.locator("li:has-text('Posted too early')").first();
    await early.locator("summary").click();
    await early.locator("input[id^='rt-']").fill("Wrong date");
    await early.locator('button:has-text("Withdraw update")').click();
    await page.waitForFunction(() => document.body.innerText.includes("Withdrawn"), null, { timeout: 20_000 });
    assert.equal((await db.query("select count(*)::int as n from public.order_tracking_events where order_id = $1 and title in ('Parts ordered','Posted too early')", [ids.order])).rows[0].n, 2, "withdrawing never deletes");
  });

  it("the customer claims the code the staff issued and sees exactly what staff published, and nothing private", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signInBrowser(page, customerUser.email, PASSWORD, "/account/claim");
    await page.waitForURL("**/account/claim", { timeout: 30_000 });
    // This customer has no profile yet: the claim page is the first step.
    await page.fill("#claim-code", ids.claimCode);
    await page.click("form:has(#claim-code) button[type=submit]");
    await page.waitForURL((u) => u.pathname === "/account" && u.searchParams.get("linked") === "1", { timeout: 30_000 });
    const ref = (await db.query("select order_ref from public.orders where id = $1", [ids.order])).rows[0].order_ref;
    await page.goto(`${site.base}/account/orders/${ref}`);
    const text = await body(page);
    assert.match(text, /Parts ordered/);
    assert.ok(!text.includes("Posted too early"), "a withdrawn update is not shown to the customer");
    assert.match(text, /QAR 750\.13/);
    assert.ok(!text.includes("FAWRAN-E2E-001"), "the private payment reference is never shown to a customer");
    assert.doesNotMatch(text, /Recorded in error/);
    await shot(page, "admin-08-customer-view-of-the-order");
    // The code worked once.
    const row = await db.query("select count(*)::int as n from private.customer_claim_codes where customer_id = $1 and used_at is not null", [ids.customer]);
    assert.equal(row.rows[0].n, 1);
    await context.close();
  });

  it("the dashboard figures, lists, payments, loyalty, policies and audit pages work on a desktop", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin`);
    const overview = await body(page);
    assert.match(overview, /Latest orders/);
    // The local database keeps what earlier test runs created, so the total is compared with an independent SQL sum, not a fixed figure.
    const expected = Number((await db.query("select coalesce(sum(balance_due_minor), 0)::bigint as n from public.orders where status not in ('pending_confirmation', 'cancelled')")).rows[0].n);
    const money = (minor) => `QAR ${Math.floor(minor / 100).toLocaleString("en-US")}.${String(minor % 100).padStart(2, "0")}`;
    assert.ok(overview.includes(money(expected)), `the overview shows the outstanding balances as ${money(expected)}`);
    assert.match(overview, /outstanding balances/i);
    await shot(page, "admin-09-overview-with-data-desktop");
    for (const [path, expect, name] of [
      ["/admin/customers", /Browser Customer/, "customers"],
      ["/admin/orders", /O-\d{4}-\d{5}/, "orders"],
      ["/admin/orders?status=awaiting_deposit", /O-\d{4}-\d{5}/, "orders-filtered"],
      ["/admin/payments", /Transaction history/, "payments"],
      ["/admin/loyalty", /Balances/, "loyalty"],
      ["/admin/policies", /Deposit schedule/, "policies"],
      ["/admin/audit", /order\.created|payment\.recorded/, "audit"],
    ]) {
      const response = await page.goto(`${site.base}${path}`);
      assert.equal(response.status(), 200, path);
      assert.match(await body(page), expect, path);
      await shot(page, `admin-10-${name}-desktop`);
    }
    await page.goto(`${site.base}/admin/policies`);
    const policies = await body(page);
    assert.match(policies, /Up to QAR 3,000\.00/);
    assert.match(policies, /15%/);
    assert.match(policies, /25%/);
    assert.match(policies, /35%/);
    assert.match(policies, /undecided/i, "refund policy is stated as undecided, not assumed");
    await page.goto(`${site.base}/admin/payments`);
    const payments = await body(page);
    assert.match(payments, /Reversal/);
  });

  it("the deposit schedule can be changed only with a reason, the owner's confirmation and the typed words; it becomes a new version and old orders keep their deposit", async () => {
    const page = desk.page;
    await page.goto(`${site.base}/admin/policies`);
    await page.waitForLoadState("networkidle"); // let the form hydrate before it is used
    await page.fill("#d-reason", "");
    await page.click('button:has-text("Save as a new version")');
    await waitFor(page, () => document.body.innerText.includes("Type CHANGE DEPOSIT SCHEDULE"), "empty schedule form");
    await settle(page);
    const before = (await db.query("select version from private.business_policies where key = 'orders.deposit'")).rows[0].version;
    await page.fill("#d-reason", "Re-saving the confirmed schedule (browser test)");
    await page.check("#d-owner");
    await page.fill("#d-typed", "CHANGE DEPOSIT SCHEDULE");
    await page.click('button:has-text("Save as a new version")');
    await waitFor(page, () => document.body.innerText.includes("was saved as a new version"), "saving the schedule");
    const after = (await db.query("select version from private.business_policies where key = 'orders.deposit'")).rows[0].version;
    assert.equal(after, before + 1);
    assert.equal(Number((await db.query("select deposit_required_minor from public.orders where id = $1", [ids.order])).rows[0].deposit_required_minor), 75013);
    assert.equal((await db.query("select count(*)::int as n from private.business_policy_versions where key = 'orders.deposit' and reason ilike '%browser test%' and changed_by = $1", [owner.userId])).rows[0].n, 1, "the new version records who changed it and why");
    assert.ok((await db.query("select count(*)::int as n from private.audit_log where action = 'policy.changed' and actor::text = $1", [owner.userId])).rows[0].n >= 1);
  });

  it("on a phone the admin screens fit the width: tables become cards, nothing scrolls sideways, every amount is visible", async () => {
    phone = await staffSession(PHONE);
    const page = phone.page;
    const paths = ["/admin", "/admin/customers", `/admin/customers/${ids.customer}`, "/admin/orders", `/admin/orders/${ids.order}`, "/admin/orders/new?customer=" + ids.customer, "/admin/payments", "/admin/loyalty", "/admin/policies", "/admin/audit", "/admin/customers/new"];
    for (const path of paths) {
      const response = await page.goto(`${site.base}${path}`);
      assert.equal(response.status(), 200, path);
      const text = await body(page);
      assert.ok(text.length > 50, path);
      await noSideways(page, path);
      await shot(page, `admin-phone-${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "id").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "overview"}`);
    }
    // The order screen shows the money and the forms on a phone.
    await page.goto(`${site.base}/admin/orders/${ids.order}`);
    const text = await body(page);
    for (const needle of ["QAR 3,000.50", "QAR 750.13", "QAR 2,250.37", "Record a payment"]) assert.ok(text.includes(needle), `phone order screen lacks ${needle}`);
  });

  it("signing out ends the staff session: the old cookie opens nothing, and the second step is needed again", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    await signInBrowser(page, owner.email);
    await page.waitForURL("**/admin/mfa", { timeout: 30_000 });
    await page.fill("#m-code", totp(ownerSecret, Date.now() + 30_000 > 0 ? Date.now() : Date.now()));
    await page.click('button:has-text("Verify")');
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 30_000 });
    const saved = await context.cookies();
    await page.locator('form:has(button:has-text("Sign out")) button[type=submit]:visible').first().click();
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    // Replay the cookies from before sign-out.
    await context.clearCookies();
    await context.addCookies(saved);
    await page.goto(`${site.base}/admin`);
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    // A new sign-in is again first-level only.
    await signInBrowser(page, owner.email);
    await page.waitForURL("**/admin/mfa", { timeout: 30_000 });
    await context.close();
  });
});
