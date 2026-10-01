// Final-ad capture: the REAL homepage closing section ("Ready to build yours?")
// entering the viewport, at 60 fps, deterministic. The page is scrolled past
// the section once (so the real PC photo is loaded), parked above it, and on
// frame 0 the section is brought into view — its own Framer Motion entrance
// (headline lines rising, PC settling, buttons fading up) then plays on the
// stepped clock.
const path = require("path");
const { openRig, FPS } = require("./rig");
const T = require("../timeline.json");

const BASE = process.env.SITE || "http://localhost:5400";
const OUT = path.join(__dirname, "..", "public", "cap", "cta");
const total = Math.round(2.2 * FPS);

(async () => {
  const rig = await openRig({ base: BASE, route: "/", viewport: { width: T.viewport.width, height: T.viewport.height }, dpr: T.viewport.dpr, outDir: OUT });
  const { page } = rig;
  const sec = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build"));
    const s = h.closest("section");
    const b = s.getBoundingClientRect();
    return { top: b.top + scrollY, h: b.height };
  });
  const parkY = Math.round(sec.top - 1400);
  // warm up: pass over the section so lazy images load, then park above it
  for (const y of [sec.top - 600, sec.top - 200, sec.top, parkY]) {
    await rig.scrollTo(y);
    await page.clock.runFor(700);
    await page.waitForTimeout(400);
  }
  // the section's own photo only (other lazy images stay unloaded, by design);
  // polled from Node because the page's own timers are frozen
  for (let k = 0; k < 40; k++) {
    const ok = await page.evaluate(() => {
      const s = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build")).closest("section");
      const img = s.querySelector("img");
      return !!img && img.complete && img.naturalWidth > 0;
    });
    if (ok) break;
    await page.clock.runFor(100);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  await page.clock.runFor(1500);
  const target = Math.round(sec.top + sec.h / 2 - 768 / 2 + 20);
  const record = () => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const s = Array.from(document.querySelectorAll("h2")).find((e) => e.textContent.includes("Ready to build")).closest("section");
    const btn = Array.from(s.querySelectorAll("a")).find((a) => a.textContent.trim() === "Build Your PC");
    const wa = Array.from(s.querySelectorAll("a")).find((a) => a.textContent.trim() === "WhatsApp Us");
    const img = s.querySelector("img");
    return { h2: r(s.querySelector("h2")), btn: r(btn), wa: r(wa), img: r(img), imgBox: r(img && img.parentElement) };
  };
  for (let i = 0; i < total; i++) {
    if (i === 0) await rig.scrollTo(target);
    await rig.step({ record });
    if (i % 40 === 0) console.log(`frame ${i}/${total}`);
  }
  await rig.close();
  console.log("done", OUT, "scroll", target);
})();
