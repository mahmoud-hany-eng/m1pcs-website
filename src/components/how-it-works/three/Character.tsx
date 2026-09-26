"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, std } from "./assets";
import { Spring } from "./anim";
import { POSE_KEYS, REST, pose as makePose, type Pose, type PoseKey } from "./poses";

export type CharacterVariant = "rep" | "customer";

/** Imperative controller the director uses every frame (no React re-renders). */
export interface CharacterApi {
  root: THREE.Group;
  /** Mutable target pose — scenes write into this, `step` springs towards it. */
  target: Pose;
  place(x: number, z: number, yaw: number): void;
  setVisible(visible: boolean): void;
  step(dt: number, time: number): void;
  /** Converts a point in the character's local space into its parent's space. */
  toParent(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  /** Arm angles that point a (straight) arm at a point in parent space. */
  aim(side: "l" | "r", parentPoint: THREE.Vector3, out: { x: number; z: number }): { x: number; z: number };
  /** Head yaw/pitch that look at a point in parent space. */
  look(parentPoint: THREE.Vector3, out: { yaw: number; pitch: number }): { yaw: number; pitch: number };
  /** Current hand position in parent space (valid after `step`). */
  hand(side: "l" | "r", out: THREE.Vector3): THREE.Vector3;
}

// Skeleton dimensions (metres-ish, feet at y = 0, facing +Z).
const HIP_Y = 0.66;
const SHOULDER = new THREE.Vector3(0.25, 0.5, 0); // relative to spine origin (HIP_Y + 0.04)
const SPINE_Y = 0.04;
const HEAD_Y = 0.82; // head centre relative to spine origin
const UPPER_ARM = 0.28;
const FOREARM = 0.27;
const THIGH = 0.3;
const SHIN = 0.31;

// Per-joint spring tuning: arms are the bounciest, legs are crisp enough to walk.
function springParams(key: PoseKey): [number, number] {
  if (key.includes("Hip") || key.includes("Knee")) return [520, 42];
  if (key === "bob" || key === "squash") return [260, 20];
  if (key.startsWith("head")) return [85, 12.5];
  if (key === "smile" || key === "mouthOpen" || key === "brow") return [140, 20];
  if (key.includes("Arm") || key.includes("Elbow")) return [110, 13.5];
  return [90, 13];
}

interface Look {
  skin: string;
  shirt: string;
  sleeve: string;
  forearm: string;
  pants: string;
  shoes: string;
  hair: string;
}

const LOOKS: Record<CharacterVariant, Look> = {
  rep: {
    skin: COLORS.skinRep,
    shirt: COLORS.red,
    sleeve: COLORS.red,
    forearm: COLORS.skinRep,
    pants: COLORS.pants,
    shoes: COLORS.white,
    hair: COLORS.hairRep,
  },
  customer: {
    skin: COLORS.skinCustomer,
    shirt: COLORS.offWhite,
    sleeve: COLORS.offWhite,
    forearm: COLORS.offWhite,
    pants: COLORS.denim,
    shoes: COLORS.gold,
    hair: COLORS.hairCustomer,
  },
};

const tmp = new THREE.Vector3();

export const Character = forwardRef<CharacterApi, { variant: CharacterVariant; castShadow?: boolean }>(
  function Character({ variant, castShadow = false }, ref) {
    const look = LOOKS[variant];
    const isRep = variant === "rep";

    const root = useRef<THREE.Group>(null!);
    const body = useRef<THREE.Group>(null!);
    const spine = useRef<THREE.Group>(null!);
    const chest = useRef<THREE.Mesh>(null!);
    const head = useRef<THREE.Group>(null!);
    const lShoulder = useRef<THREE.Group>(null!);
    const rShoulder = useRef<THREE.Group>(null!);
    const lElbow = useRef<THREE.Group>(null!);
    const rElbow = useRef<THREE.Group>(null!);
    const lLeg = useRef<THREE.Group>(null!);
    const rLeg = useRef<THREE.Group>(null!);
    const lKnee = useRef<THREE.Group>(null!);
    const rKnee = useRef<THREE.Group>(null!);
    const lHand = useRef<THREE.Mesh>(null!);
    const rHand = useRef<THREE.Mesh>(null!);
    const eyes = useRef<THREE.Group>(null!);
    const smileArc = useRef<THREE.Mesh>(null!);
    const mouth = useRef<THREE.Mesh>(null!);
    const brows = useRef<THREE.Group>(null!);

    const springs = useMemo(() => {
      const m = {} as Record<PoseKey, Spring>;
      for (const k of POSE_KEYS) m[k] = new Spring(REST[k]);
      return m;
    }, []);

    const target = useMemo(() => makePose(), []);
    const values = useMemo(() => makePose(), []);
    // Each character blinks on its own rhythm so they never look synced.
    const blinkOffset = isRep ? 0 : 1.7;

    const api = useMemo<CharacterApi>(
      () => ({
        get root() {
          return root.current;
        },
        target,
        place(x, z, yaw) {
          root.current.position.set(x, 0, z);
          root.current.rotation.y = yaw;
        },
        setVisible(v) {
          root.current.visible = v;
        },
        toParent(local, out) {
          const yaw = root.current.rotation.y;
          const c = Math.cos(yaw);
          const s = Math.sin(yaw);
          out.set(local.x * c + local.z * s, local.y, -local.x * s + local.z * c);
          return out.add(root.current.position);
        },
        aim(side, point, out) {
          // Parent space -> character space (ignores spine lean: close enough for gestures).
          const r = root.current;
          const c = Math.cos(-r.rotation.y);
          const s = Math.sin(-r.rotation.y);
          const px = point.x - r.position.x;
          const pz = point.z - r.position.z;
          const lx = px * c + pz * s;
          const lz = -px * s + pz * c;
          const sx = side === "l" ? SHOULDER.x : -SHOULDER.x;
          const sy = HIP_Y + SPINE_Y + SHOULDER.y;
          tmp.set(lx - sx, point.y - sy, lz).normalize();
          out.x = Math.atan2(-tmp.z, -tmp.y);
          out.z = Math.asin(Math.max(-1, Math.min(1, tmp.x)));
          return out;
        },
        look(point, out) {
          const r = root.current;
          const c = Math.cos(-r.rotation.y);
          const s = Math.sin(-r.rotation.y);
          const px = point.x - r.position.x;
          const pz = point.z - r.position.z;
          const lx = px * c + pz * s;
          const lz = -px * s + pz * c;
          const dy = point.y - (HIP_Y + SPINE_Y + HEAD_Y);
          out.yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(lx, lz)));
          out.pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(-dy, Math.hypot(lx, lz))));
          return out;
        },
        hand(side, out) {
          (side === "l" ? lHand : rHand).current.getWorldPosition(out);
          const parent = root.current.parent;
          return parent ? parent.worldToLocal(out) : out;
        },
        step(dt, time) {
          const d = Math.min(dt, 1 / 30);
          const v = values;
          for (const k of POSE_KEYS) {
            const [kk, cc] = springParams(k);
            v[k] = springs[k].step(target[k], d, kk, cc);
          }

          // Idle life layered on top: breathing, sway, head drift, blinking.
          const breathe = Math.sin(time * 2.1 + blinkOffset);
          const sway = Math.sin(time * 0.9 + blinkOffset * 2);

          body.current.position.y = v.bob;
          const sq = v.squash;
          body.current.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

          spine.current.rotation.set(v.lean + breathe * 0.012, v.twist + sway * 0.03, v.side + sway * 0.02);
          chest.current.scale.set(1, 1 + breathe * 0.012, 0.82);

          head.current.rotation.set(
            v.headPitch + Math.sin(time * 1.3 + blinkOffset) * 0.025,
            v.headYaw + sway * 0.05,
            v.headRoll + Math.sin(time * 0.7) * 0.02,
          );

          lShoulder.current.rotation.set(v.lArmX + breathe * 0.02, 0, v.lArmZ);
          rShoulder.current.rotation.set(v.rArmX + breathe * 0.02, 0, v.rArmZ);
          lElbow.current.rotation.set(v.lElbow, 0, v.lElbowZ);
          rElbow.current.rotation.set(v.rElbow, 0, v.rElbowZ);
          lLeg.current.rotation.x = v.lHip;
          rLeg.current.rotation.x = v.rHip;
          lKnee.current.rotation.x = v.lKnee;
          rKnee.current.rotation.x = v.rKnee;

          // Face.
          const cycle = (time + blinkOffset) % 3.6;
          const blink = cycle < 0.13 ? 0.12 : 1;
          eyes.current.scale.y = blink;
          const smile = Math.max(0, Math.min(1, v.smile));
          smileArc.current.scale.set(1 + smile * 0.25, 0.25 + smile * 0.85, 1);
          smileArc.current.position.y = -0.085 + smile * 0.012;
          const open = Math.max(0, Math.min(1, v.mouthOpen));
          mouth.current.visible = open > 0.04;
          mouth.current.scale.set(0.05 + smile * 0.012, 0.012 + open * 0.045, 0.02);
          brows.current.position.y = 0.105 + v.brow * 0.025;
          brows.current.children[0].rotation.z = Math.PI / 2 + 0.08 - v.brow * 0.18;
          brows.current.children[1].rotation.z = Math.PI / 2 - 0.08 + v.brow * 0.18;

          root.current.updateMatrixWorld(true);
        },
      }),
      [springs, target, values, blinkOffset],
    );

    useImperativeHandle(ref, () => api, [api]);

    useLayoutEffect(() => {
      root.current.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).castShadow = castShadow;
        }
      });
    }, [castShadow]);

    const skin = std(look.skin, { roughness: 0.62 });
    const shirt = std(look.shirt, { roughness: 0.6 });
    const sleeve = std(look.sleeve, { roughness: 0.6 });
    const forearm = std(look.forearm, { roughness: 0.62 });
    const pants = std(look.pants, { roughness: 0.7 });
    const shoes = std(look.shoes, { roughness: 0.45 });
    const hair = std(look.hair, { roughness: 0.8 });
    const eyeMat = std("#111111", { roughness: 0.15, metalness: 0.2 });
    const white = glow("#ffffff");
    const dark = std("#2a1712", { roughness: 0.5 });

    const arm = (side: "l" | "r") => {
      const s = side === "l" ? 1 : -1;
      return (
        <group ref={side === "l" ? lShoulder : rShoulder} position={[SHOULDER.x * s, SHOULDER.y, 0]}>
          <mesh geometry={geo.sphere("lo")} material={sleeve} scale={0.085} />
          <mesh geometry={geo.capsule(0.068, 0.16)} material={sleeve} position={[0, -UPPER_ARM / 2, 0]} />
          <group ref={side === "l" ? lElbow : rElbow} position={[0, -UPPER_ARM, 0]}>
            <mesh geometry={geo.capsule(0.06, 0.17)} material={forearm} position={[0, -FOREARM / 2 + 0.02, 0]} />
            {!isRep && (
              <mesh geometry={geo.torus(0.058, 0.018)} material={std(COLORS.gold, { roughness: 0.5 })} position={[0, -FOREARM + 0.07, 0]} rotation={[Math.PI / 2, 0, 0]} />
            )}
            <mesh ref={side === "l" ? lHand : rHand} geometry={geo.sphere("lo")} material={skin} position={[0, -FOREARM, 0.005]} scale={[0.068, 0.075, 0.06]} />
            <mesh geometry={geo.capsule(0.022, 0.035)} material={skin} position={[0.045 * s, -FOREARM + 0.01, 0.045]} rotation={[0.5, 0, -0.5 * s]} />
          </group>
        </group>
      );
    };

    const leg = (side: "l" | "r") => {
      const s = side === "l" ? 1 : -1;
      return (
        <group ref={side === "l" ? lLeg : rLeg} position={[0.11 * s, 0, 0]}>
          <mesh geometry={geo.capsule(0.088, 0.18)} material={pants} position={[0, -THIGH / 2, 0]} />
          <group ref={side === "l" ? lKnee : rKnee} position={[0, -THIGH, 0]}>
            <mesh geometry={geo.capsule(0.078, 0.2)} material={pants} position={[0, -SHIN / 2 + 0.01, 0]} />
            <mesh geometry={geo.roundBox(0.15, 0.1, 0.27, 0.045)} material={shoes} position={[0, -SHIN + 0.0, 0.055]} />
          </group>
        </group>
      );
    };

    return (
      <group ref={root}>
        {/* Soft contact shadow so figures stay grounded even without shadow maps. */}
        <mesh geometry={geo.circle()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} scale={0.42} material={glow("#000000", 0.45)} />
        <group ref={body}>
          <group position={[0, HIP_Y, 0]}>
            <mesh geometry={geo.sphere("lo")} material={pants} scale={[0.22, 0.13, 0.16]} position={[0, 0.02, 0]} />
            {leg("l")}
            {leg("r")}
            <group ref={spine} position={[0, SPINE_Y, 0]} rotation-order="YXZ">
              <mesh ref={chest} geometry={geo.capsule(0.215, 0.3)} material={shirt} position={[0, 0.3, 0]} scale={[1, 1, 0.82]} />
              {isRep ? (
                <>
                  {/* Collar + M1 badge */}
                  <mesh geometry={geo.torus(0.1, 0.028)} material={std(COLORS.ink, { roughness: 0.5 })} position={[0, 0.56, 0]} rotation={[Math.PI / 2, 0, 0]} />
                  <mesh geometry={geo.roundBox(0.1, 0.06, 0.02, 0.01)} material={std(COLORS.gold, { roughness: 0.35, metalness: 0.4 })} position={[0.1, 0.42, 0.17]} rotation={[0, 0.25, 0]} />
                  <mesh geometry={geo.box()} material={std(COLORS.ink)} position={[0, 0.3, 0.176]} scale={[0.36, 0.035, 0.01]} />
                </>
              ) : (
                <>
                  {/* Hood + drawstrings */}
                  <mesh geometry={geo.torus(0.14, 0.055)} material={shirt} position={[0, 0.56, -0.05]} rotation={[Math.PI / 2.4, 0, 0]} />
                  <mesh geometry={geo.capsule(0.01, 0.1)} material={std(COLORS.gold)} position={[0.045, 0.44, 0.175]} />
                  <mesh geometry={geo.capsule(0.01, 0.1)} material={std(COLORS.gold)} position={[-0.045, 0.44, 0.175]} />
                  <mesh geometry={geo.box()} material={std("#d8d4cc")} position={[0, 0.22, 0.176]} scale={[0.26, 0.1, 0.01]} />
                </>
              )}
              {arm("l")}
              {arm("r")}
              <mesh geometry={geo.capsule(0.07, 0.06)} material={skin} position={[0, 0.63, 0]} />
              <group ref={head} position={[0, HEAD_Y, 0]} rotation-order="YXZ">
                <mesh geometry={geo.sphere()} material={skin} scale={[0.25, 0.24, 0.235]} />
                {/* ears */}
                <mesh geometry={geo.sphere("lo")} material={skin} position={[0.245, -0.01, 0]} scale={[0.04, 0.06, 0.035]} />
                <mesh geometry={geo.sphere("lo")} material={skin} position={[-0.245, -0.01, 0]} scale={[0.04, 0.06, 0.035]} />
                {isRep ? (
                  <>
                    {/* M1 cap */}
                    <mesh geometry={geo.hemisphere()} material={std(COLORS.red, { roughness: 0.55 })} position={[0, 0.045, -0.005]} scale={[0.262, 0.22, 0.252]} />
                    <mesh geometry={geo.roundBox(0.3, 0.02, 0.17, 0.008)} material={std(COLORS.red, { roughness: 0.55 })} position={[0, 0.05, 0.25]} rotation={[0.12, 0, 0]} />
                    <mesh geometry={geo.circle()} material={glow(COLORS.gold)} position={[0, 0.16, 0.2]} rotation={[-0.6, 0, 0]} scale={0.045} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[0.2, -0.03, -0.07]} scale={[0.07, 0.1, 0.12]} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[-0.2, -0.03, -0.07]} scale={[0.07, 0.1, 0.12]} />
                  </>
                ) : (
                  <>
                    <mesh geometry={geo.hemisphere()} material={hair} position={[0, 0.02, -0.01]} scale={[0.262, 0.25, 0.255]} rotation={[-0.25, 0, 0]} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[0.07, 0.15, 0.17]} scale={[0.16, 0.07, 0.09]} rotation={[0.3, 0, -0.35]} />
                  </>
                )}
                {/* face */}
                <group ref={eyes} position={[0, 0.03, 0.212]}>
                  <mesh geometry={geo.sphere("lo")} material={eyeMat} position={[0.085, 0, 0]} scale={[0.034, 0.046, 0.02]} />
                  <mesh geometry={geo.sphere("lo")} material={eyeMat} position={[-0.085, 0, 0]} scale={[0.034, 0.046, 0.02]} />
                  <mesh geometry={geo.sphere("lo")} material={white} position={[0.096, 0.016, 0.017]} scale={0.011} />
                  <mesh geometry={geo.sphere("lo")} material={white} position={[-0.074, 0.016, 0.017]} scale={0.011} />
                </group>
                <group ref={brows} position={[0, 0.105, 0.215]}>
                  <mesh geometry={geo.capsule(0.011, 0.05)} material={hair} position={[0.085, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
                  <mesh geometry={geo.capsule(0.011, 0.05)} material={hair} position={[-0.085, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
                </group>
                <mesh ref={smileArc} geometry={geo.torus(0.06, 0.013, Math.PI)} material={dark} position={[0, -0.085, 0.222]} rotation={[0, 0, Math.PI]} />
                <mesh ref={mouth} geometry={geo.sphere("lo")} material={dark} position={[0, -0.1, 0.214]} />
                <mesh geometry={geo.circle()} material={glow(COLORS.red, 0.22)} position={[0.14, -0.05, 0.19]} rotation={[0, 0.55, 0]} scale={0.035} />
                <mesh geometry={geo.circle()} material={glow(COLORS.red, 0.22)} position={[-0.14, -0.05, 0.19]} rotation={[0, -0.55, 0]} scale={0.035} />
              </group>
            </group>
          </group>
        </group>
      </group>
    );
  },
);
