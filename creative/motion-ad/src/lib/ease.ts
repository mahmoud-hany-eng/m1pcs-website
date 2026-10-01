// Easing + small maths helpers shared by every shot. All motion in the ad is
// a pure function of time, so renders are deterministic frame-for-frame.

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const range = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** CSS-identical cubic-bezier easing. */
export function bezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-7) break;
      t -= e / d;
    }
    // bisection fallback for flat derivative regions
    let lo = 0, hi = 1;
    for (let i = 0; i < 20 && Math.abs(sx(t) - x) > 1e-6; i++) {
      t = (lo + hi) / 2;
      if (sx(t) < x) lo = t;
      else hi = t;
    }
    return sy(t);
  };
}

export const ease = {
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  inCubic: (x: number) => x * x * x,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x: number, s = 1.2) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  /** premium "settle": fast arrival, long soft tail */
  settle: bezier(0.16, 1, 0.3, 1),
  /** slow start, hard acceleration — for moves INTO transitions */
  accelerate: bezier(0.7, 0, 0.84, 0),
  swift: bezier(0.65, 0, 0.35, 1),
};

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
