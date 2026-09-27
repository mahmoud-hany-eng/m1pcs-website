"use client";

import { Suspense, forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, geo, glow, std } from "./assets";
import { pose as makePose, type Pose } from "./poses";

export type CharacterVariant = "rep" | "customer";

/** Imperative controller the director uses every frame (no React re-renders). */
export interface CharacterApi {
  root: THREE.Group;
  /** Mutable pose — scenes write into this every frame, `apply` poses the rig with it exactly. */
  target: Pose;
  place(x: number, z: number, yaw: number): void;
  setVisible(visible: boolean): void;
  /**
   * Poses the rig from `target`. No springs and no elapsed time: the rig
   * shows exactly the pose the scroll position describes. `clock` (story
   * seconds, scroll-derived) only phases a barely-there breathing cue.
   */
  apply(clock: number): void;
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

/** Tapered torso (lathe): broad shoulders, narrower waist — reads better than a capsule. */
let torsoGeometry: THREE.LatheGeometry | null = null;
function torso() {
  if (!torsoGeometry) {
    const profile = [
      [0.0, -0.06],
      [0.17, -0.05],
      [0.2, 0.04],
      [0.195, 0.2],
      [0.215, 0.38],
      [0.235, 0.5],
      [0.215, 0.58],
      [0.14, 0.64],
      [0.0, 0.66],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    torsoGeometry = new THREE.LatheGeometry(profile, 28);
  }
  return torsoGeometry;
}

/** The official M1 emblem, printed on the rep's shirt. */
function ShirtEmblem() {
  const tex = useLoader(THREE.TextureLoader, "/how-it-works/m1-emblem.png");
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (
    <group position={[0.1, 0.43, 0.188]} rotation={[-0.08, 0.3, 0]}>
      <mesh geometry={geo.circle(32)} material={std("#141416", { roughness: 0.5 })} scale={0.068} />
      <mesh geometry={geo.plane()} position={[0, 0.002, 0.002]} scale={[0.09, 0.077, 1]}>
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

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

    const target = useMemo(() => makePose(), []);
    // Each character breathes on its own phase so they never look synced.
    const phase = isRep ? 0 : 1.7;
    // The rep's brows sit just under the cap's brim; the customer's under the fringe.
    const browY = isRep ? 0.058 : 0.088;

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
        apply(clock) {
          const v = target;

          // A little life, phased by scroll (not time): breathing, sway, head drift.
          const breathe = Math.sin(clock * 2.1 + phase);
          const sway = Math.sin(clock * 0.9 + phase * 2);
          const time = clock;

          body.current.position.y = v.bob;
          const sq = v.squash;
          body.current.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

          spine.current.rotation.set(v.lean + breathe * 0.012, v.twist + sway * 0.03, v.side + sway * 0.02);
          chest.current.scale.set(1, 1 + breathe * 0.012, 0.82);

          head.current.rotation.set(
            v.headPitch + Math.sin(time * 1.3 + phase) * 0.025,
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
          const smile = Math.max(0, Math.min(1, v.smile));
          smileArc.current.scale.set(1 + smile * 0.25, 0.25 + smile * 0.85, 1);
          smileArc.current.position.y = -0.077 + smile * 0.011;
          const open = Math.max(0, Math.min(1, v.mouthOpen));
          // The mouth grows from nothing as it opens (no pop).
          const shown = Math.min(1, open / 0.06);
          mouth.current.visible = shown > 0.001;
          mouth.current.scale.set((0.045 + smile * 0.011) * shown, (0.011 + open * 0.04) * shown, 0.018 * shown);
          brows.current.position.y = browY + v.brow * (isRep ? 0.012 : 0.02);
          brows.current.children[0].rotation.z = Math.PI / 2 + 0.08 - v.brow * 0.18;
          brows.current.children[1].rotation.z = Math.PI / 2 - 0.08 + v.brow * 0.18;

          root.current.updateMatrixWorld(true);
        },
      }),
      [target, phase, browY, isRep],
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
        <group ref={side === "l" ? lShoulder : rShoulder} name={`${side}Arm`} position={[SHOULDER.x * s, SHOULDER.y, 0]}>
          <mesh geometry={geo.sphere("lo")} material={sleeve} scale={0.085} />
          <mesh geometry={geo.capsule(0.068, 0.16)} material={sleeve} position={[0, -UPPER_ARM / 2, 0]} />
          <group ref={side === "l" ? lElbow : rElbow} name={`${side}Elbow`} position={[0, -UPPER_ARM, 0]}>
            <mesh geometry={geo.sphere("lo")} material={forearm} scale={0.061} />
            <mesh geometry={geo.capsule(0.06, 0.17)} material={forearm} position={[0, -FOREARM / 2 + 0.02, 0]} />
            {!isRep && (
              <mesh geometry={geo.torus(0.058, 0.018)} material={std(COLORS.gold, { roughness: 0.5 })} position={[0, -FOREARM + 0.07, 0]} rotation={[Math.PI / 2, 0, 0]} />
            )}
            <mesh ref={side === "l" ? lHand : rHand} geometry={geo.sphere("lo")} material={skin} position={[0, -FOREARM - 0.005, 0.005]} scale={[0.064, 0.08, 0.054]} />
            <mesh geometry={geo.capsule(0.022, 0.035)} material={skin} position={[0.045 * s, -FOREARM + 0.01, 0.045]} rotation={[0.5, 0, -0.5 * s]} />
          </group>
        </group>
      );
    };

    const leg = (side: "l" | "r") => {
      const s = side === "l" ? 1 : -1;
      return (
        <group ref={side === "l" ? lLeg : rLeg} name={`${side}Leg`} position={[0.11 * s, 0, 0]}>
          <mesh geometry={geo.capsule(0.088, 0.18)} material={pants} position={[0, -THIGH / 2, 0]} />
          <group ref={side === "l" ? lKnee : rKnee} name={`${side}Knee`} position={[0, -THIGH, 0]}>
            <mesh geometry={geo.sphere("lo")} material={pants} scale={0.083} />
            <mesh geometry={geo.capsule(0.078, 0.2)} material={pants} position={[0, -SHIN / 2 + 0.01, 0]} />
            <mesh geometry={geo.roundBox(0.15, 0.1, 0.27, 0.045)} material={shoes} position={[0, -SHIN + 0.01, 0.055]} />
            <mesh geometry={geo.roundBox(0.16, 0.035, 0.285, 0.015)} material={std("#1a1a1d", { roughness: 0.8 })} position={[0, -SHIN - 0.04, 0.058]} />
          </group>
        </group>
      );
    };

    return (
      <group ref={root} name={variant}>
        {/* Soft contact shadow so figures stay grounded even without shadow maps. */}
        <mesh geometry={geo.circle()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} scale={0.42} material={glow("#000000", 0.45)} />
        <group ref={body} name="body">
          <group position={[0, HIP_Y, 0]}>
            <mesh geometry={geo.sphere("lo")} material={pants} scale={[0.22, 0.13, 0.16]} position={[0, 0.02, 0]} />
            {leg("l")}
            {leg("r")}
            <group ref={spine} name="spine" position={[0, SPINE_Y, 0]} rotation-order="YXZ">
              <mesh ref={chest} geometry={torso()} material={shirt} position={[0, 0, 0]} scale={[1, 1, 0.82]} />
              {isRep ? (
                <>
                  {/* Collar + M1 badge */}
                  <mesh geometry={geo.torus(0.1, 0.028)} material={std(COLORS.ink, { roughness: 0.5 })} position={[0, 0.56, 0]} rotation={[Math.PI / 2, 0, 0]} />
                  <Suspense fallback={null}>
                    <ShirtEmblem />
                  </Suspense>
                  {/* placket */}
                  <mesh geometry={geo.box()} material={std("#b8281d", { roughness: 0.6 })} position={[0, 0.47, 0.192]} scale={[0.035, 0.14, 0.01]} />
                </>
              ) : (
                <>
                  {/* Hood + drawstrings */}
                  <mesh geometry={geo.torus(0.14, 0.055)} material={shirt} position={[0, 0.56, -0.05]} rotation={[Math.PI / 2.4, 0, 0]} />
                  <mesh geometry={geo.capsule(0.01, 0.1)} material={std(COLORS.gold)} position={[0.045, 0.44, 0.192]} />
                  <mesh geometry={geo.capsule(0.01, 0.1)} material={std(COLORS.gold)} position={[-0.045, 0.44, 0.192]} />
                  <mesh geometry={geo.box()} material={std("#d8d4cc")} position={[0, 0.22, 0.176]} scale={[0.26, 0.1, 0.01]} />
                </>
              )}
              {arm("l")}
              {arm("r")}
              <mesh geometry={geo.capsule(0.07, 0.06)} material={skin} position={[0, 0.63, 0]} />
              <group ref={head} name="head" position={[0, HEAD_Y, 0]} rotation-order="YXZ">
                <mesh geometry={geo.sphere()} material={skin} scale={[0.228, 0.22, 0.214]} />
                {/* ears */}
                <mesh geometry={geo.sphere("lo")} material={skin} position={[0.222, -0.01, 0]} scale={[0.037, 0.055, 0.032]} />
                <mesh geometry={geo.sphere("lo")} material={skin} position={[-0.222, -0.01, 0]} scale={[0.037, 0.055, 0.032]} />
                {isRep ? (
                  <>
                    {/* M1 cap: crown, brim, button */}
                    <mesh geometry={geo.hemisphere()} material={std(COLORS.red, { roughness: 0.55 })} position={[0, 0.04, -0.005]} scale={[0.238, 0.2, 0.229]} />
                    <mesh geometry={geo.roundBox(0.27, 0.018, 0.155, 0.008)} material={std(COLORS.red, { roughness: 0.55 })} position={[0, 0.068, 0.228]} rotation={[-0.06, 0, 0]} />
                    <mesh geometry={geo.sphere("lo")} material={std(COLORS.red, { roughness: 0.5 })} position={[0, 0.238, -0.005]} scale={[0.024, 0.014, 0.024]} />
                    <mesh geometry={geo.circle()} material={std(COLORS.gold, { roughness: 0.35, metalness: 0.6 })} position={[0, 0.148, 0.178]} rotation={[-0.62, 0, 0]} scale={0.036} />
                    {/* short hair below the cap: back of the head + sideburns */}
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[0, -0.01, -0.085]} scale={[0.2, 0.14, 0.15]} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[0.2, -0.02, -0.075]} scale={[0.022, 0.05, 0.034]} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[-0.2, -0.02, -0.075]} scale={[0.022, 0.05, 0.034]} />
                  </>
                ) : (
                  <>
                    <mesh geometry={geo.hemisphere()} material={hair} position={[0, 0.018, -0.01]} scale={[0.238, 0.228, 0.232]} rotation={[-0.25, 0, 0]} />
                    <mesh geometry={geo.sphere("lo")} material={hair} position={[0.063, 0.135, 0.153]} scale={[0.145, 0.063, 0.082]} rotation={[0.3, 0, -0.35]} />
                  </>
                )}
                {/* face */}
                <group ref={eyes} name="eyes" position={[0, 0.027, 0.19]}>
                  <mesh geometry={geo.sphere("lo")} material={eyeMat} position={[0.077, 0, 0]} scale={[0.031, 0.042, 0.018]} />
                  <mesh geometry={geo.sphere("lo")} material={eyeMat} position={[-0.077, 0, 0]} scale={[0.031, 0.042, 0.018]} />
                  <mesh geometry={geo.sphere("lo")} material={white} position={[0.087, 0.015, 0.015]} scale={0.01} />
                  <mesh geometry={geo.sphere("lo")} material={white} position={[-0.067, 0.015, 0.015]} scale={0.01} />
                </group>
                <group ref={brows} name="brows" position={[0, browY, 0.198]}>
                  <mesh geometry={geo.capsule(0.01, 0.045)} material={hair} position={[0.077, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
                  <mesh geometry={geo.capsule(0.01, 0.045)} material={hair} position={[-0.077, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
                </group>
                <mesh ref={smileArc} geometry={geo.torus(0.054, 0.012, Math.PI)} material={dark} position={[0, -0.077, 0.2]} rotation={[0, 0, Math.PI]} />
                <mesh ref={mouth} geometry={geo.sphere("lo")} material={dark} position={[0, -0.09, 0.194]} />
                <mesh geometry={geo.circle()} material={glow(COLORS.red, 0.2)} position={[0.126, -0.045, 0.172]} rotation={[0, 0.55, 0]} scale={0.032} />
                <mesh geometry={geo.circle()} material={glow(COLORS.red, 0.2)} position={[-0.126, -0.045, 0.172]} rotation={[0, -0.55, 0]} scale={0.032} />
              </group>
            </group>
          </group>
        </group>
      </group>
    );
  },
);
