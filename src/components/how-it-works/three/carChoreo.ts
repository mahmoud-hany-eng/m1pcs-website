import * as THREE from "three";
import type { CharacterApi } from "./Character";
import type { Pose } from "./poses";
import { lerp, smooth } from "./anim";
import { SEAT, STEERING } from "./car";

/**
 * Getting out of (and into) the car, as a pure function of t ∈ [0,1]:
 *
 *   0    seated, hands on the wheel, facing forward
 *   →    hands off the wheel, turn towards the open door
 *   →    swivel on the seat, knees tucked (feet clear of the sill)
 *   →    legs swing out over the sill
 *   →    feet down on the ground outside, lean forward and out (head clears the roof rail)
 *   →    stand up
 *   1    step away from the car, facing out
 *
 * Getting in is the same sequence run backwards (t from 1 to 0) — exactly
 * how people get into a low coupe: back to the seat, sit, swing the legs in.
 * The whole body (legs included) is always drawn; nothing sinks or pops.
 *
 * Positions are car-local (forward +Z, driver's side +X); yaw 0 faces
 * forward, π/2 faces out of the driver's door.
 */
interface Key {
  t: number;
  x: number;
  z: number;
  yaw: number;
  hip: number;
  knee: number;
  bob: number;
  lean: number;
  /** 1 = hands on the wheel, 0 = hands free. */
  wheel: number;
  head: number;
}

const KEYS: Key[] = [
  { t: 0.0, x: SEAT.x, z: SEAT.z, yaw: 0, hip: -1.52, knee: 1.5, bob: -0.17, lean: -0.08, wheel: 1, head: 0 },
  { t: 0.12, x: SEAT.x, z: SEAT.z, yaw: 0.12, hip: -1.52, knee: 1.5, bob: -0.17, lean: -0.03, wheel: 0, head: 0.55 },
  { t: 0.32, x: SEAT.x + 0.05, z: SEAT.z + 0.02, yaw: 1.2, hip: -1.72, knee: 1.62, bob: -0.165, lean: 0.0, wheel: 0, head: 0.2 },
  { t: 0.42, x: SEAT.x + 0.1, z: SEAT.z + 0.03, yaw: Math.PI / 2, hip: -1.9, knee: 1.6, bob: -0.165, lean: 0.02, wheel: 0, head: 0 },
  { t: 0.55, x: SEAT.x + 0.2, z: SEAT.z + 0.03, yaw: Math.PI / 2, hip: -1.85, knee: 0.9, bob: -0.165, lean: 0.06, wheel: 0, head: 0 },
  { t: 0.7, x: SEAT.x + 0.39, z: SEAT.z + 0.03, yaw: Math.PI / 2, hip: -1.3, knee: 1.3, bob: -0.17, lean: 0.3, wheel: 0, head: -0.1 },
  { t: 0.86, x: SEAT.x + 0.82, z: SEAT.z + 0.04, yaw: Math.PI / 2, hip: -0.12, knee: 0.14, bob: -0.02, lean: 0.12, wheel: 0, head: 0 },
  { t: 1.0, x: SEAT.x + 1.16, z: SEAT.z + 0.06, yaw: Math.PI / 2, hip: 0, knee: 0, bob: 0, lean: 0, wheel: 0, head: 0 },
];

export interface SeatState {
  x: number;
  z: number;
  yaw: number;
  wheel: number;
  /** Distance walked in the final step (for a small walk cycle). */
  step: number;
}

const OUT: Key = { ...KEYS[0] };

function sample(t: number): Key {
  const tt = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < KEYS.length - 2 && tt > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = smooth((tt - a.t) / (b.t - a.t));
  for (const key of Object.keys(OUT) as (keyof Key)[]) OUT[key] = lerp(a[key], b[key], k);
  return OUT;
}

/** Writes the legs/body of the sequence into `pose` and the car-local placement into `out`. */
export function seatSequence(t: number, pose: Pose, out: SeatState): SeatState {
  const k = sample(t);
  pose.lHip = k.hip;
  pose.rHip = k.hip;
  pose.lKnee = k.knee;
  pose.rKnee = k.knee;
  pose.bob = k.bob;
  pose.lean = k.lean;
  pose.headYaw += k.head;
  // Hands rest on the knees while seated, swing a little as the body rises.
  const seated = 1 - smooth((t - 0.7) / 0.16);
  pose.lArmX = lerp(pose.lArmX, -0.55, seated);
  pose.rArmX = lerp(pose.rArmX, -0.55, seated);
  pose.lElbow = lerp(pose.lElbow, -0.75, seated);
  pose.rElbow = lerp(pose.rElbow, -0.75, seated);
  out.x = k.x;
  out.z = k.z;
  out.yaw = k.yaw;
  out.wheel = k.wheel;
  out.step = Math.max(0, k.x - KEYS[6].x);
  return out;
}

const tmp = new THREE.Vector3();

/** Hands on the steering wheel (world points from the car transform). */
export function handsOnWheel(rep: CharacterApi, toWorld: (local: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3, weight: number, aim: (side: "l" | "r", p: THREE.Vector3, w: number, elbow: number) => void) {
  if (weight <= 0) return;
  for (const side of ["l", "r"] as const) {
    tmp.set(STEERING.x + (side === "l" ? 0.14 : -0.14), STEERING.y + 0.02, STEERING.z - 0.02);
    aim(side, toWorld(tmp, tmp), weight, -0.55);
  }
}
