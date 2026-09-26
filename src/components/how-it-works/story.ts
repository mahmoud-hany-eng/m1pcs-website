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
 * heights) a chapter occupies — its pacing. `tempo` converts a chapter's
 * progress into "story seconds" for repeating gestures (a wave, typing, a
 * walk cycle), so those too are a pure function of scroll: scroll slowly and
 * they move slowly, stop and they stop.
 */

export interface Chapter {
  id: "parts" | "quote" | "confirm" | "source" | "build" | "deliver";
  headline: string;
  body: string;
  /** Scroll distance in viewport heights. */
  span: number;
  /** Story seconds of gesture time the chapter spans. */
  tempo: number;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: "parts",
    headline: "Pick Your Parts",
    body: "Tell us your budget, games, performance goals, and design preferences. We help you choose the right parts for your needs.",
    span: 240,
    tempo: 9,
  },
  {
    id: "quote",
    headline: "Review Your Quotation",
    body: "You receive a detailed quotation with your selected parts, pricing, and estimated shipping timeframe.",
    span: 190,
    tempo: 7.5,
  },
  {
    id: "confirm",
    headline: "Confirm Your Order",
    body: "A deposit confirms your order. You receive payment confirmation and your order is officially placed.",
    span: 210,
    tempo: 9.5,
  },
  {
    id: "source",
    headline: "Sourced From The U.S.",
    body: "Once your order is confirmed, the requested parts are sourced directly from the U.S. and shipped to Qatar.",
    span: 330,
    tempo: 10,
  },
  {
    id: "build",
    headline: "Built & Set Up by M1",
    body: "M1 assembles your PC, installs Windows and drivers, and completes the full setup.",
    span: 250,
    tempo: 11,
  },
  {
    id: "deliver",
    headline: "Delivered to Your Door",
    body: "Your finished PC is ready for pickup or delivered to your home, set up and ready to use.",
    span: 300,
    tempo: 12,
  },
];

export const CHAPTER_COUNT = CHAPTERS.length;

/** Total pinned scroll track, in viewport heights. */
export const TRACK_VH = CHAPTERS.reduce((sum, c) => sum + c.span, 0);

const SPAN_START: number[] = [];
const TEMPO_START: number[] = [];
{
  let span = 0;
  let tempo = 0;
  for (const c of CHAPTERS) {
    SPAN_START.push(span);
    TEMPO_START.push(tempo);
    span += c.span;
    tempo += c.tempo;
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
  const i = Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(s)));
  return TEMPO_START[i] + clamp01(s - i) * CHAPTERS[i].tempo;
}

/** Chapter that owns story position s. */
export function chapterAt(s: number): number {
  return Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(s)));
}

/** 0..1 progress through chapter `index` (0 before it, 1 after it). */
export function chapterLocal(s: number, index: number): number {
  return clamp01(s - index);
}
