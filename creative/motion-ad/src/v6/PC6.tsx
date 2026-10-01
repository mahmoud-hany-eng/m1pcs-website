import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { V } from "./time";

/**
 * v6 shots 7–8 — real completed M1 builds (repo photos: transparent cut-outs,
 * never stretched, recoloured or AI-made; only brightness changes for light).
 *  7. We start INSIDE the light of a real fan; the camera pulls back and the
 *     build appears; its fan flares and a second build crosses the
 *     foreground, the camera tracking it; as it leaves, the flagship
 *     9800X3D / RTX 5080 build waits in the dark — and lights up. REAL BUILDS.
 *     Built by M1.
 *  8. The camera moves in. GPU, RAM, STORAGE, COOLING, PSU each attach to the
 *     part of the real photo where they are; one by one they snap into the
 *     build; the lights go out — CLICK — everything comes on. BUILT. SET UP.
 *     READY. Then the camera flies into a front fan (the next shot).
 */

const BU = V.builds;
const PT = V.parts;
const CT = V.cta;

type Img = { src: string; w: number; h: number; bb: [number, number, number, number] };
const A: Img = { src: "ryzen-5-rtx-5060-ti.webp", w: 1221, h: 1280, bb: [142, 3, 1097, 1195] };
const B: Img = { src: "ryzen-5-gtx-1660-ti.webp", w: 1090, h: 1280, bb: [36, 5, 1034, 1231] };
export const HERO: Img = { src: "ryzen-7-9800x3d-rtx-5080.webp", w: 1206, h: 1724, bb: [0, 55, 1205, 1668] };
const A_FAN = { x: 258, y: 452, r: 132 };
export const HERO_FAN = { x: 962, y: 902, r: 112 };

/** place an image so that source point (sx, sy) lands at screen (x, y), at `pps` screen px per source px */
const Place: React.FC<{ im: Img; sx: number; sy: number; x: number; y: number; pps: number; brightness?: number; opacity?: number; blur?: number; saturate?: number }> = ({ im, sx, sy, x, y, pps, brightness = 1, opacity = 1, blur = 0, saturate = 1 }) => {
  const f = [`brightness(${brightness.toFixed(3)})`];
  if (saturate !== 1) f.push(`saturate(${saturate.toFixed(3)})`);
  if (blur > 0.3) f.push(`blur(${blur.toFixed(1)}px)`);
  return <Img src={staticFile(`brand/builds/${im.src}`)} style={{ position: "absolute", left: x - sx * pps, top: y - sy * pps, width: im.w * pps, height: im.h * pps, filter: f.join(" "), opacity }} />;
};
const center = (im: Img) => ({ x: (im.bb[0] + im.bb[2]) / 2, y: (im.bb[1] + im.bb[3]) / 2 });
const ppsFor = (im: Img, screenH: number) => screenH / (im.bb[3] - im.bb[1]);

/** the hero's screen placement over time (shared with the fly-into-fan) */
export function heroPlace(t: number) {
  const c = center(HERO);
  // reveal: far and dark, then a slow push as it lights
  const reveal = ease.settle(range(t, BU.c, PT.closer[0]));
  let h = lerp(760, 1140, reveal);
  let x = 540 + 14 * Math.sin((t - BU.c) * 0.9);
  let y = lerp(1010, 1000, reveal);
  // shot 8: in closer
  const closer = ease.inOutCubic(range(t, PT.closer[0], PT.closer[1]));
  h = lerp(h, 1300, closer);
  y = lerp(y, 1030, closer);
  // make room for BUILT / SET UP / READY
  const room = ease.inOutCubic(range(t, PT.click + 0.1, PT.words[0] + 0.1));
  h = lerp(h, 1060, room);
  y = lerp(y, 1190, room);
  x = lerp(x, 548, room);
  let pps = ppsFor(HERO, h);
  let sx = c.x, sy = c.y;
  // the fly into the front fan
  const fly = ease.inCubic(range(t, CT.fly[0], CT.fly[1]));
  if (fly > 0) {
    const fan = HERO_FAN;
    // move the fan to frame centre while zooming toward it
    const tx = lerp(x + (fan.x - c.x) * pps, 540, ease.inOutCubic(range(t, CT.fly[0], CT.fly[0] + 0.25)));
    const ty = lerp(y + (fan.y - c.y) * pps, 960, ease.inOutCubic(range(t, CT.fly[0], CT.fly[0] + 0.25)));
    pps = pps * Math.pow(560 / (fan.r * pps), fly);
    sx = fan.x;
    sy = fan.y;
    x = tx;
    y = ty;
  }
  return { sx, sy, x, y, pps };
}

// part labels on the real photo (source px of the 9800X3D / RTX 5080 build)
const PARTS = [
  { w: "GPU", at: { x: 560, y: 1000 }, side: -1, dy: 0 },
  { w: "RAM", at: { x: 592, y: 640 }, side: 1, dy: -40 },
  { w: "STORAGE", at: { x: 640, y: 1180 }, side: 1, dy: 30 },
  { w: "COOLING", at: { x: 430, y: 660 }, side: -1, dy: -90 },
  { w: "PSU", at: { x: 330, y: 1400 }, side: -1, dy: 40 },
];

export const PC6: React.FC<{ t: number }> = ({ t }) => {
  if (t < BU.a[0] - 0.05 || t > CT.stretch[1] + 0.05) return null;

  // ---------------------------------------------------------- build A: from inside its fan, pull back
  const aPull = ease.settle(range(t, BU.a[0], BU.a[1]));
  const aFullPps = ppsFor(A, 1080);
  const aPps = lerp((A_FAN.r > 0 ? 620 / A_FAN.r : 1), aFullPps, aPull);
  const aSrc = { x: lerp(A_FAN.x, center(A).x, aPull), y: lerp(A_FAN.y, center(A).y, aPull) };
  // B crosses: A drifts back and away (parallax), dims
  const bIn = range(t, BU.b[0], BU.b[1]);
  const aAway = ease.inOutCubic(range(t, BU.b[0], BU.b[1]));
  const aX = 540 + 30 * aPull - 380 * aAway;
  const aFlare = Math.max(0, 1 - Math.abs(t - (BU.b[0] - 0.05)) / 0.12);
  const aBright = (1 + 0.45 * aFlare) * (1 - 0.75 * aAway);
  const aOut = range(t, BU.b[1] - 0.2, BU.b[1] + 0.1);

  // ---------------------------------------------------------- build B: through the foreground, tracked, then away
  const bEnter = ease.outCubic(range(t, BU.b[0], BU.b[0] + 0.38));
  const bLeave = ease.inCubic(range(t, BU.b[0] + 0.48, BU.b[1] + 0.05));
  const bX = lerp(1700, 600, bEnter) - 1500 * bLeave;
  const bPps = ppsFor(B, 1500) * (1 + 0.08 * bIn);
  const bBlur = 10 * (1 - range(t, BU.b[0] + 0.2, BU.b[0] + 0.38)) + 14 * bLeave;

  // ---------------------------------------------------------- C: the hero
  const hp = heroPlace(t);
  const lightUp = ease.inOutCubic(range(t, BU.c + 0.05, BU.c + 0.5));
  const off = range(t, PT.off, PT.off + 0.06) * (1 - range(t, PT.click, PT.click + 0.02));
  const on = range(t, PT.click, PT.click + 0.45);
  const snaps = PT.snaps.reduce((n, s) => n + Math.max(0, 1 - Math.abs(t - s - 0.05) / 0.06), 0);
  const heroBright = (0.12 + 0.88 * lightUp) * (1 - 0.92 * off) + 0.4 * (1 - on) * (t >= PT.click ? 1 : 0) + 0.12 * Math.min(1, snaps);
  const heroSat = 1 - 0.7 * off;
  const bloom = (t >= PT.click ? Math.sin(Math.PI * on) : 0) + 0.5 * Math.max(0, 1 - Math.abs(t - (BU.c + 0.45)) / 0.3);

  // copy
  const rb = ease.settle(range(t, BU.realBuilds, BU.realBuilds + 0.32));
  const by = ease.settle(range(t, BU.builtBy, BU.builtBy + 0.35));
  const rbOut = ease.inCubic(range(t, BU.hold - 0.15, BU.hold + 0.05));
  const wordsOut = ease.inCubic(range(t, CT.fly[0] - 0.05, CT.fly[0] + 0.15));

  const Title: React.FC<{ k: number; children: React.ReactNode; color?: string; size?: number }> = ({ k, children, color, size }) => (
    <div style={{ overflow: "hidden", paddingBottom: 8 }}>
      <div style={{ transform: `translateY(${(1 - k) * 110}%)`, color, fontSize: size }}>{children}</div>
    </div>
  );

  const toScreen = (p: { x: number; y: number }) => ({ x: hp.x + (p.x - hp.sx) * hp.pps, y: hp.y + (p.y - hp.sy) * hp.pps });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", backgroundColor: t < BU.a[0] + 0.05 ? "transparent" : BRAND.bg }}>
      {/* build A */}
      {t < BU.b[1] + 0.1 && <Place im={A} sx={aSrc.x} sy={aSrc.y} x={aX} y={lerp(960, 1000, aPull)} pps={aPps * (1 - 0.12 * aAway)} brightness={aBright} opacity={(1 - aOut) * range(t, BU.a[0], BU.a[0] + 0.12)} />}

      {/* the hero waits in the dark behind */}
      {t >= BU.c - 0.3 && (
        <>
          <div style={{ position: "absolute", left: hp.x - 700 * (hp.pps / 0.7), top: hp.y + 560 * (hp.pps / 0.7) - 60, width: 1400 * (hp.pps / 0.7), height: 260 * (hp.pps / 0.7), borderRadius: "50%", background: "radial-gradient(closest-side, rgba(231,50,37,0.3), rgba(231,50,37,0))", opacity: clamp01(heroBright) * (1 - range(t, CT.fly[0], CT.fly[0] + 0.2)) }} />
          <Place im={HERO} sx={hp.sx} sy={hp.sy} x={hp.x} y={hp.y} pps={hp.pps} brightness={heroBright} saturate={heroSat} opacity={range(t, BU.c - 0.3, BU.c)} />
          {bloom > 0.01 && (
            <div style={{ position: "absolute", left: hp.x - 800, top: hp.y - 900, width: 1600, height: 1800, background: "radial-gradient(closest-side, rgba(255,60,40,0.45), rgba(231,50,37,0.12) 55%, rgba(231,50,37,0) 100%)", mixBlendMode: "screen", opacity: 0.8 * bloom }} />
          )}
        </>
      )}

      {/* build B, crossing the foreground */}
      {t >= BU.b[0] && t < BU.b[1] + 0.1 && <Place im={B} sx={center(B).x} sy={center(B).y} x={bX} y={1020} pps={bPps} brightness={1.05} blur={bBlur} />}

      {/* part labels: each sits on its real part, then snaps into the build */}
      {PARTS.map((p, i) => {
        const a = PT.labels[i];
        const s = PT.snaps[i];
        if (t < a || t > s + 0.2) return null;
        const pt = toScreen(p.at);
        const k = snap(range(t, a, a + 0.24));
        const sn = ease.inCubic(range(t, s - 0.1, s + 0.03));
        const lx = p.side < 0 ? 90 : 990;
        const ly = pt.y + p.dy;
        const tx = lerp(lx, pt.x, sn), ty = lerp(ly, pt.y, sn);
        const flash = range(t, s + 0.02, s + 0.18);
        const lineK = glide(range(t, a + 0.06, a + 0.26)) * (1 - sn);
        return (
          <React.Fragment key={p.w}>
            {/* the part, lit */}
            <div style={{ position: "absolute", left: pt.x - 90, top: pt.y - 90, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.38), rgba(255,255,255,0))", opacity: Math.sin(Math.PI * range(t, a, a + 0.5)) * 0.9 + 0.2 * (1 - sn) * range(t, a, a + 0.2) }} />
            <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <line x1={pt.x} y1={pt.y} x2={lerp(pt.x, tx + (p.side < 0 ? 10 : -10), lineK)} y2={lerp(pt.y, ty, lineK)} stroke={BRAND.yellow} strokeWidth={3} opacity={k} />
              <circle cx={pt.x} cy={pt.y} r={9 * k} fill={BRAND.yellow} />
              {flash > 0 && flash < 1 && <circle cx={pt.x} cy={pt.y} r={12 + 70 * ease.outCubic(flash)} fill="none" stroke={BRAND.yellow} strokeWidth={4} opacity={1 - flash} />}
            </svg>
            <div
              style={{
                position: "absolute",
                left: tx,
                top: ty,
                transform: `translate(${p.side < 0 ? "0%" : "-100%"}, -50%) scale(${k * (1 - 0.85 * sn)})`,
                transformOrigin: p.side < 0 ? "0% 50%" : "100% 50%",
                padding: "10px 26px",
                borderRadius: 14,
                background: "rgba(10,10,11,0.72)",
                border: "2px solid rgba(249,194,4,0.55)",
                fontFamily: FONT.display,
                fontWeight: 700,
                fontSize: 60,
                letterSpacing: 1,
                color: BRAND.white,
                opacity: 1 - range(sn, 0.7, 1),
                whiteSpace: "nowrap",
              }}
            >
              {p.w}
            </div>
          </React.Fragment>
        );
      })}

      {/* REAL BUILDS. / Built by M1. */}
      {t >= BU.realBuilds && t < BU.hold + 0.1 && (
        <div style={{ position: "absolute", left: 90, top: 250, opacity: 1 - rbOut, transform: `translateY(${-70 * rbOut}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.85)" }}>
          <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 136, letterSpacing: -3, color: BRAND.white, lineHeight: 1 }}>
            <Title k={rb}>
              REAL <span style={{ color: BRAND.yellow }}>BUILDS.</span>
            </Title>
          </div>
          <div style={{ fontFamily: "M1Serif, 'DM Serif Display', serif", fontSize: 74, color: BRAND.white, marginTop: 6, opacity: by, transform: `translateY(${(1 - by) * 24}px)` }}>Built by M1.</div>
        </div>
      )}

      {/* BUILT. SET UP. READY. — one per beat, READY lands hardest */}
      {t >= PT.words[0] && (
        <div style={{ position: "absolute", left: 90, top: 250, fontFamily: FONT.display, fontWeight: 700, fontSize: 132, lineHeight: 1.0, letterSpacing: -3, color: BRAND.white, opacity: 1 - wordsOut, transform: `translateY(${-90 * wordsOut}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
          <Title k={ease.settle(range(t, PT.words[0], PT.words[0] + 0.26))}>BUILT.</Title>
          <Title k={ease.settle(range(t, PT.words[1], PT.words[1] + 0.26))}>SET UP.</Title>
          <div style={{ transformOrigin: "0% 60%", transform: `scale(${1 + 0.08 * Math.sin(Math.PI * range(t, PT.words[2] + 0.06, PT.words[2] + 0.3))})` }}>
            <Title k={ease.settle(range(t, PT.words[2], PT.words[2] + 0.22))} color={BRAND.yellow} size={156}>
              READY.
            </Title>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 20, fontFamily: FONT.ui, fontWeight: 500, fontSize: 40, letterSpacing: 0, opacity: glide(range(t, PT.words[1] + 0.08, PT.words[1] + 0.36)) }}>
            {["Windows 11 Pro", "Drivers", "Updates"].map((s) => (
              <div key={s} style={{ border: "2px solid rgba(255,255,255,0.28)", borderRadius: 40, padding: "6px 24px", color: BRAND.white, background: "rgba(10,10,11,0.55)" }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const pcSamples6 = (t: number) => {
  if (t >= BU.a[0] && t < BU.a[0] + 0.5) return 6;
  if (t >= BU.b[0] && t < BU.b[1] + 0.05) return 10;
  if (t >= PT.snaps[0] - 0.1 && t < PT.snaps[4] + 0.05) return 4;
  if (t >= CT.fly[0] && t < CT.fly[1]) return 8;
  return 1;
};
