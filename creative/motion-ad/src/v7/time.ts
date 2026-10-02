import T from "../../timeline.json";
import JLOG_RAW from "../../public/cap/journey7/log.json";
import CTA_RAW from "../../public/cap/cta7/log.json";

/** v7 — the device-world cut. Cues: timeline.json `v7` (shared with the captures and audio/score_v7.py). */
export const V = T.v7;
export const FPS = T.fps;
export const DURATION = V.duration;
/** capture px per CSS px (720×1280 viewport @ DPR 2.25 = 1620×2880) */
export const D = V.viewport.dpr;
export const SW = V.viewport.width * D;
export const SH = V.viewport.height * D;

export type Rect = { x: number; y: number; w: number; h: number };
export type Pill = Rect & { label: string; sel: boolean };
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
    groups: Record<string, Pill[] | null>;
    submitted: boolean;
  };
};
export const JLOG = JLOG_RAW as unknown as JEntry[];
export const J0 = V.home.captureStart;
export const jTime = (i: number) => J0 + i / FPS;
export const FORM_LAST = JLOG.findIndex((e) => e.meta.submitted) - 1;
export const jIndex = (t: number) => Math.max(0, Math.min(FORM_LAST, Math.round((t - J0) * FPS)));

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

export type CEntry = { frame: number; mouse: { x: number; y: number; down: boolean }; meta: { h2: Rect; btn: Rect; btnBg: string; wa: Rect; img: Rect; headerLogo: Rect | null } };
export const CLOG = CTA_RAW as unknown as CEntry[];
export const cIndex = (t: number) => Math.max(0, Math.min(CLOG.length - 1, Math.round((t - V.ret.cta0) * FPS)));
