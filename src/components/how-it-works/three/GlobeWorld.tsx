"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, glowTexture, labelTexture, std } from "./assets";
import { bell, easeInOutCubic, easeOutBack, seg, smooth } from "./anim";
import { useScene, useWorld, type FrameState } from "./director";
import { maskAt } from "./globe-data";
import {
  GLOBE_CENTER,
  GLOBE_RADIUS as R,
  V_MID,
  V_QATAR,
  V_USA,
  geoVector,
  routePoint,
  slerpVectors,
  viewQuaternion,
} from "./globe-math";

/**
 * Scene 4 beats (scene-local time). The crane-up itself is the camera path;
 * these drive what the globe does underneath it.
 */
export const GLOBE_BEATS = {
  fadeIn: [0.06, 0.22],
  studioShrink: [0.08, 0.3],
  qatarLabel: [0.2, 0.28],
  spinToUsa: [0.28, 0.42],
  usaHighlight: [0.36, 0.44],
  warehouse: [0.42, 0.48],
  parcelPop: [0.46, 0.5],
  toOverview: [0.52, 0.6],
  ghostRoute: [0.5, 0.56],
  travel: [0.56, 0.87],
  followToQatar: [0.68, 0.9],
  arrival: [0.86, 0.95],
} as const;

/** Scene 5 beats that belong to the globe (the dive back in). */
const DIVE = { regrow: [0.02, 0.18], fadeOut: [0.06, 0.18] } as const;

const STUDIO_MIN_SCALE = 0.035;

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const dummy = new THREE.Object3D();
const Z = new THREE.Vector3(0, 0, 1);

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
    <instancedMesh ref={mesh} args={[geo.circle(6), undefined, points.length]} frustumCulled={false}>
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

function Sprite({ tex, height, spriteRef }: { tex: { texture: THREE.Texture; aspect: number }; height: number; spriteRef: React.RefObject<THREE.Sprite | null> }) {
  return (
    <sprite ref={spriteRef} scale={[height * tex.aspect, height, 1]}>
      <spriteMaterial map={tex.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

export function GlobeWorld({ children }: { children: ReactNode }) {
  const { quality } = useWorld();
  const globe = useRef<THREE.Group>(null!);
  const visuals = useRef<THREE.Group>(null!);
  const studioScale = useRef<THREE.Group>(null!);

  const oceanMat = useRef<THREE.MeshStandardMaterial>(null!);
  const landMat = useRef<THREE.MeshBasicMaterial>(null);
  const usaMat = useRef<THREE.MeshBasicMaterial>(null);
  const gridMat = useRef<THREE.LineBasicMaterial>(null!);
  const starsMat = useRef<THREE.PointsMaterial>(null!);
  const routeMesh = useRef<THREE.Mesh>(null!);
  const ghostMat = useRef<THREE.LineDashedMaterial>(null!);
  const parcel = useRef<THREE.Group>(null!);
  const parcelGlow = useRef<THREE.Sprite>(null!);
  const parcelLabel = useRef<THREE.Sprite>(null);
  const usaPin = useRef<THREE.Group>(null!);
  const qatarPin = useRef<THREE.Group>(null!);
  const usaLabel = useRef<THREE.Sprite>(null);
  const qatarLabel = useRef<THREE.Sprite>(null);
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

  const dots = useMemo(() => fibonacciDots(quality === "high" ? 30000 : 16000), [quality]);
  const dotSize = quality === "high" ? 0.078 : 0.1;

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
      const t = rand() * Math.PI * 2;
      const rr = 70 + rand() * 60;
      const s = Math.sqrt(1 - u * u);
      arr.set([Math.cos(t) * s * rr, u * rr, Math.sin(t) * s * rr], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [quality]);

  const route = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) pts.push(routePoint(i / 96));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 192, 0.07, 8, false);
    const ghost = new THREE.BufferGeometry().setFromPoints(curve.getPoints(160));
    const line = new THREE.Line(ghost);
    line.computeLineDistances();
    return { tube, ghost: line.geometry, indexCount: tube.index!.count };
  }, []);

  const studioAnchor = useMemo(() => {
    const q = viewQuaternion(V_QATAR).invert();
    return { position: V_QATAR.clone().multiplyScalar(R), quaternion: q };
  }, []);

  const pinPose = (v: THREE.Vector3) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    return { position: v.clone().multiplyScalar(R), quaternion: q };
  };
  const usaPinPose = useMemo(() => pinPose(V_USA), []);
  const qatarPinPose = useMemo(() => pinPose(V_QATAR), []);

  const labels = useMemo(
    () => ({
      usa: labelTexture("UNITED STATES", "white"),
      qatar: labelTexture("QATAR", "red"),
      parcel: labelTexture("YOUR PARTS", "gold"),
    }),
    [],
  );
  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);

  const viewCentre = useMemo(() => new THREE.Vector3(), []);

  useScene(0, (f: FrameState) => {
    const s4 = f.local[3];
    const s5 = f.local[4];
    const B = GLOBE_BEATS;

    // --- how much of the globe is visible, and how small the studio is.
    const fade = smooth(seg(s4, B.fadeIn[0], B.fadeIn[1])) * (1 - smooth(seg(s5, DIVE.fadeOut[0], DIVE.fadeOut[1])));
    const shrink = easeInOutCubic(seg(s4, B.studioShrink[0], B.studioShrink[1])) * (1 - easeInOutCubic(seg(s5, DIVE.regrow[0], DIVE.regrow[1])));
    studioScale.current.scale.setScalar(Math.exp(Math.log(STUDIO_MIN_SCALE) * shrink));

    visuals.current.visible = fade > 0.001;

    // --- which point on Earth faces the camera.
    const spin = easeInOutCubic(seg(s4, B.spinToUsa[0], B.spinToUsa[1]));
    const over = easeInOutCubic(seg(s4, B.toOverview[0], B.toOverview[1]));
    const home = easeInOutCubic(seg(s4, B.followToQatar[0], B.followToQatar[1]));
    if (home > 0) slerpVectors(V_MID, V_QATAR, home, viewCentre);
    else if (over > 0) slerpVectors(V_USA, V_MID, over, viewCentre);
    else slerpVectors(V_QATAR, V_USA, spin, viewCentre);
    // Outside scene 4 the globe must sit exactly at Qatar so the studio is upright.
    if (f.p < 0.0001 || s4 <= 0 || s5 > 0) viewCentre.copy(V_QATAR);
    viewQuaternion(viewCentre, tmpQ);
    globe.current.quaternion.copy(tmpQ);
    globe.current.updateMatrixWorld(true);

    if (!visuals.current.visible) return;

    oceanMat.current.opacity = fade;
    oceanMat.current.transparent = fade < 0.999;
    oceanMat.current.depthWrite = fade > 0.5;
    if (landMat.current) landMat.current.opacity = fade;
    const usaHi = smooth(seg(s4, B.usaHighlight[0], B.usaHighlight[1]));
    if (usaMat.current) {
      usaMat.current.opacity = fade;
      usaMat.current.color.set("#55555d").lerp(tmpColor.set(COLORS.gold), usaHi);
    }
    gridMat.current.opacity = 0.45 * fade;
    starsMat.current.opacity = fade;
    atmosphere.uniforms.uOpacity.value = 0.55 * fade;

    // --- pins, rings and labels (tucked away quickly once the dive starts)
    const diving = 1 - smooth(seg(s5, 0, 0.05));
    const usaPop = easeOutBack(seg(s4, B.usaHighlight[0] + 0.02, B.usaHighlight[1] + 0.02)) * diving;
    usaPin.current.scale.setScalar(Math.max(0.0001, usaPop));
    const qPop = easeOutBack(seg(s4, B.qatarLabel[0], B.qatarLabel[1])) * diving;
    qatarPin.current.scale.setScalar(Math.max(0.0001, qPop * (1 + 0.35 * bell(s4, B.arrival[0], B.arrival[1]))));

    const pulse = (f.time * 0.9) % 1;
    usaRing.current.scale.setScalar(0.6 + pulse * 2.2 * usaPop);
    (usaRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.8 * usaHi * fade;
    const arrive = seg(s4, B.arrival[0], B.arrival[1]);
    const qPulse = arrive > 0 && arrive < 1 ? arrive : pulse;
    qatarRing.current.scale.setScalar(0.6 + qPulse * (arrive > 0 && arrive < 1 ? 5 : 2.2));
    qatarRingMat.current.opacity = (1 - qPulse) * 0.85 * fade * Math.min(1, qPop);

    if (usaLabel.current) {
      usaLabel.current.visible = usaPop > 0.02;
      usaLabel.current.material.opacity = Math.min(1, usaPop) * fade;
    }
    if (qatarLabel.current) {
      qatarLabel.current.visible = qPop > 0.02;
      qatarLabel.current.material.opacity = Math.min(1, qPop) * fade;
    }

    // --- U.S. suppliers' warehouse
    const wh = easeOutBack(seg(s4, B.warehouse[0], B.warehouse[1]));
    warehouse.current.scale.setScalar(Math.max(0.0001, wh * (1 - smooth(seg(s4, 0.6, 0.66)))));

    // --- route + parcel
    const ghost = smooth(seg(s4, B.ghostRoute[0], B.ghostRoute[1]));
    ghostMat.current.opacity = 0.55 * ghost * fade;
    const u = easeInOutCubic(seg(s4, B.travel[0], B.travel[1]));
    const drawn = Math.floor((route.indexCount / 3) * u) * 3;
    route.tube.setDrawRange(0, drawn);
    routeMesh.current.visible = drawn > 0;

    const pop = easeOutBack(seg(s4, B.parcelPop[0], B.parcelPop[1]));
    const parcelVisible = pop > 0.001 && s5 < 0.12;
    parcel.current.visible = parcelVisible;
    if (parcelVisible) {
      // Sits on the warehouse, lifts off along the arc, lands on Qatar.
      routePoint(u, parcel.current.position);
      if (u <= 0) parcel.current.position.copy(V_USA).multiplyScalar(R + 0.55 + 0.25 * pop);
      routePoint(Math.min(1, u + 0.01), tmpV);
      parcel.current.up.copy(parcel.current.position).normalize().applyQuaternion(tmpQ);
      if (u < 0.995) parcel.current.lookAt(tmpV.applyMatrix4(globe.current.matrixWorld));
      const travelling = u > 0 && u < 1;
      const wobble = travelling ? Math.sin(f.time * 6) * 0.08 : 0;
      parcel.current.rotateZ(wobble);
      parcel.current.scale.setScalar(Math.max(0.0001, pop) * (u >= 1 ? 1 - 0.5 * seg(s4, 0.9, 0.98) : 1));
      parcelGlow.current.material.opacity = (travelling ? 0.9 : 0.45) * fade;
      if (parcelLabel.current) parcelLabel.current.material.opacity = smooth(seg(s4, 0.54, 0.6)) * (1 - smooth(seg(s4, 0.86, 0.92))) * fade;
    }
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
        <DotLayer points={dots.land} color="#6e6e78" size={dotSize} materialRef={landMat} />
        <DotLayer points={dots.usa} color="#55555d" size={dotSize * 1.12} materialRef={usaMat} />
        <mesh geometry={geo.sphere()} scale={R * 1.12} material={atmosphere} />
        <points geometry={stars}>
          <pointsMaterial ref={starsMat} color="#ffffff" size={0.28} sizeAttenuation transparent opacity={0} depthWrite={false} fog={false} />
        </points>

        {/* ghost dashed route + drawn route */}
        <line>
          <primitive object={route.ghost} attach="geometry" />
          <lineDashedMaterial ref={ghostMat} color={COLORS.gold} dashSize={0.35} gapSize={0.28} transparent opacity={0} depthWrite={false} />
        </line>
        <mesh ref={routeMesh} geometry={route.tube} material={glow(COLORS.gold)} />

        {/* U.S. pin + warehouse */}
        <group position={usaPinPose.position} quaternion={usaPinPose.quaternion}>
          <mesh ref={usaRing} geometry={geo.ring(0.5, 0.62)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <group ref={usaPin} scale={0.0001}>
            <mesh geometry={geo.cone()} material={std(COLORS.white, { roughness: 0.4 })} position={[0, 0.55, 0]} scale={[0.22, 1.1, 0.22]} rotation={[Math.PI, 0, 0]} />
            <mesh geometry={geo.sphere()} material={std(COLORS.white, { roughness: 0.35 })} position={[0, 1.25, 0]} scale={0.34} />
            <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} position={[0, 1.25, 0]} scale={0.16} />
            <group position={[0, 2.05, 0]}>
              <Sprite tex={labels.usa} height={0.95} spriteRef={usaLabel} />
            </group>
          </group>
          <group ref={warehouse} scale={0.0001} position={[0.9, 0, 0.3]}>
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
            <group position={[0, 2.05, 0]}>
              <Sprite tex={labels.qatar} height={0.95} spriteRef={qatarLabel} />
            </group>
          </group>
        </group>

        {/* the shipment */}
        <group ref={parcel} visible={false}>
          <mesh geometry={geo.roundBox(0.8, 0.6, 0.6, 0.06)} material={std(COLORS.cardboard, { roughness: 0.75 })} />
          <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.5 })} scale={[0.82, 0.62, 0.14]} />
          <mesh geometry={geo.box()} material={std(COLORS.gold, { roughness: 0.4 })} position={[0, 0.305, 0]} scale={[0.2, 0.01, 0.2]} />
          <sprite ref={parcelGlow} scale={[3.2, 3.2, 1]}>
            <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
          <group position={[0, 1.0, 0]}>
            <Sprite tex={labels.parcel} height={0.7} spriteRef={parcelLabel} />
          </group>
        </group>
      </group>

      {/* The studio lives on Qatar's surface. */}
      <group position={studioAnchor.position} quaternion={studioAnchor.quaternion}>
        <group ref={studioScale}>{children}</group>
      </group>
    </group>
  );
}

