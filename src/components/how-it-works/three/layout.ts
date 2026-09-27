import * as THREE from "three";
import { TABLE_TOP_Y } from "./Stage";

/**
 * Shared studio-space layout. Origin = table centre on the stage floor,
 * +X = customer's side, +Z = towards the camera. Anything two scenes pass
 * between each other (parts -> quotation, PC -> customer) is placed from
 * these constants so hand-offs line up exactly.
 */

export { TABLE_TOP_Y };

export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

export const SPOTS = {
  // Consultation (chapters 1-3): either side of the table, turned to camera.
  rep: { x: -1.58, z: 0.18, yaw: 0.88 },
  customer: { x: 1.58, z: 0.18, yaw: -0.88 },
  // Handshake in front of the table, then a turn towards the camera.
  repShake: { x: -0.35, z: 1.02, yaw: 1.4 },
  customerShake: { x: 0.35, z: 1.02, yaw: -1.4 },
  repFront: { x: -0.42, z: 1.06, yaw: 0.42 },
  customerFront: { x: 0.42, z: 1.06, yaw: -0.42 },
  // Workshop (chapter 5): behind the bench, at the monitor, then the counter.
  repBench: { x: 0.52, z: -0.86, yaw: -0.22 },
  repSetup: { x: -1.74, z: 0.1, yaw: 1.05 },
  repCounter: { x: -0.12, z: -0.88, yaw: 0.05 },
  customerEnter: { x: 3.7, z: 1.35, yaw: -1.45 },
  customerCounter: { x: 0.28, z: 1.02, yaw: -0.12 },
  customerFinal: { x: 0.5, z: 1.2, yaw: -0.32 },
} satisfies Record<string, Spot>;

export const PART_IDS = ["cpu", "gpu", "ram", "storage", "board", "case", "cooler"] as const;
export type PartId = (typeof PART_IDS)[number];

/** Where each mini part hovers over the consultation table (chapter 1): a shallow arc along the front. */
export const PART_SLOTS = Object.fromEntries(
  PART_IDS.map((id, i) => {
    const x = -1.14 + i * 0.38;
    const z = 0.06 + 0.24 * Math.cos((x / 1.14) * (Math.PI / 2));
    return [id, new THREE.Vector3(x, TABLE_TOP_Y + (i % 2 ? 0.3 : 0.27), z)];
  }),
) as Record<PartId, THREE.Vector3>;

/** Holographic projector puck in the middle of the table. */
export const PROJECTOR = new THREE.Vector3(0, TABLE_TOP_Y, -0.12);

/** Where the quotation hangs above the table (chapter 2). */
export const QUOTE_ANCHOR = new THREE.Vector3(0, 2.12, -0.2);
/** Where the order confirmation appears (chapter 3). */
export const ORDER_ANCHOR = new THREE.Vector3(0, 2.2, 0);

/** Point in front of a character's chest where carried objects sit. */
export const HOLD_POINT = new THREE.Vector3(0, 1.0, 0.47);

const TURN_RADIUS = 0.3;
const angleTo = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/**
 * Walks a polyline at parameter t (0..1, by length). Returns position +
 * heading. The heading turns smoothly through each corner (over
 * TURN_RADIUS either side of it), so a walker never snaps round.
 */
export function alongPath(path: readonly THREE.Vector2[], t: number, out: { x: number; z: number; yaw: number; dist: number }) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += path[i].distanceTo(path[i + 1]);
  const d = Math.max(0, Math.min(1, t)) * total;
  out.dist = d;
  let acc = 0;
  let yaw = Math.atan2(path[1].x - path[0].x, path[1].y - path[0].y);
  let placed = false;
  for (let i = 0; i < path.length - 1; i++) {
    const l = path[i].distanceTo(path[i + 1]);
    if (!placed && (d <= acc + l || i === path.length - 2)) {
      const k = l === 0 ? 0 : Math.min(1, (d - acc) / l);
      out.x = path[i].x + (path[i + 1].x - path[i].x) * k;
      out.z = path[i].y + (path[i + 1].y - path[i].y) * k;
      placed = true;
    }
    acc += l;
    if (i < path.length - 2) {
      const next = Math.atan2(path[i + 2].x - path[i + 1].x, path[i + 2].y - path[i + 1].y);
      const r = Math.min(TURN_RADIUS, l / 2, path[i + 1].distanceTo(path[i + 2]) / 2);
      const w = Math.min(1, Math.max(0, (d - (acc - r)) / (2 * r || 1)));
      yaw = angleTo(yaw, next, w * w * (3 - 2 * w));
    }
  }
  out.yaw = yaw;
  return out;
}

export function lerpSpot(a: Spot, b: Spot, t: number, out: Spot): Spot {
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  let d = b.yaw - a.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  out.yaw = a.yaw + d * t;
  return out;
}
