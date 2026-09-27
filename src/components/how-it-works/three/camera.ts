import * as THREE from "three";
import type { StageLayout, StageMetrics } from "../stage-layout";
import { CH } from "../story";
import { GLOBE_CENTER } from "./globe-math";
import { flightU, planeHeight } from "./GlobeWorld";
import { carX } from "./scenes/ChapterDeliver";
import { HOME } from "./home";

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

const TOP: [number, number, number] = [0, 0, 0];

/** Chase shots ride with the plane: its height above the ground point under it, at chapter-5 progress t. */
const chase = (t: number, pitch: number, frame: [number, number], tall: TallOverride = { fit: 1 }) =>
  shot(CH.ship, t, [0, planeHeight(flightU(t)) - 0.1, 0], 0.42, pitch, frame, tall);
/** Tracking shots follow the car along the street, at chapter-7 progress t. */
const track = (t: number, yaw: number, pitch: number, frame: [number, number], tall: TallOverride = {}) =>
  shot(CH.deliver, t, [carX(t) - 0.3, 0.95, 0.25], yaw, pitch, frame, tall);

export const SHOTS: Shot[] = [
  // 1 — Pick Your Parts: establishing shot, then in on the conversation and the parts.
  shot(CH.parts, 0.0, [0.05, 1.12, 0.12], 0.22, 0.27, [6.2, 3.3], { fit: 0.86 }),
  shot(CH.parts, 0.12, [0, 1.14, 0.1], 0.1, 0.27, [5.3, 2.95], { fit: 0.86 }),
  shot(CH.parts, 0.3, [0.38, 1.3, 0.12], -0.12, 0.24, [4.7, 2.85], { target: [0.12, 1.26, 0.12], frame: [4.9, 2.85] }),
  shot(CH.parts, 0.46, [0.08, 1.2, 0.1], -0.04, 0.27, [4.9, 2.8]),
  shot(CH.parts, 0.74, [0, 1.23, 0.1], 0.05, 0.27, [4.8, 2.7]),
  shot(CH.parts, 1.0, [0, 1.3, 0.06], 0.02, 0.24, [5.1, 3.0]),
  // 2 — Review Your Quotation: rise to make room for the quotation, lean in while it is read.
  shot(CH.quote, 0.14, [0, 1.42, 0], 0.04, 0.22, [5.2, 3.25]),
  shot(CH.quote, 0.6, [0.12, 1.42, 0.05], -0.1, 0.19, [4.9, 3.1], { target: [0.05, 1.42, 0.05] }),
  shot(CH.quote, 1.0, [0, 1.42, 0.05], 0, 0.21, [5.2, 3.2]),
  // 3 — Confirm Your Order: phone, transfer, terminal + receipt, the slide across the table, confirmation, handshake.
  shot(CH.confirm, 0.1, [0.62, 1.3, 0.28], -0.24, 0.22, [3.6, 2.4], { target: [0.75, 1.3, 0.28] }),
  shot(CH.confirm, 0.3, [0.05, 1.28, 0.2], -0.03, 0.24, [4.8, 2.7]),
  shot(CH.confirm, 0.45, [-0.62, 1.18, 0.28], 0.1, 0.3, [3.3, 2.25], { target: [-0.78, 1.18, 0.28] }),
  shot(CH.confirm, 0.56, [0.05, 1.12, 0.3], 0, 0.36, [4.7, 2.6]),
  shot(CH.confirm, 0.64, [0.45, 1.3, 0.22], -0.12, 0.26, [4.4, 2.8], { target: [0.62, 1.3, 0.22] }),
  shot(CH.confirm, 0.74, [0, 1.46, 0.2], 0, 0.24, [5.0, 3.15]),
  shot(CH.confirm, 0.9, [0, 1.3, 0.85], 0, 0.18, [3.7, 2.8]),
  shot(CH.confirm, 1.0, [0, 1.36, 0.8], 0.04, 0.2, [4.1, 3.0]),
  // 4 — Sourced From The U.S.: the order on the tablet, crane up to the globe, suppliers, the hub.
  shot(CH.source, 0.02, [0, 1.36, 0.8], 0.04, 0.2, [4.1, 3.0]),
  shot(CH.source, 0.1, [-0.2, 1.25, 1.0], 0.1, 0.2, [3.3, 2.35], { target: [-0.3, 1.25, 1.0] }),
  shot(CH.source, 0.17, [0, 1.3, 0.8], 0.04, 0.24, [4.2, 2.9]),
  shot(CH.source, 0.25, [0, 0.9, 0.4], 0, 0.7, [7.5, 5.2], WHOLE),
  shot(CH.source, 0.36, GLOBE, 0, 1.5, [23, 23], WHOLE),
  shot(CH.source, 0.48, TOP, 0, 1.42, [14, 10], WHOLE),
  shot(CH.source, 0.62, TOP, 0, 1.36, [13, 9.5], WHOLE),
  shot(CH.source, 0.84, TOP, 0, 1.28, [8.5, 6.2], WHOLE),
  shot(CH.source, 1.0, TOP, 0, 1.28, [8.5, 6.2], WHOLE),
  // 5 — Shipped to Qatar: the plane collects the parcel, then a chase across the arc; pull up over Qatar.
  shot(CH.ship, 0.04, TOP, 0, 1.28, [8.5, 6.2], WHOLE),
  shot(CH.ship, 0.12, [0, 0.35, 0], 0, 1.0, [7.0, 5.0], WHOLE),
  chase(0.22, 0.62, [6.4, 4.2]),
  chase(0.36, 0.5, [6.0, 4.0]),
  chase(0.5, 0.48, [6.0, 4.0]),
  chase(0.64, 0.5, [6.0, 4.0]),
  chase(0.76, 0.62, [6.6, 4.4]),
  shot(CH.ship, 0.88, TOP, 0, 1.3, [13, 9.5], WHOLE),
  shot(CH.ship, 1.0, TOP, 0, 1.42, [15, 11], WHOLE),
  // 6 — Built & Set Up: dive back into Qatar, assemble, power on, set up Windows at the monitor.
  shot(CH.build, 0.14, [0.1, 1.15, 0], -0.05, 0.34, [5.4, 3.0]),
  shot(CH.build, 0.3, [0.05, 1.36, 0.05], -0.12, 0.25, [3.5, 2.25], { target: [0.3, 1.3, 0.05] }),
  shot(CH.build, 0.5, [0.02, 1.36, 0.05], -0.08, 0.24, [3.7, 2.35], { target: [0.2, 1.3, 0.05] }),
  shot(CH.build, 0.63, [-0.1, 1.3, 0.1], -0.02, 0.24, [4.2, 2.6]),
  shot(CH.build, 0.73, [-0.95, 1.3, 0], 0.3, 0.22, [3.6, 2.4]),
  shot(CH.build, 0.88, [-0.9, 1.3, 0], 0.26, 0.22, [3.7, 2.45]),
  shot(CH.build, 1.0, [-0.55, 1.28, 0.25], 0.12, 0.24, [4.6, 2.85]),
  // 7 — Delivered to Your Home: to the car, into the boot, in, the drive, out, the boot, the front door.
  shot(CH.deliver, 0.03, [-0.55, 1.28, 0.25], 0.12, 0.24, [4.6, 2.85]),
  shot(CH.deliver, 0.09, [-0.35, 1.15, 0.55], 0.05, 0.26, [4.4, 2.8]),
  shot(CH.deliver, 0.14, [-3.2, 1.05, 0.75], 0.45, 0.27, [6.0, 3.4], { fit: 1 }),
  shot(CH.deliver, 0.2, [-7.2, 0.95, -0.1], 0.62, 0.3, [4.6, 2.9], { fit: 1 }),
  shot(CH.deliver, 0.27, [-8.9, 1.0, 0.65], 0.42, 0.24, [5.4, 3.1], { fit: 1 }),
  shot(CH.deliver, 0.335, [-10.1, 0.95, 0.95], 0.5, 0.2, [4.4, 2.8], { fit: 1 }),
  shot(CH.deliver, 0.39, [-10.7, 0.95, 0.4], 0.28, 0.24, [6.2, 3.4], { fit: 1 }),
  track(0.43, -0.3, 0.22, [7.0, 3.8], { fit: 1 }),
  track(0.47, -0.3, 0.22, [7.0, 3.8], { fit: 1 }),
  track(0.51, -0.3, 0.22, [7.0, 3.8], { fit: 1 }),
  track(0.55, -0.27, 0.22, [7.0, 3.8], { fit: 1 }),
  track(0.58, -0.2, 0.22, [7.0, 3.8], { fit: 1 }),
  shot(CH.deliver, 0.615, [HOME.x - 1.8, 1.05, 0.4], 0.35, 0.24, [6.2, 3.5], { fit: 1 }),
  shot(CH.deliver, 0.67, [HOME.x - 2.1, 0.95, 0.95], 0.5, 0.2, [4.4, 2.8], { fit: 1 }),
  shot(CH.deliver, 0.74, [HOME.x - 0.5, 1.0, 0.7], 0.35, 0.24, [5.4, 3.1], { fit: 1 }),
  shot(CH.deliver, 0.79, [HOME.x + 0.8, 0.95, -0.15], 0.62, 0.3, [4.6, 2.9], { fit: 1 }),
  shot(CH.deliver, 0.86, [HOME.x + 2.0, 1.3, -1.5], 0.2, 0.24, [5.4, 3.2], { fit: 0.95 }),
  shot(CH.deliver, 0.91, [HOME.x + 2.25, 1.25, -2.28], -0.05, 0.16, [4.0, 2.7], { fit: 0.9 }),
  shot(CH.deliver, 0.965, [HOME.x + 2.2, 1.38, -2.1], -0.1, 0.2, [5.0, 3.2], { fit: 0.95 }),
  shot(CH.deliver, 1.0, [HOME.x + 2.2, 1.38, -2.1], -0.1, 0.2, [5.0, 3.2], { fit: 0.95 }),
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
  /** World-space width of the framed subject (for light/shadow sizing). */
  frameW: number;
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
  out.frameW = fw;
  out.position.set(
    out.target.x + out.dist * Math.cos(pitch) * Math.sin(yaw),
    out.target.y + out.dist * Math.sin(pitch),
    out.target.z + out.dist * Math.cos(pitch) * Math.cos(yaw),
  );
  return out;
}
