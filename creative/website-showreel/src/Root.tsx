import React from "react";
import { Composition } from "remotion";
import { Showreel } from "./scenes/Showreel";
import { FPS, WIDTH, HEIGHT, MASTER_FRAMES, CUTDOWN_FRAMES, PREVIS_FRAMES } from "./constants";

export const Root: React.FC = () => {
  return (
    <>
      {/* 7s proof: Scene 1 (enter) + Scene 2 (navigate) + the start of Scene 3
          (Build My PC, first element detaching) — frames 0..PREVIS_FRAMES of
          the same authored timeline as the Master. */}
      <Composition
        id="Previs"
        component={Showreel as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={PREVIS_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ totalFrames: MASTER_FRAMES }}
      />
      <Composition
        id="Master"
        component={Showreel as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={MASTER_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ totalFrames: MASTER_FRAMES }}
      />
      {/* Same choreography, linearly re-timed into 15s. */}
      <Composition
        id="Cutdown"
        component={Showreel as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={CUTDOWN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ totalFrames: CUTDOWN_FRAMES }}
      />
      {/* No external text overlays — website captures only. */}
      <Composition
        id="MasterClean"
        component={Showreel as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={MASTER_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ totalFrames: MASTER_FRAMES, hideText: true }}
      />
    </>
  );
};
