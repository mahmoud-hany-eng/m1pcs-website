// Targeted, high-resolution element captures: individual UI pieces that will
// become their own detail planes in 3D (so they can separate/track without
// any guessed pixel-crop math).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PORT = 5400;
const OUT = path.join(__dirname, "raw", "elements");
fs.mkdirSync(OUT, { recursive: true });

const HIDE_WA = { content: 'a[href*="wa.me"]{display:none!important}' };

async function elShot(page, locator, name, pad = 24) {
  const box = await locator.boundingBox();
  if (!box) {
    console.log("MISSING", name);
    return;
  }
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 },
  });
  console.log("el", name, Math.round(box.width), Math.round(box.height));
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // ---- Build My PC: individual controls
  await page.goto(`http://localhost:${PORT}/build-my-pc`, { waitUntil: "load" });
  await page.addStyleTag(HIDE_WA);
  await page.waitForTimeout(500);
  await elShot(page, page.getByText("Build a Complete PC", { exact: true }).first(), "pill-complete-pc");
  await elShot(page, page.locator("select").first(), "select-category");
  await elShot(page, page.locator("#fullName"), "input-fullname");
  await elShot(page, page.locator("#mobile"), "input-mobile");
  await elShot(page, page.getByText("I want a specific model", { exact: true }).first(), "pill-specific-model");
  await elShot(page, page.getByText("Find me the best option for my requirements", { exact: true }).first(), "pill-best-option");
  // whole "your details" block for a mid-depth card
  const detailsHeading = page.getByText("Your details", { exact: true }).first();
  const detailsBox = await detailsHeading.boundingBox();
  if (detailsBox) {
    await page.screenshot({
      path: path.join(OUT, "card-your-details.png"),
      clip: { x: detailsBox.x - 24, y: detailsBox.y - 16, width: 1120, height: 420 },
    });
    console.log("el card-your-details");
  }

  // ---- Header "Get a Quote" CTA
  await elShot(page, page.getByRole("link", { name: "Get a Quote" }).first(), "cta-get-quote", 16);

  // ---- Contact: WhatsApp / Instagram / Email cards
  await page.goto(`http://localhost:${PORT}/contact`, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const waHeading = page.getByText("WhatsApp", { exact: true }).first();
  const waBox = await waHeading.boundingBox();
  if (waBox) {
    await page.screenshot({ path: path.join(OUT, "card-whatsapp.png"), clip: { x: waBox.x - 24, y: waBox.y - 24, width: 420, height: 220 } });
    console.log("el card-whatsapp");
  }
  await elShot(page, page.getByRole("link", { name: "Chat on WhatsApp" }).first(), "btn-whatsapp", 12);

  // ---- Completed builds: first 3 product photos, individually, full quality
  await page.goto(`http://localhost:${PORT}/completed-builds`, { waitUntil: "load" });
  await page.addStyleTag(HIDE_WA);
  await page.waitForTimeout(800);
  const imgs = page.locator("main img");
  const count = Math.min(3, await imgs.count());
  for (let i = 0; i < count; i++) {
    await elShot(page, imgs.nth(i), `build-card-${i}`, 0);
  }

  // ---- How It Works (reduced motion / real copy): first 5 step cards
  const ctxR = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const pageR = await ctxR.newPage();
  await pageR.goto(`http://localhost:${PORT}/how-it-works`, { waitUntil: "load" });
  await pageR.waitForTimeout(500);
  const steps = pageR.locator("ol > li");
  const stepCount = Math.min(7, await steps.count());
  for (let i = 0; i < stepCount; i++) {
    await elShot(pageR, steps.nth(i), `step-${i}`, 20);
  }
  await ctxR.close();

  // ---- Mobile: build-my-pc top still (frame for scene7 morph target) + nav
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const pageM = await ctxM.newPage();
  await pageM.goto(`http://localhost:${PORT}/build-my-pc`, { waitUntil: "load" });
  await pageM.addStyleTag(HIDE_WA);
  await pageM.waitForTimeout(500);
  await pageM.screenshot({ path: path.join(OUT, "mobile-buildmypc-top.png") });
  console.log("el mobile-buildmypc-top");
  await ctxM.close();

  await browser.close();
})();
