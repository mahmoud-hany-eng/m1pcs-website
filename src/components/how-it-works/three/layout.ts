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

export const PART_IDS = ["cpu", "gpu", "ram", "storage", "board", "case"] as const;
export type PartId = (typeof PART_IDS)[number];

/** Where each mini part hovers over the consultation table (chapter 1). */
export const PART_SLOTS: Record<PartId, THREE.Vector3> = {
  cpu: new THREE.Vector3(-1.05, TABLE_TOP_Y + 0.26, 0.04),
  gpu: new THREE.Vector3(-0.63, TABLE_TOP_Y + 0.28, 0.2),
  ram: new THREE.Vector3(-0.21, TABLE_TOP_Y + 0.28, 0.28),
  storage: new THREE.Vector3(0.21, TABLE_TOP_Y + 0.26, 0.28),
  board: new THREE.Vector3(0.63, TABLE_TOP_Y + 0.28, 0.2),
  case: new THREE.Vector3(1.05, TABLE_TOP_Y + 0.3, 0.04),
};

/** Holographic projector puck in the middle of the table. */
export const PROJECTOR = new THREE.Vector3(0, TABLE_TOP_Y, -0.12);

/** Where the quotation hangs above the table (chapter 2). */
export const QUOTE_ANCHOR = new THREE.Vector3(0, 2.12, -0.2);
/** Where the order confirmation appears (chapter 3). */
export const ORDER_ANCHOR = new THREE.Vector3(0, 2.2, 0);

/** Point in front of a character's chest where carried objects sit. */
export const HOLD_POINT = new THREE.Vector3(0, 1.0, 0.47);

/** Walks a polyline at parameter t (0..1, by length). Returns position + heading. */
export function alongPath(path: readonly THREE.Vector2[], t: number, out: { x: number; z: number; yaw: number; dist: number }) {
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = path[i].distanceTo(path[i + 1]);
    lens.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  out.dist = d;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] === 0 ? 0 : Math.min(1, d / lens[i]);
      out.x = path[i].x + (path[i + 1].x - path[i].x) * k;
      out.z = path[i].y + (path[i + 1].y - path[i].y) * k;
      out.yaw = Math.atan2(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
      return out;
    }
    d -= lens[i];
  }
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
