import { bezier, ease, lerp, range } from "../lib/ease";
import { C, Cam, K, clampCam } from "../lib/SiteFrame";
import T from "../../timeline.json";
import JLOG_RAW from "../../public/cap/journey/log.json";

export const FPS = T.fps;
export const W = 1080;
export const H = 1920;

/** Frame-accurate log of the continuous live capture (homepage -> quote flow). */
type Rect = { x: number; y: number; w: number; h: number };
export type JEntry = {
  frame: number;
  mouse: { x: number; y: number; down: boolean };
  scrollY: number;
  meta: { path: string; send: Rect | null; fab: Rect | null; [k: string]: unknown };
};
export const JLOG = JLOG_RAW as unknown as JEntry[];
export const J_START = T.v5.home.captureStart;
/** last frame whose pixels are the homepage (verified identical to the approved v5 capture) */
export const HOME_LAST = 99;
/** last frame before the real submit swaps the form for its confirmation state */
export const FORM_LAST = (() => {
  const i = JLOG.findIndex((e) => e.meta.path === "/build-my-pc" && (e.meta as { submitted?: boolean }).submitted);
  return i - 1;
})();
export const jIndex = (t: number) => Math.max(0, Math.min(FORM_LAST, Math.round((t - J_START) * FPS)));
export const jTime = (i: number) => J_START + i / FPS;

/** Real pointer events from the capture: every press / release, in ad time. */
export const TAPS = (() => {
  const out: { press: number; release: number; x: number; y: number; frame: number }[] = [];
  for (let i = 1; i < JLOG.length; i++) {
    if (JLOG[i].mouse.down && !JLOG[i - 1].mouse.down) {
      let j = i;
      while (j < JLOG.length && JLOG[j].mouse.down) j++;
      out.push({ press: jTime(i), release: jTime(j), x: JLOG[i].mouse.x, y: JLOG[i].mouse.y, frame: i });
    }
  }
  return out;
})();
/** Frames where the fingertip lands (pointer arrives over the element) — the touch contacts. */
export const CONTACTS = (() => {
  const out: number[] = [];
  for (let i = 1; i < JLOG.length; i++) {
    const a = JLOG[i - 1].mouse, b = JLOG[i].mouse;
    if (b.x >= 0 && (a.x < 0 || Math.abs(a.x - b.x) > 1) && !b.down) out.push(jTime(i));
  }
  return out.filter((c) => c > 1.5);
})();
// [0] homepage CTA, [1] Build a Complete PC, [2] Gaming, [3] 1440p, [4] 144+ FPS, [5] White, [6] Send Request via WhatsApp
export const TAP = { cta: TAPS[0], build: TAPS[1], gaming: TAPS[2], res: TAPS[3], fps: TAPS[4], colour: TAPS[5], send: TAPS[6] };

/** Camera keyframes on a page capture; each segment eases into its key. */
export type CamKey = { t: number; cx: number; cy: number; s: number; e?: (x: number) => number };
export function keyCam(keys: CamKey[], t: number): Cam {
  if (t <= keys[0].t) return clampCam(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const k = (b.e ?? ease.swift)(range(t, a.t, b.t));
      return clampCam({ cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), s: lerp(a.s, b.s, k) });
    }
  }
  return clampCam(keys[keys.length - 1]);
}

/** A cam that puts viewport point (px,py) at screen (X,Y) at zoom s. */
export const camAt = (px: number, py: number, X: number, Y: number, s: number): Cam => ({
  cx: px - (X - C.x) / (K * s),
  cy: py - (Y - C.y) / (K * s),
  s,
});

/** overshooting "magnetic" arrival */
export const snap = bezier(0.3, 1.45, 0.45, 1);
export const glide = bezier(0.45, 0, 0.1, 1);

export const BRAND = {
  red: "#e73225",
  emblemRed: "rgb(190,48,29)",
  yellow: "#f9c204",
  white: "#f5f5f7",
  bg: "#0a0a0b",
  surface: "#151517",
  muted: "#a6a6ad",
};
