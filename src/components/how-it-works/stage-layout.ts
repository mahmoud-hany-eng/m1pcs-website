/**
 * Stage composition shared by the DOM (caption, progress bar, hint) and the
 * 3D camera, so the action is always framed in the centre of the space the
 * UI leaves free — never pushed down, never under the caption.
 *
 *   ┌──────────── progress bar (top) ────────────┐
 *   │                                            │
 *   │          3D action, centred here           │
 *   │                                            │
 *   ├──────── caption + scroll hint / CTA ───────┤
 *   └────────────────────────────────────────────┘
 */

export type StageLayout = "wide" | "tall";

export interface StageMetrics {
  layout: StageLayout;
  width: number;
  height: number;
  /** Height reserved at the top for the progress bar. */
  top: number;
  /** Height reserved at the bottom for the caption and hint/CTA. */
  bottom: number;
  /** Horizontal breathing room on each side of the action. */
  side: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function stageMetrics(width: number, height: number): StageMetrics {
  const tall = width < 768 || width / height < 1.05;
  if (tall) {
    return {
      layout: "tall",
      width,
      height,
      top: 44,
      bottom: clamp(height * 0.38, 250, 330),
      side: Math.max(12, width * 0.04),
    };
  }
  return {
    layout: "wide",
    width,
    height,
    top: 56,
    bottom: clamp(height * 0.25, 190, 250),
    side: width * 0.1,
  };
}

/**
 * Size of the pinned UI (cards, labels) relative to its design size: 1 on
 * phones and laptops, up to 1.3 on large screens so it stays in proportion
 * with the scene. Applied with CSS `zoom`, which re-lays out text at the
 * larger size (a transform scale would blur it).
 */
export function uiScale(m: StageMetrics): number {
  const k = m.layout === "wide" ? Math.min(m.width / 1440, m.height / 820) : Math.min(m.width / 430, m.height / 800);
  return Math.round(clamp(k, 1, m.layout === "wide" ? 1.3 : 1.2) * 100) / 100;
}
