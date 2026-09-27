"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COLORS, canvasTexture, geo, glow, std } from "./assets";
import { Batch } from "./batch";

/**
 * Delivery set pieces, in studio coordinates: the street that leaves the M1
 * studio island from its west edge (level with the table, so it stays out
 * of the studio shots) and crosses a short bridge to the customer's home on
 * its own island. The car drives west in the lane nearest the houses, so its
 * driver's door (left side) faces the camera (+Z) — the rep is seen getting
 * in and out in full.
 */
export const ROAD_Z = 0.3;
export const ROAD_HALF = 1.6;
const ROAD_X0 = -4.3;
const ROAD_X1 = -45;

/** Far enough down the street that distance fog hides it from the studio and the car's parking spot. */
export const HOME = new THREE.Vector3(-37.2, 0, -2.4);
export const HOME_RADIUS = 6.7;
/** Front face of the house (the door is set into it). */
export const HOUSE_FRONT_Z = -3.0;
export const DOOR_X = HOME.x + 2.3;
export const DOOR_W = 0.98;
const DOOR_H = 2.2;
const HOUSE = { x0: HOME.x - 2.8, x1: HOME.x + 3.6, depth: 4.2, h: 2.7 };
/** Sidewalk strip between the front yard and the road. */
export const SIDEWALK = { z0: HOUSE_FRONT_Z + 1.05, z1: ROAD_Z - ROAD_HALF };
/** Garden wall along the front of the yard, with a gap for the path. */
const WALL_Z = HOUSE_FRONT_Z + 0.95;
export const PATH_X = DOOR_X;

/** Porch light position (a real point light in StoryCanvas). */
export const PORCH_LIGHT: [number, number, number] = [DOOR_X, 2.35, HOUSE_FRONT_Z + 1.0];

// ---------------------------------------------------------------- textures

function warmInteriorTexture() {
  return canvasTexture("home-interior", 128, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.55, 6, w / 2, h * 0.55, h * 0.62);
    g.addColorStop(0, "#fff0c8");
    g.addColorStop(0.45, "#ffc46b");
    g.addColorStop(1, "#8a3f14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function windowTexture() {
  return canvasTexture("home-window", 256, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ffe2a8");
    g.addColorStop(0.6, "#f4b865");
    g.addColorStop(1, "#b8672a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // soft interior shapes: a lamp glow and furniture silhouettes
    const r = ctx.createRadialGradient(w * 0.3, h * 0.35, 2, w * 0.3, h * 0.35, h * 0.6);
    r.addColorStop(0, "rgba(255,248,225,0.8)");
    r.addColorStop(1, "rgba(255,248,225,0)");
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(90,45,20,0.35)";
    ctx.fillRect(w * 0.55, h * 0.62, w * 0.3, h * 0.38);
    ctx.fillRect(w * 0.08, h * 0.72, w * 0.22, h * 0.28);
  });
}

/** Soft elliptical contact shadow (radial gradient). */
export function contactShadowTexture() {
  return canvasTexture("contact-shadow", 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,0.62)");
    g.addColorStop(0.55, "rgba(0,0,0,0.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Warm pool of light on the ground under a street lamp. */
function lightPoolTexture() {
  return canvasTexture("light-pool", 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,196,107,0.55)");
    g.addColorStop(0.5, "rgba(255,196,107,0.16)");
    g.addColorStop(1, "rgba(255,196,107,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- street

function StreetLamp({ x, z, facing = 1 }: { x: number; z: number; facing?: 1 | -1 }) {
  const pole = std("#1c1c20", { roughness: 0.5, metalness: 0.6 });
  const pool = useMemo(() => lightPoolTexture(), []);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo.cylinder(1, 1, 12)} material={pole} position={[0, 1.6, 0]} scale={[0.05, 3.2, 0.05]} castShadow />
      <mesh geometry={geo.box()} material={pole} position={[0, 3.18, facing * 0.35]} scale={[0.06, 0.05, 0.75]} />
      <mesh geometry={geo.roundBox(0.24, 0.07, 0.38, 0.03)} material={pole} position={[0, 3.14, facing * 0.68]} />
      <mesh geometry={geo.box()} material={glow("#ffe4b0")} position={[0, 3.1, facing * 0.68]} scale={[0.18, 0.012, 0.3]} />
      <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, facing * 0.68]} scale={[3.4, 3.4, 1]}>
        <meshBasicMaterial map={pool} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/** The street from the studio across the bridge to the customer's home. */
export function Road() {
  const asphalt = std("#131316", { roughness: 0.88 });
  const kerb = std("#5d5a55", { roughness: 0.75 });
  const paving = std("#34312d", { roughness: 0.85 });
  const deck = std("#101012", { roughness: 0.8 });
  const len = ROAD_X0 - ROAD_X1;
  const mid = (ROAD_X0 + ROAD_X1) / 2;
  // All lane dashes in one mesh (one draw call instead of dozens).
  const dashes = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let x = ROAD_X0 - 0.6; x > ROAD_X1 + 0.4; x -= 1.1) {
      const g = new THREE.BoxGeometry(0.5, 0.004, 0.07);
      g.translate(x, 0.034, ROAD_Z);
      parts.push(g);
    }
    return mergeGeometries(parts, false)!;
  }, []);
  const bridge = { x0: ROAD_X0, x1: HOME.x + Math.sqrt(HOME_RADIUS * HOME_RADIUS - (ROAD_Z - HOME.z) ** 2) - 0.05 };
  return (
    <Batch name="road">
      <mesh geometry={geo.box()} material={asphalt} position={[mid, 0.012, ROAD_Z]} scale={[len, 0.04, ROAD_HALF * 2]} receiveShadow />
      <mesh geometry={dashes} material={std("#cfcac0", { roughness: 0.6 })} />
      {[-1, 1].map((side) => (
        <mesh key={`e${side}`} geometry={geo.box()} material={kerb} position={[mid, 0.045, ROAD_Z + side * (ROAD_HALF + 0.05)]} scale={[len, 0.09, 0.1]} />
      ))}
      {/* bridge deck and a thin, warm edge line (the M1 logo is the only neon in the story) */}
      <mesh geometry={geo.box()} material={deck} position={[(bridge.x0 + bridge.x1) / 2, -0.2, ROAD_Z]} scale={[bridge.x0 - bridge.x1, 0.4, ROAD_HALF * 2 + 0.5]} />
      {[-1, 1].map((side) => (
        <mesh key={`b${side}`} geometry={geo.box()} material={glow("#8a6a3a", 0.8)} position={[(bridge.x0 + bridge.x1) / 2, -0.02, ROAD_Z + side * (ROAD_HALF + 0.26)]} scale={[bridge.x0 - bridge.x1, 0.02, 0.02]} />
      ))}
      {/* sidewalk in front of the homes */}
      <mesh geometry={geo.box()} material={paving} position={[(ROAD_X1 + bridge.x1) / 2 - 0.1, 0.03, (SIDEWALK.z0 + SIDEWALK.z1) / 2]} scale={[bridge.x1 - ROAD_X1 - 0.2, 0.06, SIDEWALK.z1 - SIDEWALK.z0]} receiveShadow />
      {/* lamps along the causeway (on the far kerb) and in front of the homes */}
      {[-9.5, -16.5, -23.5].map((x) => (
        <StreetLamp key={x} x={x} z={ROAD_Z - ROAD_HALF - 0.32} />
      ))}
      <StreetLamp x={HOME.x + 5.3} z={SIDEWALK.z0 + 0.2} />
      <StreetLamp x={HOME.x - 6.0} z={SIDEWALK.z0 + 0.2} />
    </Batch>
  );
}

// ---------------------------------------------------------------- home

function PalmTree({ position, lean = 0.12, scale = 1 }: { position: [number, number, number]; lean?: number; scale?: number }) {
  const trunk = std("#6e5234", { roughness: 0.9 });
  const leaf = std("#2f5d36", { roughness: 0.75, side: THREE.DoubleSide });
  const leafDark = std("#244a2b", { roughness: 0.75, side: THREE.DoubleSide });
  const segments = 7;
  return (
    <group position={position} scale={scale}>
      {Array.from({ length: segments }, (_, i) => {
        const y = 0.2 + i * 0.4;
        return (
          <mesh
            key={i}
            geometry={geo.cylinder(1, 1.18, 12)}
            material={trunk}
            position={[Math.sin((i / segments) * 1.2) * lean * 2.2, y, 0]}
            scale={[0.12 - i * 0.008, 0.42, 0.12 - i * 0.008]}
            castShadow
          />
        );
      })}
      <group position={[Math.sin(1.2) * lean * 2.2, 2.85, 0]}>
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, a, 0]}>
              <mesh geometry={geo.sphere("lo")} material={i % 2 ? leaf : leafDark} position={[0, -0.1, 0.62]} rotation={[0.55, 0, 0]} scale={[0.17, 0.03, 0.72]} castShadow />
            </group>
          );
        })}
        <mesh geometry={geo.sphere("lo")} material={std("#5a4128")} scale={0.14} />
      </group>
    </group>
  );
}

export interface HomeApi {
  /** Front door 0 (shut) .. 1 (open inwards). */
  setDoor(open: number): void;
}

/**
 * The customer's home: a modern two-storey villa (warm stucco, bronze
 * frames, a timber screen), a lit doorway under a slim canopy, a low
 * garden wall and palms, on its own island.
 */
export const Home = forwardRef<HomeApi>(function Home(_, ref) {
  const door = useRef<THREE.Group>(null!);
  const interior = useRef<THREE.MeshBasicMaterial>(null!);
  const tex = useMemo(() => ({ warm: warmInteriorTexture(), win: windowTexture(), shadow: contactShadowTexture() }), []);

  useImperativeHandle(
    ref,
    () => ({
      setDoor(open) {
        door.current.rotation.y = open * 1.5;
        interior.current.opacity = 0.45 + open * 0.55;
      },
    }),
    [],
  );

  const wall = std("#ece6d9", { roughness: 0.92 });
  const wallShade = std("#dcd4c4", { roughness: 0.92 });
  const bronze = std("#2b2622", { roughness: 0.45, metalness: 0.4 });
  const slab = std("#1f1d1c", { roughness: 0.7 });
  const wood = std("#6b4a33", { roughness: 0.55 });
  const stone = std("#3b3733", { roughness: 0.9 });
  const lawn = std("#1d2a1b", { roughness: 1 });
  const ground = std("#161412", { roughness: 0.9 });

  const fz = HOUSE_FRONT_Z;
  const { x0, x1, depth, h } = HOUSE;
  const doorL = DOOR_X - DOOR_W / 2;
  const doorR = DOOR_X + DOOR_W / 2;
  const zc = fz - depth / 2;

  const windowAt = (x: number, y: number, w: number, hh: number, z = fz + 0.012, mullions = 1) => (
    <group position={[x, y, z]}>
      <mesh geometry={geo.box()} material={bronze} scale={[w + 0.1, hh + 0.1, 0.05]} />
      <mesh geometry={geo.plane()} position={[0, 0, 0.027]} scale={[w, hh, 1]}>
        <meshBasicMaterial map={tex.win} toneMapped={false} />
      </mesh>
      {Array.from({ length: mullions }, (_, i) => (
        <mesh key={i} geometry={geo.box()} material={bronze} position={[-w / 2 + ((i + 1) * w) / (mullions + 1), 0, 0.035]} scale={[0.03, hh, 0.02]} />
      ))}
    </group>
  );

  // Everything but the front door is static: one draw per material.
  return (
    <Batch name="homeBatch">
      {/* island */}
      <mesh geometry={geo.cylinder(HOME_RADIUS, HOME_RADIUS + 0.12, 80)} material={ground} position={[HOME.x, -0.09, HOME.z]} scale={[1, 0.18, 1]} receiveShadow />
      <mesh geometry={geo.torus(HOME_RADIUS + 0.02, 0.022)} material={glow("#6d5530", 0.9)} rotation={[Math.PI / 2, 0, 0]} position={[HOME.x, 0.005, HOME.z]} />
      <mesh geometry={geo.box()} material={lawn} position={[(x0 + doorL - 0.4) / 2, 0.008, (fz + WALL_Z) / 2]} scale={[doorL - 0.4 - x0 + 0.6, 0.014, WALL_Z - fz]} receiveShadow />
      <mesh geometry={geo.box()} material={lawn} position={[(doorR + 0.4 + x1 + 0.8) / 2, 0.008, (fz + WALL_Z) / 2]} scale={[x1 + 0.8 - doorR - 0.4, 0.014, WALL_Z - fz]} receiveShadow />

      {/* ground floor: side/back walls and a front wall around the doorway and windows */}
      <mesh geometry={geo.box()} material={wallShade} position={[x0 + 0.08, h / 2, zc]} scale={[0.16, h, depth]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wallShade} position={[x1 - 0.08, h / 2, zc]} scale={[0.16, h, depth]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wallShade} position={[(x0 + x1) / 2, h / 2, fz - depth + 0.08]} scale={[x1 - x0, h, 0.16]} castShadow />
      <mesh geometry={geo.box()} material={wall} position={[(x0 + doorL) / 2, h / 2, fz - 0.08]} scale={[doorL - x0, h, 0.16]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wall} position={[(doorR + x1) / 2, h / 2, fz - 0.08]} scale={[x1 - doorR, h, 0.16]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wall} position={[DOOR_X, (DOOR_H + h) / 2, fz - 0.08]} scale={[DOOR_W, h - DOOR_H, 0.16]} castShadow />
      {/* warm hallway seen through the open door */}
      <mesh geometry={geo.plane()} position={[DOOR_X, DOOR_H / 2, fz - 1.1]} scale={[DOOR_W + 0.7, DOOR_H + 0.3, 1]}>
        <meshBasicMaterial ref={interior} map={tex.warm} transparent opacity={0.45} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.box()} material={std("#120d0a")} position={[DOOR_X, DOOR_H / 2, fz - 1.15]} scale={[DOOR_W + 0.9, DOOR_H + 0.5, 0.02]} />
      <mesh geometry={geo.box()} material={std("#3a2a1f", { roughness: 0.8 })} position={[DOOR_X, 0.005, fz - 0.6]} scale={[DOOR_W + 0.6, 0.01, 1.1]} />

      {/* ground-floor roof slab with a slim overhang */}
      <mesh geometry={geo.box()} material={slab} position={[(x0 + x1) / 2, h + 0.07, zc + 0.08]} scale={[x1 - x0 + 0.3, 0.14, depth + 0.36]} castShadow />
      {/* upper floor: set back, wide window band, timber screen */}
      <mesh geometry={geo.box()} material={wall} position={[HOME.x - 0.3, h + 1.2, zc - 0.25]} scale={[4.2, 2.1, depth - 0.9]} castShadow />
      <mesh geometry={geo.box()} material={slab} position={[HOME.x - 0.3, h + 2.32, zc - 0.2]} scale={[4.5, 0.14, depth - 0.6]} castShadow />
      {windowAt(HOME.x - 1.15, h + 1.2, 2.0, 1.0, zc - 0.25 + (depth - 0.9) / 2 + 0.012, 2)}
      <group position={[HOME.x + 0.8, h + 1.2, zc - 0.25 + (depth - 0.9) / 2 + 0.05]}>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} geometry={geo.box()} material={wood} position={[-0.72 + i * 0.18, 0, 0]} scale={[0.07, 1.7, 0.06]} castShadow />
        ))}
      </group>

      {/* door frame, canopy, wall lamps */}
      <mesh geometry={geo.box()} material={bronze} position={[DOOR_X, DOOR_H + 0.05, fz + 0.02]} scale={[DOOR_W + 0.16, 0.1, 0.08]} />
      <mesh geometry={geo.box()} material={bronze} position={[doorL - 0.04, DOOR_H / 2, fz + 0.02]} scale={[0.08, DOOR_H, 0.08]} />
      <mesh geometry={geo.box()} material={bronze} position={[doorR + 0.04, DOOR_H / 2, fz + 0.02]} scale={[0.08, DOOR_H, 0.08]} />
      <mesh geometry={geo.box()} material={slab} position={[DOOR_X, h - 0.08, fz + 0.5]} scale={[2.1, 0.1, 1.0]} castShadow />
      {[-1, 1].map((side) => (
        <group key={side} position={[DOOR_X + side * 0.78, 1.6, fz + 0.04]}>
          <mesh geometry={geo.roundBox(0.12, 0.26, 0.08, 0.02)} material={bronze} />
          <mesh geometry={geo.box()} material={glow(COLORS.warm)} position={[0, 0, 0.042]} scale={[0.07, 0.2, 0.004]} />
        </group>
      ))}
      {/* front door, hinged on its left edge; opens inwards */}
      <group ref={door} name="door" position={[doorL, 0, fz - 0.04]} userData={{ dynamic: true }}>
        <Batch>
          <mesh geometry={geo.roundBox(DOOR_W - 0.02, DOOR_H - 0.02, 0.06, 0.012)} material={wood} position={[DOOR_W / 2, DOOR_H / 2, 0]} castShadow />
          {[0.35, 0.75, 1.15, 1.55, 1.95].map((y) => (
            <mesh key={y} geometry={geo.box()} material={std("#58392a", { roughness: 0.6 })} position={[DOOR_W / 2, y, 0.032]} scale={[DOOR_W - 0.14, 0.02, 0.01]} />
          ))}
          <mesh geometry={geo.capsule(0.016, 0.34)} material={std(COLORS.gold, { roughness: 0.25, metalness: 0.9 })} position={[DOOR_W - 0.12, 1.05, 0.06]} />
        </Batch>
      </group>
      {/* windows */}
      {windowAt(HOME.x - 1.05, 1.45, 2.6, 1.4, fz + 0.012, 2)}
      {windowAt(HOME.x + 1.0, 1.45, 0.9, 1.4, fz + 0.012, 0)}

      {/* porch steps, path through the garden wall, planters */}
      <mesh geometry={geo.box()} material={stone} position={[DOOR_X, 0.05, fz + 0.4]} scale={[1.7, 0.1, 0.8]} receiveShadow />
      <mesh geometry={geo.box()} material={stone} position={[DOOR_X, 0.025, (fz + 0.8 + SIDEWALK.z0) / 2]} scale={[1.2, 0.05, SIDEWALK.z0 - fz - 0.8]} receiveShadow />
      {/* low stone garden wall with a pale cap, open at the path */}
      {[
        [x0 - 0.3, DOOR_X - 0.85],
        [DOOR_X + 0.85, x1 + 0.7],
      ].map(([a, b]) => (
        <group key={a} position={[(a + b) / 2, 0, WALL_Z]}>
          <mesh geometry={geo.box()} material={stone} position={[0, 0.2, 0]} scale={[b - a, 0.4, 0.2]} castShadow receiveShadow />
          <mesh geometry={geo.box()} material={wallShade} position={[0, 0.42, 0]} scale={[b - a + 0.04, 0.05, 0.25]} />
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={`p${side}`} position={[DOOR_X + side * 1.15, 0, fz + 0.4]}>
          <mesh geometry={geo.roundBox(0.36, 0.42, 0.36, 0.03)} material={bronze} position={[0, 0.21, 0]} castShadow />
          <mesh geometry={geo.sphere("lo")} material={std("#2f5d36", { roughness: 0.8 })} position={[0, 0.6, 0]} scale={[0.24, 0.26, 0.24]} castShadow />
        </group>
      ))}
      <PalmTree position={[x0 - 0.9, 0, 0.35]} lean={0.1} />
      <PalmTree position={[x1 + 0.9, 0, -1.2]} lean={-0.08} scale={0.92} />
      <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.01, zc]} scale={[x1 - x0 + 1.4, depth + 1.2, 1]}>
        <meshBasicMaterial map={tex.shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </Batch>
  );
});
