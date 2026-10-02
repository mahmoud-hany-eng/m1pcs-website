import { Camera, v3 } from "../v7/world";
import { CamKey } from "../v7/cams";

/**
 * One continuous camera move through the keys: a monotone cubic Hermite
 * (Fritsch–Carlson, harmonic-mean slopes) per component — position, yaw,
 * pitch, focal length. Velocity is continuous at every key (the camera glides
 * THROUGH a key instead of stopping on it), it never overshoots a key, and it
 * only comes to rest where a component turns round or where two keys repeat
 * (a hold).
 */
type Comp = (c: Camera) => number;
const COMPS: Comp[] = [(c) => c.pos.x, (c) => c.pos.y, (c) => c.pos.z, (c) => c.yaw, (c) => c.pitch, (c) => c.f];

export function makeSplineCam(input: CamKey[]) {
  // keys in time order; a key closer than 0.25 s to the previous one is folded into it (cue times move
  // with the narration — two keys must never land on top of each other or swap order)
  const keys: CamKey[] = [];
  for (const k of [...input].sort((a, b) => a.t - b.t)) {
    if (keys.length && k.t - keys[keys.length - 1].t < 0.25) continue;
    keys.push(k);
  }
  const ts = keys.map((k) => k.t);
  // unwrap yaw so the shortest way round is always taken
  const yaws: number[] = [];
  keys.forEach((k, i) => {
    if (!i) return yaws.push(k.cam.yaw);
    let y = k.cam.yaw;
    while (y - yaws[i - 1] > Math.PI) y -= 2 * Math.PI;
    while (y - yaws[i - 1] < -Math.PI) y += 2 * Math.PI;
    yaws.push(y);
  });
  const cols = COMPS.map((g, j) => (j === 3 ? yaws : keys.map((k) => g(k.cam))));
  const n = keys.length;
  const slopes = cols.map((ys) => {
    const d = (i: number) => (ys[i + 1] - ys[i]) / Math.max(1e-6, ts[i + 1] - ts[i]);
    return ys.map((_, i) => {
      if (i === 0 || i === n - 1) return 0;
      const a = d(i - 1), b = d(i);
      if (a * b <= 0) return 0;
      const h0 = ts[i] - ts[i - 1], h1 = ts[i + 1] - ts[i];
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; // weighted harmonic mean (Fritsch–Butland)
      return (w1 + w2) / (w1 / a + w2 / b);
    });
  });
  return (t: number): Camera => {
    if (t <= ts[0]) return keys[0].cam;
    if (t >= ts[n - 1]) return keys[n - 1].cam;
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (t - ts[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const val = cols.map((ys, j) => h00 * ys[i] + h10 * h * slopes[j][i] + h01 * ys[i + 1] + h11 * h * slopes[j][i + 1]);
    return { pos: v3(val[0], val[1], val[2]), yaw: val[3], pitch: val[4], f: val[5] };
  };
}

/**
 * Time-smoothing of a camera path (Gaussian, σ seconds): the move flows through every key at a
 * continuous speed — where a component's spline would come to rest between two keys, the
 * neighbouring motion carries it — and no key can produce a speed spike. Holds stay holds.
 */
export function smoothCam(cam: (t: number) => Camera, sigma: number, n = 31) {
  const offs: number[] = [], ws: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = ((i / (n - 1)) * 2 - 1) * 3 * sigma;
    offs.push(o);
    ws.push(Math.exp(-(o * o) / (2 * sigma * sigma)));
  }
  const W = ws.reduce((a, b) => a + b, 0);
  return (t: number): Camera => {
    let x = 0, y = 0, z = 0, yaw = 0, pitch = 0, f = 0;
    for (let i = 0; i < n; i++) {
      const c = cam(t + offs[i]);
      const w = ws[i] / W;
      x += c.pos.x * w; y += c.pos.y * w; z += c.pos.z * w; yaw += c.yaw * w; pitch += c.pitch * w; f += c.f * w;
    }
    return { pos: v3(x, y, z), yaw, pitch, f };
  };
}
