"use client";

import { Suspense, forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, canvasTexture, geo, glow, std } from "./assets";

/**
 * Chapter 6 set pieces, built from the same primitives and palette as the
 * studio: the M1 delivery van, the road that bridges the studio island to
 * the customer's home island, and the home itself.
 *
 * Studio coordinates: the home island sits east of the studio (+X), the
 * road runs along ROAD_Z in front of both.
 */
export const HOME = new THREE.Vector3(12.2, 0, 0);
export const HOME_RADIUS = 3.6;
export const ROAD_Z = 2.45;
/** Front face of the house (the door is set into it). */
export const HOUSE_FRONT_Z = -0.25;
export const DOOR_X = 12.35;
const DOOR_W = 0.62;
const DOOR_H = 1.24;
const WALL_H = 1.9;

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
  return canvasTexture("home-window", 128, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ffd99a");
    g.addColorStop(1, "#c9772f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Soft elliptical contact shadow (dithered radial gradient). */
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

// ---------------------------------------------------------------- van

export interface VanApi {
  root: THREE.Group;
  /** Rear doors 0 (shut) .. 1 (open). */
  setDoors(open: number): void;
  /** Wheel roll angle (radians) — derived from the distance driven. */
  setRoll(angle: number): void;
  setDriver(visible: boolean): void;
}

function VanDecal() {
  const logo = useLoader(THREE.TextureLoader, "/how-it-works/m1-logo-sign.webp");
  logo.colorSpace = THREE.SRGBColorSpace;
  logo.anisotropy = 8;
  const aspect = logo.image.width / logo.image.height;
  const h = 0.58;
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.plane()} position={[0.583 * side, 0.9, -0.35]} rotation={[0, (Math.PI / 2) * side, 0]} scale={[h * aspect, h, 1]}>
          <meshBasicMaterial map={logo} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** Compact M1 delivery van. Model faces +Z (like the characters); origin on the ground. */
export const Van = forwardRef<VanApi>(function Van(_, ref) {
  const root = useRef<THREE.Group>(null!);
  const doorL = useRef<THREE.Group>(null!);
  const doorR = useRef<THREE.Group>(null!);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const driver = useRef<THREE.Group>(null!);
  const shadow = useMemo(() => contactShadowTexture(), []);

  useImperativeHandle(
    ref,
    () => ({
      get root() {
        return root.current;
      },
      setDoors(open) {
        doorL.current.rotation.y = -open * 1.85;
        doorR.current.rotation.y = open * 1.85;
      },
      setRoll(angle) {
        for (const w of wheels.current) if (w) w.rotation.x = angle;
      },
      setDriver(visible) {
        driver.current.visible = visible;
      },
    }),
    [],
  );

  const body = std("#f2f0eb", { roughness: 0.38, metalness: 0.08 });
  const trim = std("#16161a", { roughness: 0.55 });
  const red = std(COLORS.red, { roughness: 0.42 });
  const glass = std("#12161c", { roughness: 0.08, metalness: 0.6 });
  const tyre = std("#131315", { roughness: 0.85 });
  const hub = std("#b9bcc4", { roughness: 0.25, metalness: 0.85 });

  return (
    <group ref={root} name="van">
      <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} scale={[1.6, 2.9, 1]}>
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* cargo box + cab */}
      <mesh geometry={geo.roundBox(1.15, 1.2, 1.62, 0.1)} material={body} position={[0, 0.87, -0.34]} castShadow />
      <mesh geometry={geo.roundBox(1.12, 0.92, 0.74, 0.14)} material={body} position={[0, 0.73, 0.8]} castShadow />
      <mesh geometry={geo.roundBox(1.13, 0.2, 0.3, 0.06)} material={trim} position={[0, 0.34, 1.07]} />
      {/* windscreen + cab side windows */}
      <mesh geometry={geo.plane()} material={glass} position={[0, 0.98, 1.13]} rotation={[-0.42, 0, 0]} scale={[0.92, 0.36, 1]} />
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.plane()} material={glass} position={[0.566 * side, 0.95, 0.78]} rotation={[0, (Math.PI / 2) * side, 0]} scale={[0.48, 0.3, 1]} />
      ))}
      {/* M1 livery: red band + logo */}
      <mesh geometry={geo.box()} material={red} position={[0, 0.5, -0.02]} scale={[1.17, 0.12, 2.3]} />
      <Suspense fallback={null}>
        <VanDecal />
      </Suspense>
      {/* skirt, bumpers, lights */}
      <mesh geometry={geo.box()} material={trim} position={[0, 0.3, -0.02]} scale={[1.16, 0.12, 2.28]} />
      {[-0.36, 0.36].map((x) => (
        <mesh key={`h${x}`} geometry={geo.roundBox(0.2, 0.08, 0.02, 0.01)} material={glow(COLORS.warm)} position={[x, 0.62, 1.172]} />
      ))}
      {[-0.4, 0.4].map((x) => (
        <mesh key={`t${x}`} geometry={geo.box()} material={glow(COLORS.red)} position={[x, 0.95, -1.158]} scale={[0.08, 0.3, 0.01]} />
      ))}
      {/* rear doors, hinged at the sides */}
      <group ref={doorL} position={[0.565, 0.87, -1.155]}>
        <mesh geometry={geo.roundBox(0.56, 1.1, 0.04, 0.02)} material={body} position={[-0.28, 0, 0]} />
        <mesh geometry={geo.box()} material={trim} position={[-0.06, 0, -0.025]} scale={[0.02, 0.18, 0.02]} />
      </group>
      <group ref={doorR} position={[-0.565, 0.87, -1.155]}>
        <mesh geometry={geo.roundBox(0.56, 1.1, 0.04, 0.02)} material={body} position={[0.28, 0, 0]} />
        <mesh geometry={geo.box()} material={trim} position={[0.06, 0, -0.025]} scale={[0.02, 0.18, 0.02]} />
      </group>
      {/* dark cargo interior, seen when the doors open */}
      <mesh geometry={geo.plane()} material={std("#0c0c0e", { roughness: 1 })} position={[0, 0.87, -1.1]} rotation={[0, Math.PI, 0]} scale={[1.02, 1.08, 1]} />
      {/* wheels */}
      {[
        [-0.5, 0.72],
        [0.5, 0.72],
        [-0.5, -0.72],
        [0.5, -0.72],
      ].map(([x, z], i) => (
        <group
          key={i}
          position={[x, 0.23, z]}
          ref={(el) => {
            wheels.current[i] = el;
          }}
        >
          <mesh geometry={geo.cylinder(1, 1, 24)} material={tyre} rotation={[0, 0, Math.PI / 2]} scale={[0.23, 0.17, 0.23]} />
          <mesh geometry={geo.cylinder(1, 1, 16)} material={hub} rotation={[0, 0, Math.PI / 2]} scale={[0.12, 0.175, 0.12]} />
          <mesh geometry={geo.box()} material={trim} scale={[0.18, 0.04, 0.02]} position={[0, 0, 0]} />
        </group>
      ))}
      {/* the rep at the wheel (seen through the side window while driving) */}
      <group ref={driver} name="driver" position={[0.26, 0.96, 0.66]} visible={false}>
        <mesh geometry={geo.sphere()} material={std(COLORS.skinRep, { roughness: 0.62 })} scale={0.17} />
        <mesh geometry={geo.hemisphere()} material={std(COLORS.red, { roughness: 0.55 })} position={[0, 0.04, 0]} scale={[0.18, 0.15, 0.18]} />
        <mesh geometry={geo.capsule(0.13, 0.12)} material={std(COLORS.red, { roughness: 0.6 })} position={[0, -0.26, 0]} />
      </group>
    </group>
  );
});

// ---------------------------------------------------------------- road

/** Road from the studio across a short bridge to the home island. */
export function Road() {
  const asphalt = std("#141417", { roughness: 0.9 });
  const edge = std("#1b1b1f", { roughness: 0.8 });
  const x0 = 1.3;
  const x1 = 16.3;
  const len = x1 - x0;
  const dashes = useMemo(() => {
    const out: number[] = [];
    for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.75) out.push(x);
    return out;
  }, []);
  return (
    <group>
      <mesh geometry={geo.box()} material={asphalt} position={[(x0 + x1) / 2, 0.01, ROAD_Z]} scale={[len, 0.04, 1.5]} receiveShadow />
      {/* the bridge section between the islands: a slab with a lit edge */}
      <mesh geometry={geo.box()} material={edge} position={[6.5, -0.15, ROAD_Z]} scale={[4.6, 0.3, 1.62]} />
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.box()} material={glow(COLORS.red, 0.85)} position={[6.5, -0.02, ROAD_Z + side * 0.81]} scale={[4.6, 0.025, 0.02]} />
      ))}
      {dashes.map((x) => (
        <mesh key={x} geometry={geo.box()} material={std("#d9d5cc", { roughness: 0.6 })} position={[x, 0.033, ROAD_Z]} scale={[0.34, 0.004, 0.05]} />
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`e${side}`} geometry={geo.box()} material={std("#6d6a64", { roughness: 0.6 })} position={[(x0 + x1) / 2, 0.033, ROAD_Z + side * 0.7]} scale={[len, 0.004, 0.03]} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- home

function PalmTree({ position, lean = 0.12 }: { position: [number, number, number]; lean?: number }) {
  const trunk = std("#6e5234", { roughness: 0.9 });
  const leaf = std("#2f5d36", { roughness: 0.75, side: THREE.DoubleSide });
  const leafDark = std("#244a2b", { roughness: 0.75, side: THREE.DoubleSide });
  const segments = 6;
  return (
    <group position={position}>
      {Array.from({ length: segments }, (_, i) => {
        const y = 0.2 + i * 0.36;
        return (
          <mesh
            key={i}
            geometry={geo.cylinder(1, 1.18, 12)}
            material={trunk}
            position={[Math.sin((i / segments) * 1.2) * lean * 2.2, y, 0]}
            scale={[0.1 - i * 0.008, 0.38, 0.1 - i * 0.008]}
            castShadow
          />
        );
      })}
      <group position={[Math.sin(1.2) * lean * 2.2, 2.25, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, a, 0]}>
              <mesh geometry={geo.sphere("lo")} material={i % 2 ? leaf : leafDark} position={[0, -0.08, 0.5]} rotation={[0.55, 0, 0]} scale={[0.14, 0.025, 0.58]} castShadow />
            </group>
          );
        })}
        <mesh geometry={geo.sphere("lo")} material={std("#5a4128")} scale={0.12} />
      </group>
    </group>
  );
}

export interface HomeApi {
  /** Front door 0 (shut) .. 1 (open inwards). */
  setDoor(open: number): void;
}

/**
 * The customer's home: a modern two-volume villa with a palm, a lit
 * doorway and warm windows, on its own round island with a gold rim.
 */
export const Home = forwardRef<HomeApi>(function Home(_, ref) {
  const door = useRef<THREE.Group>(null!);
  const interior = useRef<THREE.MeshBasicMaterial>(null!);
  const tex = useMemo(() => ({ warm: warmInteriorTexture(), win: windowTexture(), shadow: contactShadowTexture() }), []);

  useImperativeHandle(
    ref,
    () => ({
      setDoor(open) {
        door.current.rotation.y = -open * 1.45;
        interior.current.opacity = 0.35 + open * 0.65;
      },
    }),
    [],
  );

  const wall = std("#e7e1d5", { roughness: 0.9 });
  const wallShade = std("#d6cfc1", { roughness: 0.9 });
  const dark = std("#232327", { roughness: 0.7 });
  const wood = std("#5c3b27", { roughness: 0.6 });
  const stone = std("#3a3632", { roughness: 0.9 });
  const lawn = std("#1f2d1c", { roughness: 1 });
  const ground = std("#171512", { roughness: 0.9 });

  const fx = HOUSE_FRONT_Z;
  const x0 = HOME.x - 1.35; // house left
  const x1 = HOME.x + 1.85; // house right
  const doorL = DOOR_X - DOOR_W / 2;
  const doorR = DOOR_X + DOOR_W / 2;
  const depth = 2.0;
  const zc = fx - depth / 2;

  const windowAt = (x: number, y: number, w: number, h: number, z = fx + 0.012) => (
    <group position={[x, y, z]}>
      <mesh geometry={geo.box()} material={dark} scale={[w + 0.08, h + 0.08, 0.04]} />
      <mesh geometry={geo.plane()} position={[0, 0, 0.022]} scale={[w, h, 1]}>
        <meshBasicMaterial map={tex.win} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.box()} material={dark} position={[0, 0, 0.03]} scale={[0.025, h, 0.02]} />
    </group>
  );

  return (
    <group>
      {/* island */}
      <mesh geometry={geo.cylinder(HOME_RADIUS, HOME_RADIUS + 0.12, 72)} material={ground} position={[HOME.x, -0.09, HOME.z]} scale={[1, 0.18, 1]} receiveShadow />
      <mesh geometry={geo.torus(HOME_RADIUS + 0.02, 0.028)} material={glow(COLORS.gold, 0.9)} rotation={[Math.PI / 2, 0, 0]} position={[HOME.x, 0.005, HOME.z]} />
      <mesh geometry={geo.box()} material={lawn} position={[HOME.x - 1.35, 0.006, 0.55]} scale={[1.9, 0.012, 1.1]} receiveShadow />
      <mesh geometry={geo.box()} material={lawn} position={[HOME.x + 1.45, 0.006, 0.55]} scale={[1.7, 0.012, 1.1]} receiveShadow />

      {/* ground floor: side/back walls, and a front wall built around the doorway */}
      <mesh geometry={geo.box()} material={wallShade} position={[x0 + 0.06, WALL_H / 2, zc]} scale={[0.12, WALL_H, depth]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wallShade} position={[x1 - 0.06, WALL_H / 2, zc]} scale={[0.12, WALL_H, depth]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wallShade} position={[HOME.x + 0.25, WALL_H / 2, fx - depth + 0.06]} scale={[x1 - x0, WALL_H, 0.12]} castShadow />
      <mesh geometry={geo.box()} material={wall} position={[(x0 + doorL) / 2, WALL_H / 2, fx - 0.06]} scale={[doorL - x0, WALL_H, 0.12]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wall} position={[(doorR + x1) / 2, WALL_H / 2, fx - 0.06]} scale={[x1 - doorR, WALL_H, 0.12]} castShadow receiveShadow />
      <mesh geometry={geo.box()} material={wall} position={[DOOR_X, (DOOR_H + WALL_H) / 2, fx - 0.06]} scale={[DOOR_W, WALL_H - DOOR_H, 0.12]} castShadow />
      {/* warm interior seen through the doorway */}
      <mesh geometry={geo.plane()} position={[DOOR_X, DOOR_H / 2, fx - 0.9]} scale={[DOOR_W + 0.5, DOOR_H + 0.2, 1]}>
        <meshBasicMaterial ref={interior} map={tex.warm} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.box()} material={std("#120d0a")} position={[DOOR_X, DOOR_H / 2, fx - 0.95]} scale={[DOOR_W + 0.7, DOOR_H + 0.4, 0.02]} />
      {/* roof slab with a slim overhang */}
      <mesh geometry={geo.box()} material={dark} position={[HOME.x + 0.25, WALL_H + 0.05, zc + 0.05]} scale={[x1 - x0 + 0.24, 0.1, depth + 0.3]} castShadow />
      {/* upper volume */}
      <mesh geometry={geo.box()} material={wall} position={[HOME.x - 0.35, WALL_H + 0.6, zc - 0.3]} scale={[1.9, 1.1, 1.3]} castShadow />
      <mesh geometry={geo.box()} material={dark} position={[HOME.x - 0.35, WALL_H + 1.2, zc - 0.28]} scale={[2.1, 0.08, 1.5]} castShadow />
      {windowAt(HOME.x - 0.35, WALL_H + 0.62, 1.1, 0.46, zc - 0.3 + 0.662)}
      {/* door frame, canopy, lamps */}
      <mesh geometry={geo.box()} material={dark} position={[DOOR_X, DOOR_H + 0.04, fx + 0.02]} scale={[DOOR_W + 0.14, 0.08, 0.06]} />
      <mesh geometry={geo.box()} material={dark} position={[doorL - 0.035, DOOR_H / 2, fx + 0.02]} scale={[0.07, DOOR_H, 0.06]} />
      <mesh geometry={geo.box()} material={dark} position={[doorR + 0.035, DOOR_H / 2, fx + 0.02]} scale={[0.07, DOOR_H, 0.06]} />
      <mesh geometry={geo.box()} material={dark} position={[DOOR_X, DOOR_H + 0.28, fx + 0.28]} scale={[1.3, 0.06, 0.6]} castShadow />
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.roundBox(0.07, 0.16, 0.06, 0.015)} material={glow(COLORS.warm)} position={[DOOR_X + side * 0.52, 1.05, fx + 0.03]} />
      ))}
      {/* front door, hinged on its left edge; opens inwards */}
      <group ref={door} name="door" position={[doorL, 0, fx - 0.03]}>
        <mesh geometry={geo.roundBox(DOOR_W - 0.02, DOOR_H - 0.02, 0.05, 0.012)} material={wood} position={[DOOR_W / 2, DOOR_H / 2, 0]} castShadow />
        <mesh geometry={geo.box()} material={std("#4a2f1f", { roughness: 0.6 })} position={[DOOR_W / 2, DOOR_H * 0.5, 0.027]} scale={[0.02, DOOR_H * 0.82, 0.01]} />
        <mesh geometry={geo.capsule(0.014, 0.14)} material={std(COLORS.gold, { roughness: 0.25, metalness: 0.9 })} position={[DOOR_W - 0.1, 0.62, 0.05]} />
      </group>
      {/* windows */}
      {windowAt(HOME.x - 0.75, 1.05, 0.95, 0.62)}
      {windowAt(HOME.x + 1.2, 1.05, 0.8, 0.62)}
      {/* porch step, path and planters */}
      <mesh geometry={geo.box()} material={stone} position={[DOOR_X, 0.04, fx + 0.35]} scale={[1.2, 0.08, 0.6]} receiveShadow />
      {[0.95, 1.4, 1.85].map((z) => (
        <mesh key={z} geometry={geo.roundBox(0.5, 0.03, 0.3, 0.01)} material={stone} position={[DOOR_X - 0.1 * (z - 0.9), 0.016, z]} receiveShadow />
      ))}
      {[-1, 1].map((side) => (
        <group key={`p${side}`} position={[DOOR_X + side * 0.82, 0, fx + 0.3]}>
          <mesh geometry={geo.roundBox(0.3, 0.32, 0.3, 0.03)} material={dark} position={[0, 0.16, 0]} castShadow />
          <mesh geometry={geo.sphere("lo")} material={std("#2f5d36", { roughness: 0.8 })} position={[0, 0.46, 0]} scale={[0.19, 0.2, 0.19]} castShadow />
        </group>
      ))}
      {/* mailbox by the path */}
      <group position={[DOOR_X + 0.75, 0, 1.75]}>
        <mesh geometry={geo.box()} material={dark} position={[0, 0.3, 0]} scale={[0.05, 0.6, 0.05]} />
        <mesh geometry={geo.roundBox(0.2, 0.16, 0.3, 0.04)} material={std(COLORS.red, { roughness: 0.45 })} position={[0, 0.66, 0]} castShadow />
      </group>
      <PalmTree position={[HOME.x - 2.05, 0, 0.35]} lean={0.1} />
      <PalmTree position={[HOME.x + 2.35, 0, -1.55]} lean={-0.08} />
      <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[HOME.x + 0.25, 0.008, zc]} scale={[4.2, 3.0, 1]}>
        <meshBasicMaterial map={tex.shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
});
