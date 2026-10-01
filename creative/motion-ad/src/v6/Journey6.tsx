import React from "react";
import { AbsoluteFill } from "remotion";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { C, Cam, K, SiteFrame, VH, VW, clampCam, toScreen } from "../lib/SiteFrame";
import { EmblemPlane, PlaneState, S, TARGET, toScreenPlane } from "../v5/EmblemPlane";
import { EMBLEM, lerpPoly, pill, polyPath } from "../final/morph";
import { BRAND, CamKey, glide, keyCam, snap } from "../final/shared";
import { Touch } from "../final/Touch";
import { FONT } from "../final/fonts";
import { CONTACTS, HOME_LAST, JLOG, Pill, Rect, TAP, V, jIndex } from "./time";

/**
 * v6 shots 1–3 on ONE continuous live capture of the real site:
 *  1. BLACK → a red emblem piece drifts in, the other answers, they're drawn
 *     together, almost touch … CLICK. The wordmark resolves with a light
 *     travelling through it. A beat to read it. Then the camera approaches,
 *     the V gains depth and we enter it.
 *  2. The homepage breathes, the camera eases in, the page starts to move and
 *     the camera and scroll hand the button the attention; a fingertip hovers,
 *     pauses, presses; the button gives and rebounds — then deforms into the
 *     emblem and the camera passes through its V.
 *  3. The real Build My PC flow, each choice its own little idea.
 */

const DIR = "journey6";
const I = V.intro;
const HM = V.home;
const Q = V.quote;
const REL = TAP.cta.release;
export const PASS = REL + 0.6;
export const PAGE_BG = "#0a0a0b";

// ================================================================== shot 1
const Z_END = 40;
function dollyZ(t: number) {
  const u = range(t, I.approach - 0.05, I.pass);
  const c = (1 - 1 / Z_END) * Math.pow(u, 2.0);
  return 1 / (1 - c);
}
const LOGO_REST = { x: 540 + (TARGET.x - 2250) * S, y: 900 + (TARGET.y - 2815) * S };
/** the two halves' gap in logo px: a slow drift that turns into attraction, a held breath, then the lock */
function halfGap(t: number, side: -1 | 1) {
  const t0 = side < 0 ? I.leftIn : I.rightIn;
  const far = 560;
  const u = range(t, t0, I.near);
  // magnetic: the closer they get the harder they pull
  const pull = side < 0 ? Math.pow(u, 2.6) : Math.pow(u, 2.2);
  let g = lerp(far, 16, pull);
  // nearly touching: a held breath with a tiny tremor
  const hold = range(t, I.near, I.lock - 0.035);
  if (t >= I.near) g = 16 - 3 * hold + 1.2 * Math.sin((t - I.near) * 70) * (1 - hold);
  // CLICK
  if (t >= I.lock - 0.035) g = 13 * (1 - ease.inCubic(range(t, I.lock - 0.035, I.lock)));
  return g;
}
function openingPlane(t: number): PlaneState {
  const aim = ease.inOutCubic(range(t, I.approach + 0.05, I.pass - 0.08));
  const approach = range(t, I.approach, I.pass);
  return {
    px: lerp(LOGO_REST.x, C.x, aim),
    py: lerp(LOGO_REST.y, C.y, aim),
    z: dollyZ(t),
    wall: "#000",
    halves: 1,
    split: {
      l: -halfGap(t, -1),
      r: halfGap(t, 1),
      lo: ease.outCubic(range(t, I.leftIn, I.leftIn + 0.22)),
      ro: ease.outCubic(range(t, I.rightIn, I.rightIn + 0.22)),
    },
    wm1: ease.settle(range(t, I.wm[0], I.wm[0] + 0.22)),
    wm2: ease.settle(range(t, I.wm[0] + 0.08, I.wm[1])),
    wmLight: lerp(-0.2, 1.2, range(t, I.wm[0] + 0.02, I.wm[1] + 0.04)),
    seam: range(t, I.lock - 0.005, I.lock + 0.22),
    vDepth: ease.inOutCubic(range(approach, 0.0, 0.55)) * (1 - range(approach, 0.8, 1)),
    wmParallax: 0.12,
  };
}

// ================================================================== shot 2
const lockEase = bezier(0.3, 0, 0.12, 1);
function homeCam(t: number): Cam {
  // land, let the hero breathe, ease in
  let s = 1 + 0.05 * (1 - ease.settle(range(t, I.pass - 0.04, I.pass + 0.42)));
  s += 0.06 * ease.inOutCubic(range(t, I.land, HM.pushEnd));
  const k = lockEase(range(t, HM.lock[0], HM.lock[1]));
  s = lerp(s, 1.4, k);
  const cx = lerp(VW / 2, 12 + VW / 2 / 1.4, k);
  const cy = lerp(VH / 2, 425, k);
  s += 0.02 * (ease.outCubic(range(t, TAP.cta.press, TAP.cta.press + 0.05)) - ease.inOutCubic(range(t, TAP.cta.press + 0.05, REL + 0.1)));
  return clampCam({ cx, cy, s });
}

// ================================================================== the pill → emblem → V
const MORPH0 = REL + 0.08; // the button rebounds first
function emblemPlane(t: number, from: { x: number; y: number }): PlaneState {
  const u = range(t, REL + 0.04, PASS);
  const z0 = 0.72;
  const z = z0 * Math.pow(Z_END / z0, Math.pow(u, 3));
  const aim = ease.inOutCubic(range(t, MORPH0, MORPH0 + 0.3));
  return { px: lerp(from.x, C.x, aim), py: lerp(from.y + 70, C.y, aim), z, wall: "transparent", emblemOnly: true };
}

// ================================================================== shot 3: the quote flow camera
const B = TAP.build, G = TAP.gaming, R = TAP.res, F = TAP.fps, CO = TAP.colour, SE = TAP.send;
const QG = Q.gaming, QR = Q.res, QF = Q.fps, QC = Q.colour;
const QUOTE_KEYS: CamKey[] = [
  { t: REL, cx: 216, cy: 384, s: 1.0 },
  { t: PASS, cx: 204, cy: 380, s: 1.17, e: (x: number) => x * x },
  { t: B.press - 0.12, cx: 161, cy: 372, s: 1.42, e: bezier(0.22, 0.22, 0.2, 1) },
  { t: B.release + 0.06, cx: 158, cy: 370, s: 1.44, e: ease.outCubic },
  { t: Q.scroll1[0] + 0.26, cx: 196, cy: 384, s: 1.14, e: ease.inOutCubic },
  // arrive on Primary use; drift gently while Gaming takes focus
  { t: QG.focus + 0.04, cx: 160, cy: 296, s: 1.5, e: ease.settle },
  { t: G.press - 0.04, cx: 150, cy: 288, s: 1.56, e: ease.inOutCubic },
  { t: G.release + 0.1, cx: 146, cy: 284, s: 1.6, e: snap },
  { t: QR.fan - 0.04, cx: 146, cy: 286, s: 1.6 },
  // move to the next question
  { t: QR.fan + 0.2, cx: 190, cy: 470, s: 1.52, e: glide },
  { t: R.release + 0.16, cx: 206, cy: 474, s: 1.54, e: ease.outCubic },
  { t: QF.count - 0.02, cx: 210, cy: 476, s: 1.54 },
  { t: QF.count + 0.16, cx: 232, cy: 560, s: 1.5, e: glide },
  { t: F.press, cx: 236, cy: 566, s: 1.54, e: ease.outCubic },
  { t: F.release + 0.08, cx: 236, cy: 568, s: 1.48, e: ease.outCubic },
  { t: Q.scroll2[0] + 0.2, cx: 200, cy: 420, s: 1.18, e: ease.inOutCubic },
  { t: QC.contact - 0.06, cx: 160, cy: 300, s: 1.48, e: ease.settle },
  { t: CO.release + 0.3, cx: 164, cy: 298, s: 1.56, e: ease.outCubic },
  // pull back while the choices consolidate and the page travels to Send
  { t: Q.consolidate[1] - 0.05, cx: 216, cy: 400, s: 1.04, e: ease.inOutCubic },
  { t: Q.scroll3[1] + 0.05, cx: 216, cy: 384, s: 1.0, e: ease.settle },
  { t: 14.2, cx: 216, cy: 384, s: 1.0 },
];
export function quoteCam(t: number): Cam {
  const c = keyCam(QUOTE_KEYS, t);
  let push = 0;
  for (const tp of [B, G, R, F, CO, SE]) push += ease.outCubic(range(t, tp.press, tp.press + 0.05)) * (1 - ease.inOutCubic(range(t, tp.release, tp.release + 0.14)));
  return clampCam({ ...c, s: c.s * (1 + 0.014 * push) });
}
export const pageCam = (t: number) => (t < PASS ? homeCam(t) : quoteCam(t));

const scrollSpeed = (i: number) => (i < 1 || i === HOME_LAST + 1 ? 0 : JLOG[i].scrollY - JLOG[i - 1].scrollY);

/** A real element of the frame, cut out at its own rect, transformable about its centre. */
export const Cut: React.FC<{ index: number; cam: Cam; r: Rect; radius?: number; style?: React.CSSProperties; transform?: string; brightness?: number; filter?: string }> = ({ index, cam, r, radius, style, transform, brightness, filter }) => {
  const a = toScreen(r.x, r.y, cam);
  const b = toScreen(r.x + r.w, r.y + r.h, cam);
  const rad = radius ?? (b.y - a.y) / 2;
  return (
    <AbsoluteFill
      style={{
        clipPath: `inset(${a.y}px ${1080 - b.x}px ${1920 - b.y}px ${a.x}px round ${rad}px)`,
        transformOrigin: `${(a.x + b.x) / 2}px ${(a.y + b.y) / 2}px`,
        transform,
        filter,
        ...style,
      }}
    >
      <SiteFrame dir={DIR} index={index} cam={cam} brightness={brightness} />
    </AbsoluteFill>
  );
};

/** Take over one row of real pills: cover it with the page background, redraw each pill (a real crop) with its own motion. */
const RowTakeover: React.FC<{ index: number; cam: Cam; pills: Pill[]; fx: (p: Pill, i: number) => { dx: number; dy?: number; s: number; rot?: number; o: number } }> = ({ index, cam, pills, fx }) => {
  const x0 = Math.min(...pills.map((p) => p.x)) - 8, x1 = Math.max(...pills.map((p) => p.x + p.w)) + 8;
  const y0 = Math.min(...pills.map((p) => p.y)) - 6, y1 = Math.max(...pills.map((p) => p.y + p.h)) + 6;
  const a = toScreen(x0, y0, cam), b = toScreen(x1, y1, cam);
  return (
    <>
      <div style={{ position: "absolute", left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y, background: PAGE_BG }} />
      {pills.map((p, i) => {
        const f = fx(p, i);
        const px = K * cam.s;
        return (
          <Cut
            key={p.label + i}
            index={index}
            cam={cam}
            r={p}
            style={{ opacity: f.o }}
            transform={`translate(${f.dx * px}px, ${(f.dy ?? 0) * px}px) rotate(${f.rot ?? 0}deg) scale(${f.s})`}
          />
        );
      })}
    </>
  );
};

const row = (i: number, group: string, pick: string) => {
  const g = JLOG[i].meta.groups[group];
  if (!g) return null;
  const p = g.find((q) => q.label === pick);
  if (!p) return null;
  return { focus: p, row: g.filter((q) => Math.abs(q.y - p.y) < 4) };
};

export const Journey6: React.FC<{ t: number }> = ({ t }) => {
  const idx = jIndex(t);
  const onQuote = t >= PASS;
  const cam = pageCam(t);
  const homeIdx = Math.min(idx, HOME_LAST);

  const v = Math.abs(scrollSpeed(onQuote ? idx : homeIdx)) * K * cam.s;
  const vBlur = v > 26 ? Math.min(22, 0.12 * (v - 26)) : 0;
  const fog = t < I.pass ? 0.1 + 0.9 * clamp01((dollyZ(t) - 1.2) / 6) : 1;

  // ------------------------------------------------ homepage CTA
  const ctaRect = JLOG[homeIdx].meta.cta ?? { x: 16, y: 490, w: 400, h: 56 };
  const ctaFinal = JLOG[Math.min(HOME_LAST, Math.round((HM.contact - V.home.captureStart) * 60))].meta.cta!;
  const touchHome = { x: TAP.cta.x, y: TAP.cta.y };
  const pressCam = homeCam(REL);
  const touchHomeScreen = toScreen(touchHome.x, touchHome.y, pressCam);
  const hc = homeCam(t);
  const bA = toScreen(ctaRect.x, ctaRect.y, hc), bB = toScreen(ctaRect.x + ctaRect.w, ctaRect.y + ctaRect.h, hc);
  const focus = ease.inOutCubic(range(t, HM.focus[0], HM.focus[1])) * (1 - range(t, REL, REL + 0.1));
  const pressK = ease.outCubic(range(t, TAP.cta.press, TAP.cta.press + 0.05));
  // elastic: gives under the finger, rebounds past rest, settles
  const rebound = (() => {
    const u = range(t, REL, REL + 0.16);
    return u <= 0 ? 0 : Math.sin(u * Math.PI) * (1 - u) * 1.6;
  })();
  const ctaScale = (1 + 0.02 * focus) * (1 - 0.03 * pressK * (1 - range(t, REL, REL + 0.03))) * (1 + 0.025 * rebound);

  // ------------------------------------------------ morph
  const inMorph = t >= REL && t < PASS;
  const ep = emblemPlane(t, touchHomeScreen);
  const m = ease.inOutCubic(range(t, MORPH0, MORPH0 + 0.22));
  const pA = toScreen(ctaFinal.x, ctaFinal.y, pressCam);
  const pB = toScreen(ctaFinal.x + ctaFinal.w, ctaFinal.y + ctaFinal.h, pressCam);
  const pillPoly = pill(pA.x, pA.y, pB.x - pA.x, pB.y - pA.y);
  const embPoly = EMBLEM.map((q) => toScreenPlane(ep, q.x, q.y));
  const shape = lerpPoly(pillPoly, embPoly, m);
  const apex = toScreenPlane(ep, 2258, 1573 + 18);
  const hornL = toScreenPlane(ep, 795 - 14, 577 - 14);
  const hornR = toScreenPlane(ep, 3714 + 14, 577 - 14);
  const open = ease.outCubic(range(t, MORPH0 + 0.03, MORPH0 + 0.17)) * (1 + 40 * ease.inCubic(range(t, MORPH0 + 0.17, PASS)));
  const wedge = [apex, { x: apex.x + (hornL.x - apex.x) * open, y: apex.y + (hornL.y - apex.y) * open }, { x: apex.x + (hornR.x - apex.x) * open, y: apex.y + (hornR.y - apex.y) * open }];
  const col = (k: number) => `rgb(${Math.round(lerp(157, 190, k))},${Math.round(lerp(46, 48, k))},${Math.round(lerp(22, 29, k))})`;
  const art = range(t, MORPH0 + 0.12, MORPH0 + 0.24);
  const homeRecede = ease.outCubic(range(t, MORPH0, MORPH0 + 0.22));

  // ------------------------------------------------ the quote flow
  const qIdx = Math.max(HOME_LAST + 1, idx);
  const dim = onQuote ? 1 - 0.55 * ease.inOutCubic(range(t, Q.consolidate[0], Q.consolidate[0] + 0.4)) : 1;
  const recede = ease.inOutCubic(range(t, SE.release, SE.release + 0.45));
  const sendRect = JLOG[Math.min(qIdx, JLOG.length - 1)].meta.send;
  const sendSpot = range(t, Q.scroll3[1] - 0.1, Q.scroll3[1] + 0.12);

  // GAMING — the other choices step aside, Gaming slides into focus, tap, an underline travels
  const gRow = onQuote ? row(qIdx, "Primary use", "Gaming") : null;
  const gFocus = ease.inOutCubic(range(t, QG.focus, QG.contact)) * (1 - ease.inOutCubic(range(t, G.release + 0.25, G.release + 0.5)));
  // 1440p — the row fans out, 1440p pulls forward, the others settle back after the tap
  const rRow = onQuote ? row(qIdx, "Target resolution", "1440p") : null;
  const rFan = ease.outCubic(range(t, QR.fan, QR.contact)) * (1 - glide(range(t, R.release, R.release + 0.28)));
  const rFwd = ease.outCubic(range(t, QR.fan, QR.contact)) * (1 - glide(range(t, R.release + 0.06, R.release + 0.4)));
  // 144+ FPS — a quick count lands on the choice
  const fRow = onQuote ? row(qIdx, "Target FPS", "144+ FPS") : null;
  const count = range(t, QF.count, QF.contact);
  // White — the choice lights its surroundings a little
  const glowW = range(t, CO.release, CO.release + 0.7);

  const touches = [
    { tp: B, ap: 0.16, contact: CONTACTS[1] },
    { tp: G, ap: 0.14, contact: CONTACTS[2] },
    { tp: R, ap: 0.12, contact: CONTACTS[3] },
    { tp: F, ap: 0.1, contact: CONTACTS[4] },
    { tp: CO, ap: 0.14, contact: CONTACTS[5] },
    { tp: SE, ap: 0.17, contact: CONTACTS[6] },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <defs>
          <clipPath id="jwedge6">
            <path d={polyPath(wedge)} />
          </clipPath>
        </defs>
      </svg>

      {/* ------------------------------------------------ live homepage */}
      {t >= 1.2 && t < PASS && (
        <AbsoluteFill style={{ transformOrigin: `${touchHomeScreen.x}px ${touchHomeScreen.y}px`, transform: `scale(${(1 - 0.08 * homeRecede) * (1 + 0.012 * focus)})` }}>
          <SiteFrame dir={DIR} index={homeIdx} cam={hc} vBlur={vBlur} brightness={fog * (1 - 0.93 * homeRecede)} />
        </AbsoluteFill>
      )}
      {focus > 0.002 && t < PASS && (
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              left: bA.x - 30,
              top: bA.y - 30,
              width: bB.x - bA.x + 60,
              height: bB.y - bA.y + 60,
              borderRadius: (bB.y - bA.y) / 2 + 30,
              boxShadow: `0 0 0 3000px rgba(0,0,0,${0.48 * focus})`,
              filter: "blur(26px)",
            }}
          />
        </AbsoluteFill>
      )}
      {focus > 0.002 && t < MORPH0 && (
        // the button: a touch closer, a touch richer — the centre of attention
        <Cut index={homeIdx} cam={hc} r={ctaRect} transform={`scale(${ctaScale})`} filter={`saturate(${1 + 0.16 * focus})`} style={{ backgroundColor: PAGE_BG }} />
      )}

      {/* ------------------------------------------------ pill → emblem; the quote page behind its V */}
      {inMorph && t >= MORPH0 - 0.01 && (
        <>
          <AbsoluteFill style={{ clipPath: "url(#jwedge6)" }}>
            <SiteFrame dir={DIR} index={qIdx} cam={quoteCam(t)} brightness={0.55 + 0.45 * range(t, MORPH0 + 0.1, PASS)} />
          </AbsoluteFill>
          <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <path d={polyPath(shape)} fill={col(m)} opacity={1 - art} />
          </svg>
          <AbsoluteFill style={{ opacity: art }}>
            <EmblemPlane st={ep} />
          </AbsoluteFill>
          <AbsoluteFill style={{ opacity: 1 - range(t, MORPH0, MORPH0 + 0.06) }}>
            <Cut index={HOME_LAST} cam={pressCam} r={ctaFinal} transform={`scale(${1 + 0.4 * range(t, MORPH0, MORPH0 + 0.06)})`} />
          </AbsoluteFill>
        </>
      )}

      {/* ------------------------------------------------ the real quote flow */}
      {onQuote && (
        <AbsoluteFill style={{ transformOrigin: "540px 1000px", transform: `scale(${1 - 0.16 * recede}) translateY(${-40 * recede}px)`, filter: recede > 0.01 ? `blur(${6 * recede}px)` : undefined }}>
          <SiteFrame dir={DIR} index={qIdx} cam={cam} vBlur={vBlur} brightness={dim * (1 - 0.92 * recede)} />

          {/* GAMING */}
          {gRow && gFocus > 0.001 && (
            <RowTakeover
              index={qIdx}
              cam={cam}
              pills={gRow.row}
              fx={(p) => (p.label === "Gaming" ? { dx: 6 * gFocus, s: 1 + 0.09 * gFocus, o: 1 } : { dx: 22 * gFocus, s: 1 - 0.05 * gFocus, o: 1 - 0.5 * gFocus })}
            />
          )}
          {t >= G.release && t < G.release + 0.62 && gRow && (() => {
            const r = gRow.focus;
            const k = glide(range(t, G.release, G.release + 0.24));
            const out = range(t, G.release + 0.4, G.release + 0.6);
            const a = toScreen(r.x + 10, r.y + r.h + 7, cam), b = toScreen(r.x + 10 + (r.w - 20) * k, r.y + r.h + 7, cam);
            return <div style={{ position: "absolute", left: a.x, top: a.y, width: b.x - a.x, height: 7, borderRadius: 4, background: BRAND.yellow, opacity: 1 - out }} />;
          })()}

          {/* 1440p */}
          {rRow && (rFan > 0.001 || rFwd > 0.001) && (
            <RowTakeover
              index={qIdx}
              cam={cam}
              pills={rRow.row}
              fx={(p) => {
                if (p.label === "1440p") return { dx: 0, dy: -3 * rFwd, s: 1 + 0.12 * rFwd, o: 1 };
                const side = p.x < rRow.focus.x ? -1 : 1;
                const order = Math.abs(rRow.row.indexOf(p) - rRow.row.indexOf(rRow.focus));
                return { dx: side * (8 + 6 * order) * rFan, dy: 4 * order * rFan, rot: side * 5 * order * rFan, s: 1 - 0.07 * rFan, o: 1 - 0.45 * rFan };
              }}
            />
          )}

          {/* 144+ FPS: a quick count, then the tap and a tick */}
          {fRow && count > 0 && t < F.release + 0.5 && (() => {
            const steps = ["60", "120", "144+"];
            const i = Math.min(2, Math.floor(count * 3));
            const f = fRow.focus;
            const hop = fRow.row.filter((p) => /FPS/.test(p.label)).slice(0, 3);
            const target = hop[i] ?? f;
            const a = toScreen(target.x - 4, target.y - 4, cam), b = toScreen(target.x + target.w + 4, target.y + target.h + 4, cam);
            const out = range(t, F.release + 0.15, F.release + 0.45);
            const anchor = toScreen(f.x + f.w / 2, f.y - 30, cam);
            const roll = (count * 3) % 1;
            return (
              <>
                {count < 1 && <div style={{ position: "absolute", left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y, borderRadius: 400, border: `5px solid ${BRAND.yellow}`, opacity: 0.85 }} />}
                <div style={{ position: "absolute", left: anchor.x - 170, width: 340, top: anchor.y - 160, height: 150, borderRadius: 28, background: "rgba(10,10,11,0.94)", border: "2px solid rgba(249,194,4,0.35)", opacity: 1 - out, transform: `scale(${snap(range(t, QF.count, QF.count + 0.14))})` }} />
                <div style={{ position: "absolute", left: anchor.x - 200, width: 400, top: anchor.y - 150, height: 130, overflow: "hidden", textAlign: "center", fontFamily: FONT.display, fontWeight: 700, fontSize: 112, color: BRAND.yellow, opacity: 1 - out, textShadow: "0 6px 30px rgba(0,0,0,0.8)" }}>
                  <div style={{ transform: `translateY(${i < 2 ? -roll * 18 : -6 * (1 - snap(range(t, QF.count + 0.24, QF.count + 0.4)))}px)` }}>{steps[i]}</div>
                </div>
              </>
            );
          })()}
          {t >= F.release && t < F.release + 0.6 && fRow && (() => {
            const r = fRow.focus;
            const p = toScreen(r.x + r.w - 4, r.y + 2, cam);
            const k = snap(range(t, F.release, F.release + 0.2));
            const out = range(t, F.release + 0.4, F.release + 0.56);
            return (
              <svg width={84} height={84} viewBox="0 0 64 64" style={{ position: "absolute", left: p.x - 42, top: p.y - 42, transform: `scale(${k})`, opacity: 1 - out }}>
                <circle cx={32} cy={32} r={28} fill={BRAND.yellow} />
                <path d="M19 33 l9 9 l17 -19" fill="none" stroke="#000" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - range(t, F.release + 0.04, F.release + 0.16))} />
              </svg>
            );
          })()}

          {/* White: the choice lights its surroundings, softly */}
          {glowW > 0 && glowW < 1 && JLOG[qIdx].meta.colour && (() => {
            const r = JLOG[qIdx].meta.colour!;
            const a = toScreen(r.x, r.y, cam), b = toScreen(r.x + r.w, r.y + r.h, cam);
            const g = Math.sin(Math.PI * glowW);
            return (
              <>
                <div style={{ position: "absolute", left: a.x - 4, top: a.y - 4, width: b.x - a.x + 8, height: b.y - a.y + 8, borderRadius: 200, boxShadow: `0 0 ${40 + 70 * glowW}px ${14 + 30 * glowW}px rgba(255,255,255,${0.32 * g}), 0 0 0 ${3 + 10 * glowW}px rgba(249,194,4,${0.5 * (1 - glowW)})` }} />
                <AbsoluteFill style={{ boxShadow: `inset 0 0 220px 40px rgba(235,240,255,${0.1 * g})` }} />
              </>
            );
          })()}

          {sendRect && sendSpot > 0 && (
            <Cut index={qIdx} cam={cam} r={sendRect} transform={`scale(${1 - 0.025 * ease.outCubic(range(t, SE.press, SE.press + 0.05))})`} brightness={1 - 0.92 * recede} style={{ opacity: sendSpot, backgroundColor: PAGE_BG }} />
          )}
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ the opening surface */}
      {t < I.pass && <EmblemPlane st={openingPlane(t)} />}

      {/* ------------------------------------------------ touches */}
      {(() => {
        // homepage: approach, hover above it (a breath), then contact
        const p = toScreen(touchHome.x, touchHome.y, hc);
        const hover = range(t, HM.touchIn, HM.hover) * (1 - ease.inCubic(range(t, HM.contact - 0.12, HM.contact)));
        const bob = Math.sin((t - HM.hover) * 9) * 4 * range(t, HM.hover, HM.hover + 0.1);
        return <Touch t={t} x={p.x + 10 * hover} y={p.y - 46 * hover + bob * hover} tt={{ approach: HM.touchIn, contact: HM.contact, press: TAP.cta.press, release: REL }} size={92} />;
      })()}
      {onQuote &&
        touches.map(({ tp, ap, contact }, i) => {
          const p = toScreen(tp.x, tp.y, cam);
          return <Touch key={i} t={t} x={p.x} y={p.y} tt={{ approach: contact - ap, contact, press: tp.press, release: tp.release }} />;
        })}
    </AbsoluteFill>
  );
};

export const journeySamples6 = (t: number) => {
  if (t >= I.leftIn && t < I.lock + 0.02) return 4;
  if (t >= I.pass - 0.42 && t < I.pass + 0.04) return 14;
  if (t >= MORPH0 + 0.12 && t < PASS + 0.04) return 14;
  if (t >= REL && t < MORPH0 + 0.12) return 6;
  if (t >= PASS && t < SE.release) {
    const a = quoteCam(t - 1 / 120), b = quoteCam(t + 1 / 120);
    const px = Math.hypot((b.cx - a.cx) * K * b.s, (b.cy - a.cy) * K * b.s) + Math.abs(b.s - a.s) * 900;
    if (px > 40) return 10;
    if (px > 18) return 6;
  }
  return 1;
};
