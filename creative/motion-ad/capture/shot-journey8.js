// v8 capture (cut to the voiceover — every cue below comes from timeline.json v8, which is
// derived from the narration's word onsets). Same rig and viewport as v7:
// the REAL site (main) at a portrait desktop viewport (720×1280,
// the layout a pivoted monitor shows) @ DPR 2.25 = 1620×2880 px per frame,
// 60 fps, deterministic. ONE continuous session:
//   homepage loads (screen power-on) -> a real mouse glides to "Build Your PC"
//   -> real hover / press / client navigation -> "Build a Complete PC" ->
//   one eased scroll that brings budget … build colour into view -> on "what you play":
//   Gaming + the games typed into "Games / software used"; on "the performance you
//   want": 1440p + 144+ FPS; on "your budget": the budget typed; on "the look":
//   White -> scroll to "Send Request via WhatsApp"
//   -> real press (the site builds its own WhatsApp request; the wa.me tab is
//   closed, nothing is sent). The pointer moves EVERY frame along eased curved
//   paths, so the composited cursor is drawn exactly where the real one was.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "journey8");
const V = T.v8;
const VP = V.viewport;
const C0 = V.home.captureStart;
const pt = (t) => t - C0;
const Q = V.quote;
const total = Math.round((Q.captureEnd - C0) * FPS) + 1;

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
const flick = bezier(0.55, 0, 0.12, 1);
const hand = bezier(0.4, 0, 0.15, 1); // a hand on a mouse: quick start, careful arrival

const FIND = () => {
  const byText = (sel, txt) => Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim() === txt) || null;
  const group = (label) => document.querySelector(`[role=radiogroup][aria-label="${label}"]`);
  const pill = (label, opt) => { const g = group(label); return g ? Array.from(g.querySelectorAll("[role=radio]")).find((b) => b.textContent.trim() === opt) || null : null; };
  window.__m1 = {
    cta: () => byText("a", "Build Your PC"),
    buildPc: () => byText("button", "Build a Complete PC"),
    gaming: () => pill("Primary use", "Gaming"),
    res: () => pill("Target resolution", "1440p"),
    games: () => document.getElementById("quote-gamesSoftware"),
    budget: () => document.getElementById("budget"),
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
  const rig = await openRig({ base: BASE, route: "/", viewport: { width: VP.width, height: VP.height }, dpr: VP.dpr, outDir: OUT });
  const { page } = rig;
  page.context().on("page", (p) => p.close().catch(() => {}));
  await page.addInitScript(FIND);
  await page.evaluate(FIND);

  const record = () => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const m = window.__m1;
    const cta = m.cta();
    return {
      path: location.pathname,
      cta: r(cta), ctaBg: cta ? getComputedStyle(cta).backgroundColor : null,
      buildPc: r(m.buildPc()), gaming: r(m.gaming()), res: r(m.res()), fps: r(m.fps()), colour: r(m.colour()),
      games: r(m.games()), gamesValue: m.games() ? m.games().value : "", budget: r(m.budget()), budgetValue: m.budget() ? m.budget().value : "",
      send: r(m.send()), fab: r(m.fab()),
      groups: Object.fromEntries(["Primary use", "Target resolution", "Target FPS", "Build colour", "Product preference"].map((g) => {
        const el = document.querySelector(`[role=radiogroup][aria-label="${g}"]`);
        return [g, el ? Array.from(el.querySelectorAll("[role=radio]")).map((b) => ({ label: b.textContent.trim(), sel: b.getAttribute("aria-checked") === "true", ...r(b) })) : null];
      })),
      submitted: !!Array.from(document.querySelectorAll("h2")).find((h) => h.textContent.includes("WhatsApp should now be open")),
    };
  };

  const rectOf = (key) => page.evaluate((k) => { const e = window.__m1[k](); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, sy: scrollY, vh: innerHeight }; }, key);
  const setInput = (id, value) => page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { id, value });

  // ---- pointer: eased, slightly curved paths, re-aimed at the live element every frame
  let cursor = { x: VP.width + 40, y: VP.height * 0.86 };
  const paths = []; // {t0, t1, from, key, fx, fy}
  const go = (t0, t1, key, fx = 0.5, fy = 0.5) => paths.push({ t0: pt(t0), t1: pt(t1), key, fx, fy, from: null });
  go(V.home.cursorIn[0], V.home.cursorIn[1], "cta", 0.68, 0.55);
  go(Q.build.path[0], Q.build.path[1], "buildPc", 0.6, 0.55);
  go(Q.gaming.path[0], Q.gaming.path[1], "gaming", 0.55, 0.55);
  go(Q.games.path[0], Q.games.path[1], "games", 0.3, 0.55);
  go(Q.res.path[0], Q.res.path[1], "res", 0.55, 0.55);
  go(Q.fps.path[0], Q.fps.path[1], "fps", 0.55, 0.55);
  go(Q.budget.path[0], Q.budget.path[1], "budget", 0.3, 0.55);
  go(Q.colour.path[0], Q.colour.path[1], "colour", 0.55, 0.55);
  go(Q.send.path[0], Q.send.path[1], "send", 0.62, 0.55);

  const scrolls = [];
  let scrollY = 0;
  const planScroll = async (t0, t1, key, frac) => {
    const r = await rectOf(key);
    const from = r.sy;
    const to = Math.max(0, Math.round(r.y + r.sy - r.vh * frac));
    scrolls.push({ t0: pt(t0), t1: pt(t1), from, to });
  };
  const done = new Set();
  const typedCount = {};
  const once = async (name, cond, fn) => { if (!done.has(name) && cond) { done.add(name); await fn(); } };
  const presses = [
    ["cta", V.home.press, V.home.release],
    ["build", Q.build.press, Q.build.release],
    ["gaming", Q.gaming.press, Q.gaming.release],
    ["games", Q.games.press, Q.games.release],
    ["budget", Q.budget.press, Q.budget.release],
    ["res", Q.res.press, Q.res.release],
    ["fps", Q.fps.press, Q.fps.release],
    ["colour", Q.colour.press, Q.colour.release],
    ["send", Q.send.press, Q.send.release],
  ];

  for (let i = 0; i < total; i++) {
    const p = i / FPS;
    for (const [name, a, b] of presses) {
      await once(name + "D", p >= pt(a), () => rig.mouseDown());
      await once(name + "U", p >= pt(b), () => rig.mouseUp());
    }
    await once("plan1", p >= pt(Q.build.release) + 0.05, () => planScroll(Q.scroll1[0], Q.scroll1[1], "budget", 0.1));
    await once("plan2", p >= pt(Q.budget.release) + 0.05, () => planScroll(Q.colour.path[0], Q.colour.path[1] - 0.08, "lblColour", 0.82));
    // typing (real key events into the focused field)
    for (const [key, spec] of [["games", Q.games], ["budget", Q.budget]]) {
      const [a, b] = spec.type;
      if (p >= pt(a) && p <= pt(b) + 2 / FPS) {
        const n = Math.min(spec.text.length, Math.floor(((p - pt(a)) / (b - a)) * spec.text.length + 1e-6) + 1);
        const typed = typedCount[key] || 0;
        if (n > typed) { await page.keyboard.type(spec.text.slice(typed, n)); typedCount[key] = n; }
      }
    }
    // off-camera (scrolled out of view / under the dimmed quote): the required product preference + fictional name / mobile (never shown)
    await once("offcam", p >= pt(Q.consolidate[0]) + 0.1, async () => {
      await page.evaluate(() => window.__m1.pref().click());
      await setInput("fullName", "Demo Customer");
      await setInput("mobile", "50000000");
    });
    await once("plan3", p >= pt(Q.colour.release) + 0.05, () => planScroll(Q.scroll3[0], Q.scroll3[1], "send", 0.74));

    for (const s of scrolls) {
      if (p >= s.t0 && p <= s.t1 + 1 / FPS) {
        const k = flick(Math.min(1, (p - s.t0) / (s.t1 - s.t0)));
        const y = Math.round((s.from + (s.to - s.from) * k) * 4) / 4;
        if (y !== scrollY) { scrollY = y; await rig.scrollTo(y); }
      }
    }

    // pointer
    for (const seg of paths) {
      if (p >= seg.t0 && p <= seg.t1 + 1 / FPS) {
        if (!seg.from) seg.from = { ...cursor };
        const r = await rectOf(seg.key);
        if (!r) continue;
        const to = { x: r.x + r.w * seg.fx, y: r.y + r.h * seg.fy };
        const k = hand(Math.min(1, (p - seg.t0) / (seg.t1 - seg.t0)));
        const dx = to.x - seg.from.x, dy = to.y - seg.from.y;
        const bow = 0.12 * Math.sin(Math.PI * k);
        cursor = { x: seg.from.x + dx * k - dy * bow, y: seg.from.y + dy * k + dx * bow };
      }
    }
    await rig.moveMouse(cursor.x, cursor.y);
    await rig.step({ record });
    if (i % 60 === 0) console.log(`frame ${i}/${total}`);
  }
  await rig.close();
  console.log("done", OUT);
})();
