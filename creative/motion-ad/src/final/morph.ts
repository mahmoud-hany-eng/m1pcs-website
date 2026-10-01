import OUTLINE from "../data/emblem-outline.json";

/**
 * Outline morphing for the CTA transition: the pressed pill's own outline
 * deforms into the silhouette of the real M1 emblem (traced from logo.png's
 * alpha, 32 vertices). Both outlines run clockwise from their top-left —
 * the pill's straight top edge folds down into the emblem's V notch.
 */
type P = { x: number; y: number };
export const N = 160;

function resample(poly: P[], n: number): P[] {
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
    while (acc + seg[i] < target) {
      acc += seg[i];
      i = (i + 1) % poly.length;
    }
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const u = seg[i] > 0 ? (target - acc) / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

/** emblem silhouette in logo source px, resampled */
export const EMBLEM = resample((OUTLINE as number[][]).map(([x, y]) => ({ x, y })), N);

/** a stadium (pill) outline, clockwise from its top-left tangent point */
export function pill(x0: number, y0: number, w: number, h: number): P[] {
  const r = h / 2;
  const pts: P[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let k = 0; k <= 16; k++) {
      const a = a0 + ((a1 - a0) * k) / 16;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  pts.push({ x: x0 + r, y: y0 });
  pts.push({ x: x0 + w - r, y: y0 });
  arc(x0 + w - r, y0 + r, -Math.PI / 2, Math.PI / 2);
  pts.push({ x: x0 + r, y: y0 + h });
  arc(x0 + r, y0 + r, Math.PI / 2, (3 * Math.PI) / 2);
  return resample(pts, N);
}

export const lerpPoly = (a: P[], b: P[], k: number) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
export const polyPath = (p: P[]) => "M" + p.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" L") + " Z";
