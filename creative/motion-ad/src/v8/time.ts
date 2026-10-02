import T from "../../timeline.json";
import JLOG_RAW from "../../public/cap/journey8/log.json";
import CTA_RAW from "../../public/cap/cta8/log.json";

/** v8 — cut around the voiceover. Cues: timeline.json `v8` (written by vo/build8.py from the narration's word onsets). */
export const V = T.v8;
export const FPS = T.fps;
export const DURATION = V.duration;
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
    games: Rect | null;
    gamesValue: string;
    budget: Rect | null;
    budgetValue: string;
    groups: Record<string, Pill[] | null>;
    submitted: boolean;
  };
};
export const JLOG = JLOG_RAW as unknown as JEntry[];
export const J0 = V.home.captureStart;
export const jTime = (i: number) => J0 + i / FPS;
const firstSubmitted = JLOG.findIndex((e) => e.meta.submitted);
export const FORM_LAST = (firstSubmitted < 0 ? JLOG.length : firstSubmitted) - 1;
export const jIndex = (t: number) => Math.max(0, Math.min(FORM_LAST, Math.round((t - J0) * FPS)));

export type Tap = { press: number; release: number; x: number; y: number; frame: number };
export const TAPS = (() => {
  const out: Tap[] = [];
  for (let i = 1; i < JLOG.length; i++) {
    if (JLOG[i].mouse.down && !JLOG[i - 1].mouse.down) {
      let j = i;
      while (j < JLOG.length && JLOG[j].mouse.down) j++;
      out.push({ press: jTime(i), release: jTime(j), x: JLOG[i].mouse.x, y: JLOG[i].mouse.y, frame: i });
    }
  }
  return out;
})();
// capture order: Build Your PC, Build a Complete PC, Gaming, games field, 1440p, 144+ FPS, budget field, White, Send
export const TAP = { cta: TAPS[0], build: TAPS[1], gaming: TAPS[2], games: TAPS[3], res: TAPS[4], fps: TAPS[5], budget: TAPS[6], colour: TAPS[7], send: TAPS[8] };

export type CWord = { w: string; x: number; y: number; wd: number; h: number };
export type CEntry = {
  frame: number;
  mouse: { x: number; y: number; down: boolean };
  meta: { h2: Rect; words: CWord[]; font: { family: string; size: string; weight: string; ls: string; color: string }; btn: Rect; btnBg: string; wa: Rect; img: Rect; headerLogo: Rect | null };
};
export const CLOG = CTA_RAW as unknown as CEntry[];
export const cIndex = (t: number) => Math.max(0, Math.min(CLOG.length - 1, Math.round((t - V.ret.cta0) * FPS)));
