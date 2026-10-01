// v5 capture: REAL homepage (main, mobile layout) at 60 fps.
//   hero entrance -> eased real scroll that SETTLES -> real hover (mouse placed
//   under the composited touch point just before it lands) -> real press
//   (:active) -> real click -> real client-side navigation to /build-my-pc.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "home5");
const H = T.v5.home;
const pt = (t) => t - H.captureStart;
const total = Math.round((T.v5.duration - H.captureStart) * FPS) + 2;

function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-7) break; t -= e / d; }
    return sy(t);
  };
}
// fast-out, long settle: the page arrives and stops, it doesn't drift
const scrollEase = bezier(0.42, 0, 0.16, 1);

(async () => {
  const rig = await openRig({ base: BASE, route: "/", viewport: { width: T.viewport.width, height: T.viewport.height }, dpr: T.viewport.dpr, outDir: OUT });
  const { page } = rig;
  const record = () => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const cta = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Build Your PC");
    return { path: location.pathname, cta: r(cta), ctaBg: cta ? getComputedStyle(cta).backgroundColor : null };
  };
  let target = null, ctaFinal = null, moved = false, pressed = false, released = false;
  for (let i = 0; i < total; i++) {
    const p = i / FPS;
    if (p >= pt(H.scrollStart) && target === null) {
      const d = await page.evaluate(() => {
        const cta = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Build Your PC");
        const b = cta.getBoundingClientRect();
        return { top: b.top + scrollY, left: b.left, w: b.width, h: b.height, vh: innerHeight };
      });
      target = Math.round(d.top - d.vh * 0.64);
      ctaFinal = { x: d.left, y: d.top - target, w: d.w, h: d.h };
    }
    if (target !== null && p <= pt(H.scrollEnd) + 1 / FPS) {
      const k = scrollEase(Math.min(1, Math.max(0, (p - pt(H.scrollStart)) / (pt(H.scrollEnd) - pt(H.scrollStart)))));
      await rig.scrollTo(target * k);
    }
    if (!moved && ctaFinal && p >= pt(H.mouseIn)) {
      moved = true;
      await rig.moveMouse(ctaFinal.x + ctaFinal.w * 0.72, ctaFinal.y + ctaFinal.h * 0.5);
    }
    if (!pressed && p >= pt(H.press)) { pressed = true; await rig.mouseDown(); }
    if (pressed && !released && p >= pt(H.release)) { released = true; await rig.mouseUp(); }
    await rig.step({ record });
    if (i % 40 === 0) console.log(`frame ${i}/${total}`);
  }
  await rig.close();
  console.log("done", OUT);
})();
