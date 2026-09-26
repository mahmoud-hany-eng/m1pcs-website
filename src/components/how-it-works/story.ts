/**
 * Single source of truth for the How It Works story: copy, scene order and
 * how much scroll each scene gets. Both the DOM text stack and the 3D
 * director read from here, so text and visuals can never drift apart.
 *
 * To retime the story, change SCENE_WEIGHTS (relative scroll length per
 * scene) or STORY_SCROLL_VH (total scroll length). Each scene's internal
 * beats live in its own file under ./three/scenes as a BEATS constant.
 */

export interface StoryStep {
  id: "parts" | "quote" | "confirm" | "ship" | "build" | "deliver";
  headline: string;
  body: string;
}

export const STEPS: readonly StoryStep[] = [
  {
    id: "parts",
    headline: "Pick Your Parts",
    body: "Tell us your budget, games, design preference, and performance goals. We help you choose the right parts for your needs.",
  },
  {
    id: "quote",
    headline: "Review Your Quotation",
    body: "We prepare a detailed quotation with the selected parts, pricing, and estimated shipping timeframe.",
  },
  {
    id: "confirm",
    headline: "Confirm Your Order",
    body: "Once you approve the quotation, your order is confirmed with the required deposit.",
  },
  {
    id: "ship",
    headline: "Sourced From The U.S.",
    body: "Based on your request, the required parts are sourced directly from the U.S. and shipped to Qatar.",
  },
  {
    id: "build",
    headline: "Built And Set Up By M1",
    body: "Once the parts arrive, M1 assembles your PC, installs Windows 11 Pro, required drivers, and updates so it is ready to use.",
  },
  {
    id: "deliver",
    headline: "Delivered To You",
    body: "Once ready, you can arrange pickup or delivery, and we hand over a fully prepared PC ready to use.",
  },
];

/** Relative scroll length per scene (shipping and build get the most room). */
export const SCENE_WEIGHTS = [1.25, 1.05, 1.15, 1.6, 1.55, 1.3] as const;

/** Total scroll distance of the pinned experience, in viewport heights. */
export const STORY_SCROLL_VH = 900;
export const STORY_SCROLL_VH_MOBILE = 760;

const total = SCENE_WEIGHTS.reduce((a, b) => a + b, 0);

/** [start, end] of each scene in global progress (0..1). */
export const SCENE_RANGES: readonly (readonly [number, number])[] = SCENE_WEIGHTS.map((_, i) => {
  const start = SCENE_WEIGHTS.slice(0, i).reduce((a, b) => a + b, 0) / total;
  return [start, start + SCENE_WEIGHTS[i] / total] as const;
});

export function sceneLocal(p: number, index: number): number {
  const [a, b] = SCENE_RANGES[index];
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export function sceneIndexAt(p: number): number {
  for (let i = SCENE_RANGES.length - 1; i >= 0; i--) {
    if (p >= SCENE_RANGES[i][0]) return i;
  }
  return 0;
}

/** Converts a scene-local time to global progress. */
export function globalAt(index: number, local: number): number {
  const [a, b] = SCENE_RANGES[index];
  return a + (b - a) * local;
}

/** Width (in global progress) of the text cross-over at each scene boundary. */
const TEXT_TRANSITION = 0.03;

/**
 * Continuous "which step is in focus" value for the text stack: holds flat
 * on each integer while a scene plays, and eases to the next integer across
 * a short window centred on the scene boundary.
 */
export function focusAt(p: number): number {
  let f = 0;
  for (let i = 1; i < SCENE_RANGES.length; i++) {
    const b = SCENE_RANGES[i][0];
    const x = Math.min(1, Math.max(0, (p - (b - TEXT_TRANSITION / 2)) / TEXT_TRANSITION));
    f += x * x * (3 - 2 * x);
  }
  return f;
}
