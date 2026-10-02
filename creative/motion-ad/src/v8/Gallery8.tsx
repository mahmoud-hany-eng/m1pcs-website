import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { V } from "./time";
import { Line } from "./Kinetic";

/**
 * ALL 13 real M1 builds — one continuous flight through the build history,
 * oldest → newest (the site's own data, newest last = the final hero).
 * Black space, no cards / borders / frames: each build is its real photo
 * (transparent cut-out, never edited) standing at its own depth. A camera
 * moves forward through them with lateral sway; five builds get a mini-hero
 * moment (the camera eases off as it frames them), the rest pass through the
 * foreground / midground / distance; depth reads through scale, fog and a
 * little focus falloff. It ends framing the 9800X3D / RTX 5080 flagship — the
 * hero of the next beat — while the others sink into darkness.
 *
 * It begins inside the light of build #2's front fan (Qatar's glow became that
 * fan in the previous shot) and pulls back to reveal #1 and #2.
 */

const GA = V.gallery;
const RT = V.route;
type B = { n: number; src: string; w: number; h: number; bb: [number, number, number, number]; x: number; z: number; hero?: boolean };
// oldest → newest (src/lib/builds.ts is newest-first); bb = alpha>160 bounds of the real photo (source px)
export const BUILDS: B[] = [
  { n: 1, src: "ryzen-5-rtx-2060-b450.png", w: 1124, h: 844, bb: [213, 139, 748, 749], x: -640, z: 1950 },
  { n: 2, src: "ryzen-5-gtx-1660-ti.webp", w: 1090, h: 1280, bb: [38, 7, 1033, 1229], x: 270, z: 1350, hero: true },
  { n: 3, src: "ryzen-5-rtx-2060-b550.webp", w: 1280, h: 960, bb: [213, 10, 1005, 882], x: 430, z: 2700 },
  { n: 4, src: "ryzen-7-rtx-4060.webp", w: 720, h: 1280, bb: [20, 242, 701, 1168], x: -440, z: 3500 },
  { n: 5, src: "ryzen-7-rtx-2070.webp", w: 960, h: 1280, bb: [198, 175, 855, 892], x: 440, z: 4300 },
  { n: 6, src: "ryzen-5-5600gt-rtx-3060.webp", w: 720, h: 1280, bb: [26, 254, 656, 1016], x: -440, z: 5100 },
  { n: 7, src: "ryzen-7-rtx-3070.webp", w: 960, h: 1280, bb: [124, 5, 942, 1192], x: 440, z: 5900 },
  { n: 8, src: "ryzen-5-rtx-5060-a520m.webp", w: 1052, h: 1280, bb: [58, 100, 963, 1227], x: -260, z: 7000, hero: true },
  { n: 9, src: "ryzen-5-rtx-5060-b550m.webp", w: 914, h: 1122, bb: [80, 28, 795, 1051], x: 300, z: 8000, hero: true },
  { n: 10, src: "ryzen-5-rtx-3060-white.webp", w: 960, h: 1280, bb: [83, 122, 791, 1123], x: -440, z: 8900 },
  { n: 11, src: "ryzen-5-rtx-4060.webp", w: 720, h: 1280, bb: [13, 174, 653, 1155], x: 280, z: 9800, hero: true },
  { n: 12, src: "ryzen-5-rtx-5060-ti.webp", w: 1221, h: 1280, bb: [144, 4, 1095, 1194], x: -280, z: 10800, hero: true },
  { n: 13, src: "ryzen-7-9800x3d-rtx-5080.webp", w: 1206, h: 1724, bb: [0, 55, 1205, 1668], x: 0, z: 12000, hero: true },
];
const CASE_H = 700; // every case stands the same physical height (world units)
const F = 1500;
const CAM_Y = -150; // eye a little above the case centres
/** build #2's front fan (source px) — where the shot begins */
export const FAN2 = { x: 862, y: 650, r: 96 };

// ------------------------------------------------------------------ the camera (monotone through the keys)
const g0 = GA.start;
const ge = GA.end;
const KEYS: [number, number, number][] = [
  // [t, camera z, camera x]
  [g0 + 0.7, 0, -40],
  [g0 + 1.0, 180, -10], // #1 + #2 revealed (mini-hero #2)
  [g0 + 2.45, 5800, -150], // #3…#7 pass
  [g0 + 2.85, 5980, -140], // mini-hero #8
  [g0 + 3.35, 6830, 170],
  [g0 + 3.65, 6960, 180], // mini-hero #9
  [g0 + 4.15, 8640, 170],
  [g0 + 4.42, 8750, 160], // mini-hero #11
  [g0 + 4.85, 9650, -150],
  [g0 + 5.1, 9760, -150], // mini-hero #12
  [ge, 12000 - 1060, 0], // the flagship, framed
];
function monotone(t: number, col: 1 | 2) {
  const n = KEYS.length;
  if (t <= KEYS[0][0]) return KEYS[0][col];
  if (t >= KEYS[n - 1][0]) return KEYS[n - 1][col];
  let i = 0;
  while (t > KEYS[i + 1][0]) i++;
  const xs = KEYS.map((k) => k[0]), ys = KEYS.map((k) => k[col]);
  const d = (j: number) => (ys[j + 1] - ys[j]) / (xs[j + 1] - xs[j]);
  const m = (j: number) => {
    if (j === 0 || j === n - 1) return 0;
    const a = d(j - 1), b = d(j);
    if (a * b <= 0) return 0;
    return (2 * a * b) / (a + b); // harmonic mean — no overshoot
  };
  const h = xs[i + 1] - xs[i], u = (t - xs[i]) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  return h00 * ys[i] + h10 * h * m(i) + h01 * ys[i + 1] + h11 * h * m(i + 1);
}
export const galCam = (t: number) => ({ z: monotone(t, 1), x: monotone(t, 2) });

/** screen placement of build b with the gallery camera at time t */
export function place(b: B, t: number) {
  const c = galCam(t);
  const dz = b.z - c.z;
  const s = F / Math.max(dz, 1);
  const pps = (CASE_H / (b.bb[3] - b.bb[1])) * s; // screen px per source px
  const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2;
  return { x: 540 + (b.x - c.x) * s, y: 960 + (0 - CAM_Y) * s, pps, sx: cx, sy: cy, dz, s };
}
export const HERO13 = BUILDS[12];

const Build: React.FC<{ b: B; x: number; y: number; sx: number; sy: number; pps: number; bright: number; blur: number; opacity: number; floor?: number }> = ({ b, x, y, sx, sy, pps, bright, blur, opacity, floor = 0 }) => (
  <>
    {floor > 0.01 && <div style={{ position: "absolute", left: x - (b.bb[2] - b.bb[0]) * pps * 0.75, top: y + (b.bb[3] - sy) * pps - 40 * pps * 3, width: (b.bb[2] - b.bb[0]) * pps * 1.5, height: 240 * pps * 3, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(231,50,37,0.22), rgba(231,50,37,0))", opacity: floor * opacity }} />}
    <Img src={staticFile(`brand/builds/${b.src}`)} style={{ position: "absolute", left: x - sx * pps, top: y - sy * pps, width: b.w * pps, height: b.h * pps, opacity, filter: `brightness(${bright.toFixed(3)})${blur > 0.35 ? ` blur(${blur.toFixed(2)}px)` : ""}` }} />
  </>
);

export const Gallery8: React.FC<{ t: number; vo: boolean }> = ({ t }) => {
  if (t < g0 - 0.05 || t > ge + 0.9) return null;
  // the opening: inside #2's fan → its gallery placement
  const pull = ease.settle(range(t, g0, g0 + 0.95));
  const recede = ease.inOutCubic(range(t, ge - 0.35, ge + 0.6)); // the others sink into darkness
  const items = BUILDS.map((b) => {
    const p = place(b, t);
    if (b.n === 2 && pull < 1) {
      // from the fan close-up (fan ring ~620 px radius at frame centre) to its place in the gallery
      const ppsFan = 620 / FAN2.r;
      const k = pull;
      return { b, x: lerp(540, p.x, k), y: lerp(960, p.y, k), sx: lerp(FAN2.x, p.sx, k), sy: lerp(FAN2.y, p.sy, k), pps: Math.exp(lerp(Math.log(ppsFan), Math.log(p.pps), k)), dz: p.dz };
    }
    return { b, x: p.x, y: p.y, sx: p.sx, sy: p.sy, pps: p.pps, dz: p.dz };
  });
  // far → near
  items.sort((a, c) => c.dz - a.dz);
  const reveal = range(t, g0 + 0.2, g0 + 0.9); // everything except #2 emerges as we pull back
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {items.map(({ b, x, y, sx, sy, pps, dz }) => {
        if (dz < 140) return null;
        const halfW = ((b.bb[2] - b.bb[0]) / 2) * pps, halfH = ((b.bb[3] - b.bb[1]) / 2) * pps;
        if (x + halfW < -60 || x - halfW > 1140 || y + halfH < -60 || y - halfH > 1980) return null;
        const fog = clamp01(1 - (dz - 1100) / 9500);
        let bright = lerp(0.22, 1.08, fog * fog);
        const heroLit = b.hero ? Math.max(0, 1 - Math.abs(dz - 1150) / 700) : 0; // mini-hero: lit as it is framed
        bright += 0.12 * heroLit;
        const near = clamp01((520 - dz) / 380); // passing the lens
        const blur = Math.min(3.2, Math.max(0, (dz - 2600) / 2400)) + 9 * near * near;
        let opacity = (b.n === 2 ? 1 : reveal) * (1 - near * 0.85);
        if (b.n !== 13) {
          opacity *= 1 - recede;
          bright *= 1 - 0.6 * recede;
        }
        return <Build key={b.n} b={b} x={x} y={y} sx={sx} sy={sy} pps={pps} bright={bright} blur={blur} opacity={opacity} floor={0.6 * heroLit + (b.n === 13 ? 0.6 * range(t, ge - 0.8, ge) : 0)} />;
      })}
    </AbsoluteFill>
  );
};

/** REAL / BUILDS. — kinetic, over the flight (BUILDS. lands as the PCs keep coming) */
export const GalleryText: React.FC<{ t: number; vo: boolean }> = ({ t }) => (
  <>
    <Line t={t} x={86} y={250} size={168} out={GA.textOut} outDur={0.4} outMode="blur" words={[{ w: "REAL", at: GA.real, gap: 0 }]} />
    <Line t={t} x={86} y={410} size={168} out={GA.textOut + 0.06} outDur={0.4} outMode="blur" words={[{ w: "BUILDS.", at: GA.builds, color: BRAND.yellow, gap: 0 }]} />
  </>
);

export const gallerySamples = (t: number) => {
  if (t >= g0 && t < g0 + 0.6) return 6;
  if (t >= g0 + 0.9 && t < ge) return 3;
  return 1;
};
export { RT };
