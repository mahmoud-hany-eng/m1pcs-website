import React from "react";
import { AbsoluteFill } from "remotion";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { C, Cam, K, SiteFrame, VH, VW, clampCam, toScreen } from "../lib/SiteFrame";
import { EmblemPlane, PlaneState, S, TARGET, toScreenPlane } from "../v5/EmblemPlane";
import { EMBLEM, lerpPoly, pill, polyPath } from "./morph";
import { BRAND, CONTACTS, CamKey, HOME_LAST, JLOG, TAP, glide, jIndex, keyCam, snap } from "./shared";
import { Touch } from "./Touch";
import { FONT } from "./fonts";
import T from "../../timeline.json";

/**
 * Shots 1–4 on ONE continuous live capture of the real site:
 *  1. the real emblem assembles; the camera dollies through its V into the
 *     live homepage (approved v5 move)
 *  2. real scroll settles, camera locks on "Build Your PC", touch, press
 *  3. the pressed pill deforms into the M1 emblem silhouette; its V notch
 *     opens early onto the real quote page; the camera flies through
 *  4. the real Build My PC flow: "Build a Complete PC", Gaming, 1440p,
 *     144+ FPS, White — each tap with its own camera/micro-motion — then the
 *     page flicks down to the real "Send Request via WhatsApp"
 */

const L5 = T.v5.logo;
const HV = T.v5.home;
const DIR = "journey";
const CTA = { x: 16, y: 490.4, w: 400, h: 56 };
const TOUCH_HOME = { x: 304, y: 519.1 };
const REL = TAP.cta.release; // 2.217
const PASS = HV.pass; // 2.66

// ------------------------------------------------------------------ shot 1 (v5)
const Z_END = 40;
function dollyZ(t: number) {
  const u = range(t, 0, L5.passEnd);
  const c = (1 - 1 / Z_END) * Math.pow(u, 2.2);
  return 1 / (1 - c);
}
const LOGO_REST = { x: 540 + (TARGET.x - 2250) * S, y: 930 + (TARGET.y - 2815) * S };
function openingPlane(t: number): PlaneState {
  const aim = ease.inOutCubic(range(t, 0.45, 0.98));
  return {
    px: lerp(LOGO_REST.x, C.x, aim),
    py: lerp(LOGO_REST.y, C.y, aim),
    z: dollyZ(t),
    wall: "#000",
    halves: range(t, 0.02, L5.lock),
    wm1: ease.settle(range(t, L5.wordmark[0], L5.wordmark[0] + 0.24)),
    wm2: ease.settle(range(t, L5.wordmark[0] + 0.07, L5.wordmark[1])),
    seam: range(t, L5.lock - 0.01, L5.lock + 0.2),
  };
}

// ------------------------------------------------------------------ shot 2 (v5)
const lockEase = bezier(0.3, 0, 0.12, 1);
function homeCam(t: number): Cam {
  let s = 1 + 0.06 * (1 - ease.settle(range(t, L5.passEnd - 0.04, L5.passEnd + 0.42)));
  const k = lockEase(range(t, HV.lockStart, HV.lockEnd));
  s += 0.36 * k;
  const cx = lerp(VW / 2, 12 + VW / 2 / 1.36, k);
  const cy = lerp(VH / 2, 425, k);
  s += 0.018 * (ease.outCubic(range(t, TAP.cta.press, TAP.cta.press + 0.05)) - ease.inOutCubic(range(t, TAP.cta.press + 0.05, REL + 0.05)));
  return clampCam({ cx, cy, s });
}

// ------------------------------------------------------------------ shot 3: pill -> emblem -> V
const MORPH = 0.2; // seconds for the outline to become the emblem
function emblemPlane(t: number, from: { x: number; y: number }): PlaneState {
  const u = range(t, REL, PASS);
  const z0 = 0.75;
  const z = z0 * Math.pow(Z_END / z0, Math.pow(u, 3));
  const aim = ease.inOutCubic(range(t, REL + 0.02, REL + 0.3));
  return { px: lerp(from.x, C.x, aim), py: lerp(from.y + 70, C.y, aim), z, wall: "transparent", emblemOnly: true };
}

// ------------------------------------------------------------------ shot 4: the quote flow camera
const B = TAP.build, G = TAP.gaming, R = TAP.res, F = TAP.fps, CO = TAP.colour, SE = TAP.send;
// one continuous forward push: it starts while the emblem is still passing
// (the page behind it grows), keeps its speed through the V, then decelerates
// onto the first control — velocity-matched at the pass (no snap)
const QUOTE_KEYS: CamKey[] = [
  { t: REL, cx: 216, cy: 384, s: 1.0 },
  { t: PASS, cx: 204, cy: 380, s: 1.17, e: (x: number) => x * x },
  { t: B.press - 0.12, cx: 161, cy: 372, s: 1.42, e: bezier(0.22, 0.22, 0.2, 1) },
  { t: B.release + 0.04, cx: 158, cy: 370, s: 1.44, e: ease.outCubic },
  { t: 3.42, cx: 196, cy: 384, s: 1.14, e: ease.inOutCubic },
  { t: G.press - 0.04, cx: 156, cy: 300, s: 1.5, e: ease.settle },
  // magnetic snap toward Gaming as it is chosen
  { t: G.release + 0.06, cx: 140, cy: 282, s: 1.58, e: snap },
  // glide down the form to the resolution row, then slide along it
  { t: R.press - 0.04, cx: 176, cy: 468, s: 1.5, e: glide },
  { t: R.release + 0.1, cx: 214, cy: 476, s: 1.5, e: ease.outCubic },
  { t: F.press - 0.02, cx: 236, cy: 566, s: 1.52, e: glide },
  // compression: a small pull-back as 144+ confirms
  { t: F.release + 0.06, cx: 236, cy: 568, s: 1.46, e: ease.outCubic },
  { t: 4.66, cx: 200, cy: 420, s: 1.18, e: ease.inOutCubic },
  { t: CO.press - 0.06, cx: 160, cy: 300, s: 1.48, e: ease.settle },
  { t: CO.release + 0.08, cx: 164, cy: 298, s: 1.54, e: ease.outCubic },
  // the page flicks down to the submit button under the request card
  { t: 5.7, cx: 216, cy: 400, s: 1.04, e: ease.inOutCubic },
  { t: 6.12, cx: 216, cy: 384, s: 1.0, e: ease.settle },
  { t: 7.2, cx: 216, cy: 384, s: 1.0 },
];
export function quoteCam(t: number): Cam {
  const c = keyCam(QUOTE_KEYS, t);
  // presses: a hair of push-in under the finger
  let push = 0;
  for (const tp of [B, G, R, F, CO, SE]) push += ease.outCubic(range(t, tp.press, tp.press + 0.05)) * (1 - ease.inOutCubic(range(t, tp.release, tp.release + 0.12)));
  return clampCam({ ...c, s: c.s * (1 + 0.015 * push) });
}

export const pageCam = (t: number) => (t < PASS ? homeCam(t) : quoteCam(t));

const scrollSpeed = (i: number) => (i < 1 || i === HOME_LAST + 1 ? 0 : JLOG[i].scrollY - JLOG[i - 1].scrollY);

/** A real element of the frame, cut out at its own rect, transformable about its centre. */
export const Cut: React.FC<{ index: number; cam: Cam; r: { x: number; y: number; w: number; h: number }; radius?: number; style?: React.CSSProperties; scale?: number; brightness?: number }> = ({ index, cam, r, radius, style, scale = 1, brightness }) => {
  const a = toScreen(r.x, r.y, cam);
  const b = toScreen(r.x + r.w, r.y + r.h, cam);
  const rad = radius ?? (b.y - a.y) / 2;
  return (
    <AbsoluteFill
      style={{
        clipPath: `inset(${a.y}px ${1080 - b.x}px ${1920 - b.y}px ${a.x}px round ${rad}px)`,
        transformOrigin: `${(a.x + b.x) / 2}px ${(a.y + b.y) / 2}px`,
        transform: `scale(${scale})`,
        ...style,
      }}
    >
      <SiteFrame dir={DIR} index={index} cam={cam} brightness={brightness} />
    </AbsoluteFill>
  );
};

const rectAt = (i: number, key: string) => JLOG[i].meta[key] as { x: number; y: number; w: number; h: number };

export const Journey: React.FC<{ t: number }> = ({ t }) => {
  const idx = jIndex(t);
  const onQuote = t >= PASS;
  const cam = pageCam(t);
  const homeIdx = Math.min(idx, HOME_LAST);

  // scroll blur — only on genuinely fast frames, gone the moment the page slows
  const v = Math.abs(scrollSpeed(onQuote ? idx : homeIdx)) * K * cam.s; // screen px / frame
  const vBlur = v > 26 ? Math.min(22, 0.12 * (v - 26)) : 0;

  const fog = t < L5.passEnd ? 0.12 + 0.88 * clamp01((dollyZ(t) - 1.2) / 6) : 1;

  // -------------------------------------------------------------- homepage CTA (shot 2)
  const pressCam = homeCam(REL);
  const touchHome = toScreen(TOUCH_HOME.x, TOUCH_HOME.y, pressCam);
  const bA = toScreen(CTA.x, CTA.y, homeCam(t));
  const bB = toScreen(CTA.x + CTA.w, CTA.y + CTA.h, homeCam(t));
  const focus = 0.42 * ease.inOutCubic(range(t, HV.lockStart + 0.1, HV.lockEnd)) * (1 - range(t, REL, REL + 0.1));
  const pressK = ease.outCubic(range(t, TAP.cta.press, TAP.cta.press + 0.05));

  // -------------------------------------------------------------- the morph (shot 3)
  const inMorph = t >= REL && t < PASS;
  const ep = emblemPlane(t, touchHome);
  const m = ease.inOutCubic(range(t, REL, REL + MORPH));
  const pA = toScreen(CTA.x, CTA.y, pressCam);
  const pB = toScreen(CTA.x + CTA.w, CTA.y + CTA.h, pressCam);
  const pillPoly = pill(pA.x, pA.y, pB.x - pA.x, pB.y - pA.y);
  const embPoly = EMBLEM.map((q) => toScreenPlane(ep, q.x, q.y));
  const shape = lerpPoly(pillPoly, embPoly, m);
  // the V notch: a wedge from the apex, opening early and widening past the horns
  const apex = toScreenPlane(ep, 2258, 1573 + 18);
  const hornL = toScreenPlane(ep, 795 - 14, 577 - 14);
  const hornR = toScreenPlane(ep, 3714 + 14, 577 - 14);
  const open = ease.outCubic(range(t, REL + 0.03, REL + 0.17)) * (1 + 40 * ease.inCubic(range(t, REL + 0.17, PASS)));
  const wedge = [apex, { x: apex.x + (hornL.x - apex.x) * open, y: apex.y + (hornL.y - apex.y) * open }, { x: apex.x + (hornR.x - apex.x) * open, y: apex.y + (hornR.y - apex.y) * open }];
  const col = (k: number) => `rgb(${Math.round(lerp(157, 190, k))},${Math.round(lerp(46, 48, k))},${Math.round(lerp(22, 29, k))})`;
  const art = range(t, REL + 0.12, REL + 0.24);
  const homeRecede = ease.outCubic(range(t, REL, REL + 0.22));

  // -------------------------------------------------------------- quote flow (shot 4)
  const quoteCamNow = cam;
  const qIdx = Math.max(HOME_LAST + 1, idx);
  const copyDim = 0.78 * ease.inOutCubic(range(t, B.release - 0.02, B.release + 0.1)) * (1 - ease.inOutCubic(range(t, 3.5, 3.68)));
  const dim = onQuote ? (1 - 0.5 * ease.inOutCubic(range(t, 5.22, 5.6))) * (1 - copyDim) : 1;
  const recede = ease.inOutCubic(range(t, SE.release, SE.release + 0.42)); // page falls away as WhatsApp opens
  const sendRect = rectAt(Math.min(qIdx, 358), "send");
  const sendSpot = range(t, 5.95, 6.15);

  // micro-motions on the chosen options (crops of the real, selected pill)
  const popG = ease.outCubic(range(t, G.release, G.release + 0.08)) * (1 - ease.settle(range(t, G.release + 0.08, G.release + 0.4)));
  const pressF = ease.outCubic(range(t, F.press, F.press + 0.05)) * (1 - snap(range(t, F.release, F.release + 0.25)));
  const glowW = range(t, CO.release, CO.release + 0.5);

  // copy: YOUR PC. / YOUR WAY. rides the flick between the first two taps
  const c1 = ease.settle(range(t, B.release + 0.02, B.release + 0.3));
  const c2 = ease.settle(range(t, B.release + 0.1, B.release + 0.38));
  const cOut = ease.inCubic(range(t, 3.46, 3.62));

  const touches = [
    { tp: B, ap: 0.16, contact: CONTACTS[1] },
    { tp: G, ap: 0.14, contact: CONTACTS[2] },
    { tp: R, ap: 0.12, contact: CONTACTS[3] },
    { tp: F, ap: 0.1, contact: CONTACTS[4] },
    { tp: CO, ap: 0.12, contact: CONTACTS[5] },
    { tp: SE, ap: 0.16, contact: CONTACTS[6] },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <defs>
          <clipPath id="jwedge">
            <path d={polyPath(wedge)} />
          </clipPath>
        </defs>
      </svg>

      {/* ------------------------------------------------ live homepage */}
      {t >= 0.3 && t < PASS && (
        <AbsoluteFill style={{ transformOrigin: `${touchHome.x}px ${touchHome.y}px`, transform: `scale(${1 - 0.08 * homeRecede})` }}>
          <SiteFrame dir={DIR} index={homeIdx} cam={homeCam(t)} vBlur={vBlur} brightness={fog * (1 - 0.93 * homeRecede)} />
        </AbsoluteFill>
      )}
      {focus > 0.002 && t < PASS && (
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              left: bA.x - 26,
              top: bA.y - 26,
              width: bB.x - bA.x + 52,
              height: bB.y - bA.y + 52,
              borderRadius: (bB.y - bA.y) / 2 + 26,
              boxShadow: `0 0 0 3000px rgba(0,0,0,${focus})`,
              filter: "blur(22px)",
            }}
          />
        </AbsoluteFill>
      )}
      {pressK > 0.001 && t < REL && (
        <Cut index={homeIdx} cam={homeCam(t)} r={CTA} scale={1 - 0.025 * pressK} style={{ backgroundColor: "#0a0a0b" }} />
      )}

      {/* ------------------------------------------------ the pill becoming the emblem; the quote page behind its V */}
      {inMorph && (
        <>
          <AbsoluteFill style={{ clipPath: "url(#jwedge)" }}>
            <SiteFrame dir={DIR} index={qIdx} cam={quoteCam(t)} brightness={0.55 + 0.45 * range(t, REL + 0.1, PASS)} />
          </AbsoluteFill>
          <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <path d={polyPath(shape)} fill={col(m)} opacity={1 - art} />
          </svg>
          <AbsoluteFill style={{ opacity: art }}>
            <EmblemPlane st={ep} />
          </AbsoluteFill>
          {/* the real label rides the surface for its first instant */}
          <AbsoluteFill style={{ opacity: 1 - range(t, REL, REL + 0.06) }}>
            <Cut index={HOME_LAST} cam={pressCam} r={CTA} scale={1 + 0.4 * range(t, REL, REL + 0.06)} />
          </AbsoluteFill>
        </>
      )}

      {/* ------------------------------------------------ the real quote flow */}
      {onQuote && (
        <AbsoluteFill
          style={{
            transformOrigin: "540px 1000px",
            transform: `scale(${1 - 0.16 * recede}) translateY(${-40 * recede}px)`,
            filter: recede > 0.01 ? `blur(${6 * recede}px)` : undefined,
          }}
        >
          <SiteFrame dir={DIR} index={qIdx} cam={quoteCamNow} vBlur={vBlur} brightness={dim * (1 - 0.9 * recede)} />

          {/* Gaming: magnetic pop of the real selected pill */}
          {popG > 0.001 && <Cut index={qIdx} cam={quoteCamNow} r={rectAt(qIdx, "gaming")} scale={1 + 0.08 * popG} />}
          {/* 1440p: an underline travels along the row to the chosen value */}
          {t >= R.release - 0.02 && t < 4.5 && (() => {
            const k = glide(range(t, R.release - 0.02, R.release + 0.22));
            const out = range(t, 4.3, 4.45);
            const r0 = { x: 16, w: 75 }; // 1080p, start of the row
            const r1 = rectAt(qIdx, "res");
            const x0 = lerp(r0.x, r1.x + 10, k), x1 = lerp(r0.x + r0.w * 0.3, r1.x + r1.w - 10, k);
            const a = toScreen(x0, r1.y + r1.h + 6, quoteCamNow);
            const b = toScreen(x1, r1.y + r1.h + 6, quoteCamNow);
            return <div style={{ position: "absolute", left: a.x, top: a.y, width: b.x - a.x, height: 7, borderRadius: 4, background: BRAND.yellow, opacity: 1 - out }} />;
          })()}
          {/* 144+ FPS: compression under the finger, then a confirmation tick */}
          {pressF > 0.001 && <Cut index={qIdx} cam={quoteCamNow} r={rectAt(qIdx, "fps")} scale={1 - 0.06 * pressF} style={{ backgroundColor: "#0a0a0b" }} />}
          {t >= F.release && t < 4.7 && (() => {
            const r = rectAt(qIdx, "fps");
            const p = toScreen(r.x + r.w - 4, r.y + 2, quoteCamNow);
            const k = snap(range(t, F.release, F.release + 0.2));
            const out = range(t, 4.48, 4.62);
            return (
              <svg width={84} height={84} viewBox="0 0 64 64" style={{ position: "absolute", left: p.x - 42, top: p.y - 42, transform: `scale(${k})`, opacity: 1 - out }}>
                <circle cx={32} cy={32} r={28} fill={BRAND.yellow} />
                <path d="M19 33 l9 9 l17 -19" fill="none" stroke="#000" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - range(t, F.release + 0.04, F.release + 0.16))} />
              </svg>
            );
          })()}
          {/* White: a soft warm glow answers the tap */}
          {glowW > 0 && glowW < 1 && (() => {
            const r = rectAt(qIdx, "colour");
            const a = toScreen(r.x, r.y, quoteCamNow), b = toScreen(r.x + r.w, r.y + r.h, quoteCamNow);
            const g = Math.sin(Math.PI * glowW);
            return (
              <div
                style={{
                  position: "absolute",
                  left: a.x - 4,
                  top: a.y - 4,
                  width: b.x - a.x + 8,
                  height: b.y - a.y + 8,
                  borderRadius: 200,
                  boxShadow: `0 0 ${30 + 50 * glowW}px ${10 + 22 * glowW}px rgba(249,194,4,${0.38 * g}), 0 0 0 ${3 + 10 * glowW}px rgba(249,194,4,${0.5 * (1 - glowW)})`,
                }}
              />
            );
          })()}
          {/* the submit button stays bright while the rest of the page recedes under the request */}
          {sendSpot > 0 && (
            <Cut
              index={qIdx}
              cam={quoteCamNow}
              r={sendRect}
              scale={1 - 0.025 * ease.outCubic(range(t, SE.press, SE.press + 0.05))}
              brightness={1 - 0.9 * recede}
              style={{ opacity: sendSpot, backgroundColor: "#0a0a0b" }}
            />
          )}
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ copy */}
      {t >= B.release && t < 3.64 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 84, top: 780, fontFamily: FONT.display, fontWeight: 700, fontSize: 132, lineHeight: 0.98, letterSpacing: -3, color: BRAND.white, textShadow: "0 6px 40px rgba(0,0,0,0.7)", opacity: 1 - cOut, transform: `translateY(${-60 * cOut}px)` }}>
            <div style={{ overflow: "hidden", paddingBottom: 6 }}>
              <div style={{ transform: `translateY(${(1 - c1) * 110}%)` }}>YOUR PC.</div>
            </div>
            <div style={{ overflow: "hidden", paddingBottom: 6 }}>
              <div style={{ transform: `translateY(${(1 - c2) * 110}%)`, color: BRAND.yellow }}>YOUR WAY.</div>
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ the opening surface */}
      {t < L5.passEnd && <EmblemPlane st={openingPlane(t)} />}

      {/* ------------------------------------------------ touches */}
      <Touch t={t} x={toScreen(TOUCH_HOME.x, TOUCH_HOME.y, homeCam(t)).x} y={toScreen(TOUCH_HOME.x, TOUCH_HOME.y, homeCam(t)).y} tt={{ approach: HV.touchIn, contact: HV.contact, press: TAP.cta.press, release: REL }} size={92} />
      {onQuote &&
        touches.map(({ tp, ap, contact }, i) => {
          const p = toScreen(tp.x, tp.y, quoteCamNow);
          return <Touch key={i} t={t} x={p.x} y={p.y} tt={{ approach: contact - ap, contact, press: tp.press, release: tp.release }} />;
        })}
    </AbsoluteFill>
  );
};

/** Sub-frame samples only where the camera itself moves fast. */
export const journeySamples = (t: number) => {
  if (t >= 0.04 && t < L5.lock + 0.02) return 8;
  if (t >= 0.86 && t < L5.passEnd + 0.06) return 14;
  if (t >= REL + 0.16 && t < PASS + 0.04) return 14;
  if (t >= REL && t < REL + 0.16) return 6;
  return 1;
};
