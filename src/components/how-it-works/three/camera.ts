import * as THREE from "three";
import type { StageMetrics } from "../stage-layout";
import { lerp, smooth } from "./anim";
import { GLOBE_CENTER } from "./globe-math";

/**
 * Story-driven camera. Each shot describes *what must be in frame*: a
 * target point, an orbit angle (yaw/pitch) and the world-space size of the
 * subject. The distance is solved every frame from the stage metrics, so the
 * subject always fills — and is centred in — the free area between the
 * progress bar and the caption on any screen size or orientation.
 *
 * Studio coordinates: table centre at the origin, customer's side +X,
 * camera side +Z. `at` is the story position (chapter index + local 0..1).
 */
export const FOV = 30;

interface View {
  target: THREE.Vector3;
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
   * the globe always fits whole (1).
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
    wide: { target: new THREE.Vector3(...target), yaw, pitch, frame },
    tall: {
      target: new THREE.Vector3(...(tall.target ?? target)),
      yaw: tall.yaw ?? yaw,
      pitch: tall.pitch ?? pitch,
      frame: [tallFrame[0] * fit, tallFrame[1]],
    },
  };
}

export const SHOTS: Shot[] = [
  // 1 — Pick Your Parts: establishing shot, then in on the conversation and the parts.
  shot(0, 0.0, [0.05, 1.12, 0.12], 0.22, 0.27, [6.2, 3.3], { fit: 0.86 }),
  shot(0, 0.14, [0, 1.14, 0.1], 0.1, 0.27, [5.3, 2.95], { fit: 0.86 }),
  shot(0, 0.33, [0.38, 1.3, 0.12], -0.12, 0.24, [4.7, 2.85], { target: [0.12, 1.26, 0.12], frame: [4.9, 2.85] }),
  shot(0, 0.47, [0.08, 1.2, 0.1], -0.04, 0.27, [4.9, 2.8]),
  shot(0, 0.74, [0, 1.23, 0.1], 0.05, 0.27, [4.8, 2.7]),
  shot(0, 1.0, [0, 1.2, 0.08], 0, 0.27, [5.1, 2.85]),
  // 2 — Review Your Quotation: rise to make room for the quotation, lean in while it is read.
  shot(1, 0.12, [0, 1.42, 0], 0.04, 0.22, [5.2, 3.25]),
  shot(1, 0.6, [0.12, 1.42, 0.05], -0.1, 0.19, [4.9, 3.1], { target: [0.05, 1.42, 0.05] }),
  shot(1, 1.0, [0, 1.44, 0], 0, 0.22, [5.2, 3.25]),
  // 3 — Confirm Your Order: phone, transfer, terminal, confirmation, handshake.
  shot(2, 0.1, [0.62, 1.3, 0.28], -0.24, 0.22, [3.6, 2.4], { target: [0.75, 1.3, 0.28] }),
  shot(2, 0.3, [0.05, 1.28, 0.2], -0.03, 0.24, [4.8, 2.7]),
  shot(2, 0.44, [-0.7, 1.22, 0.25], 0.06, 0.26, [3.4, 2.3], { target: [-0.85, 1.22, 0.25] }),
  shot(2, 0.58, [0, 1.46, 0.2], 0, 0.24, [5.0, 3.15]),
  shot(2, 0.84, [0, 1.3, 0.85], 0, 0.18, [3.7, 2.8]),
  shot(2, 1.0, [0, 1.36, 0.8], 0.04, 0.2, [4.1, 3.0]),
  // 4 — Sourced From The U.S.: crane up and out until the studio is a pin on the globe.
  shot(3, 0.02, [0, 1.3, 0.8], 0.04, 0.2, [4.2, 2.9]),
  shot(3, 0.13, [0, 0.9, 0.4], 0, 0.7, [7.5, 5.2], WHOLE),
  shot(3, 0.3, GLOBE, 0, 1.5, [23, 23], WHOLE),
  shot(3, 0.42, GLOBE, 0, 1.5, [21.5, 21.5], WHOLE),
  shot(3, 0.62, GLOBE, 0, 1.5, [23.5, 23.5], WHOLE),
  shot(3, 1.0, GLOBE, 0, 1.5, [23.5, 23.5], WHOLE),
  // 5 — Built. Set Up. Delivered.: dive back into Qatar, assemble, set up, hand over.
  shot(4, 0.14, [0.1, 1.15, 0], -0.05, 0.34, [5.4, 3.0]),
  shot(4, 0.3, [0.05, 1.36, 0.05], -0.12, 0.25, [3.5, 2.25], { target: [0.3, 1.3, 0.05] }),
  shot(4, 0.46, [0.02, 1.36, 0.05], -0.08, 0.24, [3.7, 2.35], { target: [0.2, 1.3, 0.05] }),
  shot(4, 0.56, [-0.95, 1.3, 0], 0.3, 0.22, [3.6, 2.4]),
  shot(4, 0.72, [-0.9, 1.3, 0], 0.26, 0.22, [3.7, 2.45]),
  shot(4, 0.82, [0.3, 1.2, 0.3], 0.06, 0.24, [5.8, 3.0], { fit: 0.9 }),
  shot(4, 0.92, [0, 1.08, 0.95], 0, 0.2, [4.0, 2.55], { frame: [3.2, 2.55], fit: 1 }),
  shot(4, 1.0, [0, 1.22, 0.7], 0, 0.2, [5.0, 3.1], { target: [0, 1.15, 0.8], frame: [3.7, 3.0], fit: 1 }),
];

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
  let a = SHOTS[0];
  let b = SHOTS[0];
  let t = 0;
  if (s >= SHOTS[SHOTS.length - 1].at) {
    a = b = SHOTS[SHOTS.length - 1];
  } else if (s > SHOTS[0].at) {
    for (let i = 0; i < SHOTS.length - 1; i++) {
      if (s <= SHOTS[i + 1].at) {
        a = SHOTS[i];
        b = SHOTS[i + 1];
        t = smooth((s - a.at) / (b.at - a.at));
        break;
      }
    }
  }
  const va = a[m.layout];
  const vb = b[m.layout];
  out.target.lerpVectors(va.target, vb.target, t);
  const yaw = lerp(va.yaw, vb.yaw, t);
  const pitch = lerp(va.pitch, vb.pitch, t);
  // Log-space size interpolation keeps big zooms (studio <-> globe) evenly paced.
  const fw = Math.exp(lerp(Math.log(va.frame[0]), Math.log(vb.frame[0]), t));
  const fh = Math.exp(lerp(Math.log(va.frame[1]), Math.log(vb.frame[1]), t));

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
