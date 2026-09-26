import { clockAt, progressToStory } from "./story";

/**
 * The master timeline: the ONLY source of motion in the How It Works story.
 *
 *   window.scrollY ─► progress 0..1 ─► story position s ─► every transform
 *
 * There is no clock. `progress` follows the scroll position with a very
 * short exponential catch-up (TAU ≈ 5 ms: it lands within a frame)
 * purely to soften discrete wheel notches; the moment the scroll position
 * stops changing, progress settles and rendering stops. Evaluating the scene
 * at a given scroll position therefore always produces the same frame,
 * whichever way you arrived there.
 *
 * Rendering is on demand: a scroll event asks for one frame; a frame asks for
 * another only while progress is still catching up.
 */

/** Catch-up time constant (seconds). */
const TAU = 0.005;
/** Below this difference (in progress units, ≈ ½ px of scroll) progress snaps to the scroll position. */
const EPS = 4e-5;

export type TimelineListener = (t: Timeline) => void;

export class Timeline {
  /** Scroll progress read from the page, 0..1. */
  target = 0;
  /** Displayed progress (what everything is drawn at), 0..1. */
  progress = 0;
  /** Story position derived from progress, 0..CHAPTER_COUNT. */
  s = 0;
  /** Story seconds derived from s (phase for repeating gestures). */
  clock = 0;
  /** True once progress has caught up with the scroll position. */
  settled = true;

  private start = 0;
  private length = 1;
  private last = -1;
  private raf = 0;
  private renderer: (() => void) | null = null;
  private listeners = new Set<TimelineListener>();

  /** Pixel range of the pinned track (measured on layout changes, never per frame). */
  setTrack(start: number, length: number) {
    this.start = start;
    this.length = Math.max(1, length);
  }

  /** Current scroll progress. Reading scrollY does not force layout. */
  read(): number {
    const p = (window.scrollY - this.start) / this.length;
    this.target = p < 0 ? 0 : p > 1 ? 1 : p;
    return this.target;
  }

  /** Jump straight to the scroll position (first paint, resize) — no catch-up. */
  jump() {
    this.read();
    this.progress = this.target;
    this.derive();
    this.settled = true;
  }

  /**
   * While the 3D canvas is live it renders the frames (and calls `tick`
   * itself); otherwise the timeline runs its own rAF for the DOM layer.
   */
  setRenderer(render: (() => void) | null) {
    this.renderer = render;
    if (render && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  subscribe(fn: TimelineListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Ask for a frame (scroll, resize, first mount). */
  request() {
    if (this.renderer) this.renderer();
    else if (!this.raf) {
      this.raf = requestAnimationFrame((now) => {
        this.raf = 0;
        this.tick(now);
      });
    }
  }

  /** Advance to the current scroll position. Called once per rendered frame. */
  tick(now: number) {
    this.read();
    const dt = this.last < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    const d = this.target - this.progress;
    if (Math.abs(d) <= EPS) {
      this.progress = this.target;
      this.settled = true;
      this.last = -1;
    } else {
      this.progress += d * (1 - Math.exp(-dt / TAU));
      this.settled = false;
      this.last = now;
    }
    this.derive();
    this.listeners.forEach((fn) => fn(this));
    if (!this.settled) this.request();
  }

  private derive() {
    this.s = progressToStory(this.progress);
    this.clock = clockAt(this.s);
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer = null;
    this.listeners.clear();
  }
}
