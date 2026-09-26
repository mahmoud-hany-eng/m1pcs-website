import * as THREE from "three";
import { globalAt } from "../story";
import { lerp, smooth } from "./anim";
import { GLOBE_CENTER } from "./globe-math";

/**
 * Scroll-driven camera path. Each key is an orbit around `target`
 * (yaw = around Y, pitch = elevation, dist = orbit radius) at a point in the
 * story expressed as [scene index, scene-local time]. Between keys the
 * camera eases (smoothstep), distance interpolates logarithmically so big
 * zooms (studio ↔ globe) feel even-paced.
 *
 * Studio coordinates: table centre at the origin, customer's side +X,
 * camera side +Z. The customer's home sits at x ≈ 7.6.
 */
export interface CameraKey {
  p: number;
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

const G = GLOBE_CENTER;

function key(scene: number, local: number, target: [number, number, number], yaw: number, pitch: number, dist: number, fov = 32): CameraKey {
  return { p: globalAt(scene, local), target: new THREE.Vector3(...target), yaw, pitch, dist, fov };
}

export const CAMERA_KEYS: CameraKey[] = [
  // 1 — Pick Your Parts: establishing shot, slow push-in and drift.
  key(0, 0.0, [0, 0.98, 0.15], 0.12, 0.3, 8.4),
  key(0, 0.45, [-0.05, 1.0, 0.1], -0.08, 0.32, 7.3),
  key(0, 0.9, [0.1, 1.02, 0.05], 0.06, 0.3, 7.2),
  // 2 — Review Your Quotation: rise to frame the floating board.
  key(1, 0.3, [0, 1.26, -0.05], 0.05, 0.22, 7.4),
  key(1, 0.85, [0.05, 1.28, 0], -0.07, 0.2, 7.1),
  // 3 — Confirm Your Order: closer on the customer, then the hand-over, then the high-five.
  key(2, 0.22, [0.3, 1.1, 0.25], -0.12, 0.27, 6.7),
  key(2, 0.5, [-0.1, 1.08, 0.2], 0.12, 0.3, 6.6),
  key(2, 0.84, [0, 1.12, 0.7], 0, 0.24, 6.9),
  // 4 — Sourced From The U.S.: crane up and out until the studio is a pin on the globe.
  key(3, 0.02, [0, 1.12, 0.6], 0, 0.26, 7.0),
  key(3, 0.12, [0, 0.9, 0.3], 0, 0.62, 10),
  key(3, 0.27, [G.x, G.y, G.z], 0, 1.5, 44),
  key(3, 0.46, [G.x, G.y, G.z], 0, 1.5, 38),
  key(3, 0.6, [G.x, G.y, G.z], 0, 1.5, 46),
  key(3, 0.92, [G.x, G.y, G.z], 0, 1.5, 40),
  // 5 — Built And Set Up By M1: dive back into Qatar, onto the workbench.
  key(4, 0.0, [G.x, G.y, G.z], 0, 1.5, 36),
  key(4, 0.17, [0.1, 1.08, 0], -0.05, 0.34, 6.8),
  key(4, 0.42, [0.1, 1.12, 0.05], -0.1, 0.28, 5.1),
  key(4, 0.72, [-0.85, 1.1, 0], 0.32, 0.26, 5.7),
  key(4, 0.97, [-0.15, 1.12, -0.3], 0.05, 0.26, 6.3),
  // 6 — Delivered To You: track the walk to the customer's door, then the hand-over.
  key(5, 0.04, [0.2, 1.12, -0.4], 0.1, 0.24, 6.6),
  key(5, 0.18, [3.9, 1.08, -0.3], 0.28, 0.2, 7.0),
  key(5, 0.34, [7.3, 1.18, -0.5], 0.14, 0.2, 6.9),
  key(5, 0.64, [7.45, 1.12, -0.35], -0.06, 0.18, 6.0),
  key(5, 0.86, [7.45, 1.16, -0.3], 0, 0.16, 6.8),
  key(5, 1.0, [7.45, 1.2, -0.3], 0.04, 0.18, 7.2),
];

export interface CameraSample {
  target: THREE.Vector3;
  position: THREE.Vector3;
  fov: number;
  dist: number;
}

export function sampleCamera(p: number, out: CameraSample, distScale = 1): CameraSample {
  const keys = CAMERA_KEYS;
  let a = keys[0];
  let b = keys[0];
  let t = 0;
  if (p <= keys[0].p) {
    a = b = keys[0];
  } else if (p >= keys[keys.length - 1].p) {
    a = b = keys[keys.length - 1];
  } else {
    for (let i = 0; i < keys.length - 1; i++) {
      if (p >= keys[i].p && p <= keys[i + 1].p) {
        a = keys[i];
        b = keys[i + 1];
        t = smooth((p - a.p) / (b.p - a.p));
        break;
      }
    }
  }
  out.target.lerpVectors(a.target, b.target, t);
  const yaw = lerp(a.yaw, b.yaw, t);
  const pitch = lerp(a.pitch, b.pitch, t);
  out.dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t)) * distScale;
  out.fov = lerp(a.fov, b.fov, t);
  out.position.set(
    out.target.x + out.dist * Math.cos(pitch) * Math.sin(yaw),
    out.target.y + out.dist * Math.sin(pitch),
    out.target.z + out.dist * Math.cos(pitch) * Math.cos(yaw),
  );
  return out;
}
