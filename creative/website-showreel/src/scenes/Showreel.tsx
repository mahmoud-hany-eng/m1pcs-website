import React, { Suspense } from "react";
import { AbsoluteFill, useCurrentFrame, staticFile } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { PerspectiveCamera } from "@react-three/drei";
import { WIDTH, HEIGHT, COLORS, SCENES } from "../constants";
import { sampleCamera } from "../three/camera";
import { windowT, clamp01, lerp } from "../three/easing";
import { UiPlane } from "../three/Plane";
import { FramePlane } from "../three/FramePlane";
import { EndCard } from "../overlay/EndCard";
import { Vignette } from "../overlay/Vignette";

export interface ShowreelProps {
  /** The full reference timeline this choreography is authored against (frames). */
  totalFrames: number;
  /** Suppresses the "BUILT BY M1." caption and the closing headline/CTA text
   * (used for the clean, no-overlay-text delivery). The logo mark still shows. */
  hideText?: boolean;
}

// World stations (z, along camera's forward axis) — see camera.ts for the matching move.
const Z = {
  logo: 2.2,
  home: -2.4,
  build: -12.6,
  quote: -22.5,
  builds: -33,
  how: -45,
  mobile: -58,
};

function fadeWindow(t: number, inA: number, inB: number, outA: number, outB: number): number {
  return Math.min(windowT(t, inA, inB), 1 - windowT(t, outA, outB));
}

export const Showreel: React.FC<ShowreelProps> = ({ totalFrames, hideText = false }) => {
  const frame = useCurrentFrame();
  const t = frame / totalFrames; // 0..1 global progress
  const seconds = t * 30; // position along the 30s reference timeline (camera sway phase only)

  const cam = sampleCamera(t, seconds);

  const [s1a, s1b] = SCENES.enter;
  const [, s2b] = SCENES.navigate;
  const [s3a, s3b] = SCENES.buildPc;
  const [s4a, s4b] = SCENES.quote;
  const [s5a, s5b] = SCENES.builds;
  const [s6a, s6b] = SCENES.howItWorks;
  const [s7a] = SCENES.mobileCta;

  // ---------------------------------------------------------------- scene 1: logo -> home hero
  // The logo must be fully gone before the camera dolly passes its Z position
  // (~t=0.08) or it would flash behind the lens.
  const logoOpacity = fadeWindow(t, 0.0, 0.014, 0.04, 0.058);
  const homeOpacity = fadeWindow(t, 0.045, 0.09, 0.1, 0.125);
  const homeFocused = t < 0.2;

  // ---------------------------------------------------------------- scene 3: build my pc
  const buildOpacity = fadeWindow(t, 0.085, 0.14, 0.32, 0.345);
  const buildFocused = t < s3a + 0.07;

  const pillT = fadeWindow(t, 0.255, 0.29, 0.33, 0.35);
  const pillZ = lerp(Z.build, Z.build + 1.6, Math.min(1, windowT(t, 0.255, 0.3)) * (1 - windowT(t, 0.33, 0.35)) + windowT(t, 0.33, 0.35));
  const pillPop = clamp01(windowT(t, 0.255, 0.29));

  const formClipStart = 0.335;
  const formOpacity = fadeWindow(t, formClipStart - 0.01, formClipStart + 0.025, 0.435, 0.455);
  // Starts 1.3s into the clip: the form itself loads client-side (it shows
  // "Loading form…" at t=0) and the WhatsApp widget takes a beat to mount —
  // this skips past both instead of chasing the race.
  const formElapsed = 1.3 + Math.max(0, (t - formClipStart) * 30);
  const formZ = Z.build + 1.6 * Math.min(1, windowT(t, formClipStart, formClipStart + 0.03));

  const prefOpacity = fadeWindow(t, 0.44, 0.452, s3b - 0.005, s3b + 0.012);
  const prefZ = Z.build + 1.6 * Math.min(1, windowT(t, 0.44, 0.455));

  // ---------------------------------------------------------------- scene 4: quote / CTA
  const quoteOpacity = fadeWindow(t, 0.34, 0.39, 0.53, 0.558);
  const quoteFocused = t < s4a + 0.09;
  const waT = fadeWindow(t, 0.515, 0.545, 0.58, 0.598);
  const waZ = Z.quote + 1.6 * Math.min(1, windowT(t, 0.515, 0.55));

  // ---------------------------------------------------------------- scene 5: completed builds
  const buildsGroupOpacity = fadeWindow(t, 0.575, 0.605, s5b - 0.012, s5b + 0.006);
  const card0In = fadeWindow(t, 0.575, 0.605, 0.75, 0.767);
  const card1In = fadeWindow(t, 0.593, 0.62, 0.75, 0.767);
  const card2In = fadeWindow(t, 0.611, 0.638, 0.75, 0.767);
  const card0Focused = t < 0.68;
  const card1Focused = t >= 0.66 && t < 0.72;
  const card2Focused = t >= 0.7;

  // ---------------------------------------------------------------- scene 6: how it works (real copy, no characters)
  const stepWindows: [number, number, number, number][] = [
    [s6a - 0.006, s6a + 0.018, s6a + 0.05, s6a + 0.065],
    [s6a + 0.05, s6a + 0.068, s6a + 0.098, s6a + 0.113],
    [s6a + 0.098, s6a + 0.116, s6a + 0.146, s6a + 0.161],
    [s6a + 0.146, s6a + 0.164, s6b - 0.01, 0.897],
  ];

  // ---------------------------------------------------------------- scene 7: desktop -> mobile -> CTA
  const deskT = fadeWindow(t, s7a - 0.01, s7a + 0.02, 0.945, 0.965);
  const deskNarrow = clamp01(windowT(t, 0.94, 0.965));
  const mobT = fadeWindow(t, 0.945, 0.965, 0.97, 0.978);
  // Starts 1s into the clip: the site's WhatsApp widget takes a beat to
  // mount on load, and this skips past that instead of chasing the race.
  const mobElapsed = 1.0 + Math.max(0, (t - 0.945) * 30);
  const blackout = clamp01(windowT(t, 0.972, 0.985));

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      <ThreeCanvas width={WIDTH} height={HEIGHT} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={[COLORS.black]} />
        <fog attach="fog" args={[COLORS.black, 16, 62]} />
        <PerspectiveCamera makeDefault position={cam.pos} fov={cam.fov} near={0.1} far={200} onUpdate={(c) => c.lookAt(...cam.look)} />
        <ambientLight intensity={0.4} />

        <Suspense fallback={null}>
          {/* ---------------- Scene 1: M1 mark, then the real homepage hero ---------------- */}
          <UiPlane src="stills/logo.png" position={[0, 0.55, Z.logo + 2.2]} height={1.05} opacity={logoOpacity} />
          <UiPlane
            src="stills/home-hero-clean.png"
            srcBlur="stills-blur/home-hero-clean.png"
            focused={homeFocused}
            position={[0, 0.32, Z.home]}
            height={0.55}
            opacity={homeOpacity}
            dim={homeFocused ? 0 : 0.35}
          />

          {/* ---------------- Scene 3: the real Build My PC form, with real controls detaching ---------------- */}
          <UiPlane
            src="stills/build-my-pc-top.png"
            srcBlur="stills-blur/build-my-pc-top.png"
            focused={buildFocused}
            position={[0, 0.3, Z.build]}
            height={0.55}
            opacity={buildOpacity}
            dim={buildFocused ? 0 : 0.4}
          />
          <UiPlane src="elements/pill-complete-pc.png" position={[0, -0.15, pillZ]} height={0.22 + pillPop * 0.05} opacity={pillT} />
          <FramePlane
            dir="frames/buildmypc-form"
            frameCount={158}
            clipFps={24}
            elapsedSeconds={formElapsed}
            position={[0, 0.15, formZ]}
            height={0.42}
            opacity={formOpacity}
          />
          <UiPlane src="elements/pill-best-option.png" position={[0.05, -1.05, prefZ]} height={0.14} opacity={prefOpacity} />

          {/* ---------------- Scene 4: the real quote / WhatsApp CTA ---------------- */}
          <UiPlane
            src="stills/contact-top.png"
            srcBlur="stills-blur/contact-top.png"
            focused={quoteFocused}
            position={[0, 0.3, Z.quote]}
            height={0.55}
            opacity={quoteOpacity}
            dim={quoteFocused ? 0 : 0.4}
          />
          <UiPlane src="elements/card-whatsapp.png" position={[0, 0, waZ]} height={0.34} opacity={waT} />

          {/* ---------------- Scene 5: completed builds, real customer photography at different depths ---------------- */}
          <UiPlane
            src="elements/build-card-0.png"
            focused={card0Focused}
            position={[-2.55, 0.25, Z.builds + 0.3]}
            height={1.1}
            opacity={card0In * buildsGroupOpacity}
            dim={card0Focused ? 0 : 0.3}
          />
          <UiPlane
            src="elements/build-card-1.png"
            focused={card1Focused}
            position={[0, 0.1, Z.builds - 0.6]}
            height={1.18}
            opacity={card1In * buildsGroupOpacity}
            dim={card1Focused ? 0 : 0.3}
          />
          <UiPlane
            src="elements/build-card-2.png"
            focused={card2Focused}
            position={[2.55, 0.25, Z.builds + 0.3]}
            height={1.1}
            opacity={card2In * buildsGroupOpacity}
            dim={card2Focused ? 0 : 0.3}
          />

          {/* ---------------- Scene 6: How It Works, in the site's own copy (no cartoon characters) ---------------- */}
          {(["step-0.png", "step-1.png", "step-2.png", "step-3.png"] as const).map((src, i) => {
            const [a, b, c, d] = stepWindows[i];
            const op = fadeWindow(t, a, b, c, d);
            return <UiPlane key={src} src={`elements/${src}`} position={[0, 0.15, Z.how + i * 0.28]} height={0.2} opacity={op} />;
          })}

          {/* ---------------- Scene 7: desktop -> mobile ---------------- */}
          <group scale={[1 - deskNarrow * 0.82, 1, 1]} position={[0.55, 0.1, Z.mobile + 1.4]}>
            <UiPlane src="stills/build-my-pc-top.png" srcBlur="stills-blur/build-my-pc-top.png" focused={t < 0.945} position={[0, 0, 0]} height={0.5} opacity={deskT} />
          </group>
          <FramePlane
            dir="frames/mobile-buildmypc-scroll"
            frameCount={60}
            clipFps={24}
            elapsedSeconds={mobElapsed}
            position={[-0.45, 0.05, Z.mobile]}
            height={0.9}
            opacity={mobT}
          />
        </Suspense>
      </ThreeCanvas>

      <Vignette />

      {/* Minimal external copy — the site's own UI carries the rest of the story. */}
      {!hideText && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 190, pointerEvents: "none" }}>
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: 3,
              color: COLORS.white,
              textShadow: "0 2px 18px rgba(0,0,0,0.6)",
              opacity: fadeWindow(t, s5a + 0.03, s5a + 0.06, s5b - 0.03, s5b - 0.008),
            }}
          >
            BUILT BY M1.
          </div>
        </AbsoluteFill>
      )}

      <EndCard blackout={blackout} t={t} hideText={hideText} />
    </AbsoluteFill>
  );
};
