"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, glowTexture, std } from "./assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, smooth } from "./anim";
import { useScene, useWorld, type FrameState } from "./director";
import { maskAt } from "./globe-data";
import { GLOBE_CENTER, GLOBE_RADIUS as R, V_MID, V_QATAR, V_USA, geoVector, routePoint, slerpVectors, viewQuaternion } from "./globe-math";

/** Chapter 4 beats (0..1 of the chapter). The crane-up itself is the camera path. */
export const GLOBE_BEATS = {
  fadeIn: [0.07, 0.2],
  studioShrink: [0.08, 0.3],
  qatarPin: [0.2, 0.26],
  spinToUsa: [0.26, 0.4],
  usaHighlight: [0.34, 0.42],
  warehouse: [0.4, 0.46],
  parcel: [0.45, 0.5],
  planeIn: [0.47, 0.55],
  toOverview: [0.5, 0.62],
  flight: [0.55, 0.86],
  arrival: [0.86, 0.93],
} as const;

/** Chapter 5 beats that belong to the globe (the dive back into Qatar). */
const DIVE = { spinHome: [0.0, 0.08], regrow: [0.02, 0.16], fadeOut: [0.05, 0.15] } as const;

const STUDIO_MIN_SCALE = 0.035;
const PLANE_ALTITUDE = 0.95;
const PLANE_SCALE = 1.5;
/** Where the parcel rides, just under the fuselage. */
const CARGO_ALTITUDE = PLANE_ALTITUDE - 0.55;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const dummy = new THREE.Object3D();
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const GEO_LABELS = ["geo-usa", "geo-qatar", "geo-parcel"] as const;

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

/** Low-poly cargo plane in M1 livery; nose points along +Z, wings along X. */
function CargoPlane() {
  const white = std(COLORS.offWhite, { roughness: 0.45, metalness: 0.1 });
  const red = std(COLORS.red, { roughness: 0.45 });
  const dark = std("#2a2a2e", { roughness: 0.5 });
  return (
    <group>
      <mesh geometry={geo.capsule(0.17, 1.05)} material={white} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={geo.sphere("lo")} material={dark} position={[0, 0.07, 0.58]} scale={[0.12, 0.07, 0.1]} />
      <mesh geometry={geo.box()} material={white} position={[0, -0.02, 0.05]} scale={[1.9, 0.035, 0.34]} />
      <mesh geometry={geo.box()} material={red} position={[0.93, -0.02, 0.05]} scale={[0.08, 0.04, 0.34]} />
      <mesh geometry={geo.box()} material={red} position={[-0.93, -0.02, 0.05]} scale={[0.08, 0.04, 0.34]} />
      <mesh geometry={geo.box()} material={white} position={[0, 0.03, -0.6]} scale={[0.72, 0.03, 0.2]} />
      <mesh geometry={geo.box()} material={red} position={[0, 0.2, -0.62]} scale={[0.03, 0.34, 0.24]} />
      <mesh geometry={geo.box()} material={std(COLORS.gold, { roughness: 0.4 })} position={[0, 0, 0]} scale={[0.345, 0.05, 1.0]} />
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} geometry={geo.cylinder(1, 1, 16)} material={dark} position={[x, -0.1, 0.12]} rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.24, 0.07]} />
      ))}
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
  const parcel = useRef<THREE.Group>(null!);
  const parcelGlow = useRef<THREE.Sprite>(null!);
  const plane = useRef<THREE.Group>(null!);
  const usaPin = useRef<THREE.Group>(null!);
  const qatarPin = useRef<THREE.Group>(null!);
  const usaRing = useRef<THREE.Mesh>(null!);
  const qatarRing = useRef<THREE.Mesh>(null!);
  const qatarRingMat = useRef<THREE.MeshBasicMaterial>(null!);
  const warehouse = useRef<THREE.Group>(null!);

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
    const tube = new THREE.TubeGeometry(curve, 192, 0.075, 8, false);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(160)));
    line.computeLineDistances();
    return { tube, ghost: line.geometry, indexCount: tube.index!.count };
  }, []);

  const studioAnchor = useMemo(() => {
    const q = viewQuaternion(V_QATAR).invert();
    return { position: V_QATAR.clone().multiplyScalar(R), quaternion: q };
  }, []);

  const pinPose = (v: THREE.Vector3) => ({
    position: v.clone().multiplyScalar(R),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v),
  });
  const usaPinPose = useMemo(() => pinPose(V_USA), []);
  const qatarPinPose = useMemo(() => pinPose(V_QATAR), []);
  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);
  const viewCentre = useMemo(() => new THREE.Vector3(), []);
  const usaDim = useMemo(() => new THREE.Color("#5c5c66"), []);
  const usaLit = useMemo(() => new THREE.Color(COLORS.gold), []);

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
    const s4 = f.local[3];
    const s5 = f.local[4];
    const B = GLOBE_BEATS;

    // ---------------- globe visibility and studio scale
    const fade = smooth(seg(s4, B.fadeIn[0], B.fadeIn[1])) * (1 - smooth(seg(s5, DIVE.fadeOut[0], DIVE.fadeOut[1])));
    const shrink = easeInOutCubic(seg(s4, B.studioShrink[0], B.studioShrink[1])) * (1 - easeInOutCubic(seg(s5, DIVE.regrow[0], DIVE.regrow[1])));
    studioScale.current.scale.setScalar(Math.exp(Math.log(STUDIO_MIN_SCALE) * shrink));
    visuals.current.visible = fade > 0.001;

    // ---------------- which point on Earth faces the camera
    if (f.s <= 3 || f.s >= 4 + DIVE.spinHome[1]) {
      viewCentre.copy(V_QATAR);
    } else if (f.s > 4) {
      slerpVectors(V_MID, V_QATAR, easeInOutCubic(seg(s5, DIVE.spinHome[0], DIVE.spinHome[1])), viewCentre);
    } else {
      const over = easeInOutCubic(seg(s4, B.toOverview[0], B.toOverview[1]));
      if (over > 0) slerpVectors(V_USA, V_MID, over, viewCentre);
      else slerpVectors(V_QATAR, V_USA, easeInOutCubic(seg(s4, B.spinToUsa[0], B.spinToUsa[1])), viewCentre);
    }
    viewQuaternion(viewCentre, tmpQ);
    globe.current.quaternion.copy(tmpQ);
    globe.current.updateMatrixWorld(true);

    if (!visuals.current.visible) {
      for (const id of GEO_LABELS) anchors.get(id).opacity = 0;
      return;
    }

    oceanMat.current.opacity = fade;
    oceanMat.current.transparent = fade < 0.999;
    oceanMat.current.depthWrite = fade > 0.5;
    if (landMat.current) landMat.current.opacity = fade;
    const usaHi = smooth(seg(s4, B.usaHighlight[0], B.usaHighlight[1]));
    if (usaMat.current) {
      usaMat.current.opacity = fade;
      usaMat.current.color.copy(usaDim).lerp(tmpColor.copy(usaLit), usaHi);
    }
    gridMat.current.opacity = 0.4 * fade;
    starsMat.current.opacity = fade;
    atmosphere.uniforms.uOpacity.value = 0.55 * fade;

    // ---------------- pins + rings
    const diving = 1 - smooth(seg(s5, 0, 0.05));
    const usaPop = easeOutBack(seg(s4, B.usaHighlight[0] + 0.02, B.usaHighlight[1] + 0.02)) * diving;
    usaPin.current.scale.setScalar(Math.max(0.0001, usaPop));
    const qPop = easeOutBack(seg(s4, B.qatarPin[0], B.qatarPin[1])) * diving;
    qatarPin.current.scale.setScalar(Math.max(0.0001, qPop * (1 + 0.3 * bell(s4, B.arrival[0], B.arrival[1]))));

    const pulse = (f.time * 0.8) % 1;
    usaRing.current.scale.setScalar(0.6 + pulse * 2.2 * usaPop);
    (usaRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.7 * usaHi * fade * (s4 < 0.62 ? 1 : 0);
    const arrive = seg(s4, B.arrival[0], B.arrival[1]);
    const arriving = arrive > 0 && arrive < 1;
    const qPulse = arriving ? arrive : pulse;
    qatarRing.current.scale.setScalar(0.6 + qPulse * (arriving ? 5 : 2.2));
    qatarRingMat.current.opacity = (1 - qPulse) * 0.85 * fade * Math.min(1, qPop);

    // ---------------- U.S. supplier stock, packed into one parcel
    const wh = easeOutBack(seg(s4, B.warehouse[0], B.warehouse[1]));
    warehouse.current.scale.setScalar(Math.max(0.0001, wh * (1 - smooth(seg(s4, 0.6, 0.66)))));

    // ---------------- route
    const ghost = smooth(seg(s4, B.parcel[0], B.parcel[1] + 0.04));
    ghostMat.current.opacity = 0.5 * ghost * fade;
    const u = easeInOutCubic(seg(s4, B.flight[0], B.flight[1]));
    const drawn = Math.floor((route.indexCount / 3) * u) * 3;
    route.tube.setDrawRange(0, drawn);
    // Leaves with the globe on the dive home (it would otherwise sweep across the lens).
    const routeOpacity = fade * (1 - smooth(seg(s5, 0, 0.05)));
    routeMat.current.opacity = routeOpacity;
    routeMesh.current.visible = drawn > 0 && routeOpacity > 0.01;

    // ---------------- cargo plane: descends to the U.S., flies the arc, drops the parcel in Qatar, climbs away
    const planeIn = easeInOutCubic(seg(s4, B.planeIn[0], B.planeIn[1]));
    const leave = seg(s4, B.arrival[0], B.arrival[1] + 0.04);
    const planeVisible = planeIn > 0 && leave < 1 && s5 <= 0;
    plane.current.visible = planeVisible;
    if (planeVisible) {
      const along = Math.min(1, u + leave * 0.08);
      routePoint(Math.max(0.0001, along), plane.current.position);
      tmpN.copy(plane.current.position).normalize();
      const altitude = PLANE_ALTITUDE + (1 - planeIn) * 3 + leave * 2.5;
      plane.current.position.addScaledVector(tmpN, altitude);
      routePoint(Math.min(1, along + 0.02), tmpV);
      tmpV2.copy(tmpV).normalize();
      tmpV.addScaledVector(tmpV2, altitude);
      plane.current.up.copy(tmpN).applyQuaternion(tmpQ);
      plane.current.lookAt(tmpV.applyMatrix4(globe.current.matrixWorld));
      plane.current.rotateZ(Math.sin(u * Math.PI) * -0.18);
      plane.current.scale.setScalar(Math.max(0.0001, Math.min(1, planeIn * 1.4) * (1 - smooth(leave)) * PLANE_SCALE));
    }

    // ---------------- the parcel: appears at the U.S. stock, rides under the plane, lands in Qatar
    const pop = easeOutBack(seg(s4, B.parcel[0], B.parcel[1]));
    const onPlane = smooth(seg(s4, B.planeIn[1] - 0.02, B.planeIn[1] + 0.02));
    const drop = smooth(seg(s4, B.arrival[0], B.arrival[0] + 0.035));
    const parcelVisible = pop > 0.001 && s5 < 0.1;
    parcel.current.visible = parcelVisible;
    if (parcelVisible) {
      if (drop > 0) {
        tmpV.copy(V_QATAR).multiplyScalar(R + lerp(CARGO_ALTITUDE, 0.4, drop));
      } else if (onPlane > 0) {
        routePoint(Math.max(0.0001, u), tmpV);
        tmpN.copy(tmpV).normalize();
        tmpV.addScaledVector(tmpN, lerp(0.45, CARGO_ALTITUDE, onPlane));
      } else {
        tmpV.copy(V_USA).multiplyScalar(R + 0.45);
      }
      parcel.current.position.copy(tmpV);
      parcel.current.quaternion.setFromUnitVectors(UP, tmpN.copy(tmpV).normalize());
      parcel.current.scale.setScalar(Math.max(0.0001, pop) * (1 - smooth(seg(s5, 0, 0.08))));
      parcelGlow.current.material.opacity = (u > 0 && u < 1 ? 0.85 : 0.4) * fade;
    }

    // ---------------- crisp labels
    label("geo-qatar", tmpV.copy(V_QATAR).multiplyScalar(R + 2.1), V_QATAR, Math.min(1, qPop) * fade, f);
    label("geo-usa", tmpV.copy(V_USA).multiplyScalar(R + 2.1), V_USA, Math.min(1, usaPop) * fade, f);
    // The parcel's label hangs below it, so it never collides with the pin labels above the pins.
    // It rests while the parcel crosses to Qatar (where the Qatar label already is), then returns as "Arrived".
    const midFlight = smooth(seg(u, 0.5, 0.62)) * (1 - smooth(seg(s4, B.arrival[0] + 0.01, B.arrival[0] + 0.04)));
    const parcelLabel = smooth(seg(s4, B.parcel[1], B.parcel[1] + 0.03)) * (1 - midFlight) * (1 - smooth(seg(s4, 0.94, 0.98)));
    tmpV.copy(parcel.current.position);
    tmpN.copy(tmpV).normalize();
    label("geo-parcel", tmpV, tmpN, parcelLabel * fade * (parcelVisible ? 1 : 0), f, "below");
    anchors.get("geo-parcel").text("label", drop > 0.5 ? "Arrived in Qatar" : "Your parts");
  });

  return (
    <group ref={globe} position={GLOBE_CENTER}>
      <group ref={visuals} visible={false}>
        <mesh geometry={geo.sphere()} scale={R}>
          <meshStandardMaterial ref={oceanMat} color="#0c0c0f" roughness={0.85} metalness={0.1} emissive="#08080a" transparent opacity={0} />
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

        <line>
          <primitive object={route.ghost} attach="geometry" />
          <lineDashedMaterial ref={ghostMat} color={COLORS.gold} dashSize={0.35} gapSize={0.28} transparent opacity={0} depthWrite={false} />
        </line>
        <mesh ref={routeMesh} geometry={route.tube}>
          <meshBasicMaterial ref={routeMat} color={COLORS.gold} transparent toneMapped={false} />
        </mesh>

        {/* U.S. pin + supplier stock */}
        <group position={usaPinPose.position} quaternion={usaPinPose.quaternion}>
          <mesh ref={usaRing} geometry={geo.ring(0.5, 0.62)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <group ref={usaPin} scale={0.0001}>
            <mesh geometry={geo.cone()} material={std(COLORS.white, { roughness: 0.4 })} position={[0, 0.55, 0]} scale={[0.22, 1.1, 0.22]} rotation={[Math.PI, 0, 0]} />
            <mesh geometry={geo.sphere()} material={std(COLORS.white, { roughness: 0.35 })} position={[0, 1.25, 0]} scale={0.34} />
            <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} position={[0, 1.25, 0]} scale={0.16} />
          </group>
          <group ref={warehouse} scale={0.0001} position={[1.0, 0, 0.35]}>
            <mesh geometry={geo.roundBox(0.5, 0.5, 0.5, 0.04)} material={std(COLORS.cardboard, { roughness: 0.8 })} position={[0, 0.25, 0]} />
            <mesh geometry={geo.roundBox(0.45, 0.45, 0.45, 0.04)} material={std(COLORS.cardboard, { roughness: 0.8 })} position={[0.52, 0.225, 0.1]} rotation={[0, 0.3, 0]} />
            <mesh geometry={geo.roundBox(0.42, 0.42, 0.42, 0.04)} material={std(COLORS.cardboard, { roughness: 0.8 })} position={[0.2, 0.71, 0.02]} rotation={[0, -0.2, 0]} />
          </group>
        </group>

        {/* Qatar pin */}
        <group position={qatarPinPose.position} quaternion={qatarPinPose.quaternion}>
          <mesh ref={qatarRing} geometry={geo.ring(0.5, 0.62)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <meshBasicMaterial ref={qatarRingMat} color={COLORS.red} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <group ref={qatarPin} scale={0.0001}>
            <mesh geometry={geo.cone()} material={std(COLORS.red, { roughness: 0.4 })} position={[0, 0.55, 0]} scale={[0.22, 1.1, 0.22]} rotation={[Math.PI, 0, 0]} />
            <mesh geometry={geo.sphere()} material={std(COLORS.red, { roughness: 0.35 })} position={[0, 1.25, 0]} scale={0.34} />
            <mesh geometry={geo.sphere("lo")} material={glow(COLORS.white)} position={[0, 1.25, 0]} scale={0.14} />
          </group>
        </group>

        {/* cargo plane */}
        <group ref={plane} visible={false}>
          <CargoPlane />
        </group>

        {/* the shipment */}
        <group ref={parcel} visible={false}>
          <mesh geometry={geo.roundBox(0.7, 0.55, 0.55, 0.06)} material={std(COLORS.cardboard, { roughness: 0.75 })} />
          <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.5 })} scale={[0.72, 0.57, 0.13]} />
          <mesh geometry={geo.box()} material={std(COLORS.gold, { roughness: 0.4 })} position={[0, 0.28, 0]} scale={[0.18, 0.01, 0.18]} />
          <sprite ref={parcelGlow} scale={[2.8, 2.8, 1]}>
            <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      </group>

      {/* The studio lives on Qatar's surface. */}
      <group position={studioAnchor.position} quaternion={studioAnchor.quaternion}>
        <group ref={studioScale}>{children}</group>
      </group>
    </group>
  );
}
