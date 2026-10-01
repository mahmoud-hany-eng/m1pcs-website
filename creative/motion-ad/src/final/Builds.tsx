import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "./shared";
import { FONT } from "./fonts";
import CTA_LOG from "../../public/cap/cta/log.json";
import T from "../../timeline.json";

const CU = T.final.cues;

/**
 * Shots 7–9 around REAL completed M1 builds (repo photos, transparent cut-outs,
 * never stretched or recoloured — only brightness for depth):
 *  7. REAL BUILDS. — the Qatar light opens onto a depth field of real builds;
 *     the camera dollies through them (one passes the lens), the flagship
 *     9800X3D / RTX 5080 build becomes the hero
 *  8. the parts — each category word arrives with its own motion and is
 *     absorbed into the hero, which lights up a step each time; then
 *     BUILT. SET UP. READY.
 *  9. READY FOR YOU. / PICKUP OR DELIVERY. — then the hero glides into the
 *     exact place the same photo occupies in the site's closing section
 */

type Build = { src: string; w: number; h: number; bb: [number, number, number, number]; X: number; Y: number; Z: number };
const B = (src: string, w: number, h: number, bb: [number, number, number, number], X: number, Y: number, Z: number): Build => ({ src, w, h, bb, X, Y, Z });
const HERO = B("ryzen-7-9800x3d-rtx-5080.webp", 1206, 1724, [0, 55, 1205, 1668], 0, 0, 12);
// a corridor: alternating sides, deeper = further out; one build sits almost
// on the camera's path and passes the lens
const FIELD: Build[] = [
  B("ryzen-5-rtx-5060-ti.webp", 1221, 1280, [142, 3, 1097, 1195], 0.4, 0.04, 2.6),
  B("ryzen-5-gtx-1660-ti.webp", 1090, 1280, [36, 5, 1034, 1231], -0.74, -0.2, 4.9),
  B("ryzen-5-rtx-2060-b550.webp", 1280, 960, [212, 8, 1006, 883], 0.82, 0.26, 7.0),
  B("ryzen-5-rtx-4060.webp", 720, 1280, [12, 173, 654, 1156], -0.74, -0.1, 9.1),
];
const FOCAL = 2300;

export const B0 = CU.builds.b0; // field appears inside the light
export const B_LAND = CU.builds.land; // hero settles
const PARTS0 = CU.parts.t0; // one category per half-beat
const BUILT0 = CU.built.t0;
const BUILT_DT = CU.built.dt;
const READY0 = CU.ready.t0;
export const TO_CTA = CU.cta.toCta;
export const CTA0 = CU.cta.cta0; // the site's closing section starts its own entrance

// the CTA photo's final place (from the live capture) under the CTA camera
type R = { x: number; y: number; w: number; h: number };
const ctaImg = (CTA_LOG as unknown as { meta: { img: R } }[])[100].meta.img;
export const CTA_CAM = { cx: 216, cy: 350, s: 1.0 };
const KS = 2.5;
const ctaTarget = {
  x: 540 + (ctaImg.x + ctaImg.w / 2 - CTA_CAM.cx) * KS * CTA_CAM.s,
  y: 960 + (ctaImg.y + ctaImg.h / 2 - CTA_CAM.cy) * KS * CTA_CAM.s,
  pxPerSrc: (ctaImg.h * KS * CTA_CAM.s) / HERO.h,
};

// ------------------------------------------------------------------ camera
const dolly = bezier(0.38, 0, 0.42, 1);
type Cam3 = { x: number; y: number; z: number };
const START: Cam3 = { x: 0, y: 0.04, z: -1 };
// the dolly: eases in out of the light, travels THROUGH the field, settles on the hero
function camZ(t: number) {
  if (t < 12.0) return lerp(-1, -0.4, ease.inCubic(range(t, B0, 12.0)));
  if (t < 13.62) return lerp(-0.4, 8.2, dolly(range(t, 12.0, 13.62)));
  return lerp(8.2, 10, ease.settle(range(t, 13.62, B_LAND + 0.1)));
}
function cam3(t: number): Cam3 {
  const aim = ease.inOutCubic(range(t, B0, B0 + 1.2));
  let c: Cam3 = { x: lerp(START.x, 0, aim), y: lerp(START.y, -0.03, aim), z: camZ(t) };
  // shot 8: settle back so copy has room above the hero
  const p = ease.inOutCubic(range(t, 14.42, 14.86));
  c = { x: c.x, y: lerp(c.y, -0.24, p), z: lerp(c.z, 9.45, p) };
  // shot 9: the build comes a touch closer
  const r = glide(range(t, READY0 - 0.1, TO_CTA));
  c = { x: c.x, y: lerp(c.y, -0.2, r), z: lerp(c.z, 9.62, r) };
  return c;
}
const project = (b: Build, c: Cam3) => {
  const d = b.Z - c.z;
  const unitPx = FOCAL / d;
  return { d, x: 540 + (b.X - c.x) * unitPx, y: 960 + (b.Y - c.y) * unitPx, pxPerSrc: unitPx / (b.bb[3] - b.bb[1]) };
};

const PC: React.FC<{ b: Build; x: number; y: number; pxPerSrc: number; brightness: number; opacity?: number; blur?: number }> = ({ b, x, y, pxPerSrc, brightness, opacity = 1, blur = 0 }) => {
  const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2;
  const filters = [`brightness(${brightness.toFixed(3)})`];
  if (blur > 0.3) filters.push(`blur(${blur.toFixed(2)}px)`);
  return (
    <Img
      src={staticFile(`brand/builds/${b.src}`)}
      style={{
        position: "absolute",
        left: x - cx * pxPerSrc,
        top: y - cy * pxPerSrc,
        width: b.w * pxPerSrc,
        height: b.h * pxPerSrc,
        filter: filters.join(" "),
        opacity,
      }}
    />
  );
};

// ------------------------------------------------------------------ parts
const PARTS = CU.parts.words;
const PART_DT = CU.parts.dt;
function partMotion(i: number, k: number, hold: { x: number; y: number }) {
  // k: 0..1 entrance — each category arrives differently
  switch (i) {
    case 0: return { x: hold.x, y: lerp(-160, hold.y, ease.outExpo(k)), s: 1, r: 0 }; // CPU drops in from the top
    case 1: return { x: lerp(-520, hold.x, ease.outExpo(k)), y: hold.y, s: 1, r: 0 }; // GPU slides from the side
    case 2: return { x: hold.x, y: hold.y, s: snap(k) * 1, r: 0 }; // RAM snaps into place
    case 3: return { x: hold.x, y: lerp(2120, hold.y, snap(k)), s: 1, r: 0 }; // STORAGE locks in from below
    case 4: { const a = ease.outCubic(k); return { x: hold.x + 520 * Math.cos(a * Math.PI * 0.5), y: hold.y - 520 * Math.sin((1 - a) * Math.PI * 0.5), s: 1, r: (1 - a) * 24 }; } // COOLING curves in
    default: return { x: hold.x, y: lerp(-200, hold.y, ease.outBack(k, 1.6)), s: 1, r: 0 }; // PSU lands last
  }
}
const HOLDS = [
  { x: 540, y: 560 },
  { x: 360, y: 820 },
  { x: 690, y: 700 },
  { x: 540, y: 1560 },
  { x: 540, y: 520 },
  { x: 540, y: 600 },
];

export const Builds: React.FC<{ t: number }> = ({ t }) => {
  if (t < B0 - 0.05 || t > 19.6) return null;
  const c = cam3(t);
  const reveal = ease.inOutCubic(range(t, 11.74, 12.02));

  // hero: 3D placement, then a glide into the site's own photo position
  const hp = project(HERO, c);
  const m = ease.inOutCubic(range(t, TO_CTA, CTA0 + 0.32));
  const hx = lerp(hp.x, ctaTarget.x, m);
  const hy = lerp(hp.y, ctaTarget.y, m);
  const hs = lerp(hp.pxPerSrc, ctaTarget.pxPerSrc, m);

  // lighting: the hero brightens as each part is absorbed
  const absorbed = PARTS.reduce((n, _, i) => n + ease.outCubic(range(t, PARTS0 + i * PART_DT + 0.24, PARTS0 + i * PART_DT + 0.34)), 0);
  const flash = PARTS.reduce((f, _, i) => f + Math.max(0, 1 - Math.abs(t - (PARTS0 + i * PART_DT + 0.3)) / 0.07), 0);
  const inParts = t >= PARTS0 - 0.3;
  const partLight = inParts ? lerp(1, 0.6, range(t, 14.42, 14.72)) + 0.4 * (absorbed / PARTS.length) * range(t, 14.42, 14.72) : 1;
  const depthLight = clamp01(0.2 + 0.8 * Math.pow(2.6 / hp.d, 1.1));
  const heroBright = depthLight * partLight + 0.22 * Math.min(1, flash) + 0.1 * Math.sin(Math.PI * range(t, BUILT0 + 2 * BUILT_DT, BUILT0 + 2 * BUILT_DT + 0.5));
  const heroOut = range(t, CTA0 + 0.36, CTA0 + 0.62); // the site's own photo takes over

  // REAL BUILDS.
  const rb = ease.settle(range(t, 12.5, 12.82));
  const rbOut = ease.inCubic(range(t, 14.3, 14.5));

  // BUILT. SET UP. READY.
  const ln = (i: number) => ease.settle(range(t, BUILT0 + i * BUILT_DT, BUILT0 + i * BUILT_DT + 0.28));
  const lnOut = ease.inCubic(range(t, READY0 - 0.2, READY0 - 0.02));
  const chips = glide(range(t, BUILT0 + BUILT_DT + 0.06, BUILT0 + BUILT_DT + 0.36));

  // READY FOR YOU.
  const ry = (i: number) => ease.settle(range(t, READY0 + i * 0.08, READY0 + i * 0.08 + 0.32));
  const ryOut = ease.inCubic(range(t, TO_CTA - 0.04, TO_CTA + 0.14));
  const icons = glide(range(t, READY0 + 0.22, READY0 + 0.52));

  // light leaving the build as it settles into the site
  const bloom = Math.sin(Math.PI * range(t, TO_CTA + 0.02, CTA0 + 0.3));

  const field = FIELD.map((b) => ({ b, p: project(b, c) }))
    .filter(({ p }) => p.d > 0.32)
    .sort((a, z) => z.p.d - a.p.d);

  const Title: React.FC<{ k: number; children: React.ReactNode; color?: string }> = ({ k, children, color }) => (
    <div style={{ overflow: "hidden", paddingBottom: 8 }}>
      <div style={{ transform: `translateY(${(1 - k) * 110}%)`, color }}>{children}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ opacity: reveal * (1 - heroOut * 0) }}>
        {/* the field: farther = smaller and darker, never overlapping the hero's line of sight */}
        {t < 15.2 &&
          field.map(({ b, p }) => {
            if (p.d > HERO.Z - c.z) return null;
            const bright = clamp01(0.3 + 0.7 * Math.pow(2.4 / p.d, 1.2));
            const fadeNear = range(p.d, 0.32, 0.9);
            return <PC key={b.src} b={b} x={p.x} y={p.y} pxPerSrc={p.pxPerSrc} brightness={bright} opacity={fadeNear * (1 - range(t, 14.6, 15.0))} blur={p.d < 1.2 ? (1.2 - p.d) * 10 : 0} />;
          })}
        {/* far builds behind the hero */}
        {t < 15.2 &&
          field.map(({ b, p }) =>
            p.d > HERO.Z - c.z ? <PC key={b.src + "f"} b={b} x={p.x} y={p.y} pxPerSrc={p.pxPerSrc} brightness={clamp01(0.16 + 0.84 * Math.pow(2.4 / p.d, 1.2))} /> : null
          )}
        <AbsoluteFill style={{ opacity: 1 - heroOut }}>
          {/* a low red pool of light under the hero, from its own ARGB */}
          <div style={{ position: "absolute", left: hx - 520 * hs * 1.4, top: hy + 600 * hs * 1.3, width: 1040 * hs * 1.4, height: 240 * hs * 1.3, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(231,50,37,0.32), rgba(231,50,37,0))", opacity: clamp01(heroBright) * range(t, 12.6, 13.6) }} />
          <PC b={HERO} x={hx} y={hy} pxPerSrc={hs} brightness={heroBright} />
        </AbsoluteFill>
        {/* the build's red light blooming as it settles into the site */}
        {bloom > 0.001 && (
          <div style={{ position: "absolute", left: hx - 900, top: hy - 900, width: 1800, height: 1800, background: "radial-gradient(closest-side, rgba(255,60,40,0.55), rgba(231,50,37,0.18) 45%, rgba(231,50,37,0) 100%)", mixBlendMode: "screen", opacity: 0.85 * bloom }} />
        )}
      </AbsoluteFill>

      {/* REAL BUILDS. */}
      {t >= 12.5 && t < 14.55 && (
        <div style={{ position: "absolute", left: 90, top: 270, fontFamily: FONT.display, fontWeight: 700, fontSize: 132, letterSpacing: -3, color: BRAND.white, opacity: 1 - rbOut, transform: `translateY(${-70 * rbOut}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
          <Title k={rb}>
            REAL <span style={{ color: BRAND.yellow }}>BUILDS.</span>
          </Title>
        </div>
      )}

      {/* parts, one per beat, each absorbed into the build */}
      {PARTS.map((w, i) => {
        const a = PARTS0 + i * PART_DT;
        if (t < a || t > a + 0.4) return null;
        const k = range(t, a, a + 0.17);
        const ab = ease.inCubic(range(t, a + 0.2, a + 0.34));
        const mo = partMotion(i, k, HOLDS[i]);
        const x = lerp(mo.x, hp.x, ab);
        const y = lerp(mo.y, hp.y - 60, ab);
        return (
          <div
            key={w}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%,-50%) rotate(${mo.r}deg) scale(${mo.s * (1 - 0.82 * ab)})`,
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 196,
              letterSpacing: -3,
              color: BRAND.white,
              opacity: 1 - range(ab, 0.6, 1),
              textShadow: "0 8px 36px rgba(0,0,0,0.85)",
              whiteSpace: "nowrap",
            }}
          >
            {w}
          </div>
        );
      })}

      {/* BUILT. SET UP. READY. */}
      {t >= BUILT0 && t < READY0 && (
        <div style={{ position: "absolute", left: 90, top: 250, fontFamily: FONT.display, fontWeight: 700, fontSize: 128, lineHeight: 1.0, letterSpacing: -3, color: BRAND.white, opacity: 1 - lnOut, transform: `translateY(${-90 * lnOut}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
          <Title k={ln(0)}>BUILT.</Title>
          <Title k={ln(1)}>SET UP.</Title>
          <Title k={ln(2)} color={BRAND.yellow}>
            READY.
          </Title>
          <div style={{ display: "flex", gap: 14, marginTop: 22, fontFamily: FONT.ui, fontWeight: 500, fontSize: 42, letterSpacing: 0, opacity: chips, transform: `translateY(${(1 - chips) * 20}px)` }}>
            {["Windows 11 Pro", "Drivers", "Updates"].map((s) => (
              <div key={s} style={{ border: "2px solid rgba(255,255,255,0.28)", borderRadius: 40, padding: "6px 24px", color: BRAND.white, background: "rgba(10,10,11,0.55)" }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* READY FOR YOU. */}
      {t >= READY0 && t < TO_CTA + 0.2 && (
        <div style={{ position: "absolute", left: 90, top: 270, fontFamily: FONT.display, fontWeight: 700, fontSize: 136, lineHeight: 1.0, letterSpacing: -3, color: BRAND.white, opacity: 1 - ryOut, transform: `translateY(${-80 * ryOut}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
          <Title k={ry(0)}>READY</Title>
          <Title k={ry(1)}>
            FOR <span style={{ color: BRAND.yellow }}>YOU.</span>
          </Title>
          <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 26, fontFamily: FONT.ui, fontWeight: 600, fontSize: 40, letterSpacing: 4, opacity: icons, transform: `translateY(${(1 - icons) * 20}px)` }}>
            <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke={BRAND.white} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6" />
            </svg>
            <span>PICKUP</span>
            <span style={{ color: BRAND.muted, letterSpacing: 2 }}>OR</span>
            <svg width={56} height={52} viewBox="0 0 26 24" fill="none" stroke={BRAND.white} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6h13v11H2zM15 10h5l3 3.5V17h-8" />
              <circle cx={6} cy={18.5} r={2} />
              <circle cx={19} cy={18.5} r={2} />
            </svg>
            <span>DELIVERY</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const buildsSamples = (t: number) => {
  if (t >= 12.1 && t < 13.7) return 8; // dolly through the field
  if (t >= PARTS0 && t < PARTS0 + PARTS.length * PART_DT + 0.2) return 4; // parts flying
  if (t >= TO_CTA && t < CTA0 + 0.32) return 4;
  return 1;
};
