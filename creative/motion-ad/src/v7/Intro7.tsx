import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range, bezier } from "../lib/ease";
import { BRAND } from "../final/shared";
import { EMB, LEFT, RIGHT, LOGO_SRC, P, V_TRI, lerpP, pathOf, resample, N } from "./geom";
import { Camera, MON, project, v3 } from "./world";
import { V } from "./time";

/**
 * v7 opening — the logo becomes the world.
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

export const Intro7: React.FC<{ t: number; cam: Camera }> = ({ t, cam }) => {
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
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
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
      {wm > 0 && t < I.expand[0] + 0.1 && (
        <div style={{ position: "absolute", left: 540 + (LOGO.left - 540) * scale + tremor, top: 830 + (LOGO.top - 830) * scale, width: LOGO_W * scale, height: LOGO_SRC.h * s * scale, opacity: 1 - range(t, I.expand[0] - 0.02, I.expand[0] + 0.08), clipPath: `inset(${(3480 / LOGO_SRC.h) * 100}% ${100 - (8 + wm * 90)}% 0 0)` }}>
          <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
          {wm < 1 && <div style={{ position: "absolute", inset: 0, WebkitMaskImage: `url(${staticFile("brand/logo.png")})`, WebkitMaskSize: "100% 100%", background: `linear-gradient(90deg, rgba(255,255,255,0) ${8 + wm * 90 - 6}%, rgba(255,250,225,1) ${8 + wm * 90}%)` }} />}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const introSamples = (t: number) => {
  if (t >= I.expand[0] && t < I.expand[1]) return 10;
  if (t >= I.pressure[0] && t < I.pressure[1]) return 2;
  return 1;
};
