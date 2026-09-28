import React from "react";
import { AbsoluteFill } from "remotion";

/** A soft, static vignette — cheap, deterministic "depth" cue that never
 * touches anything the viewer needs to read (it only darkens the extreme
 * edges of a 9:16 frame). */
export function Vignette() {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background:
          "radial-gradient(120% 85% at 50% 46%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)," +
          "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 12%, rgba(0,0,0,0) 85%, rgba(0,0,0,0.4) 100%)",
      }}
    />
  );
}
