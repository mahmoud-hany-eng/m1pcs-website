// Browser-level journeys for the customer accounts feature.
//
// WHAT THIS IS. A real production build of the website (next start), driven by a real browser (Playwright), talking to the
// LOCAL SUPABASE EMULATOR (supabase/emulator): a mock of the auth and data APIs in front of a REAL local PostgreSQL that
// has the REAL migrations and row level security. So the Next.js code, the @supabase/ssr cookie handling and the
// database policies are all real; the auth service, the REST layer and email delivery are mocks.
//
// WHAT THIS IS NOT. A test against a real Supabase project. Nothing here proves that the real auth service, REST layer,
// email delivery, rate limits or dashboard settings behave the same. That needs a development Supabase project; see
// supabase/tests/REAL_SUPABASE_CHECKS.md. Every figure, name and address is synthetic.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { SENTINEL } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";
import { findPgBin } from "./harness.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);
const SHOTS = process.env.ACCOUNTS_E2E_SHOTS || null;

const PRIVATE_STRINGS = [SENTINEL.note, SENTINEL.supplier, SENTINEL.reference, SENTINEL.reason, SENTINEL.cost, "internal payment note", "internal reference that must not reach a customer", "cost note"];
const CLAIM_FAILED = "That code did not work.";
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;
let counter = 0;
const uniqueEmail = (label) => `${label}.${Date.now().toString(36)}${counter++}@example.test`;
const PASSWORD = "A-long-synthetic-passphrase-1";

describe("customer accounts: browser journeys against the local emulator", { skip, timeout: 900_000 }, () => {
  let emu;
  let off; // the website with the feature flag OFF
  let on; // the website with the feature flag ON, pointed at the emulator
  let browser;
  let refs;

  /** The page's text once it has finished loading: the streamed page has replaced the loading skeleton. */
  const text = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  /** Waits for a path that carries a given query key. (Polls the page's own URL: a same-path soft navigation does not always raise a navigation event.) */
  const waitForQuery = (page, pathname, key) =>
    page.waitForFunction(([path, name]) => location.pathname === path && new URL(location.href).searchParams.has(name), [pathname, key], { timeout: 20_000 });
  const newContext = (options = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const sessionCookies = async (context) => (await context.cookies()).filter((cookie) => AUTH_COOKIE.test(cookie.name));
  const fillAndSubmit = async (page, fields, formSelector) => {
    for (const [selector, value] of Object.entries(fields)) await page.fill(selector, value);
    await page.click(`${formSelector} button[type=submit]`);
  };

  async function signIn(page, user, next) {
    await page.goto(`${on.base}/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    await fillAndSubmit(page, { "#signin-email": user.email, "#signin-password": user.password }, "form:has(#signin-email)");
  }
  async function signInOk(page, user, next) {
    await signIn(page, user, next);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
  }
  async function signUp(page, email, password = PASSWORD) {
    await page.goto(`${on.base}/auth/sign-up`);
    await fillAndSubmit(page, { "#signup-email": email, "#signup-password": password }, "form:has(#signup-email)");
    await page.waitForURL("**/auth/check-email", { timeout: 20_000 });
  }
  const lastMail = (email, type = "signup") => [...emu.outbox].reverse().find((mail) => mail.to === email && mail.type === type);
  /** Registers and confirms a new account, in a context of its own (a different "device" from the sign-up). */
  async function registerAndConfirm(email) {
    const signUpContext = await newContext();
    const signUpPage = await signUpContext.newPage();
    await signUp(signUpPage, email);
    const mail = lastMail(email);
    assert.ok(mail, "a confirmation email was recorded");
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(mail.tokenHashLink);
    await page.waitForURL("**/account**", { timeout: 20_000 });
    await signUpContext.close();
    return { context, page, email };
  }
  async function viaFetch(path, init = {}) {
    return fetch(`${on.base}${path}`, { redirect: "manual", ...init });
  }

  before(async () => {
    ensureBuild();
    emu = await startEmulator();
    refs = Object.fromEntries(emu.seeded.refs.map((entry) => {
      const [ref, name, status] = entry.split(":");
      return [`${name}:${status}`, ref];
    }));
    off = await startWebsite();
    on = await startWebsite({
      CUSTOMER_ACCOUNTS_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: emu.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey,
      CUSTOMER_ACCOUNTS_PREVIEW_LABEL: "Local emulator preview: demonstration data, not real orders",
    });
    browser = await playwright.chromium.launch();
  });

  after(async () => {
    await browser?.close();
    await on?.stop();
    await off?.stop();
    await emu?.stop();
  });

  // =============================================================================================================
  describe("with the feature flag OFF the public website is exactly as before", () => {
    it("every account and auth address answers the site's ordinary 404, with no redirect and no cookie", async () => {
      for (const path of ["/account", "/account/orders", "/account/orders/O-2611-00001", "/account/claim", "/auth/sign-in", "/auth/sign-up", "/auth/check-email", "/auth/error", "/auth/confirm?token_hash=x&type=signup"]) {
        const response = await fetch(`${off.base}${path}`, { redirect: "manual" });
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get("location"), null, `${path} must not redirect`);
        assert.equal(response.headers.get("set-cookie"), null, `${path} must not set a cookie`);
      }
    });

    it("an account address looks the same as an address that does not exist", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(`${off.base}/definitely-not-a-page`);
      const reference = await text(page);
      for (const path of ["/account", "/auth/sign-in", "/account/orders/O-2611-00001"]) {
        await page.goto(`${off.base}${path}`);
        assert.equal(await text(page), reference, `${path} must render the ordinary 404`);
      }
      await context.close();
    });

    it("the public pages are served as before: no cookie, no forced no-store, no robots header", async () => {
      for (const path of ["/", "/build-my-pc", "/contact", "/policies", "/completed-builds"]) {
        const response = await fetch(`${off.base}${path}`);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("set-cookie"), null, path);
        assert.equal(response.headers.get("x-robots-tag"), null, path);
        assert.doesNotMatch(response.headers.get("cache-control") ?? "", /private/, path);
      }
    });

    it("the WhatsApp quotation journey works with no account", async () => {
      const context = await newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const links = [];
      await context.route(/wa\.me/, (route) => { links.push(route.request().url()); route.abort(); });
      await page.goto(`${off.base}/build-my-pc`, { waitUntil: "networkidle" });
      await page.locator("#quote-category").selectOption({ label: "Other Tech Product" });
      await page.fill("#fullName", "Test Customer");
      await page.fill("#mobile", "55550001");
      await page.getByText("Find me the best option for my requirements", { exact: true }).click();
      for (let i = 0; i < 6 && links.length === 0; i += 1) {
        await page.click("button[type=submit]");
        await page.waitForTimeout(300);
        const invalid = page.locator("input:invalid, textarea:invalid");
        if (await invalid.count()) await invalid.first().fill("test answer");
      }
      assert.equal(links.length, 1, "exactly one WhatsApp link is opened");
      assert.match(decodeURIComponent(links[0]), /Test Customer/);
      assert.ok(!page.url().includes("/auth/"), "no sign-in step");
      await context.close();
    });
  });

  // =============================================================================================================
  describe("signed-out visitors and the sign-in pages (flag ON)", () => {
    it("a visitor with no session is sent to sign in, from every protected address, and no session is created", async () => {
      for (const path of ["/account", "/account/orders", `/account/orders/${refs["Alice Test:awaiting_deposit"]}`, "/account/payments", "/account/loyalty", "/account/profile", "/account/claim"]) {
        const response = await viaFetch(path);
        assert.equal(response.status, 307, path);
        const location = new URL(response.headers.get("location"), on.base);
        assert.equal(location.pathname, "/auth/sign-in", path);
        assert.equal(location.searchParams.get("reason"), "required");
        assert.equal(location.searchParams.get("next"), path);
        assert.ok(!(response.headers.get("set-cookie") ?? "").includes("sb-"), "no session cookie");
      }
    });

    it("account and sign-in pages are never cached or indexed", async () => {
      for (const path of ["/account", "/auth/sign-in", "/auth/sign-up"]) {
        const response = await viaFetch(path);
        assert.match(response.headers.get("cache-control") ?? "", /no-store/, `${path} cache-control`);
        assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/, `${path} x-robots-tag`);
      }
      const html = await (await fetch(`${on.base}/auth/sign-in`)).text();
      assert.match(html, /<meta name="robots" content="noindex/);
    });

    it("the preview label makes a demonstration unmistakable on every page", async () => {
      const html = await (await fetch(`${on.base}/auth/sign-in`)).text();
      assert.match(html, /Local emulator preview: demonstration data, not real orders/);
    });

    it("the sign-in page offers no way to sign up on the quote form, which stays open to everyone", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(`${on.base}/build-my-pc`);
      assert.equal(page.url(), `${on.base}/build-my-pc`);
      assert.ok(await page.locator("#fullName").isVisible(), "the quote form is open without signing in");
      await context.close();
    });

    it("a wrong password and an unknown address get the same answer", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await signIn(page, { email: emu.users.alice.email, password: "not-the-password-1" });
      await page.getByText("The email or password is not correct.").waitFor({ timeout: 15_000 });
      const wrongPassword = await text(page);
      await signIn(page, { email: "nobody.at.all@example.test", password: "not-the-password-1" });
      await page.getByText("The email or password is not correct.").waitFor({ timeout: 15_000 });
      assert.equal(await text(page), wrongPassword);
      assert.equal(new URL(page.url()).pathname, "/auth/sign-in");
      assert.deepEqual(await sessionCookies(context), []);
      await context.close();
    });
  });

  // =============================================================================================================
  describe("sign up, email confirmation, profile and sign out", () => {
    const carol = uniqueEmail("carol");
    let session;

    it("signing up sends a confirmation link, and an unconfirmed account cannot sign in", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await signUp(page, carol);
      assert.match(await text(page), /Check your email/);
      assert.ok(lastMail(carol), "an email was recorded");
      await signIn(page, { email: carol, password: PASSWORD });
      await page.getByText("Please confirm your email address first.").waitFor({ timeout: 15_000 });
      assert.deepEqual(await sessionCookies(context), []);
      await context.close();
    });

    it("the confirmation link works on a different device, signs the customer in, and the session cookie is HttpOnly and SameSite Lax", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(lastMail(carol).tokenHashLink);
      await page.waitForURL("**/account", { timeout: 20_000 });
      assert.match(await text(page), /Welcome to M1/);
      const cookies = await sessionCookies(context);
      assert.ok(cookies.length >= 1, "a session cookie was set");
      for (const cookie of cookies) {
        assert.equal(cookie.httpOnly, true, `${cookie.name} must be HttpOnly`);
        assert.equal(cookie.sameSite, "Lax", `${cookie.name} must be SameSite=Lax`);
        assert.equal(cookie.path, "/");
        assert.equal(cookie.secure, false, "plain http://localhost, so Secure is off (it is on for HTTPS; unit-tested)");
        assert.ok(cookie.expires > 0 && cookie.expires - Date.now() / 1000 <= 30 * 24 * 3600 + 5, `${cookie.name} lifetime is capped at 30 days`);
      }
      assert.equal(await page.evaluate(() => document.cookie), "", "script on the page can read no cookie at all");
      assert.ok(!(await page.content()).includes(cookies[0].value.slice(8, 40)), "the session is not in the page");
      session = { context, page };
    });

    it("a confirmation link works once", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(lastMail(carol).tokenHashLink);
      await page.waitForURL("**/auth/error**");
      assert.match(await text(page), /That link did not work/);
      assert.deepEqual(await sessionCookies(context), []);
      await context.close();
    });

    it("signing up again with a registered address looks exactly like signing up with a new one", async () => {
      const before = emu.outbox.length;
      const context = await newContext();
      const page = await context.newPage();
      await signUp(page, carol);
      const existing = await text(page);
      await signUp(page, uniqueEmail("brand.new"));
      assert.equal(await text(page), existing, "same page");
      assert.equal(emu.outbox.length, before + 1, "no second confirmation is sent for the registered address");
      await context.close();
    });

    it("even a project that reveals registered addresses (email confirmation switched off) gets the same screen", async () => {
      emu.auth.control.revealExistingAddress = true;
      try {
        const context = await newContext();
        const page = await context.newPage();
        await signUp(page, carol);
        const existing = await text(page);
        await signUp(page, uniqueEmail("brand.new.again"));
        assert.equal(await text(page), existing, "the service's 'already registered' error is not shown");
        await context.close();
      } finally {
        emu.auth.control.revealExistingAddress = false;
      }
    });

    it("the email-link form answers the same for an address with an account and one without", async () => {
      const ask = async (email) => {
        const context = await newContext();
        const page = await context.newPage();
        await page.goto(`${on.base}/auth/sign-in`);
        await fillAndSubmit(page, { "#link-email": email }, "form:has(#link-email)");
        await page.getByText("If that address has an account").waitFor({ timeout: 15_000 });
        const answer = await text(page);
        await context.close();
        return answer;
      };
      const unknown = "no.such.account@example.test";
      const accountsBefore = emu.query("select count(*) from auth.users;");
      assert.equal(await ask(emu.users.alice.email), await ask(unknown));
      assert.equal(emu.query("select count(*) from auth.users;"), accountsBefore, "asking for a link never creates an account");
      assert.ok(!emu.outbox.some((mail) => mail.to === unknown), "and sends no email to an address that has none");
    });

    it("a new account has no profile, and must choose between claiming earlier orders and starting new", async () => {
      const { page } = session;
      assert.match(await text(page), /Already ordered through WhatsApp\?/);
      // Choosing "new profile" no longer closes the door: earlier records can still be linked later with a code.
      assert.match(await text(page), /still link those orders afterwards with a claim code/);
      assert.doesNotMatch(await text(page), /cannot be linked to an older one later/);
      assert.equal(emu.query(`select count(*) from public.customer_accounts where user_id = (select id from auth.users where email = '${carol}');`), "0");
    });

    it("creating a profile takes the contact email from the verified account, not from the form, and shows the empty states", async () => {
      const { page } = session;
      await page.fill("#profile-name", "Carol Demo");
      await page.fill("#profile-phone", "+974 5555 0042");
      // Forged fields: the server must read the email from the verified account and never from the form.
      await page.evaluate(() => {
        const form = document.querySelector("form:has(#profile-name)");
        for (const [name, value] of [["email", "forged.address@example.test"], ["p_email", "forged.address@example.test"], ["customer_id", "00000000-0000-4000-8000-0000000000c1"]]) {
          const input = document.createElement("input");
          input.type = "hidden"; input.name = name; input.value = value;
          form.appendChild(input);
        }
      });
      await page.click("form:has(#profile-name) button[type=submit]");
      await waitForQuery(page, "/account", "welcome");
      const overview = await text(page);
      assert.match(overview, /Welcome back, Carol/);
      assert.match(overview, /No orders yet/);
      assert.match(overview, /Nothing due/);
      const row = emu.query(`select c.source || '|' || c.email || '|' || a.linked_via from public.customers c join public.customer_accounts a on a.customer_id = c.id where a.user_id = (select id from auth.users where email = '${carol}');`);
      assert.equal(row, `website|${carol}|self_signup`);
      for (const [path, expected] of [["/account/orders", /No orders yet/], ["/account/payments", /No payments recorded yet/], ["/account/loyalty", /No points yet/]]) {
        await page.goto(`${on.base}${path}`);
        assert.match(await text(page), expected, path);
      }
    });

    it("the profile can be edited, and a customer id in the form changes nothing", async () => {
      const { page } = session;
      await page.goto(`${on.base}/account/profile`);
      await page.fill("#profile-name", "Carol Demo Edited");
      // A forged hidden field is ignored: the server never reads a customer id from a form.
      await page.evaluate(() => {
        const form = document.querySelector("form:has(#profile-name)");
        for (const name of ["customer_id", "id"]) {
          const input = document.createElement("input");
          input.type = "hidden"; input.name = name; input.value = "00000000-0000-4000-8000-0000000000c1";
          form.appendChild(input);
        }
      });
      await page.click("form:has(#profile-name) button[type=submit]");
      await page.getByText("Your details have been saved.").waitFor({ timeout: 15_000 });
      assert.equal(emu.query(`select full_name from public.customers where id = '00000000-0000-4000-8000-0000000000c1';`), "Alice Test", "Alice's record is untouched");
      assert.equal(emu.query(`select full_name from public.customers where email = '${carol}';`), "Carol Demo Edited");
    });

    it("signing out clears the session cookie, and the account is closed again, even with the back button", async () => {
      const { context, page } = session;
      await page.goto(`${on.base}/account`);
      await Promise.all([page.waitForURL("**/auth/sign-in**"), page.click("button:has-text('Sign out')")]);
      assert.match(await text(page), /You have been signed out/);
      assert.deepEqual(await sessionCookies(context), [], "the session cookie is gone");
      await page.goto(`${on.base}/account/orders`);
      assert.equal(new URL(page.url()).pathname, "/auth/sign-in");
      await page.goBack();
      await page.waitForLoadState("networkidle");
      assert.ok(!(await text(page)).includes("Carol"), "no personal data after sign-out");
      await context.close();
    });
  });

  // =============================================================================================================
  describe("a customer sees their own orders, payments, tracking and points, and nothing else", () => {
    let context;
    let page;
    const aliceOpen = () => refs["Alice Test:awaiting_deposit"];
    const aliceDelivered = () => refs["Alice Test:delivered"];
    const aliceCancelled = () => refs["Alice Test:cancelled"];

    before(async () => {
      context = await newContext();
      page = await context.newPage();
      await signInOk(page, emu.users.alice);
    });
    after(async () => context?.close());

    const withoutPrivateData = async (label) => {
      const content = (await page.content()) + (await text(page));
      for (const secret of PRIVATE_STRINGS) assert.ok(!content.includes(secret), `${label} must not contain "${secret}"`);
      assert.doesNotMatch(content, /supplier|margin|profit|internal note|staff note/i, `${label} must not mention supplier, margin or internal notes`);
    };

    it("the overview shows the customer's own figures from the database", async () => {
      await page.goto(`${on.base}/account`);
      const overview = await text(page);
      assert.match(overview, /Welcome back, Alice/);
      assert.match(overview, /QAR 3,000\.00/, "balance: the open order only; the cancelled one is left out");
      assert.match(overview, /670/, "loyalty points");
      assert.match(overview, new RegExp(aliceOpen()), "the newest order");
      await withoutPrivateData("overview");
    });

    it("My orders lists the customer's three orders and not another customer's", async () => {
      await page.goto(`${on.base}/account/orders`);
      const orders = await text(page);
      for (const ref of [aliceOpen(), aliceDelivered(), aliceCancelled()]) assert.match(orders, new RegExp(ref));
      assert.doesNotMatch(orders, new RegExp(refs["Bob Test:pending_confirmation"]), "Bob's order");
      assert.doesNotMatch(orders, new RegExp(refs["Wendy Demo:sourcing"]), "Wendy's order");
      assert.match(orders, /Cancelled/);
      assert.match(orders, /Delivered/);
      await withoutPrivateData("orders");
    });

    it("an order with a deposit still to pay shows the figures, the receipt and the tracking timeline", async () => {
      await page.goto(`${on.base}/account/orders/${aliceOpen()}`);
      const detail = await text(page);
      assert.match(detail, /Order total\s+QAR 4,000\.00/);
      // The demonstration data follows the owner-confirmed schedule (25 percent of a QAR 4,000.00 order), not a flat half.
      assert.match(detail, /Deposit required\s+QAR 1,000\.00/);
      assert.match(detail, /Paid so far\s+QAR 1,000\.00/);
      assert.match(detail, /Remaining balance\s+QAR 3,000\.00/);
      assert.doesNotMatch(detail, /deposit is not fully paid yet/);
      assert.doesNotMatch(detail, /50\s*%|QAR 2,000\.00/, "no demonstration figure implies the withdrawn flat 50 percent");
      assert.match(detail, /RCPT-TEST-1/);
      assert.match(detail, /Order confirmed/);
      assert.match(detail, /Graphics card|Test graphics card/);
      await withoutPrivateData("order detail");
    });

    it("a delivered, fully paid order shows Paid in full, its full timeline in order, and the points it earned", async () => {
      await page.goto(`${on.base}/account/orders/${aliceDelivered()}`);
      const detail = await text(page);
      assert.match(detail, /Paid in full/);
      assert.match(detail, /QAR 6,700\.00/);
      // Read the timeline list itself: some of these words also appear in the status badge above it.
      const timeline = await page.locator("ol").first().innerText();
      const order = ["Order confirmed", "Parts ordered", "Your PC is being built", "Ready for delivery", "Delivered"];
      const positions = order.map((title) => timeline.indexOf(title));
      assert.ok(positions.every((p) => p >= 0), "every update is shown");
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, "oldest first");
      await withoutPrivateData("delivered order");
      await page.goto(`${on.base}/account/loyalty`);
      const loyalty = await text(page);
      assert.match(loyalty, /670/);
      assert.match(loyalty, new RegExp(`Points earned on order ${aliceDelivered()}`));
      assert.match(loyalty, /\+670/);
    });

    it("the payments page lists what is owed and every recorded payment, without internal references", async () => {
      await page.goto(`${on.base}/account/payments`);
      const payments = await text(page);
      assert.match(payments, /Still to pay/);
      assert.match(payments, /QAR 3,000\.00/);
      assert.match(payments, /DEMO-RCPT-0102/);
      assert.match(payments, /DEMO-RCPT-0103/);
      await withoutPrivateData("payments");
    });

    it("on a phone no account page scrolls sideways, and every price on an order is on screen", async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const phonePage = await phone.newPage();
      await signInOk(phonePage, emu.users.alice);
      const paths = ["/account", "/account/orders", `/account/orders/${aliceOpen()}`, `/account/orders/${aliceDelivered()}`, `/account/orders/${aliceCancelled()}`, "/account/payments", "/account/loyalty", "/account/profile", "/account/claim"];
      for (const path of paths) {
        await phonePage.goto(`${on.base}${path}`);
        await text(phonePage);
        const { scroll, width } = await phonePage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
        assert.ok(scroll <= width + 1, `${path} is ${scroll}px wide on a ${width}px screen`);
      }
      // The line totals, not just the descriptions, are inside the visible screen.
      await phonePage.goto(`${on.base}/account/orders/${aliceDelivered()}`);
      await text(phonePage);
      const hidden = await phonePage.evaluate(() => {
        const out = [];
        for (const element of document.querySelectorAll("main li p, main td")) {
          const box = element.getBoundingClientRect();
          if (box.width > 0 && box.right > window.innerWidth + 1) out.push(element.textContent.trim().slice(0, 40));
        }
        return out;
      });
      assert.deepEqual(hidden, [], "nothing in the order is pushed off the right edge");
      await phone.close();
    });

    it("another customer's order is not found, and looks exactly like an order that does not exist", async () => {
      await page.goto(`${on.base}/account/orders/${refs["Bob Test:pending_confirmation"]}`);
      const others = await text(page);
      assert.match(others, /We could not find that/);
      await page.goto(`${on.base}/account/orders/O-2699-99999`);
      assert.equal(await text(page), others);
      for (const bad of ["..%2F..%2Fetc%2Fpasswd", "o-2611-00001", `${aliceOpen()}'%20or%201=1`, "undefined"]) {
        await page.goto(`${on.base}/account/orders/${bad}`);
        assert.match(await text(page), /We could not find that/, bad);
      }
    });

    it("the database, not the page, enforces it: Alice's own token cannot read Bob's rows or any private table through the data API", async () => {
      const login = await (await fetch(`${emu.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: emu.anonKey }, body: JSON.stringify(emu.users.alice) })).json();
      const get = async (path) => (await fetch(`${emu.url}/rest/v1/${path}`, { headers: { apikey: emu.anonKey, authorization: `Bearer ${login.access_token}` } })).json();
      assert.deepEqual(await get(`orders?select=id&order_ref=eq.${refs["Bob Test:pending_confirmation"]}`), []);
      assert.deepEqual(await get(`customers?select=id&id=eq.00000000-0000-4000-8000-0000000000c2`), []);
      assert.equal((await get("order_item_costs?select=*")).code, "PGRST205");
      const payment = await get("payments?select=*&limit=1");
      assert.ok(!Object.keys(payment[0]).some((key) => /internal|note|reference$/.test(key) && key !== "receipt_number"), "no internal column");
    });
  });

  // =============================================================================================================
  describe("sessions: refresh, expiry, revocation, tampering and outages", () => {
    it("an expired access token is renewed quietly and the customer stays signed in", async () => {
      emu.setAccessTtl(4);
      const context = await newContext();
      const page = await context.newPage();
      try {
        await signInOk(page, emu.users.alice);
        const before = (await sessionCookies(context)).map((c) => c.value).join("");
        await page.waitForTimeout(5500);
        await page.goto(`${on.base}/account/orders`);
        assert.match(await text(page), /My orders/);
        assert.equal(new URL(page.url()).pathname, "/account/orders");
        const after = (await sessionCookies(context)).map((c) => c.value).join("");
        assert.notEqual(after, before, "the middleware wrote a fresh session cookie");
      } finally {
        emu.setAccessTtl(3600);
        await context.close();
      }
    });

    it("a revoked session sends the customer to sign in with a clear notice, and they return to where they were going", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await signInOk(page, emu.users.alice);
      await page.goto(`${on.base}/account/payments`);
      emu.revokeAllSessions();
      await page.goto(`${on.base}/account/orders`);
      await page.waitForURL("**/auth/sign-in**");
      const url = new URL(page.url());
      assert.equal(url.searchParams.get("reason"), "expired");
      assert.equal(url.searchParams.get("next"), "/account/orders");
      assert.match(await text(page), /Your session has ended\. Please sign in again\./);
      assert.ok(!(await text(page)).includes("Alice"), "no personal data after expiry");
      await fillAndSubmit(page, { "#signin-email": emu.users.alice.email, "#signin-password": emu.users.alice.password }, "form:has(#signin-email)");
      await page.waitForURL("**/account/orders", { timeout: 20_000 });
      assert.match(await text(page), /My orders/);
      await context.close();
    });

    it("a tampered session cookie is treated as an ended session, never as a signed-in user", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await signInOk(page, emu.users.alice);
      const cookies = await sessionCookies(context);
      await context.addCookies(cookies.map((cookie, index) => ({ name: cookie.name, value: index === 0 ? "base64-AAAAAAAA" : "x", url: on.base })));
      await page.goto(`${on.base}/account`);
      await page.waitForURL("**/auth/sign-in**");
      assert.equal(new URL(page.url()).searchParams.get("reason"), "expired");
      assert.ok(!(await text(page)).includes("Alice"));
      await context.close();
    });

    it("a forged token signed with another key is refused", async () => {
      const context = await newContext();
      const page = await context.newPage();
      const forged = (() => {
        const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
        return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: emu.users.alice.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, session_id: "00000000-0000-4000-8000-000000000999" })}.${"A".repeat(43)}`;
      })();
      const session = Buffer.from(JSON.stringify({ access_token: forged, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "forged", user: { id: emu.users.alice.id } })).toString("base64url");
      await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${session}`, url: on.base }]);
      await page.goto(`${on.base}/account`);
      await page.waitForURL("**/auth/sign-in**");
      assert.ok(!(await text(page)).includes("Alice"));
      await context.close();
    });

    it("when the sign-in service is down the customer sees a calm error, not a sign-out, and recovers when it is back", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await signInOk(page, emu.users.alice);
      emu.setMode("down");
      try {
        await page.goto(`${on.base}/account`);
        await page.getByText("We could not load your account").waitFor({ timeout: 20_000 });
        assert.equal(new URL(page.url()).pathname, "/account", "not redirected to sign in");
        assert.ok(!(await text(page)).includes("Alice"));
        assert.doesNotMatch(await text(page), /503|unavailable|AuthRetry|supabase/i, "no technical detail is shown");
      } finally {
        emu.setMode("up");
      }
      await page.getByRole("button", { name: "Try again" }).click();
      await page.getByText("Welcome back, Alice").waitFor({ timeout: 20_000 });
      await context.close();
    });
  });

  // =============================================================================================================
  describe("claiming an earlier WhatsApp customer with a staff-issued code", () => {
    const wendy = "00000000-0000-4000-8000-0000000000c3";
    const claimAs = async (page, code) => {
      await page.goto(`${on.base}/account/claim`);
      await page.fill("#claim-code", code);
      await page.click("form:has(#claim-code) button[type=submit]");
    };
    const attempts = (email) => Number(emu.query(`select count(*) from private.claim_attempts where user_id = (select id from auth.users where email = '${email}');`));

    it("a wrong, malformed or empty-looking code all give the same single answer, and link nothing", async () => {
      const { context, page, email } = await registerAndConfirm(uniqueEmail("dave"));
      const answers = [];
      for (const code of ["AAAAA-AAAAA-AAAAA-AAAAA", "abc", "AAAAA-AAAAA-AAAAA-AAAA!", "12345678901234567890"]) {
        await claimAs(page, code);
        await page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
        answers.push((await page.locator("[role=alert]").first().innerText()).trim());
      }
      assert.equal(new Set(answers).size, 1, `one message for every failure: ${JSON.stringify(answers)}`);
      assert.doesNotMatch(answers[0], /expired|used|exist|wrong|invalid|attempt|limit|customer/i, "the message names nothing");
      assert.equal(emu.query(`select count(*) from public.customer_accounts where user_id = (select id from auth.users where email = '${email}');`), "0");
      await context.close();
    });

    it("after five failures even the correct code is refused, with the same message, and nothing is linked", async () => {
      const { context, page, email } = await registerAndConfirm(uniqueEmail("dave"));
      for (let i = 0; i < 5; i += 1) {
        await claimAs(page, `0000${i}-00000-00000-00000`);
        await page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
      }
      assert.equal(attempts(email), 5, "every failure is counted by the database");
      const code = emu.issueClaimCode(wendy);
      await claimAs(page, code);
      await page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
      assert.equal(emu.query(`select count(*) from public.customer_accounts where customer_id = '${wendy}';`), "0", "the rate limit held: the right code did not link");
      await context.close();
    });

    it("a valid code links the WhatsApp customer's orders, once, and the customer then sees them without any private data", async () => {
      const { context, page, email } = await registerAndConfirm(uniqueEmail("erin"));
      const code = emu.issueClaimCode(wendy);
      assert.match(code, /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/);
      await claimAs(page, code.toLowerCase());
      await waitForQuery(page, "/account", "linked");
      assert.match(await text(page), /Your earlier orders are now linked/);
      assert.match(await text(page), /Welcome back, Wendy/);
      assert.equal(emu.query(`select linked_via from public.customer_accounts where user_id = (select id from auth.users where email = '${email}');`), "claim_code");
      assert.equal(emu.query(`select (used_at is not null)::text from private.customer_claim_codes where used_by = (select id from auth.users where email = '${email}');`), "true");
      await page.goto(`${on.base}/account/orders/${refs["Wendy Demo:sourcing"]}`);
      const detail = await text(page);
      assert.match(detail, /Gaming monitor/);
      assert.match(detail, /DEMO-RCPT-0201/);
      assert.match(detail, /Parts ordered/);
      const content = (await page.content()) + detail;
      for (const secret of PRIVATE_STRINGS) assert.ok(!content.includes(secret), `the claimed customer's order must not contain "${secret}"`);
      // An account that already has a record may link another one with a new code; the page now says so.
      await page.goto(`${on.base}/account/claim`);
      assert.match(await text(page), /Link another earlier record/);
      assert.match(await text(page), /Records linked to this account/);
      await context.close();
    });

    it("a used code, an expired code and a code for a customer who is already linked all fail the same way", async () => {
      const usedCode = emu.issueClaimCode(wendy);
      const first = await registerAndConfirm(uniqueEmail("frank"));
      await claimAs(first.page, usedCode);
      await waitForQuery(first.page, "/account", "linked");
      await first.context.close();

      const second = await registerAndConfirm(uniqueEmail("gina"));
      await claimAs(second.page, usedCode);
      await second.page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
      const reuse = (await second.page.locator("[role=alert]").first().innerText()).trim();

      const expired = emu.issueClaimCode(wendy);
      emu.exec(`update private.customer_claim_codes set expires_at = now() - interval '1 minute' where used_at is null;`);
      await claimAs(second.page, expired);
      await second.page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
      assert.equal((await second.page.locator("[role=alert]").first().innerText()).trim(), reuse, "expired looks the same as used");
      assert.equal(emu.query(`select count(*) from public.customer_accounts where user_id = (select id from auth.users where email = '${second.email}');`), "0");
      await second.context.close();
    });

    it("matching a customer's email address or phone number never links an account: only a code does", async () => {
      const { context, page, email } = await registerAndConfirm("wendy@example.test");
      assert.match(await text(page), /Already ordered through WhatsApp\?/, "no profile, no linking, despite the same email");
      await page.fill("#profile-name", "Wendy Demo");
      await page.fill("#profile-phone", "+97455550003");
      await page.click("form:has(#profile-name) button[type=submit]");
      await waitForQuery(page, "/account", "welcome");
      assert.match(await text(page), /No orders yet/, "Wendy's orders did not follow the matching email and phone");
      const mine = emu.query(`select customer_id from public.customer_accounts where user_id = (select id from auth.users where email = '${email}');`);
      assert.notEqual(mine, wendy, "a new customer was created instead");
      await context.close();
    });
  });

  // =============================================================================================================
  describe("redirects, one-time links and the public site with accounts on", () => {
    it("no sign-in or confirmation address can send anyone to another site", async () => {
      for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/account/../policies", "javascript:alert(1)"]) {
        const context = await newContext();
        const page = await context.newPage();
        await signInOk(page, emu.users.alice, next);
        const url = new URL(page.url());
        assert.equal(url.origin, on.base, `next=${next}`);
        assert.equal(url.pathname, "/account", `next=${next} falls back to /account`);
        await context.close();
      }
      const context = await newContext();
      const page = await context.newPage();
      await signInOk(page, emu.users.alice, "/account/orders");
      assert.equal(new URL(page.url()).pathname, "/account/orders", "a safe next path is honoured");
      await context.close();
    });

    it("a forged next field in the sign-in form cannot send the customer to another site", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(`${on.base}/auth/sign-in`);
      await page.evaluate(() => {
        const form = document.querySelector("form:has(#signin-email)");
        let field = form.querySelector("input[name=next]");
        if (!field) {
          field = document.createElement("input");
          field.type = "hidden";
          field.name = "next";
          form.appendChild(field);
        }
        field.value = "https://evil.example.test/steal";
      });
      await fillAndSubmit(page, { "#signin-email": emu.users.alice.email, "#signin-password": emu.users.alice.password }, "form:has(#signin-email)");
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
      assert.equal(new URL(page.url()).origin, on.base, "stayed on this site");
      assert.equal(new URL(page.url()).pathname, "/account");
      await context.close();
    });

    it("the confirm address ignores an unsafe next and gives one answer for any bad link", async () => {
      const email = uniqueEmail("hana");
      const signUpContext = await newContext();
      await signUp(await signUpContext.newPage(), email);
      const mail = lastMail(email);
      const unsafe = mail.tokenHashLink.replace(/&next=[^&]*/, "&next=%2F%2Fevil.example");
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(unsafe);
      await page.waitForURL((url) => url.origin === on.base && url.pathname === "/account", { timeout: 20_000 });
      for (const bad of ["/auth/confirm", "/auth/confirm?token_hash=nonsense&type=signup", "/auth/confirm?token_hash=x&type=recovery", "/auth/confirm?token_hash=x&type=invite", "/auth/confirm?code=garbage", `/auth/confirm?token_hash=${"a".repeat(40)}&type=magiclink`]) {
        const fresh = await newContext();
        const freshPage = await fresh.newPage();
        await freshPage.goto(`${on.base}${bad}`);
        assert.equal(new URL(freshPage.url()).pathname, "/auth/error", bad);
        assert.match(await text(freshPage), /That link did not work/, bad);
        assert.deepEqual(await sessionCookies(fresh), [], bad);
        await fresh.close();
      }
      await signUpContext.close();
      await context.close();
    });

    it("a sign-in link sent by email works once", async () => {
      const context = await newContext();
      const page = await context.newPage();
      await page.goto(`${on.base}/auth/sign-in`);
      await fillAndSubmit(page, { "#link-email": emu.users.bob.email }, "form:has(#link-email)");
      await page.getByText("If that address has an account").waitFor({ timeout: 15_000 });
      const mail = lastMail(emu.users.bob.email, "magiclink");
      assert.ok(mail, "a link was recorded");
      const device = await newContext();
      const devicePage = await device.newPage();
      await devicePage.goto(mail.tokenHashLink);
      await devicePage.waitForURL("**/account**", { timeout: 20_000 });
      assert.match(await text(devicePage), /Welcome back, Bob/);
      const again = await newContext();
      const againPage = await again.newPage();
      await againPage.goto(mail.tokenHashLink);
      await againPage.waitForURL("**/auth/error**");
      await Promise.all([context.close(), device.close(), again.close()]);
    });

    it("the default-template link (PKCE code) works in the browser that signed up, and not in another", async () => {
      const email = uniqueEmail("ivy");
      const same = await newContext();
      await signUp(await same.newPage(), email);
      const mail = lastMail(email);
      assert.ok(mail.codeLink, "a code link was recorded");
      const other = await newContext();
      const otherPage = await other.newPage();
      await otherPage.goto(mail.codeLink);
      await otherPage.waitForURL("**/auth/error**");
      assert.deepEqual(await sessionCookies(other), [], "no code verifier on another device, so no session");
      const samePage = await same.newPage();
      await samePage.goto(mail.codeLink);
      await samePage.waitForURL("**/account**", { timeout: 20_000 });
      assert.ok((await sessionCookies(same)).length >= 1);
      await Promise.all([same.close(), other.close()]);
    });

    it("the public site makes no request to the sign-in service, and the quote form is open to visitors, with accounts on", async () => {
      const context = await newContext();
      const page = await context.newPage();
      const toEmulator = [];
      page.on("request", (request) => { if (request.url().startsWith(emu.url)) toEmulator.push(request.url()); });
      for (const path of ["/", "/build-my-pc", "/contact", "/policies"]) {
        const response = await page.goto(`${on.base}${path}`, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, path);
        assert.equal(new URL(page.url()).pathname, path, `${path} does not redirect`);
      }
      assert.deepEqual(toEmulator, []);
      assert.deepEqual(await sessionCookies(context), []);
      await context.close();
    });
  });

  // =============================================================================================================
  describe("screenshots for the report (only when ACCOUNTS_E2E_SHOTS is set)", { skip: SHOTS ? false : "set ACCOUNTS_E2E_SHOTS=<directory> to capture" }, () => {
    it("captures the screens at desktop and mobile width", async () => {
      mkdirSync(SHOTS, { recursive: true });
      const sizes = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
      const shot = async (page, name, size) => {
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${SHOTS}/${size}-${name}.png`, fullPage: true });
      };
      for (const [size, viewport] of Object.entries(sizes)) {
        const open = async () => {
          const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
          return { context, page: await context.newPage() };
        };
        const visitor = await open();
        for (const [name, path] of [["01-sign-in", "/auth/sign-in"], ["02-sign-up", "/auth/sign-up"], ["03-check-email", "/auth/check-email"], ["04-session-ended", "/auth/sign-in?reason=expired&next=%2Faccount%2Forders"], ["05-link-failed", "/auth/error?reason=link"]]) {
          await visitor.page.goto(`${on.base}${path}`);
          await shot(visitor.page, name, size);
        }
        await visitor.context.close();

        const alice = await open();
        await signInOk(alice.page, emu.users.alice);
        for (const [name, path] of [
          ["10-overview", "/account"], ["11-orders", "/account/orders"], ["12-order-open", `/account/orders/${refs["Alice Test:awaiting_deposit"]}`],
          ["13-order-delivered", `/account/orders/${refs["Alice Test:delivered"]}`], ["14-payments", "/account/payments"], ["15-loyalty", "/account/loyalty"],
          ["16-profile", "/account/profile"], ["17-claim-linked", "/account/claim"], ["18-not-found", `/account/orders/${refs["Bob Test:pending_confirmation"]}`],
        ]) {
          await alice.page.goto(`${on.base}${path}`);
          await shot(alice.page, name, size);
        }
        emu.setMode("down");
        await alice.page.goto(`${on.base}/account`);
        await alice.page.getByText("We could not load your account").waitFor({ timeout: 20_000 });
        await shot(alice.page, "19-error-state", size);
        emu.setMode("up");
        await alice.context.close();

        const eve = await open();
        await signInOk(eve.page, emu.users.eve);
        await shot(eve.page, "20-set-up-account", size);
        await eve.page.goto(`${on.base}/account/claim`);
        await shot(eve.page, "21-claim-code", size);
        await eve.page.fill("#claim-code", "AAAAA-AAAAA-AAAAA-AAAAA");
        await eve.page.click("form:has(#claim-code) button[type=submit]");
        await eve.page.getByText(CLAIM_FAILED).waitFor({ timeout: 15_000 });
        await shot(eve.page, "22-claim-failed", size);
        await eve.context.close();

        const fresh = await registerAndConfirm(uniqueEmail(`empty-${size}`));
        await fresh.page.fill("#profile-name", "Sam Newcustomer");
        await fresh.page.click("form:has(#profile-name) button[type=submit]");
        await waitForQuery(fresh.page, "/account", "welcome");
        await shot(fresh.page, "30-overview-empty", size);
        for (const [name, path] of [["31-orders-empty", "/account/orders"], ["32-payments-empty", "/account/payments"], ["33-loyalty-empty", "/account/loyalty"]]) {
          await fresh.page.goto(`${on.base}${path}`);
          await shot(fresh.page, name, size);
        }
        await fresh.context.close();
      }
    });
  });
});
