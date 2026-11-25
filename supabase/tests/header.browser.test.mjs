// THE PUBLIC HEADER'S ACCOUNT MENU, IN A REAL BROWSER. A real production build of the website (next start), driven by a real browser (Playwright), against
// four copies of the site that differ only in their switches:
//   off        no switch set (what Production is today)
//   customer   the customer-account switch on (a Preview that has accounts but not the staff dashboard)
//   both       the customer and staff switches on (the development Preview)
//   production both switches on AND VERCEL_ENV=production (a stray variable on the live site: the gates ignore it)
//
// The header is evaluated where the page is rendered. The account, sign-in and sign-up pages are rendered per visitor, so the menu is exercised on
// /auth/check-email (a page where no entry is redundant, so all four entries show). The public pages are built once, with the environment of the
// BUILD (on Vercel the build and the run of a deployment share it); for a Preview that has the switches on at build time this was checked by hand,
// and here the public pages are checked in the default build: they must carry no account link of any kind.
//
// What it proves: nothing is offered where the routes are off (no button, no link to /account, /auth or /admin, on any page, including the 404 page of
// a route that does not exist); the button sits at the right of Get a Quote, the same height, vertically centred; it opens on a click with the four
// entries and the right addresses, with a short fade and slide (none with reduced motion); it closes on a click outside, on Escape (focus back on the
// button), when focus leaves, when a link is used, and on every change of page; it works from the keyboard (Enter, Space, ArrowDown, arrows, Home, End);
// the ARIA state is right; it is never hidden behind the page's own content; on a phone the same entries are in the hamburger menu without breaking it;
// the Staff Dashboard link is only a link: a visitor with no session is sent to sign in, not to the dashboard.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { ensureBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";
import { findPgBin } from "./harness.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;

const ENTRIES = [
  ["My Account", "/account"],
  ["Customer Sign In", "/auth/sign-in"],
  ["Create Account", "/auth/sign-up"],
  ["Staff Dashboard", "/admin"],
];
const MENU_BUTTON = '[data-testid="account-menu-button"]';
const MENU = '[data-testid="account-menu"]';
const HERE = "/auth/check-email";

describe("the public header's account menu, in a real browser", { skip, timeout: 900_000 }, () => {
  let emu;
  let sites;
  let browser;

  const context = (options = {}) => browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  async function open(site, path = HERE, options = {}) {
    const ctx = await context(options);
    const page = await ctx.newPage();
    const response = await page.goto(`${sites[site].base}${path}`, { waitUntil: "networkidle" });
    return { ctx, page, response };
  }
  const ADDRESSES = 'a[href^="/account"], a[href^="/auth/"], a[href="/admin"], a[href^="/admin/"]';
  /** Every link to an account, sign-in or staff address in the page, or (with `headerOnly`) in the header: the sign-in pages have such links of their own. */
  const accountLinksIn = (page, headerOnly = false) => page.evaluate(([selector, scoped]) => [...(scoped ? document.querySelector("header") : document).querySelectorAll(selector)].map((a) => a.getAttribute("href")), [ADDRESSES, headerOnly]);
  const links = (page) => page.locator(`${MENU} a`).evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  const gone = (page) => page.waitForSelector(MENU, { state: "detached", timeout: 3000 });
  const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent?.trim() ?? "");

  before(async () => {
    ensureBuild();
    emu = await startEmulator();
    const supabase = { NEXT_PUBLIC_SUPABASE_URL: emu.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey };
    sites = {
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

    it("on the account addresses of a site with the switches off, the ordinary 404 shows, still with no account button", async () => {
      for (const path of ["/account", "/auth/sign-in", "/auth/sign-up", "/admin"]) {
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
      for (const path of ["/auth/sign-in", "/account", "/admin", "/auth/check-email"]) {
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

    it("with only the customer switch on there is no Staff Dashboard entry, and the three customer entries are the ones shown", async () => {
      const { ctx, page } = await open("customer");
      try {
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual(await links(page), ENTRIES.slice(0, 3));
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("desktop: the button next to Get a Quote", () => {
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
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-closed-desktop.png`, clip: { x: 0, y: 0, width: 1280, height: 100 } });
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  // THE BAR AT EVERY WIDTH FROM 1024px UP, WHATEVER FONT THE SYSTEM DRAWS. The first corrective release exists because a CI runner drew a wider fallback
  // font than the developer's machine and the six links wrapped onto two rows at 1024px. The room six links need depends on the visitor's font, which
  // cannot be known, so the layout must not depend on a guess: from 1024px the bar holds the logo, Get a Quote and the account button (and the menu
  // button); the six links are in the bar only from 80em (1280px at the default text size), where there is room to spare even in a wide fallback font.
  // Three font conditions are drawn at every width: the site's own fonts, the web fonts blocked (the browser's own fallback), and a deliberately wide
  // fallback (DejaVu Sans with a little letter-spacing, so the test is strict even on a machine without that font).
  const WIDTHS = [1024, 1060, 1100, 1280, 1440];
  const FONT_CONDITIONS = [
    { name: "the site's own fonts" },
    { name: "the web fonts blocked (the browser's own fallback)", blockFonts: true },
    { name: "a wide fallback font", css: 'html, body, body * { font-family: "DejaVu Sans", Verdana, sans-serif !important; letter-spacing: 0.03em !important; }' },
  ];
  async function openUnder(condition, width, site = "both", path = HERE, options = {}) {
    const ctx = await context({ viewport: { width, height: 800 }, ...options });
    if (condition.blockFonts) await ctx.route("**/_next/static/media/*.woff2", (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(`${sites[site].base}${path}`, { waitUntil: "networkidle" });
    if (condition.css) await page.addStyleTag({ content: condition.css });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    return { ctx, page };
  }

  describe("the header bar from 1024px up, in three font conditions", () => {
    it("never wraps, overlaps or overflows: Get a Quote and the account button are always in the bar; the six links are inline from 1280px and in the menu below it", async () => {
      for (const condition of FONT_CONDITIONS) {
        for (const width of WIDTHS) {
          const where = `${width}px, ${condition.name}`;
          const { ctx, page } = await openUnder(condition, width);
          try {
            const m = await page.evaluate(() => {
              const box = (el) => {
                const b = el.getBoundingClientRect();
                return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
              };
              const shown = (el) => Boolean(el) && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
              const nav = document.querySelector('nav[aria-label="Primary"]');
              const burger = document.querySelector('header button[aria-label="Open menu"]');
              const quote = [...document.querySelectorAll("header a")].find((a) => a.textContent.trim() === "Get a Quote" && shown(a));
              const button = document.querySelector('[data-testid="account-menu-button"]');
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
              return {
                navShown: shown(nav), burgerShown: shown(burger), quoteShown: Boolean(quote), buttonShown: shown(button),
                logo: box(document.querySelector('header a[aria-label="M1 Gaming PCs home"]')),
                nav: shown(nav) ? box(nav) : null, quote: quote ? box(quote) : null, button: shown(button) ? box(button) : null, burger: shown(burger) ? box(burger) : null,
                capsule: box(document.querySelector("header .rounded-full")),
                linkRows: shown(nav) ? new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size : 0,
                linkCount: links.length, linksOneLine: links.every((a) => textLines(a) === 1),
                sideways: document.documentElement.scrollWidth > window.innerWidth,
                headerHeight: document.querySelector("header").getBoundingClientRect().height,
              };
            });
            if (SHOTS && ((width === 1024 && condition === FONT_CONDITIONS[2]) || (width === 1100 && condition === FONT_CONDITIONS[0]) || (width === 1280 && condition === FONT_CONDITIONS[2]) || (width === 1440 && condition === FONT_CONDITIONS[0]))) {
              await page.screenshot({ path: `${SHOTS}/header-bar-${width}${condition.css ? "-wide-fallback" : ""}.png`, clip: { x: 0, y: 0, width, height: 96 } });
            }
            assert.equal(m.sideways, false, `${where}: the page does not scroll sideways`);
            assert.equal(m.headerHeight, 80, `${where}: the header box is as tall as it always was`);
            assert.ok(m.quoteShown && m.buttonShown, `${where}: Get a Quote and the account button are in the bar`);
            // everything in the bar is inside the capsule and nothing overlaps its neighbour (left to right)
            const items = [["logo", m.logo], ["links", m.nav], ["Get a Quote", m.quote], ["account button", m.button], ["menu button", m.burger]].filter(([, b]) => b);
            for (const [name, b] of items) assert.ok(b.left >= m.capsule.left - 0.5 && b.right <= m.capsule.right + 0.5, `${where}: the ${name} is inside the capsule`);
            for (let i = 1; i < items.length; i++) {
              assert.ok(items[i - 1][1].right <= items[i][1].left + 0.5, `${where}: the ${items[i - 1][0]} do not overlap the ${items[i][0]} (${Math.round(items[i - 1][1].right)} vs ${Math.round(items[i][1].left)})`);
            }
            // the account button is a circle right beside Get a Quote, on the same line
            assert.ok(m.button.left - m.quote.right <= 20, `${where}: the account button is immediately right of Get a Quote`);
            assert.ok(Math.abs(m.button.top + m.button.height / 2 - (m.quote.top + m.quote.height / 2)) <= 1.5, `${where}: they are vertically centred together`);
            // Whenever the six links ARE in the bar (at any width) they are on ONE row, no label wraps inside itself, and there is real room to spare on each
            // side, so a font a little wider than any tested here still cannot make them touch or wrap. (This is the check the CI runner failed at 1024px.)
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
              assert.ok(m.burger.left - m.button.right <= 24 && m.burger.left >= m.button.right, `${where}: the menu button is next to the account button`);
            }
          } finally {
            await ctx.close();
          }
        }
      }
    });

    it("below 1280px the menu holds the six links (reachable, on screen), without repeating Get a Quote or the Account group the bar already has", async () => {
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
                accountGroup: document.querySelectorAll('#mobile-menu [data-testid="mobile-account-links"]').length ? getComputedStyle(document.querySelector('#mobile-menu [data-testid="mobile-account-links"]')).display : "absent",
                innerWidth: window.innerWidth, innerHeight: window.innerHeight, sideways: document.documentElement.scrollWidth > window.innerWidth,
              };
            });
            assert.ok(m.panel.left >= 0 && m.panel.right <= m.innerWidth && m.panel.bottom <= m.innerHeight, `${where}: the list is fully on screen`);
            assert.ok(m.panel.right <= m.burger.right + 40, `${where}: the list hangs from the right, under the menu button`);
            assert.equal(m.sideways, false, `${where}: no sideways scrolling`);
            assert.equal(m.quoteInMenu && (await page.locator('#mobile-menu a:has-text("Get a Quote")').isVisible()), false, `${where}: Get a Quote is not repeated in the menu`);
            assert.ok(m.accountGroup === "absent" || m.accountGroup === "none", `${where}: the Account group is not repeated in the menu`);
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
  describe("desktop: opening, closing, and what is in it", () => {
    it("starts closed (collapsed, no menu, no account links in the page), opens on a click with the four entries and the right addresses, and says so with ARIA", async () => {
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
        // the staff entry is in its own group, after a divider
        assert.equal(await page.locator(`${MENU} ul`).count(), 2);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-open-desktop.png`, clip: { x: 640, y: 0, width: 640, height: 340 } });
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
        const settled = await page.locator(MENU).evaluate((el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));
        assert.equal(settled.opacity, "1");
        assert.ok(settled.transform === "none" || settled.transform === "matrix(1, 0, 0, 1, 0, 0)");
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
        assert.equal(await focused(page), "My Account");
        await page.keyboard.press("Escape");
        await gone(page);
        assert.equal(await focused(page), "account-menu-button", "focus is back on the button");
        // Tab through all four entries and out: the menu closes
        await page.keyboard.press("Enter");
        await page.locator(MENU).waitFor();
        for (const name of ["My Account", "Customer Sign In", "Create Account", "Staff Dashboard"]) {
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
        assert.equal(await focused(page), "My Account", "ArrowDown on the button opens the menu on its first entry");
        await page.keyboard.press("ArrowDown");
        assert.equal(await focused(page), "Customer Sign In");
        await page.keyboard.press("End");
        assert.equal(await focused(page), "Staff Dashboard");
        await page.keyboard.press("ArrowDown");
        assert.equal(await focused(page), "My Account", "it wraps");
        await page.keyboard.press("ArrowUp");
        assert.equal(await focused(page), "Staff Dashboard");
        await page.keyboard.press("Home");
        assert.equal(await focused(page), "My Account");
        // the focus ring is visible on a link reached by keyboard
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
  describe("using it", () => {
    it("the entries lead to the right pages, the menu closes with the change of page, and the entry for the page you are on is left out", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("Customer Sign In")`).click();
        await page.waitForURL("**/auth/sign-in");
        await gone(page); // closed with the change of page (it may still be finishing its closing animation as the address changes)
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual((await links(page)).map((l) => l[0]), ["My Account", "Create Account", "Staff Dashboard"], "no link to the page you are on");
        await page.locator(`${MENU} a:has-text("Create Account")`).click();
        await page.waitForURL("**/auth/sign-up");
        await page.locator(MENU_BUTTON).click();
        assert.deepEqual((await links(page)).map((l) => l[0]), ["My Account", "Customer Sign In", "Staff Dashboard"]);
        assert.equal(await page.locator(`${MENU} a[aria-current]`).count(), 0, "nothing is marked current among them");
      } finally {
        await ctx.close();
      }
    });

    it("My Account for a visitor with no session leads to the sign-in page (and back to the account afterwards), never to account data", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("My Account")`).click();
        await page.waitForURL(/\/auth\/sign-in/);
        assert.match(new URL(page.url()).searchParams.get("next") ?? "", /^\/account/);
      } finally {
        await ctx.close();
      }
    });

    it("the Staff Dashboard entry is only a link: with no session it leads to sign-in (with the dashboard as the way back), and no dashboard content is served", async () => {
      const { ctx, page } = await open("both");
      try {
        await page.locator(MENU_BUTTON).click();
        await page.locator(`${MENU} a:has-text("Staff Dashboard")`).click();
        await page.waitForURL(/\/auth\/sign-in/);
        assert.equal(new URL(page.url()).searchParams.get("next"), "/admin");
        const body = await page.locator("body").innerText();
        assert.doesNotMatch(body, /Orders|Payments|Loyalty|Audit log|Financial performance/);
        assert.ok(new URL(page.url()).pathname.startsWith("/auth/"), "still on the sign-in page: the second-step and role checks come after it, on the dashboard's own pages");
      } finally {
        await ctx.close();
      }
    });

    it("the quotation builder is untouched: the form and its fields are where they were, with the header's new button absent on that public page", async () => {
      const { ctx, page } = await open("off", "/build-my-pc");
      try {
        for (const selector of ["#fullName", "#budget", "#quote-category"]) assert.equal(await page.locator(selector).count(), 1, selector);
        assert.equal(await page.locator(MENU_BUTTON).count(), 0);
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("a phone: the same entries in the hamburger menu", () => {
    const PHONE = { viewport: { width: 390, height: 844 } };
    it("the account button is not drawn on a phone; the hamburger menu has an Account group with the same four entries below the six links, and Get a Quote is still there", async () => {
      const { ctx, page } = await open("both", HERE, PHONE);
      try {
        assert.equal(await page.locator(MENU_BUTTON).isVisible(), false, "the desktop button is hidden below the large breakpoint");
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        const account = await page.locator('[data-testid="mobile-account-links"] a').evaluateAll((as) => as.map((a) => [a.textContent.replace("→", "").trim(), a.getAttribute("href")]));
        assert.deepEqual(account, ENTRIES);
        assert.equal(await page.locator('#mobile-menu nav[aria-label="Mobile"] a').count(), 6, "the six existing links are still there");
        assert.equal(await page.locator('#mobile-menu a:has-text("Get a Quote")').count(), 1);
        const box = await page.locator("#mobile-menu > div").boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 844, `the whole menu fits the screen (${Math.round(box.y + box.height)}px of 844)`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        if (SHOTS) {
          await page.waitForTimeout(600); // let the opening animation finish, so the picture shows the settled menu
          await page.screenshot({ path: `${SHOTS}/header-mobile-menu.png` });
        }
      } finally {
        await ctx.close();
      }
    });

    it("on a small phone with a short screen the menu scrolls inside itself instead of running off the bottom", async () => {
      const { ctx, page } = await open("both", HERE, { viewport: { width: 360, height: 560 } });
      try {
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator("#mobile-menu").waitFor();
        const m = await page.locator("#mobile-menu > div").evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, scrolls: el.scrollHeight > el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
        assert.ok(m.bottom <= 560, `the menu ends inside the screen (${Math.round(m.bottom)}px of 560)`);
        assert.equal(m.overflowY, "auto");
        // the last entry can be reached
        await page.locator('[data-testid="mobile-account-links"] a:has-text("Staff Dashboard")').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('[data-testid="mobile-account-links"] a:has-text("Staff Dashboard")').isVisible(), true);
      } finally {
        await ctx.close();
      }
    });

    it("an entry in the hamburger menu leads to its page and closes the menu; the entry for the current page is left out", async () => {
      const { ctx, page } = await open("both", HERE, PHONE);
      try {
        await page.locator('button[aria-label="Open menu"]').click();
        await page.locator('[data-testid="mobile-account-links"] a:has-text("Customer Sign In")').click();
        await page.waitForURL("**/auth/sign-in");
        assert.equal(await page.locator("#mobile-menu").count(), 0, "the menu closed with the change of page");
        await page.locator('button[aria-label="Open menu"]').click();
        const names = await page.locator('[data-testid="mobile-account-links"] a').evaluateAll((as) => as.map((a) => a.textContent.replace("→", "").trim()));
        assert.deepEqual(names, ["My Account", "Create Account", "Staff Dashboard"]);
      } finally {
        await ctx.close();
      }
    });

    it("with the switches off the hamburger menu is exactly as before: no Account group at all", async () => {
      const { ctx, page } = await open("off", "/", PHONE);
      try {
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
  });
});
