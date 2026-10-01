// Shot 2 of the style proof: the REAL monepcs.qa homepage (main branch, mobile
// layout), captured frame by frame at 60fps.
//   hero entrance (real) -> eased real scroll -> cursor glides to the real
//   "Build Your PC" CTA -> real :hover -> real press (:active) -> real click
//   -> real client-side navigation to /build-my-pc.
// The cursor itself is drawn later by the compositor at exactly these mouse
// coordinates; the page receives the same mouse events, so every hover/press
// state in the footage is the site's own.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "home");

const P = T.proof.home;
const t0 = P.captureStart;
const pt = (t) => t - t0; // master time -> page time
const DURATION = T.proof.duration - t0;

// cubic-bezier easing (same maths as CSS)
function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(t);
  };
}
const scrollEase = bezier(0.65, 0, 0.3, 1);
const cursorEase = bezier(0.32, 0, 0.12, 1);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;

(async () => {
  const rig = await openRig({
    base: BASE,
    route: "/",
    viewport: { width: T.viewport.width, height: T.viewport.height },
    dpr: T.viewport.dpr,
    outDir: OUT,
  });
  const { page } = rig;

  const record = () => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const cta = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Build Your PC");
    const logo = document.querySelector('main img[alt="M1 Gaming PCs"]');
    const heading = document.querySelector("main h1");
    return {
      path: location.pathname,
      cta: r(cta),
      ctaBg: cta ? getComputedStyle(cta).backgroundColor : null,
      logo: r(logo),
      heading: r(heading),
      headingText: heading ? heading.textContent.trim() : null,
    };
  };

  const total = Math.round(DURATION * FPS);
  let scrollTarget = null;
  let ctaFinal = null;
  const cursorStart = { x: 470, y: 820 };
  let pressed = false;
  let released = false;

  for (let i = 0; i < total; i++) {
    const p = i / FPS;

    // --- real scroll, eased -------------------------------------------------
    if (p >= pt(P.scrollStart) && scrollTarget === null) {
      const doc = await page.evaluate(() => {
        const cta = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Build Your PC");
        const b = cta.getBoundingClientRect();
        return { top: b.top + window.scrollY, h: b.height, left: b.left, w: b.width, vh: innerHeight };
      });
      // land the CTA at ~64% of the viewport height
      scrollTarget = Math.max(0, Math.round(doc.top - doc.vh * 0.64));
      ctaFinal = { x: doc.left, y: doc.top - scrollTarget, w: doc.w, h: doc.h };
    }
    if (scrollTarget !== null && p <= pt(P.scrollEnd) + 1 / FPS) {
      const k = scrollEase(clamp01((p - pt(P.scrollStart)) / (pt(P.scrollEnd) - pt(P.scrollStart))));
      await rig.scrollTo(lerp(0, scrollTarget, k));
    }

    // --- cursor ---------------------------------------------------------------
    if (ctaFinal && p >= pt(P.cursorIn)) {
      const target = { x: ctaFinal.x + ctaFinal.w * 0.75, y: ctaFinal.y + ctaFinal.h * 0.52 };
      const k = cursorEase(clamp01((p - pt(P.cursorIn)) / (pt(P.cursorArrive) - pt(P.cursorIn))));
      // gentle arc: a quadratic bezier whose control point bows toward the
      // lower-left, so the approach reads as a hand, not a straight line
      const c = { x: lerp(cursorStart.x, target.x, 0.25) - 10, y: lerp(cursorStart.y, target.y, 0.75) + 40 };
      const x = (1 - k) * (1 - k) * cursorStart.x + 2 * (1 - k) * k * c.x + k * k * target.x;
      const y = (1 - k) * (1 - k) * cursorStart.y + 2 * (1 - k) * k * c.y + k * k * target.y;
      // a hair of magnetic settle after arrival
      const settle = clamp01((p - pt(P.cursorArrive)) / 0.25);
      await rig.moveMouse(x - 2 * Math.sin(settle * Math.PI) * (1 - settle), y);
    }

    // --- press / release ----------------------------------------------------
    if (!pressed && p >= pt(P.press)) {
      pressed = true;
      await rig.mouseDown();
    }
    if (pressed && !released && p >= pt(P.release)) {
      released = true;
      await rig.mouseUp();
    }

    await rig.step({ record });
    if (i % 30 === 0) process.stdout.write(`frame ${i}/${total}\n`);
  }
  await rig.close();
  console.log("done", OUT);
})();
