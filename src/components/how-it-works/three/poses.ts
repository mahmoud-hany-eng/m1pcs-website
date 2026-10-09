import { lerp } from "./anim";

/**
 * A character pose is a flat bag of joint angles (radians) plus a few face
 * parameters. Scenes compute a target pose every frame; the rig springs each
 * joint towards it, which gives soft follow-through without ever breaking
 * scroll reversibility.
 *
 * Every gesture below writes into its own reusable object (no per-frame
 * allocations — garbage collection pauses show up as stutter).
 *
 * Conventions (character faces +Z, its left side is +X):
 *  - armX < 0 swings an arm forward/up, armZ raises it sideways
 *    (+ for the left arm, − for the right arm = outward).
 *  - elbow < 0 bends the forearm forward; elbowZ swings it in the frontal plane.
 *  - hip < 0 swings a leg forward; knee > 0 bends it.
 *  - lean > 0 leans forward, headPitch > 0 looks down, headYaw > 0 looks to its left.
 */
export interface Pose {
  lean: number;
  twist: number;
  side: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  lArmX: number;
  lArmZ: number;
  lElbow: number;
  lElbowZ: number;
  rArmX: number;
  rArmZ: number;
  rElbow: number;
  rElbowZ: number;
  lHip: number;
  lKnee: number;
  rHip: number;
  rKnee: number;
  bob: number;
  squash: number;
  smile: number;
  mouthOpen: number;
  brow: number;
}

export type PoseKey = keyof Pose;
export type Side = "l" | "r";

export const REST: Readonly<Pose> = {
  lean: 0,
  twist: 0,
  side: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  lArmX: 0.05,
  lArmZ: 0.14,
  lElbow: -0.18,
  lElbowZ: 0,
  rArmX: 0.05,
  rArmZ: -0.14,
  rElbow: -0.18,
  rElbowZ: 0,
  lHip: 0,
  lKnee: 0,
  rHip: 0,
  rKnee: 0,
  bob: 0,
  squash: 0,
  smile: 0.35,
  mouthOpen: 0,
  brow: 0,
};

export const POSE_KEYS = Object.keys(REST) as PoseKey[];

export function pose(overrides: Partial<Pose> = {}): Pose {
  return { ...REST, ...overrides };
}

/** out = lerp(out, target, t) for every key present in target. */
export function blend(out: Pose, target: Partial<Pose>, t: number): Pose {
  if (t <= 0) return out;
  for (const k in target) {
    const key = k as PoseKey;
    out[key] = lerp(out[key], target[key] as number, t);
  }
  return out;
}

/** out += delta * t (for additive layers such as walking or nodding). */
export function add(out: Pose, delta: Partial<Pose>, t = 1): Pose {
  if (t === 0) return out;
  for (const k in delta) {
    const key = k as PoseKey;
    out[key] += (delta[key] as number) * t;
  }
  return out;
}

// ---------------------------------------------------------------- expressions

export const HAPPY: Partial<Pose> = { smile: 1, brow: 0.45 };
export const DELIGHTED: Partial<Pose> = { smile: 1, mouthOpen: 0.45, brow: 0.7 };
export const FOCUSED: Partial<Pose> = { smile: 0.25, brow: -0.25 };
export const LEAN_IN: Partial<Pose> = { lean: 0.13, smile: 0.55 };

// ---------------------------------------------------------------- held poses

/** Both forearms forward as if holding a box in front of the chest. */
export const HOLD: Partial<Pose> = {
  lArmX: -0.95,
  lArmZ: 0.1,
  lElbow: -0.95,
  rArmX: -0.95,
  rArmZ: -0.1,
  rElbow: -0.95,
  lean: -0.04,
};

/** Arms reaching forward to give or receive something. */
export const REACH: Partial<Pose> = {
  lArmX: -1.25,
  lArmZ: 0.12,
  lElbow: -0.5,
  rArmX: -1.25,
  rArmZ: -0.12,
  rElbow: -0.5,
  lean: 0.12,
};

/** Hand to chin, head tilted — "let me compare". */
export const THINK_L: Partial<Pose> = { lArmX: -0.55, lArmZ: -0.3, lElbow: -2.25, headRoll: -0.12, headPitch: 0.06, smile: 0.15, brow: -0.35 };
export const THINK_R: Partial<Pose> = { rArmX: -0.55, rArmZ: 0.3, rElbow: -2.25, headRoll: 0.12, headPitch: 0.06, smile: 0.15, brow: -0.35 };

/** Holding a phone up in front of the chest, looking at it. */
export const PHONE_L: Partial<Pose> = { lArmX: -0.62, lArmZ: -0.22, lElbow: -1.75, headPitch: 0.34, lean: 0.05, brow: -0.1 };

/** Forearm up, open hand — "OK, looks good". */
export const OK_L: Partial<Pose> = { lArmX: -1.05, lArmZ: 0.45, lElbow: -1.55, smile: 1, brow: 0.5 };

// ---------------------------------------------------------------- time-varying gestures

const waveL: Partial<Pose> = { lArmX: -0.25, lArmZ: 1.3, lElbow: -0.05, lElbowZ: 0, smile: 0.9, brow: 0.4 };
const waveR: Partial<Pose> = { rArmX: -0.25, rArmZ: -1.3, rElbow: -0.05, rElbowZ: 0, smile: 0.9, brow: 0.4 };
/** One-arm wave in the frontal plane. */
export function wave(side: Side, time: number): Partial<Pose> {
  const swing = Math.sin(time * 9) * 0.38;
  if (side === "l") {
    waveL.lElbowZ = 1.75 + swing;
    return waveL;
  }
  waveR.rElbowZ = -1.75 + swing;
  return waveR;
}

const talkL: Partial<Pose> = { lArmX: 0, lArmZ: 0.42, lElbow: -0.8, lElbowZ: 0.2 };
const talkR: Partial<Pose> = { rArmX: 0, rArmZ: -0.42, rElbow: -0.8, rElbowZ: -0.2 };
/** Open-hand gestures while explaining something. */
export function talkHands(side: Side, time: number): Partial<Pose> {
  const a = Math.sin(time * 3.1) * 0.2 + Math.sin(time * 1.7) * 0.08;
  if (side === "l") {
    talkL.lArmX = -0.92 + a;
    talkL.lElbow = -0.8 - a * 0.6;
    return talkL;
  }
  talkR.rArmX = -0.92 + a;
  talkR.rElbow = -0.8 - a * 0.6;
  return talkR;
}

const shakeR: Partial<Pose> = { rArmX: -1.0, rArmZ: 0.1, rElbow: -0.5, lean: 0.06, smile: 0.95 };
/** Right hand out for a handshake; `pump` adds the up/down shake. */
export function handshake(pump: number): Partial<Pose> {
  shakeR.rArmX = -1.0 + Math.sin(pump * Math.PI * 6) * 0.12;
  return shakeR;
}

const typingPose: Partial<Pose> = { lArmX: 0, lArmZ: -0.12, lElbow: -1.05, rArmX: 0, rArmZ: 0.12, rElbow: -1.05, lean: 0.12, headPitch: 0.2, smile: 0.3, brow: -0.2 };
/** Fast alternating hand taps — typing on a keyboard. */
export function typing(time: number): Partial<Pose> {
  typingPose.lArmX = -0.72 + Math.sin(time * 18) * 0.06;
  typingPose.rArmX = -0.72 + Math.sin(time * 18 + 2) * 0.06;
  return typingPose;
}

const clapPose: Partial<Pose> = { lArmX: -1.05, lArmZ: 0, lElbow: -0.85, rArmX: -1.05, rArmZ: 0, rElbow: -0.85, smile: 1, mouthOpen: 0.35, brow: 0.4 };
/** Clapping in front of the chest. */
export function clap(time: number): Partial<Pose> {
  const c = (Math.sin(time * 14) + 1) / 2;
  clapPose.lArmZ = -0.12 + c * 0.3;
  clapPose.rArmZ = 0.12 - c * 0.3;
  return clapPose;
}

const walkPose: Partial<Pose> = { lHip: 0, rHip: 0, lKnee: 0, rKnee: 0, lArmX: 0, rArmX: 0, bob: 0, twist: 0 };
/** Additive walk cycle. `phase` advances with distance walked. */
export function walk(phase: number, carrying = false): Partial<Pose> {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const arms = carrying ? 0 : 1;
  walkPose.lHip = 0.46 * s;
  walkPose.rHip = -0.46 * s;
  walkPose.lKnee = 0.72 * Math.max(0, -c);
  walkPose.rKnee = 0.72 * Math.max(0, c);
  walkPose.lArmX = -0.34 * s * arms;
  walkPose.rArmX = 0.34 * s * arms;
  walkPose.bob = 0.032 * Math.abs(c);
  walkPose.twist = 0.05 * s;
  return walkPose;
}

const nodPose: Partial<Pose> = { headPitch: 0 };
/** Small forward nods layered on the head. */
export function nod(time: number): Partial<Pose> {
  nodPose.headPitch = Math.max(0, Math.sin(time * 8.5)) * 0.26;
  return nodPose;
}

const hopPose: Partial<Pose> = { bob: 0, squash: 0 };
/** A happy little hop. */
export function hop(time: number): Partial<Pose> {
  const h = Math.abs(Math.sin(time * 6.5));
  hopPose.bob = h * 0.1;
  hopPose.squash = (1 - h) * 0.035;
  return hopPose;
}
