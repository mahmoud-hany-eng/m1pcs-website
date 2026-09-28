// Capture library for the M1 website showreel.
// Clean, high-resolution captures of the REAL monepcs.qa site (built from
// origin/main, served locally at PORT) — no browser chrome, no cursor,
// no devtools. Produces PNG stills and short WEBM interaction clips.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PORT = 5400;
const OUT = path.join(__dirname, "raw");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 390, height: 844 };

const HIDE_WA = { content: 'a[href*="wa.me"]{display:none!important}' };
/** Removes the WhatsApp widget the instant it mounts (covers any mount
 * delay a style tag added after navigation could miss during a recording). */
async function hideWaLive(ctx) {
  await ctx.addInitScript(() => {
    const kill = () => document.querySelectorAll('a[href*="wa.me"]').forEach((e) => e.remove());
    kill();
    new MutationObserver(kill).observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
  console.log("shot", name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // ---------------------------------------------------------------- desktop stills
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
    await hideWaLive(ctx);
    const page = await ctx.newPage();

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(600);
    await shot(page, "home-hero"); // "Built Different." hero, nav visible

    // Hero only, tight crop (no nav) for a full-bleed plane.
    await page.mouse.move(-100, -100);
    await shot(page, "home-hero-clean");

    await page.goto(`http://localhost:${PORT}/build-my-pc`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(600);
    await shot(page, "build-my-pc-top");

    await page.goto(`http://localhost:${PORT}/products`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(600);
    await shot(page, "products-top");

    await page.goto(`http://localhost:${PORT}/completed-builds`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(800);
    await shot(page, "completed-builds-top");
    // Individual build cards at high res, isolated (crop targets recorded below).
    const cards = await page.$$eval("main img", (imgs) =>
      imgs.slice(0, 6).map((img) => {
        const r = img.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, src: img.getAttribute("src") };
      }),
    );
    fs.writeFileSync(path.join(OUT, "completed-builds-cards.json"), JSON.stringify(cards, null, 2));

    await page.goto(`http://localhost:${PORT}/contact`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(600);
    await shot(page, "contact-top");

    // How It Works: force the reduced-motion static (real-copy, no 3D characters) version.
    await ctx.close();
    const ctxReduced = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2, reducedMotion: "reduce" });
    const pageR = await ctxReduced.newPage();
    await pageR.goto(`http://localhost:${PORT}/how-it-works`, { waitUntil: "networkidle" });
    await pageR.waitForTimeout(600);
    await shot(pageR, "how-it-works-static", { fullPage: true });
    await ctxReduced.close();
  }

  // ---------------------------------------------------------------- desktop interaction video: Build My PC form
  {
    const ctx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1, // video capture: keep 1x, we upscale/crop selectively
      recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
    });
    await hideWaLive(ctx);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/build-my-pc`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(500);
    // Select "Build a Complete PC" quick pill.
    const pill = page.getByText("Build a Complete PC", { exact: true }).first();
    await pill.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await pill.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    // Fill full name, mobile.
    const name = page.locator('input[type="text"]').first();
    if (await name.count()) {
      await name.click();
      await page.waitForTimeout(150);
      await name.type("Ahmed Al-Sulaiti", { delay: 45 });
    }
    await page.waitForTimeout(300);
    const mobile = page.locator('input[placeholder*="5xxxxxxx" i], input[type="tel"]').first();
    if (await mobile.count()) {
      await mobile.click();
      await page.waitForTimeout(150);
      await mobile.type("55123456", { delay: 45 });
    }
    await page.waitForTimeout(400);
    // Scroll to the product preference pills and click one.
    const pref = page.getByText("Find me the best option for my requirements", { exact: true }).first();
    if (await pref.count()) {
      await pref.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await pref.click({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(900);
    await page.close();
    await ctx.close();
    console.log("video: build-my-pc interaction captured");
  }

  // ---------------------------------------------------------------- desktop interaction video: completed builds scroll
  {
    const ctx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
    });
    await hideWaLive(ctx);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/completed-builds`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(500);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(600);
    await page.close();
    await ctx.close();
    console.log("video: completed-builds scroll captured");
  }

  // ---------------------------------------------------------------- mobile stills + interaction
  {
    const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    await hideWaLive(ctx);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(500);
    await shot(page, "mobile-home-top");
    // open the mobile nav
    const menuBtn = page.locator('button[aria-label*="menu" i], button:has(svg)').first();
    await menuBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, "mobile-nav-open");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({
      viewport: MOBILE,
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
    });
    await hideWaLive(ctx);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/build-my-pc`, { waitUntil: "networkidle" });
    await page.addStyleTag(HIDE_WA);
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 160);
      await page.waitForTimeout(110);
    }
    await page.waitForTimeout(500);
    await page.close();
    await ctx.close();
    console.log("video: mobile build-my-pc scroll captured");
  }

  await browser.close();
})();
