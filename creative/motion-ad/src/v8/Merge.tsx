import React from "react";
import { Img, staticFile } from "remotion";
import { clamp01, rand, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { LOGO_SRC, SEAM } from "../v7/geom";

/**
 * The two halves of the real M1 emblem striking each other — shared by the
 * opening and the closing signature.
 *
 * Motion (per half, mirrored so the distance from centre is symmetric):
 *  - the halves establish a short distance apart (close enough that the move
 *    reads instantly), each with a slight outward tilt;
 *  - ONE cubic Hermite from rest to contact: one acceleration, then a
 *    deceleration that still carries ~55% of the average speed into the hit —
 *    purposeful, never slow-motion, no second acceleration, no pause;
 *  - contact: the halves stop dead in exact alignment on the clash frame (the
 *    impact), hidden in the spark and a 2-frame camera jolt — no rebound, no
 *    correction afterwards. The tilt resolves on the same curve.
 */

export const END_SLOPE = 0.55; // speed at contact, relative to the average speed of the move
/** 0 → 1 over u: Hermite with f'(0)=0, f'(1)=END_SLOPE */
export const mergeCurve = (u: number) => {
  const x = clamp01(u);
  return (END_SLOPE - 2) * x * x * x + (3 - END_SLOPE) * x * x;
};

export type HalfPose = { dx: number; dy: number; rot: number; f: number };
/**
 * Per-half pose at time t. dx: distance of each half from its final position
 * (positive = apart). rot: outward tilt (deg). (floatFrom is kept for the call sites; there is no float.)
 */
export function halfPose(t: number, _floatFrom: number, m0: number, contact: number, D0: number, tilt = 2.4): HalfPose {
  const f = t >= contact ? 1 : mergeCurve(range(t, m0, contact));
  return { dx: D0 * (1 - f), dy: 0, rot: tilt * (1 - f), f };
}
/** no compression any more (the hit is a clean stop) — reported by the QA */
export const compressionPx = (_D0: number, _T: number) => 0;
export const settledAt = (contact: number) => contact;

/** a 1–2 frame camera impulse at contact (px) */
export const impulse = (t: number, at: number) => {
  const d = t - at;
  if (d < 0 || d >= 2 / 60) return 0;
  return d < 1 / 60 ? 2 : 1;
};

const pct = (y: number) => (y / LOGO_SRC.h) * 100;
const SEAM_PCT = (SEAM / LOGO_SRC.w) * 100;
const EMB_BOTTOM = 3150;

/**
 * The real logo's emblem, as two halves split at its seam (the source art,
 * never redrawn). Both halves are positioned in frame px; once settled the
 * single full emblem takes over so no seam line can show.
 */
export const EmblemHalves: React.FC<{ left: number; top: number; width: number; pose: HalfPose; whole: boolean; opacity?: number; filter?: string }> = ({ left, top, width, pose, whole, opacity = 1, filter }) => {
  const h = (LOGO_SRC.h * width) / LOGO_SRC.w;
  const seamX = left + (SEAM / LOGO_SRC.w) * width;
  const pivotY = top + (2300 / LOGO_SRC.h) * h; // turn about the inner edge, mid-height
  const img = <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />;
  const box: React.CSSProperties = { position: "absolute", left, top, width, height: h, opacity, filter };
  if (whole) return <div style={{ ...box, clipPath: `inset(0 0 ${100 - pct(EMB_BOTTOM)}% 0)` }}>{img}</div>;
  return (
    <>
      {([-1, 1] as const).map((side) => (
        <div
          key={side}
          style={{
            ...box,
            transformOrigin: `${seamX - left}px ${pivotY - top}px`,
            transform: `translate(${(side * pose.dx).toFixed(3)}px, ${pose.dy.toFixed(3)}px) rotate(${(-side * pose.rot).toFixed(3)}deg)`,
            clipPath: side < 0 ? `inset(0 ${100 - SEAM_PCT}% ${100 - pct(EMB_BOTTOM)}% 0)` : `inset(0 0 ${100 - pct(EMB_BOTTOM)}% ${SEAM_PCT}%)`,
          }}
        >
          {img}
        </div>
      ))}
    </>
  );
};

type Spark = { a: number; v: number; life: number; trail: number; w: number };
const sparks = (n: number, seed: number): Spark[] =>
  Array.from({ length: n }, (_, i) => {
    // fan out from the seam: mostly sideways/up, a few down — the clash throws them off both blades
    const side = i % 2 ? 1 : -1;
    const base = side > 0 ? 0 : Math.PI;
    const spread = (rand(seed + i * 7.1) - 0.62) * 1.5; // biased upward
    const a = base + side * spread;
    return { a, v: 950 + 800 * rand(seed + i * 3.3), life: 0.13 + 0.13 * rand(seed + i * 5.7), trail: i === 2 || i === 5 ? 0.05 : 0.022, w: 3.2 + 2.2 * rand(seed + i * 9.9) };
  });
const SPARKS_A = sparks(9, 11);
const SPARKS_B = sparks(8, 47);
const sparkCol = (k: number) => {
  // white-hot → M1 yellow → orange → red
  const stops: [number, number[]][] = [[0, [255, 252, 240]], [0.18, [255, 226, 110]], [0.45, [249, 194, 4]], [0.72, [244, 120, 30]], [1, [231, 50, 37]]];
  let i = 0;
  while (i < stops.length - 2 && k > stops[i + 1][0]) i++;
  const [k0, c0] = stops[i], [k1, c1] = stops[i + 1];
  const u = clamp01((k - k0) / (k1 - k0));
  return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * u)).join(",")})`;
};

/**
 * The sword-clash spark at the exact contact frame: a white-hot flash, an
 * M1-yellow core, 9 (closing: 8) sparks with a couple of brief trails, a
 * short cross / star glint. Strongest for ~0.1 s, gone by 0.3 s; a local
 * bloom only (never a full-frame white-out).
 */
export const ClashSpark: React.FC<{ t: number; at: number; x: number; y: number; refined?: boolean; scale?: number }> = ({ t, at, x, y, refined = false, scale = 1 }) => {
  const tau = t - at;
  if (tau < 0 || tau > 0.3) return null;
  const S = 460;
  const flash = tau < 1 / 60 ? 1 : Math.exp(-(tau - 1 / 60) / 0.028);
  const core = Math.exp(-tau / (refined ? 0.055 : 0.065));
  const bloom = Math.exp(-tau / 0.08);
  const glintK = tau < 0.02 ? tau / 0.02 : Math.exp(-(tau - 0.02) / 0.04);
  const list = refined ? SPARKS_B : SPARKS_A;
  const pos = (s: Spark, u: number) => {
    const k = 7; // drag
    const d = (s.v * (1 - Math.exp(-k * u))) / k;
    return { x: Math.cos(s.a) * d, y: -Math.sin(s.a) * d + 0.5 * 950 * u * u };
  };
  return (
    <svg width={S * 2} height={S * 2} viewBox={`${-S} ${-S} ${2 * S} ${2 * S}`} style={{ position: "absolute", left: x - S, top: y - S, overflow: "visible", mixBlendMode: "screen", transform: `scale(${scale})`, transformOrigin: "50% 50%" }}>
      <defs>
        <radialGradient id={`clashBloom${refined ? 1 : 0}`}>
          <stop offset="0%" stopColor="rgb(255,214,90)" stopOpacity={0.55} />
          <stop offset="45%" stopColor="rgb(240,110,40)" stopOpacity={0.16} />
          <stop offset="100%" stopColor="rgb(231,50,37)" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`clashCore${refined ? 1 : 0}`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
          <stop offset="35%" stopColor="#fff3c4" stopOpacity={0.95} />
          <stop offset="65%" stopColor={BRAND.yellow} stopOpacity={0.65} />
          <stop offset="100%" stopColor={BRAND.yellow} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`glintH${refined ? 1 : 0}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={1} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`glintV${refined ? 1 : 0}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={1} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <circle r={refined ? 190 : 230} fill={`url(#clashBloom${refined ? 1 : 0})`} opacity={0.85 * bloom} />
      <circle r={(refined ? 50 : 62) * (0.85 + 0.3 * (1 - core))} fill={`url(#clashCore${refined ? 1 : 0})`} opacity={core} />
      <circle r={refined ? 13 : 16} fill="#fff" opacity={flash} />
      {/* the cross / star glint */}
      <g transform={`rotate(${refined ? -8 : 12})`} opacity={glintK}>
        <rect x={-(refined ? 230 : 280) * (0.6 + 0.4 * glintK)} y={-1.6} width={2 * (refined ? 230 : 280) * (0.6 + 0.4 * glintK)} height={3.2} fill={`url(#glintH${refined ? 1 : 0})`} />
        <rect x={-1.4} y={-(refined ? 120 : 150) * (0.6 + 0.4 * glintK)} width={2.8} height={2 * (refined ? 120 : 150) * (0.6 + 0.4 * glintK)} fill={`url(#glintV${refined ? 1 : 0})`} />
        <g transform="rotate(45)" opacity={0.55}>
          <rect x={-70 * glintK} y={-1} width={140 * glintK} height={2} fill={`url(#glintH${refined ? 1 : 0})`} />
        </g>
        <g transform="rotate(-45)" opacity={0.55}>
          <rect x={-70 * glintK} y={-1} width={140 * glintK} height={2} fill={`url(#glintH${refined ? 1 : 0})`} />
        </g>
      </g>
      {/* sparks */}
      {list.map((s, i) => {
        if (tau > s.life) return null;
        const k = tau / s.life;
        const p = pos(s, tau), q = pos(s, Math.max(0, tau - s.trail));
        const o = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        return <line key={i} x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke={sparkCol(k)} strokeWidth={s.w * (1 - 0.5 * k)} strokeLinecap="round" opacity={o} />;
      })}
    </svg>
  );
};
