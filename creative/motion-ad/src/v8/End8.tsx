import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide } from "../final/shared";
import { FONT } from "../final/fonts";
import { LEFT, RIGHT, LOGO_SRC, P, SEAM, lerpP, pathOf, resample, N } from "../v7/geom";
import { Line, arrive as glideIn } from "./Kinetic";
import { DohaQatar } from "./Intro8";
import { ClashSpark, EmblemHalves, halfPose, impulse, settledAt } from "./Merge";
import { CLOG, D, SH, SW, V, cIndex } from "./time";

/**
 * After the fly-through: the REAL closing section of the site fills the Reel
 * (the capture, 1:1 with what was on the monitor's glass). A cursor arrives
 * and the real button answers with its hover. Then the brand signature: the
 * page falls away except the red button; it splits into two angular strips
 * that turn and fold into the halves of the real M1 emblem; the site's own
 * header mark flies in with them; a short distance apart they strike together
 * (the same single-curve move as the opening) — a refined clash spark on the
 * contact frame; the logo is perfect and still; yellow light lifted from the
 * header logo draws M1 GAMING PCS; DOHA • QATAR; monepcs.qa; a clean hold.
 */
const SG = V.sig;
const FS = 1080 / SW; // capture px → frame px when full-screen
const css = (v: number) => v * D * FS; // css px → frame px
const frameSrc = (i: number) => staticFile(`cap/cta8/f${String(i).padStart(5, "0")}.png`);

const LOGO_W = 560;
const LS = LOGO_W / LOGO_SRC.w;
const LOGO = { left: 540 - LOGO_W / 2, top: 400 };
const BY = 700; // where the button waits before it splits (just under the emblem's apex)
const logoPt = (p: P): P => ({ x: LOGO.left + p.x * LS, y: LOGO.top + p.y * LS });
export const END_D0 = 40; // px each half starts from its place before the strike

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

export const End8: React.FC<{ t: number; from: number; vo: boolean }> = ({ t, from }) => {
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
  const bcx = lerp((btnA.x + btnB.x) / 2, 540, toMid), bcy = lerp((btnA.y + btnB.y) / 2, BY, toMid);

  // split → fly → fold → hang → LOCK
  const split = t >= SG.split;
  const S0 = strips({ x: 540, y: BY }, 640, (640 * BTN.h) / BTN.w);
  const apart = ease.outCubic(range(t, SG.split, SG.fly[0] + 0.24));
  const fold = ease.inOutCubic(range(t, SG.fly[0] + 0.14, SG.fly[1]));
  const pose = halfPose(t, SG.fly[1], SG.merge[0], SG.lock, END_D0, 0);
  const toArt = range(t, SG.fly[1] - 0.04, SG.fly[1] + 0.16); // the folded shapes become the real art halves
  const settled = t >= settledAt(SG.lock);
  const jolt = impulse(t, SG.lock);
  const flyHalf = (side: -1 | 1, poly: P[], target: P[]) => {
    const ang = (side * 28 * apart * (1 - fold) * Math.PI) / 180;
    const cx = 540 + side * 300 * apart * (1 - fold), cy = BY - 120 * apart * (1 - fold);
    const stripT = poly.map((p) => { const dx = p.x - 540, dy = p.y - BY; return { x: cx + dx * Math.cos(ang) - dy * Math.sin(ang), y: cy + dx * Math.sin(ang) + dy * Math.cos(ang) }; });
    const emb = target.map((p) => { const q = logoPt(p); return { x: q.x + side * pose.dx, y: q.y + pose.dy }; });
    return lerpP(stripT, emb, fold);
  };
  const Lp = flyHalf(-1, S0.left, LEFT), Rp = flyHalf(1, S0.right, RIGHT);
  const btnRed = (() => {
    const mm = /rgb\((\d+), (\d+), (\d+)\)/.exec(CLOG[idx].meta.btnBg);
    const c0 = mm ? [+mm[1], +mm[2], +mm[3]] : [231, 50, 37];
    const kk = range(t, SG.fly[0] + 0.1, SG.fly[1]);
    return `rgb(${Math.round(lerp(c0[0], 190, kk))},${Math.round(lerp(c0[1], 48, kk))},${Math.round(lerp(c0[2], 29, kk))})`;
  })();
  const hit = logoPt({ x: SEAM, y: 2080 });

  // the site's header mark joins (red), its yellow becomes the wordmark
  const hlA = zoomAbout({ x: css(HL.x), y: css(HL.y) });
  const hlW = css(HL.w) * calm, hlH = css(HL.h) * calm;
  const markK = ease.inOutCubic(range(t, SG.split, SG.lock - 0.02));
  const stem = logoPt({ x: SEAM, y: 2300 });
  const yel = (i: number) => ease.inOutCubic(range(t, SG.yellow[0] + 0.06 * i, SG.yellow[1] - 0.04 + 0.03 * i));
  const wm1 = ease.inOutCubic(range(t, SG.wordmark[0], SG.wordmark[0] + 0.24));
  const wm2 = ease.inOutCubic(range(t, SG.gaming, SG.wordmark[1] + 0.06));
  const sweep = range(t, SG.sweep[0], SG.sweep[1]);
  const dq = glideIn(range(t, SG.doha, SG.doha + 0.36));
  const url = glideIn(range(t, SG.url, SG.url + 0.36));
  // kinetic CTA (in the site's empty band above its own heading) and the address
  const CW = V.cta.words;
  const yoursTint = range(t, CW.yours + 0.05, CW.yours + 0.3) * (1 - fade);
  const YW = CLOG[0].meta.words.find((w) => w.w.startsWith("yours")) ?? { x: 24, y: 542, wd: 160, h: 65, w: "yours?" };
  const pct = (y: number) => (y / LOGO_SRC.h) * 100;
  const xpct = (x: number) => (x / LOGO_SRC.w) * 100;
  const wmClip = (y0: number, y1: number, k: number) => `inset(${pct(y0 - 40)}% ${100 - (xpct(500) + k * (xpct(4450) - xpct(500)))}% ${100 - pct(y1 + 40)}% 0)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", transform: jolt ? `translateY(${jolt}px)` : undefined }}>
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
      {/* "yours?" on the real heading takes the M1 yellow as the narrator lands on it */}
      {yoursTint > 0 && (() => {
        const a = zoomAbout({ x: css(YW.x), y: css(YW.y) });
        const w = css(YW.wd) * calm, h = css(YW.h) * calm;
        const pad = 6;
        return (
          <svg width={w + 2 * pad} height={h + 2 * pad} style={{ position: "absolute", left: a.x - pad, top: a.y - pad, opacity: yoursTint }}>
            <defs>
              <mask id="yoursMask" maskUnits="userSpaceOnUse" x={0} y={0} width={w + 2 * pad} height={h + 2 * pad}>
                <image href={frameSrc(idx)} x={-css(YW.x) * calm + pad - (a.x - zoomAbout({ x: css(YW.x), y: css(YW.y) }).x)} y={-css(YW.y) * calm + pad} width={SW * FS * calm} height={SH * FS * calm} preserveAspectRatio="none" style={{ filter: "contrast(3) brightness(1.4)" }} />
              </mask>
            </defs>
            <rect x={0} y={0} width={w + 2 * pad} height={h + 2 * pad} fill={BRAND.yellow} mask="url(#yoursMask)" />
          </svg>
        );
      })()}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - fade }}>
        <Line t={t} x={56} y={300} size={150} out={V.vo.visit.start + 0.05} outDur={0.28} outMode="blur" words={[{ w: "READY", at: CW.ready, gap: 0 }]} />
        <Line t={t} x={56} y={455} size={150} out={V.vo.visit.start + 0.1} outDur={0.28} outMode="blur" words={[{ w: "TO", at: CW.to }, { w: "BUILD", at: CW.to + 0.1, gap: 0 }]} />
        <Line t={t} x={56} y={610} size={150} out={V.vo.visit.start + 0.15} outDur={0.28} outMode="blur" words={[{ w: "YOURS?", at: CW.yours, color: BRAND.yellow, gap: 0 }]} />
        {/* monepcs.qa — said, and written large */}
        <Line t={t} x={540} y={430} size={118} align="center" weight={700} track={0.0} out={SG.fade[0] + 0.05} outDur={0.3} outMode="blur" words={[{ w: "monepcs.qa", at: V.cta.url, gap: 0 }]} />
        {t >= V.cta.url + 0.25 && <div style={{ position: "absolute", left: 540 - 300, top: 572, width: 600 * glide(range(t, V.cta.url + 0.25, V.cta.url + 0.65)), height: 7, borderRadius: 4, background: BRAND.yellow, boxShadow: "0 0 18px rgba(249,194,4,0.7)", opacity: 1 - range(t, SG.fade[0] + 0.05, SG.fade[0] + 0.3) }} />}
      </div>
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
            {toArt < 1 && <path d={pathOf(Lp)} fill={btnRed} opacity={1 - toArt} />}
            {toArt < 1 && <path d={pathOf(Rp)} fill={btnRed} opacity={1 - toArt} />}
          </svg>
          <div style={{ position: "absolute", left: 0, right: 0, top: BY - 30, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 46, color: "#fff", opacity: 1 - range(t, SG.split, SG.split + 0.08) }}>Build Your PC</div>
          {toArt > 0 && <EmblemHalves left={LOGO.left} top={LOGO.top} width={LOGO_W} pose={pose} whole={settled} opacity={toArt} />}
          <ClashSpark t={t} at={SG.lock} x={hit.x} y={hit.y} refined />
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
      {/* the clash's yellow light runs out of the spark and draws the wordmark */}
      {t >= SG.yellow[0] && t < SG.wordmark[0] + 0.12 &&
        [0, 1, 2].map((i) => {
          const k = yel(i);
          const target = logoPt({ x: 1100 + 1100 * i, y: i === 2 ? 4860 : 3900 });
          const from = hit;
          const ctrl = { x: target.x + (target.x - 540) * 0.5, y: lerp(from.y, target.y, 0.35) };
          const q = (u: number) => ({ x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * ctrl.x + u * u * target.x, y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * ctrl.y + u * u * target.y });
          const p = q(k), p2 = q(Math.max(0, k - 0.08));
          const ang = (Math.atan2(p.y - p2.y, p.x - p2.x) * 180) / Math.PI;
          const len = 40 + 150 * Math.sin(Math.PI * k);
          return <div key={i} style={{ position: "absolute", left: p.x - len, top: p.y - 5, width: len, height: 10, borderRadius: 5, transformOrigin: "100% 50%", transform: `rotate(${ang}deg)`, background: `linear-gradient(90deg, rgba(249,194,4,0), ${BRAND.yellow})`, opacity: range(t, SG.yellow[0] + 0.06 * i, SG.yellow[0] + 0.06 * i + 0.08) * (1 - range(t, SG.wordmark[0], SG.wordmark[0] + 0.1)), boxShadow: "0 0 18px 2px rgba(249,194,4,0.8)" }} />;
        })}
      {/* the final hold: the real logo, DOHA • QATAR, monepcs.qa */}
      {dq > 0 && <DohaQatar k={dq} y={LOGO.top + 5053 * LS + 58} />}
      {url > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: LOGO.top + 5053 * LS + 146, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 58, letterSpacing: 1, color: BRAND.white, opacity: url, transform: `translateY(${(1 - url) * 18}px)`, filter: `blur(${(6 * (1 - url) * (1 - url)).toFixed(2)}px)` }}>
          monepcs.qa
        </div>
      )}
    </AbsoluteFill>
  );
};

export const endSamples8 = (t: number) => {
  if (t >= SG.fade[0] && t < SG.fly[1]) return 6;
  return 1;
};
export { clamp01 };
