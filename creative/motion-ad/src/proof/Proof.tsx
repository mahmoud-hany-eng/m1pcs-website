import React from "react";
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { MotionBlur } from "../lib/MotionBlur";
import { Cursor } from "../lib/Cursor";
import { LogoGlow, LogoReveal, NOTCH, NOTCH_CLEAR_ZOOM } from "./LogoReveal";
import T from "../../timeline.json";
import HOME_LOG from "../../public/cap/home/log.json";

/**
 * STYLE PROOF (0 – 4.4 s)
 *  1. the real logo assembles, then the camera accelerates INTO its V-notch;
 *     the live homepage emerges through the gap (downbeat impact 1.552 s)
 *  2. live homepage (real 60 fps capture): entrance settling, real scroll,
 *     cursor glides in, camera follows and pushes, real hover, real press
 *  3. the click: the pressed button's own red shape grows over the frame,
 *     then opens from the click point onto the real Build My PC page
 */

const FPS = T.fps;
const VW = T.viewport.width; // 432
const VH = T.viewport.height; // 768
const K = 1080 / VW; // screen px per page px at zoom 1 (2.5)
const P = T.proof.home;
const L = T.proof.logo;
const C = { x: 540, y: 960 };

type LogEntry = {
  frame: number;
  mouse: { x: number; y: number; down: boolean };
  scrollY: number;
  meta: { path: string; cta: { x: number; y: number; w: number; h: number } | null };
};
const LOG = HOME_LOG as unknown as LogEntry[];
const LAST = LOG.length - 1;
// Last frame that still shows the homepage (pressed state). The capture log
// records the URL before the screenshot, and the click's navigation can
// commit in between — so this is verified against the pixels, not the log.
const PRESS_FRAME = 140;
const CTA = { x: 16, y: 491, w: 400, h: 56 }; // CTA rect after the scroll (from the capture log)
const CLICK = { x: 316, y: 520.5 }; // where the real click happened (page px)

type Cam = { cx: number; cy: number; s: number };

// ROUND (not floor): every motion-blur sub-sample of an output frame must show
// the same live frame, or real scrolling would ghost.
const capIndex = (t: number) => Math.max(0, Math.min(LAST, Math.round((t - P.captureStart) * FPS)));
/** Real scroll speed (page px / frame) at this output time, for directional blur. */
const scrollSpeed = (i: number) => {
  // only meaningful between two homepage frames (navigation resets scroll)
  if (i < 1 || i > PRESS_FRAME) return 0;
  return LOG[i].scrollY - LOG[i - 1].scrollY;
};
const mouseAt = (t: number) => {
  const f = (t - P.captureStart) * FPS;
  const i = Math.max(0, Math.min(LAST - 1, Math.floor(f)));
  const k = clamp01(f - i);
  const a = LOG[i].mouse;
  const b = LOG[i + 1].mouse;
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
};

const clampCam = (c: Cam): Cam => {
  const hw = VW / 2 / c.s;
  const hh = VH / 2 / c.s;
  return { s: c.s, cx: Math.min(VW - hw, Math.max(hw, c.cx)), cy: Math.min(VH - hh, Math.max(hh, c.cy)) };
};

/** The single camera for the live-site part of the proof. */
function siteCam(t: number): Cam {
  // landing: arrive slightly close, settle out
  let s = 1 + 0.06 * (1 - ease.settle(range(t, L.impact, L.impact + 0.55)));
  // keep breathing while the page scrolls
  s += 0.03 * ease.swift(range(t, 2.0, 2.65));
  // follow the hand toward the CTA
  // Framed so the headline keeps its left edge and the pill runs off the
  // right edge — never cropping words mid-letter.
  const kPush = ease.swift(range(t, 2.32, 3.2));
  s += 0.27 * kPush;
  let cx = lerp(VW / 2, 176, kPush);
  let cy = lerp(VH / 2, 448, kPush);
  if (t >= P.cursorIn) {
    const m = mouseAt(t);
    const lead = 0.12 * (1 - range(t, 3.0, 3.3));
    cx += lead * (m.x - CLICK.x);
    cy += lead * (m.y - CLICK.y);
  }
  // press: a tiny anticipation push
  s += 0.024 * (ease.outCubic(range(t, P.press, P.press + 0.05)) - ease.inOutCubic(range(t, P.press + 0.05, P.press + 0.2)));
  // the click: rush into the button
  const kE = ease.accelerate(range(t, P.release, P.expandEnd));
  s *= 1 + 0.9 * kE;
  cx = lerp(cx, CTA.x + CTA.w / 2, kE);
  cy = lerp(cy, CTA.y + CTA.h / 2, kE);
  return clampCam({ cx, cy, s });
}

/** Camera on the Build My PC page as it is revealed. */
function revealCam(t: number): Cam {
  const k = ease.settle(range(t, P.expandEnd - 0.02, P.revealEnd + 0.3));
  return clampCam({ cx: VW / 2, cy: VH / 2 - 26 * (1 - k), s: 1 + 0.1 * (1 - k) });
}

const toScreen = (px: number, py: number, cam: Cam) => ({
  x: C.x + (px - cam.cx) * K * cam.s,
  y: C.y + (py - cam.cy) * K * cam.s,
});

/** One frame of the real captured website under a camera. */
const SiteFrame: React.FC<{ index: number; cam: Cam; style?: React.CSSProperties; vBlur?: number }> = ({
  index,
  cam,
  style,
  vBlur = 0,
}) => {
  const scale = cam.s;
  const left = C.x - cam.cx * K * scale;
  const top = C.y - cam.cy * K * scale;
  const fid = `vblur-${Math.round(vBlur * 10)}`;
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      {vBlur > 0.4 && (
        // directional (vertical-only) blur for the real scroll: the page
        // itself moved this many px during the frame
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={fid} x="0" y="-5%" width="100%" height="110%">
            <feGaussianBlur stdDeviation={`0 ${vBlur}`} />
          </filter>
        </svg>
      )}
      <Img
        src={staticFile(`cap/home/f${String(index).padStart(5, "0")}.png`)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
          transformOrigin: "0 0",
          transform: `translate(${left}px, ${top}px) scale(${scale})`,
          filter: vBlur > 0.4 ? `url(#${fid})` : undefined,
        }}
      />
    </AbsoluteFill>
  );
};

const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // ------------------------------------------------------------ shot 1: logo
  const pushU = range(t, L.pushStart, L.impact);
  const pushK = Math.pow(pushU, 1.8);
  // the notch drifts to frame centre early (ease-out) so the strokes below
  // it leave the frame instead of lingering
  const driftK = 1 - Math.pow(1 - pushU, 2);
  const logoZoom =
    t < L.pushStart ? 0.965 + 0.035 * ease.outCubic(range(t, 0, L.pushStart)) : Math.pow(NOTCH_CLEAR_ZOOM, pushK);
  const logoShiftX = (C.x - NOTCH.x) * driftK;
  const logoShiftY = (C.y - NOTCH.y) * driftK;
  // strokes physically leave the frame (zoom ≥ 14× by u≈0.86); the fade is
  // only a safety net for the last few frames
  const logoOpacity = 1 - range(pushU, 0.95, 1);
  const showLogo = t < L.impact;

  // website emerging through the notch (behind the logo)
  const flyIn = t < L.impact;
  const outerScale = flyIn ? 0.26 * Math.pow(1 / 0.26, pushK) : 1;
  const outerDx = flyIn ? (NOTCH.x - C.x) * (1 - driftK) : 0;
  const outerDy = flyIn ? (NOTCH.y - C.y) * (1 - driftK) : 0;
  const siteOpacity = flyIn ? range(pushU, 0.04, 0.38) : 1;
  const siteBlur = flyIn ? 10 * (1 - pushK) : 0;
  const maskR = flyIn ? lerp(26, 135, pushK) : 200;

  // ------------------------------------------------------------ shot 2/3 timings
  const expandK = ease.accelerate(range(t, P.release, P.expandEnd));
  const revealing = t >= P.expandEnd - 0.001;
  const revealK = range(t, P.expandEnd, P.revealEnd);

  const cam = siteCam(t);
  // never show a frame past the last true homepage frame on the homepage layer
  const homeIndex = Math.min(capIndex(t), PRESS_FRAME);
  const buildIndex = capIndex(t);

  // the pressed button, in screen space, and the full frame it grows into
  const bA = toScreen(CTA.x, CTA.y, cam);
  const bB = toScreen(CTA.x + CTA.w, CTA.y + CTA.h, cam);
  const growK = ease.swift(range(t, P.release, P.expandEnd));
  const rect = {
    x: lerp(bA.x, -40, growK),
    y: lerp(bA.y, -40, growK),
    w: lerp(bB.x - bA.x, 1160, growK),
    h: lerp(bB.y - bA.y, 2000, growK),
  };
  const radius = lerp((bB.y - bA.y) / 2, 0, growK);

  // reveal: the red opens in a V — the same notch shape we flew through in
  // shot 1 — growing out of the click point, with a hot edge
  // centred on the frame (the brand shape reads as a V, not a diagonal wipe),
  // at the height of the click
  const clickPt = { x: C.x, y: toScreen(CLICK.x, CLICK.y, siteCam(P.release)).y };
  const R = 3400 * ease.inOutCubic(revealK);
  const V = {
    tl: { x: clickPt.x - 1.05 * R, y: clickPt.y - 1.3 * R },
    tr: { x: clickPt.x + 1.05 * R, y: clickPt.y - 1.3 * R },
    a: { x: clickPt.x, y: clickPt.y + 0.9 * R },
  };
  const vPoly = `polygon(${V.tl.x}px ${V.tl.y}px, ${V.tr.x}px ${V.tr.y}px, ${V.a.x}px ${V.a.y}px)`;

  // cursor
  const m = mouseAt(Math.min(t, P.release + 0.5));
  const cursorPos = toScreen(m.x, m.y, cam);
  const press =
    ease.outCubic(range(t, P.press, P.press + 0.06)) * (1 - ease.outCubic(range(t, P.release, P.release + 0.08)));
  const cursorOpacity = range(t, P.cursorIn, P.cursorIn + 0.08) * (1 - range(t, P.expandEnd - 0.1, P.expandEnd + 0.06));

  // click ripple
  const rippleK = range(t, P.press, P.press + 0.38);
  const pressPt = toScreen(CLICK.x, CLICK.y, cam);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* ---------------- live website ---------------- */}
      {t >= L.pushStart && !revealing && (
        <AbsoluteFill
          style={{
            opacity: siteOpacity,
            transformOrigin: `${C.x}px ${C.y}px`,
            transform: `translate(${outerDx}px, ${outerDy}px) scale(${outerScale})`,
            filter: siteBlur > 0.2 ? `blur(${siteBlur}px)` : undefined,
            WebkitMaskImage: flyIn
              ? `radial-gradient(ellipse 60% 60% at 50% 50%, #000 ${maskR * 0.55}%, transparent ${maskR}%)`
              : undefined,
          }}
        >
          <SiteFrame
            index={homeIndex}
            cam={cam}
            vBlur={0.45 * Math.abs(scrollSpeed(homeIndex)) * K * cam.s * 0.5}
          />
        </AbsoluteFill>
      )}

      {/* ---------------- the click becomes the transition ---------------- */}
      {t >= P.release && (
        <AbsoluteFill
          style={{ opacity: revealing ? 1 - range(revealK, 0.85, 1) : 1 }}
        >
          <div
            style={{
              position: "absolute",
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              borderRadius: radius,
              background: `linear-gradient(180deg, rgb(${lerp(157, 231, growK)},${lerp(46, 50, growK)},${lerp(22, 37, growK)}) 0%, rgb(157,46,22) 100%)`,
            }}
          />
          {/* the real button label rides the growing shape for its first moments */}
          {growK < 0.5 && (
            <AbsoluteFill
              style={{
                opacity: 1 - range(growK, 0.05, 0.45),
                clipPath: `inset(${bA.y}px ${1080 - bB.x}px ${1920 - bB.y}px ${bA.x}px round ${(bB.y - bA.y) / 2}px)`,
              }}
            >
              <SiteFrame index={PRESS_FRAME} cam={cam} />
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      )}

      {/* ---------------- Build My PC revealed through the V ---------------- */}
      {revealing && (
        <AbsoluteFill style={{ clipPath: revealK >= 1 ? undefined : vPoly }}>
          <SiteFrame index={buildIndex} cam={revealCam(t)} />
        </AbsoluteFill>
      )}
      {revealing && revealK < 1 && (
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <polyline
            points={`${V.tl.x},${V.tl.y} ${V.a.x},${V.a.y} ${V.tr.x},${V.tr.y}`}
            fill="none"
            stroke="#ff6a45"
            strokeWidth={5}
            strokeLinejoin="miter"
            opacity={1 - revealK}
            style={{ filter: "drop-shadow(0 0 14px rgba(255,80,50,0.9))" }}
          />
          <polyline
            points={`${V.tl.x},${V.tl.y} ${V.a.x},${V.a.y} ${V.tr.x},${V.tr.y}`}
            fill="none"
            stroke="#fff1e8"
            strokeWidth={1.6}
            opacity={1 - revealK}
          />
        </svg>
      )}

      {/* ---------------- logo (shot 1) ---------------- */}
      {/* ambient light stays in screen space and dims as we leave it behind —
          inside the zooming group it would become a red wash over the site */}
      {showLogo && <LogoGlow t={t} fade={range(pushU, 0, 0.55)} />}
      {showLogo && (
        <AbsoluteFill
          style={{
            opacity: logoOpacity,
            transformOrigin: `${NOTCH.x}px ${NOTCH.y}px`,
            transform: `translate(${logoShiftX}px, ${logoShiftY}px) scale(${logoZoom})`,
          }}
        >
          <LogoReveal t={t} />
        </AbsoluteFill>
      )}

      {/* ---------------- click ripple + cursor ---------------- */}
      {rippleK > 0 && rippleK < 1 && (
        <div
          style={{
            position: "absolute",
            left: pressPt.x - 90 * ease.outCubic(rippleK),
            top: pressPt.y - 90 * ease.outCubic(rippleK),
            width: 180 * ease.outCubic(rippleK),
            height: 180 * ease.outCubic(rippleK),
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.75)",
            opacity: 1 - rippleK,
          }}
        />
      )}
      {cursorOpacity > 0 && (
        <Cursor x={cursorPos.x} y={cursorPos.y} size={24 * K * Math.pow(cam.s, 0.55)} press={press} opacity={cursorOpacity} />
      )}

      {/* ---------------- impact flash (one beat-locked frame) ---------------- */}
      {t >= L.impact - 0.02 && t < L.impact + 0.16 && (
        <AbsoluteFill
          style={{
            opacity: 1 - range(t, L.impact, L.impact + 0.16),
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,236,226,0.32) 0%, rgba(255,88,56,0.14) 28%, rgba(0,0,0,0) 62%)",
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/** Sub-frame samples only where something moves fast. */
const samplesAt = (frame: number) => {
  const t = frame / FPS;
  if (t >= 0.1 && t < 0.8) return 10; // slices snapping in
  if (t >= L.pushStart && t < L.impact + 0.12) return 12; // the fly-through
  if (t >= P.cursorIn && t < P.cursorArrive) return 6; // the hand moving
  if (t >= P.release && t < P.revealEnd + 0.05) return 10; // the click transition
  return 1;
};

export const Proof: React.FC = () => (
  <AbsoluteFill>
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene />
    </MotionBlur>
    {/* outside the blur wrapper so it's mixed once, not once per sub-sample */}
    <Audio src={staticFile("audio/proof.wav")} />
  </AbsoluteFill>
);
