// THE PUBLIC HEADER ABOVE THE DASHBOARDS, IN A REAL BROWSER, at 390, 768, 1024, 1280 and 1440 px.
//
// STAFF DASHBOARD. The staff area needs a real second factor, which no local test can complete, so the dashboard is not reached through a login. What is
// real here: the website's own production build (a build with the account switches on, like a Vercel Preview), its real header and client script, its real
// compiled stylesheet, and the real AdminShell markup (rendered by React from src/components/admin/AdminShell.tsx) put into the page where the dashboard's
// own <main> content goes, with the address changed to /admin so the real HideOnAdmin leaves out the footer and the chat button. The header's answer to
// "who is signed in" is the staff answer the real route gives a verified staff member. So the geometry (sticky header, sticky sidebar under it, the page's
// single scroll, the overlays) is the real one; only the logins are stood in for.
//
// CUSTOMER DASHBOARD. This one IS reached through a real sign-in against the local emulator: the real /account pages inside the real site.
//
// What it proves: ONE header at the top of every dashboard page, sticky, at every width; the staff sidebar sticks directly beneath it from 1024px and
// never overlaps it, is exactly as tall as the room that remains, and scrolls inside itself only when the window is shorter than its content; below 1024px
// the dashboard's own navigation is a compact block under the header, separate from the header's one menu button (never two hamburgers); nothing scrolls
// sideways; open menus (the public menu, the account menu) are on top of the dashboard and inside the screen; the preview banner sits under the header;
// larger text sizes still fit; the footer and the chat button are left out of the staff area only; the customer dashboard has the customer's own navigation,
// the header with the customer's name, and no way into the staff area or any internal figure.
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { ensureBuild, ensureSwitchedBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";
import { findPgBin } from "./harness.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);
const SHOTS = process.env.M1_SCREENSHOT_DIR || null;

register("./support/page-render-loader.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement } = require("react");

const STAFF = { state: "signed_in", kind: "staff", label: "Olivia Owner", href: "/admin" };
const WIDTHS = [390, 768, 1024, 1280, 1440];
const IDENTITY = '[data-testid="account-identity"]';
const HEADER = "body > header";

// Stand-in work area: a toolbar, a menu that opens over the content, a wide table (inside its own scrolling wrapper, as the real pages do) and a long list.
const CONTENT = `
  <section data-testid="work-toolbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:relative">
    <input aria-label="Search orders" style="height:40px;min-width:0;flex:1 1 12rem;border-radius:999px;padding:0 14px">
    <button type="button" data-testid="work-sort" style="height:40px;padding:0 16px;border-radius:999px">Sort</button>
    <div data-testid="work-menu" role="menu" style="position:absolute;right:0;top:48px;z-index:30;width:15rem;background:#14151a;border:1px solid #333;border-radius:16px;padding:8px">
      <div role="menuitem" style="padding:8px 12px">Newest first</div><div role="menuitem" style="padding:8px 12px">Oldest first</div>
    </div>
  </section>
  <div data-testid="work-table" style="overflow-x:auto"><table style="min-width:60rem;width:100%"><tbody>
    ${Array.from({ length: 60 }, (_, i) => `<tr><td style="padding:14px">O-2611-${String(i + 1).padStart(5, "0")}</td><td>Customer ${i + 1}</td><td>QAR ${(i + 1) * 1234}</td><td>Cost</td><td>Profit</td><td>Placed</td><td>Receipts</td></tr>`).join("")}
  </tbody></table></div>`;

describe("the public header above the dashboards, in a real browser", { skip, timeout: 1_800_000 }, () => {
  let emu;
  let sites;
  let browser;
  let shellHtml;
  let shellWithBanner;

  const context = (options = {}) => browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  async function mockStaff(ctx, answer = STAFF) {
    await ctx.route("**/auth/header-identity", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(answer) }));
  }
  /** A real page of the site (header, script, stylesheet) whose content area now holds the staff dashboard, at the address /admin/orders. */
  async function openAdmin({ width = 1280, height = 800, identity = STAFF, banner = false, options = {}, fontScale = null } = {}) {
    const ctx = await context({ viewport: { width, height }, ...options });
    if (identity) await mockStaff(ctx, identity);
    const page = await ctx.newPage();
    if (fontScale) {
      // The browser's own default text size (what a visitor sets in the browser): rem sizes and the em-based breakpoints both follow it.
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Page.enable");
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round((16 * fontScale) / 100), fixed: Math.round((13 * fontScale) / 100) } });
    }
    await page.goto(`${sites.builtBoth.base}/contact`, { waitUntil: "networkidle" });
    if (identity) await page.waitForSelector('[data-testid="header-account"][data-account-state="signed_in"]', { timeout: 8000 });
    await page.evaluate(({ html }) => {
      document.querySelector("body > main").innerHTML = html;
      history.pushState({}, "", "/admin/orders");
    }, { html: banner ? shellWithBanner : shellHtml });
    // the address change is seen by the real header and layout (the footer and the chat button leave; the name is asked for again)
    await page.waitForFunction(() => !document.querySelector("body > footer"), null, { timeout: 8000 });
    if (identity) await page.waitForSelector('[data-testid="header-account"][data-account-state="signed_in"]', { timeout: 8000 });
    await page.waitForTimeout(150);
    return { ctx, page };
  }
  const rect = (page, selector) =>
    page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });
  const scrollTo = async (page, y) => {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(80);
  };
  const sideways = (page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, shell: Math.max(0, ...[...document.querySelectorAll('[data-testid="admin-shell"]')].map((el) => el.scrollWidth - el.clientWidth)) }));
  const topmostIs = (page, selector) =>
    page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [0.2, 0.5, 0.8].every((f) => {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f);
        return hit && el.contains(hit);
      });
    });

  before(async () => {
    ensureBuild();
    const switched = ensureSwitchedBuild();
    emu = await startEmulator();
    const supabase = { NEXT_PUBLIC_SUPABASE_URL: emu.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey };
    sites = {
      builtBoth: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", STAFF_ADMIN_ENABLED: "true", ...supabase }, { dir: switched }),
      builtCustomer: await startWebsite({ CUSTOMER_ACCOUNTS_ENABLED: "true", ...supabase }, { dir: switched }),
    };
    const { AdminShell } = await import("../../src/components/admin/AdminShell.tsx");
    const render = (previewLabel) =>
      renderToStaticMarkup(
        createElement(
          AdminShell,
          {
            active: "orders",
            email: "owner@example.test",
            can: () => true,
            title: "Orders",
            description: "Every order, newest first.",
            actions: createElement("a", { href: "/admin/orders/new", className: "btn-sheen btn-glass inline-flex rounded-full px-4 py-2 text-sm" }, "New order"),
            previewLabel,
          },
          createElement("div", { dangerouslySetInnerHTML: { __html: CONTENT } }),
        ),
      );
    shellHtml = render(null);
    shellWithBanner = render("DEV preview: demonstration data");
    browser = await playwright.chromium.launch();
  });
  after(async () => {
    await browser?.close();
    for (const site of Object.values(sites ?? {})) await site.stop();
    await emu?.stop();
  });

  // =============================================================================================================
  describe("the staff dashboard under the public header", () => {
    it("ONE header (the public one) is at the top at every width: branding, the six links or the menu button, Get a Quote from 1024px, and the signed-in name linking to /admin", async () => {
      for (const width of WIDTHS) {
        const { ctx, page } = await openAdmin({ width });
        try {
          const where = `${width}px`;
          assert.equal(await page.locator("header").count(), 1, `${where}: exactly one <header> element on the page`);
          assert.equal(await page.locator(HEADER).count(), 1, `${where}: it is the site's header, directly in the body`);
          assert.equal(await page.locator('header a[aria-label="M1 Gaming PCs home"]').count(), 1, `${where}: the M1 logo`);
          assert.equal(await page.locator('[role="banner"], body > header').count(), 1, `${where}: one banner landmark`);
          assert.equal(await page.locator('header nav[aria-label="Primary"] a').count(), 6);
          if (width >= 1280) assert.equal(await page.locator('header nav[aria-label="Primary"]').isVisible(), true, `${where}: the six links are in the bar`);
          else assert.equal(await page.locator('header button[aria-label="Open menu"]').isVisible(), true, `${where}: the menu button`);
          assert.equal(await page.locator('header a:has-text("Get a Quote")').first().isVisible(), width >= 1024, `${where}: Get a Quote from 1024px`);
          assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/admin");
          assert.equal(await page.locator(IDENTITY).getAttribute("aria-label"), "Olivia Owner: open your dashboard");
          if (width >= 640) assert.equal((await page.locator('[data-testid="account-identity-name"]').innerText()).trim(), "Olivia Owner");
          assert.equal(await page.locator("main").count(), 1, `${where}: one main landmark (the dashboard has no nested main)`);
          assert.equal(await page.locator('[data-testid="admin-shell"]').count(), 1);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-with-header-${width}.png`, fullPage: false });
        } finally {
          await ctx.close();
        }
      }
    });

    it("the header is sticky above the dashboard: it stays at the top while the page scrolls a long way, at every width", async () => {
      for (const width of WIDTHS) {
        const { ctx, page } = await openAdmin({ width });
        try {
          const where = `${width}px`;
          const expected = width >= 640 ? 80 : 64;
          const top = await rect(page, HEADER);
          assert.equal(top.top, 0, `${where}: at the top`);
          assert.equal(top.height, expected, `${where}: its usual height`);
          assert.equal(await page.locator(HEADER).evaluate((el) => getComputedStyle(el).position), "sticky");
          await scrollTo(page, 1500);
          assert.ok((await page.evaluate(() => window.scrollY)) > 800, `${where}: the page really scrolled`);
          const scrolled = await rect(page, HEADER);
          assert.equal(scrolled.top, 0, `${where}: still at the top after scrolling`);
          assert.equal(await topmostIs(page, HEADER), true, `${where}: and on top of the content under it`);
          await scrollTo(page, 100000);
          assert.equal((await rect(page, HEADER)).top, 0, `${where}: and at the very bottom of the page`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("the page has ONE scroll: no scrollbar of its own on the body, none on the dashboard frame, none sideways; the work area scrolls with the page", async () => {
      for (const width of WIDTHS) {
        const { ctx, page } = await openAdmin({ width });
        try {
          const where = `${width}px`;
          const m = await page.evaluate(() => {
            const body = getComputedStyle(document.body);
            const shell = document.querySelector('[data-testid="admin-shell"]');
            const style = getComputedStyle(shell);
            return {
              bodyOverflowY: body.overflowY, shellOverflow: [style.overflowX, style.overflowY], shellPosition: style.position,
              pageScrolls: document.documentElement.scrollHeight > window.innerHeight, shellScrolls: shell.scrollHeight > shell.clientHeight + 1,
            };
          });
          assert.notEqual(m.bodyOverflowY, "scroll", `${where}: the body is not a second scroll area`);
          assert.deepEqual(m.shellOverflow, ["visible", "visible"], `${where}: the dashboard frame does not scroll on its own`);
          assert.equal(m.shellPosition, "static", `${where}: the dashboard frame is ordinary page content, not an overlay`);
          assert.equal(m.pageScrolls, true, `${where}: the page itself scrolls`);
          const s = await sideways(page);
          assert.ok(s.page <= 0 && s.shell <= 0, `${where}: nothing scrolls sideways ${JSON.stringify(s)}`);
          // the wide table scrolls inside its own wrapper, as on the real pages
          const table = await page.locator('[data-testid="work-table"]').evaluate((el) => ({ inner: el.scrollWidth > el.clientWidth, wrapperOverflow: getComputedStyle(el).overflowX }));
          assert.equal(table.wrapperOverflow, "auto");
          if (width <= 1024) assert.equal(table.inner, true, `${where}: the wide table scrolls inside its wrapper`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("from 1024px the staff sidebar sticks DIRECTLY under the header, never overlaps it, is as tall as the room that remains, and keeps its sign-out in view while the page scrolls", async () => {
      for (const width of [1024, 1280, 1440]) {
        const { ctx, page } = await openAdmin({ width, height: 800 });
        try {
          const where = `${width}px`;
          const side = "[data-testid=\"admin-sidebar\"]";
          assert.equal(await page.locator(side).evaluate((el) => getComputedStyle(el).position), "sticky");
          for (const y of [0, 300, 1500, 100000]) {
            await scrollTo(page, y);
            const head = await rect(page, HEADER);
            const bar = await rect(page, side);
            assert.equal(bar.top, 80, `${where}, scrolled ${y}: the sidebar starts right under the 80px header`);
            assert.ok(bar.top >= head.bottom, `${where}, scrolled ${y}: it does not overlap the header`);
            assert.ok(Math.abs(bar.height - (800 - 80)) <= 1, `${where}, scrolled ${y}: as tall as the room under the header (${Math.round(bar.height)}px)`);
            assert.ok(bar.bottom <= 800 + 0.5, `${where}, scrolled ${y}: inside the window`);
            // the sign-out and the signed-in e-mail at its foot are always on screen
            const signOut = await rect(page, `${side} button:visible:has-text("Sign out")`);
            assert.ok(signOut.top >= bar.top && signOut.bottom <= bar.bottom + 0.5 && signOut.bottom <= 800, `${where}, scrolled ${y}: Sign out stays in view`);
            assert.equal(await topmostIs(page, `${side} nav a:first-child`), true, `${where}, scrolled ${y}: the navigation is not covered`);
          }
          // the work area is beside it, not under it
          const bar = await rect(page, side);
          const work = await rect(page, '[data-testid="work-toolbar"]');
          assert.ok(work.left >= bar.right - 0.5, `${where}: the work area starts after the sidebar`);
          // nothing in the sidebar needs a scrollbar of its own in a normal window
          const inner = await page.locator(side).evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight + 1, overflowY: getComputedStyle(el).overflowY }));
          assert.equal(inner.scrolls, false, `${where}: no inner scrollbar in an ordinary window`);
          assert.equal(inner.overflowY, "auto");
          if (SHOTS && width === 1280) {
            await scrollTo(page, 600);
            await page.screenshot({ path: `${SHOTS}/admin-with-header-scrolled-1280.png` });
          }
        } finally {
          await ctx.close();
        }
      }
    });

    it("in a short window the sidebar scrolls INSIDE itself (so its Sign out is still reachable) while the header and the page stay as they were; no second page scrollbar appears", async () => {
      const { ctx, page } = await openAdmin({ width: 1280, height: 440 });
      try {
        const side = '[data-testid="admin-sidebar"]';
        const bar = await rect(page, side);
        assert.ok(Math.abs(bar.height - (440 - 80)) <= 1);
        const inner = await page.locator(side).evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight + 1 }));
        assert.equal(inner.scrolls, true, "the sidebar's own scroll is what shows the rest");
        await page.locator(`${side} button:visible:has-text("Sign out")`).scrollIntoViewIfNeeded();
        const after = await rect(page, `${side} button:visible:has-text("Sign out")`);
        assert.ok(after.bottom <= 440 + 0.5 && after.top >= 80, "Sign out can be reached");
        assert.equal((await rect(page, HEADER)).top, 0);
        assert.equal(await page.evaluate(() => window.scrollY), 0, "scrolling the sidebar did not scroll the page");
      } finally {
        await ctx.close();
      }
    });

    it("below 1024px the dashboard navigation is a compact block under the header (brand, Sign out, a row of sections), separate from the header's one menu button", async () => {
      for (const width of [390, 768]) {
        const { ctx, page } = await openAdmin({ width, height: 844 });
        try {
          const where = `${width}px`;
          const side = '[data-testid="admin-sidebar"]';
          assert.equal(await page.locator(side).evaluate((el) => getComputedStyle(el).position), "static", `${where}: not sticky and not fixed: it flows with the page`);
          const head = await rect(page, HEADER);
          const bar = await rect(page, side);
          assert.ok(bar.top >= head.bottom - 0.5, `${where}: under the header, not beneath it (${Math.round(bar.top)} vs ${Math.round(head.bottom)})`);
          assert.ok(bar.width <= width + 0.5 && bar.height < 220, `${where}: compact (${Math.round(bar.height)}px tall)`);
          // exactly ONE menu button on the page (the header's), and the dashboard's own controls are not a second hamburger
          assert.equal(await page.locator('button[aria-label="Open menu"]').count(), 1, `${where}: one hamburger`);
          assert.equal(await page.locator(`${side} button[aria-label*="menu" i], ${side} [aria-controls]`).count(), 0, `${where}: the dashboard has no menu button of its own`);
          // every section link is there, readable and tappable (the row scrolls sideways inside itself)
          const links = await page.locator(`${side} nav[aria-label="Admin sections"] a`).evaluateAll((as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href"), h: a.getBoundingClientRect().height })));
          assert.deepEqual(links.map((l) => l.href), ["/admin", "/admin/customers", "/admin/orders", "/admin/payments", "/admin/loyalty", "/admin/policies", "/admin/audit"]);
          assert.ok(links.every((l) => l.h >= 36), `${where}: touch-sized links`);
          const signOut = await rect(page, `${side} button:visible:has-text("Sign out")`);
          assert.ok(signOut.left >= 0 && signOut.right <= width && signOut.top >= bar.top, `${where}: Sign out is inside the block and the screen`);
          // the header's menu works over the dashboard
          await page.locator('button[aria-label="Open menu"]').click();
          await page.locator("#mobile-menu").waitFor();
          await page.waitForTimeout(450);
          assert.equal(await topmostIs(page, "#mobile-menu > div"), true, `${where}: the public menu is on top of the dashboard`);
          const panel = await rect(page, "#mobile-menu > div");
          assert.ok(panel.left >= 0 && panel.right <= width && panel.bottom <= 844, `${where}: the menu is inside the screen`);
          const links6 = await page.locator('#mobile-menu nav[aria-label="Mobile"] a').count();
          assert.equal(links6, 6);
          if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/admin-with-header-menu-open-390.png` });
          await page.keyboard.press("Escape");
          await page.locator("#mobile-menu").waitFor({ state: "detached" });
        } finally {
          await ctx.close();
        }
      }
    });

    it("the footer and the chat button are left out of the staff area only (the header stays); a public page still has both", async () => {
      const { ctx, page } = await openAdmin({ width: 1280 });
      try {
        assert.equal(await page.locator("body > footer").count(), 0, "no public footer under the dashboard");
        assert.equal(await page.locator('a[aria-label="Chat with M1 on WhatsApp"]').count(), 0, "no chat button over the dashboard");
        assert.equal(await page.locator(HEADER).isVisible(), true);
        // back on a public address the same page has them again
        await page.evaluate(() => history.pushState({}, "", "/contact"));
        await page.waitForSelector("body > footer", { timeout: 8000 });
        assert.equal(await page.locator('a[aria-label="Chat with M1 on WhatsApp"]').count(), 1);
      } finally {
        await ctx.close();
      }
      const plain = await context();
      const publicPage = await plain.newPage();
      await publicPage.goto(`${sites.builtBoth.base}/contact`, { waitUntil: "networkidle" });
      assert.equal(await publicPage.locator("body > footer").count(), 1, "the public site keeps its footer");
      assert.equal(await publicPage.locator('a[aria-label="Chat with M1 on WhatsApp"]').count(), 1, "and its chat button");
      await plain.close();
    });

    it("overlays are never clipped or covered: the dashboard's own menu opens on top of the content and inside the screen, and the sticky sidebar does not cover it", async () => {
      for (const width of WIDTHS) {
        const { ctx, page } = await openAdmin({ width });
        try {
          const where = `${width}px`;
          await scrollTo(page, 0);
          const menu = await rect(page, '[data-testid="work-menu"]');
          assert.ok(menu.left >= 0 && menu.right <= width, `${where}: inside the screen sideways`);
          assert.equal(await topmostIs(page, '[data-testid="work-menu"]'), true, `${where}: the menu is the topmost thing at its own points`);
          const head = await rect(page, HEADER);
          assert.ok(menu.top >= head.bottom - 0.5, `${where}: it opens under the header`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("the signed-in name is a link to /admin that also works from inside the dashboard (the same destination, no menu)", async () => {
      const { ctx, page } = await openAdmin({ width: 1280 });
      try {
        assert.equal(await page.locator('[data-testid="header-account"]').getAttribute("data-account-kind"), "staff");
        assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/admin");
        assert.equal(await page.locator('[data-testid="account-menu-button"]').count(), 0);
        assert.equal(await topmostIs(page, IDENTITY), true);
      } finally {
        await ctx.close();
      }
    });

    it("a preview banner sits under the header (it never hides behind it) and pushes the work area down without moving the sidebar", async () => {
      for (const width of [390, 1280]) {
        const { ctx, page } = await openAdmin({ width, banner: true });
        try {
          const where = `${width}px`;
          const head = await rect(page, HEADER);
          const banner = await rect(page, '[data-testid="admin-shell"] [role="note"]');
          assert.ok(banner.top >= head.bottom - 0.5, `${where}: under the header`);
          assert.equal(await topmostIs(page, '[data-testid="admin-shell"] [role="note"]'), true, `${where}: readable`);
          const toolbar = await rect(page, '[data-testid="work-toolbar"]');
          assert.ok(toolbar.top >= banner.bottom, `${where}: the content starts below the banner`);
          if (width >= 1024) assert.equal((await rect(page, '[data-testid="admin-sidebar"]')).top, 80, `${where}: the sidebar is still directly under the header`);
          assert.equal((await sideways(page)).page <= 0, true, `${where}: no sideways scrolling`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("a very long staff name is cut with an ellipsis in the header above the dashboard and nothing overlaps or overflows, at every width", async () => {
      const long = { ...STAFF, label: "Alexandrina Montgomery-Featherstonehaugh Junior" };
      for (const width of WIDTHS) {
        const { ctx, page } = await openAdmin({ width, identity: long });
        try {
          const where = `${width}px`;
          assert.equal((await sideways(page)).page <= 0, true, `${where}: no sideways scrolling`);
          const chip = await rect(page, '[data-testid="header-account"]');
          const capsule = await rect(page, "header .rounded-full");
          assert.ok(chip.left >= capsule.left - 0.5 && chip.right <= capsule.right + 0.5, `${where}: the name stays inside the capsule`);
          if (width >= 640) {
            const clipped = await page.locator('[data-testid="account-identity-name"]').evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow }));
            assert.deepEqual(clipped, { cut: true, ellipsis: "ellipsis" }, `${where}: cut with an ellipsis`);
          }
        } finally {
          await ctx.close();
        }
      }
    });

    it("larger text (the browser's default text size 150% larger): the header and the dashboard still fit, the sidebar still sits under the header, nothing scrolls sideways", async () => {
      for (const width of [390, 768, 1280, 1440]) {
        const { ctx, page } = await openAdmin({ width, height: 900, fontScale: 150 });
        try {
          const where = `${width}px at 150% text`;
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "24px", `${where}: the text really is larger`);
          assert.equal((await sideways(page)).page <= 0, true, `${where}: no sideways scrolling`);
          assert.equal((await rect(page, HEADER)).top, 0);
          const side = await rect(page, '[data-testid="admin-sidebar"]');
          const head = await rect(page, HEADER);
          assert.ok(side.top >= head.bottom - 0.5 || (await page.locator('[data-testid="admin-sidebar"]').evaluate((el) => getComputedStyle(el).position)) === "sticky", `${where}: the sidebar is under the header`);
          const headerOverflow = await page.evaluate(() => {
            const capsule = document.querySelector("header .rounded-full").getBoundingClientRect();
            return [...document.querySelectorAll("header a, header button")].filter((el) => el.getBoundingClientRect().width > 0).some((el) => el.getBoundingClientRect().right > capsule.right + 0.5 || el.getBoundingClientRect().left < capsule.left - 0.5);
          });
          assert.equal(headerOverflow, false, `${where}: everything in the header is inside the capsule`);
        } finally {
          await ctx.close();
        }
      }
    });

    it("keyboard: the first Tab stops reach the public header's controls and then the dashboard's sections, in reading order, with a visible focus ring and no keyboard trap", async () => {
      const { ctx, page } = await openAdmin({ width: 1280 });
      try {
        const order = [];
        await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.evaluate(() => document.activeElement?.blur());
        for (let i = 0; i < 24; i++) {
          await page.keyboard.press("Tab");
          order.push(await page.evaluate(() => {
            const el = document.activeElement;
            return el ? `${el.closest("header") ? "header" : el.closest('[data-testid="admin-sidebar"]') ? "sidebar" : el.closest('[data-testid="admin-shell"]') ? "work" : "other"}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}` : "none";
          }));
        }
        const firstSidebar = order.findIndex((o) => o.startsWith("sidebar:"));
        const before = order.slice(0, firstSidebar);
        assert.ok(firstSidebar > 8 && before.every((o) => o.startsWith("header:")), `everything reached before the dashboard navigation is a control of the public header, in order (${order.join(" | ")})`);
        const afterSidebar = order.slice(firstSidebar);
        const lastSidebar = afterSidebar.findLastIndex((o) => o.startsWith("sidebar:"));
        assert.ok(afterSidebar.slice(0, lastSidebar + 1).every((o) => o.startsWith("sidebar:")), "then the dashboard navigation, as one run");
        assert.ok(afterSidebar.slice(lastSidebar + 1).some((o) => o.startsWith("work:")), "and then the work area");
        const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
        assert.notEqual(outline, "none", "a focus ring is drawn");
      } finally {
        await ctx.close();
      }
    });
  });

  // =============================================================================================================
  describe("signed-out visitors cannot open any dashboard", () => {
    it("every dashboard address sends a signed-out visitor to the sign-in page (with the way back) and serves no dashboard content, for staff and customer addresses alike", async () => {
      for (const site of ["builtBoth", "builtCustomer"]) {
        for (const path of ["/account", "/account/orders", "/account/payments", "/account/loyalty", "/account/profile", ...(site === "builtBoth" ? ["/admin", "/admin/orders", "/admin/payments", "/admin/customers"] : [])]) {
          const response = await fetch(`${sites[site].base}${path}`, { redirect: "manual" });
          assert.ok([302, 303, 307, 308].includes(response.status), `${site} ${path}: a redirect (got ${response.status})`);
          const location = new URL(response.headers.get("location"), sites[site].base);
          assert.equal(location.pathname, "/auth/sign-in", `${site} ${path}: to the sign-in page`);
          assert.equal(location.searchParams.get("next"), path, `${site} ${path}: with the way back`);
          assert.equal((await response.text()).includes("Sign out"), false, `${site} ${path}: no dashboard content`);
        }
      }
    });

    it("on a site with the staff switch off every admin address is the ordinary 404 even when signed out (nothing says an admin area exists)", async () => {
      for (const path of ["/admin", "/admin/orders", "/admin/mfa"]) {
        const response = await fetch(`${sites.builtCustomer.base}${path}`, { redirect: "manual" });
        assert.equal(response.status, 404, path);
      }
    });
  });

  // =============================================================================================================
  describe("the customer dashboard under the same header (a real sign-in against the emulator)", () => {
    const signIn = async (page) => {
      await page.goto(`${sites.builtCustomer.base}/auth/sign-in`);
      await page.fill("#signin-email", emu.users.alice.email);
      await page.fill("#signin-password", emu.users.alice.password);
      await page.click("form:has(#signin-email) button[type=submit]");
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
    };

    it("every customer page has ONE sticky header with the customer's name linking to /account, the customer's own navigation, and the footer; at every width, with no sideways scroll", async () => {
      for (const width of WIDTHS) {
        const ctx = await context({ viewport: { width, height: 800 } });
        const page = await ctx.newPage();
        try {
          await signIn(page);
          assert.equal(new URL(page.url()).pathname, "/account", `${width}px: a customer lands on their own dashboard`);
          for (const path of ["/account", "/account/orders", "/account/payments", "/account/loyalty", "/account/profile"]) {
            await page.goto(`${sites.builtCustomer.base}${path}`, { waitUntil: "networkidle" });
            await page.waitForSelector('[data-testid="header-account"][data-account-state="signed_in"]', { timeout: 8000 });
            const where = `${width}px ${path}`;
            assert.equal(await page.locator("header").count(), 1, `${where}: one header`);
            assert.equal((await page.locator('[data-testid="account-identity-name"]').innerText().catch(() => "")).trim() === "Alice Test" || width < 640, true, `${where}: the customer's name`);
            assert.equal(await page.locator(IDENTITY).getAttribute("href"), "/account");
            assert.equal(await page.locator(IDENTITY).getAttribute("aria-label"), "Alice Test: open your dashboard");
            assert.equal((await rect(page, HEADER)).top, 0);
            await scrollTo(page, 400);
            assert.equal((await rect(page, HEADER)).top, 0, `${where}: sticky`);
            await scrollTo(page, 0);
            const s = await sideways(page);
            assert.ok(s.page <= 0, `${where}: no sideways scrolling`);
            // the customer's navigation, never the staff's
            const nav = await page.locator('nav[aria-label="Account sections"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
            assert.deepEqual(nav, ["/account", "/account/orders", "/account/payments", "/account/loyalty", "/account/profile"], where);
            assert.equal(await page.locator('a[href^="/admin"]').count(), 0, `${where}: no link into the staff area anywhere`);
            assert.equal(await page.locator("body > footer").count(), 1, `${where}: the public footer stays`);
            const text = await page.locator("body").innerText();
            assert.doesNotMatch(text, /\b(cost|profit|margin|supplier)\b/i, `${where}: no internal figure`);
          }
          if (SHOTS && [390, 768, 1280].includes(width)) {
            await page.goto(`${sites.builtCustomer.base}/account`, { waitUntil: "networkidle" });
            await page.waitForSelector('[data-testid="header-account"][data-account-state="signed_in"]');
            await page.screenshot({ path: `${SHOTS}/customer-dashboard-with-header-${width}.png`, fullPage: false });
          }
        } finally {
          await ctx.close();
        }
      }
    });

    it("a customer never reaches the staff area: every admin address is the ordinary 404 (staff switch off) or a sign-in, and no staff data is served", async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await signIn(page);
      for (const path of ["/admin", "/admin/orders", "/admin/payments", "/admin/receipts/00000000-0000-4000-8000-000000000000", "/admin/mfa"]) {
        const response = await page.goto(`${sites.builtCustomer.base}${path}`);
        assert.equal(response.status(), 404, `${path} answers as an address that does not exist`);
        const text = await page.locator("body").innerText();
        assert.doesNotMatch(text, /Overview|Financial|Orders\b.*Profit|Cost/i, path);
      }
      await ctx.close();
    });

    it("the customer claim-code screen is still part of the customer dashboard, under the same header", async () => {
      const ctx = await context({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto(`${sites.builtCustomer.base}/account/claim`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("header").count(), 1);
      assert.equal((await page.locator("body").innerText()).toLowerCase().includes("code"), true, "the claim form is there");
      await ctx.close();
    });
  });
});
