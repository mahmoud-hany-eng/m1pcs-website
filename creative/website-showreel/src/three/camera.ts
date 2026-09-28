import { smoothstep } from "./easing";

export interface CamKey {
  /** Global progress through the 30s reference timeline, 0..1. */
  t: number;
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/**
 * One continuous camera move through every "room" of the site. Each key's
 * `look` is kept close to the (x, y) of whatever plane is actually focal at
 * that moment (see Showreel.tsx's station positions) — the camera dollies
 * (position changes) rather than zooms (fov stays in a narrow band), with
 * only a small deliberate offset between `pos` and `look` for an angled,
 * not dead-centred, composition.
 */
export const CAMERA_KEYS: CamKey[] = [
  // ---- Scene 1: logo -> home hero
  { t: 0.0, pos: [0, 0.5, 9.5], look: [0, 0.5, 4.4], fov: 27 },
  { t: 0.05, pos: [0, 0.4, 5.0], look: [0, 0.4, 1.0], fov: 26 },
  { t: 0.1, pos: [0.15, 0.3, 0.6], look: [0, 0.32, -2.4], fov: 27 },
  // ---- Scene 2: navigate toward Build My PC (same x=0 axis as home — a
  // gentle push, not a lateral swing, since the two rooms share centre).
  { t: 0.16, pos: [0.25, 0.28, -3.2], look: [0, 0.31, -7], fov: 27 },
  // ---- Scene 3: Build My PC — stage, then the pill / form / preference detail cards
  { t: 0.233, pos: [0.2, 0.28, -7.0], look: [0, 0.3, -10.0], fov: 26 },
  { t: 0.29, pos: [0.15, 0.15, -9.0], look: [0, 0.1, -11.5], fov: 24 },
  { t: 0.35, pos: [0.1, 0.2, -9.3], look: [0, 0.15, -12.0], fov: 23 },
  { t: 0.44, pos: [0.1, -0.3, -10.3], look: [0.05, -0.6, -12.6], fov: 24 },
  { t: 0.4667, pos: [0.1, 0.22, -13.0], look: [0, 0.2, -16.0], fov: 26 },
  // ---- Scene 4: quote / WhatsApp CTA
  { t: 0.53, pos: [0.1, 0.26, -17.3], look: [0, 0.28, -20.5], fov: 26 },
  { t: 0.56, pos: [0.05, 0.15, -19.0], look: [0, 0.1, -21.8], fov: 24 },
  { t: 0.6, pos: [0, 0.1, -18.5], look: [0, 0.05, -21.0], fov: 25 },
  // ---- Scene 5: completed builds — pull back for the group, then track laterally
  { t: 0.63, pos: [0, 0.35, -27.0], look: [0, 0.15, -32.0], fov: 30 },
  { t: 0.665, pos: [-2.4, 0.3, -28.6], look: [-2.2, 0.2, -32.6], fov: 25 },
  { t: 0.7, pos: [0, 0.25, -29.5], look: [0, 0.1, -33.5], fov: 25 },
  { t: 0.7667, pos: [2.4, 0.3, -28.6], look: [2.2, 0.2, -32.6], fov: 25 },
  // ---- Scene 6: How It Works — the site's own step copy, a gentle push through
  { t: 0.82, pos: [0, 0.25, -38.5], look: [0, 0.15, -42.0], fov: 27 },
  { t: 0.88, pos: [0, 0.22, -41.5], look: [0, 0.15, -44.5], fov: 26 },
  { t: 0.897, pos: [0, 0.2, -42.3], look: [0, 0.15, -44.8], fov: 25 },
  // ---- Scene 7: desktop -> mobile -> CTA
  { t: 0.92, pos: [0.3, 0.2, -48.5], look: [0.4, 0.15, -52.0], fov: 27 },
  { t: 0.945, pos: [0.4, 0.18, -52.5], look: [0.5, 0.12, -55.5], fov: 25 },
  { t: 0.965, pos: [0.05, 0.15, -54.3], look: [0.1, 0.1, -57.0], fov: 24 },
  { t: 0.985, pos: [-0.3, 0.12, -55.7], look: [-0.35, 0.08, -58.0], fov: 23 },
  { t: 1.0, pos: [-0.25, 0.1, -56.3], look: [-0.3, 0.08, -58.3], fov: 24 },
];

function lerp3(a: [number, number, number], b: [number, number, number], u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export interface CamSample {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/** Samples the camera rig at global progress `t` (0..1), with a tiny
 * handheld-style sway layered on top so the move never feels locked-off. */
export function sampleCamera(t: number, seconds: number): CamSample {
  const keys = CAMERA_KEYS;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = smoothstep(a.t, b.t, t);
  const pos = lerp3(a.pos, b.pos, u);
  const look = lerp3(a.look, b.look, u);
  const fov = a.fov + (b.fov - a.fov) * u;

  // Subtle organic drift (amplitude tiny enough to never read as shake, and
  // far too small to push any focal plane out of frame).
  const sway = 0.02 * Math.sin(seconds * 0.7) + 0.01 * Math.sin(seconds * 1.9 + 1.3);
  const bob = 0.014 * Math.sin(seconds * 0.55 + 0.6);
  pos[0] += sway;
  pos[1] += bob;
  look[0] += sway * 0.5;

  return { pos, look, fov };
}
