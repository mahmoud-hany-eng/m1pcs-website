/**
 * Small, dependency-free animation helpers. Every scene is a pure function of
 * scroll progress, so these are all stateless mappings — except `Spring`,
 * which only smooths *towards* a scroll-derived target (so reverse scrolling
 * still converges to exactly the same pose).
 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 before `a`, 1 after `b`, linear in between. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (x: number, s = 1.9) => {
  const t = clamp01(x) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
};

/** Smoothly rises 0→1 over [a,b] and falls back 1→0 over [c,d]. */
export const window4 = (t: number, a: number, b: number, c: number, d: number) =>
  smooth(seg(t, a, b)) * (1 - smooth(seg(t, c, d)));

/** A single 0→1→0 hump across [a,b]. */
export const bell = (t: number, a: number, b: number) => {
  const x = seg(t, a, b);
  return x <= 0 || x >= 1 ? 0 : Math.sin(x * Math.PI);
};

/** Critically-underdamped spring integrator (soft overshoot). */
export class Spring {
  x: number;
  v = 0;
  constructor(initial = 0) {
    this.x = initial;
  }
  step(target: number, dt: number, stiffness: number, damping: number) {
    // Two substeps keep stiff springs stable on long frames.
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      const a = (target - this.x) * stiffness - this.v * damping;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  snap(value: number) {
    this.x = value;
    this.v = 0;
  }
}

/** Deterministic PRNG so particle bursts replay identically in both scroll directions. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
