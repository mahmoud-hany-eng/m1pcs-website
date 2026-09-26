import { lerp } from "./anim";

/**
 * A character pose is a flat bag of joint angles (radians) plus a few face
 * parameters. Scenes compute a target pose every frame from scroll progress;
 * the rig springs each joint towards it, which gives the soft follow-through
 * and overshoot without ever breaking scroll reversibility.
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

// ---------------------------------------------------------------- gestures

export type Side = "l" | "r";

/** Both arms raised, bouncing — "yes!". */
export function celebrate(time: number): Partial<Pose> {
  const b = Math.abs(Math.sin(time * 7));
  return {
    lArmX: -2.75,
    lArmZ: 0.55 + b * 0.12,
    lElbow: -0.25,
    rArmX: -2.75,
    rArmZ: -0.55 - b * 0.12,
    rElbow: -0.25,
    bob: b * 0.07,
    smile: 1,
    mouthOpen: 0.7,
    brow: 0.6,
    headPitch: -0.18,
  };
}

/** One-arm wave from the frontal plane. */
export function wave(side: Side, time: number): Partial<Pose> {
  const s = side === "l" ? 1 : -1;
  const swing = Math.sin(time * 9) * 0.38;
  return side === "l"
    ? { lArmX: -0.25, lArmZ: 1.3 * s, lElbow: -0.05, lElbowZ: 1.75 * s + swing, smile: 0.9, brow: 0.4 }
    : { rArmX: -0.25, rArmZ: 1.3 * s, rElbow: -0.05, rElbowZ: 1.75 * s + swing, smile: 0.9, brow: 0.4 };
}

/** Hand to chin, head tilted — "hmm, let me compare". */
export function think(side: Side): Partial<Pose> {
  return side === "l"
    ? { lArmX: -0.55, lArmZ: -0.3, lElbow: -2.25, headRoll: -0.12, headPitch: 0.06, smile: 0.1, brow: -0.35 }
    : { rArmX: -0.55, rArmZ: 0.3, rElbow: -2.25, headRoll: 0.12, headPitch: 0.06, smile: 0.1, brow: -0.35 };
}

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

/** Fast alternating hand taps — typing on a keyboard. */
export function typing(time: number): Partial<Pose> {
  return {
    lArmX: -0.72 + Math.sin(time * 18) * 0.06,
    lArmZ: -0.12,
    lElbow: -1.05,
    rArmX: -0.72 + Math.sin(time * 18 + 2) * 0.06,
    rArmZ: 0.12,
    rElbow: -1.05,
    lean: 0.12,
    headPitch: 0.2,
    smile: 0.3,
    brow: -0.2,
  };
}

/** Clapping in front of the chest. */
export function clap(time: number): Partial<Pose> {
  const c = (Math.sin(time * 16) + 1) / 2;
  return {
    lArmX: -1.05,
    lArmZ: -0.12 + c * 0.32,
    lElbow: -0.85,
    rArmX: -1.05,
    rArmZ: 0.12 - c * 0.32,
    rElbow: -0.85,
    smile: 1,
    mouthOpen: 0.4,
    brow: 0.4,
  };
}

/** Additive walk cycle. `phase` advances with distance walked. */
export function walk(phase: number, carrying = false): Partial<Pose> {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const arms = carrying ? 0 : 1;
  return {
    lHip: 0.48 * s,
    rHip: -0.48 * s,
    lKnee: 0.75 * Math.max(0, -c),
    rKnee: 0.75 * Math.max(0, c),
    lArmX: -0.38 * s * arms,
    rArmX: 0.38 * s * arms,
    bob: 0.035 * Math.abs(c),
    twist: 0.06 * s,
  };
}

/** Small forward nods layered on the head. `amount` in 0..1. */
export function nod(time: number, amount: number): Partial<Pose> {
  return { headPitch: Math.max(0, Math.sin(time * 9)) * 0.28 * amount };
}
