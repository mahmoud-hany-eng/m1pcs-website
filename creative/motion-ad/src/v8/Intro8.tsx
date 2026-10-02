import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range, bezier } from "../lib/ease";
import { BRAND } from "../final/shared";
import { EMB, LEFT, RIGHT, LOGO_SRC, P, V_TRI, lerpP, pathOf, resample, N } from "../v7/geom";
import { Camera, MON, project, v3 } from "../v7/world";
import { V } from "./time";
import { FONT } from "../final/fonts";
import { Line } from "./Kinetic";

/**
 * v8 opening — a question, then the brand, then the world.
 * BLACK. "Are you in" — QATAR? (M1 yellow, a red light answers behind it, it
 * drifts toward camera) — "looking to / build a PC?" emerges behind it, the
 * whole group in a slight parallax. Then the letters compress into traces:
 * two red lines and a yellow spark that draw the REAL M1 emblem; the wordmark
 * lights; DOHA • QATAR — held while the narrator speaks. Then (as v7) the
 * emblem gains pressure and unfolds into the bezel of a monitor.
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
// explosive but controlled: a hard launch, a long settle, a hair of overshoot
const unfoldEase = bezier(0.12, 0.9, 0.22, 1.04);

export const Intro8: React.FC<{ t: number; cam: Camera }> = ({ t, cam }) => {
  if (t > I.materialize[1] + 0.2) return null;
  const apex = L2(V_TRI.apex), la = L2(V_TRI.l), ra = L2(V_TRI.r);
  const lA = ease.inOutCubic(range(t, I.lineA[0], I.lineA[1]));
  const lB = ease.inOutCubic(range(t, I.lineB[0], I.lineB[1]));
  const spark = range(t, I.spark, I.spark + 0.2);
  const outline = ease.inOutCubic(range(t, I.fill[0], I.fill[1] - 0.05));
  const fill = range(t, I.fill[0] + 0.12, I.fill[1]);
  const art = range(t, I.fill[1] - 0.12, I.fill[1] + 0.06) * (1 - range(t, I.expand[0] - 0.05, I.expand[0] + 0.02));
  const wm = ease.inOutCubic(range(t, I.wm[0], I.wm[1]));
  const breathe = 1 + 0.008 * Math.sin(Math.PI * range(t, I.hold[0], I.hold[1]));
  const press = ease.inCubic(range(t, I.pressure[0], I.pressure[1]));
  const tremor = press * 1.6 * Math.sin(t * 95);
  const scale = breathe * (1 - 0.04 * press);
  const glow = 0.25 + 0.75 * press;

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

  // ---------------------------------------------------------------- the question
  const W = I.words;
  const drift = lerp(-1, 1, ease.inOutCubic(range(t, W.are, I.collapse[0])));
  const lift = ease.inOutCubic(range(t, W.looking - 0.12, W.looking + 0.3)); // QATAR? makes room
  const sq = ease.inCubic(range(t, I.collapse[0], I.collapse[0] + 0.26)); // letters compress
  const fly = ease.inOutCubic(range(t, I.collapse[0] + 0.22, I.lineA[0] + 0.02)); // traces travel to the emblem
  const qRed = range(t, W.qatar - 0.05, W.qatar + 0.4) * (1 - 0.6 * range(t, I.collapse[0], I.lineA[0])) * (1 - range(t, I.fill[0], I.fill[1]));
  const squeeze = (k: number): React.CSSProperties => ({ transform: `scale(${1 - 0.95 * k}, ${1 - 0.86 * k})`, filter: `brightness(${1 + 2.2 * k})`, opacity: 1 - range(k, 0.75, 1) });
  const question = t < I.lineA[0] + 0.05 && (
    <>
      {/* the red light that answers QATAR? */}
      {qRed > 0 && <div style={{ position: "absolute", left: 540 - 620, top: 860 - 620 - 120 * lift, width: 1240, height: 1240, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(231,50,37,${0.3 * qRed}), rgba(231,50,37,${0.08 * qRed}) 55%, rgba(231,50,37,0) 100%)` }} />}
      <div style={{ position: "absolute", inset: 0, transform: `translateX(${10 * drift}px)`, transformOrigin: "540px 700px" }}>
        <Line t={t} x={540} y={640} size={64} weight={600} track={0.06} align="center" out={W.looking - 0.15} outDur={0.3} outMode="up" words={[{ w: "ARE", at: W.are }, { w: "YOU", at: W.you }, { w: "IN", at: W.in }]} />
      </div>
      <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 840px", transform: `translate(${28 * drift}px, ${-150 * lift}px) scale(${lerp(1, 1.06, ease.inOutCubic(range(t, W.qatar, I.collapse[0])))})`, ...squeeze(sq) }}>
        <Line t={t} x={540} y={735} size={236} align="center" track={-0.01} enterDur={0.5} words={[{ w: "QATAR?", at: W.qatar, color: BRAND.yellow, gap: 0 }]} />
      </div>
      <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 1090px", transform: `translate(${6 * drift}px, ${-150 * lift}px)`, ...squeeze(sq) }}>
        <Line t={t} x={540} y={1060} size={66} weight={600} track={0.06} align="center" words={[{ w: "LOOKING", at: W.looking }, { w: "TO", at: W.looking + 0.26, gap: 0 }]} />
      </div>
      {/* BUILD A PC? emerges from behind, out of depth */}
      <div style={{ position: "absolute", inset: 0, transformOrigin: "540px 1190px", transform: `translate(${-4 * drift}px, ${-150 * lift + 40 * (1 - ease.settle(range(t, W.build, W.build + 0.6)))}px) scale(${lerp(0.84, 1, ease.settle(range(t, W.build, W.build + 0.6)))})`, ...squeeze(sq) }}>
        <Line t={t} x={540} y={1140} size={138} align="center" words={[{ w: "BUILD", at: W.build }, { w: "A", at: W.build + 0.12 }, { w: "PC?", at: W.pc - 0.05, color: BRAND.red, gap: 0 }]} />
      </div>
    </>
  );
  // the traces: QATAR? → a yellow spark for the apex; the two lines below → the two red strokes
  const traces = sq > 0.5 && t < I.spark + 0.06 && (() => {
    const src = [{ x: 540, y: 840 - 150, c: BRAND.yellow, to: apex }, { x: 540, y: 1090 - 150, c: BRAND.red, to: la }, { x: 540, y: 1205 - 150, c: BRAND.red, to: ra }];
    return src.map((s0, i) => {
      const k = clamp01(fly * 1.08 - i * 0.04);
      const p = { x: lerp(s0.x, s0.to.x, k) + Math.sin(Math.PI * k) * (i === 1 ? -140 : i === 2 ? 140 : 0), y: lerp(s0.y, s0.to.y, k) };
      const len = lerp(i === 0 ? 260 : 300, 26, k);
      const ang = Math.atan2(s0.to.y - s0.y, s0.to.x - s0.x);
      const a = k < 0.05 ? 0 : ang;
      return (
        <g key={i} opacity={i === 0 ? 1 - range(t, I.spark, I.spark + 0.05) : 1 - range(t, I.lineA[0] + i * 0.03, I.lineA[0] + 0.08 + i * 0.03)}>
          <line x1={p.x - Math.cos(a) * len} y1={p.y - Math.sin(a) * len * (k < 0.05 ? 0 : 1)} x2={p.x} y2={p.y} stroke={s0.c} strokeWidth={i === 0 ? 7 : 6} strokeLinecap="round" filter="url(#redglow)" />
          <circle cx={p.x} cy={p.y} r={i === 0 ? 7 : 5} fill={i === 0 ? "#fff6c8" : "#ffd2c8"} />
        </g>
      );
    });
  })();
  // DOHA • QATAR under the real logo
  const dq = ease.settle(range(t, I.doha[0], I.doha[1]));
  const dqOut = ease.inCubic(range(t, I.dohaOut[0], I.dohaOut[1]));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {question}
      {/* the red tightening behind the emblem (pressure) */}
      {!unfolding && t > I.fill[0] && (
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
        {/* two lines, from two directions, meeting at the apex */}
        {!unfolding && outline < 1 && (
          <g filter="url(#redglow)" opacity={1 - fill}>
            {lA > 0 && <line x1={la.x} y1={la.y} x2={lerp(la.x, apex.x, lA)} y2={lerp(la.y, apex.y, lA)} stroke={BRAND.red} strokeWidth={6} strokeLinecap="round" />}
            {lB > 0 && <line x1={ra.x} y1={ra.y} x2={lerp(ra.x, apex.x, lB)} y2={lerp(ra.y, apex.y, lB)} stroke={BRAND.red} strokeWidth={6} strokeLinecap="round" />}
          </g>
        )}
        {spark > 0 && spark < 1 && (
          <g opacity={1 - spark}>
            {[0, 1, 2, 3, 4].map((i) => {
              const a = -Math.PI / 2 + (i - 2) * 0.55;
              const r0 = 6 + 30 * spark, r1 = r0 + 18 * (1 - spark);
              return <line key={i} x1={apex.x + Math.cos(a) * r0} y1={apex.y + Math.sin(a) * r0} x2={apex.x + Math.cos(a) * r1} y2={apex.y + Math.sin(a) * r1} stroke={BRAND.yellow} strokeWidth={3} strokeLinecap="round" />;
            })}
            <circle cx={apex.x} cy={apex.y} r={6 * (1 - spark) + 2} fill="#fff6c8" />
          </g>
        )}
        {/* the emblem resolves around the lines */}
        {!unfolding && outline > 0 && (
          <>
            <path d={emblemPath} fill="none" stroke={BRAND.red} strokeWidth={3} strokeDasharray={3000} strokeDashoffset={3000 * (1 - outline)} opacity={1 - art} />
            <path d={emblemPath} fill="rgb(200,52,32)" opacity={fill * (1 - art)} />
          </>
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
      {/* the real logo art (emblem + wordmark) while it is a logo */}
      {art > 0 && (
        <div style={{ position: "absolute", left: 540 + (LOGO.left - 540) * scale + tremor, top: 830 + (LOGO.top - 830) * scale, width: LOGO_W * scale, height: LOGO_SRC.h * s * scale, opacity: art, clipPath: `inset(0 0 ${100 - (3150 / LOGO_SRC.h) * 100}% 0)` }}>
          <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
        </div>
      )}
      {dq > 0 && dqOut < 1 && <DohaQatar k={dq} out={dqOut} y={LOGO.top + 5053 * s + 52} scale={scale} tremor={tremor} />}
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
export const DohaQatar: React.FC<{ k: number; out?: number; y: number; size?: number; scale?: number; tremor?: number }> = ({ k, out = 0, y, size = 46, scale = 1, tremor = 0 }) => (
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
      letterSpacing: `${0.34 + 0.22 * (1 - k)}em`,
      paddingLeft: "0.34em",
      color: BRAND.white,
      opacity: clamp01(k * 1.4) * (1 - out),
      transform: `translate(${tremor}px, ${(1 - k) * 14 - 10 * out}px)`,
      filter: `blur(${(6 * (1 - k) * (1 - k) + 5 * out).toFixed(2)}px)`,
      whiteSpace: "nowrap",
    }}
  >
    DOHA <span style={{ color: BRAND.yellow }}>•</span> QATAR
  </div>
);

export const introSamples = (t: number) => {
  if (t >= I.expand[0] && t < I.expand[1]) return 10;
  if (t >= I.pressure[0] && t < I.pressure[1]) return 2;
  return 1;
};
