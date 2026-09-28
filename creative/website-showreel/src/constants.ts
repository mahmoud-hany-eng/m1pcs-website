// Shared constants for the M1 website showreel.
export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Reference duration (frames) the whole camera/scene timeline is authored against.
 * All timeline math uses fractions of this, so the Previs / Master / Cutdown
 * compositions can each render a different slice or a re-timed copy of the
 * exact same choreography. */
export const MASTER_FRAMES = FPS * 30;
export const CUTDOWN_FRAMES = FPS * 15;
export const PREVIS_FRAMES = FPS * 7;

// M1 brand palette (kept faithful to the real site, not reinvented).
export const COLORS = {
  black: "#050506",
  ink: "#0a0a0b",
  red: "#e2211c",
  redDeep: "#7a1210",
  gold: "#f6c948",
  white: "#f5f5f6",
};

/** Scene windows as fractions [0..1] of the full 30s timeline. Order matches the brief. */
export const SCENES = {
  enter: [0, 0.1],
  navigate: [0.1, 7 / 30],
  buildPc: [7 / 30, 14 / 30],
  quote: [14 / 30, 0.6],
  builds: [0.6, 23 / 30],
  howItWorks: [23 / 30, 0.9],
  mobileCta: [0.9, 1],
} as const;
