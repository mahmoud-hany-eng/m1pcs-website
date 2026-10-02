import OUTLINE from "../data/emblem-outline.json";

/** Emblem geometry (traced from the real logo.png alpha, source px) shared by the opening and the ending. */
export type P = { x: number; y: number };
export const SEAM = 2258;
export const LOGO_SRC = { w: 4500, h: 5625 };
export const V_TRI = { l: { x: 801, y: 585 }, r: { x: 3714, y: 577 }, apex: { x: 2258, y: 1581 } };
export function clipHalf(poly: P[], keepLeft: boolean): P[] {
  const inside = (p: P) => (keepLeft ? p.x <= SEAM : p.x >= SEAM);
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const u = (SEAM - a.x) / (b.x - a.x);
      out.push({ x: SEAM, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}
export function resample(poly: P[], n: number): P[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }
  const out: P[] = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i] < target) { acc += seg[i]; i = (i + 1) % poly.length; }
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const u = seg[i] > 0 ? (target - acc) / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}
export const rotateTo = (poly: P[], start: P) => {
  let bi = 0, bd = Infinity;
  poly.forEach((p, i) => { const d = Math.hypot(p.x - start.x, p.y - start.y); if (d < bd) { bd = d; bi = i; } });
  return [...poly.slice(bi), ...poly.slice(0, bi)];
};
export const N = 140;
export const EMB = (OUTLINE as number[][]).map(([x, y]) => ({ x, y }));
export const LEFT = resample(rotateTo(clipHalf(EMB, true), { x: 801, y: 585 }), N);
export const RIGHT = resample(rotateTo(clipHalf(EMB, false), { x: SEAM, y: 1581 }), N);
export const pathOf = (p: P[]) => "M" + p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" L") + " Z";
export const lerpP = (a: P[], b: P[], k: number) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
