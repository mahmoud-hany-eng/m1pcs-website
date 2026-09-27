/**
 * Single source of truth for the How It Works story: copy, chapter order and
 * how much scrolling each chapter gets.
 *
 * The whole experience is one timeline scrubbed by the page scroll:
 *
 *   scrollY → progress (0..1 over the pinned track) → story position s
 *   (0..CHAPTER_COUNT; chapter i spans [i, i+1)) → every transform.
 *
 * Nothing advances on its own. `span` is the scroll distance (in viewport
 * heights) a chapter occupies — its pacing. Every chapter is choreographed
 * as a few clear beats with steady "hold" ranges in between, so one normal
 * wheel or swipe gesture moves the story on by a readable amount.
 */

export type ChapterId = "parts" | "quote" | "confirm" | "source" | "ship" | "build" | "deliver";

export interface Chapter {
  id: ChapterId;
  headline: string;
  body: string;
  /** Scroll distance in viewport heights. */
  span: number;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: "parts",
    headline: "Pick Your Parts",
    body: "Tell us your budget, how you’ll use your PC, and the style you like. We help you choose the right parts for your needs.",
    span: 420,
  },
  {
    id: "quote",
    headline: "Review Your Quotation",
    body: "You receive a detailed quotation with your selected components, current pricing, and an estimated shipping timeframe.",
    span: 340,
  },
  {
    id: "confirm",
    headline: "Confirm Your Order",
    body: "A deposit confirms your order. You receive a receipt, and your order is officially placed.",
    span: 400,
  },
  {
    id: "source",
    headline: "Sourced From The U.S.",
    body: "We source the exact parts your build requires directly from the U.S., according to your requirements.",
    span: 380,
  },
  {
    id: "ship",
    headline: "Shipped to Qatar",
    body: "Your parts travel from the U.S. to Qatar, where the M1 team receives them for your build.",
    span: 420,
  },
  {
    id: "build",
    headline: "Built & Set Up by M1",
    body: "Once your parts arrive, M1 assembles your PC and sets it up with Windows 11 Pro, the required drivers, and updates, so it’s ready to use.",
    span: 480,
  },
  {
    id: "deliver",
    headline: "Delivered to Your Home",
    body: "Your finished PC is delivered to your door, set up and ready to use.",
    span: 640,
  },
];

export const CHAPTER_COUNT = CHAPTERS.length;

/** Chapter indices by name, so scenes never hard-code positions in the story. */
export const CH = {
  parts: 0,
  quote: 1,
  confirm: 2,
  source: 3,
  ship: 4,
  build: 5,
  deliver: 6,
} as const satisfies Record<ChapterId, number>;

/** Total pinned scroll track, in viewport heights. */
export const TRACK_VH = CHAPTERS.reduce((sum, c) => sum + c.span, 0);

/**
 * Repeating gestures (a wave, typing, a walk cycle) are phased by "story
 * seconds" derived from the scroll distance: one story second per
 * VH_PER_SECOND viewport heights. The same distance always produces the same
 * amount of motion, in every chapter, so gestures stay calm and readable at
 * a normal scrolling speed — and stop the moment the scroll does.
 */
export const VH_PER_SECOND = 45;

const SPAN_START: number[] = [];
{
  let span = 0;
  for (const c of CHAPTERS) {
    SPAN_START.push(span);
    span += c.span;
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Scroll progress (0..1) → story position s (0..CHAPTER_COUNT). */
export function progressToStory(progress: number): number {
  const vh = clamp01(progress) * TRACK_VH;
  for (let i = CHAPTER_COUNT - 1; i >= 0; i--) {
    if (vh >= SPAN_START[i]) return i + Math.min(1, (vh - SPAN_START[i]) / CHAPTERS[i].span);
  }
  return 0;
}

/** Story position → scroll progress (inverse of progressToStory). */
export function storyToProgress(s: number): number {
  const i = Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(s)));
  return (SPAN_START[i] + clamp01(s - i) * CHAPTERS[i].span) / TRACK_VH;
}

/** Story seconds at story position s — the phase source for repeating gestures. */
export function clockAt(s: number): number {
  return (storyToProgress(s) * TRACK_VH) / VH_PER_SECOND;
}

/** Chapter that owns story position s. */
export function chapterAt(s: number): number {
  return Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(s)));
}

/** 0..1 progress through chapter `index` (0 before it, 1 after it). */
export function chapterLocal(s: number, index: number): number {
  return clamp01(s - index);
}
