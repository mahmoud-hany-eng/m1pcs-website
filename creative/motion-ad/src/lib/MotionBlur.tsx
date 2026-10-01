import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame } from "remotion";

/**
 * Camera motion blur with a CENTRED shutter and a per-frame sample count:
 * the scene is rendered `samples` times at sub-frame times spread across
 * the shutter interval and averaged (plus-lighter, 1/n opacity each) — the
 * same maths as a film shutter. `samplesAt(frame)` lets static stretches
 * render once while fast moves get full blur.
 */
export const MotionBlur: React.FC<{
  children: React.ReactNode;
  shutter?: number; // fraction of a frame (0.5 = 180°)
  samplesAt: (frame: number) => number;
}> = ({ children, shutter = 0.5, samplesAt }) => {
  const frame = useCurrentFrame();
  const n = Math.max(1, Math.round(samplesAt(frame)));
  if (n === 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ isolation: "isolate", backgroundColor: "#000" }}>
      {new Array(n).fill(0).map((_, i) => {
        const offset = shutter * ((i + 0.5) / n - 0.5);
        return (
          <AbsoluteFill key={i} style={{ mixBlendMode: "plus-lighter", filter: `opacity(${1 / n})` }}>
            <Freeze frame={Math.max(0, frame + offset)}>{children}</Freeze>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
