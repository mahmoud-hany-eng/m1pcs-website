import React from "react";
import { Img, staticFile } from "remotion";
import { clamp01, ease, bezier, lerp, rand, range } from "../lib/ease";
import WM from "../data/wordmark-blocks.json";

/**
 * Shot 1 — the REAL M1 logo (public/logo.png, untouched) assembling itself.
 *  · red emblem: 16 horizontal slices of the actual artwork slide in from
 *    alternating sides, centre rows first, and snap home with a brief
 *    electrical flare
 *  · yellow wordmark: resolves through a grid of pixel blocks (only blocks
 *    that actually contain wordmark pixels — derived from the logo's alpha)
 *  · a red light streak and, once assembled, one specular sweep
 * The whole group is then pushed into the emblem's V-notch by the parent.
 */

// Logo source is 4500×5625; displayed 640 px wide.
export const LOGO = {
  w: 640,
  h: 800,
  left: 220,
  top: 499.6,
  srcW: 4500,
  srcH: 5625,
};
const S = LOGO.w / LOGO.srcW;
// Emblem rows (source px) and the V-notch the camera flies into.
const EMBLEM_Y0 = 576;
const EMBLEM_Y1 = 3106;
// Fly-through target: high in the V-notch. Verified numerically against the
// logo's alpha: with this point drifting to frame centre, every opaque pixel
// is outside the 1080×1920 frame from zoom ≈ 14× (we end at 40× so the
// strokes rush out of frame well before the downbeat).
export const NOTCH = { x: LOGO.left + 2258 * S, y: LOGO.top + 900 * S };
export const NOTCH_CLEAR_ZOOM = 40;

const SLICES = 16;
const snapEase = bezier(0.16, 0.9, 0.2, 1.05);
const src = staticFile("brand/logo.png");

export const LogoReveal: React.FC<{ t: number }> = ({ t }) => {
  const sliceH = (EMBLEM_Y1 - EMBLEM_Y0) / SLICES;
  const order = Array.from({ length: SLICES }, (_, i) => i).sort(
    (a, b) => Math.abs(a - (SLICES - 1) / 2) - Math.abs(b - (SLICES - 1) / 2)
  );
  const rank = new Map(order.map((i, k) => [i, k]));

  // ---- wordmark blocks
  const B = WM.block;
  const blockTime = (c: number, r: number) => 0.3 + 0.3 * (c / WM.cols) + 0.1 * rand(c * 31 + r * 7);
  const revealed: [number, number][] = [];
  const flashing: [number, number][] = [];
  for (const [c, r] of WM.blocks as [number, number, number][]) {
    const bt = blockTime(c, r);
    if (t >= bt) revealed.push([c, r]);
    if (t >= bt - 1.5 / 60 && t < bt + 2.5 / 60) flashing.push([c, r]);
  }

  // ---- lead "pixel" particles that dart into the wordmark ahead of it
  const particles = Array.from({ length: 9 }, (_, i) => {
    const target = (WM.blocks as [number, number, number][])[Math.floor(rand(i * 13 + 5) * WM.blocks.length)];
    const [c, r] = target;
    const end = blockTime(c, r);
    const start = 0.2 + 0.06 * rand(i * 3 + 1);
    const sx = lerp(-60, LOGO.w + 60, rand(i * 7 + 2));
    const sy = WM.y + lerp(-140, 260, rand(i * 11 + 3));
    // quantised to every 3rd frame: reads as digital, not floaty
    const tq = Math.floor(t * 20) / 20;
    const k = ease.inOutCubic(range(tq, start, end));
    return {
      x: lerp(sx, WM.x + c * B, k),
      y: lerp(sy, WM.y + r * B, k),
      on: t >= start && t < end,
      size: rand(i * 17) > 0.5 ? B : B * 0.6,
    };
  });

  // ---- red streak across the emblem
  const streakK = range(t, 0.12, 0.52);
  const streakX = lerp(-420, 1080 + 420, ease.swift(streakK));
  const streakA = Math.sin(Math.PI * streakK);

  // ---- specular sweep once assembled
  const sweepK = range(t, 0.8, 1.08);


  return (
    <>
      {/* streak (behind the logo, so the artwork occludes it) */}
      {streakA > 0.001 && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 760,
              width: 1080,
              height: 1,
              opacity: 0.35 * streakA,
              background: "linear-gradient(90deg, transparent, rgba(255,70,50,0.9) 50%, transparent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: streakX - 210,
              top: 759,
              width: 420,
              height: 3,
              opacity: streakA,
              borderRadius: 2,
              background:
                "linear-gradient(90deg, rgba(255,60,40,0) 0%, rgba(255,60,40,0.9) 35%, #fff4ec 50%, rgba(255,60,40,0.9) 65%, rgba(255,60,40,0) 100%)",
              boxShadow: "0 0 22px 5px rgba(255,64,40,0.55)",
            }}
          />
        </>
      )}

      {/* emblem slices */}
      {Array.from({ length: SLICES }, (_, i) => {
        const st = 0.12 + (rank.get(i) ?? 0) * 0.021;
        const p = snapEase(range(t, st, st + 0.3));
        const side = i % 2 === 0 ? -1 : 1;
        const off = side * (300 + 120 * rand(i + 40));
        const y0 = EMBLEM_Y0 + i * sliceH;
        const y1 = y0 + sliceH + 2; // 2px overlap so no hairline gaps
        const land = st + 0.16;
        const flare = t > land ? 1 - clamp01((t - land) / 0.14) : 0;
        const op = range(t, st, st + 0.05);
        if (op <= 0) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: LOGO.left + off * (1 - p),
              top: LOGO.top,
              width: LOGO.w,
              height: LOGO.h,
              opacity: op,
              clipPath: `inset(${(y0 / LOGO.srcH) * 100}% 0 ${(1 - y1 / LOGO.srcH) * 100}% 0)`,
              filter: flare > 0.01 ? `brightness(${1 + 0.9 * flare})` : undefined,
            }}
          >
            <Img src={src} style={{ width: LOGO.w, height: LOGO.h, display: "block" }} />
          </div>
        );
      })}

      {/* wordmark through pixel blocks */}
      <svg
        style={{ position: "absolute", left: LOGO.left, top: LOGO.top, overflow: "visible" }}
        width={LOGO.w}
        height={LOGO.h}
        viewBox={`0 0 ${LOGO.w} ${LOGO.h}`}
      >
        <defs>
          <clipPath id="wm-revealed">
            {revealed.map(([c, r]) => (
              <rect key={`${c}-${r}`} x={WM.x + c * B - 0.3} y={WM.y + r * B - 0.3} width={B + 0.6} height={B + 0.6} />
            ))}
          </clipPath>
        </defs>
        <image
          href={src}
          x={0}
          y={0}
          width={LOGO.w}
          height={LOGO.h}
          clipPath="url(#wm-revealed)"
          preserveAspectRatio="none"
        />
        {flashing.map(([c, r]) => (
          <rect key={`f${c}-${r}`} x={WM.x + c * B} y={WM.y + r * B} width={B - 1} height={B - 1} fill="#ffe27a" />
        ))}
        {particles.map(
          (p, i) => p.on && <rect key={`p${i}`} x={p.x} y={p.y} width={p.size} height={p.size} fill="#f9c204" />
        )}
      </svg>

      {/* specular sweep, masked to the logo's own alpha */}
      {sweepK > 0 && sweepK < 1 && (
        <div
          style={{
            position: "absolute",
            left: LOGO.left,
            top: LOGO.top,
            width: LOGO.w,
            height: LOGO.h,
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            background: `linear-gradient(112deg, rgba(255,255,255,0) ${lerp(-40, 100, ease.inOutCubic(sweepK))}%, rgba(255,246,236,0.85) ${lerp(-32, 108, ease.inOutCubic(sweepK))}%, rgba(255,255,255,0) ${lerp(-24, 116, ease.inOutCubic(sweepK))}%)`,
          }}
        />
      )}
    </>
  );
};

/** Warm light behind the emblem — rendered in screen space by the parent. */
export const LogoGlow: React.FC<{ t: number; fade?: number }> = ({ t, fade = 0 }) => {
  const sweepK = range(t, 0.8, 1.08);
  const glow = (0.28 * ease.outCubic(range(t, 0.3, 0.8)) + 0.1 * Math.sin(Math.PI * sweepK)) * (1 - fade);
  if (glow <= 0.002) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 540 - 520,
        top: 740 - 520,
        width: 1040,
        height: 1040,
        borderRadius: "50%",
        background: `radial-gradient(closest-side, rgba(231,50,37,${glow}) 0%, rgba(157,46,22,${glow * 0.45}) 45%, rgba(0,0,0,0) 100%)`,
      }}
    />
  );
};
