// BROWSER JOURNEYS FOR CUSTOMERS, AGAINST THE OFFICIAL SUPABASE LOCAL STACK.
//
// A real production build of the website, driven by a real browser (Playwright), talking to the real Auth service, REST
// layer, Postgres and Mailpit started by the Supabase CLI. Nothing here is the project's emulator. Every address, name and
// amount is synthetic. Emails are read from Mailpit exactly as a person would read them from their inbox.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { loadPlaywright, startRealSite } from "./site.mjs";
import { jwtClaims, makeApi, makeMail, PASSWORD, readStack, signUpConfirmed, uniqueEmail } from "./stack.mjs";

const playwright = loadPlaywright();
const stack = readStack();
const skip = !stack ? "the official Supabase local stack is not running" : !playwright ? "Playwright is not installed" : false;
const SHOTS = process.env.REAL_E2E_SHOTS || null;
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

describe("customers, in a real browser, against the official Supabase local stack", { skip, timeout: 900_000 }, () => {
  let site, browser, api, mail, db;
  let staffUser;

  const newPage = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
    return { context, page: await context.newPage() };
  };
  const body = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  const cookies = async (context) => (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name));
  const shot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };

  /** Staff fixtures: made the way an owner would, through the admin functions, as an identified second-level staff member. */
  const staffSql = async (sql, params = []) => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staffUser.userId, role: "authenticated", aal: "aal2" })]);
      const result = await db.query(sql, params);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
  };

  async function browserSignUp(page, email, password = PASSWORD) {
    await page.goto(`${site.base}/auth/sign-up`);
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", password);
    await page.click("form:has(#signup-email) button[type=submit]");
    await page.waitForURL("**/auth/check-email", { timeout: 30_000 });
  }
  async function openEmailLink(page, email, { subject, after } = {}) {
    const message = await mail.waitFor(email, { subject, after });
    assert.ok(message, `no email for ${email}`);
    const link = message.links.find((l) => l.includes("token_hash="));
    assert.ok(link, "the email has no link");
    await page.goto(link);
    return link;
  }
  async function browserSignIn(page, email, password = PASSWORD, next) {
    await page.goto(`${site.base}/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    await page.fill("#signin-email", email);
    await page.fill("#signin-password", password);
    await page.click("form:has(#signin-email) button[type=submit]");
  }
  async function createProfile(page, name) {
    await page.waitForURL("**/account", { timeout: 30_000 });
    await page.fill("#profile-name", name);
    await page.fill("#profile-phone", "+97455550177");
    await page.click("form:has(#profile-name) button[type=submit]");
    await page.waitForURL((url) => url.pathname === "/account" && url.searchParams.get("welcome") === "1", { timeout: 30_000 });
  }

  before(async () => {
    site = await startRealSite();
    db = site.db;
    api = makeApi(site.stack);
    mail = makeMail(site.stack);
    browser = await playwright.chromium.launch();
    staffUser = await signUpConfirmed({ api, mail, email: uniqueEmail("owner") });
    await db.query("insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1,'owner','Owner (test)',true)", [staffUser.userId]);
  });
  after(async () => {
    await browser?.close();
    await site?.stop();
  });

  it("the whole sign-up journey: form, confirmation email, link, profile, dashboard, sign-out", async () => {
    const { context, page } = await newPage();
    const email = uniqueEmail("journey");
    await browserSignUp(page, email);
    assert.match(await body(page), /Check your email/);
    // Nothing is signed in yet: the account area still turns the visitor away.
    await page.goto(`${site.base}/account`);
    await page.waitForURL(/\/auth\/sign-in/);
    assert.equal((await cookies(context)).length, 0);

    await openEmailLink(page, email, { subject: "Confirm your M1" });
    await createProfile(page, "Journey Customer");
    assert.match(await body(page), /Your profile is ready/);
    await shot(page, "customer-1-dashboard-new-profile");

    // The session lives in HttpOnly, SameSite=Lax cookies and cannot be read by script on the page.
    const jar = await cookies(context);
    assert.ok(jar.length >= 1);
    for (const cookie of jar) {
      assert.equal(cookie.httpOnly, true, `${cookie.name} must be HttpOnly`);
      assert.equal(cookie.sameSite, "Lax");
    }
    assert.equal(await page.evaluate(() => document.cookie), "", "script on the page sees no cookie");
    assert.equal(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).length), 0, "nothing is kept in web storage");

    await page.goto(`${site.base}/account/orders`);
    assert.match(await body(page), /No orders yet|Your orders/);
    await page.click('form:has(button:has-text("Sign out")) button[type=submit]');
    await page.waitForURL(/\/auth\/sign-in\?reason=signed_out/);
    assert.equal((await cookies(context)).length, 0, "signing out clears the session cookies");
    await page.goto(`${site.base}/account`);
    await page.waitForURL(/\/auth\/sign-in/);
    await context.close();
  });

  it("signing up again with a registered address shows exactly what a new sign-up shows", async () => {
    const { context, page } = await newPage();
    const email = uniqueEmail("dupe");
    await signUpConfirmed({ api, mail, email });
    await browserSignUp(page, email, "Another-long-passphrase-2");
    const dupText = await body(page);
    const other = await newPage();
    await browserSignUp(other.page, uniqueEmail("fresh"));
    assert.equal(dupText, await body(other.page), "the two screens must be identical");
    assert.equal((await cookies(context)).length, 0, "no session for a duplicate sign-up");
    await context.close();
    await other.context.close();
  });

  it("sign-in: a wrong password and an unknown address show the same sentence; the right one signs in and returns to the page asked for", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("signin") });
    const { context, page } = await newPage();
    await browserSignIn(page, user.email, "wrong-password-123");
    await page.waitForFunction(() => document.body.innerText.includes("not correct"), null, { timeout: 15_000 });
    const wrong = await body(page);
    await browserSignIn(page, uniqueEmail("nobody"), "wrong-password-123");
    await page.waitForFunction(() => document.body.innerText.includes("not correct"), null, { timeout: 15_000 });
    assert.equal(await body(page), wrong);
    await browserSignIn(page, user.email, PASSWORD, "/account/orders");
    await page.waitForURL("**/account/orders", { timeout: 30_000 });
    await context.close();
  });

  it("an unconfirmed address cannot sign in, and a tampered or used confirmation link ends at the same error page", async () => {
    const { context, page } = await newPage();
    const email = uniqueEmail("unconf");
    await browserSignUp(page, email);
    await browserSignIn(page, email);
    await page.waitForFunction(() => document.body.innerText.includes("confirm your email"), null, { timeout: 15_000 });
    const link = await openEmailLink(page, email);
    await page.waitForURL(/\/account/, { timeout: 30_000 });
    // The same link, a second time, in a fresh browser.
    const other = await newPage();
    await other.page.goto(link);
    await other.page.waitForURL(/\/auth\/error\?reason=link/);
    const used = await body(other.page);
    await other.page.goto(link.replace(/token_hash=[0-9a-f]+/, "token_hash=deadbeef"));
    await other.page.waitForURL(/\/auth\/error\?reason=link/);
    assert.equal(await body(other.page), used, "a used and a forged link look the same");
    await context.close();
    await other.context.close();
  });

  it("a session that the auth service has ended is turned away at once, even though its token has not expired", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("revoked") });
    const { context, page } = await newPage();
    await browserSignIn(page, user.email);
    await page.waitForURL("**/account", { timeout: 30_000 });
    // Staff end the session in the auth service (for example, after a lost phone).
    await db.query("delete from auth.sessions where user_id = $1", [user.userId]);
    await page.goto(`${site.base}/account`);
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    assert.match(await body(page), /session has ended|Please sign in/);
    await context.close();
  });

  it("an expired access token is renewed from the refresh token, and the new cookies are written (and a damaged cookie is treated as signed out)", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("renew") });
    const { context, page } = await newPage();
    await browserSignIn(page, user.email);
    await page.waitForURL("**/account", { timeout: 30_000 });
    const before = await cookies(context);
    // Rewrite the stored session so its access token is long expired: the next request has to refresh it.
    const joined = before.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join("");
    assert.ok(joined.startsWith("base64-"), "the session is stored in the library's base64 form");
    const session = JSON.parse(Buffer.from(joined.slice("base64-".length), "base64url").toString("utf8"));
    const oldAccess = session.access_token;
    session.expires_at = Math.floor(Date.now() / 1000) - 3600;
    session.expires_in = 0;
    session.access_token = oldAccess.split(".").slice(0, 2).join(".") + ".invalid"; // would also fail its signature
    const forged = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
    await context.clearCookies();
    const template = before[0];
    await context.addCookies([{ name: template.name.replace(/\.\d+$/, ""), value: forged, domain: template.domain, path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
    await page.goto(`${site.base}/account`);
    assert.match(page.url(), /\/account$/, "the refresh kept the person signed in");
    const after = await cookies(context);
    const rebuilt = JSON.parse(Buffer.from(after.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join("").slice("base64-".length), "base64url").toString("utf8"));
    assert.notEqual(rebuilt.access_token, session.access_token, "a fresh access token was written back");
    assert.ok(rebuilt.expires_at > Date.now() / 1000);
    assert.equal(jwtClaims(rebuilt.access_token).sub, user.userId);
    for (const cookie of after) assert.equal(cookie.httpOnly, true);

    // A damaged cookie is not a session.
    await context.clearCookies();
    await context.addCookies([{ name: template.name.replace(/\.\d+$/, ""), value: "base64-not-json", domain: template.domain, path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
    await page.goto(`${site.base}/account`);
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    await context.close();
  });

  it("an earlier WhatsApp record is claimed with a staff-issued code, also by an account that already has a profile; the old restriction is gone", async () => {
    const { context, page } = await newPage();
    const email = uniqueEmail("claimer");
    await browserSignUp(page, email);
    await openEmailLink(page, email);
    await createProfile(page, "Claim Customer"); // a profile first: this used to block claiming for ever

    const customerId = (await staffSql("select admin.create_customer('Earlier WhatsApp Record', '+97455550166', null, 'whatsapp', 'en', null) as id")).rows[0].id;
    const items = JSON.stringify([{ kind: "component", description: "Example GPU", quantity: 1, unit_price_minor: 400000 }]);
    const orderId = (await staffSql("select admin.create_order($1, $2::jsonb) as id", [customerId, items])).rows[0].id;
    await staffSql("select admin.transition_order($1, 'awaiting_deposit', null)", [orderId]);
    await staffSql("select admin.record_payment($1, 'deposit', 100000, 'fawran', now(), null, 'PRIVATE-REF-XYZ', 'PRIVATE-NOTE-XYZ')", [orderId]);
    await staffSql("select admin.publish_tracking_event($1, 'Order confirmed', 'We have confirmed your order.', 'awaiting_deposit')", [orderId]);
    const orderRef = (await db.query("select order_ref from public.orders where id = $1", [orderId])).rows[0].order_ref;
    const code = (await staffSql("select admin.issue_claim_code($1, 24) as code", [customerId])).rows[0].code;

    await page.goto(`${site.base}/account/claim`);
    const claimPage = await body(page);
    assert.match(claimPage, /Link another earlier record/);
    assert.doesNotMatch(claimPage, /already has a customer profile, so a claim code cannot/);
    await shot(page, "customer-2-claim-with-profile");
    // A wrong code first: one generic sentence.
    await page.fill("#claim-code", "ABCDE-FGHJK-LMNPQ-RSTUV");
    await page.click("form:has(#claim-code) button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("That code did not work"), null, { timeout: 15_000 });
    await page.fill("#claim-code", code);
    await page.click("form:has(#claim-code) button[type=submit]");
    await page.waitForURL((u) => u.pathname === "/account" && u.searchParams.get("linked") === "1", { timeout: 30_000 });
    const overview = await body(page);
    assert.match(overview, /linked customer records|earlier orders are now linked/i);
    await shot(page, "customer-3-after-claim");

    await page.goto(`${site.base}/account/orders`);
    assert.match(await body(page), new RegExp(orderRef));
    await page.goto(`${site.base}/account/orders/${orderRef}`);
    const detail = await body(page);
    assert.match(detail, /Order confirmed/);
    assert.match(detail, /QAR 1,000\.00/, "the payment the staff recorded is shown");
    for (const secret of ["PRIVATE-REF-XYZ", "PRIVATE-NOTE-XYZ"]) assert.ok(!detail.includes(secret), `a customer screen shows ${secret}`);
    assert.match(detail, /QAR 1,000\.00/);
    // The deposit the customer sees follows the confirmed schedule (25% of QAR 4,000.00), not a flat half.
    assert.match(detail, /QAR 1,000\.00/);
    assert.doesNotMatch(detail, /QAR 2,000\.00 deposit|50%/);
    await page.goto(`${site.base}/account/claim`);
    assert.match(await body(page), /Records linked to this account/);
    await page.goto(`${site.base}/account/loyalty`);
    await body(page);
    await page.goto(`${site.base}/account/payments`);
    assert.match(await body(page), /QAR 1,000\.00/);
    await context.close();
  });

  it("every order-detail route is limited to the signed-in customer's own records", async () => {
    const [a, b] = await Promise.all([signUpConfirmed({ api, mail, email: uniqueEmail("ownerA") }), signUpConfirmed({ api, mail, email: uniqueEmail("ownerB") })]);
    const mk = async (name, user) => {
      const customerId = (await staffSql("select admin.create_customer($1, null, null, 'whatsapp', 'en', null) as id", [name])).rows[0].id;
      const orderId = (await staffSql("select admin.create_order($1, $2::jsonb) as id", [customerId, JSON.stringify([{ kind: "component", description: `${name} item`, quantity: 1, unit_price_minor: 100000 }])])).rows[0].id;
      const ref = (await db.query("select order_ref from public.orders where id = $1", [orderId])).rows[0].order_ref;
      const code = (await staffSql("select admin.issue_claim_code($1, 24) as code", [customerId])).rows[0].code;
      const claim = await api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: user.session.access_token, body: { p_code: code } });
      assert.equal(claim.status, 200);
      return { customerId, orderId, ref };
    };
    const [ra, rb] = [await mk("Owner A Record", a), await mk("Owner B Record", b)];
    const { context, page } = await newPage();
    await browserSignIn(page, a.email);
    await page.waitForURL("**/account", { timeout: 30_000 });

    const own = await page.goto(`${site.base}/account/orders/${ra.ref}`);
    assert.equal(own.status(), 200);
    assert.match(await body(page), /Owner A Record item/);

    // Another customer's real reference, a made-up one, and every malformed shape: all show the same "not found" page.
    // (The page streams, so the status line may already be 200 when the not-found page replaces the content; what a
    // customer is shown is what matters, and the page tells search engines not to index it.)
    const baselineResponse = await page.goto(`${site.base}/account/orders/O-9999-99999`);
    const missing = await body(page);
    assert.match(missing, /not found|could not find|doesn.t exist/i, "a missing order shows the not-found page");
    assert.ok([200, 404].includes(baselineResponse.status()));
    assert.match((await page.locator('meta[name="robots"]').first().getAttribute("content")) ?? "", /noindex/);
    const probes = [rb.ref, "o-2611-00001", rb.ref.toLowerCase(), `${ra.ref}%20`, `${ra.ref}/../${rb.ref}`, "..%2F..%2Fadmin", "'%20or%201=1--", "%00", "O-2611-0000", ra.ref + "x", rb.orderId, ra.orderId];
    for (const probe of probes) {
      await page.goto(`${site.base}/account/orders/${probe}`);
      const text = await body(page);
      assert.ok(!text.includes("Owner B Record") && !text.includes("Owner B Record item"), `a record of another customer leaked at ${probe}`);
      assert.equal(text, missing, `/account/orders/${probe} must look exactly like a missing order`);
    }
    // Every other account page lists only this customer's money and orders.
    for (const path of ["/account", "/account/orders", "/account/payments", "/account/loyalty", "/account/profile", "/account/claim"]) {
      const response = await page.goto(`${site.base}${path}`);
      assert.equal(response.status(), 200, path);
      const text = await body(page);
      assert.ok(!text.includes(rb.ref) && !text.includes("Owner B Record"), `${path} shows the other customer's data`);
    }
    // Signed out: every route asks to sign in; nothing is rendered.
    await context.clearCookies();
    for (const path of [`/account/orders/${ra.ref}`, "/account/orders", "/account/payments", "/account/loyalty", "/account/profile", "/account/claim", "/account"]) {
      await page.goto(`${site.base}${path}`);
      await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 });
      assert.ok(!(await body(page)).includes(ra.ref), path);
    }
    await context.close();
  });

  it("password recovery: request, email, link, new password, old password refused, other sessions ended", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("forgot") });
    const other = await newPage();
    await browserSignIn(other.page, user.email);
    await other.page.waitForURL("**/account", { timeout: 30_000 });

    const { context, page } = await newPage();
    await page.goto(`${site.base}/auth/sign-in`);
    await page.click("text=Forgot your password?");
    await page.waitForURL("**/auth/forgot-password");
    const started = Date.now() - 1000;
    await page.fill("#forgot-email", user.email);
    await page.click("form:has(#forgot-email) button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("If that address has an account"), null, { timeout: 15_000 });
    const known = await body(page);
    // An address with no account gets the same answer and no email.
    const ghost = uniqueEmail("ghost");
    await page.fill("#forgot-email", ghost);
    await page.click("form:has(#forgot-email) button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("If that address has an account"), null, { timeout: 15_000 });
    assert.equal(await body(page), known);
    assert.equal(await mail.count(ghost), 0);

    const link = await openEmailLink(page, user.email, { subject: "Reset your M1", after: started });
    assert.match(link, /type=recovery/);
    await page.waitForURL("**/auth/reset-password", { timeout: 30_000 });
    await shot(page, "customer-4-reset-password");
    const NEW = "A-brand-new-synthetic-passphrase-7";
    await page.fill("#reset-password", NEW);
    await page.fill("#reset-confirm", "A-different-passphrase-entirely-8");
    await page.click("form:has(#reset-password) button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("not the same"), null, { timeout: 15_000 });
    await page.fill("#reset-password", NEW);
    await page.fill("#reset-confirm", NEW);
    await page.click("form:has(#reset-password) button[type=submit]");
    await page.waitForURL((u) => u.pathname === "/account", { timeout: 30_000 });

    // The old password is refused; the new one works.
    const old = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: PASSWORD } });
    assert.equal(old.status, 400);
    const fresh = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: NEW } });
    assert.equal(fresh.status, 200);
    // The other browser's session ended with the change.
    await other.page.goto(`${site.base}/account`);
    await other.page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    // The link cannot be used twice.
    const third = await newPage();
    await third.page.goto(link);
    await third.page.waitForURL(/\/auth\/error\?reason=link/);
    // Opening the reset page without a session sends the visitor to start again.
    await third.page.goto(`${site.base}/auth/reset-password`);
    await third.page.waitForURL(/\/auth\/sign-in\?reason=reset_link/);
    assert.match(await body(third.page), /reset link/);
    await context.close();
    await other.context.close();
    await third.context.close();
  });

  it("the public site is unchanged with both switches on: the quotation form and the site header work, and no admin or account link is in the public navigation", async () => {
    const { context, page } = await newPage();
    const response = await page.goto(`${site.base}/build-my-pc`);
    assert.equal(response.status(), 200);
    assert.ok(await page.locator("header").first().isVisible());
    assert.ok(await page.locator("form").first().isVisible());
    const links = await page.locator("header a, footer a").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    assert.ok(!links.some((h) => h && (h.startsWith("/admin") || h.startsWith("/account") || h.startsWith("/auth"))), "the public navigation must not advertise the accounts or the admin area");
    const robots = await (await fetch(`${site.base}/robots.txt`)).text();
    assert.doesNotMatch(robots, /admin|account/i);
    await context.close();
  });
});
