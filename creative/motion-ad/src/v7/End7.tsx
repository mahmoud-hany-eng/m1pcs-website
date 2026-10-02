import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { FONT } from "../final/fonts";
import { LEFT, RIGHT, LOGO_SRC, P, SEAM, lerpP, pathOf, resample, N } from "./geom";
import { CLOG, D, SH, SW, V, cIndex } from "./time";

/**
 * After the fly-through: the REAL closing section of the site fills the Reel
 * (the capture, 1:1 with what was on the monitor's glass). A cursor arrives
 * and the real button answers with its hover. Then the brand signature: the
 * page falls away except the red button; it splits into two angular strips
 * that turn and fold into the halves of the real M1 emblem; the site's own
 * header mark flies in with them; they hang a breath apart — LOCK; yellow
 * light lifted from the header logo draws the wordmark; one sweep; BUILD
 * YOURS. / monepcs.qa; a clean hold.
 */
const SG = V.sig;
const FS = 1080 / SW; // capture px → frame px when full-screen
const css = (v: number) => v * D * FS; // css px → frame px
const frameSrc = (i: number) => staticFile(`cap/cta7/f${String(i).padStart(5, "0")}.png`);

const LOGO_W = 660;
const LS = LOGO_W / LOGO_SRC.w;
const LOGO = { left: 540 - LOGO_W / 2, top: 196 };
const logoPt = (p: P): P => ({ x: LOGO.left + p.x * LS, y: LOGO.top + p.y * LS });

function strips(c: P, w: number, h: number) {
  const r = h / 2;
  const cut = 0.1 * w;
  const left: P[] = [
    { x: c.x - w / 2 + r, y: c.y - h / 2 }, { x: c.x + cut / 2, y: c.y - h / 2 }, { x: c.x - cut / 2, y: c.y + h / 2 }, { x: c.x - w / 2 + r, y: c.y + h / 2 },
    ...Array.from({ length: 9 }, (_, i) => { const a = Math.PI / 2 + (Math.PI * (i + 1)) / 10; return { x: c.x - w / 2 + r + r * Math.cos(a), y: c.y + r * Math.sin(a) }; }),
  ];
  const right: P[] = [
    { x: c.x + cut / 2 + 6, y: c.y - h / 2 }, { x: c.x + w / 2 - r, y: c.y - h / 2 },
    ...Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + (Math.PI * (i + 1)) / 10; return { x: c.x + w / 2 - r + r * Math.cos(a), y: c.y + r * Math.sin(a) }; }),
    { x: c.x + w / 2 - r, y: c.y + h / 2 }, { x: c.x - cut / 2 + 6, y: c.y + h / 2 },
  ];
  return { left: resample(left, N), right: resample(right, N) };
}

const BTN = CLOG[0].meta.btn;
const HL = CLOG[0].meta.headerLogo ?? { x: 24, y: 20, w: 32, h: 40 };

export const End7: React.FC<{ t: number; from: number }> = ({ t, from }) => {
  if (t < from) return null;
  const idx = cIndex(t);
  const calm = 1 + 0.025 * ease.inOutCubic(range(t, from, SG.fade[0])); // a slow, calm push
  const zoomAbout = (p: P): P => ({ x: 540 + (p.x - 540) * calm, y: 860 + (p.y - 860) * calm });

  // cursor: arrives for the real hover
  const hoverT = V.cta.hover;
  const mEnd = { x: BTN.x + BTN.w * 0.62, y: BTN.y + BTN.h * 0.5 };
  const mk = ease.inOutCubic(range(t, hoverT - 0.55, hoverT));
  const m = { x: lerp(640, mEnd.x, mk) - 40 * Math.sin(Math.PI * mk), y: lerp(1180, mEnd.y, mk) };
  const cursorO = range(t, hoverT - 0.55, hoverT - 0.4) * (1 - range(t, SG.fade[0], SG.fade[0] + 0.15));

  // the page falls away around the button
  const fade = ease.inOutCubic(range(t, SG.fade[0], SG.fade[1]));
  const btnA = zoomAbout({ x: css(BTN.x), y: css(BTN.y) }), btnB = zoomAbout({ x: css(BTN.x + BTN.w), y: css(BTN.y + BTN.h) });
  const toMid = ease.inOutCubic(range(t, SG.fade[0] + 0.1, SG.split));
  const w0 = btnB.x - btnA.x, h0 = btnB.y - btnA.y;
  const bw = lerp(w0, 640, toMid), bh = lerp(h0, (640 * BTN.h) / BTN.w, toMid);
  const bcx = lerp((btnA.x + btnB.x) / 2, 540, toMid), bcy = lerp((btnA.y + btnB.y) / 2, 860, toMid);

  // split → fly → fold → hang → LOCK
  const split = t >= SG.split;
  const S0 = strips({ x: 540, y: 860 }, 640, (640 * BTN.h) / BTN.w);
  const apart = ease.outCubic(range(t, SG.split, SG.fly[0] + 0.24));
  const fold = ease.inOutCubic(range(t, SG.fly[0] + 0.14, SG.fly[1]));
  const lock = ease.inCubic(range(t, SG.lock - 0.05, SG.lock));
  const gap = (t < SG.fly[1] ? 120 : lerp(18, 10, range(t, SG.fly[1], SG.dip[1] - 0.04)) + 1.2 * Math.sin(t * 60) * range(t, SG.dip[0], SG.dip[1] - 0.04)) * (1 - lock);
  const flyHalf = (side: -1 | 1, poly: P[], target: P[]) => {
    const ang = (side * 28 * apart * (1 - fold) * Math.PI) / 180;
    const cx = 540 + side * 300 * apart * (1 - fold), cy = 860 - 120 * apart * (1 - fold);
    const stripT = poly.map((p) => { const dx = p.x - 540, dy = p.y - 860; return { x: cx + dx * Math.cos(ang) - dy * Math.sin(ang), y: cy + dx * Math.sin(ang) + dy * Math.cos(ang) }; });
    const emb = target.map((p) => { const q = logoPt(p); return { x: q.x + side * gap * LS * 4.5, y: q.y }; });
    return lerpP(stripT, emb, fold);
  };
  const Lp = flyHalf(-1, S0.left, LEFT), Rp = flyHalf(1, S0.right, RIGHT);
  const btnRed = (() => {
    const mm = /rgb\((\d+), (\d+), (\d+)\)/.exec(CLOG[idx].meta.btnBg);
    const c0 = mm ? [+mm[1], +mm[2], +mm[3]] : [231, 50, 37];
    const kk = range(t, SG.fly[0] + 0.1, SG.fly[1]);
    return `rgb(${Math.round(lerp(c0[0], 190, kk))},${Math.round(lerp(c0[1], 48, kk))},${Math.round(lerp(c0[2], 29, kk))})`;
  })();
  const art = range(t, SG.lock + 0.01, SG.lock + 0.1);
  const flash = Math.max(0, 1 - Math.abs(t - SG.lock - 0.02) / 0.06);

  // the site's header mark joins (red), its yellow becomes the wordmark
  const hlA = zoomAbout({ x: css(HL.x), y: css(HL.y) });
  const hlW = css(HL.w) * calm, hlH = css(HL.h) * calm;
  const markK = ease.inOutCubic(range(t, SG.split, SG.lock - 0.02));
  const stem = logoPt({ x: SEAM, y: 2300 });
  const yel = (i: number) => ease.inOutCubic(range(t, SG.yellow[0] + 0.06 * i, SG.yellow[1] - 0.04 + 0.03 * i));
  const wm1 = ease.inOutCubic(range(t, SG.wordmark[0], SG.wordmark[0] + 0.24));
  const wm2 = ease.inOutCubic(range(t, SG.gaming, SG.wordmark[1] + 0.06));
  const sweep = range(t, SG.sweep[0], SG.sweep[1]);
  const l1 = ease.settle(range(t, SG.line1, SG.line1 + 0.32));
  const l2 = ease.settle(range(t, SG.line2, SG.line2 + 0.3));
  const pct = (y: number) => (y / LOGO_SRC.h) * 100;
  const xpct = (x: number) => (x / LOGO_SRC.w) * 100;
  const wmClip = (y0: number, y1: number, k: number) => `inset(${pct(y0 - 40)}% ${100 - (xpct(500) + k * (xpct(4450) - xpct(500)))}% ${100 - pct(y1 + 40)}% 0)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* the real site, full frame */}
      <AbsoluteFill style={{ opacity: 1 - fade }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH, transformOrigin: "0 0", transform: `translate(${540 - 540 * calm}px, ${860 - 860 * calm}px) scale(${FS * calm})` }}>
          <Img src={frameSrc(idx)} style={{ width: SW, height: SH }} />
        </div>
      </AbsoluteFill>
      {cursorO > 0 && (
        <svg width={36} height={42} viewBox="0 0 26 30" style={{ position: "absolute", left: zoomAbout({ x: css(m.x), y: css(m.y) }).x - 3, top: zoomAbout({ x: css(m.x), y: css(m.y) }).y - 1, opacity: cursorO, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
          <path d="M2 1 L2 23 L7.5 17.5 L11.5 27 L15 25.5 L11 16.5 L19 16.5 Z" fill="#fff" stroke="#0a0a0b" strokeWidth={1.6} strokeLinejoin="round" />
        </svg>
      )}
      {/* the button alone survives the fade and moves to centre */}
      {t >= SG.fade[0] && !split && (
        <div style={{ position: "absolute", left: bcx - bw / 2, top: bcy - bh / 2, width: bw, height: bh, borderRadius: bh / 2, overflow: "hidden" }}>
          <Img src={frameSrc(idx)} style={{ position: "absolute", left: (-css(BTN.x) / css(BTN.w)) * bw, top: (-css(BTN.y) / css(BTN.h)) * bh, width: (SW * FS * bw) / css(BTN.w), height: (SH * FS * bh) / css(BTN.h) }} />
        </div>
      )}
      {/* the header mark, lifted out of the page */}
      {t >= SG.fade[0] && t < SG.lock + 0.04 && (
        <div style={{ position: "absolute", left: lerp(hlA.x, stem.x - hlW * 0.3, markK), top: lerp(hlA.y, stem.y - hlH * 0.3, markK), width: hlW, height: hlH, transform: `scale(${1 - 0.5 * markK})`, opacity: (1 - range(t, SG.fly[1] - 0.25, SG.fly[1])) * range(t, SG.fade[0], SG.fade[0] + 0.15), overflow: "hidden" }}>
          <Img src={frameSrc(cIndex(SG.fade[0]))} style={{ position: "absolute", left: -css(HL.x) * calm, top: -css(HL.y) * calm, width: SW * FS * calm, height: SH * FS * calm }} />
        </div>
      )}
      {split && (
        <>
          <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <path d={pathOf(Lp)} fill={btnRed} opacity={1 - art} />
            <path d={pathOf(Rp)} fill={btnRed} opacity={1 - art} />
          </svg>
          <div style={{ position: "absolute", left: 0, right: 0, top: 860 - 30, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 46, color: "#fff", opacity: 1 - range(t, SG.split, SG.split + 0.08) }}>Build Your PC</div>
          <div style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: LOGO_SRC.h * LS, opacity: art, clipPath: `inset(0 0 ${100 - pct(3150)}% 0)` }}>
            <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
          </div>
          {flash > 0 && <div style={{ position: "absolute", left: logoPt({ x: SEAM, y: 0 }).x - 3, top: logoPt({ x: 0, y: 1500 }).y, width: 6, height: (3150 - 1500) * LS, background: "rgba(255,240,228,0.9)", opacity: flash, boxShadow: "0 0 24px 6px rgba(255,120,80,0.6)" }} />}
          {[{ y0: 3542, y1: 4257, k: wm1 }, { y0: 4666, y1: 5053, k: wm2 }].map(({ y0, y1, k }, i) =>
            k > 0 ? (
              <div key={i} style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: LOGO_SRC.h * LS, clipPath: wmClip(y0, y1, k) }}>
                <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
                {k < 1 && <div style={{ position: "absolute", inset: 0, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(90deg, rgba(255,255,255,0) ${xpct(500) + k * (xpct(4450) - xpct(500)) - 5}%, rgba(255,250,225,1) ${xpct(500) + k * (xpct(4450) - xpct(500))}%)` }} />}
              </div>
            ) : null
          )}
          {sweep > 0 && sweep < 1 && <div style={{ position: "absolute", left: LOGO.left, top: LOGO.top, width: LOGO_W, height: LOGO_SRC.h * LS, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(105deg, rgba(255,255,255,0) ${-30 + 150 * sweep}%, rgba(255,220,140,0.9) ${-18 + 150 * sweep}%, rgba(255,120,80,0.55) ${-12 + 150 * sweep}%, rgba(255,255,255,0) ${150 * sweep}%)`, mixBlendMode: "screen" }} />}
        </>
      )}
      {/* yellow light lifted from the header logo's wordmark, travelling under the emblem */}
      {t >= SG.yellow[0] && t < SG.wordmark[0] + 0.12 &&
        [0, 1, 2].map((i) => {
          const k = yel(i);
          const target = logoPt({ x: 1100 + 1100 * i, y: i === 2 ? 4860 : 3900 });
          const from = { x: hlA.x + hlW * 0.5 + 6 * i, y: hlA.y + hlH * 0.85 };
          const ctrl = { x: lerp(from.x, target.x, 0.2) + 220, y: Math.max(from.y, target.y) + 260 };
          const q = (u: number) => ({ x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * ctrl.x + u * u * target.x, y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * ctrl.y + u * u * target.y });
          const p = q(k), p2 = q(Math.max(0, k - 0.08));
          const ang = (Math.atan2(p.y - p2.y, p.x - p2.x) * 180) / Math.PI;
          const len = 40 + 150 * Math.sin(Math.PI * k);
          return <div key={i} style={{ position: "absolute", left: p.x - len, top: p.y - 5, width: len, height: 10, borderRadius: 5, transformOrigin: "100% 50%", transform: `rotate(${ang}deg)`, background: `linear-gradient(90deg, rgba(249,194,4,0), ${BRAND.yellow})`, opacity: range(t, SG.yellow[0] + 0.06 * i, SG.yellow[0] + 0.06 * i + 0.08) * (1 - range(t, SG.wordmark[0], SG.wordmark[0] + 0.1)), boxShadow: "0 0 18px 2px rgba(249,194,4,0.8)" }} />;
        })}
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

export const endSamples = (t: number) => {
  if (t >= SG.fade[0] && t < SG.lock + 0.05) return 6;
  return 1;
};
export { clamp01 };
