import React from "react";
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from "remotion";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { MotionBlur } from "../lib/MotionBlur";
import { C, Cam, K, SiteFrame, VH, VW, clampCam, toScreen } from "../lib/SiteFrame";
import { EmblemPlane, PlaneState, S, TARGET, toScreenPlane } from "./EmblemPlane";
import T from "../../timeline.json";
import LOG_RAW from "../../public/cap/home5/log.json";

/**
 * STYLE PROOF v5 (3.42 s)
 *  1. the real emblem's two halves swing together and lock; the wordmark
 *     rises under it; the camera is already creeping forward and, without
 *     a hold, dollies THROUGH the emblem's V-shaped negative space into the
 *     live homepage behind it
 *  2. the page settles, the camera locks onto the real "Build Your PC"
 *     button, a touch lands (real hover), presses (real :active)
 *  3. the pressed red surface lifts toward the lens and resolves into the
 *     red M1 emblem; the camera passes through its V onto the real quote
 *     page that was already behind it
 */

const FPS = T.fps;
const L5 = T.v5.logo;
const H = T.v5.home;
const DIR = "home5";
type Entry = { frame: number; mouse: { x: number; y: number; down: boolean }; scrollY: number };
const LOG = LOG_RAW as unknown as Entry[];
const LAST = LOG.length - 1;
const HOME_LAST = 99; // last frame whose pixels are the homepage (verified)
const CTA = { x: 16, y: 490.4, w: 400, h: 56 };
const TOUCH = { x: 304, y: 519.1 };

const capIndex = (t: number) => Math.max(0, Math.min(LAST, Math.round((t - H.captureStart) * FPS)));
const scrollSpeed = (i: number) => (i < 1 || i > HOME_LAST ? 0 : LOG[i].scrollY - LOG[i - 1].scrollY);

// ---------------------------------------------------------------------------
// shot 1: one continuous dolly — creeping from frame 0, through the V at ~1.0 s
// ---------------------------------------------------------------------------
const Z_END = 40;
function dollyZ(t: number) {
  // perspective dolly: camera distance c in [0, 1-1/Z_END]; plane scale 1/(1-c)
  const u = range(t, 0, L5.passEnd);
  const c = (1 - 1 / Z_END) * Math.pow(u, 2.2);
  return 1 / (1 - c);
}
const LOGO_REST = { x: 540 + (TARGET.x - 2250) * S, y: 930 + (TARGET.y - 2815) * S };

function openingPlane(t: number): PlaneState {
  const z = dollyZ(t);
  // the camera turns onto the V as it accelerates (the V reaches frame centre)
  const aim = ease.inOutCubic(range(t, 0.45, 0.98));
  return {
    px: lerp(LOGO_REST.x, C.x, aim),
    py: lerp(LOGO_REST.y, C.y, aim),
    z,
    wall: "#000",
    halves: range(t, 0.02, L5.lock),
    wm1: ease.settle(range(t, L5.wordmark[0], L5.wordmark[0] + 0.24)),
    wm2: ease.settle(range(t, L5.wordmark[0] + 0.07, L5.wordmark[1])),
    seam: range(t, L5.lock - 0.01, L5.lock + 0.2),
  };
}

// ---------------------------------------------------------------------------
// shot 2: page settles, camera locks onto the button
// ---------------------------------------------------------------------------
const lockEase = bezier(0.3, 0, 0.12, 1);
function siteCam(t: number): Cam {
  // after passing through the V the camera eases to rest (6% settle)
  let s = 1 + 0.06 * (1 - ease.settle(range(t, L5.passEnd - 0.04, L5.passEnd + 0.42)));
  const k = lockEase(range(t, H.lockStart, H.lockEnd));
  s += 0.36 * k;
  // keeps the headline's left edge in frame; the pill runs off the right
  const cx = lerp(VW / 2, 12 + VW / 2 / 1.36, k);
  const cy = lerp(VH / 2, 425, k); // frames headline + button, keeps the floating chat button out
  // press: a hair of push-in
  s += 0.018 * (ease.outCubic(range(t, H.press, H.press + 0.05)) - ease.inOutCubic(range(t, H.press + 0.05, H.release + 0.05)));
  return clampCam({ cx, cy, s });
}

// ---------------------------------------------------------------------------
// shot 3: pressed surface -> red emblem -> through the V
// ---------------------------------------------------------------------------
const PASS2 = H.pass;
function redPlane(t: number, touchScreen: { x: number; y: number }): PlaneState {
  const u = range(t, H.release, PASS2);
  // starts tiny inside the button (V hidden), accelerates to "through"
  const z0 = 0.2;
  const z = z0 * Math.pow(Z_END / z0, Math.pow(u, 1.55));
  const aim = ease.inOutCubic(range(t, H.release, H.release + 0.34));
  return {
    px: lerp(touchScreen.x, C.x, aim),
    py: lerp(touchScreen.y, C.y, aim),
    z,
    wall: "url(#redwall)",
    hole: ease.outCubic(range(t, H.release, H.release + 0.07)),
    emblemOnly: true,
    artOpacity: range(t, H.release, H.release + 0.05),
  };
}

const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // -------------------------------------------------------------- pages
  const idx = capIndex(t);
  const homeIdx = Math.min(idx, HOME_LAST);
  const cam = siteCam(t);
  const fog = t < L5.passEnd ? 0.12 + 0.88 * clamp01((dollyZ(t) - 1.2) / 6) : 1;
  const vBlur = (() => {
    const v = Math.abs(scrollSpeed(homeIdx));
    return v > 11 ? Math.min(2.4, 0.1 * (v - 11) * K * cam.s) : 0; // only the fastest frames, capped
  })();

  // the pressed button, screen space
  const pressCam = siteCam(H.release);
  const touchScreen = toScreen(TOUCH.x, TOUCH.y, pressCam);
  const inTransition = t >= H.release;
  const passed2 = t >= PASS2;

  // focus: the rest of the page recedes while the camera locks onto the button
  const focus = 0.42 * ease.inOutCubic(range(t, H.lockStart + 0.1, H.lockEnd)) * (1 - range(t, H.release, H.release + 0.12));
  const bA = toScreen(CTA.x, CTA.y, cam);
  const bB = toScreen(CTA.x + CTA.w, CTA.y + CTA.h, cam);

  // press: the real button gives slightly under the finger
  const pressK = ease.outCubic(range(t, H.press, H.press + 0.05)) * (1 - ease.outCubic(range(t, H.release, H.release + 0.06)));

  // touch indicator
  const tIn = range(t, H.touchIn, H.contact);
  const tScreen = toScreen(TOUCH.x, TOUCH.y, cam);
  const approach = ease.outCubic(tIn);
  const touchOpacity = approach * (1 - range(t, H.release, H.release + 0.08));
  const contactRipple = range(t, H.contact, H.contact + 0.32);

  // red plane (transition)
  const rp = redPlane(t, touchScreen);
  // The pressed pill IS the surface carrying the emblem: it grows at exactly
  // the same perspective rate, about the same (drifting) point — so the
  // homepage stays visible around a widening red band while the V opens
  // inside it. Never a flat red frame.
  const zr = rp.z / 0.2;
  const growK = range(t, H.release, H.release + 0.16); // label fade only
  const pillA = { x: (bA.x - touchScreen.x) * zr + rp.px, y: (bA.y - touchScreen.y) * zr + rp.py };
  const pillB = { x: (bB.x - touchScreen.x) * zr + rp.px, y: (bB.y - touchScreen.y) * zr + rp.py };
  const clip = {
    x: pillA.x,
    y: pillA.y,
    w: pillB.x - pillA.x,
    h: pillB.y - pillA.y,
    r: Math.min(((bB.y - bA.y) / 2) * zr, 4000),
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="redwall" x1="0" y1="0" x2="0" y2="1920" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a8301a" />
            <stop offset="1" stopColor="#8a2814" />
          </linearGradient>
        </defs>
      </svg>

      {/* ------------------------------------------------ live homepage */}
      {t >= 0.3 && !passed2 && (
        <AbsoluteFill>
          <SiteFrame
            dir={DIR}
            index={homeIdx}
            cam={cam}
            vBlur={vBlur}
            brightness={fog * (1 - 0.55 * range(t, H.release, H.release + 0.16))}
          />
        </AbsoluteFill>
      )}

      {/* focus: everything but the button recedes (feathered, follows the real button rect) */}
      {focus > 0.002 && !passed2 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              left: bA.x - 26,
              top: bA.y - 26,
              width: bB.x - bA.x + 52,
              height: bB.y - bA.y + 52,
              borderRadius: (bB.y - bA.y) / 2 + 26,
              boxShadow: `0 0 0 3000px rgba(0,0,0,${focus})`,
              filter: "blur(22px)",
            }}
          />
        </AbsoluteFill>
      )}

      {/* the real button, pressed: a crop of the live frame giving 2.5% under the finger */}
      {pressK > 0.001 && !inTransition && (
        <AbsoluteFill
          style={{
            clipPath: `inset(${bA.y}px ${1080 - bB.x}px ${1920 - bB.y}px ${bA.x}px round ${(bB.y - bA.y) / 2}px)`,
            transformOrigin: `${(bA.x + bB.x) / 2}px ${(bA.y + bB.y) / 2}px`,
            transform: `scale(${1 - 0.025 * pressK})`,
            backgroundColor: "#0a0a0b",
          }}
        >
          <SiteFrame dir={DIR} index={homeIdx} cam={cam} />
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ the pressed surface lifting into the emblem;
          the quote page exists behind it and is seen only through its V */}
      {inTransition && (
        <AbsoluteFill
          style={{
            clipPath: passed2
              ? undefined
              : `inset(${clip.y}px ${1080 - clip.x - clip.w}px ${1920 - clip.y - clip.h}px ${clip.x}px round ${clip.r}px)`,
          }}
        >
          <SiteFrame
            dir={DIR}
            index={Math.max(HOME_LAST + 1, idx)}
            cam={clampCam({ cx: VW / 2, cy: VH / 2, s: 1 + 0.07 * (1 - ease.settle(range(t, PASS2 - 0.08, PASS2 + 0.6))) })}
          />
          {!passed2 && <EmblemPlane st={rp} />}
          {/* the button label rides the surface for its first instant */}
          {!passed2 && (
            <AbsoluteFill style={{ opacity: 1 - range(t, H.release, H.release + 0.07) }}>
              <AbsoluteFill
                style={{
                  clipPath: `inset(${bA.y}px ${1080 - bB.x}px ${1920 - bB.y}px ${bA.x}px round ${(bB.y - bA.y) / 2}px)`,
                  transformOrigin: `${touchScreen.x}px ${touchScreen.y}px`,
                  transform: `scale(${1 + 0.6 * growK})`,
                }}
              >
                <SiteFrame dir={DIR} index={HOME_LAST} cam={cam} />
              </AbsoluteFill>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ the opening surface (black wall + real logo) */}
      {t < L5.passEnd && <EmblemPlane st={openingPlane(t)} />}

      {/* ------------------------------------------------ touch */}
      {touchOpacity > 0.001 && (
        <>
          <div
            style={{
              position: "absolute",
              left: tScreen.x + (1 - approach) * 34,
              top: tScreen.y + (1 - approach) * 46,
              width: 0,
              height: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -46,
                top: -46,
                width: 92,
                height: 92,
                borderRadius: 46,
                transform: `scale(${(1.45 - 0.45 * approach) * (1 - 0.14 * pressK)})`,
                background: `rgba(255,255,255,${0.16 + 0.14 * pressK})`,
                boxShadow: `inset 0 0 0 2.5px rgba(255,255,255,${0.75 + 0.2 * pressK}), 0 ${10 * (1 - pressK) + 4}px ${26 - 10 * pressK}px rgba(0,0,0,0.45)`,
                opacity: touchOpacity,
              }}
            />
          </div>
          {contactRipple > 0 && contactRipple < 1 && (
            <div
              style={{
                position: "absolute",
                left: tScreen.x - 46 - 40 * ease.outCubic(contactRipple),
                top: tScreen.y - 46 - 40 * ease.outCubic(contactRipple),
                width: 92 + 80 * ease.outCubic(contactRipple),
                height: 92 + 80 * ease.outCubic(contactRipple),
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.6)",
                opacity: (1 - contactRipple) * touchOpacity,
              }}
            />
          )}
        </>
      )}
    </AbsoluteFill>
  );
};

/** Sub-frame samples only at the fastest instants. */
const samplesAt = (frame: number) => {
  const t = frame / FPS;
  if (t >= 0.04 && t < L5.lock + 0.02) return 8; // halves swinging in
  if (t >= 0.86 && t < L5.passEnd + 0.06) return 14; // through the V
  if (t >= H.release + 0.18 && t < PASS2 + 0.06) return 14; // through the red V
  if (t >= H.release && t < H.release + 0.18) return 6; // surface lifting
  return 1;
};

export const ProofV5: React.FC = () => (
  <AbsoluteFill>
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene />
    </MotionBlur>
    <Audio src={staticFile("audio/proof-v5.wav")} />
  </AbsoluteFill>
);

// re-exported for the audio script / tests
export const V5_CONST = { HOME_LAST, TOUCH, CTA, toScreenPlane };
