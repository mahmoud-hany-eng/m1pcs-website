"use client";

import { Suspense, forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, geo, glow, std } from "./assets";
import { Batch } from "./batch";
import { CAR, carGeometry, roofAt, type CarMaterial, type CarPart } from "./car-geometry";
import { contactShadowTexture } from "./home";

export { CAR };

/**
 * The M1 delivery car: a dark-blue luxury sports coupe (styled after a
 * modern two-door grand tourer — no manufacturer badges) with the M1 logo
 * on both doors. Built procedurally (see car-geometry.ts); the driver's door
 * and the boot open, the wheels roll, and the cabin has seats, a dashboard
 * and a steering wheel, so the rep can visibly get in, drive and get out.
 *
 * Car-local frame: forward +Z, the driver's side +X, origin on the ground.
 */

/** Where the driver's root (feet line under the hips) sits when seated. */
export const SEAT = new THREE.Vector3(0.46, 0, 0.02);
/** Steering wheel centre (car-local). */
export const STEERING = new THREE.Vector3(0.46, 0.95, 0.53);
export const DOOR_MAX = 1.12;
export const TRUNK_MAX = 1.18;
/** The PC lying in the boot, glass side up: case-local origin (floor centre) in car space. */
export const TRUNK_PC = new THREE.Vector3(0, 0.72, -1.96);

export interface CarApi {
  root: THREE.Group;
  /** Driver's door 0 (shut) .. 1 (open). */
  setDoor(open: number): void;
  /** Boot lid 0 (shut) .. 1 (open). */
  setTrunk(open: number): void;
  /** Wheel roll angle (radians) — derived from the distance driven. */
  setRoll(angle: number): void;
}

type CarMaterials = {
  byName: Record<CarMaterial, THREE.Material>;
  paint: THREE.MeshPhysicalMaterial;
  interior: THREE.MeshStandardMaterial;
  linerMat: THREE.MeshStandardMaterial;
  darkChrome: THREE.Material;
  leather: THREE.Material;
  stitch: THREE.Material;
};
let materials: CarMaterials | null = null;

/** One shared set of car materials (every panel of one paint shares one program and one set of uniforms). */
function carMaterials(): CarMaterials {
  if (materials) return materials;
  materials = (() => {
    const paint = new THREE.MeshPhysicalMaterial({
      color: "#0e2352",
      metalness: 0.55,
      roughness: 0.33,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: "#0a1118",
      roughness: 0.04,
      metalness: 0.65,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tailLens = new THREE.MeshStandardMaterial({ color: "#3d0608", roughness: 0.18, metalness: 0.35, emissive: "#5c0808", emissiveIntensity: 0.7 });
    const byName: Record<CarMaterial, THREE.Material> = {
      paint,
      trim: std("#0a0a0c", { roughness: 0.32, metalness: 0.25 }),
      under: std("#060608", { roughness: 0.95 }),
      glass,
      darkGlass: std("#05070a", { roughness: 0.05, metalness: 0.9 }),
      lens: std("#0b0e12", { roughness: 0.1, metalness: 0.75 }),
      chrome: std("#c8cbd2", { roughness: 0.16, metalness: 1 }),
      ledWhite: glow("#eef5ff"),
      ledRed: glow("#ff2b1c"),
      tailLens,
    };
    const interior = new THREE.MeshStandardMaterial({ color: "#0c0c0e", roughness: 0.9, side: THREE.BackSide, envMapIntensity: 0.35 });
    const linerMat = new THREE.MeshStandardMaterial({ color: "#060608", roughness: 0.95, side: THREE.DoubleSide });
    const darkChrome = std("#6f737b", { roughness: 0.2, metalness: 1 });
    const leather = std("#1a1a1e", { roughness: 0.62, metalness: 0.05 });
    const stitch = std("#2a2a30", { roughness: 0.6 });
    return { byName, paint, interior, linerMat, darkChrome, leather, stitch };
  })();
  return materials;
}

function PartMeshes({ part, castShadow }: { part: CarPart; castShadow: boolean }) {
  const g = carGeometry();
  const m = carMaterials();
  return (
    <>
      {(Object.entries(g.outer[part]) as [CarMaterial, THREE.BufferGeometry][]).map(([mat, geometry]) => (
        <mesh key={mat} geometry={geometry} material={m.byName[mat]} castShadow={castShadow && (mat === "paint" || mat === "trim")} receiveShadow={mat === "paint"} />
      ))}
      {g.inner[part] && <mesh geometry={g.inner[part]!} material={m.interior} />}
    </>
  );
}

/** The M1 logo as a decal (lit like the paint, never glowing — only the studio sign glows). */
function Decal({ geometry }: { geometry: THREE.BufferGeometry }) {
  const logo = useLoader(THREE.TextureLoader, "/how-it-works/m1-logo-sign.webp");
  const mat = useMemo(() => {
    logo.colorSpace = THREE.SRGBColorSpace;
    logo.anisotropy = 8;
    return new THREE.MeshStandardMaterial({
      map: logo,
      transparent: true,
      roughness: 0.3,
      metalness: 0.15,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }, [logo]);
  return <mesh geometry={geometry} material={mat} />;
}

// ---------------------------------------------------------------- wheels

const wheelParts = (() => {
  let made: { tyre: THREE.BufferGeometry; spokes: THREE.BufferGeometry; barrel: THREE.BufferGeometry } | null = null;
  return () => {
    if (made) return made;
    // Tyre: lathe profile around +Y (the axle), outer face at +Y.
    const profile = [
      [0.292, 0.135],
      [0.33, 0.152],
      [0.372, 0.15],
      [0.394, 0.132],
      [0.401, 0.1],
      [0.401, -0.1],
      [0.394, -0.132],
      [0.372, -0.15],
      [0.33, -0.152],
      [0.292, -0.135],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tyre = new THREE.LatheGeometry(profile, 56);
    // Five double spokes, slightly dished.
    const parts: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let k = 0; k < 10; k++) {
      const pair = Math.floor(k / 2);
      const a = (pair / 5) * Math.PI * 2 + (k % 2 ? 0.16 : -0.16);
      const spoke = new THREE.BoxGeometry(0.042, 0.03, 0.2);
      spoke.translate(0, 0, 0.18);
      // Dish: the rim end sits deeper than the hub.
      m.makeRotationX(0.14);
      spoke.applyMatrix4(m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      m.makeRotationFromQuaternion(q);
      spoke.applyMatrix4(m);
      spoke.translate(0, 0.118, 0);
      parts.push(spoke.toNonIndexed());
    }
    const spokes = mergeGeometries(parts, false)!;
    spokes.computeVertexNormals();
    // Rim barrel: open tube (a capped cylinder would hide the spokes).
    const barrel = new THREE.CylinderGeometry(0.29, 0.29, 0.25, 40, 1, true);
    made = { tyre, spokes, barrel };
    return made;
  };
})();

function Wheel({ side, z, roll }: { side: 1 | -1; z: number; roll: (el: THREE.Group | null) => void }) {
  const { tyre, spokes, barrel: barrelGeo } = wheelParts();
  const rubber = std("#101012", { roughness: 0.88 });
  const rim = std("#a7acb4", { roughness: 0.24, metalness: 0.92 });
  const barrel = std("#34373d", { roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
  const disc = std("#8d9098", { roughness: 0.35, metalness: 0.9 });
  const caliper = std("#1f4fc4", { roughness: 0.35, metalness: 0.2 });
  return (
    <group position={[side * CAR.wheelX, CAR.wheelR, z]}>
      <group ref={roll} userData={{ dynamic: true }}>
        <Batch>
          <group rotation={[0, 0, -side * (Math.PI / 2)]}>
            <mesh geometry={tyre} material={rubber} castShadow />
            <mesh geometry={barrelGeo} material={barrel} />
            <mesh geometry={geo.torus(0.288, 0.013)} material={rim} position={[0, 0.128, 0]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={spokes} material={rim} />
            <mesh geometry={geo.cylinder(1, 1, 24)} material={rim} position={[0, 0.118, 0]} scale={[0.075, 0.03, 0.075]} />
            <mesh geometry={geo.cylinder(1, 1, 24)} material={std(COLORS.red, { roughness: 0.4 })} position={[0, 0.136, 0]} scale={[0.036, 0.008, 0.036]} />
            <mesh geometry={geo.cylinder(1, 1, 32)} material={disc} position={[0, 0.03, 0]} scale={[0.245, 0.018, 0.245]} />
          </group>
        </Batch>
      </group>
      {/* caliper: fixed, top-rear of the disc */}
      <mesh geometry={geo.roundBox(0.07, 0.2, 0.09, 0.025)} material={caliper} position={[side * -0.05, 0.14, -0.16]} rotation={[-0.78, 0, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------- cabin

function Cabin() {
  const m = carMaterials();
  const dash = std("#101013", { roughness: 0.55 });
  const screen = std("#07080b", { roughness: 0.08, metalness: 0.6 });
  const seat = (x: number) => (
    <group position={[x, 0, 0]}>
      <mesh geometry={geo.roundBox(0.46, 0.14, 0.54, 0.05)} material={m.leather} position={[0, 0.3, 0.03]} />
      <group position={[0, 0.36, -0.26]} rotation={[-0.2, 0, 0]}>
        <mesh geometry={geo.roundBox(0.46, 0.76, 0.14, 0.05)} material={m.leather} position={[0, 0.38, 0]} />
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={geo.roundBox(0.08, 0.5, 0.16, 0.035)} material={m.stitch} position={[s * 0.22, 0.3, 0.03]} />
        ))}
      </group>
    </group>
  );
  return (
    <group name="cabin">
      <mesh geometry={geo.box()} material={dash} position={[0, 0.16, -0.1]} scale={[1.9, 0.02, 2.6]} />
      {seat(SEAT.x)}
      {seat(-SEAT.x)}
      {/* rear bench */}
      <mesh geometry={geo.roundBox(1.36, 0.12, 0.46, 0.04)} material={m.leather} position={[0, 0.34, -0.98]} />
      <mesh geometry={geo.roundBox(1.36, 0.52, 0.12, 0.04)} material={m.leather} position={[0, 0.66, -1.2]} rotation={[-0.3, 0, 0]} />
      {/* dashboard, screens, console */}
      <mesh geometry={geo.roundBox(1.92, 0.26, 0.5, 0.09)} material={dash} position={[0, 0.86, 0.9]} />
      <mesh geometry={geo.box()} material={screen} position={[0.34, 1.02, 0.7]} rotation={[-0.35, 0, 0]} scale={[0.72, 0.16, 0.02]} />
      <mesh geometry={geo.roundBox(0.26, 0.3, 1.05, 0.05)} material={dash} position={[0, 0.32, 0.25]} />
      {/* steering column + wheel */}
      <mesh geometry={geo.cylinder(1, 1, 12)} material={dash} position={[STEERING.x, 0.9, 0.66]} rotation={[1.2, 0, 0]} scale={[0.035, 0.28, 0.035]} />
      <group position={STEERING} rotation={[-0.38, 0, 0]}>
        <mesh geometry={geo.torus(0.165, 0.022)} material={m.leather} />
        <mesh geometry={geo.cylinder(1, 1, 20)} material={dash} rotation={[Math.PI / 2, 0, 0]} scale={[0.055, 0.04, 0.055]} />
        {[0, 2.1, -2.1].map((a) => (
          <mesh key={a} geometry={geo.box()} material={dash} position={[Math.sin(a) * 0.09, -Math.cos(a) * 0.09 * (a === 0 ? 1 : -0.6), 0]} rotation={[0, 0, a]} scale={[0.028, 0.16, 0.02]} />
        ))}
      </group>
      {/* boot floor */}
      <mesh geometry={geo.box()} material={dash} position={[0, 0.52, -2.3]} scale={[1.6, 0.03, 0.9]} />
    </group>
  );
}

// ---------------------------------------------------------------- the car

export const Car = forwardRef<CarApi, { castShadow?: boolean }>(function Car({ castShadow = false }, ref) {
  const g = carGeometry();
  const m = carMaterials();
  const root = useRef<THREE.Group>(null!);
  const door = useRef<THREE.Group>(null!);
  const trunk = useRef<THREE.Group>(null!);
  const wheels = useRef<(THREE.Group | null)[]>([]);
  const shadow = useMemo(() => contactShadowTexture(), []);

  useImperativeHandle(
    ref,
    () => ({
      get root() {
        return root.current;
      },
      setDoor(open) {
        door.current.rotation.y = -open * DOOR_MAX;
      },
      setTrunk(open) {
        trunk.current.rotation.x = open * TRUNK_MAX;
      },
      setRoll(angle) {
        for (const w of wheels.current) if (w) w.rotation.x = angle;
      },
    }),
    [],
  );

  // Grille (two tall vertical kidneys), mirror housings.
  const kidney = useMemo(() => {
    const shape = new THREE.Shape();
    const w = 0.3;
    const h = 0.46;
    const r = 0.07;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const inner = new THREE.Path();
    const iw = w - 0.05;
    const ih = h - 0.05;
    const ir = r - 0.02;
    inner.moveTo(-iw / 2 + ir, -ih / 2);
    inner.lineTo(iw / 2 - ir, -ih / 2);
    inner.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + ir);
    inner.lineTo(iw / 2, ih / 2 - ir);
    inner.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - ir, ih / 2);
    inner.lineTo(-iw / 2 + ir, ih / 2);
    inner.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - ir);
    inner.lineTo(-iw / 2, -ih / 2 + ir);
    inner.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + ir, -ih / 2);
    shape.holes.push(inner);
    const frame = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 6 });
    frame.translate(0, 0, -0.05);
    const fill = new THREE.ShapeGeometry(new THREE.Shape(inner.getPoints(8)));
    return { frame, fill, w, h };
  }, []);
  const mirror = useMemo(() => new RoundedBoxGeometry(0.1, 0.1, 0.2, 3, 0.04), []);
  const liner = useMemo(() => new THREE.CylinderGeometry(0.49, 0.49, 0.44, 28, 1, true), []);

  const hinge = g.doorHinge;
  const trunkHinge = g.trunkHinge;
  const roofY = roofAt(-0.78);

  const mirrorAssembly = (side: 1 | -1) => (
    <group position={[side * 1.0, 1.08, 0.93]} rotation={[0, side * 0.12, 0]}>
      <mesh geometry={geo.box()} material={m.byName.trim} position={[-side * 0.05, -0.02, 0]} scale={[0.12, 0.03, 0.08]} />
      <mesh geometry={mirror} material={m.paint} position={[side * 0.06, 0.02, 0]} castShadow={castShadow} />
      <mesh geometry={geo.plane()} material={m.byName.darkGlass} position={[side * 0.06, 0.02, -0.101]} rotation={[0, Math.PI, 0]} scale={[0.085, 0.08, 1]} />
    </group>
  );

  return (
    <group ref={root} name="car">
      {/* Body, cabin, grille and trim are static: one draw per material. Door, boot and wheels move. */}
      <Batch name="carBatch">
        <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} scale={[2.9, 6.6, 1]}>
          <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
        </mesh>

        <PartMeshes part="body" castShadow={castShadow} />
        <Suspense fallback={null}>
          <Decal geometry={g.decal.body} />
        </Suspense>

        {/* driver's door (with its frameless glass, mirror and logo) swings on its front hinge */}
        <group ref={door} name="carDoor" position={[hinge.x, 0, hinge.y]} userData={{ dynamic: true }}>
          <Batch>
            <group position={[-hinge.x, 0, -hinge.y]}>
              <PartMeshes part="door" castShadow={castShadow} />
              <Suspense fallback={null}>
                <Decal geometry={g.decal.door} />
              </Suspense>
              {mirrorAssembly(1)}
              <mesh geometry={geo.roundBox(0.06, 0.08, 0.5, 0.02)} material={m.leather} position={[0.98, 0.62, 0.3]} />
            </group>
          </Batch>
        </group>
        {mirrorAssembly(-1)}

        {/* boot lid, hinged at the base of the rear window */}
        <group ref={trunk} name="carTrunk" position={[0, trunkHinge.x, trunkHinge.y]} userData={{ dynamic: true }}>
          <group position={[0, -trunkHinge.x, -trunkHinge.y]}>
            <PartMeshes part="trunk" castShadow={castShadow} />
          </group>
        </group>

        {/* grille */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.18, 0.57, CAR.front + 0.005]} rotation={[-0.17, 0, 0]}>
            <mesh geometry={kidney.frame} material={m.darkChrome} />
            <mesh geometry={kidney.fill} material={m.byName.trim} position={[0, 0, 0.0]} />
            {[-0.1, -0.05, 0, 0.05, 0.1].map((x) => (
              <mesh key={x} geometry={geo.box()} material={m.byName.lens} position={[x, 0, 0.025]} scale={[0.012, kidney.h - 0.08, 0.02]} />
            ))}
          </group>
        ))}

        {/* exhaust tips, antenna */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.64, 0.36, CAR.rear + 0.06]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh geometry={geo.cylinder(1, 1, 24)} material={m.byName.chrome} scale={[0.055, 0.12, 0.055]} />
            <mesh geometry={geo.cylinder(1, 1, 24)} material={m.byName.under} position={[0, -0.061, 0]} scale={[0.042, 0.01, 0.042]} />
          </group>
        ))}
        <mesh geometry={geo.roundBox(0.06, 0.06, 0.17, 0.025)} material={m.byName.trim} position={[0, roofY + 0.012, -0.78]} />

        {/* wheel arch liners and the unseen underbody, so nothing is see-through from low angles */}
        {[CAR.frontAxle, CAR.rearAxle].map((z) =>
          [-1, 1].map((s) => (
            <mesh key={`${z}${s}`} geometry={liner} material={m.linerMat} position={[s * 0.8, CAR.wheelR, z]} rotation={[0, 0, Math.PI / 2]} />
          )),
        )}
        <mesh geometry={geo.box()} material={m.byName.under} position={[0, 0.5, 1.9]} scale={[1.2, 0.62, 1.3]} />
        <mesh geometry={geo.box()} material={m.byName.under} position={[0, 0.55, -1.85]} scale={[1.2, 0.62, 1.2]} />

        <Cabin />

        {[
          [1, CAR.frontAxle],
          [-1, CAR.frontAxle],
          [1, CAR.rearAxle],
          [-1, CAR.rearAxle],
        ].map(([s, z], i) => (
          <Wheel
            key={i}
            side={s as 1 | -1}
            z={z}
            roll={(el) => {
              wheels.current[i] = el;
            }}
          />
        ))}
      </Batch>
    </group>
  );
});
