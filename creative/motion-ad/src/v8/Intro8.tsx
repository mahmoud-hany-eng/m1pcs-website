import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range, bezier } from "../lib/ease";
import { BRAND } from "../final/shared";
import { EMB, LEFT, RIGHT, LOGO_SRC, P, V_TRI, lerpP, pathOf, resample, N } from "../v7/geom";
import { Camera, MON, project, v3 } from "../v7/world";
import { V } from "./time";
import { FONT } from "../final/fonts";
import { Line, arrive as glideIn } from "./Kinetic";
import { ClashSpark, EmblemHalves, halfPose, impulse, settledAt } from "./Merge";

/**
 * Opening (v12) — the hook, then the brand.
 * "Your next PC shouldn't start with a preset. It should start with you." — YOUR NEXT PC / SHOULDN'T START /
 * WITH A PRESET. land on the spoken words (PRESET. a brief red emphasis), then IT SHOULD START / WITH / YOU.
 * YOU. (big, M1 yellow) is the trigger: it compresses into a yellow ember and two red traces that fly into the
 * two halves of the REAL M1 emblem, which strike together on one 0.82 s curve — a sword-clash spark on the
 * contact frame; M1 GAMING PCS + DOHA • QATAR readable; then the emblem unfolds into the bezel of a monitor.
 *
 * (v7 notes follow)
 * BLACK. A thin red line draws in; a second answers from the other side; they
 * meet with a tiny yellow spark at the V's apex. The emblem resolves around
 * them, the yellow wordmark lights up — a beat to recognise it. Pressure: it
 * tightens. Then the two halves of the emblem unfold outward with controlled
 * force and stretch into the two halves of a monitor's bezel, in perspective;
 * echoes trail them; the wordmark breaks into yellow light that settles as
 * the monitor's small power light. The monitor materialises around its red
 * edges and the screen powers on (the site appears inside — next shot).
 */

const I = V.intro;
const LOGO_W = 600;
const s = LOGO_W / LOGO_SRC.w;
const LOGO = { left: 540 - LOGO_W / 2, top: 830 - (LOGO_SRC.h * s) / 2 };
const L2 = (p: P): P => ({ x: LOGO.left + p.x * s, y: LOGO.top + p.y * s });

/** clockwise band (half a bezel) in screen space, from the camera that receives it */
function bands(cam: Camera, thick: number) {
  const { w, h } = MON.screen;
  const c = MON.center;
  const b = MON.bezel;
  const o = (x: number, y: number) => project(cam, v3(x, y, 0));
  const xo0 = c.x - w / 2 - b, xo1 = c.x + w / 2 + b, yo0 = c.y - h / 2 - b, yo1 = c.y + h / 2 + b;
  const xi0 = c.x - w / 2 - b + thick, xi1 = c.x + w / 2 + b - thick, yi0 = c.y - h / 2 - b + thick, yi1 = c.y + h / 2 + b - thick;
  const left = [o(xo0, yo0), o(c.x, yo0), o(c.x, yi0), o(xi0, yi0), o(xi0, yi1), o(c.x, yi1), o(c.x, yo1), o(xo0, yo1)];
  const right = [o(c.x, yo0), o(xo1, yo0), o(xo1, yo1), o(c.x, yo1), o(c.x, yi1), o(xi1, yi1), o(xi1, yi0), o(c.x, yi0)];
  return { left: resample(left, N), right: resample(right, N) };
}
// explosive but controlled: a hard launch, a long settle (no overshoot)
const unfoldEase = bezier(0.12, 0.9, 0.22, 1);
export const INTRO_D0 = 72; // px each half starts from its place (one smooth 0.8 s strike)
const CONTACT_PT = { x: 2258, y: 2080 }; // where the halves first touch (source px, on the seam)

export const Intro8: React.FC<{ t: number; cam: Camera }> = ({ t, cam }) => {
  if (t > I.materialize[1] + 0.2) return null;
  const la = L2(V_TRI.l), ra = L2(V_TRI.r);
  const hit = L2(CONTACT_PT);
  // the two halves: appear apart, float, close slowly, contact, settle
  const pose = halfPose(t, I.halvesIn[0], I.merge[0], I.contact, INTRO_D0);
  const halvesK = ease.swift(range(t, I.halvesIn[0], I.halvesIn[1]));
  const art = halvesK * (1 - range(t, I.expand[0] - 0.05, I.expand[0] + 0.02));
  const wm = ease.inOutCubic(range(t, I.wm[0], I.wm[1]));
  const press = ease.inOutCubic(range(t, I.pressure[0], I.pressure[1]));
  const tremor = 0;
  const scale = 1 - 0.04 * press;
  const glow = 0.25 + 0.75 * press;
  const jolt = impulse(t, I.contact); // 1–2 frame camera impulse on the contact frame

  // the unfold
  const k = unfoldEase(range(t, I.expand[0], I.expand[1] - 0.1));
  const thick = lerp(MON.bezel * 3.2, MON.bezel, ease.inOutCubic(range(t, I.expand[1] - 0.3, I.expand[1])));
  const B = bands(cam, thick);
  const sc = (p: P): P => ({ x: 540 + (p.x - 540) * scale + tremor, y: 830 + (p.y - 830) * scale });
  const embL = LEFT.map((p) => sc(L2(p))), embR = RIGHT.map((p) => sc(L2(p)));
  const shapeL = lerpP(embL, B.left, k), shapeR = lerpP(embR, B.right, k);
  const echo = (d: number) => [lerpP(embL, B.left, unfoldEase(range(t, I.expand[0] + d, I.expand[1] - 0.1 + d))), lerpP(embR, B.right, unfoldEase(range(t, I.expand[0] + d, I.expand[1] - 0.1 + d)))];
  const unfolding = t >= I.expand[0] - 0.05;
  const bandsOut = range(t, I.materialize[0] + 0.15, I.materialize[1]); // the body takes over; the red stays as the edge light

  // wordmark → yellow light → the power LED
  const led = project(cam, v3(MON.center.x, MON.center.y + MON.screen.h / 2 + MON.bezel / 2, -0.6));
  const cornerL = project(cam, v3(MON.center.x - MON.screen.w / 2 - MON.bezel, MON.center.y + MON.screen.h / 2 + MON.bezel, -0.6));
  const cornerR = project(cam, v3(MON.center.x + MON.screen.w / 2 + MON.bezel, MON.center.y + MON.screen.h / 2 + MON.bezel, -0.6));
  const dashK = ease.inOutCubic(range(t, I.expand[0] + 0.02, I.expand[1] - 0.05));
  const wmY = [LOGO.top + 3900 * s, LOGO.top + 4860 * s];

  const emblemPath = pathOf(EMB.map((p) => sc(L2(p))));

  // ---------------------------------------------------------------- the hook
  // YOUR NEXT PC / SHOULDN'T START / WITH A PRESET.  →  IT SHOULD START / WITH / YOU.
  // Each line lands on its spoken word; YOU. (big, M1 yellow) is the trigger: it compresses into light that
  // flies into the two halves of the emblem.
  const W = I.words;
  const qatarHi = 0;
  const drift = lerp(-1, 1, ease.inOutCubic(range(t, W.your, I.collapse[0])));
  const pushA = ease.inOutCubic(range(t, W.your, W.it)); // phase A: a slow push in
  const sq = ease.inCubic(range(t, I.collapse[0], I.collapse[0] + 0.26)); // YOU. compresses
  const fly = ease.swift(range(t, I.collapse[0] + 0.2, I.halvesIn[0] + 0.12)); // traces travel to the halves
  const presetHi = range(t, W.preset - 0.04, W.preset + 0.14) * (1 - range(t, W.preset + 0.4, W.it - 0.1)); // PRESET. — a brief emphasis
  const presetPop = Math.sin(Math.PI * range(t, W.preset - 0.03, W.preset + 0.33));
  const youGlow = range(t, W.you - 0.05, W.you + 0.4) * (1 - 0.6 * range(t, I.collapse[0], I.halvesIn[0])) * (1 - range(t, I.contact, I.contact + 0.3));
  const youIn = glideIn(range(t, W.you - 0.03, W.you + 0.42));
  const squeeze = (k: number): React.CSSProperties => ({ transform: `scale(${1 - 0.95 * k}, ${1 - 0.86 * k})`, filter: `brightness(${1 + 2.2 * k})`, opacity: 1 - range(k, 0.75, 1) });
  const outA = W.it - 0.02; // PRESET. reads ~0.5 s; phase A clears as he says "It"
  const outB = W.you + 0.26; // IT SHOULD START / WITH leave; YOU. holds alone for a beat
  const YOU_Y = 760, YOU_SIZE = 310, YOU_C = { x: 540, y: YOU_Y + 0.46 * YOU_SIZE };
  const hook = t < I.halvesIn[0] + 0.05 && (
    <>
      {/* phase A */}
      {t < outA + 0.4 && (
        <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 800px", transform: `translateX(${10 * drift}px) scale(${lerp(1, 1.04, pushA)})` }}>
          {presetHi > 0 && <div style={{ position: "absolute", left: 540 - 520, top: 930 - 380, width: 1040, height: 760, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(231,50,37,${0.26 * presetHi}), rgba(231,50,37,${0.07 * presetHi}) 55%, rgba(231,50,37,0) 100%)` }} />}
          <Line t={t} x={540} y={600} size={76} weight={600} track={0.06} align="center" out={outA} outDur={0.28} outMode="up" words={[{ w: "YOUR", at: W.your }, { w: "NEXT", at: W.next }, { w: "PC", at: W.pc, gap: 0 }]} />
          <Line t={t} x={540} y={700} size={100} align="center" out={outA + 0.04} outDur={0.28} outMode="up" words={[{ w: "SHOULDN'T", at: W.shouldnt }, { w: "START", at: W.start1, gap: 0 }]} />
          <div style={{ position: "absolute", inset: 0, transformOrigin: "760px 900px", transform: `scale(${1 + 0.05 * presetPop})` }}>
            <Line t={t} x={540} y={830} size={128} align="center" out={outA + 0.08} outDur={0.28} outMode="up" words={[{ w: "WITH", at: W.with1, size: 84 }, { w: "A", at: W.with1 + 0.12, size: 84 }, { w: "PRESET.", at: W.preset - 0.03, color: BRAND.red, gap: 0 }]} />
          </div>
        </div>
      )}
      {/* phase B */}
      {t >= W.should2 - 0.25 && (
        <>
          {youGlow > 0 && <div style={{ position: "absolute", left: 540 - 600, top: YOU_C.y - 600, width: 1200, height: 1200, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(249,194,4,${0.2 * youGlow}), rgba(249,194,4,${0.05 * youGlow}) 55%, rgba(249,194,4,0) 100%)` }} />}
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${8 * drift}px)` }}>
            <Line t={t} x={540} y={540} size={96} align="center" out={outB} outDur={0.3} outMode="up" words={[{ w: "IT", at: W.should2 - 0.12 }, { w: "SHOULD", at: W.should2 }, { w: "START", at: W.start2, gap: 0 }]} />
            <Line t={t} x={540} y={660} size={70} weight={600} track={0.08} align="center" out={outB + 0.04} outDur={0.3} outMode="up" words={[{ w: "WITH", at: W.with2, gap: 0 }]} />
          </div>
          {/* YOU. arrives out of depth, holds, then compresses into light */}
          <div style={{ position: "absolute", inset: 0, transformOrigin: `${YOU_C.x}px ${YOU_C.y}px`, transform: `translateY(${(30 * (1 - youIn)).toFixed(2)}px) scale(${lerp(0.86, 1, youIn) * lerp(1, 1.05, ease.inOutCubic(range(t, W.you + 0.3, I.collapse[0])))})`, ...squeeze(sq) }}>
            <Line t={t} x={540} y={YOU_Y} size={YOU_SIZE} align="center" track={-0.01} enterDur={0.38} words={[{ w: "YOU.", at: W.you, color: BRAND.yellow, gap: 0 }]} />
          </div>
        </>
      )}
    </>
  );
  // the traces: YOU.'s yellow → the ember between the halves; red from its two sides → the two halves
  const hl = { x: (la.x + hit.x) / 2 - INTRO_D0, y: (la.y + hit.y) / 2 + 40 }, hr = { x: (ra.x + hit.x) / 2 + INTRO_D0, y: (ra.y + hit.y) / 2 + 40 };
  const traces = sq > 0.5 && t < I.halvesIn[1] && (() => {
    const src = [{ x: YOU_C.x, y: YOU_C.y, c: BRAND.yellow, to: hit }, { x: YOU_C.x - 150, y: YOU_C.y + 20, c: BRAND.red, to: hl }, { x: YOU_C.x + 150, y: YOU_C.y + 20, c: BRAND.red, to: hr }];
    return src.map((s0, i) => {
      const k = clamp01(fly * 1.08 - i * 0.04);
      const p = { x: lerp(s0.x, s0.to.x, k) + Math.sin(Math.PI * k) * (i === 1 ? -140 : i === 2 ? 140 : 0), y: lerp(s0.y, s0.to.y, k) };
      const len = lerp(i === 0 ? 260 : 300, 26, k);
      const ang = Math.atan2(s0.to.y - s0.y, s0.to.x - s0.x);
      const a = k < 0.05 ? 0 : ang;
      return (
        <g key={i} opacity={i === 0 ? 1 - range(t, I.halvesIn[0] + 0.1, I.halvesIn[0] + 0.25) : 1 - range(t, I.halvesIn[0] + 0.02, I.halvesIn[0] + 0.3)}>
          <line x1={p.x - Math.cos(a) * len} y1={p.y - Math.sin(a) * len * (k < 0.05 ? 0 : 1)} x2={p.x} y2={p.y} stroke={s0.c} strokeWidth={i === 0 ? 7 : 6} strokeLinecap="round" filter="url(#redglow)" />
          <circle cx={p.x} cy={p.y} r={i === 0 ? 7 : 5} fill={i === 0 ? "#fff6c8" : "#ffd2c8"} />
        </g>
      );
    });
  })();
  // DOHA • QATAR under the real logo
  const dq = glideIn(range(t, I.doha[0], I.doha[1]));
  const dqOut = ease.inCubic(range(t, I.dohaOut[0], I.dohaOut[1]));

  // YOU.'s yellow, waiting between the halves — it brightens as they close, then becomes the clash
  const ember = t >= I.halvesIn[0] + 0.04 && t < I.contact ? range(t, I.halvesIn[0] + 0.04, I.halvesIn[1] + 0.05) : 0;
  const settled = t >= settledAt(I.contact);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", transform: jolt ? `translateY(${jolt}px)` : undefined }}>
      {hook}
      {/* the red tightening behind the emblem (pressure) */}
      {!unfolding && t > I.contact && (
        <div style={{ position: "absolute", left: 540 - 520, top: 690 - 520, width: 1040, height: 1040, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(231,50,37,${0.18 * glow}), rgba(231,50,37,0) ${lerp(100, 60, press)}%)` }} />
      )}
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <filter id="redglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {traces}
        {ember > 0 && (
          <g opacity={ember}>
            <circle cx={hit.x} cy={hit.y} r={26 + 22 * pose.f} fill={BRAND.yellow} opacity={0.12 + 0.2 * pose.f} filter="url(#redglow)" />
            <circle cx={hit.x} cy={hit.y} r={4 + 2.5 * pose.f} fill="#fff3c4" />
          </g>
        )}
        {/* the unfold: each half of the emblem becomes half of the monitor's bezel */}
        {unfolding && (
          <g opacity={1 - bandsOut}>
            {[0.05, 0.1].map((d, i) => {
              const [eL, eR] = echo(d);
              return (
                <g key={d} opacity={(i ? 0.22 : 0.4) * (1 - range(t, I.expand[1] - 0.1, I.expand[1] + 0.1))}>
                  <path d={pathOf(eL)} fill="none" stroke={BRAND.red} strokeWidth={2} />
                  <path d={pathOf(eR)} fill="none" stroke={BRAND.red} strokeWidth={2} />
                </g>
              );
            })}
            <path d={pathOf(shapeL)} fill="rgb(200,52,32)" />
            <path d={pathOf(shapeR)} fill="rgb(200,52,32)" />
          </g>
        )}
        {/* yellow: the wordmark breaks into light that settles as the power LED and two corner glints */}
        {t >= I.expand[0] && t < I.materialize[1] + 0.15 &&
          [0, 1, 2, 3, 4, 5].map((i) => {
            const from = { x: 330 + i * 84, y: wmY[i % 2] };
            const to = i < 2 ? led : i < 4 ? cornerL : cornerR;
            const kk = clamp01(dashK * 1.1 - i * 0.02);
            const ctrl = { x: lerp(from.x, to.x, 0.5) + (i % 2 ? 120 : -120), y: Math.max(from.y, to.y) + 160 };
            const q = (u: number) => ({ x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * ctrl.x + u * u * to.x, y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * ctrl.y + u * u * to.y });
            const p = q(kk), p0 = q(Math.max(0, kk - 0.1));
            const fade = 1 - range(t, I.materialize[1] - 0.1, I.materialize[1] + 0.15);
            if (kk >= 1) return i < 2 ? null : <circle key={i} cx={to.x} cy={to.y} r={3} fill={BRAND.yellow} opacity={fade * (1 - range(t, I.materialize[0] + 0.2, I.materialize[1]))} />;
            return <line key={i} x1={p0.x} y1={p0.y} x2={p.x} y2={p.y} stroke={BRAND.yellow} strokeWidth={5} strokeLinecap="round" opacity={fade} />;
          })}
      </svg>
      {/* the real logo art: two halves of the emblem until they have settled, then the single emblem */}
      {art > 0 && (
        <EmblemHalves left={540 + (LOGO.left - 540) * scale} top={830 + (LOGO.top - 830) * scale} width={LOGO_W * scale} pose={pose} whole={settled} opacity={art} filter={halvesK < 1 ? `blur(${(8 * (1 - halvesK)).toFixed(2)}px) brightness(${(1 + 0.6 * (1 - halvesK)).toFixed(3)})` : undefined} />
      )}
      <ClashSpark t={t} at={I.contact} x={hit.x} y={hit.y} />
      {dq > 0 && dqOut < 1 && <DohaQatar k={dq} out={dqOut} y={LOGO.top + 5053 * s + 52} scale={scale} tremor={tremor} qatarHi={qatarHi} />}
      {wm > 0 && t < I.expand[0] + 0.1 && (
        <div style={{ position: "absolute", left: 540 + (LOGO.left - 540) * scale + tremor, top: 830 + (LOGO.top - 830) * scale, width: LOGO_W * scale, height: LOGO_SRC.h * s * scale, opacity: 1 - range(t, I.expand[0] - 0.02, I.expand[0] + 0.08), clipPath: `inset(${(3480 / LOGO_SRC.h) * 100}% ${100 - (8 + wm * 90)}% 0 0)` }}>
          <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
          {wm < 1 && <div style={{ position: "absolute", inset: 0, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(90deg, rgba(255,255,255,0) ${8 + wm * 90 - 6}%, rgba(255,250,225,1) ${8 + wm * 90}%)` }} />}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** DOHA • QATAR — the location line, used under the logo at the start and in the final hold */
export const DohaQatar: React.FC<{ k: number; out?: number; y: number; size?: number; scale?: number; tremor?: number; qatarHi?: number }> = ({ k, out = 0, y, size = 46, scale = 1, tremor = 0, qatarHi = 0 }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: 830 + (y - 830) * scale,
      textAlign: "center",
      fontFamily: FONT.display,
      fontWeight: 500,
      fontSize: size,
      letterSpacing: "0.34em",
      paddingLeft: "0.34em",
      color: BRAND.white,
      opacity: clamp01(k * 1.4) * (1 - out),
      transform: `translate(${tremor}px, ${((1 - k) * 22 - 10 * out).toFixed(3)}px)`,
      filter: `blur(${(6 * (1 - k) * (1 - k) + 5 * out).toFixed(2)}px)`,
      whiteSpace: "nowrap",
    }}
  >
    DOHA <span style={{ color: BRAND.yellow }}>•</span>{" "}
    <span style={{ color: `rgb(${Math.round(255 - 6 * qatarHi)},${Math.round(255 - 61 * qatarHi)},${Math.round(255 - 251 * qatarHi)})`, textShadow: qatarHi > 0.01 ? `0 0 ${(18 * qatarHi).toFixed(1)}px rgba(249,194,4,${(0.6 * qatarHi).toFixed(3)})` : undefined }}>QATAR</span>
  </div>
);

export const introSamples = (t: number) => {
  if (t >= I.expand[0] && t < I.expand[1]) return 10;
  return 1;
};

