import * as THREE from "three";
import type { CharacterApi } from "./Character";
import { REST, add, nod, talkHands, walk, type Side } from "./poses";
import { alongPath, lerpSpot, type Spot } from "./layout";
import { lerp, seg, smooth } from "./anim";

/** Start a fresh target pose for this frame. */
export function resetPose(char: CharacterApi) {
  Object.assign(char.target, REST);
  return char.target;
}

const aimOut = { x: 0, z: 0 };
const lookOut = { yaw: 0, pitch: 0 };

/** Point an arm at a parent-space point, blended in by `weight`. */
export function aimArm(char: CharacterApi, side: Side, point: THREE.Vector3, weight: number, elbow = -0.12) {
  if (weight <= 0) return;
  const a = char.aim(side, point, aimOut);
  const t = char.target;
  if (side === "l") {
    t.lArmX = lerp(t.lArmX, a.x, weight);
    t.lArmZ = lerp(t.lArmZ, a.z, weight);
    t.lElbow = lerp(t.lElbow, elbow, weight);
  } else {
    t.rArmX = lerp(t.rArmX, a.x, weight);
    t.rArmZ = lerp(t.rArmZ, a.z, weight);
    t.rElbow = lerp(t.rElbow, elbow, weight);
  }
}

export function lookAt(char: CharacterApi, point: THREE.Vector3, weight = 1) {
  if (weight <= 0) return;
  const l = char.look(point, lookOut);
  const t = char.target;
  t.headYaw = lerp(t.headYaw, l.yaw, weight);
  t.headPitch = lerp(t.headPitch, l.pitch, weight);
}

/** Mouth movement while speaking. */
export function talk(char: CharacterApi, time: number, amount: number) {
  if (amount <= 0) return;
  const m = 0.3 + 0.3 * Math.sin(time * 13) * Math.sin(time * 3.7 + 1);
  char.target.mouthOpen = Math.max(char.target.mouthOpen, amount * Math.max(0, m));
}

export function place(char: CharacterApi, spot: Spot) {
  char.place(spot.x, spot.z, spot.yaw);
}

const headA = new THREE.Vector3();
const headB = new THREE.Vector3();

/**
 * A living conversation for resting moments: the two take turns speaking
 * (mouth + open-hand gesture) while the listener nods now and then.
 */
export function converse(a: CharacterApi, aSide: Side, b: CharacterApi, bSide: Side, time: number, weight: number) {
  if (weight <= 0) return;
  headA.set(a.root.position.x, 1.55, a.root.position.z);
  headB.set(b.root.position.x, 1.55, b.root.position.z);
  lookAt(a, headB, weight);
  lookAt(b, headA, weight);
  const phase = (time % 7) / 7;
  const aTalks = phase < 0.5;
  const speaker = aTalks ? a : b;
  const listener = aTalks ? b : a;
  const k = weight * smooth(seg(phase % 0.5, 0.02, 0.1)) * (1 - smooth(seg(phase % 0.5, 0.4, 0.48)));
  talk(speaker, time, k * 0.8);
  const hands = talkHands(aTalks ? aSide : bSide, time);
  const t = speaker.target;
  for (const key in hands) {
    const kk = key as keyof typeof t;
    t[kk] = lerp(t[kk], hands[kk] as number, k * 0.6);
  }
  add(listener.target, nod(time), k * 0.55);
  speaker.target.smile = Math.max(speaker.target.smile, 0.6 * weight);
  listener.target.smile = Math.max(listener.target.smile, 0.75 * weight);
}

const tmpSpot: Spot = { x: 0, z: 0, yaw: 0 };
const STRIDE = 0.95;

export function angleLerp(a: number, b: number, t: number) {
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
  const yaw = angleLerp(angleLerp(from.yaw, heading, smooth(seg(t, 0, 0.18))), to.yaw, smooth(seg(t, 0.82, 1)));
  char.place(tmpSpot.x, tmpSpot.z, yaw);
  const dist = Math.hypot(to.x - from.x, to.z - from.z) * k;
  const amount = t > 0 && t < 1 ? smooth(seg(t, 0, 0.12)) * (1 - smooth(seg(t, 0.88, 1))) : 0;
  add(char.target, walk((dist / STRIDE) * Math.PI * 2, carrying), amount);
}

const pathOut = { x: 0, z: 0, yaw: 0, dist: 0 };

/** Walks a polyline (e.g. around the table), turning from startYaw into the path and finally to endYaw. */
export function walkPath(char: CharacterApi, path: readonly THREE.Vector2[], t: number, startYaw: number, endYaw: number, carrying = false) {
  alongPath(path, smooth(t), pathOut);
  const yaw = angleLerp(angleLerp(startYaw, pathOut.yaw, smooth(seg(t, 0, 0.15))), endYaw, smooth(seg(t, 0.85, 1)));
  char.place(pathOut.x, pathOut.z, yaw);
  const amount = t > 0 && t < 1 ? smooth(seg(t, 0, 0.1)) * (1 - smooth(seg(t, 0.9, 1))) : 0;
  add(char.target, walk((pathOut.dist / STRIDE) * Math.PI * 2, carrying), amount);
}
