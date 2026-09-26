"use client";

import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, geo, glow, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, lookAt, place, resetPose, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { SPOTS, TABLE_TOP_Y } from "../layout";
import { BoardModel, CpuModel, Fan, GpuModel, SsdModel } from "../parts";
import { CHEER_R, HAPPY, add, blend, nod, typing } from "../poses";
import type { CharacterApi } from "../Character";

/** Chapter 5 beats (0..1 of the chapter). The dive back from the globe fills 0..0.16. */
export const BUILD_BEATS = {
  parcelOpen: [0.16, 0.2],
  steps: {
    board: [0.2, 0.26],
    cpu: [0.25, 0.3],
    cooler: [0.29, 0.34],
    ram: [0.33, 0.38],
    gpu: [0.37, 0.44],
    ssd: [0.43, 0.47],
  },
  parcelAway: [0.47, 0.51],
  panel: [0.47, 0.51],
  power: [0.51, 0.55],
  toSetup: [0.55, 0.61],
  setup: [0.61, 0.67, 0.73, 0.79],
  ready: [0.79, 0.83],
  cheer: [0.83, 0.86, 0.92, 0.95],
  setupOut: [0.9, 0.97],
} as const;

type BuildStep = keyof typeof BUILD_BEATS.steps;
const BUILD_ORDER: BuildStep[] = ["board", "cpu", "cooler", "ram", "gpu", "ssd"];
const STEP_NAMES: Record<BuildStep, string> = {
  board: "Motherboard",
  cpu: "Processor",
  cooler: "CPU cooler",
  ram: "Memory",
  gpu: "Graphics card",
  ssd: "Storage",
};

export const CASE_POS = new THREE.Vector3(-0.22, TABLE_TOP_Y, 0.02);
export const CASE_YAW = -0.25;
const PARCEL_POS = new THREE.Vector3(1.02, TABLE_TOP_Y, 0.22);
const MONITOR_POS = new THREE.Vector3(-1.02, TABLE_TOP_Y, -0.3);
const MONITOR_YAW = 0.28;
const KEYBOARD_POS = new THREE.Vector3(-1.0, TABLE_TOP_Y + 0.012, 0.14);
export const MONITOR_SCREEN = new THREE.Vector3(MONITOR_POS.x, TABLE_TOP_Y + 0.42, MONITOR_POS.z);
/** Build status sits on the bench's front edge, right under the case. */
const STATUS_POINT = new THREE.Vector3(CASE_POS.x, TABLE_TOP_Y - 0.45, 0.75);
const CAMERA_SIDE = new THREE.Vector3(0, 1.7, 7);

const TO_SETUP = [new THREE.Vector2(SPOTS.repBench.x, SPOTS.repBench.z), new THREE.Vector2(-1.72, -0.86), new THREE.Vector2(SPOTS.repSetup.x, SPOTS.repSetup.z)];

/** Where each component ends up, in case-local space (origin = case floor centre). */
const MOUNTS: Record<BuildStep, THREE.Vector3> = {
  board: new THREE.Vector3(-0.04, 0.42, -0.135),
  cpu: new THREE.Vector3(-0.04, 0.5, -0.118),
  cooler: new THREE.Vector3(-0.04, 0.5, -0.095),
  ram: new THREE.Vector3(0.14, 0.5, -0.1),
  gpu: new THREE.Vector3(0.0, 0.29, -0.03),
  ssd: new THREE.Vector3(-0.08, 0.36, -0.118),
};

const caseMatrix = new THREE.Matrix4().compose(CASE_POS, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CASE_YAW), new THREE.Vector3(1, 1, 1));
const caseInverse = caseMatrix.clone().invert();
const PARCEL_MOUTH = PARCEL_POS.clone().add(new THREE.Vector3(0, 0.42, 0)).applyMatrix4(caseInverse);

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/**
 * The state chapter 5 ends in and chapter 6 starts from: the rep at the
 * monitor, admiring the finished setup.
 */
export function setupIdle(rep: CharacterApi) {
  resetPose(rep);
  rep.setVisible(true);
  place(rep, SPOTS.repSetup);
  lookAt(rep, MONITOR_SCREEN, 0.6);
  rep.target.smile = 0.8;
  rep.target.brow = 0.2;
}

export function ChapterBuild() {
  const world = useWorld();
  const bench = useRef<THREE.Group>(null!);
  const pc = useRef<THREE.Group>(null!);
  const parts = useRef<Partial<Record<BuildStep, THREE.Group | null>>>({});
  const clicks = useRef<(THREE.Mesh | null)[]>([]);
  const panel = useRef<THREE.Group>(null!);
  const parcel = useRef<THREE.Group>(null!);
  const flapL = useRef<THREE.Group>(null!);
  const flapR = useRef<THREE.Group>(null!);
  const screen = useRef<THREE.MeshBasicMaterial>(null!);
  const wallpaper = useRef<THREE.Group>(null!);
  const fanAngle = useRef(0);

  const rgbRed = useMemo(() => new THREE.MeshBasicMaterial({ color: "#2a2a2e", toneMapped: false }), []);
  const rgbGold = useMemo(() => new THREE.MeshBasicMaterial({ color: "#2a2a2e", toneMapped: false }), []);
  const glass = useMemo(() => std("#9fb3c8", { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.2 }), []);
  const c = useMemo(
    () => ({
      off: new THREE.Color("#2a2a2e"),
      red: new THREE.Color(COLORS.red),
      gold: new THREE.Color(COLORS.gold),
      screenOff: new THREE.Color("#0b0b0d"),
      screenSetup: new THREE.Color("#3a1410"),
      screenReady: new THREE.Color("#140606"),
    }),
    [],
  );

  // The finished PC is handed to the delivery chapter.
  useLayoutEffect(() => {
    world.props.set("pc", pc.current);
    return () => {
      world.props.delete("pc");
    };
  }, [world]);

  useScene(50, (f: FrameState) => {
    const B = BUILD_BEATS;
    const s5 = f.local[4];
    const t = f.clock;
    const A = world.anchors;

    const here = f.s > 4;
    bench.current.visible = here;
    pc.current.visible = here;

    // ---------------- parcel from the U.S. is opened on the bench
    const open = easeOutBack(seg(s5, B.parcelOpen[0], B.parcelOpen[1]), 1.6);
    flapL.current.rotation.z = open * 2.1;
    flapR.current.rotation.z = -open * 2.1;
    const away = easeInOutCubic(seg(s5, B.parcelAway[0], B.parcelAway[1]));
    parcel.current.visible = away < 1;
    parcel.current.scale.setScalar(Math.max(0.0001, 1 - away));
    parcel.current.position.set(PARCEL_POS.x + away * 0.3, PARCEL_POS.y, PARCEL_POS.z);

    // ---------------- components fly out of the parcel and slot into the case
    let done = 0;
    let stepProgress = 0;
    let current: BuildStep | null = null;
    for (let i = 0; i < BUILD_ORDER.length; i++) {
      const id = BUILD_ORDER[i];
      const g = parts.current[id];
      if (!g) continue;
      const [a, b] = B.steps[id];
      const k = seg(s5, a, b);
      if (k > 0 && k < 1) {
        current = id;
        stepProgress = k;
      }
      if (k >= 1) done++;
      const rise = easeOutCubic(seg(k, 0, 0.3));
      const glide = easeInOutCubic(seg(k, 0.3, 0.72));
      const slot = easeInOutCubic(seg(k, 0.72, 1));
      const mount = MOUNTS[id];
      tmp.copy(PARCEL_MOUTH);
      tmp.y += rise * 0.25;
      tmp2.set(mount.x, mount.y, mount.z + 0.42);
      tmp.lerp(tmp2, glide);
      tmp.y += Math.sin(Math.PI * glide) * 0.12;
      tmp.lerp(mount, slot);
      g.position.copy(tmp);
      g.visible = k > 0;
      g.rotation.y = (1 - glide) * 1.2;
      g.scale.setScalar(Math.max(0.0001, easeOutCubic(seg(k, 0, 0.4))));
      const click = clicks.current[i];
      if (click) {
        const ck = seg(s5, b - 0.005, b + 0.035);
        click.visible = ck > 0 && ck < 1;
        click.scale.setScalar(0.04 + ck * 0.22);
        (click.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * ck) * 0.9;
      }
    }

    // ---------------- glass panel, then power: RGB + fans (fan angle follows the scroll)
    const p = easeInOutCubic(seg(s5, B.panel[0], B.panel[1]));
    const panelIn = f.s >= 5 ? 1 : smooth(seg(s5, B.panel[0] - 0.01, B.panel[0] + 0.012));
    panel.current.visible = panelIn > 0.001;
    panel.current.scale.setScalar(Math.max(0.001, panelIn));
    panel.current.position.set((1 - p) * 0.55, (1 - p) * 0.1, (1 - p) * 0.45);
    panel.current.rotation.y = (1 - p) * -0.7;
    const power = f.s >= 5 ? 1 : smooth(seg(s5, B.power[0], B.power[1]));
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    rgbRed.color.copy(c.off).lerp(c.red, power * pulse);
    rgbGold.color.copy(c.off).lerp(c.gold, power * (0.9 + 0.1 * Math.sin(t * 2.3)));
    fanAngle.current = power * (t - 30) * 14;

    // ---------------- crisp build status under the case
    const status = A.get("build");
    status.pos.copy(STATUS_POINT);
    status.align = "center";
    status.opacity = window4(s5, B.steps.board[0] - 0.02, B.steps.board[0] + 0.01, B.power[1], B.power[1] + 0.03) * (f.active === 4 ? 1 : 0);
    if (current) {
      status.text("stage", "Installing");
      status.text("part", STEP_NAMES[current]);
    } else if (s5 >= B.power[0]) {
      status.text("stage", "Powering on");
      status.text("part", "RGB and cooling online");
    } else if (s5 >= B.panel[0]) {
      status.text("stage", "Finishing");
      status.text("part", "Closing the glass panel");
    } else {
      status.text("stage", "Installing");
      status.text("part", STEP_NAMES.board);
    }
    status.cssVar("p", Math.min(1, (done + stepProgress) / BUILD_ORDER.length));

    // ---------------- monitor + crisp setup checklist (the card is what's on the monitor)
    const [w0, , , w3] = B.setup;
    const ready = f.s >= 5 ? 1 : smooth(seg(s5, B.ready[0], B.ready[0] + 0.02));
    const booted = f.s >= 5 ? 1 : smooth(seg(s5, w0 - 0.03, w0));
    screen.current.color.copy(c.screenOff).lerp(c.screenSetup, booted * (0.85 + 0.15 * Math.sin(t * 2))).lerp(c.screenReady, ready);
    wallpaper.current.visible = ready > 0.01;
    wallpaper.current.scale.setScalar(Math.max(0.001, ready));
    const setup = A.get("setup");
    setup.pos.set(MONITOR_SCREEN.x + (f.layout === "tall" ? 0.12 : 0), MONITOR_SCREEN.y + 0.02, MONITOR_SCREEN.z + 0.05);
    setup.align = "center";
    const setupIn = easeOutBack(seg(s5, w0 - 0.03, w0 + 0.02), 1.4);
    setup.opacity = Math.min(1, setupIn) * (1 - smooth(seg(s5, B.setupOut[0], B.setupOut[1]))) * (f.active === 4 ? 1 : 0);
    setup.scale = Math.max(0.001, lerp(0.88, 1, Math.min(1, setupIn)));
    for (let i = 0; i < 3; i++) {
      const v = seg(s5, B.setup[i], B.setup[i + 1]);
      setup.cssVar(`s${i}`, v);
      setup.cssVar(`c${i}`, smooth(seg(v, 0.96, 1)));
    }
    setup.cssVar("ready", easeOutBack(seg(s5, B.ready[0], B.ready[0] + 0.03), 2));

    // ---------------- characters (the customer is at home this chapter)
    if (f.active !== 4) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    cust.setVisible(false);
    resetPose(rep);
    rep.setVisible(true);
    place(rep, SPOTS.repBench);
    lookAt(rep, tmp.copy(CASE_POS).setY(1.3));
    rep.target.smile = 0.6;

    // Opening the parcel.
    const opening = window4(s5, B.parcelOpen[0] - 0.03, B.parcelOpen[0], B.parcelOpen[1], B.parcelOpen[1] + 0.02);
    tmp.copy(PARCEL_POS).setY(TABLE_TOP_Y + 0.4);
    aimArm(rep, "l", tmp, opening, -0.3);
    aimArm(rep, "r", tmp, opening * 0.8, -0.3);
    lookAt(rep, tmp, opening);
    blend(rep.target, HAPPY, opening);
    rep.target.lean = lerp(rep.target.lean, 0.2, opening);

    // Guiding each component into the case.
    for (const id of BUILD_ORDER) {
      const [a, b] = B.steps[id];
      const w = window4(s5, a - 0.01, a + 0.02, b - 0.01, b + 0.015);
      const g = parts.current[id];
      if (w <= 0 || !g) continue;
      tmp.copy(g.position).applyMatrix4(caseMatrix);
      aimArm(rep, "l", tmp, w, -0.35);
      aimArm(rep, "r", tmp, w * 0.9, -0.45);
      lookAt(rep, tmp, w);
      rep.target.lean = lerp(rep.target.lean, 0.24, w);
      rep.target.brow = lerp(rep.target.brow, -0.2, w);
    }
    add(rep.target, nod(t), window4(s5, B.power[0], B.power[0] + 0.01, B.power[1], B.power[1] + 0.01));
    blend(rep.target, HAPPY, window4(s5, B.power[0], B.power[0] + 0.01, B.toSetup[1], B.toSetup[1] + 0.02));

    // Walk to the monitor: from here on the pose converges on setupIdle (chapter 6's start).
    const toSetup = seg(s5, B.toSetup[0], B.toSetup[1]);
    if (toSetup > 0) walkPath(rep, TO_SETUP, toSetup, SPOTS.repBench.yaw, SPOTS.repSetup.yaw);
    const atMonitor = smooth(seg(s5, B.toSetup[1] - 0.02, B.toSetup[1]));
    if (atMonitor > 0) {
      rep.target.headYaw = lerp(rep.target.headYaw, 0, atMonitor);
      rep.target.headPitch = lerp(rep.target.headPitch, 0, atMonitor);
      lookAt(rep, MONITOR_SCREEN, 0.6 * atMonitor);
      rep.target.smile = lerp(rep.target.smile, 0.8, atMonitor);
      rep.target.brow = lerp(rep.target.brow, 0.2, atMonitor);
    }

    // Windows, drivers and updates.
    const setupW = window4(s5, w0 - 0.01, w0 + 0.01, w3, w3 + 0.01);
    blend(rep.target, typing(t), setupW);
    lookAt(rep, MONITOR_SCREEN, setupW);
    for (let i = 1; i <= 3; i++) add(rep.target, nod(t), bell(s5, B.setup[i] - 0.005, B.setup[i] + 0.02));

    // Ready: a proud little fist pump to camera, then back to admiring the setup.
    const cheer = window4(s5, ...B.cheer);
    blend(rep.target, CHEER_R, cheer);
    lookAt(rep, CAMERA_SIDE, cheer * 0.8);
  }, (f: FrameState) => {
    // On the bench until chapter 6 takes the PC.
    if (f.s >= 5) return;
    pc.current.position.copy(CASE_POS);
    pc.current.rotation.set(0, CASE_YAW, 0);
  });

  return (
    <group>
      <group ref={bench} name="bench" visible={false}>
        {/* shipped parcel */}
        <group ref={parcel} name="parcel" position={PARCEL_POS}>
          <mesh geometry={geo.roundBox(0.5, 0.38, 0.42, 0.03)} material={std(COLORS.cardboard, { roughness: 0.85 })} position={[0, 0.19, 0]} />
          <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.5 })} position={[0, 0.19, 0]} scale={[0.51, 0.385, 0.1]} />
          <mesh geometry={geo.box()} material={std("#f2efe8", { roughness: 0.7 })} position={[0.13, 0.2, 0.212]} scale={[0.15, 0.1, 0.005]} />
          <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.6 })} position={[0.13, 0.23, 0.215]} scale={[0.13, 0.015, 0.004]} />
          <mesh geometry={geo.box()} material={std("#1a1208", { roughness: 0.9 })} position={[0, 0.375, 0]} scale={[0.46, 0.01, 0.38]} />
          <group ref={flapL} position={[-0.25, 0.38, 0]}>
            <mesh geometry={geo.box()} material={std(COLORS.cardboard, { roughness: 0.85 })} position={[0.125, 0, 0]} scale={[0.25, 0.012, 0.42]} />
          </group>
          <group ref={flapR} position={[0.25, 0.38, 0]}>
            <mesh geometry={geo.box()} material={std(COLORS.cardboard, { roughness: 0.85 })} position={[-0.125, 0, 0]} scale={[0.25, 0.012, 0.42]} />
          </group>
        </group>

        {/* monitor + keyboard */}
        <group position={MONITOR_POS} rotation={[0, MONITOR_YAW, 0]}>
          <mesh geometry={geo.roundBox(0.22, 0.02, 0.16, 0.01)} material={std(COLORS.charcoal, { roughness: 0.4, metalness: 0.4 })} position={[0, 0.01, 0]} />
          <mesh geometry={geo.box()} material={std(COLORS.charcoal, { roughness: 0.4, metalness: 0.4 })} position={[0, 0.14, -0.03]} scale={[0.05, 0.26, 0.03]} />
          <group position={[0, 0.42, 0]}>
            <mesh geometry={geo.roundBox(0.76, 0.47, 0.035, 0.02)} material={std("#0d0d0f", { roughness: 0.3, metalness: 0.4 })} />
            <mesh geometry={geo.plane()} position={[0, 0.005, 0.019]} scale={[0.72, 0.43, 1]}>
              <meshBasicMaterial ref={screen} color="#0b0b0d" toneMapped={false} />
            </mesh>
            <group ref={wallpaper} position={[0, 0.005, 0.021]} visible={false}>
              <Suspense fallback={null}>
                <Wallpaper />
              </Suspense>
            </group>
            <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, -0.237, 0.012]} scale={[0.2, 0.006, 0.01]} />
          </group>
        </group>
        <group position={KEYBOARD_POS} rotation={[0, 0.32, 0]}>
          <mesh geometry={geo.roundBox(0.46, 0.024, 0.15, 0.01)} material={std(COLORS.charcoal, { roughness: 0.45 })} />
          <mesh geometry={geo.box()} material={std("#2c2c31", { roughness: 0.6 })} position={[0, 0.014, 0]} scale={[0.42, 0.006, 0.11]} />
          <mesh geometry={geo.box()} material={rgbRed} position={[0, 0.004, 0.076]} scale={[0.44, 0.008, 0.004]} />
        </group>
      </group>

      {/* The PC. Case-local origin = floor centre; the open side faces +Z. */}
      <group ref={pc} name="pc" visible={false} position={CASE_POS} rotation={[0, CASE_YAW, 0]}>
        <mesh geometry={geo.box()} material={std("#111114", { roughness: 0.5, metalness: 0.3 })} position={[0, 0.35, -0.165]} scale={[0.66, 0.7, 0.02]} castShadow />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.705, 0]} />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.0125, 0]} />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} castShadow />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[-0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} castShadow />
        <mesh geometry={geo.box()} material={std(COLORS.charcoal, { roughness: 0.5 })} position={[0, 0.09, 0]} scale={[0.62, 0.14, 0.32]} />
        <mesh geometry={geo.box()} material={rgbRed} position={[0, 0.162, 0.16]} scale={[0.6, 0.008, 0.006]} />
        <mesh geometry={geo.box()} material={rgbGold} position={[0.315, 0.4, 0.17]} scale={[0.008, 0.56, 0.008]} />
        <group position={[0.31, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Fan radius={0.08} angle={fanAngle} ring={rgbRed} />
        </group>
        <group position={[0.31, 0.53, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Fan radius={0.08} angle={fanAngle} ring={rgbRed} />
        </group>
        <group position={[-0.31, 0.53, -0.02]} rotation={[0, Math.PI / 2, 0]}>
          <Fan radius={0.07} angle={fanAngle} ring={rgbGold} />
        </group>

        {/* components (each flies in during the build) */}
        <group ref={(el) => { parts.current.board = el; }} visible={false}>
          <BoardModel />
        </group>
        <group ref={(el) => { parts.current.cpu = el; }} visible={false}>
          <group scale={0.3}>
            <CpuModel />
          </group>
        </group>
        <group ref={(el) => { parts.current.cooler = el; }} visible={false}>
          <mesh geometry={geo.cylinder(1, 1, 32)} material={std(COLORS.charcoal, { roughness: 0.35, metalness: 0.5 })} rotation={[Math.PI / 2, 0, 0]} scale={[0.058, 0.035, 0.058]} />
          <mesh geometry={geo.torus(0.05, 0.007)} material={rgbGold} position={[0, 0, 0.019]} />
          <mesh geometry={geo.circle(24)} material={glow(COLORS.red, 0.9)} position={[0, 0, 0.018]} scale={0.022} />
          <mesh geometry={geo.capsule(0.012, 0.16)} material={std("#26262b")} position={[0.06, 0.08, -0.01]} rotation={[0, 0, -0.9]} />
        </group>
        <group ref={(el) => { parts.current.ram = el; }} visible={false}>
          {[0, 0.036].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh geometry={geo.box()} material={std("#131316", { roughness: 0.4, metalness: 0.3 })} scale={[0.02, 0.26, 0.05]} />
              <mesh geometry={geo.box()} material={rgbRed} position={[0, 0, 0.028]} scale={[0.022, 0.24, 0.008]} />
            </group>
          ))}
        </group>
        <group ref={(el) => { parts.current.gpu = el; }} visible={false}>
          <group rotation={[-Math.PI / 2, 0, 0]} scale={0.9}>
            <GpuModel fanAngle={fanAngle} rgb={rgbGold} />
          </group>
        </group>
        <group ref={(el) => { parts.current.ssd = el; }} visible={false}>
          <group scale={0.6}>
            <SsdModel />
          </group>
        </group>
        {BUILD_ORDER.map((id, i) => (
          <mesh
            key={id}
            geometry={geo.ring(0.8, 1)}
            position={[MOUNTS[id].x, MOUNTS[id].y, MOUNTS[id].z + 0.06]}
            visible={false}
            ref={(el) => {
              clicks.current[i] = el;
            }}
          >
            <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}

        {/* tempered-glass side panel */}
        <group ref={panel} name="panel" visible={false}>
          <mesh geometry={geo.plane()} material={glass} position={[0, 0.36, 0.188]} scale={[0.64, 0.68, 1]} />
          <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4 })} position={[0, 0.02, 0.188]} scale={[0.66, 0.02, 0.012]} />
          <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4 })} position={[0, 0.7, 0.188]} scale={[0.66, 0.02, 0.012]} />
        </group>
      </group>
    </group>
  );
}

/** The official M1 logo as the desktop wallpaper once setup is complete. */
function Wallpaper() {
  const logo = useLoader(THREE.TextureLoader, "/how-it-works/m1-logo-sign.webp");
  logo.colorSpace = THREE.SRGBColorSpace;
  const aspect = logo.image.width / logo.image.height;
  const h = 0.36;
  return (
    <mesh geometry={geo.plane()} scale={[h * aspect, h, 1]}>
      <meshBasicMaterial map={logo} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
