import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide } from "../final/shared";
import { FONT } from "../final/fonts";
import { V } from "./time";
import { HERO13, place } from "./Gallery8";
import { Line, arrive } from "./Kinetic";

/**
 * The final hero — the newest build, M1's 9800X3D / RTX 5080 flagship
 * (real photo). It is handed over from the gallery exactly where the gallery
 * left it. "Then M1 takes care of the rest": a slow push; the background is
 * gone. BUILT. — GPU, RAM, STORAGE, COOLING, PSU attach to the real parts and
 * click in. SET UP. — the setup chips. "…ready to use": the RGB drops out, the
 * room goes quiet, CLICK — it all comes on: READY. Then the glow hands back to
 * the workstation (the site's CTA shows this same build).
 */

const GA = V.gallery;
const PT = V.parts;
const RT = V.ret;
export const HERO = { src: HERO13.src, w: HERO13.w, h: HERO13.h, bb: HERO13.bb };

/** the hero's screen placement over time */
export function heroPlace(t: number) {
  const g = place(HERO13, GA.end);
  const h0 = (HERO.bb[3] - HERO.bb[1]) * g.pps;
  const push = ease.inOutCubic(range(t, GA.end - 0.1, PT.closer[0]));
  let h = lerp(h0, h0 * 1.1, push);
  let y = g.y;
  let x = g.x + 10 * Math.sin((t - GA.end) * 0.8) * push;
  // make room above for BUILT. / SET UP. / READY.
  const room = ease.inOutCubic(range(t, PT.closer[0], PT.closer[1]));
  h = lerp(h, 980, room);
  y = lerp(y, 1262, room);
  x = lerp(x, 548, room);
  const pps = h / (HERO.bb[3] - HERO.bb[1]);
  return { sx: (HERO.bb[0] + HERO.bb[2]) / 2, sy: (HERO.bb[1] + HERO.bb[3]) / 2, x, y, pps };
}

const PARTS = [
  { w: "GPU", at: { x: 560, y: 1000 }, side: -1, dy: 0 },
  { w: "RAM", at: { x: 592, y: 640 }, side: 1, dy: -40 },
  { w: "STORAGE", at: { x: 640, y: 1180 }, side: 1, dy: 30 },
  { w: "COOLING", at: { x: 430, y: 660 }, side: -1, dy: -90 },
  { w: "PSU", at: { x: 330, y: 1400 }, side: -1, dy: 40 },
];

export const PC8: React.FC<{ t: number; vo: boolean }> = ({ t }) => {
  if (t < GA.end - 0.02 || t > RT.glow[1] + 0.05) return null;
  const handOff = ease.inOutCubic(range(t, RT.glow[0], RT.glow[1]));
  const hp = heroPlace(t);
  const off = range(t, PT.off, PT.off + 0.08) * (1 - range(t, PT.click, PT.click + 0.02));
  const on = range(t, PT.click, PT.click + 0.45);
  const snaps = PT.snaps.reduce((n, s) => n + Math.max(0, 1 - Math.abs(t - s - 0.05) / 0.06), 0);
  const settleLit = range(t, GA.end - 0.3, GA.end + 0.4);
  const bright = lerp(1.08, 1.0, settleLit) * (1 - 0.93 * off) + 0.42 * (1 - on) * (t >= PT.click ? 1 : 0) + 0.12 * Math.min(1, snaps);
  const sat = 1 - 0.75 * off;
  const bloom = t >= PT.click ? Math.sin(Math.PI * on) : 0;
  const wordsOut = ease.inCubic(range(t, RT.glow[0] - 0.2, RT.glow[0] + 0.1));
  const toScreen = (p: { x: number; y: number }) => ({ x: hp.x + (p.x - hp.sx) * hp.pps, y: hp.y + (p.y - hp.sy) * hp.pps });
  const chipsK = (i: number) => glide(range(t, PT.setupChips[i], PT.setupChips[i] + 0.3));

  return (
    <AbsoluteFill style={{ pointerEvents: "none", backgroundColor: `rgba(4,4,5,${(t < GA.end + 0.3 ? range(t, GA.end - 0.02, GA.end + 0.3) : 1) * (1 - handOff)})` }}>
      {/* floor light */}
      <div style={{ position: "absolute", left: hp.x - 700 * (hp.pps / 0.6), top: hp.y + 480 * (hp.pps / 0.6), width: 1400 * (hp.pps / 0.6), height: 240 * (hp.pps / 0.6), borderRadius: "50%", background: "radial-gradient(closest-side, rgba(231,50,37,0.32), rgba(231,50,37,0))", opacity: clamp01(bright) * (1 - handOff) }} />
      <Img src={staticFile(`brand/builds/${HERO.src}`)} style={{ position: "absolute", left: hp.x - hp.sx * hp.pps, top: hp.y - hp.sy * hp.pps, width: HERO.w * hp.pps, height: HERO.h * hp.pps, filter: `brightness(${bright.toFixed(3)}) saturate(${sat.toFixed(3)})`, opacity: 1 - handOff }} />
      {bloom > 0.01 && <div style={{ position: "absolute", left: hp.x - 800, top: hp.y - 900, width: 1600, height: 1800, background: "radial-gradient(closest-side, rgba(255,60,40,0.45), rgba(231,50,37,0.12) 55%, rgba(231,50,37,0) 100%)", mixBlendMode: "screen", opacity: 0.8 * bloom }} />}

      {/* part labels: each sits on its real part, then snaps into the build */}
      {PARTS.map((p, i) => {
        const a = PT.labels[i];
        const s = PT.snaps[i];
        if (t < a || t > s + 0.2) return null;
        const pt = toScreen(p.at);
        const k = arrive(range(t, a, a + 0.32));
        const sn = ease.inCubic(range(t, s - 0.1, s + 0.03));
        const lx = p.side < 0 ? 70 : 1010;
        const ly = pt.y + p.dy;
        const tx = lerp(lx, pt.x, sn), ty = lerp(ly, pt.y, sn);
        const flash = range(t, s + 0.02, s + 0.18);
        const lineK = glide(range(t, a + 0.06, a + 0.26)) * (1 - sn);
        return (
          <React.Fragment key={p.w}>
            <div style={{ position: "absolute", left: pt.x - 90, top: pt.y - 90, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.38), rgba(255,255,255,0))", opacity: Math.sin(Math.PI * range(t, a, a + 0.5)) * 0.9 + 0.2 * (1 - sn) * range(t, a, a + 0.2) }} />
            <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <line x1={pt.x} y1={pt.y} x2={lerp(pt.x, tx + (p.side < 0 ? 10 : -10), lineK)} y2={lerp(pt.y, ty, lineK)} stroke={BRAND.yellow} strokeWidth={3} opacity={k} />
              <circle cx={pt.x} cy={pt.y} r={9 * k} fill={BRAND.yellow} />
              {flash > 0 && flash < 1 && <circle cx={pt.x} cy={pt.y} r={12 + 70 * ease.outCubic(flash)} fill="none" stroke={BRAND.yellow} strokeWidth={4} opacity={1 - flash} />}
            </svg>
            <div style={{ position: "absolute", left: tx, top: ty, transform: `translate(${p.side < 0 ? "0%" : "-100%"}, -50%) scale(${k * (1 - 0.85 * sn)})`, transformOrigin: p.side < 0 ? "0% 50%" : "100% 50%", padding: "8px 22px", borderRadius: 14, background: "rgba(10,10,11,0.72)", border: "2px solid rgba(249,194,4,0.55)", fontFamily: FONT.display, fontWeight: 700, fontSize: 50, color: BRAND.white, opacity: 1 - range(sn, 0.7, 1), whiteSpace: "nowrap" }}>
              {p.w}
            </div>
          </React.Fragment>
        );
      })}

      {/* BUILT. / SET UP. / READY. — one per spoken line */}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - wordsOut, transform: `translateY(${-80 * wordsOut}px)` }}>
        <Line t={t} x={86} y={260} size={132} words={[{ w: "BUILT.", at: PT.built, gap: 0 }]} />
        <Line t={t} x={86} y={392} size={132} words={[{ w: "SET UP.", at: PT.setup, gap: 0 }]} />
        <div style={{ position: "absolute", left: 0, top: 0 }}>
          <Line t={t} x={86} y={524} size={160} enterDur={0.36} words={[{ w: "READY.", at: PT.ready, color: BRAND.yellow, gap: 0 }]} style={{ textShadow: `0 0 ${40 * Math.sin(Math.PI * range(t, PT.ready, PT.ready + 0.6))}px rgba(249,194,4,0.55), 0 6px 36px rgba(0,0,0,0.85)` }} />
        </div>
        <div style={{ position: "absolute", left: 660, top: 404, display: "flex", flexDirection: "column", gap: 10, fontFamily: FONT.ui, fontWeight: 500, fontSize: 34 }}>
          {["Windows 11 Pro", "Drivers", "Updates"].map((s, i) => (
            <div key={s} style={{ alignSelf: "flex-start", border: "2px solid rgba(255,255,255,0.28)", borderRadius: 40, padding: "4px 20px", color: BRAND.white, background: "rgba(10,10,11,0.6)", opacity: chipsK(i), transform: `translateX(${(1 - chipsK(i)) * 30}px)` }}>
              {s}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const pcSamples8 = (t: number) => {
  if (t >= PT.snaps[0] - 0.1 && t < PT.snaps[4] + 0.05) return 4;
  return 1;
};
export { HERO13 };
