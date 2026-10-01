import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { MotionBlur } from "../lib/MotionBlur";
import { Fonts } from "../final/fonts";
import { DURATION, FPS } from "./time";
import { Journey6, journeySamples6 } from "./Journey6";
import { Chat6, chatSamples6 } from "./Chat6";
import { Route6, routeSamples6 } from "./Route6";
import { PC6, pcSamples6 } from "./PC6";
import { Sig6, sigSamples6 } from "./Sig6";

/**
 * M1 Gaming PCs — "Build Yours", v6 (≈33 s, 1080×1920, 60 fps).
 * Slower, re-choreographed: each section arrives, anticipates, acts, pays
 * off, and its own object causes the next scene.
 */
export { DURATION };

const Scene: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {t < 14.4 && <Journey6 t={t} />}
      <Chat6 t={t} />
      <Route6 t={t} />
      <PC6 t={t} />
      <Sig6 t={t} />
    </AbsoluteFill>
  );
};

const samplesAt = (frame: number) => {
  const t = frame / FPS;
  return Math.max(journeySamples6(t), chatSamples6(t), routeSamples6(t), pcSamples6(t), sigSamples6(t));
};

export const Final6: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <AbsoluteFill>
    <Fonts />
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene />
    </MotionBlur>
    {audio && <Audio src={staticFile("audio/v6.wav")} />}
  </AbsoluteFill>
);
