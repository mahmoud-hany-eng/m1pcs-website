// THE PUBLIC HEADER'S ACCOUNT CONTROL, IN A REAL BROWSER. A real production build of the website (next start), driven by a real browser (Playwright), against
// four copies of the site that differ only in their switches:
//   off        no switch set (what Production is today)
//   customer   the customer-account switch on (a Preview that has accounts but not the staff dashboard), pointed at the local emulator
//   both       the customer and staff switches on (the development Preview; the staff gateway is NOT configured here, so a staff lookup cannot succeed)
//   production both switches on AND VERCEL_ENV=production (a stray variable on the live site: the gates ignore it)
// plus two copies built from a SECOND build of the source with the switches on at BUILD time (what a Vercel Preview is: the build and the run share their
// variables). The public pages are built once and carry the header's account control only if the switches were on at build time, so the tests that open
// public pages (the home page, Contact, Products, the quotation builder) use these:
//   builtCustomer  built with the switches on, run with only the customer switch (and the emulator)
//   builtBoth      built with the switches on, run with both switches (the staff gateway is NOT configured, so a staff lookup cannot succeed)
//
// SIGNED OUT, the control is the person icon beside Get a Quote with a small menu of EXACTLY two entries: Log in and Create account. SIGNED IN, it is the
// person's name and icon as ONE link straight to their dashboard (no second menu). The public pages are built once and cached, so the control starts
// neutral and learns who is signed in from an uncached route (/auth/header-identity); what that route answers is mocked in the layout tests here (so a
// staff name and a very long name can be drawn at every width) and is real in the journeys against the emulator (a real customer, a real sign-in, a real
// sign-out, a real session that ends).
//
// What it proves: nothing is offered where the routes are off; the button sits at the right of Get a Quote, the same height, vertically centred; it
// opens with the two entries and the right addresses, with a short fade and slide (none with reduced motion); it closes on a click outside, Escape
// (focus back on the button), when focus leaves, when a link is used, and on every change of page; it works from the keyboard; the ARIA state is right;
// it is never hidden behind the page; the signed-in link names the person, leads straight to the right dashboard, never prefetches it, and is cut with
// an ellipsis instead of pushing anything, at 390, 768, 1024, 1280 and 1440 px in three font conditions; signing out or a session that ends brings the
// menu back; nothing about a person is in a cached page or in another visitor's answer; on a phone the hamburger holds the six public links only and the
// account control stays compact beside it; and the staff dashboard is never offered to the public.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { ensureBuild, ensureSwitchedBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";
import { findPgBin } from "./harness.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;

// EXACTLY these two, in this order: nothing else is offered to the signed-out public (no My account, no Track my order, no staff or admin entry).
const ENTRIES = [
  ["Log in", "/auth/sign-in"],
  ["Create account", "/auth/sign-up"],
];
const MENU_BUTTON = '[data-testid="account-menu-button"]';
const MENU = '[data-testid="account-menu"]';
const IDENTITY = '[data-testid="account-identity"]';
const IDENTITY_NAME = '[data-testid="account-identity-name"]';
const HERE = "/auth/check-email";
const PASSWORD = "A-long-synthetic-passphrase-1";

// What /auth/header-identity can answer, as the tests mock it.
const STAFF = { state: "signed_in", kind: "staff", label: "Olivia Owner", href: "/admin" };
const CUSTOMER = { state: "signed_in", kind: "customer", label: "Alice Test", href: "/account" };
const OUT = { state: "signed_out" };
const NAMES = {
  short: "Sam Staff",
  long: "Alexandrina Montgomery-Featherstonehaugh Junior",
  unbroken: "W".repeat(58),
  arabic: "عبد الرحمن محمد الأنصاري الكبير",
};

describe("the public header's account control, in a real browser", { skip, timeout: 1_800_000 }, () => {
  let emu;
  let sites;
  let browser;

  const context = (options = {}) => browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  /** Answers /auth/header-identity from the test (a value, or a function of the call number). Returns the state so a test can change it and count calls. */
  async function mockIdentity(ctx, answer) {
    const state = { answer, calls: 0 };
    await ctx.route("**/auth/header-identity", (route) => {
      state.calls += 1;
      const current = typeof state.answer === "function" ? state.answer(state.calls) : state.answer;
      const { status = 200, delay = 0, body = current } = current && current.__response ? current : {};
      const send = () => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: typeof body === "string" ? body : JSON.stringify(body) });
      return delay ? setTimeout(send, delay) : send();
    });
    return state;
  }
  const respond = (status, body, delay = 0) => ({ __response: true, status, body, delay });
  async function open(site, path = HERE, options = {}, identity = undefined, waitUntil = "networkidle") {
    const ctx = await context(options);
    const mocked = identity === undefined ? null : await mockIdentity(ctx, identity);
    const page = await ctx.newPage();
    const response = await page.goto(`${sites[site].base}${path}`, { waitUntil });
    return { ctx, page, response, mocked };
  }
  const ADDRESSES = 'a[href^="/account"], a[href^="/auth/"], a[href="/admin"], a[href^="/admin/"]';
  /** Every link to an account, sign-in or staff address in the page, or (with `headerOnly`) in the header: the sign-in pages have such links of their own. */
  const accountLinksIn = (page, headerOnly = false) => page.evaluate(([selector, scoped]) => [...(scoped ? document.querySelector("header") : document).querySelectorAll(selector)].map((a) => a.getAttribute("href")), [ADDRESSES, headerOnly]);
  const links = (page) => page.locator(`${MENU} a`).evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  const gone = (page) => page.waitForSelector(MENU, { state: "detached", timeout: 3000 });
  const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent?.trim() ?? "");
  const settled = (page, state) => page.waitForSelector(`[data-testid="header-account"][data-account-state="${state}"]`, { timeout: 8000 });

  before(async () => {
    ensureBuild();
    emu = await startEmulator();
    const supabase = { NEXT_PUBLIC_SUPABASE_URL: emu.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey };
    const switched = ensureSwitchedBuild();
    sites = {
      builtCustomer: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", ...supabase }, { dir: switched }),
      builtBoth: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", ...supabase }, { dir: switched }),
      off: await startWebsite(),
      customer: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", ...supabase }),
      both: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", ...supabase }),
      production: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", VERCEL_ENV: "production", ...supabase }),
    };
    browser = await playwright.chromium.launch();
  });
  after(async () => {
    await browser?.close();
    for (const site of Object.values(sites ?? {})) await site.stop();
    await emu?.stop();
  });

  // =============================================================================================================
  describe("where the routes are off, nothing is offered", () => {
    it("with no switch set (Production today) no public page has an account button or any link to /account, /auth or /admin, and the header is as it was", async () => {
      for (const path of ["/", "/build-my-pc", "/products", "/completed-builds", "/how-it-works", "/contact", "/policies", "/definitely-not-a-page"]) {
        const { ctx, page } = await open("off", path);
        try {
          assert.equal(await page.locator(MENU_BUTTON).count(), 0, `${path}: no account button`);
          assert.equal(await page.locator('[data-testid="header-account"]').count(), 0, `${path}: no account control at all`);
          assert.deepEqual(await accountLinksIn(page), [], `${path}: no link to an account, sign-in or staff address`);
          // the header itself is untouched: the six links, the logo and Get a Quote
          const nav = await page.locator('nav[aria-label="Primary"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
          assert.deepEqual(nav, ["/", "/build-my-pc", "/products", "/completed-builds", "/how-it-works", "/contact"], path);
          assert.equal(await page.locator('header a:has-text("Get a Quote")').first().getAttribute("href"), "/build-my-pc");
        } finally {
          await ctx.close();
        }
      }
    });

    it("a site with the switches off never asks who is signed in: no request to /auth/header-identity, and the route itself is the ordinary 404", async () => {
      const ctx = await context();
      const asked = [];
      ctx.on("request", (request) => request.url().includes("/auth/header-identity") && asked.push(request.url()));
      const page = await ctx.newPage();
      await page.goto(`${sites.off.base}/`, { waitUntil: "networkidle" });
      await page.goto(`${sites.off.base}/contact`, { waitUntil: "networkidle" });
      assert.deepEqual(asked, [], "no request");
      await ctx.close();
      const response = await fetch(`${sites.off.base}/auth/header-identity`, { redirect: "manual" });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("location"), null);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    });

    it("on the account addresses of a site with the switches off, the ordinary 404 shows, still with no account button", async () => {
      for (const path of ["/account", "/auth/sign-in", "/auth/sign-up", "/auth/continue", "/admin"]) {
        const { ctx, page, response } = await open("off", path);
        try {
          assert.equal(response.status(), 404, path);
          assert.equal(await page.locator(MENU_BUTTON).count(), 0, path);
          assert.deepEqual(await accountLinksIn(page), [], path);
        } finally {
          await ctx.close();
        }
      }
    });

    it("on a PRODUCTION deployment with both switches forced on by a stray variable, the routes answer 404 and the header still offers nothing", async () => {
      for (const path of ["/auth/sign-in", "/account", "/admin", "/auth/check-email", "/auth/continue", "/auth/header-identity"]) {
        const { ctx, page, response } = await open("production", path);
        try {
          assert.equal(response.status(), 404, `${path} is closed in production whatever the variables say`);
          assert.equal(await page.locator(MENU_BUTTON).count(), 0, `${path}: no account button`);
          assert.deepEqual(await accountLinksIn(page), [], path);
        } finally {
          await ctx.close();
        }
      }
      const { ctx, page } = await open("production", "/");
      try {
        assert.equal(await page.locator(MENU_BUTTON).count(), 0);
        assert.deepEqual(await accountLinksIn(page), []);
      } finally {
        await ctx.close();
      }
    });

    it("with only the customer switch on, the two entries are the ones shown", async () => {
      const { ctx, page } = await open("customer");
      try {
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual(await links(page), ENTRIES);
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("desktop: the control next to Get a Quote", () => {
    it("is a small circle to the immediate right of Get a Quote, the same height, vertically centred, inside the capsule", async () => {
      const { ctx, page } = await open("both");
      try {
        const quote = await page.locator('header a:has-text("Get a Quote")').first().boundingBox();
        const button = await page.locator(MENU_BUTTON).boundingBox();
        const capsule = await page.locator("header .rounded-full").first().boundingBox();
        assert.ok(quote && button && capsule);
        assert.ok(button.x >= quote.x + quote.width, "to the right of Get a Quote");
        assert.ok(button.x - (quote.x + quote.width) <= 20, `immediately to its right (gap ${Math.round(button.x - (quote.x + quote.width))}px)`);
        assert.ok(Math.abs(button.y + button.height / 2 - (quote.y + quote.height / 2)) <= 1.5, "vertically centred with Get a Quote");
        assert.ok(Math.abs(button.height - quote.height) <= 1.5 && Math.abs(button.width - button.height) <= 0.5, `a circle as tall as the button (${Math.round(button.width)}x${Math.round(button.height)})`);
        assert.ok(button.x + button.width <= capsule.x + capsule.width, "inside the capsule");
        // the header box is as tall as it always was, and still sticky
        const header = await page.locator("header").first().evaluate((el) => ({ h: el.getBoundingClientRect().height, position: getComputedStyle(el).position }));
        assert.deepEqual(header, { h: 80, position: "sticky" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scrolling");
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-signed-out-closed-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 100 } });
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  // THE BAR AT EVERY WIDTH, WHATEVER FONT THE SYSTEM DRAWS, WITH EVERY KIND OF NAME. The first corrective release exists because a CI runner drew a wider
  // fallback font than the developer's machine and the six links wrapped onto two rows at 1024px. The room six links need depends on the visitor's font,
  // which cannot be known, so the layout must not depend on a guess: below 1280px (80em) the six links are in the menu; from 80em they are in the bar with
  // room to spare even in a wide fallback font. Three font conditions are drawn at every width: the site's own fonts, the web fonts blocked (the browser's
  // own fallback), and a deliberately wide fallback (DejaVu Sans with a little letter-spacing, so the test is strict even on a machine without that font).
  // Every width is drawn signed out, and signed in with a short name, a long name, a name with no space to break at, and an Arabic name.
  const WIDTHS = [1024, 1060, 1100, 1280, 1440];
  const NARROW = [360, 390, 768];
  const FONT_CONDITIONS = [
    { name: "the site's own fonts" },
    { name: "the web fonts blocked (the browser's own fallback)", blockFonts: true },
    { name: "a wide fallback font", css: 'html, body, body * { font-family: "DejaVu Sans", Verdana, sans-serif !important; letter-spacing: 0.03em !important; }' },
  ];
  const VARIANTS = [
    { name: "signed out", identity: undefined },
    { name: "signed in, short name", identity: { ...STAFF, label: NAMES.short } },
    { name: "signed in, long name", identity: { ...CUSTOMER, label: NAMES.long } },
    { name: "signed in, a name with no space", identity: { ...STAFF, label: NAMES.unbroken } },
    { name: "signed in, an Arabic name", identity: { ...CUSTOMER, label: NAMES.arabic } },
  ];
  async function openUnder(condition, width, site = "both", path = HERE, options = {}, identity = undefined) {
    const ctx = await context({ viewport: { width, height: 800 }, ...options });
    if (condition.blockFonts) await ctx.route("**/_next/static/media/*.woff2", (route) => route.abort());
    if (identity !== undefined) await mockIdentity(ctx, identity);
    const page = await ctx.newPage();
    await page.goto(`${sites[site].base}${path}`, { waitUntil: "networkidle" });
    if (identity) await settled(page, "signed_in");
    if (condition.css) await page.addStyleTag({ content: condition.css });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    return { ctx, page };
  }
  /** Where everything in the bar is, and whether anything is cut, wrapped or beyond the page. */
  const measureBar = (page) =>
    page.evaluate(() => {
      const box = (el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      };
      const shown = (el) => Boolean(el) && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const burger = document.querySelector('header button[aria-label="Open menu"]');
      const quote = [...document.querySelectorAll("header a")].find((a) => a.textContent.trim() === "Get a Quote" && shown(a));
      const account = document.querySelector('[data-testid="header-account"]');
      const name = document.querySelector('[data-testid="account-identity-name"]');
      const links = nav ? [...nav.querySelectorAll("a")] : [];
      // the lines each link's own text is drawn on (a wrapped label has two)
      const textLines = (a) => {
        const tops = new Set();
        for (const node of a.childNodes) {
          if (node.nodeType !== 3) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
        }
        return tops.size;
      };
      const nameStyle = name ? getComputedStyle(name) : null;
      return {
        navShown: shown(nav), burgerShown: shown(burger), quoteShown: Boolean(quote), accountShown: shown(account),
        logo: box(document.querySelector('header a[aria-label="M1 Gaming PCs home"]')),
        nav: shown(nav) ? box(nav) : null, quote: quote ? box(quote) : null, account: shown(account) ? box(account) : null, burger: shown(burger) ? box(burger) : null,
        capsule: box(document.querySelector("header .rounded-full")),
        name: name && shown(name) ? { ...box(name), clipped: name.scrollWidth > name.clientWidth, ellipsis: nameStyle.textOverflow, overflow: nameStyle.overflowX, nowrap: nameStyle.whiteSpace } : null,
        nameInDom: Boolean(name),
        linkRows: shown(nav) ? new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size : 0,
        linkCount: links.length, linksOneLine: links.every((a) => textLines(a) === 1),
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        headerHeight: document.querySelector("header").getBoundingClientRect().height,
      };
    });

  describe("the header bar from 1024px up, in three font conditions, signed out and signed in", () => {
    it("never wraps, overlaps or overflows: Get a Quote and the account control are always in the bar; the six links are inline from 1280px and in the menu below it", async () => {
      for (const condition of FONT_CONDITIONS) {
        for (const variant of VARIANTS) {
          for (const width of WIDTHS) {
            const where = `${width}px, ${condition.name}, ${variant.name}`;
            const { ctx, page } = await openUnder(condition, width, "both", HERE, {}, variant.identity);
            try {
              const m = await measureBar(page);
              if (SHOTS && condition === FONT_CONDITIONS[0] && variant.name === "signed in, long name" && [1024, 1280, 1440].includes(width)) {
                await page.screenshot({ path: `${SHOTS}/header-signed-in-long-${width}.png`, clip: { x: 0, y: 0, width, height: 96 } });
              }
              if (SHOTS && condition === FONT_CONDITIONS[2] && variant.name === "signed in, long name" && width === 1280) {
                await page.screenshot({ path: `${SHOTS}/header-signed-in-long-1280-wide-fallback.png`, clip: { x: 0, y: 0, width, height: 96 } });
              }
              if (SHOTS && condition === FONT_CONDITIONS[0] && variant.name === "signed out" && [1024, 1440].includes(width)) {
                await page.screenshot({ path: `${SHOTS}/header-signed-out-${width}.png`, clip: { x: 0, y: 0, width, height: 96 } });
              }
              assert.equal(m.sideways, false, `${where}: the page does not scroll sideways`);
              assert.equal(m.headerHeight, 80, `${where}: the header box is as tall as it always was`);
              assert.ok(m.quoteShown && m.accountShown, `${where}: Get a Quote and the account control are in the bar`);
              // everything in the bar is inside the capsule and nothing overlaps its neighbour (left to right)
              const items = [["logo", m.logo], ["links", m.nav], ["Get a Quote", m.quote], ["account control", m.account], ["menu button", m.burger]].filter(([, b]) => b);
              for (const [name, b] of items) assert.ok(b.left >= m.capsule.left - 0.5 && b.right <= m.capsule.right + 0.5, `${where}: the ${name} is inside the capsule`);
              for (let i = 1; i < items.length; i++) {
                assert.ok(items[i - 1][1].right <= items[i][1].left + 0.5, `${where}: the ${items[i - 1][0]} do not overlap the ${items[i][0]} (${Math.round(items[i - 1][1].right)} vs ${Math.round(items[i][1].left)})`);
              }
              // the account control is right beside Get a Quote, on the same line, and (signed in) the name is cut with an ellipsis rather than pushing anything
              assert.ok(m.account.left - m.quote.right <= 20, `${where}: the account control is immediately right of Get a Quote`);
              assert.ok(Math.abs(m.account.top + m.account.height / 2 - (m.quote.top + m.quote.height / 2)) <= 1.5, `${where}: they are vertically centred together`);
              if (variant.identity) {
                assert.ok(m.name, `${where}: the name is drawn`);
                assert.equal(m.name.ellipsis, "ellipsis", `${where}: a long name ends in an ellipsis`);
                assert.equal(m.name.overflow, "hidden", `${where}: and never spills`);
                assert.equal(m.name.nowrap, "nowrap", `${where}: on one line`);
                assert.ok(m.name.left >= m.account.left - 0.5 && m.name.right <= m.account.right + 0.5, `${where}: the name is inside its link`);
                if (variant.identity.label === NAMES.short) assert.equal(m.name.clipped, false, `${where}: a short name is shown whole`);
              }
              // Whenever the six links ARE in the bar (at any width) they are on ONE row, no label wraps inside itself, and there is real room to spare on each
              // side, so a font a little wider than any tested here still cannot make them touch or wrap. (The check the CI runner failed at 1024px.)
              if (m.navShown) {
                assert.equal(m.linkCount, 6, `${where}: six links`);
                assert.equal(m.linkRows, 1, `${where}: the six links are on ONE row`);
                assert.equal(m.linksOneLine, true, `${where}: no link label wraps inside itself`);
                assert.ok(m.nav.left - m.logo.right >= 24 && m.quote.left - m.nav.right >= 24, `${where}: at least 24px free each side of the links (${Math.round(m.nav.left - m.logo.right)} and ${Math.round(m.quote.left - m.nav.right)})`);
              }
              // And the design rule: inline from 1280px, in the menu below it, whatever the font.
              if (width >= 1280) {
                assert.equal(m.navShown, true, `${where}: the six links are in the bar`);
                assert.equal(m.burgerShown, false, `${where}: no menu button when the links are inline`);
              } else {
                assert.equal(m.navShown, false, `${where}: the links are not squeezed into the bar`);
                assert.equal(m.burgerShown, true, `${where}: the menu button is there`);
                assert.ok(m.burger.left - m.account.right <= 24 && m.burger.left >= m.account.right, `${where}: the menu button is next to the account control`);
              }
            } finally {
              await ctx.close();
            }
          }
        }
      }
    });

    it("on a phone and a tablet (360, 390, 768 px) the logo, the account control and the one menu button never overlap or leave the capsule, in every font and for every name", async () => {
      for (const condition of FONT_CONDITIONS) {
        for (const variant of VARIANTS) {
          for (const width of NARROW) {
            const where = `${width}px, ${condition.name}, ${variant.name}`;
            const { ctx, page } = await openUnder(condition, width, "both", HERE, {}, variant.identity);
            try {
              const m = await measureBar(page);
              if (SHOTS && condition === FONT_CONDITIONS[0] && ["signed out", "signed in, long name"].includes(variant.name) && [390, 768].includes(width)) {
                await page.screenshot({ path: `${SHOTS}/header-${variant.name === "signed out" ? "signed-out" : "signed-in-long"}-${width}.png`, clip: { x: 0, y: 0, width, height: 84 } });
              }
              assert.equal(m.sideways, false, `${where}: the page does not scroll sideways`);
              assert.equal(m.navShown, false, `${where}: the six links are in the menu`);
              assert.equal(m.burgerShown, true, `${where}: the menu button is there`);
              assert.equal(await page.locator('header button[aria-label="Open menu"]').count(), 1, `${where}: one hamburger, not two`);
              assert.ok(m.accountShown, `${where}: the account control is there`);
              const items = [["logo", m.logo], ["account control", m.account], ["menu button", m.burger]];
              for (const [name, b] of items) assert.ok(b.left >= m.capsule.left - 0.5 && b.right <= m.capsule.right + 0.5, `${where}: the ${name} is inside the capsule`);
              for (let i = 1; i < items.length; i++) assert.ok(items[i - 1][1].right <= items[i][1].left + 0.5, `${where}: the ${items[i - 1][0]} do not overlap the ${items[i][0]}`);
              assert.ok(Math.abs(m.account.top + m.account.height / 2 - (m.burger.top + m.burger.height / 2)) <= 2.5, `${where}: the account control and the menu button are on one line`);
              if (variant.identity) {
                // Below 640px only the icon is drawn (the name is in the link's accessible name and tooltip); from 640px the name is drawn, cut with an ellipsis.
                if (width < 640) assert.equal(m.name, null, `${where}: icon only on a phone`);
                else assert.ok(m.name && m.name.left >= m.account.left - 0.5 && m.name.right <= m.account.right + 0.5, `${where}: the name is drawn inside its link`);
                assert.equal(await page.locator(IDENTITY).getAttribute("aria-label"), `${variant.identity.label}: open your dashboard`, `${where}: the full name is in the accessible name`);
              }
            } finally {
              await ctx.close();
            }
          }
        }
      }
    });

    it("below 1280px the menu holds the six links (reachable, on screen), without repeating Get a Quote or any account group the bar already has", async () => {
      for (const condition of [FONT_CONDITIONS[0], FONT_CONDITIONS[2]]) {
        for (const width of [1024, 1060, 1100, 1240]) {
          const where = `${width}px, ${condition.name}`;
          const { ctx, page } = await openUnder(condition, width);
          try {
            await page.locator('button[aria-label="Open menu"]').click();
            await page.locator("#mobile-menu").waitFor();
            if (SHOTS && width === 1100 && condition === FONT_CONDITIONS[0]) {
              await page.waitForTimeout(600); // let the opening animation finish
              await page.screenshot({ path: `${SHOTS}/header-tablet-menu-open-1100.png`, clip: { x: 0, y: 0, width, height: 420 } });
            }
            const hrefs = await page.locator('#mobile-menu nav[aria-label="Mobile"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
            assert.deepEqual(hrefs, ["/", "/build-my-pc", "/products", "/completed-builds", "/how-it-works", "/contact"], `${where}: the six links, in order`);
            const m = await page.evaluate(() => {
              const panel = document.querySelector("#mobile-menu > div").getBoundingClientRect();
              const burger = document.querySelector('header button[aria-label="Close menu"]').getBoundingClientRect();
              return {
                panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
                burger: { right: burger.right, bottom: burger.bottom },
                quoteInMenu: [...document.querySelectorAll("#mobile-menu a")].some((a) => a.textContent.trim() === "Get a Quote"),
                accountInMenu: document.querySelectorAll('#mobile-menu [data-testid="mobile-account-links"], #mobile-menu a[href^="/auth"], #mobile-menu a[href^="/account"], #mobile-menu a[href^="/admin"]').length,
                innerWidth: window.innerWidth, innerHeight: window.innerHeight, sideways: document.documentElement.scrollWidth > window.innerWidth,
              };
            });
            assert.ok(m.panel.left >= 0 && m.panel.right <= m.innerWidth && m.panel.bottom <= m.innerHeight, `${where}: the list is fully on screen`);
            assert.ok(m.panel.right <= m.burger.right + 40, `${where}: the list hangs from the right, under the menu button`);
            assert.equal(m.sideways, false, `${where}: no sideways scrolling`);
            assert.equal(m.quoteInMenu && (await page.locator('#mobile-menu a:has-text("Get a Quote")').isVisible()), false, `${where}: Get a Quote is not repeated in the menu`);
            assert.equal(m.accountInMenu, 0, `${where}: no account group or account link is repeated in the menu`);
            // every link is reachable by keyboard and a press on Escape closes the list
            await page.locator('#mobile-menu nav[aria-label="Mobile"] a').first().focus();
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "/build-my-pc", `${where}: Tab moves through the links`);
            await page.keyboard.press("Escape");
            await page.locator("#mobile-menu").waitFor({ state: "detached" });
          } finally {
            await ctx.close();
          }
        }
      }
    });

    it("the menu and the account menu are never open together, and widening the window past 1280px closes the menu and gives the page its scrolling back", async () => {
      const { ctx, page } = await openUnder(FONT_CONDITIONS[0], 1100);
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(MENU).waitFor();
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        await gone(page);
        assert.equal(await page.locator(MENU).count(), 0, "opening the menu closed the account menu");
        await page.locator(MENU_BUTTON).click();
        await page.locator(MENU).waitFor();
        assert.equal(await page.locator("#mobile-menu").count(), 0, "opening the account menu closed the menu");
        await page.locator(MENU_BUTTON).click();
        await gone(page);
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden", "while the menu is open the page behind it does not scroll");
        await page.setViewportSize({ width: 1440, height: 800 });
        await page.locator("#mobile-menu").waitFor({ state: "detached", timeout: 3000 });
        assert.equal(await page.evaluate(() => document.body.style.overflow), "", "the page scrolls again");
        assert.equal(await page.locator('nav[aria-label="Primary"]').isVisible(), true, "and the six links are in the bar");
      } finally {
        await ctx.close();
      }
    });

    it("with reduced motion the menu opens without its drop animation; the account menu keeps its own reduced-motion behaviour (tested below)", async () => {
      const { ctx, page } = await openUnder(FONT_CONDITIONS[0], 1100, "both", HERE, { reducedMotion: "reduce" });
      try {
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        const animation = await page.locator("#mobile-menu > div").evaluate((el) => getComputedStyle(el).animationName);
        assert.equal(animation, "none");
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("signed out: opening, closing, and what is in it", () => {
    it("starts closed (collapsed, no menu, no account links in the page), opens on a click with the two entries and the right addresses, and says so with ARIA", async () => {
      const { ctx, page } = await open("both");
      try {
        const button = page.locator(MENU_BUTTON);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
        assert.equal(await button.getAttribute("aria-label"), "Account menu");
        assert.equal(await button.getAttribute("aria-controls"), null, "nothing to control while closed");
        assert.equal(await page.locator(MENU).count(), 0, "a closed menu is not in the page");
        assert.deepEqual(await accountLinksIn(page, true), [], "so it puts no extra links in the header");
        await button.click();
        await page.locator(MENU).waitFor({ state: "visible" });
        assert.equal(await button.getAttribute("aria-expanded"), "true");
        const id = await page.locator(MENU).getAttribute("id");
        assert.equal(await button.getAttribute("aria-controls"), id, "the button names the element it opens");
        assert.equal(await page.locator(MENU).getAttribute("data-state"), "open");
        assert.deepEqual(await links(page), ENTRIES);
        assert.equal(await page.locator(`${MENU} nav`).getAttribute("aria-label"), "Account");
        // one plain list: no second group, no divider, no staff entry, nothing else
        assert.equal(await page.locator(`${MENU} ul`).count(), 1);
        assert.equal(await page.locator(`${MENU} li`).count(), 2);
        const text = await page.locator(MENU).innerText();
        assert.doesNotMatch(text, /My account|Track my order|Admin|Staff|Dashboard/i);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-signed-out-menu-open-1280.png`, clip: { x: 640, y: 0, width: 640, height: 260 } });
      } finally {
        await ctx.close();
      }
    });

    it("opens with a short fade and slide, and closes with one (the animation is in the page's own styles)", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        const opening = await page.locator(MENU).evaluate((el) => ({ name: getComputedStyle(el).animationName, ms: parseFloat(getComputedStyle(el).animationDuration) * 1000 }));
        assert.equal(opening.name, "account-menu-in");
        assert.ok(opening.ms > 0 && opening.ms <= 250, `a short animation (${opening.ms}ms)`);
        // it starts partly transparent and displaced, and settles
        await page.waitForTimeout(400);
        const done = await page.locator(MENU).evaluate((el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));
        assert.equal(done.opacity, "1");
        assert.ok(done.transform === "none" || done.transform === "matrix(1, 0, 0, 1, 0, 0)");
        await page.keyboard.press("Escape");
        const closing = await page.waitForSelector(`${MENU}[data-state="closing"]`, { timeout: 1000 }).then(() => true, () => false);
        assert.equal(closing, true, "it plays a closing animation before it is removed");
        await gone(page);
        assert.equal(await page.locator(MENU_BUTTON).getAttribute("aria-expanded"), "false");
      } finally {
        await ctx.close();
      }
    });

    it("with the visitor's reduced-motion setting there is no animation at all, and it closes at once", async () => {
      const { ctx, page } = await open("both", HERE, { reducedMotion: "reduce" });
      try {
        await page.locator(MENU_BUTTON).click();
        const name = await page.locator(MENU).evaluate((el) => getComputedStyle(el).animationName);
        assert.equal(name, "none");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(MENU).count(), 0, "gone straight away: no closing phase");
        assert.equal(await page.locator(MENU_BUTTON).getAttribute("aria-expanded"), "false");
      } finally {
        await ctx.close();
      }
    });

    it("a second click on the button closes it; a click outside closes it; neither needs hovering", async () => {
      const { ctx, page } = await open("both");
      try {
        const button = page.locator(MENU_BUTTON);
        await button.click();
        await page.locator(MENU).waitFor();
        await button.click();
        await gone(page);
        await button.click();
        await page.locator(MENU).waitFor();
        await page.mouse.click(300, 500); // on the page, away from the header
        await gone(page);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
        // a touch-style tap (pointerdown with no hover first) also closes it
        await button.click();
        await page.locator(MENU).waitFor();
        await page.touchscreen?.tap?.(300, 500).catch(() => {});
        await page.mouse.click(40, 600);
        await gone(page);
      } finally {
        await ctx.close();
      }
    });

    it("Escape closes it and puts focus back on the button; tabbing out of it closes it", async () => {
      const { ctx, page } = await open("both");
      try {
        const button = page.locator(MENU_BUTTON);
        await button.focus();
        await page.keyboard.press("Enter");
        await page.locator(MENU).waitFor();
        await page.keyboard.press("Tab"); // into the menu: the first link
        assert.equal(await focused(page), "Log in");
        await page.keyboard.press("Escape");
        await gone(page);
        assert.equal(await focused(page), "account-menu-button", "focus is back on the button");
        // Tab through both entries and out: the menu closes
        await page.keyboard.press("Enter");
        await page.locator(MENU).waitFor();
        for (const name of ["Log in", "Create account"]) {
          await page.keyboard.press("Tab");
          assert.equal(await focused(page), name);
        }
        await page.keyboard.press("Tab");
        await gone(page);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
      } finally {
        await ctx.close();
      }
    });

    it("works from the keyboard: Space opens it, ArrowDown opens it and lands on the first entry, the arrows and Home / End move between entries", async () => {
      const { ctx, page } = await open("both");
      try {
        const button = page.locator(MENU_BUTTON);
        await button.focus();
        await page.keyboard.press("Space");
        await page.locator(MENU).waitFor();
        assert.equal(await button.getAttribute("aria-expanded"), "true");
        await page.keyboard.press("Escape");
        await gone(page);
        await button.focus();
        await page.keyboard.press("ArrowDown");
        await page.locator(MENU).waitFor();
        assert.equal(await focused(page), "Log in", "ArrowDown on the button opens the menu on its first entry");
        await page.keyboard.press("ArrowDown");
        assert.equal(await focused(page), "Create account");
        await page.keyboard.press("ArrowDown");
        assert.equal(await focused(page), "Log in", "it wraps");
        await page.keyboard.press("ArrowUp");
        assert.equal(await focused(page), "Create account");
        await page.keyboard.press("Home");
        assert.equal(await focused(page), "Log in");
        await page.keyboard.press("End");
        assert.equal(await focused(page), "Create account");
        // the focus ring is visible on a link reached by keyboard
        await page.keyboard.press("Home");
        const outline = await page.locator(`${MENU} a`).first().evaluate((el) => getComputedStyle(el).outlineStyle);
        assert.notEqual(outline, "none", "a focused entry shows a focus outline");
      } finally {
        await ctx.close();
      }
    });

    it("is never hidden behind the page: the menu is on top, fully inside the screen, and readable (light text on the dark glass)", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(MENU).waitFor();
        await page.waitForTimeout(300);
        const box = await page.locator(MENU).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0 && box.y + box.height <= 800, "inside the screen");
        const topmost = await page.evaluate(() => {
          const menu = document.querySelector('[data-testid="account-menu"]');
          const r = menu.getBoundingClientRect();
          return [0.15, 0.5, 0.85].map((f) => {
            const el = document.elementFromPoint(r.left + r.width * 0.5, r.top + r.height * f);
            return menu.contains(el);
          });
        });
        assert.deepEqual(topmost, [true, true, true], "the menu is the topmost thing at its own points: nothing on the page covers it");
        const colours = await page.locator(`${MENU} a`).first().evaluate((el) => getComputedStyle(el).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number));
        const luminance = (0.2126 * colours[0] + 0.7152 * colours[1] + 0.0722 * colours[2]) / 255;
        assert.ok(luminance >= 0.7, `light text (luminance ${luminance.toFixed(2)})`);
      } finally {
        await ctx.close();
      }
    });

    it("is not hidden behind a page's own content either: on a long page, scrolled, the open menu is still on top of what is under it", async () => {
      // /auth/sign-up has a card in the middle of the page; open the menu while the page is scrolled and check the topmost element.
      const { ctx, page } = await open("both", "/auth/sign-up", { viewport: { width: 1280, height: 500 } });
      try {
        await page.mouse.wheel(0, 400);
        await page.locator(MENU_BUTTON).click();
        await page.locator(MENU).waitFor();
        await page.waitForTimeout(300);
        const ok = await page.evaluate(() => {
          const menu = document.querySelector('[data-testid="account-menu"]');
          const r = menu.getBoundingClientRect();
          return menu.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) && getComputedStyle(document.querySelector("header")).position === "sticky";
        });
        assert.equal(ok, true);
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("using the signed-out menu", () => {
    it("Log in leads to the sign-in page and the menu closes with the change of page; on the sign-in page both entries are still offered, with 'Log in' marked as the current page", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("Log in")`).click();
        await page.waitForURL("**/auth/sign-in");
        await gone(page); // closed with the change of page (it may still be finishing its closing animation as the address changes)
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual(await links(page), ENTRIES, "the menu is always the same two");
        assert.deepEqual(await page.locator(`${MENU} a[aria-current="page"]`).evaluateAll((as) => as.map((a) => a.textContent.trim())), ["Log in"], "the page you are on is marked, not removed");
      } finally {
        await ctx.close();
      }
    });

    it("Create account leads to the sign-up page", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("Create account")`).click();
        await page.waitForURL("**/auth/sign-up");
        await page.locator("#signup-email").waitFor();
        assert.equal(new URL(page.url()).pathname, "/auth/sign-up");
      } finally {
        await ctx.close();
      }
    });

    it("the public menu never offers the staff dashboard, an admin or staff login, My account or Track my order, with every switch on (the dashboard has no public entrance)", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        assert.equal(await page.locator(`${MENU} a[href^="/admin"], ${MENU} a[href^="/account"], ${MENU} a:has-text("Staff"), ${MENU} a:has-text("Admin")`).count(), 0);
        assert.equal(await page.locator('header a[href^="/admin"], header a[href^="/account"]').count(), 0, "and no link to /admin or /account anywhere in the header while signed out");
        assert.doesNotMatch(await page.locator("header").innerText(), /Admin|Staff|My account|Track my order/i);
        // nor in the footer or anywhere on the public pages
        for (const path of ["/", "/contact", "/policies"]) {
          await page.goto(`${sites.builtBoth.base}${path}`, { waitUntil: "networkidle" });
          assert.equal(await page.locator('a[href^="/admin"]').count(), 0, `${path}: no link to /admin`);
          assert.doesNotMatch(await page.locator("body").innerText(), /Admin Login|Staff Login|Staff Dashboard/i, path);
        }
      } finally {
        await ctx.close();
      }
    });

    it("the quotation builder is untouched: the form and its fields are where they were, with the header's account control absent on that public page of a site with the switches off", async () => {
      const { ctx, page } = await open("off", "/build-my-pc");
      try {
        for (const selector of ["#fullName", "#budget", "#quote-category"]) assert.equal(await page.locator(selector).count(), 1, selector);
        assert.equal(await page.locator(MENU_BUTTON).count(), 0);
      } finally {
        await ctx.close();
      }
    });

    it("the quotation builder still works with the account control in the header: it is on the page, its fields are there, and the page is not wider than the screen", async () => {
      const { ctx, page } = await open("builtBoth", "/build-my-pc");
      try {
        for (const selector of ["#fullName", "#budget", "#quote-category"]) assert.equal(await page.locator(selector).count(), 1, selector);
        assert.equal(await page.locator(MENU_BUTTON).count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("signed in: the name and the icon are ONE link straight to the dashboard", () => {
    it("a staff member sees their name; the link goes to /admin; there is no menu, no Log in and no Create account", async () => {
      const { ctx, page } = await open("both", HERE, {}, STAFF);
      try {
        await settled(page, "signed_in");
        assert.equal(await page.locator('[data-testid="header-account"]').getAttribute("data-account-kind"), "staff");
        assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "Olivia Owner");
        assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/admin");
        assert.equal(await page.locator(IDENTITY).getAttribute("aria-label"), "Olivia Owner: open your dashboard");
        assert.equal(await page.locator(IDENTITY).getAttribute("title"), "Olivia Owner");
        assert.equal(await page.locator(MENU_BUTTON).count(), 0, "no account menu button");
        assert.equal(await page.locator(MENU).count(), 0, "no menu");
        const header = await page.locator("header").innerText();
        assert.doesNotMatch(header, /Log in|Create account/i);
        assert.deepEqual(await accountLinksIn(page, true), ["/admin"], "the only account-type link in the header is the dashboard");
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-signed-in-staff-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 100 } });
      } finally {
        await ctx.close();
      }
    });

    it("a customer sees their profile name; the link goes to /account; the icon and the name are the same link", async () => {
      const { ctx, page } = await open("both", HERE, {}, CUSTOMER);
      try {
        await settled(page, "signed_in");
        assert.equal(await page.locator('[data-testid="header-account"]').getAttribute("data-account-kind"), "customer");
        assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "Alice Test");
        assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/account");
        assert.equal(await page.locator(`${IDENTITY} svg`).count(), 1, "the icon is inside the same link as the name");
        assert.equal(await page.locator(`${IDENTITY} ${IDENTITY_NAME}`).count(), 1);
        assert.equal(await page.locator('header a[href="/account"]').count(), 1, "one link, not an icon link and a name link");
        assert.equal(await page.locator("header button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")).filter((l) => /account/i.test(l ?? ""))).then((l) => l.length), 0);
      } finally {
        await ctx.close();
      }
    });

    it("an account with no name shows a safe label (never an invented name) and a lookup that failed leads to the router, not to a dashboard", async () => {
      const unknown = { state: "signed_in", kind: "unknown", label: "My account", href: "/auth/continue" };
      const { ctx, page } = await open("both", HERE, {}, unknown);
      try {
        await settled(page, "signed_in");
        assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "My account");
        assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/auth/continue");
        assert.equal(await page.locator('[data-testid="header-account"]').getAttribute("data-account-kind"), "unknown");
      } finally {
        await ctx.close();
      }
    });

    it("clicking the name goes straight to the dashboard in one step (no second click, no menu): a staff link leaves for /admin, a customer link for /account", async () => {
      for (const [identity, target] of [[STAFF, "/admin"], [CUSTOMER, "/account"]]) {
        const { ctx, page } = await open("both", HERE, {}, identity);
        try {
          await settled(page, "signed_in");
          const seen = [];
          page.on("request", (request) => seen.push(new URL(request.url()).pathname));
          await page.locator(IDENTITY).click();
          await page.waitForURL((url) => url.pathname !== HERE, { timeout: 15_000 });
          assert.ok(seen.includes(target), `${identity.kind}: the browser asked for ${target} (asked for ${seen.join(", ")})`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("the icon alone leads to the same place as the name (a click on the icon, not the text)", async () => {
      const { ctx, page } = await open("both", HERE, {}, CUSTOMER);
      try {
        await settled(page, "signed_in");
        const seen = [];
        page.on("request", (request) => seen.push(new URL(request.url()).pathname));
        await page.locator(`${IDENTITY} svg`).click();
        await page.waitForURL((url) => url.pathname !== HERE, { timeout: 15_000 });
        assert.ok(seen.includes("/account"), `asked for ${seen.join(", ")}`);
      } finally {
        await ctx.close();
      }
    });

    it("the dashboard link is not prefetched: the public pages never load the dashboard in the background", async () => {
      const ctx = await context();
      await mockIdentity(ctx, STAFF);
      const page = await ctx.newPage();
      const requested = [];
      page.on("request", (request) => requested.push(request.url()));
      await page.goto(`${sites.builtBoth.base}/`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      await page.hover(IDENTITY);
      await page.waitForTimeout(600);
      assert.deepEqual(requested.filter((url) => /\/admin(\/|\?|$)/.test(new URL(url).pathname + new URL(url).search)), [], "no request for an admin page before the click");
      await ctx.close();
    });

    it("the name is read from the answer as plain text: markup in it is shown as text, never run, and a hostile answer (wrong address, extra fields, bad kind) is ignored", async () => {
      const hostile = [
        { ...STAFF, label: '<img src=x onerror="window.__pwned=1">Olivia' },
        { ...STAFF, href: "https://evil.example/admin" },
        { ...STAFF, href: "/admin/orders" },
        { ...STAFF, href: "//evil.example" },
        { ...STAFF, kind: "superuser" },
        { state: "signed_in", kind: "staff", href: "/admin" },
        { ...STAFF, label: "" },
        "not an object",
        respond(500, { error: "boom" }),
        respond(200, "<html>not json</html>"),
      ];
      // 1. markup is text
      {
        const { ctx, page } = await open("both", HERE, {}, hostile[0]);
        try {
          await settled(page, "signed_in");
          assert.equal(await page.evaluate(() => window.__pwned), undefined, "nothing ran");
          assert.equal(await page.locator(`${IDENTITY_NAME} img`).count(), 0, "no element was created from the name");
          assert.match(await page.locator(IDENTITY_NAME).innerText(), /^<img src=x onerror=/);
        } finally {
          await ctx.close();
        }
      }
      // 2. everything else is refused and the signed-out control stays
      for (const answer of hostile.slice(1)) {
        const { ctx, page } = await open("both", HERE, {}, answer, "load");
        try {
          await settled(page, "signed_out");
          assert.equal(await page.locator(IDENTITY).count(), 0, `refused: ${JSON.stringify(answer).slice(0, 70)}`);
          assert.equal(await page.locator(MENU_BUTTON).count(), 1);
          assert.equal(await page.locator('a[href="https://evil.example/admin"], a[href="//evil.example"]').count(), 0);
        } finally {
          await ctx.close();
        }
      }
    });

    it("a slow answer shows the signed-out icon first and then swaps to the name without moving the other controls; a failed answer keeps the icon", async () => {
      const { ctx, page, mocked } = await open("both", HERE, {}, respond(200, STAFF, 700));
      try {
        // The page may have settled already (networkidle waits for the answer); what matters is the final state and that nothing jumped.
        await settled(page, "signed_in");
        const m = await measureBar(page);
        assert.ok(m.account.left - m.quote.right <= 20 && m.account.left >= m.quote.right, "the name sits right beside Get a Quote, where the icon was");
        assert.ok(mocked.calls >= 1);
      } finally {
        await ctx.close();
      }
      const second = await open("both", HERE, {}, respond(503, { error: "down" }), "load");
      try {
        await settled(second.page, "signed_out");
        assert.equal(await second.page.locator(MENU_BUTTON).count(), 1, "the identity service being down leaves the ordinary signed-out menu");
      } finally {
        await second.ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("the control follows the session: sign-in, sign-out, a new page, a returning tab, an expired session", () => {
    it("a new page asks again: signing out (the answer changes) brings the Log in / Create account menu back on the next page, and signing in swaps to the name", async () => {
      const ctx = await context();
      const mocked = await mockIdentity(ctx, STAFF);
      const page = await ctx.newPage();
      await page.goto(`${sites.builtBoth.base}/`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      assert.equal(await page.locator(MENU_BUTTON).count(), 0);
      // the session ends elsewhere; the next page the visitor opens (an in-site navigation, no reload) is signed out
      mocked.answer = OUT;
      await page.locator('nav[aria-label="Primary"] a[href="/contact"]').click();
      await page.waitForURL("**/contact");
      await settled(page, "signed_out");
      assert.equal(await page.locator(IDENTITY).count(), 0, "the name is gone");
      await page.locator(MENU_BUTTON).click();
      assert.deepEqual(await links(page), ENTRIES, "the signed-out menu is back");
      // and signing in again brings the name back
      mocked.answer = CUSTOMER;
      await page.keyboard.press("Escape");
      await page.locator('nav[aria-label="Primary"] a[href="/products"]').click();
      await page.waitForURL("**/products");
      await settled(page, "signed_in");
      assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "Alice Test");
      await ctx.close();
    });

    it("a tab that comes back to the front asks again, so a session that expired (or ended in another tab) stops showing the name without a reload", async () => {
      const ctx = await context();
      const mocked = await mockIdentity(ctx, STAFF);
      const page = await ctx.newPage();
      await page.goto(`${sites.builtBoth.base}/contact`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      const before = mocked.calls;
      mocked.answer = OUT; // the session ends
      await page.waitForTimeout(1000); // longer than the minimum gap between asks
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await settled(page, "signed_out");
      assert.ok(mocked.calls > before, "it asked again");
      assert.equal(await page.locator(IDENTITY).count(), 0);
      assert.equal(await page.locator(MENU_BUTTON).count(), 1);
      // and it does not hammer the route: a burst of focus events is one question
      const burst = mocked.calls;
      await page.evaluate(() => {
        for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("focus"));
      });
      await page.waitForTimeout(300);
      assert.ok(mocked.calls - burst <= 1, `a burst of focus events asked ${mocked.calls - burst} times`);
      await ctx.close();
    });

    it("a page restored from the browser's history is asked about again (back after signing out must not show the old name)", async () => {
      const ctx = await context();
      const mocked = await mockIdentity(ctx, STAFF);
      const page = await ctx.newPage();
      await page.goto(`${sites.builtBoth.base}/contact`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      await page.goto(`${sites.builtBoth.base}/policies`, { waitUntil: "networkidle" });
      mocked.answer = OUT;
      await page.goBack({ waitUntil: "networkidle" });
      await settled(page, "signed_out");
      assert.equal(await page.locator(IDENTITY).count(), 0);
      await ctx.close();
    });

    it("an answer that arrives late for an earlier page never overwrites the newer one", async () => {
      const ctx = await context();
      // the first answer is slow and says STAFF; every later answer is fast and says OUT
      const mocked = await mockIdentity(ctx, (n) => (n === 1 ? respond(200, STAFF, 1500) : OUT));
      const page = await ctx.newPage();
      await page.goto(`${sites.builtBoth.base}/contact`, { waitUntil: "load" });
      for (let i = 0; i < 100 && mocked.calls < 1; i++) await page.waitForTimeout(50); // the first (slow) question is on its way, so the page is running
      assert.equal(mocked.calls, 1);
      await page.locator('nav[aria-label="Primary"] a[href="/products"]').click();
      await page.waitForURL("**/products");
      await page.waitForTimeout(2200);
      assert.ok(mocked.calls >= 2);
      assert.equal(await page.locator(IDENTITY).count(), 0, "the stale answer did not win");
      assert.equal(await page.locator(MENU_BUTTON).count(), 1);
      await ctx.close();
    });
  });

  // =============================================================================================================
  // THE REAL THING, against the local emulator (a real sign-in, a real session cookie, the real customer link, the real database policies).
  describe("a real customer, a real session: the name is the linked profile's, and it is never in a cached page or another visitor's answer", () => {
    const signIn = async (page, user, site = "builtCustomer") => {
      await page.goto(`${sites[site].base}/auth/sign-in`);
      await page.fill("#signin-email", user.email);
      await page.fill("#signin-password", user.password);
      await page.click("form:has(#signin-email) button[type=submit]");
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
    };
    const identityFetch = (page, site = "builtCustomer") => page.evaluate(async (base) => {
      const r = await fetch(`${base}/auth/header-identity`, { cache: "no-store", credentials: "same-origin" });
      return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.json().catch(() => null) };
    }, sites[site].base);

    it("signed in as a linked customer, every page of the site names them and links to /account; their profile name is the one the staff table of customers holds", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await signIn(page, emu.users.alice);
      assert.equal(new URL(page.url()).pathname, "/account", "the universal sign-in landed a customer on their dashboard");
      for (const path of ["/account", "/", "/contact", "/build-my-pc"]) {
        await page.goto(`${sites.builtCustomer.base}${path}`, { waitUntil: "networkidle" });
        await settled(page, "signed_in");
        assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "Alice Test", path);
        assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/account", path);
        assert.equal(await page.locator(MENU_BUTTON).count(), 0, `${path}: no signed-out menu`);
      }
      if (SHOTS) {
        await page.goto(`${sites.builtCustomer.base}/account`, { waitUntil: "networkidle" });
        await settled(page, "signed_in");
        await page.screenshot({ path: `${SHOTS}/header-real-customer-account-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 420 } });
      }
      await ctx.close();
    });

    it("the identity answer is private and uncached, carries only a label, a kind and a fixed address, and is the same shape for staff and customers", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await signIn(page, emu.users.alice);
      const answer = await identityFetch(page);
      assert.equal(answer.status, 200);
      assert.match(answer.headers["cache-control"], /private/);
      assert.match(answer.headers["cache-control"], /no-store/);
      assert.match(answer.headers.vary ?? "", /cookie/i);
      assert.match(answer.headers["x-robots-tag"] ?? "", /noindex/);
      assert.equal(answer.headers["x-content-type-options"], "nosniff");
      assert.deepEqual(Object.keys(answer.body).sort(), ["href", "kind", "label", "state"]);
      assert.equal(answer.body.href, "/account");
      assert.equal(answer.body.label, "Alice Test");
      const raw = JSON.stringify(answer.body);
      assert.doesNotMatch(raw, /@|alice\.login|uuid|[0-9a-f]{8}-[0-9a-f]{4}-/i, "no e-mail address and no identifier");
      await ctx.close();
    });

    it("another visitor never gets this person's name: a fresh browser (no cookie) is answered signed_out straight after, and the public pages' HTML never contains the name", async () => {
      const aliceCtx = await context();
      const alice = await aliceCtx.newPage();
      await signIn(alice, emu.users.alice);
      await alice.goto(`${sites.builtCustomer.base}/`, { waitUntil: "networkidle" });
      await settled(alice, "signed_in");
      // a second, separate visitor, immediately after
      const otherCtx = await context();
      const other = await otherCtx.newPage();
      await other.goto(`${sites.builtCustomer.base}/`, { waitUntil: "networkidle" });
      await settled(other, "signed_out");
      assert.deepEqual((await identityFetch(other)).body, { state: "signed_out" });
      assert.equal(await other.locator("body").innerText().then((t) => t.includes("Alice Test")), false);
      // the public pages' own HTML (what a cache would store) has no name, no account data and is not marked private
      for (const path of ["/", "/contact", "/build-my-pc", "/policies"]) {
        const response = await fetch(`${sites.builtCustomer.base}${path}`, { headers: { cookie: (await aliceCtx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } });
        const html = await response.text();
        assert.equal(html.includes("Alice Test"), false, `${path}: the cached page never contains the name`);
        assert.equal(/alice\.login|alice@example/i.test(html), false, `${path}: nor an e-mail address`);
        assert.doesNotMatch(response.headers.get("cache-control") ?? "", /private|no-store/, `${path}: and the page itself stays a public, cacheable page`);
      }
      await aliceCtx.close();
      await otherCtx.close();
    });

    it("signing out brings the Log in / Create account menu back at once, and the next page stays signed out", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await signIn(page, emu.users.alice);
      await page.goto(`${sites.builtCustomer.base}/account`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      await Promise.all([page.waitForURL("**/auth/sign-in**"), page.click("button:has-text('Sign out')")]);
      await settled(page, "signed_out");
      assert.equal(await page.locator(IDENTITY).count(), 0);
      await page.locator(MENU_BUTTON).click();
      assert.deepEqual(await links(page), ENTRIES);
      await page.goto(`${sites.builtCustomer.base}/contact`, { waitUntil: "networkidle" });
      await settled(page, "signed_out");
      await ctx.close();
    });

    it("a session that ends (the cookie is gone) stops showing the name when the visitor comes back to the tab, and protected pages send them to sign in", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await signIn(page, emu.users.alice);
      await page.goto(`${sites.builtCustomer.base}/contact`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      await ctx.clearCookies();
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await settled(page, "signed_out");
      await page.goto(`${sites.builtCustomer.base}/account`);
      assert.equal(new URL(page.url()).pathname, "/auth/sign-in", "a signed-out visitor cannot open the dashboard");
      assert.equal(new URL(page.url()).searchParams.get("next"), "/account");
      await ctx.close();
    });

    it("a new customer account (no linked profile yet) is named with the neutral label, not an invented name, and still goes to their own dashboard", async () => {
      const email = `newcomer.${Date.now().toString(36)}@example.test`;
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${sites.builtCustomer.base}/auth/sign-up`);
      await page.fill("#signup-email", email);
      await page.fill("#signup-password", PASSWORD);
      await page.click("form:has(#signup-email) button[type=submit]");
      await page.waitForURL("**/auth/check-email", { timeout: 20_000 });
      // before the e-mail is confirmed there is no session: the header still offers Log in / Create account
      await settled(page, "signed_out");
      const mail = [...emu.outbox].reverse().find((m) => m.to === email && m.type === "signup");
      assert.ok(mail, "a confirmation e-mail was recorded");
      const device = await context();
      const confirmed = await device.newPage();
      await confirmed.goto(mail.tokenHashLink);
      await confirmed.waitForURL("**/account**", { timeout: 20_000 });
      await confirmed.goto(`${sites.builtCustomer.base}/account`, { waitUntil: "networkidle" });
      await settled(confirmed, "signed_in");
      assert.equal((await confirmed.locator(IDENTITY_NAME).innerText()).trim(), "My account");
      assert.equal(await confirmed.locator(IDENTITY).getAttribute("href"), "/account");
      assert.doesNotMatch(await confirmed.locator("header").innerText(), new RegExp(email.split("@")[0], "i"), "the e-mail address is never used as a name");
      await ctx.close();
      await device.close();
    });

    it("on a site where the staff switch is on but the staff service cannot be asked, a signed-in person is NOT treated as a customer: the link goes to the router, the label is neutral", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${sites.builtBoth.base}/auth/sign-in`);
      await page.fill("#signin-email", emu.users.alice.email);
      await page.fill("#signin-password", emu.users.alice.password);
      await page.click("form:has(#signin-email) button[type=submit]");
      // the router could not check staff membership, so it neither guesses a customer dashboard nor a staff one: it says so and offers Sign out
      await page.waitForLoadState("networkidle");
      assert.doesNotMatch(new URL(page.url()).pathname, /^\/(account|admin)/, "no dashboard was chosen on a failed staff lookup");
      await page.goto(`${sites.builtBoth.base}/`, { waitUntil: "networkidle" });
      await settled(page, "signed_in");
      assert.equal(await page.locator('[data-testid="header-account"]').getAttribute("data-account-kind"), "unknown");
      assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/auth/continue");
      assert.equal((await page.locator(IDENTITY_NAME).innerText()).trim(), "My account");
      await ctx.close();
    });
  });

  // =============================================================================================================
  describe("a phone: the hamburger holds the public links only; the account control is compact beside it", () => {
    const PHONE = { viewport: { width: 390, height: 844 } };
    it("signed out: the account icon is in the bar and opens the two entries; the hamburger menu has the six links and Get a Quote and no account group; the whole menu fits the screen", async () => {
      const { ctx, page } = await open("both", HERE, PHONE);
      try {
        assert.equal(await page.locator(MENU_BUTTON).isVisible(), true, "the compact account icon is in the bar");
        await page.locator(MENU_BUTTON).click();
        await page.locator(MENU).waitFor();
        assert.deepEqual(await links(page), ENTRIES);
        const panel = await page.locator(MENU).boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, `the account menu is inside the screen (${Math.round(panel.x)}–${Math.round(panel.x + panel.width)})`);
        if (SHOTS) {
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${SHOTS}/header-mobile-account-menu-390.png`, clip: { x: 0, y: 0, width: 390, height: 300 } });
        }
        await page.keyboard.press("Escape");
        await gone(page);
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        assert.equal(await page.locator('[data-testid="mobile-account-links"]').count(), 0, "no account group in the hamburger menu");
        assert.equal(await page.locator('#mobile-menu nav[aria-label="Mobile"] a').count(), 6, "the six existing links are still there");
        assert.equal(await page.locator('#mobile-menu a:has-text("Get a Quote")').count(), 1);
        assert.equal(await page.locator('#mobile-menu a[href^="/account"], #mobile-menu a[href^="/auth"], #mobile-menu a[href^="/admin"]').count(), 0);
        const box = await page.locator("#mobile-menu > div").boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 844, `the whole menu fits the screen (${Math.round(box.y + box.height)}px of 844)`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        if (SHOTS) {
          await page.waitForTimeout(600); // let the opening animation finish, so the picture shows the settled menu
          await page.screenshot({ path: `${SHOTS}/header-mobile-menu-390.png` });
        }
      } finally {
        await ctx.close();
      }
    });

    it("signed in: the icon is the link to the dashboard (the name is its accessible name and tooltip), the hamburger is the only menu button, and both are reachable", async () => {
      for (const [identity, target] of [[STAFF, "/admin"], [CUSTOMER, "/account"]]) {
        const { ctx, page } = await open("both", HERE, PHONE, identity);
        try {
          await settled(page, "signed_in");
          assert.equal(await page.locator(IDENTITY).getAttribute("href"), target);
          assert.equal(await page.locator(IDENTITY).getAttribute("aria-label"), `${identity.label}: open your dashboard`);
          assert.equal(await page.locator(IDENTITY_NAME).isVisible(), false, "the name text is not drawn below 640px");
          assert.equal(await page.locator('header button[aria-label="Open menu"]').count(), 1, "one hamburger");
          const link = await page.locator(IDENTITY).boundingBox();
          assert.ok(link.width >= 40 && link.height >= 40, `a touch-sized target (${Math.round(link.width)}x${Math.round(link.height)})`);
          await page.locator('button[aria-label="Open menu"]').click();
          await page.locator("#mobile-menu").waitFor();
          assert.equal(await page.locator("#mobile-menu").getByText(identity.label).count(), 0, "the name is not repeated in the menu");
          assert.equal(await page.locator('#mobile-menu a[href^="/admin"], #mobile-menu a[href^="/account"]').count(), 0);
          if (SHOTS && identity === STAFF) {
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SHOTS}/header-mobile-signed-in-menu-open-390.png`, clip: { x: 0, y: 0, width: 390, height: 520 } });
          }
        } finally {
          await ctx.close();
        }
      }
    });

    it("on a small phone with a short screen the menu scrolls inside itself instead of running off the bottom", async () => {
      const { ctx, page } = await open("both", HERE, { viewport: { width: 360, height: 560 } });
      try {
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        const m = await page.locator("#mobile-menu > div").evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, overflowY: getComputedStyle(el).overflowY }));
        assert.ok(m.bottom <= 560, `the menu ends inside the screen (${Math.round(m.bottom)}px of 560)`);
        assert.equal(m.overflowY, "auto");
        await page.locator('#mobile-menu nav[aria-label="Mobile"] a:has-text("Contact")').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#mobile-menu nav[aria-label="Mobile"] a:has-text("Contact")').isVisible(), true);
      } finally {
        await ctx.close();
      }
    });

    it("an entry in the account menu on a phone leads to its page and closes the menu; the two stay on the sign-in page, with the current one marked", async () => {
      const { ctx, page } = await open("both", HERE, PHONE);
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("Log in")`).click();
        await page.waitForURL("**/auth/sign-in");
        await gone(page);
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual(await links(page), ENTRIES);
        assert.deepEqual(await page.locator(`${MENU} a[aria-current="page"]`).evaluateAll((as) => as.map((a) => a.textContent.trim())), ["Log in"]);
      } finally {
        await ctx.close();
      }
    });

    it("with the switches off the hamburger menu is exactly as before: no account control at all", async () => {
      const { ctx, page } = await open("off", "/", PHONE);
      try {
        assert.equal(await page.locator('[data-testid="header-account"]').count(), 0);
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        assert.equal(await page.locator('[data-testid="mobile-account-links"]').count(), 0);
        assert.equal(await page.locator('#mobile-menu a[href^="/account"], #mobile-menu a[href^="/auth"], #mobile-menu a[href^="/admin"]').count(), 0);
        // Escape still closes it, as it did
        await page.keyboard.press("Escape");
        await page.locator("#mobile-menu").waitFor({ state: "detached" });
      } finally {
        await ctx.close();
      }
    });

    it("larger text settings: with the browser's DEFAULT text size 150% larger (what a visitor sets in the browser) the header still fits, the em-based switch moves the links into the menu earlier, nothing overlaps or scrolls sideways, signed out and signed in", async () => {
      for (const identity of [undefined, { ...STAFF, label: NAMES.long }]) {
        for (const width of [390, 768, 1280, 1440]) {
          const ctx = await context({ viewport: { width, height: 800 } });
          if (identity) await mockIdentity(ctx, identity);
          const page = await ctx.newPage();
          // The browser's own "default font size" setting (not a style on the page): rem sizes AND the em breakpoints follow it, as for a visitor who chose larger text.
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Page.enable");
          await cdp.send("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 20 } });
          await page.goto(`${sites.both.base}${HERE}`, { waitUntil: "networkidle" });
          if (identity) await settled(page, "signed_in");
          await page.waitForTimeout(150);
          const where = `${width}px at 150% default text, ${identity ? "signed in" : "signed out"}`;
          try {
            assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "24px", `${where}: the text really is larger`);
            const m = await measureBar(page);
            assert.equal(m.sideways, false, `${where}: no sideways scrolling`);
            assert.equal(m.navShown, false, `${where}: the six links are in the menu (80em is now 1920px)`);
            assert.equal(m.burgerShown, true, `${where}: the menu button is there`);
            const items = [["logo", m.logo], ["Get a Quote", m.quote], ["account control", m.account], ["menu button", m.burger]].filter(([, b]) => b);
            for (const [name, b] of items) assert.ok(b.left >= m.capsule.left - 0.5 && b.right <= m.capsule.right + 0.5, `${where}: the ${name} is inside the capsule`);
            for (let i = 1; i < items.length; i++) assert.ok(items[i - 1][1].right <= items[i][1].left + 0.5, `${where}: the ${items[i - 1][0]} do not overlap the ${items[i][0]}`);
            await page.locator('button[aria-label="Open menu"]').click();
            await page.locator("#mobile-menu").waitFor();
            const panel = await page.locator("#mobile-menu > div").boundingBox();
            assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 0.5, `${where}: the menu is inside the screen sideways`);
            assert.equal(await page.locator('#mobile-menu nav[aria-label="Mobile"] a').count(), 6);
            if (SHOTS && width === 768 && identity) await page.screenshot({ path: `${SHOTS}/header-signed-in-large-text-768.png`, clip: { x: 0, y: 0, width, height: 420 } });
          } finally {
            await ctx.close();
          }
        }
      }
    });
  });
});
