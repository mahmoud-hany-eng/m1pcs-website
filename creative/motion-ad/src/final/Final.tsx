import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { MotionBlur } from "../lib/MotionBlur";
import { Fonts } from "./fonts";
import { FPS } from "./shared";
import { Journey, journeySamples } from "./Journey";
import { Chat, chatSamples } from "./Chat";
import { Route, routeSamples } from "./Route";
import { Builds, buildsSamples } from "./Builds";
import { CtaPage, EndCard, ctaSamples, DURATION } from "./Cta";

/**
 * M1 Gaming PCs — "Build Yours" (≈21 s, 1080×1920, 60 fps).
 * The customer journey told through the real website:
 *  logo → live homepage → Build Your PC → real requirements → the request
 *  → WhatsApp (price, availability, deposit, order) → sourced from the U.S.
 *  → real builds → parts, build, setup → ready → the site's own closing CTA.
 */
export { DURATION };

const Scene: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {t < 7.2 && <Journey t={t} />}
      <Chat t={t} />
      <Route t={t} />
      <CtaPage t={t} />
      <Builds t={t} />
      <EndCard t={t} />
    </AbsoluteFill>
  );
};

const samplesAt = (frame: number) => {
  const t = frame / FPS;
  return Math.max(journeySamples(t), chatSamples(t), routeSamples(t), buildsSamples(t), ctaSamples(t));
};

export const Final: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <AbsoluteFill>
    <Fonts />
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene />
    </MotionBlur>
    {audio && <Audio src={staticFile("audio/final.wav")} />}
  </AbsoluteFill>
);
