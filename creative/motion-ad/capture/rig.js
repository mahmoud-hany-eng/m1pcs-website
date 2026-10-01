// Deterministic 60fps capture of the REAL website.
//
// The page's clock is frozen (Playwright clock: Date, performance.now,
// timers, requestAnimationFrame) and advanced exactly one frame at a time.
// Web Animations (CSS transitions/animations and Framer Motion's WAAPI
// tracks) are paused and stepped by the same dt, so JS- and
// compositor-driven motion stay in lock-step. Every frame is a real
// browser render at high device-pixel-ratio — real scroll, real :hover,
// real :active, real navigation — never a static screenshot being panned.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const FPS = 60;
// 16.667ms per frame, distributed as 17,17,16 so the clock never drifts.
const frameMs = (i) => Math.round(((i + 1) * 1000) / FPS) - Math.round((i * 1000) / FPS);

const WAAPI_STEPPER = () => {
  // Every Web Animation gets its own virtual clock that only moves when the
  // capture steps. Element.animate (Framer Motion's accelerated tracks) is
  // frozen at birth; CSS transitions/animations are caught on the next step.
  const own = new WeakMap();
  const adopt = (a) => {
    if (own.has(a)) return;
    own.set(a, 0);
    try {
      a.pause();
      a.currentTime = 0;
    } catch (e) {}
  };
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = origAnimate.apply(this, args);
    adopt(a);
    // Framer may call play() later; keep it frozen to our clock.
    const origPlay = a.play.bind(a);
    a.play = () => {
      origPlay();
      a.pause();
      a.currentTime = own.get(a) || 0;
    };
    return a;
  };
  window.__waStep = (dt) => {
    for (const a of document.getAnimations()) {
      if (!own.has(a)) {
        adopt(a);
        continue;
      }
      if (a.playState === "finished" || a.playState === "idle") continue;
      const t = own.get(a) + dt;
      own.set(a, t);
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      const end = timing && Number.isFinite(timing.endTime) ? timing.endTime : Infinity;
      if (t >= end) a.finish();
      else {
        if (a.playState !== "paused") a.pause();
        a.currentTime = t;
      }
    }
  };
};

async function openRig({ base, route, viewport, dpr, outDir, startTime = Date.UTC(2026, 9, 1, 12) }) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-lcd-text"],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, colorScheme: "dark" });
  await context.addInitScript(WAAPI_STEPPER);
  // Hide the native scrollbar and caret; nothing else about the site changes.
  await context.addInitScript(() => {
    const css = "html::-webkit-scrollbar{display:none} html{scrollbar-width:none} *{caret-color:transparent !important}";
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.documentElement.appendChild(s);
    };
    if (document.documentElement) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await context.newPage();
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(startTime + 1000);
  await page.goto(base + route, { waitUntil: "load" });

  let frame = 0;
  let mouse = { x: -50, y: -50, down: false };
  const log = [];

  const rig = {
    page,
    browser,
    get frame() {
      return frame;
    },
    mouse,
    /** Advance the page by one 60fps frame and capture it. */
    async step({ record } = {}) {
      const dt = frameMs(frame);
      await page.clock.runFor(dt);
      await page.evaluate((d) => window.__waStep && window.__waStep(d), dt);
      const meta = record ? await page.evaluate(record) : null;
      const file = path.join(outDir, `f${String(frame).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, type: "png", animations: "allow", caret: "initial", scale: "device" });
      log.push({ frame, t: frame / FPS, mouse: { ...mouse }, scrollY: await page.evaluate(() => window.scrollY), meta });
      frame++;
    },
    async moveMouse(x, y) {
      mouse.x = x;
      mouse.y = y;
      await page.mouse.move(x, y);
    },
    async mouseDown() {
      mouse.down = true;
      await page.mouse.down();
    },
    async mouseUp() {
      mouse.down = false;
      await page.mouse.up();
    },
    async scrollTo(y) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    },
    async close() {
      fs.writeFileSync(path.join(outDir, "log.json"), JSON.stringify(log, null, 1));
      await browser.close();
    },
  };
  return rig;
}

module.exports = { openRig, FPS };
