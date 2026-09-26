"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, geo, glow, std } from "./assets";
import type { PartId } from "./layout";

/**
 * Stylised PC components built from primitives. All models are centred on
 * their origin and shown "product-shot" style (the interesting face
 * towards +Z) so they read clearly from the camera.
 */

const M = {
  pcb: () => std(COLORS.pcb, { roughness: 0.6 }),
  black: () => std("#131316", { roughness: 0.42, metalness: 0.35 }),
  shroud: () => std("#202024", { roughness: 0.38, metalness: 0.45 }),
  steel: () => std(COLORS.steel, { roughness: 0.28, metalness: 0.85 }),
  goldMetal: () => std(COLORS.gold, { roughness: 0.3, metalness: 0.85 }),
};

/** Spinning fan in the XY plane facing +Z. `speed` is read every frame (rad/s). */
export function Fan({
  radius,
  speed,
  ring,
}: {
  radius: number;
  speed?: React.RefObject<number>;
  ring?: THREE.Material;
}) {
  const blades = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    blades.current.rotation.z -= (speed?.current ?? 2.2) * Math.min(dt, 0.05);
  });
  const bladeMat = std("#26262b", { roughness: 0.5 });
  return (
    <group>
      <mesh geometry={geo.torus(radius, radius * 0.09)} material={ring ?? std(COLORS.graphite, { roughness: 0.5 })} />
      <mesh geometry={geo.circle(28)} material={std("#0b0b0d")} position={[0, 0, -0.004]} scale={radius} />
      <group ref={blades}>
        {Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2;
          return (
            <mesh
              key={i}
              geometry={geo.box()}
              material={bladeMat}
              position={[Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5, 0]}
              rotation={[0.35, 0, a]}
              scale={[radius * 0.62, radius * 0.3, 0.008]}
            />
          );
        })}
        <mesh geometry={geo.cylinder(1, 1, 20)} material={std(COLORS.graphite, { roughness: 0.4 })} rotation={[Math.PI / 2, 0, 0]} scale={[radius * 0.28, 0.02, radius * 0.28]} />
      </group>
    </group>
  );
}

export function CpuModel() {
  return (
    <group>
      <mesh geometry={geo.roundBox(0.3, 0.3, 0.03, 0.012)} material={std("#1b3325", { roughness: 0.55 })} />
      <mesh geometry={geo.roundBox(0.2, 0.2, 0.035, 0.014)} material={M.steel()} position={[0, 0, 0.03]} />
      <mesh geometry={geo.box()} material={std("#6d6d75", { roughness: 0.4, metalness: 0.6 })} position={[0, 0, 0.049]} scale={[0.1, 0.05, 0.002]} />
      <mesh geometry={geo.box()} material={M.goldMetal()} position={[-0.125, -0.125, 0.017]} scale={[0.03, 0.03, 0.004]} rotation={[0, 0, Math.PI / 4]} />
    </group>
  );
}

export function GpuModel({ fanSpeed, rgb }: { fanSpeed?: React.RefObject<number>; rgb?: THREE.Material }) {
  return (
    <group>
      <mesh geometry={geo.roundBox(0.62, 0.21, 0.12, 0.03)} material={M.shroud()} />
      <mesh geometry={geo.box()} material={M.steel()} position={[0, 0, -0.064]} scale={[0.6, 0.2, 0.008]} />
      <mesh geometry={geo.box()} material={rgb ?? glow(COLORS.red)} position={[0, 0.098, 0.05]} scale={[0.5, 0.012, 0.02]} />
      <mesh geometry={geo.box()} material={M.goldMetal()} position={[-0.06, -0.112, -0.02]} scale={[0.3, 0.02, 0.02]} />
      <group position={[-0.15, -0.005, 0.062]}>
        <Fan radius={0.085} speed={fanSpeed} />
      </group>
      <group position={[0.15, -0.005, 0.062]}>
        <Fan radius={0.085} speed={fanSpeed} />
      </group>
    </group>
  );
}

export function RamModel({ rgb }: { rgb?: THREE.Material }) {
  const stick = (z: number, color: THREE.Material) => (
    <group position={[0, 0, z]}>
      <mesh geometry={geo.box()} material={M.black()} scale={[0.42, 0.1, 0.018]} />
      <mesh geometry={geo.box()} material={color} position={[0, 0.058, 0]} scale={[0.4, 0.016, 0.022]} />
      <mesh geometry={geo.box()} material={M.goldMetal()} position={[0, -0.055, 0]} scale={[0.38, 0.012, 0.02]} />
    </group>
  );
  return (
    <group>
      {stick(0.03, rgb ?? glow(COLORS.gold))}
      {stick(-0.03, rgb ?? glow(COLORS.red))}
    </group>
  );
}

export function SsdModel() {
  return (
    <group>
      <mesh geometry={geo.box()} material={M.black()} scale={[0.34, 0.085, 0.012]} />
      <mesh geometry={geo.box()} material={std("#2d2d33", { roughness: 0.4, metalness: 0.4 })} position={[-0.06, 0, 0.009]} scale={[0.08, 0.06, 0.008]} />
      <mesh geometry={geo.box()} material={std("#2d2d33", { roughness: 0.4, metalness: 0.4 })} position={[0.05, 0, 0.009]} scale={[0.08, 0.06, 0.008]} />
      <mesh geometry={geo.box()} material={glow(COLORS.gold)} position={[0.12, 0, 0.009]} scale={[0.04, 0.06, 0.004]} />
      <mesh geometry={geo.box()} material={M.goldMetal()} position={[-0.165, 0, 0]} scale={[0.012, 0.07, 0.014]} />
    </group>
  );
}

export function BoardModel() {
  return (
    <group>
      <mesh geometry={geo.roundBox(0.48, 0.48, 0.02, 0.008)} material={M.pcb()} />
      <mesh geometry={geo.box()} material={M.steel()} position={[0.0, 0.08, 0.016]} scale={[0.1, 0.1, 0.012]} />
      {[0.14, 0.165, 0.19, 0.215].map((x) => (
        <mesh key={x} geometry={geo.box()} material={M.black()} position={[x, 0.08, 0.016]} scale={[0.012, 0.26, 0.014]} />
      ))}
      <mesh geometry={geo.box()} material={M.black()} position={[-0.02, -0.09, 0.016]} scale={[0.3, 0.02, 0.014]} />
      <mesh geometry={geo.box()} material={M.black()} position={[-0.02, -0.16, 0.016]} scale={[0.3, 0.02, 0.014]} />
      <mesh geometry={geo.roundBox(0.14, 0.05, 0.04, 0.008)} material={M.shroud()} position={[-0.06, 0.2, 0.022]} />
      <mesh geometry={geo.roundBox(0.05, 0.14, 0.04, 0.008)} material={M.shroud()} position={[-0.17, 0.12, 0.022]} />
      <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[-0.06, 0.225, 0.043]} scale={[0.12, 0.006, 0.004]} />
      <mesh geometry={geo.roundBox(0.1, 0.1, 0.03, 0.01)} material={M.shroud()} position={[0.12, -0.16, 0.02]} />
      <mesh geometry={geo.circle(20)} material={glow(COLORS.gold)} position={[0.12, -0.16, 0.036]} scale={0.022} />
      <mesh geometry={geo.box()} material={M.steel()} position={[-0.225, 0.12, 0.025]} scale={[0.03, 0.18, 0.05]} />
    </group>
  );
}

export function CaseModel() {
  const glass = std("#8fa3b8", { roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.22 });
  return (
    <group>
      <mesh geometry={geo.roundBox(0.3, 0.44, 0.34, 0.025)} material={M.black()} />
      <mesh geometry={geo.plane()} material={glass} position={[0, 0.0, 0.1715]} scale={[0.26, 0.38, 1]} />
      <mesh geometry={geo.box()} material={glow(COLORS.gold)} position={[0.152, 0, 0.12]} scale={[0.004, 0.36, 0.012]} />
      <group position={[0.05, 0.08, 0.02]}>
        <Fan radius={0.06} ring={glow(COLORS.red)} />
      </group>
      <group position={[0.05, -0.07, 0.02]}>
        <Fan radius={0.06} ring={glow(COLORS.red)} />
      </group>
      <mesh geometry={geo.box()} material={M.shroud()} position={[0, -0.16, 0.02]} scale={[0.26, 0.08, 0.26]} />
    </group>
  );
}

export const PART_MODELS: Record<PartId, () => React.ReactElement> = {
  cpu: CpuModel,
  gpu: () => <GpuModel />,
  ram: () => <RamModel />,
  ssd: SsdModel,
  board: BoardModel,
  case: CaseModel,
};
