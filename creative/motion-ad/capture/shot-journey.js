// Final-ad capture: ONE continuous live session on the REAL site (main, mobile
// layout) at 60 fps, deterministic.
//   homepage (identical to the approved v5 capture) -> real press on
//   "Build Your PC" -> real client navigation to /build-my-pc -> real tap on
//   "Build a Complete PC" (the category questions appear) -> eased real scrolls
//   -> real taps on the real options Gaming / 1440p / 144+ FPS / White ->
//   eased scroll to the real "Send Request via WhatsApp" button -> real press
//   -> real submit (the site builds its own WhatsApp request; the wa.me popup
//   is closed, nothing is sent anywhere).
// Every interaction is a real pointer event, so hover / :active / selected
// states are the site's own. Required fields that are not filmed (name,
// mobile, product preference) are set off-camera with real input events.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "journey");
const H = T.v5.home;
const Q = T.final.quote;
const pt = (t) => t - H.captureStart;
const total = Math.round((Q.captureEnd - H.captureStart) * FPS) + 1;

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
// v5 homepage scroll: fast-out, long settle
const scrollEase = bezier(0.42, 0, 0.16, 1);
// form scrolls: a human flick — anticipation, acceleration, travel, settle
const flick = bezier(0.55, 0, 0.12, 1);

// Element lookups shared by the recorder and the driver.
const FIND = () => {
  const byText = (sel, txt) => Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim() === txt) || null;
  const group = (label) => document.querySelector(`[role=radiogroup][aria-label="${label}"]`);
  const pill = (label, opt) => { const g = group(label); return g ? Array.from(g.querySelectorAll("[role=radio]")).find((b) => b.textContent.trim() === opt) || null : null; };
  window.__m1 = {
    cta: () => byText("a", "Build Your PC"),
    buildPc: () => byText("button", "Build a Complete PC"),
    gaming: () => pill("Primary use", "Gaming"),
    res: () => pill("Target resolution", "1440p"),
    fps: () => pill("Target FPS", "144+ FPS"),
    colour: () => pill("Build colour", "White"),
    pref: () => pill("Product preference", "Find me the best option for my requirements"),
    send: () => byText("button", "Send Request via WhatsApp"),
    fab: () => document.querySelector('a[aria-label="Chat with M1 on WhatsApp"]'),
    lblUse: () => group("Primary use"),
    lblColour: () => group("Build colour"),
  };
};

(async () => {
  const rig = await openRig({ base: BASE, route: "/", viewport: { width: T.viewport.width, height: T.viewport.height }, dpr: T.viewport.dpr, outDir: OUT });
  const { page } = rig;
  // the real submit opens wa.me in a new tab — close it, nothing is sent
  page.context().on("page", (p) => p.close().catch(() => {}));
  await page.addInitScript(FIND);
  await page.evaluate(FIND);

  const record = () => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const m = window.__m1;
    const cta = m.cta();
    const sel = (el) => (el ? el.getAttribute("aria-checked") === "true" : null);
    return {
      path: location.pathname,
      cta: r(cta), ctaBg: cta ? getComputedStyle(cta).backgroundColor : null,
      buildPc: r(m.buildPc()), gaming: r(m.gaming()), res: r(m.res()), fps: r(m.fps()), colour: r(m.colour()),
      send: r(m.send()), fab: r(m.fab()),
      sel: { gaming: sel(m.gaming()), res: sel(m.res()), fps: sel(m.fps()), colour: sel(m.colour()) },
      sendBg: m.send() ? getComputedStyle(m.send()).backgroundColor : null,
      submitted: !!Array.from(document.querySelectorAll("h2")).find((h) => h.textContent.includes("WhatsApp should now be open")),
    };
  };

  // --- helpers ---------------------------------------------------------------
  const rectOf = (key) => page.evaluate((k) => { const e = window.__m1[k](); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width, h: b.height, vh: innerHeight }; }, key);
  const setInput = (id, value) => page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { id, value });
  const pageTap = (key) => page.evaluate((k) => window.__m1[k]().click(), key);

  // v5 homepage state
  let target = null, ctaFinal = null, moved = false, pressed = false, released = false;
  // form state
  const scrolls = []; // {t0,t1,from,to}
  let scrollY = 0;
  const done = new Set();
  const once = async (name, cond, fn) => { if (!done.has(name) && cond) { done.add(name); await fn(); } };
  const touch = async (key, fx = 0.5) => {
    const r = await rectOf(key);
    const y = r.y - (await page.evaluate(() => scrollY));
    await rig.moveMouse(r.x + r.w * fx, y + r.h * 0.5);
  };
  const lift = () => rig.moveMouse(-60, -60);
  const planScroll = async (t0, t1, key, frac) => {
    const r = await rectOf(key);
    const from = await page.evaluate(() => scrollY);
    const to = Math.max(0, Math.round(r.y - r.vh * frac));
    scrolls.push({ t0: pt(t0), t1: pt(t1), from, to });
  };

  for (let i = 0; i < total; i++) {
    const p = i / FPS;

    // ---------------- homepage: exactly the approved v5 capture ----------------
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

    // ---------------- /build-my-pc: the customer's requirements ----------------
    await once("liftHome", p >= pt(H.release) + 0.1, lift);
    await once("buildIn", p >= pt(Q.buildIn), () => touch("buildPc", 0.62));
    await once("buildPress", p >= pt(Q.buildPress), () => rig.mouseDown());
    await once("buildRelease", p >= pt(Q.buildRelease), async () => {
      await rig.mouseUp();
      await lift();
      // off-camera: the required product preference (well below the fold now)
      await pageTap("pref");
      await planScroll(Q.scroll1[0], Q.scroll1[1], "lblUse", 0.3);
    });
    // off-camera: name / mobile once they are above the viewport (fictional demo values, never shown)
    await once("details", p >= pt(Q.scroll1[0]) + 0.3, async () => {
      await setInput("fullName", "Demo Customer");
      await setInput("mobile", "50000000");
    });
    await once("gamingIn", p >= pt(Q.gamingIn), () => touch("gaming"));
    await once("gamingPress", p >= pt(Q.gamingPress), () => rig.mouseDown());
    await once("gamingRelease", p >= pt(Q.gamingRelease), async () => { await rig.mouseUp(); await lift(); });
    await once("resIn", p >= pt(Q.resIn), () => touch("res"));
    await once("resPress", p >= pt(Q.resPress), () => rig.mouseDown());
    await once("resRelease", p >= pt(Q.resRelease), async () => { await rig.mouseUp(); await lift(); });
    await once("fpsIn", p >= pt(Q.fpsIn), () => touch("fps"));
    await once("fpsPress", p >= pt(Q.fpsPress), () => rig.mouseDown());
    await once("fpsRelease", p >= pt(Q.fpsRelease), async () => {
      await rig.mouseUp();
      await lift();
      await planScroll(Q.scroll2[0], Q.scroll2[1], "lblColour", 0.32);
    });
    await once("colourIn", p >= pt(Q.colourIn), () => touch("colour"));
    await once("colourPress", p >= pt(Q.colourPress), () => rig.mouseDown());
    await once("colourRelease", p >= pt(Q.colourRelease), async () => {
      await rig.mouseUp();
      await lift();
      await planScroll(Q.scroll3[0], Q.scroll3[1], "send", 0.6);
    });
    await once("sendIn", p >= pt(Q.sendIn), () => touch("send", 0.7));
    await once("sendPress", p >= pt(Q.sendPress), () => rig.mouseDown());
    await once("sendRelease", p >= pt(Q.sendRelease), async () => { await rig.mouseUp(); await lift(); });

    for (const s of scrolls) {
      if (p >= s.t0 && p <= s.t1 + 1 / FPS) {
        const k = flick(Math.min(1, (p - s.t0) / (s.t1 - s.t0)));
        const y = Math.round((s.from + (s.to - s.from) * k) * 4) / 4;
        if (y !== scrollY) { scrollY = y; await rig.scrollTo(y); }
      }
    }

    await rig.step({ record });
    if (i % 40 === 0) console.log(`frame ${i}/${total}`);
  }
  await rig.close();
  console.log("done", OUT);
})();
