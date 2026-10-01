import React from "react";
import { Img, staticFile } from "remotion";

/**
 * The M1 emblem as ONE physical surface: a wall (black or red) carrying the
 * REAL logo artwork, with the emblem's own V-shaped negative space cut out of
 * it. Measured from the logo's alpha, that negative space is a triangle to
 * within 0.03 % of its area — corners (795,577), (3714,577), apex (2258,1573)
 * in source px — bounded by the two arm strokes. It is drawn as exact vector
 * geometry (no bitmap masks, no circles/ellipses), and the camera flies
 * through it. Whatever sits behind the surface is seen only through that V.
 */

export const SRC = { w: 4500, h: 5625 };
/** displayed logo scale at Z = 1 (logo content 860 px wide) */
export const S = 860 / 3703;
/** the point the camera flies through: inside the V, verified clear of all strokes from Z ≈ 13× */
export const TARGET = { x: 2258, y: 1000 };
const V_SRC = [
  { x: 795 - 14, y: 577 - 14 },
  { x: 3714 + 14, y: 577 - 14 },
  { x: 2258, y: 1573 + 16 },
];
const SEAM_X = 2258;
const EMBLEM_BOTTOM = 3110;
const WM1 = [3542, 4257]; // "M 1"
const WM2 = [4666, 5053]; // "GAMING PCS"

export type PlaneState = {
  /** screen position of TARGET */
  px: number;
  py: number;
  /** camera zoom on the plane */
  z: number;
  /** the wall colour (CSS paint) */
  wall: string;
  /** 0 = V not cut yet (solid wall), 1 = open */
  hole?: number;
  /** emblem halves: 0 = apart, 1 = locked */
  halves?: number;
  /** wordmark rows revealed 0..1 each */
  wm1?: number;
  wm2?: number;
  /** 0..1 light running down the seam at the lock */
  seam?: number;
  /** draw only the emblem (no wordmark) */
  emblemOnly?: boolean;
  /** opacity of the artwork on the wall */
  artOpacity?: number;
};

const src = staticFile("brand/logo.png");

export const toScreenPlane = (st: PlaneState, x: number, y: number) => ({
  x: st.px + (x - TARGET.x) * S * st.z,
  y: st.py + (y - TARGET.y) * S * st.z,
});

export const EmblemPlane: React.FC<{ st: PlaneState }> = ({ st }) => {
  const { z, hole = 1, halves = 1, wm1 = 1, wm2 = 1, seam = 0, emblemOnly = false, artOpacity = 1 } = st;
  const v = V_SRC.map((p) => toScreenPlane(st, p.x, p.y));
  const big = 1e6;
  const wallPath = `M${-big},${-big} H${big} V${big} H${-big} Z M${v[0].x},${v[0].y} L${v[2].x},${v[2].y} L${v[1].x},${v[1].y} Z`;
  const tri = `M${v[0].x},${v[0].y} L${v[1].x},${v[1].y} L${v[2].x},${v[2].y} Z`;

  // logo box placement (pre-zoom), zoomed about TARGET
  const boxW = SRC.w * S;
  const boxH = SRC.h * S;
  const left = st.px - TARGET.x * S;
  const top = st.py - TARGET.y * S;
  const pct = (y: number) => (y / SRC.h) * 100;
  const xpct = (x: number) => (x / SRC.w) * 100;

  // expo-out: arrives fast, locks precisely (no bounce)
  const ease = halves >= 1 ? 1 : 1 - Math.pow(2, -10 * halves);
  const off = (1 - ease) * 240; // px (logo space, pre-zoom)
  const yaw = (1 - ease) * 58; // degrees

  const half = (side: -1 | 1) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        clipPath:
          side < 0
            ? `inset(0 ${100 - xpct(SEAM_X) - 0.05}% ${100 - pct(EMBLEM_BOTTOM)}% 0)`
            : `inset(0 0 ${100 - pct(EMBLEM_BOTTOM)}% ${xpct(SEAM_X) - 0.05}%)`,
        transformOrigin: `${xpct(SEAM_X)}% 40%`,
        transform: `perspective(1400px) translateX(${side * off}px) rotateY(${-side * yaw}deg)`,
        opacity: Math.min(1, halves * 3),
      }}
    >
      <Img src={src} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );

  const line = (rows: number[], k: number, rise: number) =>
    k > 0 && (
      <div
        style={{
          position: "absolute",
          inset: 0,
          // revealed bottom-up inside its own row band, rising into place
          clipPath: `inset(${pct(rows[0] - 30) + (1 - k) * (pct(rows[1]) - pct(rows[0]))}% 0 ${100 - pct(rows[1] + 30)}% 0)`,
          transform: `translateY(${(1 - k) * rise}px)`,
        }}
      >
        <Img src={src} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    );

  return (
    <>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <path d={wallPath} fill={st.wall} fillRule="evenodd" />
        {hole < 1 && <path d={tri} fill={st.wall} opacity={1 - hole} />}
      </svg>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: boxW,
          height: boxH,
          transformOrigin: `${TARGET.x * S}px ${TARGET.y * S}px`,
          transform: `scale(${z})`,
          opacity: artOpacity,
        }}
      >
        {half(-1)}
        {half(1)}
        {!emblemOnly && line(WM1, wm1, 26)}
        {!emblemOnly && line(WM2, wm2, 20)}
        {seam > 0 && seam < 1 && (
          // a thin line of light travelling down the seam where the halves locked
          <div
            style={{
              position: "absolute",
              inset: 0,
              WebkitMaskImage: `url(${src})`,
              WebkitMaskSize: "100% 100%",
              clipPath: `inset(0 ${100 - xpct(SEAM_X + 70)}% 0 ${xpct(SEAM_X - 70)}%)`,
              background: `linear-gradient(180deg, rgba(255,240,228,0) ${pct(576) + seam * (pct(EMBLEM_BOTTOM) - pct(576)) - 7}%, rgba(255,240,228,0.85) ${pct(576) + seam * (pct(EMBLEM_BOTTOM) - pct(576))}%, rgba(255,240,228,0) ${pct(576) + seam * (pct(EMBLEM_BOTTOM) - pct(576)) + 1.5}%)`,
              opacity: Math.sin(Math.PI * seam) * 0.8,
            }}
          />
        )}
      </div>
    </>
  );
};
