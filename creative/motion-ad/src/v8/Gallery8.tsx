import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { V } from "./time";
import { Line, arrive as glideIn } from "./Kinetic";

/**
 * ALL 13 real M1 builds — one continuous flight through the build history,
 * oldest → newest (the site's own data, newest last = the final hero).
 * Black space, no cards / borders / frames: each build is its real photo
 * (transparent cut-out, never edited) standing at its own depth. A camera
 * moves forward through them at ONE steady pace (eased in at the start and out
 * into the flagship only), on a slow lateral arc. Four builds stand near the
 * camera's line and grow into big, readable passes (~1.0 s each); the rest
 * stand wider and sweep through the sides (~0.55 s each), several in view at once; depth reads through
 * scale, fog and a little focus falloff. It ends framing the 9800X3D / RTX 5080 flagship — the
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
  { n: 1, src: "ryzen-5-rtx-2060-b450.png", w: 1124, h: 844, bb: [213, 139, 748, 749], x: -270, z: 2610 },
  { n: 2, src: "ryzen-5-gtx-1660-ti.webp", w: 1090, h: 1280, bb: [38, 7, 1033, 1229], x: 270, z: 1350, hero: true },
  { n: 3, src: "ryzen-5-rtx-2060-b550.webp", w: 1280, h: 960, bb: [213, 10, 1005, 882], x: 620, z: 3040 },
  { n: 4, src: "ryzen-7-rtx-4060.webp", w: 720, h: 1280, bb: [20, 242, 701, 1168], x: -350, z: 4110 },
  { n: 5, src: "ryzen-7-rtx-2070.webp", w: 960, h: 1280, bb: [198, 175, 855, 892], x: 90, z: 4660, hero: true },
  { n: 6, src: "ryzen-5-5600gt-rtx-3060.webp", w: 720, h: 1280, bb: [26, 254, 656, 1016], x: -540, z: 6200 },
  { n: 7, src: "ryzen-7-rtx-3070.webp", w: 960, h: 1280, bb: [124, 5, 942, 1192], x: 350, z: 6800 },
  { n: 8, src: "ryzen-5-rtx-5060-a520m.webp", w: 1052, h: 1280, bb: [58, 100, 963, 1227], x: -160, z: 7150, hero: true },
  { n: 9, src: "ryzen-5-rtx-5060-b550m.webp", w: 914, h: 1122, bb: [80, 28, 795, 1051], x: 320, z: 8690 },
  { n: 10, src: "ryzen-5-rtx-3060-white.webp", w: 960, h: 1280, bb: [83, 122, 791, 1123], x: -560, z: 9690 },
  { n: 11, src: "ryzen-5-rtx-4060.webp", w: 720, h: 1280, bb: [13, 174, 653, 1155], x: 30, z: 10040, hero: true },
  { n: 12, src: "ryzen-5-rtx-5060-ti.webp", w: 1221, h: 1280, bb: [144, 4, 1095, 1194], x: -440, z: 11250 },
  { n: 13, src: "ryzen-7-9800x3d-rtx-5080.webp", w: 1206, h: 1724, bb: [0, 55, 1205, 1668], x: 0, z: 12000, hero: true },
];
const CASE_H = 700; // every case stands the same physical height (world units)
const F = 1500;
const CAM_Y = -150; // eye a little above the case centres
/** build #2's front fan (source px) — where the shot begins */
export const FAN2 = { x: 862, y: 650, r: 96 };

// ------------------------------------------------------------------ the camera: ONE global progress
// One velocity profile for the whole flight: a cosine ease-in over the first 12 %, a constant cruise,
// a cosine ease-out over the last 13 % into the flagship. Never re-timed per build: what makes each
// build land is where it stands (scale, foreground passes, depth, the camera's lateral arc), not speed.
const g0 = GA.start;
const ge = GA.end;
export const CAM_Z0 = 0;
export const CAM_Z1 = 12000 - 1060; // the flagship, framed
export const EASE_IN = 0.12, EASE_OUT = 0.13;
/** integral of the trapezoid-with-cosine-ramps velocity, normalised to 0 → 1 */
export function galProgress(u: number) {
  const a = EASE_IN, b = EASE_OUT;
  const x = Math.max(0, Math.min(1, u));
  const ramp = (s: number) => s / 2 - Math.sin(Math.PI * s) / (2 * Math.PI); // ∫ (1 - cos πs)/2
  const total = a / 2 + (1 - a - b) + b / 2;
  let d: number;
  if (x < a) d = a * ramp(x / a);
  else if (x <= 1 - b) d = a / 2 + (x - a);
  else d = a / 2 + (1 - a - b) + b * (0.5 - ramp(1 - (x - (1 - b)) / b));
  return d / total;
}
// the lateral arc: a slow S through the field, flattening into the flagship's centre line
const smooth5 = (x: number) => x * x * x * (x * (6 * x - 15) + 10);
export const camX = (P: number) => 170 * Math.sin(2 * Math.PI * (1.15 * P + 0.08)) * (1 - smooth5(Math.max(0, (P - 0.68) / 0.32))) - 20 * (1 - P);
export const galCam = (t: number) => {
  const P = galProgress((t - g0) / (ge - g0));
  return { z: CAM_Z0 + (CAM_Z1 - CAM_Z0) * P, x: camX(P), P };
};

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
  const pull = glideIn(range(t, g0, g0 + 0.7));
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
  const reveal = range(t, g0 + 0.15, g0 + 0.65); // everything except #2 emerges as we pull back
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
    <Line t={t} x={86} y={250} size={168} out={GA.textOut} outDur={0.28} outMode="blur" words={[{ w: "REAL", at: GA.real, gap: 0 }]} />
    <Line t={t} x={86} y={410} size={168} out={GA.textOut + 0.06} outDur={0.28} outMode="blur" words={[{ w: "BUILDS.", at: GA.builds, color: BRAND.yellow, gap: 0 }]} />
  </>
);

export const gallerySamples = (t: number) => {
  if (t >= g0 && t < g0 + 0.6) return 6;
  if (t >= g0 + 0.9 && t < ge) return 3;
  return 1;
};
export { RT };
