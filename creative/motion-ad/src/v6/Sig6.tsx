import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { Cam, K, SiteFrame, clampCam, toScreen } from "../lib/SiteFrame";
import { BRAND, camAt, glide } from "../final/shared";
import { FONT } from "../final/fonts";
import OUTLINE from "../data/emblem-outline.json";
import { CLOG, V, cIndex } from "./time";

/**
 * v6 shot 9 + the brand signature.
 *  9. The fan's circular light stretches into a pill — the real red
 *     "Build Your PC" button of the site's closing section — and the camera
 *     pulls back to the live section ("Ready to build yours?"); a real hover
 *     answers on the button.
 *  ✦ The page collapses around the button. The button splits into two angular
 *     red strips; they fly apart, turn and fold into the left and right halves
 *     of the real M1 emblem; they hang a breath apart — LOCK. Yellow fragments
 *     lifted from the site's own header logo travel under the emblem and draw
 *     the M1 wordmark, GAMING PCS resolves, one light sweep, BUILD YOURS.,
 *     monepcs.qa, a clean hold.
 */

const CT = V.cta;
const SG = V.sig;
const DIR = "cta6";

// ------------------------------------------------------------------ geometry
type P = { x: number; y: number };
const SEAM = 2258;
function clipHalf(poly: P[], keepLeft: boolean): P[] {
  const inside = (p: P) => (keepLeft ? p.x <= SEAM : p.x >= SEAM);
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const u = (SEAM - a.x) / (b.x - a.x);
      out.push({ x: SEAM, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}
function resample(poly: P[], n: number): P[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }
  const out: P[] = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i] < target) {
      acc += seg[i];
      i = (i + 1) % poly.length;
    }
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const u = seg[i] > 0 ? (target - acc) / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}
const rotateTo = (poly: P[], start: P) => {
  let bi = 0, bd = Infinity;
  poly.forEach((p, i) => {
    const d = Math.hypot(p.x - start.x, p.y - start.y);
    if (d < bd) { bd = d; bi = i; }
  });
  return [...poly.slice(bi), ...poly.slice(0, bi)];
};
const N = 120;
const EMB = (OUTLINE as number[][]).map(([x, y]) => ({ x, y }));
// left half from the left horn tip, right half from the V apex — both clockwise
const LEFT = resample(rotateTo(clipHalf(EMB, true), { x: 801, y: 585 }), N);
const RIGHT = resample(rotateTo(clipHalf(EMB, false), { x: SEAM, y: 1581 }), N);
const path = (p: P[]) => "M" + p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" L") + " Z";
const lerpP = (a: P[], b: P[], k: number) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
const xform = (poly: P[], f: (p: P) => P) => poly.map(f);

// final logo placement
const LOGO_W = 660;
const LOGO = { left: 540 - LOGO_W / 2, top: 196, s: LOGO_W / 4500 };
const logoPt = (p: P) => ({ x: LOGO.left + p.x * LOGO.s, y: LOGO.top + p.y * LOGO.s });

// the strips the button splits into (screen space, around the button's centre at the split)
function strips(c: P, w: number, h: number) {
  const r = h / 2;
  const cut = 0.1 * w; // a slanted cut through the middle
  const left: P[] = [
    { x: c.x - w / 2 + r, y: c.y - h / 2 },
    { x: c.x + cut / 2, y: c.y - h / 2 },
    { x: c.x - cut / 2, y: c.y + h / 2 },
    { x: c.x - w / 2 + r, y: c.y + h / 2 },
    ...Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI / 2 + (Math.PI * (i + 1)) / 10;
      return { x: c.x - w / 2 + r + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    }),
  ];
  const right: P[] = [
    { x: c.x + cut / 2 + 6, y: c.y - h / 2 },
    { x: c.x + w / 2 - r, y: c.y - h / 2 },
    ...Array.from({ length: 9 }, (_, i) => {
      const a = -Math.PI / 2 + (Math.PI * (i + 1)) / 10;
      return { x: c.x + w / 2 - r + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    }),
    { x: c.x + w / 2 - r, y: c.y + h / 2 },
    { x: c.x - cut / 2 + 6, y: c.y + h / 2 },
  ];
  return { left: resample(left, N), right: resample(right, N) };
}

// ------------------------------------------------------------------ cameras
const BTN = CLOG[0].meta.btn;
const CTA_CAM: Cam = { cx: 216, cy: 350, s: 1.0 };
const btnC = { x: BTN.x + BTN.w / 2, y: BTN.y + BTN.h / 2 };
const PULL_S0 = 2.1;
function ctaCam(t: number): Cam {
  const k = ease.inOutCubic(range(t, CT.pull[0], CT.pull[1]));
  const s = lerp(PULL_S0, CTA_CAM.s, k);
  // keep the button pinned while we pull back, then settle to the section framing
  const cx = lerp(btnC.x, CTA_CAM.cx, k);
  const cy = lerp(btnC.y, CTA_CAM.cy, k);
  const drift = 0.03 * ease.inOutCubic(range(t, CT.pull[1], SG.collapse[0]));
  return clampCam({ cx, cy, s: s * (1 + drift) });
}

export const SIG_END = V.duration;

export const Sig6: React.FC<{ t: number }> = ({ t }) => {
  if (t < CT.stretch[0]) return null;
  const idx = cIndex(t);
  const cam = ctaCam(t);

  // ---------------------------------------------------------- fan light → the button
  const st = ease.inOutCubic(range(t, CT.stretch[0], CT.stretch[1]));
  const bA0 = toScreen(BTN.x, BTN.y, ctaCam(CT.stretch[1])), bB0 = toScreen(BTN.x + BTN.w, BTN.y + BTN.h, ctaCam(CT.stretch[1]));
  const pillW = lerp(560 * 2, bB0.x - bA0.x, st), pillH = lerp(560 * 2, bB0.y - bA0.y, st);
  const pillCx = lerp(540, (bA0.x + bB0.x) / 2, st), pillCy = lerp(960, (bA0.y + bB0.y) / 2, st);
  const realIn = range(t, CT.stretch[1] - 0.06, CT.stretch[1] + 0.06);
  const pageIn = ease.inOutCubic(range(t, CT.stretch[1], CT.stretch[1] + 0.3));

  // ---------------------------------------------------------- collapse
  const col = ease.inOutCubic(range(t, SG.collapse[0], SG.collapse[1]));
  const bNow = toScreen(BTN.x, BTN.y, cam), bNowB = toScreen(BTN.x + BTN.w, BTN.y + BTN.h, cam);
  const btnW0 = bNowB.x - bNow.x;
  const toMid = ease.inOutCubic(range(t, SG.collapse[0] + 0.08, SG.split));
  const btnCenter = { x: lerp((bNow.x + bNowB.x) / 2, 540, toMid), y: lerp((bNow.y + bNowB.y) / 2, 860, toMid) };
  const btnScale = lerp(1, 640 / btnW0, toMid);
  const bcam = camAt(btnC.x, btnC.y, btnCenter.x, btnCenter.y, cam.s * btnScale);

  // ---------------------------------------------------------- split → fly → fold → lock
  const split = t >= SG.split;
  const sw = 640, sh = (BTN.h / BTN.w) * 640;
  const S0 = strips({ x: 540, y: 860 }, sw, sh);
  const apart = ease.outCubic(range(t, SG.split, SG.fly[0] + 0.24));
  const fold = ease.inOutCubic(range(t, SG.fly[0] + 0.14, SG.fly[1]));
  const lock = ease.inCubic(range(t, SG.lock - 0.05, SG.lock));
  // hanging a breath apart before the lock (gap in logo px)
  const gapPx = (t < SG.fly[1] ? 120 : lerp(18, 10, range(t, SG.fly[1], SG.dip[1] - 0.05)) + 1.2 * Math.sin(t * 60) * range(t, SG.dip[0], SG.dip[1] - 0.05)) * (1 - lock);
  const flyHalf = (side: -1 | 1, poly: P[], target: P[]) => {
    // the strip: pushed apart and turned
    const ang = (side * 28 * apart * (1 - fold) * Math.PI) / 180;
    const cx = 540 + side * 300 * apart * (1 - fold), cy = 860 - 120 * apart * (1 - fold);
    const stripT = xform(poly, (p) => {
      const dx = p.x - 540, dy = p.y - 860;
      return { x: cx + dx * Math.cos(ang) - dy * Math.sin(ang), y: cy + dx * Math.sin(ang) + dy * Math.cos(ang) };
    });
    const emb = xform(target, (p) => {
      const q = logoPt(p);
      return { x: q.x + side * gapPx * LOGO.s * 4.5, y: q.y };
    });
    return lerpP(stripT, emb, fold);
  };
  const L = flyHalf(-1, S0.left, LEFT);
  const R = flyHalf(1, S0.right, RIGHT);
  const btnRed = CLOG[Math.min(CLOG.length - 1, idx)].meta.btnBg;
  const redK = range(t, SG.fly[0] + 0.1, SG.fly[1]);
  const fill = (() => {
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(btnRed);
    const c0 = m ? [+m[1], +m[2], +m[3]] : [231, 50, 37];
    return `rgb(${Math.round(lerp(c0[0], 190, redK))},${Math.round(lerp(c0[1], 48, redK))},${Math.round(lerp(c0[2], 29, redK))})`;
  })();
  const art = range(t, SG.lock + 0.01, SG.lock + 0.1);
  const lockFlash = Math.max(0, 1 - Math.abs(t - SG.lock - 0.02) / 0.06);

  // ---------------------------------------------------------- yellow fragments from the site's header logo → the wordmark
  const hl = CLOG[0].meta.headerLogo ?? { x: 16, y: 12, w: 32, h: 40 };
  const hlS = toScreen(hl.x + hl.w / 2, hl.y + hl.h * 0.8, cam);
  const wm1 = { y0: 3542, y1: 4257 }, wm2 = { y0: 4666, y1: 5053 };
  const wmDraw1 = ease.inOutCubic(range(t, SG.wordmark[0], SG.wordmark[0] + 0.24));
  const wmDraw2 = ease.inOutCubic(range(t, SG.gaming, SG.wordmark[1] + 0.06));
  const sweep = range(t, SG.sweep[0], SG.sweep[1]);
  const l1 = ease.settle(range(t, SG.line1, SG.line1 + 0.32));
  const l2 = ease.settle(range(t, SG.line2, SG.line2 + 0.3));

  const pct = (y: number) => (y / 5625) * 100;
  const xpct = (x: number) => (x / 4500) * 100;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* the real closing section (pulled back to, then collapsing) */}
      {t >= CT.stretch[1] - 0.06 && (
        <AbsoluteFill style={{ backgroundColor: "#000" }}>
          <AbsoluteFill style={{ opacity: pageIn * (1 - col), transformOrigin: "540px 900px", transform: `scale(${1 - 0.06 * col})`, filter: col > 0.01 ? `blur(${8 * col}px)` : undefined }}>
            <SiteFrame dir={DIR} index={idx} cam={cam} brightness={1 - 0.6 * col} />
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      {/* the fan's light stretching into the button */}
      {t < CT.stretch[1] + 0.08 && (
        <div style={{ position: "absolute", left: pillCx - pillW / 2, top: pillCy - pillH / 2, width: pillW, height: pillH, borderRadius: pillH / 2, background: st < 0.5 ? "radial-gradient(closest-side, rgba(255,90,60,1), rgba(231,50,37,1) 70%, rgba(231,50,37,0.9))" : "rgb(231,50,37)", opacity: 1 - realIn }} />
      )}

      {/* the real button: pinned through the pull-back and the collapse, until it splits */}
      {t >= CT.stretch[1] - 0.06 && !split && (
        <AbsoluteFill style={{ opacity: Math.min(realIn * 1.2, 1) }}>
          {(() => {
            const c2 = col > 0 ? bcam : cam;
            const a = toScreen(BTN.x, BTN.y, c2), b = toScreen(BTN.x + BTN.w, BTN.y + BTN.h, c2);
            return (
              <AbsoluteFill style={{ clipPath: `inset(${a.y}px ${1080 - b.x}px ${1920 - b.y}px ${a.x}px round ${(b.y - a.y) / 2}px)` }}>
                <SiteFrame dir={DIR} index={idx} cam={c2} />
              </AbsoluteFill>
            );
          })()}
        </AbsoluteFill>
      )}

      {/* the signature */}
      {split && (
        <AbsoluteFill>
          <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <path d={path(L)} fill={fill} opacity={1 - art} />
            <path d={path(R)} fill={fill} opacity={1 - art} />
          </svg>
          {/* the label leaves with the split */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 860 - 30, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 46, color: "#fff", opacity: 1 - range(t, SG.split, SG.split + 0.08) }}>Build Your PC</div>
          {/* the real emblem takes over at the lock */}
          <div style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: 5625 * LOGO.s, opacity: art, clipPath: `inset(0 0 ${100 - pct(3150)}% 0)` }}>
            <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
          </div>
          {lockFlash > 0 && (
            <div style={{ position: "absolute", left: LOGO.left + xpct(SEAM) * LOGO_W / 100 - 3, top: LOGO.top + pct(1500) * 5625 * LOGO.s / 100, width: 6, height: (3150 - 1500) * LOGO.s, background: "rgba(255,240,228,0.9)", opacity: lockFlash, boxShadow: "0 0 24px 6px rgba(255,120,80,0.6)" }} />
          )}
          {/* wordmark: drawn left to right with a bright leading edge */}
          {[{ r: wm1, k: wmDraw1 }, { r: wm2, k: wmDraw2 }].map(({ r, k }, i) =>
            k > 0 ? (
              <div key={i} style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: 5625 * LOGO.s, clipPath: `inset(${pct(r.y0 - 40)}% ${100 - (xpct(500) + k * (xpct(4450) - xpct(500)))}% ${100 - pct(r.y1 + 40)}% 0)` }}>
                <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
                {k < 1 && (
                  <div style={{ position: "absolute", inset: 0, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(90deg, rgba(255,255,255,0) ${xpct(500) + k * (xpct(4450) - xpct(500)) - 5}%, rgba(255,250,225,1) ${xpct(500) + k * (xpct(4450) - xpct(500))}%)` }} />
                )}
              </div>
            ) : null
          )}
          {/* one brand light sweep across the finished logo */}
          {sweep > 0 && sweep < 1 && (
            <div style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: 5625 * LOGO.s, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(105deg, rgba(255,255,255,0) ${-30 + 150 * sweep}%, rgba(255,220,140,0.9) ${-18 + 150 * sweep}%, rgba(255,120,80,0.55) ${-12 + 150 * sweep}%, rgba(255,255,255,0) ${150 * sweep}%)`, mixBlendMode: "screen" }} />
          )}
        </AbsoluteFill>
      )}

      {/* yellow fragments lifted from the site's header logo, travelling to the wordmark */}
      {t >= SG.yellow[0] && t < SG.wordmark[0] + 0.12 &&
        [0, 1, 2].map((i) => {
          const k = ease.inOutCubic(range(t, SG.yellow[0] + 0.06 * i, SG.yellow[1] - 0.04 + 0.03 * i));
          const target = logoPt({ x: 1100 + 1100 * i, y: i === 2 ? 4860 : 3900 });
          const from = { x: hlS.x + 8 * i, y: hlS.y };
          const ctrl = { x: lerp(from.x, target.x, 0.2) + 200, y: Math.max(from.y, target.y) + 240 };
          const q = (u: number) => ({ x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * ctrl.x + u * u * target.x, y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * ctrl.y + u * u * target.y });
          const p = q(k), p2 = q(Math.max(0, k - 0.08));
          const ang = (Math.atan2(p.y - p2.y, p.x - p2.x) * 180) / Math.PI;
          const len = 40 + 150 * Math.sin(Math.PI * k);
          return (
            <div key={i} style={{ position: "absolute", left: p.x - len, top: p.y - 5, width: len, height: 10, borderRadius: 5, transformOrigin: "100% 50%", transform: `rotate(${ang}deg)`, background: `linear-gradient(90deg, rgba(249,194,4,0), ${BRAND.yellow})`, opacity: range(t, SG.yellow[0] + 0.06 * i, SG.yellow[0] + 0.06 * i + 0.08) * (1 - range(t, SG.wordmark[0], SG.wordmark[0] + 0.1)), boxShadow: "0 0 18px 2px rgba(249,194,4,0.8)" }} />
          );
        })}

      {/* BUILD YOURS. / monepcs.qa */}
      {t >= SG.line1 && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1020, textAlign: "center", fontFamily: FONT.display, fontWeight: 700, fontSize: 138, letterSpacing: -3, color: BRAND.white }}>
            <div style={{ overflow: "hidden", paddingBottom: 8 }}>
              <div style={{ transform: `translateY(${(1 - l1) * 110}%)` }}>
                BUILD <span style={{ color: BRAND.yellow }}>YOURS.</span>
              </div>
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1196, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 54, letterSpacing: 2, color: BRAND.white, opacity: l2, transform: `translateY(${(1 - l2) * 22}px)` }}>monepcs.qa</div>
        </>
      )}
    </AbsoluteFill>
  );
};

export const sigSamples6 = (t: number) => {
  if (t >= CT.stretch[0] && t < CT.pull[0] + 0.3) return 6;
  if (t >= SG.collapse[0] && t < SG.lock + 0.05) return 6;
  if (t >= SG.yellow[0] && t < SG.wordmark[0]) return 4;
  return 1;
};

export { K };
