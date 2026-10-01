// v6 capture: the REAL closing section ("Ready to build yours?") already
// settled in view, then a real pointer hover on its "Build Your PC" button at
// the v6 cue (the button's own hover state answers). 60 fps, deterministic.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "cta6");
const C = T.v6.cta;
const total = Math.round((T.v6.sig.collapse[1] + 0.3 - C.cta0) * FPS);

(async () => {
  const rig = await openRig({ base: BASE, route: "/", viewport: { width: T.viewport.width, height: T.viewport.height }, dpr: T.viewport.dpr, outDir: OUT });
  const { page } = rig;
  const sec = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build"));
    const b = h.closest("section").getBoundingClientRect();
    return { top: b.top + scrollY, h: b.height };
  });
  const target = Math.round(sec.top + sec.h / 2 - 768 / 2 + 20);
  // bring the section in and let its own entrance finish (lazy photo loads, lines rise)
  for (const y of [sec.top - 600, target]) {
    await rig.scrollTo(y);
    for (let k = 0; k < 12; k++) {
      await page.clock.runFor(100);
      await page.evaluate(() => window.__waStep && window.__waStep(100));
      await page.waitForTimeout(80);
    }
  }
  for (let k = 0; k < 30; k++) {
    await page.clock.runFor(100);
    await page.evaluate(() => window.__waStep && window.__waStep(100));
  }
  const btn = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build")).closest("section");
    const a = Array.from(s.querySelectorAll("a")).find((x) => x.textContent.trim() === "Build Your PC");
    const b = a.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  const record = () => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const s = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build")).closest("section");
    const a = Array.from(s.querySelectorAll("a")).find((x) => x.textContent.trim() === "Build Your PC");
    const wa = Array.from(s.querySelectorAll("a")).find((x) => x.textContent.trim() === "WhatsApp Us");
    return { h2: r(s.querySelector("h2")), btn: r(a), btnBg: getComputedStyle(a).backgroundColor, wa: r(wa), img: r(s.querySelector("img")), headerLogo: r(document.querySelector("header img")) };
  };
  let hovered = false;
  for (let i = 0; i < total; i++) {
    if (!hovered && C.cta0 + i / FPS >= C.hover) {
      hovered = true;
      await rig.moveMouse(btn.x + btn.w * 0.62, btn.y + btn.h * 0.5);
    }
    await rig.step({ record });
  }
  await rig.close();
  console.log("done", OUT, total, "frames");
})();
