import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

/** Camera on a 432×768 page capture: page point (cx,cy) at frame centre, zoom s (1 = fills 1080×1920). */
export type Cam = { cx: number; cy: number; s: number };
export const VW = 432;
export const VH = 768;
export const K = 1080 / VW;
export const C = { x: 540, y: 960 };

export const clampCam = (c: Cam): Cam => {
  const hw = VW / 2 / c.s;
  const hh = VH / 2 / c.s;
  return { s: c.s, cx: Math.min(VW - hw, Math.max(hw, c.cx)), cy: Math.min(VH - hh, Math.max(hh, c.cy)) };
};

export const toScreen = (px: number, py: number, cam: Cam) => ({
  x: C.x + (px - cam.cx) * K * cam.s,
  y: C.y + (py - cam.cy) * K * cam.s,
});

/**
 * One frame of a real website capture under a camera. `vBlur` adds a
 * vertical-only blur (screen px) for real scroll, `brightness` is depth fog.
 */
export const SiteFrame: React.FC<{
  dir: string;
  index: number;
  cam: Cam;
  vBlur?: number;
  brightness?: number;
  style?: React.CSSProperties;
}> = ({ dir, index, cam, vBlur = 0, brightness = 1, style }) => {
  const left = C.x - cam.cx * K * cam.s;
  const top = C.y - cam.cy * K * cam.s;
  const fid = `vb-${dir}-${Math.round(vBlur * 10)}`;
  const filters: string[] = [];
  if (vBlur > 0.6) filters.push(`url(#${fid})`);
  if (brightness < 0.999) filters.push(`brightness(${brightness})`);
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      {vBlur > 0.6 && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={fid} x="0" y="-5%" width="100%" height="110%">
            <feGaussianBlur stdDeviation={`0 ${vBlur}`} />
          </filter>
        </svg>
      )}
      <Img
        src={staticFile(`cap/${dir}/f${String(index).padStart(5, "0")}.png`)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
          transformOrigin: "0 0",
          transform: `translate(${left}px, ${top}px) scale(${cam.s})`,
          filter: filters.length ? filters.join(" ") : undefined,
        }}
      />
    </AbsoluteFill>
  );
};
