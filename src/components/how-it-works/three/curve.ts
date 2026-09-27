/**
 * Monotone cubic interpolation (Steffen 1990) through sorted (x, y) points.
 * Never overshoots between points, so profiles built from it (the car's
 * roofline, hood and bumpers) are smooth without wobbles.
 */
export function monotone(points: readonly (readonly [number, number])[]): (x: number) => number {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const p = (d[i - 1] * h[i] + d[i] * h[i - 1]) / (h[i - 1] + h[i]);
    m[i] = (Math.sign(d[i - 1]) + Math.sign(d[i])) * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]), 0.5 * Math.abs(p));
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const hk = h[k];
    const u = (x - xs[k]) / hk;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * hk * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * hk * m[k + 1]
    );
  };
}
