/**
 * Single source of truth for the How It Works story: copy, chapter order
 * and pacing. The DOM caption, the progress bar and the 3D director all
 * read from here.
 *
 * Pacing model: scroll *selects* a chapter; each chapter then plays at a
 * designed speed (its `duration`), so gestures and camera moves always run
 * at the same, readable pace no matter how fast someone scrolls. To retime a
 * chapter, change its `duration`; to retime beats inside it, edit the BEATS
 * table in that chapter's scene file (values are 0..1 of the chapter).
 */

export interface Chapter {
  id: "parts" | "quote" | "confirm" | "source" | "build";
  headline: string;
  body: string;
  /** Seconds the chapter's choreography takes at normal speed. */
  duration: number;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: "parts",
    headline: "Pick Your Parts",
    body: "Tell us your budget, games, performance goals, and design preferences. We help you choose the right parts for your needs.",
    duration: 9,
  },
  {
    id: "quote",
    headline: "Review Your Quotation",
    body: "You receive a detailed quotation with your selected parts, pricing, and estimated shipping timeframe.",
    duration: 7.5,
  },
  {
    id: "confirm",
    headline: "Confirm Your Order",
    body: "A deposit confirms your order. You receive payment confirmation and your order is officially placed.",
    duration: 9.5,
  },
  {
    id: "source",
    headline: "Sourced From The U.S.",
    body: "Once your order is confirmed, the requested parts are sourced directly from the U.S. and shipped to Qatar.",
    duration: 10,
  },
  {
    id: "build",
    headline: "Built. Set Up. Delivered.",
    body: "M1 assembles your PC, installs Windows and drivers, completes setup, and gets it ready for pickup or delivery.",
    duration: 14,
  },
];

export const CHAPTER_COUNT = CHAPTERS.length;

/**
 * Scroll distance (viewport heights) that selects each chapter, plus a short
 * pinned runway after the last one so the ending and CTA can settle.
 */
export const BAND_VH = 100;
export const RUNWAY_VH = 45;

/**
 * Story position `s` runs from 0 to CHAPTER_COUNT. Chapter i occupies
 * (i, i + 1]: it rests on its final frame at s = i + 1.
 */
export function chapterAt(s: number): number {
  return Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.ceil(s) - 1));
}

export function chapterLocal(s: number, index: number): number {
  return Math.min(1, Math.max(0, s - index));
}
