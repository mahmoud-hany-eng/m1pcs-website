import * as THREE from "three";
import type { CharacterApi } from "./Character";
import { REST, add, blend, walk, type Side } from "./poses";
import { alongPath, lerpSpot, type Spot } from "./layout";
import { seg, smooth } from "./anim";

/** Start a fresh target pose for this frame. */
export function resetPose(char: CharacterApi) {
  Object.assign(char.target, REST);
  return char.target;
}

/** Point an arm at a parent-space point, blended in by `weight`. */
export function aimArm(char: CharacterApi, side: Side, point: THREE.Vector3, weight: number, elbow = -0.12) {
  if (weight <= 0) return;
  const a = char.aim(side, point);
  blend(char.target, side === "l" ? { lArmX: a.x, lArmZ: a.z, lElbow: elbow } : { rArmX: a.x, rArmZ: a.z, rElbow: elbow }, weight);
}

export function lookAt(char: CharacterApi, point: THREE.Vector3, weight = 1) {
  if (weight <= 0) return;
  const l = char.look(point);
  blend(char.target, { headYaw: l.yaw, headPitch: l.pitch }, weight);
}

/** Mouth flaps while speaking. */
export function talk(char: CharacterApi, time: number, amount: number) {
  if (amount <= 0) return;
  char.target.mouthOpen = Math.max(char.target.mouthOpen, amount * (0.3 + 0.3 * Math.sin(time * 13)));
}

export function place(char: CharacterApi, spot: Spot) {
  char.place(spot.x, spot.z, spot.yaw);
}

const tmpSpot: Spot = { x: 0, z: 0, yaw: 0 };
const STRIDE = 0.95;

function angleLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Walks a character from one spot to another over t ∈ [0,1]: turns towards
 * the direction of travel, strides (legs + arm swing + bob), then turns to
 * the destination's facing.
 */
export function walkBetween(char: CharacterApi, from: Spot, to: Spot, t: number, carrying = false) {
  const k = smooth(t);
  lerpSpot(from, to, k, tmpSpot);
  const heading = Math.atan2(to.x - from.x, to.z - from.z);
  const turnIn = smooth(seg(t, 0, 0.18));
  const turnOut = smooth(seg(t, 0.82, 1));
  const yaw = angleLerp(angleLerp(from.yaw, heading, turnIn), to.yaw, turnOut);
  char.place(tmpSpot.x, tmpSpot.z, yaw);
  const dist = Math.hypot(to.x - from.x, to.z - from.z) * k;
  const amount = t > 0 && t < 1 ? smooth(seg(t, 0, 0.12)) * (1 - smooth(seg(t, 0.88, 1))) : 0;
  add(char.target, walk((dist / STRIDE) * Math.PI * 2, carrying), amount);
}

/** Same as walkBetween but with an explicit heading/phase (for polyline paths). */
export function walkAlong(char: CharacterApi, x: number, z: number, yaw: number, dist: number, amount: number, carrying = false) {
  char.place(x, z, yaw);
  add(char.target, walk((dist / STRIDE) * Math.PI * 2, carrying), amount);
}

const pathOut = { x: 0, z: 0, yaw: 0, dist: 0 };

/**
 * Walks a polyline (e.g. around the table instead of through it), turning
 * from `startYaw` into the path heading and finally to `endYaw`.
 */
export function walkPath(
  char: CharacterApi,
  path: readonly THREE.Vector2[],
  t: number,
  startYaw: number,
  endYaw: number,
  carrying = false,
) {
  alongPath(path, smooth(t), pathOut);
  const yaw = angleLerp(angleLerp(startYaw, pathOut.yaw, smooth(seg(t, 0, 0.15))), endYaw, smooth(seg(t, 0.85, 1)));
  const amount = t > 0 && t < 1 ? smooth(seg(t, 0, 0.1)) * (1 - smooth(seg(t, 0.9, 1))) : 0;
  walkAlong(char, pathOut.x, pathOut.z, yaw, pathOut.dist, amount, carrying);
}

export { angleLerp };
