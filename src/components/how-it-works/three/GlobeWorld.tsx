"use client";

import { Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { CH } from "../story";
import { COLORS, geo, glow, glowTexture, std } from "./assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, smooth, window4 } from "./anim";
import { useScene, useWorld, type FrameState } from "./director";
import { maskAt } from "./globe-data";
import {
  GLOBE_CENTER,
  GLOBE_RADIUS as R,
  ROUTE_LIFT,
  SUPPLIERS,
  V_HUB,
  V_QATAR,
  V_SUPPLIERS,
  V_USA,
  geoVector,
  routeGround,
  routeHeading,
  routePoint,
  slerpVectors,
  viewQuaternion,
  viewQuaternionHeading,
} from "./globe-math";

/**
 * Chapter 4 — Sourced From The U.S.: the order flies from the M1 studio to
 * the U.S.; five suppliers light up, their parts converge on an east-coast
 * hub and are packed into one M1 parcel.
 * Chapter 5 — Shipped to Qatar: a cargo plane collects the parcel and flies
 * the arc to Qatar, filmed as a chase (the globe turns "course-up" beneath
 * it), then drops it at Qatar.
 * Beats are fractions of each chapter.
 */
export const SOURCE_BEATS = {
  fadeIn: [0.12, 0.26],
  studioShrink: [0.14, 0.36],
  toUsa: [0.26, 0.46],
  /** The order signal is on screen over `signal` and travels over `signalTravel` — in step with
   * the globe turning towards the U.S., so it stays mid-frame instead of racing to the edge. */
  signal: [0.2, 0.47],
  signalTravel: [0.24, 0.46],
  usaHighlight: [0.4, 0.48],
  supplier: 0.46,
  supplierStep: 0.035,
  boxes: 0.62,
  boxStep: 0.025,
  boxTravel: 0.12,
  toHub: [0.64, 0.82],
  sealed: [0.85, 0.88],
} as const;

export const SHIP_BEATS = {
  planeIn: [0.02, 0.12],
  load: [0.1, 0.16],
  chaseIn: [0.1, 0.24],
  flight: [0.16, 0.84],
  chaseOut: [0.76, 0.9],
  arrival: [0.84, 0.9],
  leave: [0.86, 0.95],
} as const;

/** Chapter 6 beats that belong to the globe (the dive back into Qatar). */
const DIVE = { regrow: [0.02, 0.16], fadeOut: [0.05, 0.15] } as const;

const STUDIO_MIN_SCALE = 0.035;
/** Bounding sphere of everything in the studio set (street and home included), studio-local. */
const STUDIO_BOUNDS = { center: new THREE.Vector3(-20.3, 2.3, -2.4), radius: 27 };
/** The ocean sphere is a polygon: its silhouette sits a hair inside the true radius. */
const OCCLUDER_RADIUS = R * 0.995;
const occA = new THREE.Vector3();
const occB = new THREE.Vector3();

/**
 * True when a sphere (centre b, radius rb) is completely hidden behind the
 * opaque globe as seen from c: it lies inside the globe's silhouette cone and
 * wholly beyond the farthest point of the globe's front face.
 */
function behindGlobe(b: THREE.Vector3, rb: number, c: THREE.Vector3) {
  const d = c.distanceTo(GLOBE_CENTER);
  const db = c.distanceTo(b);
  if (d <= OCCLUDER_RADIUS || db <= rb) return false;
  const cone = Math.asin(OCCLUDER_RADIUS / d);
  const size = Math.asin(rb / db);
  const off = occA.subVectors(GLOBE_CENTER, c).angleTo(occB.subVectors(b, c));
  return off + size < cone && db - rb > Math.sqrt(d * d - OCCLUDER_RADIUS * OCCLUDER_RADIUS);
}
export const PLANE_ALTITUDE = 0.6;
const PLANE_SCALE = 1.25;
/** The parcel rides just under the fuselage. */
const CARGO_DROP = 0.32;

/** Height of the plane above the ground point under it (globe units), at flight progress u. */
export function planeHeight(u: number) {
  return R * ROUTE_LIFT * Math.sin(Math.PI * u) + PLANE_ALTITUDE;
}
/** Flight progress at chapter-5 progress t5. */
export function flightU(t5: number) {
  return easeInOutCubic(seg(t5, SHIP_BEATS.flight[0], SHIP_BEATS.flight[1]));
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpH = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const dummy = new THREE.Object3D();
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const GEO_LABELS = ["geo-usa", "geo-qatar", "geo-hub", "geo-plane", "geo-parcel", ...SUPPLIERS.map((p) => `sup-${p.id}`)] as const;

function fibonacciDots(count: number) {
  const land: THREE.Vector3[] = [];
  const usa: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const v = new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
    const lat = THREE.MathUtils.radToDeg(Math.asin(v.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z));
    const cell = maskAt(lat, lon);
    if (cell === 1 || cell === 3) land.push(v);
    else if (cell === 2) usa.push(v);
  }
  return { land, usa };
}

function DotLayer({ points, color, size, materialRef }: { points: THREE.Vector3[]; color: string; size: number; materialRef: React.RefObject<THREE.MeshBasicMaterial | null> }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    points.forEach((v, i) => {
      dummy.position.copy(v).multiplyScalar(R * 1.004);
      dummy.quaternion.setFromUnitVectors(Z, v);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [points, size]);
  return (
    <instancedMesh ref={mesh} args={[geo.circle(8), undefined, points.length]} frustumCulled={false}>
      <meshBasicMaterial ref={materialRef} color={color} toneMapped={false} transparent />
    </instancedMesh>
  );
}

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const atmosphereFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - abs(dot(vNormal, vView)), 4.2);
    vec3 c = mix(uColor2, uColor, f);
    gl_FragColor = vec4(c, f * uOpacity);
  }
`;

/** The M1 emblem on the plane's tail (a painted decal, never glowing). */
function TailEmblem() {
  const tex = useLoader(THREE.TextureLoader, "/how-it-works/m1-emblem.png");
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (
    <>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={geo.plane()} position={[s * 0.02, 0.3, -0.56]} rotation={[0, (s * Math.PI) / 2, 0]} scale={[0.16, 0.136, 1]}>
          <meshStandardMaterial map={tex} transparent roughness={0.4} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** Sleek cargo jet in M1 livery; nose along +Z, wings along X. */
function CargoPlane() {
  const parts = useMemo(() => {
    const body = new THREE.LatheGeometry(
      [
        [0.0, 0.66],
        [0.05, 0.645],
        [0.1, 0.6],
        [0.14, 0.51],
        [0.16, 0.38],
        [0.165, 0.1],
        [0.162, -0.25],
        [0.14, -0.45],
        [0.1, -0.6],
        [0.045, -0.7],
        [0.0, -0.72],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    );
    body.rotateX(Math.PI / 2);
    const planform = (pts: [number, number][], depth: number) => {
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, depth / 2, 0);
      return g;
    };
    const wing = planform(
      [
        [1.05, -0.36],
        [1.05, -0.24],
        [0.14, 0.2],
        [-0.14, 0.2],
        [-1.05, -0.24],
        [-1.05, -0.36],
        [-0.14, -0.2],
        [0.14, -0.2],
      ],
      0.03,
    );
    const tailplane = planform(
      [
        [0.42, -0.72],
        [0.42, -0.64],
        [0.06, -0.44],
        [-0.06, -0.44],
        [-0.42, -0.64],
        [-0.42, -0.72],
        [-0.06, -0.62],
        [0.06, -0.62],
      ],
      0.02,
    );
    const finShape = new THREE.Shape(
      [
        [-0.42, 0.1],
        [-0.64, 0.5],
        [-0.74, 0.5],
        [-0.72, 0.1],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.005, bevelSegments: 1 });
    fin.rotateY(-Math.PI / 2);
    fin.translate(0.015, 0, 0);
    return { body, wing, tailplane, fin };
  }, []);
  const white = std("#f1efea", { roughness: 0.35, metalness: 0.15 });
  const red = std(COLORS.red, { roughness: 0.4 });
  const grey = std("#8c9098", { roughness: 0.35, metalness: 0.6 });
  const dark = std("#15171b", { roughness: 0.2, metalness: 0.6 });
  return (
    <group>
      <mesh geometry={parts.body} material={white} />
      <mesh geometry={parts.wing} material={white} position={[0, -0.05, 0.02]} />
      <mesh geometry={parts.tailplane} material={white} position={[0, 0.02, 0]} />
      <mesh geometry={parts.fin} material={red} />
      {/* cockpit glass */}
      <mesh geometry={geo.sphere("lo")} material={dark} position={[0, 0.07, 0.5]} scale={[0.12, 0.06, 0.1]} />
      {/* belly stripe */}
      <mesh geometry={geo.box()} material={red} position={[0, -0.13, 0.0]} scale={[0.22, 0.03, 1.0]} />
      {[-0.46, 0.46].map((x) => (
        <group key={x} position={[x, -0.12, 0.04]}>
          <mesh geometry={geo.cylinder(1, 0.85, 20)} material={grey} rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.34, 0.07]} />
          <mesh geometry={geo.circle(20)} material={dark} position={[0, 0, 0.171]} scale={0.058} />
        </group>
      ))}
      <Suspense fallback={null}>
        <TailEmblem />
      </Suspense>
    </group>
  );
}

/** A small shipping box (supplier stock / the consolidated parcel). */
function Box({ tape = COLORS.red, size = 1 }: { tape?: string; size?: number }) {
  return (
    <group scale={size}>
      <mesh geometry={geo.roundBox(0.5, 0.4, 0.4, 0.04)} material={std(COLORS.cardboard, { roughness: 0.8 })} position={[0, 0.2, 0]} />
      <mesh geometry={geo.box()} material={std(tape, { roughness: 0.5 })} position={[0, 0.2, 0]} scale={[0.51, 0.405, 0.1]} />
    </group>
  );
}

export function GlobeWorld({ children }: { children: ReactNode }) {
  const { quality, anchors } = useWorld();
  const globe = useRef<THREE.Group>(null!);
  const visuals = useRef<THREE.Group>(null!);
  const studioScale = useRef<THREE.Group>(null!);

  const oceanMat = useRef<THREE.MeshStandardMaterial>(null!);
  const landMat = useRef<THREE.MeshBasicMaterial>(null);
  const usaMat = useRef<THREE.MeshBasicMaterial>(null);
  const gridMat = useRef<THREE.LineBasicMaterial>(null!);
  const starsMat = useRef<THREE.PointsMaterial>(null!);
  const routeMesh = useRef<THREE.Mesh>(null!);
  const routeMat = useRef<THREE.MeshBasicMaterial>(null!);
  const ghostMat = useRef<THREE.LineDashedMaterial>(null!);
  const orderMat = useRef<THREE.LineDashedMaterial>(null!);
  const signal = useRef<THREE.Group>(null!);
  const parcel = useRef<THREE.Group>(null!);
  const parcelGlow = useRef<THREE.Sprite>(null!);
  const seal = useRef<THREE.Group>(null!);
  const plane = useRef<THREE.Group>(null!);
  const qatarPin = useRef<THREE.Group>(null!);
  const hubPin = useRef<THREE.Group>(null!);
  const qatarRing = useRef<THREE.Mesh>(null!);
  const qatarRingMat = useRef<THREE.MeshBasicMaterial>(null!);
  const arrivalRing = useRef<THREE.Mesh>(null!);
  const arrivalRingMat = useRef<THREE.MeshBasicMaterial>(null!);
  const supplierPins = useRef<(THREE.Group | null)[]>([]);
  const supplierBoxes = useRef<(THREE.Group | null)[]>([]);

  const atmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        uniforms: {
          uColor: { value: new THREE.Color(COLORS.red) },
          uColor2: { value: new THREE.Color(COLORS.gold) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const dots = useMemo(() => fibonacciDots(quality === "high" ? 30000 : 18000), [quality]);
  const dotSize = quality === "high" ? 0.08 : 0.1;

  const graticule = useMemo(() => {
    const pts: number[] = [];
    const r = R * 1.001;
    const push = (lat: number, lon: number) => {
      geoVector({ lat, lon }, tmpV).multiplyScalar(r);
      pts.push(tmpV.x, tmpV.y, tmpV.z);
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 4) {
        push(lat, lon);
        push(lat, lon + 4);
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 4) {
        push(lat, lon);
        push(lat + 4, lon);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const stars = useMemo(() => {
    const count = quality === "high" ? 900 : 450;
    const arr = new Float32Array(count * 3);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const rr = 70 + rand() * 60;
      const s = Math.sqrt(1 - u * u);
      arr.set([Math.cos(th) * s * rr, u * rr, Math.sin(th) * s * rr], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [quality]);

  const route = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) pts.push(routePoint(i / 96));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 192, 0.035, 8, false);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(160)));
    line.computeLineDistances();
    // The order's path (Qatar → U.S.), a little higher so the two never overlap.
    const orderPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      slerpVectors(V_QATAR, V_HUB, i / 96, tmpV);
      orderPts.push(tmpV.clone().multiplyScalar(R * (1 + 0.24 * Math.sin((Math.PI * i) / 96))));
    }
    const order = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orderPts));
    order.computeLineDistances();
    return { tube, ghost: line.geometry, order: order.geometry, orderPts, indexCount: tube.index!.count };
  }, []);

  const studioAnchor = useMemo(() => {
    const q = viewQuaternion(V_QATAR).invert();
    return { position: V_QATAR.clone().multiplyScalar(R), quaternion: q };
  }, []);

  const pinPose = (v: THREE.Vector3) => ({
    position: v.clone().multiplyScalar(R),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v),
  });
  const hubPose = useMemo(() => pinPose(V_HUB), []);
  const qatarPinPose = useMemo(() => pinPose(V_QATAR), []);
  const supplierPoses = useMemo(() => V_SUPPLIERS.map((v) => pinPose(v)), []);
  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);
  const viewCentre = useMemo(() => new THREE.Vector3(), []);
  const usaDim = useMemo(() => new THREE.Color("#5c5c66"), []);
  // A warm, softer gold than the brand accent, so the M1 logo stays the brightest thing in the story.
  const usaLit = useMemo(() => new THREE.Color("#b8922f"), []);

  /** Pins a DOM label to a globe-local point; hides it once that point turns away from the camera. */
  const label = (id: string, local: THREE.Vector3, normal: THREE.Vector3, opacity: number, f: FrameState, align: "above" | "below" = "above") => {
    const a = anchors.get(id);
    a.align = align;
    a.offsetY = align === "below" ? 14 : 0;
    a.pos.copy(local).applyMatrix4(globe.current.matrixWorld);
    tmpN.copy(normal).applyQuaternion(globe.current.quaternion);
    tmpV2.copy(f.cameraPos).sub(a.pos).normalize();
    const facing = smooth(seg(tmpN.dot(tmpV2), 0.05, 0.3));
    a.opacity = opacity * facing;
  };

  useScene(0, (f: FrameState) => {
    const t4 = f.local[CH.source];
    const t5 = f.local[CH.ship];
    const t6 = f.local[CH.build];
    const S = SOURCE_BEATS;
    const P = SHIP_BEATS;

    // ---------------- globe visibility and studio scale
    const fade = smooth(seg(t4, S.fadeIn[0], S.fadeIn[1])) * (1 - smooth(seg(t6, DIVE.fadeOut[0], DIVE.fadeOut[1])));
    const shrink = easeInOutCubic(seg(t4, S.studioShrink[0], S.studioShrink[1])) * (1 - easeInOutCubic(seg(t6, DIVE.regrow[0], DIVE.regrow[1])));
    studioScale.current.scale.setScalar(Math.exp(Math.log(STUDIO_MIN_SCALE) * shrink));
    visuals.current.visible = fade > 0.001;

    // ---------------- orientation: which point on Earth faces up (and which way is "up" on screen)
    const u = flightU(t5);
    if (f.s < CH.source + S.toUsa[0] || f.s >= CH.build) {
      viewQuaternion(V_QATAR, tmpQ);
    } else if (f.s < CH.ship) {
      // Qatar → U.S. (following the order), then across to the hub as the parts converge.
      const toUsa = easeInOutCubic(seg(t4, S.toUsa[0], S.toUsa[1]));
      const toHub = easeInOutCubic(seg(t4, S.toHub[0], S.toHub[1]));
      slerpVectors(V_QATAR, V_USA, toUsa, viewCentre);
      if (toHub > 0) slerpVectors(V_USA, V_HUB, toHub, viewCentre);
      viewQuaternion(viewCentre, tmpQ);
    } else {
      // The flight: the view centre rides under the plane; the globe turns course-up for the chase.
      routeGround(u, viewCentre);
      routeHeading(u, tmpH);
      viewQuaternion(viewCentre, tmpQ);
      viewQuaternionHeading(viewCentre, tmpH, tmpQ2);
      const chase = smooth(seg(t5, P.chaseIn[0], P.chaseIn[1])) * (1 - smooth(seg(t5, P.chaseOut[0], P.chaseOut[1])));
      tmpQ.slerp(tmpQ2, chase);
    }
    globe.current.quaternion.copy(tmpQ);
    globe.current.updateMatrixWorld(true);

    // While the studio is on the far side of the (opaque) globe it cannot be seen at all:
    // skip drawing it. A pure function of the camera and the globe's pose, so it never pops.
    const studio = studioScale.current;
    const occluded =
      fade >= 0.999 &&
      behindGlobe(tmpV.copy(STUDIO_BOUNDS.center).applyMatrix4(studio.matrixWorld), STUDIO_BOUNDS.radius * studio.scale.x, f.cameraPos);
    studio.visible = !occluded;
    studio.userData.occluded = occluded;

    if (!visuals.current.visible) {
      for (const id of GEO_LABELS) anchors.get(id).opacity = 0;
      return;
    }
    const inSource = f.s < CH.ship ? 1 : 0;
    const inShip = f.s >= CH.ship && f.s < CH.build ? 1 : 0;

    oceanMat.current.opacity = fade;
    oceanMat.current.transparent = fade < 0.999;
    oceanMat.current.depthWrite = fade > 0.5;
    if (landMat.current) landMat.current.opacity = fade;
    const usaHi = smooth(seg(t4, S.usaHighlight[0], S.usaHighlight[1])) * (1 - smooth(seg(t5, 0.2, 0.4)));
    if (usaMat.current) {
      usaMat.current.opacity = fade;
      usaMat.current.color.copy(usaDim).lerp(tmpColor.copy(usaLit), usaHi);
    }
    gridMat.current.opacity = 0.4 * fade;
    starsMat.current.opacity = fade;
    atmosphere.uniforms.uOpacity.value = 0.55 * fade;

    // ---------------- the order: a gold signal from Qatar to the U.S.
    const sig = seg(t4, S.signal[0], S.signal[1]);
    signal.current.visible = sig > 0 && sig < 1 && inSource === 1;
    if (signal.current.visible) {
      const k = easeInOutCubic(seg(t4, S.signalTravel[0], S.signalTravel[1]));
      const n = route.orderPts.length - 1;
      const i = Math.min(n - 1, Math.floor(k * n));
      signal.current.position.lerpVectors(route.orderPts[i], route.orderPts[i + 1], k * n - i);
      signal.current.scale.setScalar(Math.max(0.0001, smooth(seg(sig, 0, 0.08)) * (1 - smooth(seg(sig, 0.9, 1)))));
    }
    orderMat.current.opacity = 0.55 * fade * window4(t4, S.signal[0], S.signal[0] + 0.04, S.supplier, S.supplier + 0.06);

    // ---------------- Qatar pin + ripples (clock-phased, fade to nothing before they restart)
    const pulse = (f.clock * 0.6) % 1;
    const ripple = Math.sin(Math.PI * pulse);
    const qPop = easeOutBack(seg(t4, 0.2, 0.27)) * (1 - smooth(seg(t6, 0, 0.05)));
    qatarPin.current.scale.setScalar(Math.max(0.0001, qPop * (1 + 0.3 * bell(t5, P.arrival[0], P.arrival[1]))));
    qatarRing.current.scale.setScalar(0.6 + pulse * 2.2);
    qatarRingMat.current.opacity = ripple * 0.85 * fade * Math.min(1, qPop);
    qatarRing.current.visible = qatarRingMat.current.opacity > 0.005;
    const arrive = seg(t5, P.arrival[0], P.arrival[1]);
    arrivalRing.current.scale.setScalar(0.6 + arrive * 5);
    arrivalRingMat.current.opacity = Math.sin(Math.PI * arrive) * 0.9 * fade;
    arrivalRing.current.visible = arrivalRingMat.current.opacity > 0.005;

    // ---------------- U.S. suppliers: pins pop one by one, then their parts leave for the hub
    const hubPop = easeOutBack(seg(t4, S.boxes - 0.04, S.boxes)) * (1 - smooth(seg(t5, 0.2, 0.3)));
    hubPin.current.scale.setScalar(Math.max(0.0001, hubPop));
    // How much of the stock has reached the hub (continuous, so the parcel grows smoothly).
    let arrived = 0;
    SUPPLIERS.forEach((sp, i) => {
      const at = S.supplier + i * S.supplierStep;
      const pin = supplierPins.current[i];
      const pop = easeOutBack(seg(t4, at, at + 0.03)) * (1 - smooth(seg(t4, 0.8, 0.86)));
      if (pin) pin.scale.setScalar(Math.max(0.0001, pop));
      const start = S.boxes + i * S.boxStep;
      const travel = seg(t4, start, start + S.boxTravel);
      arrived += smooth(seg(travel, 0.8, 1));
      const box = supplierBoxes.current[i];
      if (box) {
        const appear = easeOutBack(seg(t4, at + 0.02, at + 0.05));
        box.visible = appear > 0.001 && travel < 1 && inSource === 1;
        const k = easeInOutCubic(travel);
        slerpVectors(V_SUPPLIERS[i], V_HUB, k, tmpV);
        tmpN.copy(tmpV);
        tmpV.multiplyScalar(R + 0.18 + Math.sin(Math.PI * k) * 0.9);
        box.position.copy(tmpV);
        box.quaternion.setFromUnitVectors(UP, tmpN);
        // Each box shrinks into the hub parcel as it arrives (never pops out).
        box.scale.setScalar(Math.max(0.0001, Math.min(1, appear) * (1 - smooth(seg(travel, 0.8, 1)))));
      }
      // Crisp chip naming the part each supplier provides.
      label(`sup-${sp.id}`, tmpV2.copy(V_SUPPLIERS[i]).multiplyScalar(R + 0.9), V_SUPPLIERS[i], Math.min(1, Math.max(0, pop)) * (1 - smooth(seg(travel, 0.05, 0.3))) * fade * inSource, f);
    });

    // ---------------- route (hub → Qatar)
    const ghost = f.s >= CH.ship ? 1 : smooth(seg(t4, S.sealed[0], S.sealed[1]));
    ghostMat.current.opacity = 0.45 * ghost * fade * (1 - smooth(seg(t5, P.arrival[1], P.arrival[1] + 0.04)));
    const drawn = Math.floor((route.indexCount / 3) * u) * 3;
    route.tube.setDrawRange(0, drawn);
    const routeOpacity = fade * (1 - smooth(seg(t6, 0, 0.05)));
    routeMat.current.opacity = routeOpacity;
    routeMesh.current.visible = drawn > 0 && routeOpacity > 0.01;

    // ---------------- the parcel: packed at the hub, carried under the plane, dropped in Qatar
    const planeIn = easeInOutCubic(seg(t5, P.planeIn[0], P.planeIn[1]));
    const load = smooth(seg(t5, P.load[0], P.load[1]));
    const drop = smooth(seg(t5, P.arrival[0], P.arrival[0] + 0.04));
    const packed = arrived / SUPPLIERS.length;
    const parcelPop = easeOutBack(seg(t4, S.boxes + S.boxTravel - 0.02, S.boxes + S.boxTravel + 0.02));
    // Dives into the studio over the build chapter's first 8%, then is gone.
    const dive = smooth(seg(t6, 0, 0.08));
    const parcelVisible = parcelPop > 0.001 && dive < 1;
    parcel.current.visible = parcelVisible;
    if (parcelVisible) {
      if (drop > 0) {
        tmpV.copy(V_QATAR).multiplyScalar(R + lerp(PLANE_ALTITUDE - CARGO_DROP, 0.25, drop));
        tmpN.copy(V_QATAR);
      } else if (load > 0) {
        // Up from the hub into the plane's belly, then along the arc under it.
        routeGround(u, tmpN);
        routePoint(u, tmpV).addScaledVector(tmpN, lerp(0.25, PLANE_ALTITUDE - CARGO_DROP, load));
      } else {
        tmpN.copy(V_HUB);
        tmpV.copy(V_HUB).multiplyScalar(R + 0.25);
      }
      parcel.current.position.copy(tmpV);
      parcel.current.quaternion.setFromUnitVectors(UP, tmpN);
      parcel.current.scale.setScalar(Math.max(0.0001, parcelPop * (0.72 + 0.28 * packed) * (1 - dive)));
      seal.current.visible = t4 >= S.sealed[0] || f.s >= CH.ship;
      seal.current.scale.setScalar(Math.max(0.0001, f.s >= CH.ship ? 1 : smooth(seg(t4, S.sealed[0], S.sealed[1]))));
      parcelGlow.current.material.opacity = 0.55 * fade * (1 - load * 0.4);
    }

    // ---------------- cargo plane: descends to the hub, flies the arc, climbs away over Qatar
    const leave = seg(t5, P.leave[0], P.leave[1]);
    const planeVisible = inShip === 1 && planeIn > 0 && leave < 1;
    plane.current.visible = planeVisible;
    if (planeVisible) {
      const along = Math.min(1, u + leave * 0.06);
      routeGround(along, tmpN);
      plane.current.position.copy(routePoint(along, tmpV)).addScaledVector(tmpN, PLANE_ALTITUDE + (1 - planeIn) * 2.5 + leave * 2.2);
      // Heading from the route tangent, level with the ground under it (lookAt works in world space).
      routeHeading(Math.min(along, 0.999), tmpH);
      tmpV.copy(plane.current.position).add(tmpH).applyMatrix4(globe.current.matrixWorld);
      plane.current.up.copy(tmpN).applyQuaternion(globe.current.quaternion);
      plane.current.lookAt(tmpV);
      plane.current.rotateZ(Math.sin(u * Math.PI * 2) * -0.08);
      plane.current.scale.setScalar(Math.max(0.0001, Math.min(1, planeIn * 1.4) * (1 - smooth(leave)) * PLANE_SCALE));
    }

    // ---------------- crisp labels
    label("geo-qatar", tmpV.copy(V_QATAR).multiplyScalar(R + 1.5), V_QATAR, Math.min(1, qPop) * fade, f);
    label("geo-usa", tmpV.copy(V_USA).multiplyScalar(R + 0.5), V_USA, smooth(seg(t4, S.usaHighlight[0], S.usaHighlight[1])) * (1 - smooth(seg(t4, S.supplier, S.supplier + 0.04))) * fade * inSource, f, "below");
    label("geo-hub", tmpV.copy(V_HUB).multiplyScalar(R + 0.5), V_HUB, (inSource ? smooth(seg(t4, S.sealed[0], S.sealed[1] + 0.02)) : 1 - smooth(seg(t5, P.load[0], P.load[0] + 0.03))) * fade, f, "below");
    const planeLabel = window4(t5, P.flight[0] + 0.06, P.flight[0] + 0.1, P.flight[1] - 0.1, P.flight[1] - 0.06) * inShip;
    const planeWorld = plane.current.position;
    tmpN.copy(planeWorld).normalize();
    label("geo-plane", tmpV.copy(planeWorld).addScaledVector(tmpN, -0.35), tmpN, planeLabel * fade, f, "below");
    // Fades before the chapter ends (never cut at the boundary).
    const parcelLabel = smooth(seg(t5, P.arrival[0] + 0.02, P.arrival[0] + 0.05)) * (1 - smooth(seg(t5, 0.95, 0.995))) * inShip;
    tmpN.copy(V_QATAR);
    label("geo-parcel", tmpV.copy(V_QATAR).multiplyScalar(R + 0.1), tmpN, parcelLabel * fade, f, "below");
  });

  return (
    <group ref={globe} name="globe" position={GLOBE_CENTER}>
      <group ref={visuals} name="globeVisuals" visible={false}>
        <mesh geometry={geo.sphere()} scale={R}>
          <meshStandardMaterial ref={oceanMat} color="#0c0c0f" roughness={0.85} metalness={0.1} emissive="#08080a" envMapIntensity={0.2} transparent opacity={0} />
        </mesh>
        <lineSegments geometry={graticule}>
          <lineBasicMaterial ref={gridMat} color="#34343c" transparent opacity={0} depthWrite={false} />
        </lineSegments>
        <DotLayer points={dots.land} color="#70707a" size={dotSize} materialRef={landMat} />
        <DotLayer points={dots.usa} color="#5c5c66" size={dotSize * 1.12} materialRef={usaMat} />
        <mesh geometry={geo.sphere()} scale={R * 1.12} material={atmosphere} />
        <points geometry={stars}>
          <pointsMaterial ref={starsMat} color="#ffffff" size={0.28} sizeAttenuation transparent opacity={0} depthWrite={false} fog={false} />
        </points>

        {/* the order's path and its signal */}
        <line>
          <primitive object={route.order} attach="geometry" />
          <lineDashedMaterial ref={orderMat} color={COLORS.white} dashSize={0.22} gapSize={0.3} transparent opacity={0} depthWrite={false} />
        </line>
        <group ref={signal} name="orderSignal" visible={false}>
          <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} scale={0.12} />
          <sprite scale={[1.4, 1.4, 1]}>
            <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>

        {/* shipping route */}
        <line>
          <primitive object={route.ghost} attach="geometry" />
          <lineDashedMaterial ref={ghostMat} color={COLORS.gold} dashSize={0.3} gapSize={0.24} transparent opacity={0} depthWrite={false} />
        </line>
        <mesh ref={routeMesh} geometry={route.tube}>
          <meshBasicMaterial ref={routeMat} color={COLORS.gold} transparent toneMapped={false} />
        </mesh>

        {/* suppliers */}
        {supplierPoses.map((pose, i) => (
          <group key={i} position={pose.position} quaternion={pose.quaternion}>
            <group
              ref={(el) => {
                supplierPins.current[i] = el;
              }}
              scale={0.0001}
            >
              <mesh geometry={geo.cone()} material={std(COLORS.white, { roughness: 0.4 })} position={[0, 0.3, 0]} scale={[0.12, 0.6, 0.12]} rotation={[Math.PI, 0, 0]} />
              <mesh geometry={geo.sphere()} material={std(COLORS.white, { roughness: 0.35 })} position={[0, 0.68, 0]} scale={0.19} />
              <mesh geometry={geo.sphere("lo")} material={std(COLORS.gold, { roughness: 0.3, metalness: 0.4 })} position={[0, 0.68, 0]} scale={0.1} />
            </group>
          </group>
        ))}
        {SUPPLIERS.map((_, i) => (
          <group
            key={i}
            ref={(el) => {
              supplierBoxes.current[i] = el;
            }}
            visible={false}
          >
            <Box tape={COLORS.gold} size={0.55} />
          </group>
        ))}

        {/* east-coast hub */}
        <group position={hubPose.position} quaternion={hubPose.quaternion}>
          <group ref={hubPin} scale={0.0001}>
            <mesh geometry={geo.cylinder(1, 1, 32)} material={std("#1b1b1f", { roughness: 0.5 })} position={[0, 0.03, 0]} scale={[0.75, 0.06, 0.75]} />
            <mesh geometry={geo.torus(0.75, 0.025)} material={glow(COLORS.gold, 0.9)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.065, 0]} />
          </group>
        </group>

        {/* Qatar pin */}
        <group position={qatarPinPose.position} quaternion={qatarPinPose.quaternion}>
          <mesh ref={qatarRing} geometry={geo.ring(0.5, 0.62)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <meshBasicMaterial ref={qatarRingMat} color={COLORS.red} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={arrivalRing} geometry={geo.ring(0.5, 0.62)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} visible={false}>
            <meshBasicMaterial ref={arrivalRingMat} color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <group ref={qatarPin} scale={0.0001}>
            <mesh geometry={geo.cone()} material={std(COLORS.red, { roughness: 0.4 })} position={[0, 0.45, 0]} scale={[0.18, 0.9, 0.18]} rotation={[Math.PI, 0, 0]} />
            <mesh geometry={geo.sphere()} material={std(COLORS.red, { roughness: 0.35 })} position={[0, 1.0, 0]} scale={0.28} />
            <mesh geometry={geo.sphere("lo")} material={std(COLORS.white, { roughness: 0.3 })} position={[0, 1.0, 0]} scale={0.12} />
          </group>
        </group>

        {/* cargo plane */}
        <group ref={plane} name="plane" visible={false}>
          <CargoPlane />
        </group>

        {/* the consolidated parcel */}
        <group ref={parcel} name="shipment" visible={false}>
          <mesh geometry={geo.roundBox(0.62, 0.48, 0.48, 0.05)} material={std(COLORS.cardboard, { roughness: 0.75 })} position={[0, 0.24, 0]} />
          <group ref={seal} name="seal" visible={false}>
            <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.5 })} position={[0, 0.24, 0]} scale={[0.63, 0.49, 0.12]} />
            <mesh geometry={geo.box()} material={std(COLORS.gold, { roughness: 0.4 })} position={[0, 0.485, 0]} scale={[0.16, 0.01, 0.16]} />
          </group>
          <sprite ref={parcelGlow} position={[0, 0.25, 0]} scale={[2.2, 2.2, 1]}>
            <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      </group>

      {/* The studio lives on Qatar's surface. */}
      <group position={studioAnchor.position} quaternion={studioAnchor.quaternion}>
        <group ref={studioScale} name="studio">{children}</group>
      </group>
    </group>
  );
}
