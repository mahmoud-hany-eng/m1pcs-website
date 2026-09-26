import * as THREE from "three";
import { TABLE_TOP_Y } from "./Stage";

/**
 * Shared studio-space layout. Origin = table centre on the stage floor,
 * +X = customer's side, +Z = towards the camera. Anything two scenes pass
 * between each other (parts → quote board, PC → customer) is placed from
 * these constants so hand-offs line up exactly.
 */

export { TABLE_TOP_Y };

export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

export const SPOTS = {
  repTable: { x: -1.74, z: 0.16, yaw: 0.82 },
  customerTable: { x: 1.74, z: 0.16, yaw: -0.82 },
  repPickup: { x: -0.22, z: -0.9, yaw: 0 },
} satisfies Record<string, Spot>;

export const PART_IDS = ["cpu", "gpu", "ram", "ssd", "board", "case"] as const;
export type PartId = (typeof PART_IDS)[number];

export const PART_LABELS: Record<PartId, string> = {
  cpu: "CPU",
  gpu: "GPU",
  ram: "RAM",
  ssd: "SSD",
  board: "MOTHERBOARD",
  case: "CASE",
};

/** Where each mini part hovers on the consultation table (scene 1). */
export const PART_SLOTS: Record<PartId, THREE.Vector3> = {
  cpu: new THREE.Vector3(-0.98, TABLE_TOP_Y + 0.2, 0.08),
  gpu: new THREE.Vector3(-0.56, TABLE_TOP_Y + 0.22, 0.24),
  ram: new THREE.Vector3(-0.17, TABLE_TOP_Y + 0.22, 0.3),
  ssd: new THREE.Vector3(0.21, TABLE_TOP_Y + 0.2, 0.3),
  board: new THREE.Vector3(0.6, TABLE_TOP_Y + 0.2, 0.22),
  case: new THREE.Vector3(1.0, TABLE_TOP_Y + 0.24, 0.04),
};

/** Floating quotation board (scene 2) — rows are in board-local units. */
export const BOARD = {
  position: new THREE.Vector3(0, 2.02, -0.32),
  width: 1.95,
  height: 1.36,
  headerHeight: 0.24,
  rowY: [0.33, 0.215, 0.1, -0.015, -0.13, -0.245] as const,
  shippingY: -0.37,
  totalY: -0.5,
  iconX: -0.76,
  iconScale: 0.36,
};

/** Point in front of a character's chest where carried boxes sit. */
export const HOLD_POINT = new THREE.Vector3(0, 1.0, 0.47);

/** The customer's home (scene 6), in studio space. */
export const HOME = {
  origin: new THREE.Vector3(7.6, 0, -0.6),
  wallZ: -1.3,
  doorWidth: 0.92,
  doorHeight: 1.98,
};

export const HOME_SPOTS = {
  customerInside: { x: HOME.origin.x + 0.05, z: HOME.origin.z - 2.0, yaw: 0 },
  customerDoor: { x: HOME.origin.x + 0.05, z: HOME.origin.z - 1.0, yaw: 0 },
  customerHandoff: { x: HOME.origin.x + 0.5, z: HOME.origin.z - 0.18, yaw: -1.15 },
  customerFinal: { x: HOME.origin.x + 0.5, z: HOME.origin.z - 0.1, yaw: -0.32 },
  repHandoff: { x: HOME.origin.x - 0.68, z: HOME.origin.z + 0.12, yaw: 1.15 },
  repFinal: { x: HOME.origin.x - 0.7, z: HOME.origin.z + 0.18, yaw: 0.35 },
} satisfies Record<string, Spot>;

/** Scene-6 beats that the PC (owned by the build scene) also follows. */
export const DELIVER_BEATS = {
  walk: [0.0, 0.26],
  doorOpen: [0.26, 0.34],
  customerOut: [0.3, 0.42],
  handoff: [0.44, 0.56],
  celebrate: [0.58, 0.8],
  final: [0.8, 0.9],
} as const;

/** Path the rep walks from the workbench to the customer's door. */
export const DELIVERY_PATH: readonly THREE.Vector2[] = [
  new THREE.Vector2(SPOTS.repPickup.x, SPOTS.repPickup.z),
  new THREE.Vector2(2.1, -1.02),
  new THREE.Vector2(4.6, 0.25),
  new THREE.Vector2(HOME_SPOTS.repHandoff.x, HOME_SPOTS.repHandoff.z),
];

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
