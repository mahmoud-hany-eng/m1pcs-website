import * as THREE from "three";
import type { StageLayout, StageMetrics } from "../stage-layout";
import { GLOBE_CENTER } from "./globe-math";

/**
 * Story-driven camera. Each shot describes *what must be in frame*: a
 * target point, an orbit angle (yaw/pitch) and the world-space size of the
 * subject. The distance is solved every frame from the stage metrics, so the
 * subject always fills — and is centred in — the free area between the
 * progress bar and the caption on any screen size or orientation.
 *
 * Shots are keyframes on the scroll timeline, joined by a monotone cubic
 * spline (Steffen's method): the camera glides through keyframes at a
 * steady pace when you scroll steadily, never overshoots, and — being a pure
 * function of the story position — stops the instant the scroll does.
 *
 * Studio coordinates: table centre at the origin, customer's side +X,
 * camera side +Z; the customer's home sits to the east (+X). `at` is the
 * story position (chapter index + local 0..1).
 */
export const FOV = 30;

interface View {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  /** [width, height] of the subject in world units. */
  frame: [number, number];
}

export interface Shot {
  at: number;
  wide: View;
  /** Portrait / phone framing of the same moment. */
  tall: View;
}

interface TallOverride {
  target?: [number, number, number];
  yaw?: number;
  pitch?: number;
  frame?: [number, number];
  /**
   * Share of the subject width that must fit on portrait screens. Studio
   * shots crop the table ends a little (0.8) so the figures read larger;
   * the globe and the neighbourhood always fit whole (1).
   */
  fit?: number;
}

const G = GLOBE_CENTER;
const GLOBE: [number, number, number] = [G.x, G.y, G.z];
const WHOLE: TallOverride = { fit: 1 };

function shot(
  chapter: number,
  local: number,
  target: [number, number, number],
  yaw: number,
  pitch: number,
  frame: [number, number],
  tall: TallOverride = {},
): Shot {
  const fit = tall.fit ?? 0.8;
  const tallFrame = tall.frame ?? frame;
  return {
    at: chapter + local,
    wide: { target, yaw, pitch, frame },
    tall: { target: tall.target ?? target, yaw: tall.yaw ?? yaw, pitch: tall.pitch ?? pitch, frame: [tallFrame[0] * fit, tallFrame[1]] },
  };
}

export const SHOTS: Shot[] = [
  // 1 — Pick Your Parts: establishing shot, then in on the conversation and the parts.
  shot(0, 0.0, [0.05, 1.12, 0.12], 0.22, 0.27, [6.2, 3.3], { fit: 0.86 }),
  shot(0, 0.14, [0, 1.14, 0.1], 0.1, 0.27, [5.3, 2.95], { fit: 0.86 }),
  shot(0, 0.33, [0.38, 1.3, 0.12], -0.12, 0.24, [4.7, 2.85], { target: [0.12, 1.26, 0.12], frame: [4.9, 2.85] }),
  shot(0, 0.5, [0.08, 1.2, 0.1], -0.04, 0.27, [4.9, 2.8]),
  shot(0, 0.74, [0, 1.23, 0.1], 0.05, 0.27, [4.8, 2.7]),
  shot(0, 1.0, [0, 1.3, 0.06], 0.02, 0.24, [5.1, 3.0]),
  // 2 — Review Your Quotation: rise to make room for the quotation, lean in while it is read.
  shot(1, 0.14, [0, 1.42, 0], 0.04, 0.22, [5.2, 3.25]),
  shot(1, 0.6, [0.12, 1.42, 0.05], -0.1, 0.19, [4.9, 3.1], { target: [0.05, 1.42, 0.05] }),
  shot(1, 1.0, [0, 1.42, 0.05], 0, 0.21, [5.2, 3.2]),
  // 3 — Confirm Your Order: phone, transfer, terminal, confirmation, handshake.
  shot(2, 0.12, [0.62, 1.3, 0.28], -0.24, 0.22, [3.6, 2.4], { target: [0.75, 1.3, 0.28] }),
  shot(2, 0.3, [0.05, 1.28, 0.2], -0.03, 0.24, [4.8, 2.7]),
  shot(2, 0.44, [-0.7, 1.22, 0.25], 0.06, 0.26, [3.4, 2.3], { target: [-0.85, 1.22, 0.25] }),
  shot(2, 0.58, [0, 1.46, 0.2], 0, 0.24, [5.0, 3.15]),
  shot(2, 0.84, [0, 1.3, 0.85], 0, 0.18, [3.7, 2.8]),
  shot(2, 1.0, [0, 1.36, 0.8], 0.04, 0.2, [4.1, 3.0]),
  // 4 — Sourced From The U.S.: crane up and out until the studio is a pin on the globe.
  shot(3, 0.03, [0, 1.3, 0.8], 0.04, 0.2, [4.2, 2.9]),
  shot(3, 0.13, [0, 0.9, 0.4], 0, 0.7, [7.5, 5.2], WHOLE),
  shot(3, 0.3, GLOBE, 0, 1.5, [23, 23], WHOLE),
  shot(3, 0.42, GLOBE, 0, 1.5, [21.5, 21.5], WHOLE),
  shot(3, 0.62, GLOBE, 0, 1.5, [23.5, 23.5], WHOLE),
  shot(3, 1.0, GLOBE, 0, 1.5, [23.5, 23.5], WHOLE),
  // 5 — Built & Set Up: dive back into Qatar, assemble, set up Windows at the monitor.
  shot(4, 0.14, [0.1, 1.15, 0], -0.05, 0.34, [5.4, 3.0]),
  shot(4, 0.3, [0.05, 1.36, 0.05], -0.12, 0.25, [3.5, 2.25], { target: [0.3, 1.3, 0.05] }),
  shot(4, 0.47, [0.02, 1.36, 0.05], -0.08, 0.24, [3.7, 2.35], { target: [0.2, 1.3, 0.05] }),
  shot(4, 0.62, [-0.95, 1.3, 0], 0.3, 0.22, [3.6, 2.4]),
  shot(4, 0.8, [-0.9, 1.3, 0], 0.26, 0.22, [3.7, 2.45]),
  shot(4, 1.0, [-0.55, 1.28, 0.25], 0.12, 0.24, [4.6, 2.85]),
  // 6 — Delivered to Your Door: pick up, load the van, drive to the customer's home, hand over.
  shot(5, 0.08, [-0.25, 1.22, 0.5], 0.02, 0.26, [4.4, 2.75]),
  shot(5, 0.2, [1.3, 1.1, 1.7], -0.28, 0.32, [6.0, 3.4], WHOLE),
  shot(5, 0.32, [3.1, 0.95, 2.3], -0.2, 0.34, [6.4, 3.6], { target: [3.3, 0.95, 2.3], frame: [5.0, 3.8], fit: 1 }),
  shot(5, 0.47, [7.4, 0.9, 2.0], -0.06, 0.42, [10.5, 5.6], { target: [7.9, 0.9, 2.2], frame: [6.4, 4.6], fit: 1 }),
  shot(5, 0.54, [10.4, 1.0, 1.8], 0.02, 0.38, [8.8, 4.8], { target: [10.9, 1.0, 2.0], frame: [6.2, 4.4], fit: 1 }),
  shot(5, 0.6, [11.9, 1.1, 1.5], 0.05, 0.3, [7.4, 4.0], WHOLE),
  shot(5, 0.72, [12.6, 1.15, 1.6], -0.05, 0.26, [5.6, 3.2], { fit: 0.9 }),
  shot(5, 0.84, [12.1, 1.3, 1.0], -0.22, 0.22, [5.0, 3.1], { fit: 0.9 }),
  shot(5, 0.92, [12.0, 1.25, 1.0], -0.26, 0.2, [4.3, 2.8], { fit: 0.9 }),
  shot(5, 1.0, [12.0, 1.45, 0.75], -0.2, 0.2, [5.6, 3.6], { fit: 0.95 }),
];

// ---------------------------------------------------------------- monotone cubic spline

/** Channels: target xyz, yaw, pitch, log frame width, log frame height. */
const CHANNELS = 7;

interface Spline {
  t: number[];
  y: number[][];
  m: number[][];
}

function channelValues(v: View): number[] {
  return [v.target[0], v.target[1], v.target[2], v.yaw, v.pitch, Math.log(v.frame[0]), Math.log(v.frame[1])];
}

/** Steffen (1990) tangents: monotone between keyframes, zero at the ends. */
function buildSpline(layout: StageLayout): Spline {
  const t = SHOTS.map((s) => s.at);
  const vals = SHOTS.map((s) => channelValues(s[layout]));
  const y: number[][] = [];
  const m: number[][] = [];
  for (let c = 0; c < CHANNELS; c++) {
    const yc = vals.map((v) => v[c]);
    const n = yc.length;
    const h = t.slice(1).map((ti, i) => ti - t[i]);
    const d = h.map((hi, i) => (yc[i + 1] - yc[i]) / hi);
    const mc = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const p = (d[i - 1] * h[i] + d[i] * h[i - 1]) / (h[i - 1] + h[i]);
      mc[i] = (Math.sign(d[i - 1]) + Math.sign(d[i])) * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]), 0.5 * Math.abs(p));
    }
    y.push(yc);
    m.push(mc);
  }
  return { t, y, m };
}

const SPLINES: Record<StageLayout, Spline> = { wide: buildSpline("wide"), tall: buildSpline("tall") };
const scratch = new Array<number>(CHANNELS).fill(0);

function evaluateSpline(sp: Spline, s: number, out: number[]) {
  const { t, y, m } = sp;
  const n = t.length;
  if (s <= t[0] || s >= t[n - 1]) {
    const k = s <= t[0] ? 0 : n - 1;
    for (let c = 0; c < CHANNELS; c++) out[c] = y[c][k];
    return;
  }
  let k = 0;
  while (k < n - 2 && s > t[k + 1]) k++;
  const h = t[k + 1] - t[k];
  const u = (s - t[k]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let c = 0; c < CHANNELS; c++) {
    out[c] = h00 * y[c][k] + h10 * h * m[c][k] + h01 * y[c][k + 1] + h11 * h * m[c][k + 1];
  }
}

export interface CameraSample {
  target: THREE.Vector3;
  position: THREE.Vector3;
  dist: number;
}

/** Screen point (CSS px) the camera target is projected to: the centre of the free area. */
export function focusPoint(m: StageMetrics) {
  return { x: m.width / 2, y: m.top + (m.height - m.top - m.bottom) / 2 };
}

const TAN_HALF = Math.tan((FOV * Math.PI) / 360);

export function sampleCamera(s: number, m: StageMetrics, out: CameraSample): CameraSample {
  evaluateSpline(SPLINES[m.layout], s, scratch);
  out.target.set(scratch[0], scratch[1], scratch[2]);
  const yaw = scratch[3];
  const pitch = scratch[4];
  // Frame size is splined in log space so big zooms (studio <-> globe) stay evenly paced.
  const fw = Math.exp(scratch[5]);
  const fh = Math.exp(scratch[6]);

  const regionH = Math.max(0.2, (m.height - m.top - m.bottom) / m.height);
  const regionW = Math.max(0.2, (m.width - 2 * m.side) / m.width);
  const aspect = m.width / m.height;
  const dH = fh / 2 / (TAN_HALF * regionH);
  const dW = fw / 2 / (TAN_HALF * aspect * regionW);
  out.dist = Math.max(dH, dW);
  out.position.set(
    out.target.x + out.dist * Math.cos(pitch) * Math.sin(yaw),
    out.target.y + out.dist * Math.sin(pitch),
    out.target.z + out.dist * Math.cos(pitch) * Math.cos(yaw),
  );
  return out;
}
