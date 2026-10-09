import { CHAPTERS, CHAPTER_COUNT } from "./story";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Fast-forward / rewind speed floor, in chapters per second (about a second per chapter). */
const FAST_FORWARD = 0.9;
/** Deceleration (chapters/s²) from fast-forward into the requested chapter's designed pace. */
const LANDING_BRAKE = 1.2;

/**
 * Time-based story position. Scroll only sets `target` (the end of the
 * chapter the visitor asked for); the playhead then travels there at the
 * chapter's designed speed with eased starts and stops, so:
 *  - motion is always smooth and at a readable pace (no wheel-notch stepping),
 *  - nothing is ever skipped: if someone scrolls several chapters ahead, the
 *    chapters in between play in order, fast-forwarded,
 *  - scrolling back plays the story in reverse (every frame is a pure
 *    function of the position).
 */
export class Playhead {
  /** Story position, 0..CHAPTER_COUNT. */
  s = 0;
  /** Velocity in chapters per second. */
  v = 0;
  target = 1;

  setTargetChapter(index: number) {
    this.target = clamp(index, 0, CHAPTER_COUNT - 1) + 1;
  }

  get resting() {
    return this.s === this.target;
  }

  /** Jump straight to a position (used when the story mounts mid-page). */
  snap(chapter: number) {
    this.setTargetChapter(chapter);
    this.s = this.target;
    this.v = 0;
  }

  update(dtSeconds: number) {
    const dt = Math.min(dtSeconds, 1 / 20);
    const d = this.target - this.s;
    const dist = Math.abs(d);
    if (dist < 1e-4 && Math.abs(this.v) < 0.02) {
      this.s = this.target;
      this.v = 0;
      return;
    }
    const dir = Math.sign(d);
    // Chapter currently being played (the one the playhead is inside).
    const idx = clamp(Math.floor(dir > 0 ? this.s : this.s - 1e-6), 0, CHAPTER_COUNT - 1);
    const base = 1 / CHAPTERS[idx].duration;
    // The requested chapter plays at its designed pace. Anything on the way —
    // the rest of the current chapter, chapters skipped over, or a rewind —
    // fast-forwards in about a second, so a scroll always answers promptly.
    const fast = Math.max(base * 2.6, FAST_FORWARD);
    let vMax = fast;
    if (dir > 0) {
      // Brake from fast-forward into the designed pace right as the requested chapter begins.
      const landing = 1 / CHAPTERS[clamp(Math.ceil(this.target) - 1, 0, CHAPTER_COUNT - 1)].duration;
      const zone = dist - 1;
      vMax = zone > 0 ? Math.min(fast, Math.sqrt(landing * landing + 2 * LANDING_BRAKE * zone)) : landing;
    }
    // Reach full speed in ~0.6 s (fast-forwards in ~0.45 s); brake early enough to glide into the rest frame.
    const ramp = vMax > base * 1.5 ? 2.2 : 1.7;
    const accel = Math.max(0.1, Math.max(vMax, Math.abs(this.v)) * ramp);
    const vWanted = dir * Math.min(vMax, Math.sqrt(2 * accel * dist));
    const dv = vWanted - this.v;
    const braking = Math.sign(dv) !== Math.sign(this.v) && this.v !== 0;
    const maxStep = accel * dt * (braking ? 2 : 1);
    this.v += clamp(dv, -maxStep, maxStep);
    this.s += this.v * dt;
    if ((dir > 0 && this.s > this.target) || (dir < 0 && this.s < this.target)) {
      this.s = this.target;
      this.v = 0;
    }
    this.s = clamp(this.s, 0, CHAPTER_COUNT);
  }
}
