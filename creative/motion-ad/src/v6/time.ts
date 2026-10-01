import T from "../../timeline.json";
import JLOG_RAW from "../../public/cap/journey6/log.json";
import CTA_RAW from "../../public/cap/cta6/log.json";

/**
 * v6 (the slower, re-choreographed cut): every cue comes from timeline.json
 * `v6` — the same table the capture scripts and audio/score_v6.py read — or
 * from the real capture logs.
 */
export const V = T.v6;
export const FPS = T.fps;
export const DURATION = V.duration;
export const HALF = T.beat / 2;

export type Rect = { x: number; y: number; w: number; h: number };
export type Pill = Rect & { label: string };
export type JEntry = {
  frame: number;
  mouse: { x: number; y: number; down: boolean };
  scrollY: number;
  meta: {
    path: string;
    cta: Rect | null;
    send: Rect | null;
    fab: Rect | null;
    gaming: Rect | null;
    res: Rect | null;
    fps: Rect | null;
    colour: Rect | null;
    buildPc: Rect | null;
    groups: Record<string, Pill[] | null>;
    submitted: boolean;
  };
};
export const JLOG = JLOG_RAW as unknown as JEntry[];
export const J_START = V.home.captureStart;
export const jTime = (i: number) => J_START + i / FPS;
/** last frame showing the homepage (the client navigation lands on the next) */
export const HOME_LAST = (() => {
  const i = JLOG.findIndex((e) => e.meta.path === "/build-my-pc");
  return i - 2; // the log records the path just before the screenshot of that step
})();
/** last frame before the real submit swaps the form for its confirmation state */
export const FORM_LAST = JLOG.findIndex((e) => e.meta.submitted) - 1;
export const jIndex = (t: number) => Math.max(0, Math.min(FORM_LAST, Math.round((t - J_START) * FPS)));
export const jFrame = (t: number) => Math.max(0, Math.min(FORM_LAST, Math.round((t - J_START) * FPS)));

/** every real press / release in the capture, in ad time */
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
export const TAP = { cta: TAPS[0], build: TAPS[1], gaming: TAPS[2], res: TAPS[3], fps: TAPS[4], colour: TAPS[5], send: TAPS[6] };
/** the fingertip lands when the pointer arrives over the element (the real hover begins) */
export const CONTACTS = (() => {
  const out: number[] = [];
  for (let i = 1; i < JLOG.length; i++) {
    const a = JLOG[i - 1].mouse, b = JLOG[i].mouse;
    if (b.x >= 0 && (a.x < 0 || Math.abs(a.x - b.x) > 1) && !b.down) out.push(jTime(i));
  }
  return out;
})();

export type CEntry = { frame: number; meta: { h2: Rect; btn: Rect; btnBg: string; wa: Rect; img: Rect; headerLogo: Rect | null } };
export const CLOG = CTA_RAW as unknown as CEntry[];
export const cIndex = (t: number) => Math.max(0, Math.min(CLOG.length - 1, Math.round((t - V.cta.cta0) * FPS)));
