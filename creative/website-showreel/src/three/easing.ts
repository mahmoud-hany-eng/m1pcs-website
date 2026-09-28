/** Smoothstep — used for every camera/element ease so motion reads as
 * physically damped (accelerate in, decelerate out), never linear or bouncy. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Same shape but sharper in the middle — for quick, deliberate UI pops. */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Progress (0..1) of `t` through window [a,b], clamped. */
export function windowT(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
