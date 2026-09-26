"use client";

import { Suspense, useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, geo, glow, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, lookAt, place, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { SPOTS, TABLE_TOP_Y, type Spot } from "../layout";
import { BoardModel, CpuModel, Fan, GpuModel, SsdModel } from "../parts";
import { DELIGHTED, HAPPY, HOLD, REACH, add, blend, hop, nod, typing, wave } from "../poses";
import { Confetti, type ConfettiApi } from "../ui3d";

/** Chapter 5 beats (0..1 of the chapter). */
export const BUILD_BEATS = {
  parcelOpen: [0.14, 0.19],
  steps: {
    board: [0.19, 0.25],
    cpu: [0.24, 0.29],
    cooler: [0.28, 0.33],
    ram: [0.32, 0.37],
    gpu: [0.36, 0.43],
    ssd: [0.42, 0.46],
  },
  parcelAway: [0.46, 0.5],
  panel: [0.46, 0.5],
  power: [0.5, 0.54],
  toSetup: [0.52, 0.57],
  setup: [0.57, 0.62, 0.67, 0.72],
  ready: [0.72, 0.75],
  lift: [0.745, 0.785],
  customerIn: [0.7, 0.82],
  carry: [0.785, 0.86],
  handoff: [0.86, 0.915],
  final: [0.915, 0.97],
  handoffLabel: [0.9, 0.95],
  burst: 0.905,
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

const CASE_POS = new THREE.Vector3(-0.22, TABLE_TOP_Y, 0.02);
const CASE_YAW = -0.25;
const PARCEL_POS = new THREE.Vector3(1.02, TABLE_TOP_Y, 0.22);
const MONITOR_POS = new THREE.Vector3(-1.02, TABLE_TOP_Y, -0.3);
const MONITOR_YAW = 0.28;
const KEYBOARD_POS = new THREE.Vector3(-1.0, TABLE_TOP_Y + 0.012, 0.14);
const MONITOR_SCREEN = new THREE.Vector3(MONITOR_POS.x, TABLE_TOP_Y + 0.42, MONITOR_POS.z);
/** Build status sits on the bench's front edge, right under the case. */
const STATUS_POINT = new THREE.Vector3(CASE_POS.x, TABLE_TOP_Y - 0.45, 0.75);

const REP_HANDOFF: Spot = { x: -0.42, z: 1.02, yaw: 1.35 };
const REP_FINAL: Spot = { x: -0.55, z: 1.08, yaw: 0.42 };
const CUSTOMER_HANDOFF: Spot = { x: 0.42, z: 1.02, yaw: -1.35 };
const TO_SETUP = [new THREE.Vector2(SPOTS.repBench.x, SPOTS.repBench.z), new THREE.Vector2(-1.72, -0.86), new THREE.Vector2(SPOTS.repSetup.x, SPOTS.repSetup.z)];
const TO_FRONT = [new THREE.Vector2(SPOTS.repSetup.x, SPOTS.repSetup.z), new THREE.Vector2(-1.62, 1.0), new THREE.Vector2(REP_HANDOFF.x, REP_HANDOFF.z)];
const CUSTOMER_PATH = [new THREE.Vector2(SPOTS.customerEnter.x, SPOTS.customerEnter.z), new THREE.Vector2(CUSTOMER_HANDOFF.x, CUSTOMER_HANDOFF.z)];
const CAMERA_SIDE = new THREE.Vector3(0, 1.7, 7);
const HOLD_HIGH = new THREE.Vector3(0, 1.32, 0.5);
const HOLD_LOW = new THREE.Vector3(0, 1.02, 0.47);
const PC_HALF_HEIGHT = 0.35;
/** Offset from the customer for the "Ready for pickup or delivery" label: above their far shoulder, away from the rep. */
const HANDOFF_LABEL = new THREE.Vector3(0.62, 2.12, 0.1);

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
const hold = new THREE.Vector3();
const hold2 = new THREE.Vector3();
const holdLocal = new THREE.Vector3();

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
  const confetti = useRef<ConfettiApi>(null);
  const fanSpeed = useRef(0);

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

  useScene(50, (f: FrameState) => {
    const B = BUILD_BEATS;
    const s5 = f.local[4];
    const t = f.time;
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
    let current: BuildStep | null = null;
    let done = 0;
    BUILD_ORDER.forEach((id, i) => {
      const g = parts.current[id];
      if (!g) return;
      const [a, b] = B.steps[id];
      const k = seg(s5, a, b);
      if (k > 0 && k < 1) current = id;
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
      g.scale.setScalar(Math.max(0.0001, lerp(0.5, 1, easeOutCubic(seg(k, 0, 0.4)))));
      const click = clicks.current[i];
      if (click) {
        const ck = seg(s5, b - 0.005, b + 0.035);
        click.visible = ck > 0 && ck < 1;
        click.scale.setScalar(0.04 + ck * 0.22);
        (click.material as THREE.MeshBasicMaterial).opacity = (1 - ck) * 0.9;
      }
    });

    // ---------------- glass panel, then power: RGB + fans
    const p = easeInOutCubic(seg(s5, B.panel[0], B.panel[1]));
    panel.current.visible = s5 > B.panel[0] - 0.01;
    panel.current.position.set((1 - p) * 0.55, (1 - p) * 0.1, (1 - p) * 0.45);
    panel.current.rotation.y = (1 - p) * -0.7;
    const power = smooth(seg(s5, B.power[0], B.power[1]));
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    rgbRed.color.copy(c.off).lerp(c.red, power * pulse);
    rgbGold.color.copy(c.off).lerp(c.gold, power * (0.9 + 0.1 * Math.sin(t * 2.3)));
    fanSpeed.current = power * 16;

    // ---------------- crisp build status above the case
    const status = A.get("build");
    status.pos.copy(STATUS_POINT);
    status.align = "center";
    status.opacity = window4(s5, B.steps.board[0] - 0.02, B.steps.board[0] + 0.01, B.power[1], B.power[1] + 0.03) * (f.active === 4 ? 1 : 0);
    const cur = current as BuildStep | null;
    if (cur) {
      status.text("stage", "Installing");
      status.text("part", STEP_NAMES[cur]);
    } else if (s5 >= B.power[0]) {
      status.text("stage", "Powering on");
      status.text("part", "RGB and cooling online");
    } else if (s5 >= B.panel[0]) {
      status.text("stage", "Finishing");
      status.text("part", "Closing the glass panel");
    }
    const stepProgress = cur ? seg(s5, B.steps[cur][0], B.steps[cur][1]) : 0;
    status.cssVar("p", Math.min(1, (done + stepProgress) / BUILD_ORDER.length));

    // ---------------- monitor + crisp setup checklist
    const [w0, w1, w2, w3] = B.setup;
    const prog = [seg(s5, w0, w1), seg(s5, w1, w2), seg(s5, w2, w3)];
    const ready = smooth(seg(s5, B.ready[0], B.ready[0] + 0.02));
    const booted = smooth(seg(s5, w0 - 0.03, w0));
    screen.current.color.copy(c.screenOff).lerp(c.screenSetup, booted * (0.85 + 0.15 * Math.sin(t * 2))).lerp(c.screenReady, ready);
    // Ready: the new PC boots to the M1 wallpaper.
    wallpaper.current.visible = ready > 0.01;
    wallpaper.current.scale.setScalar(Math.max(0.001, lerp(0.85, 1, ready)));
    // The setup checklist is what's on the monitor while M1 installs everything.
    const setup = A.get("setup");
    setup.pos.set(MONITOR_SCREEN.x + (f.layout === "tall" ? 0.12 : 0), MONITOR_SCREEN.y + 0.02, MONITOR_SCREEN.z + 0.05);
    setup.align = "center";
    const setupIn = easeOutBack(seg(s5, w0 - 0.03, w0 + 0.02), 1.4);
    setup.opacity = Math.min(1, setupIn) * (1 - smooth(seg(s5, B.lift[0], B.lift[1]))) * (f.active === 4 ? 1 : 0);
    setup.scale = Math.max(0.001, lerp(0.88, 1, Math.min(1, setupIn)));
    prog.forEach((v, i) => {
      setup.cssVar(`s${i}`, v);
      setup.cssVar(`c${i}`, smooth(seg(v, 0.96, 1)));
    });
    setup.cssVar("ready", easeOutBack(seg(s5, B.ready[0], B.ready[0] + 0.03), 2));

    // ---------------- final label
    const handoff = A.get("handoff");
    const hl = easeOutBack(seg(s5, B.handoffLabel[0], B.handoffLabel[1]), 1.8);
    handoff.opacity = Math.min(1, hl) * (f.active === 4 ? 1 : 0);
    handoff.scale = Math.max(0.001, lerp(0.85, 1, Math.min(1, hl)));
    handoff.align = "above";

    // A short gold burst as the PC changes hands (finished well before the final rest).
    confetti.current?.set((s5 - B.burst) * 18, s5 > B.burst && s5 < 1);

    // ---------------- characters
    if (f.active !== 4) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    place(rep, SPOTS.repBench);
    lookAt(rep, tmp.copy(CASE_POS).setY(1.3));

    // Opening the parcel.
    const opening = window4(s5, B.parcelOpen[0] - 0.03, B.parcelOpen[0], B.parcelOpen[1], B.parcelOpen[1] + 0.02);
    tmp.copy(PARCEL_POS).setY(TABLE_TOP_Y + 0.4);
    aimArm(rep, "l", tmp, opening, -0.3);
    aimArm(rep, "r", tmp, opening * 0.8, -0.3);
    lookAt(rep, tmp, opening);
    blend(rep.target, HAPPY, opening);
    rep.target.lean = lerp(rep.target.lean, 0.2, opening);

    // Guiding each component into the case.
    BUILD_ORDER.forEach((id) => {
      const [a, b] = B.steps[id];
      const w = window4(s5, a - 0.01, a + 0.02, b - 0.01, b + 0.015);
      const g = parts.current[id];
      if (w <= 0 || !g) return;
      tmp.copy(g.position).applyMatrix4(caseMatrix);
      aimArm(rep, "l", tmp, w, -0.35);
      aimArm(rep, "r", tmp, w * 0.9, -0.45);
      lookAt(rep, tmp, w);
      rep.target.lean = lerp(rep.target.lean, 0.24, w);
      rep.target.brow = lerp(rep.target.brow, -0.2, w);
    });
    add(rep.target, nod(t), window4(s5, B.power[0], B.power[0] + 0.01, B.power[1], B.power[1] + 0.01));
    blend(rep.target, HAPPY, window4(s5, B.power[0], B.power[0] + 0.01, B.toSetup[1], B.toSetup[1] + 0.02));

    // Set up Windows, drivers and updates at the monitor.
    const toSetup = seg(s5, B.toSetup[0], B.toSetup[1]);
    if (toSetup > 0) walkPath(rep, TO_SETUP, toSetup, SPOTS.repBench.yaw, SPOTS.repSetup.yaw);
    const setupW = window4(s5, w0 - 0.01, w0 + 0.01, w3, w3 + 0.01);
    blend(rep.target, typing(t), setupW);
    lookAt(rep, MONITOR_SCREEN, setupW);
    for (let i = 1; i <= 3; i++) add(rep.target, nod(t), bell(s5, B.setup[i] - 0.005, B.setup[i] + 0.02));
    blend(rep.target, HAPPY, window4(s5, B.ready[0], B.ready[0] + 0.01, B.ready[1], B.ready[1] + 0.01));

    // Customer arrives for the hand-over.
    const inT = seg(s5, B.customerIn[0], B.customerIn[1]);
    cust.setVisible(inT > 0);
    walkPath(cust, CUSTOMER_PATH, inT, SPOTS.customerEnter.yaw, CUSTOMER_HANDOFF.yaw);
    blend(cust.target, HAPPY, 1);
    lookAt(cust, tmp.set(REP_HANDOFF.x, 1.55, REP_HANDOFF.z), smooth(seg(s5, B.customerIn[1] - 0.04, B.customerIn[1])));
    blend(cust.target, wave("l", t), window4(s5, B.customerIn[1] - 0.03, B.customerIn[1], B.carry[1] - 0.02, B.carry[1]));

    // Rep lifts the finished PC and carries it round to the customer.
    const lifting = smooth(seg(s5, B.lift[0], B.lift[0] + 0.015));
    const carryT = seg(s5, B.carry[0], B.carry[1]);
    if (carryT > 0) walkPath(rep, TO_FRONT, carryT, SPOTS.repSetup.yaw, REP_HANDOFF.yaw, true);
    const giving = smooth(seg(s5, B.handoff[0], B.handoff[0] + 0.02)) * (1 - smooth(seg(s5, B.handoff[1] - 0.02, B.handoff[1])));
    const released = smooth(seg(s5, B.handoff[1] - 0.02, B.handoff[1]));
    blend(rep.target, HOLD, lifting * (1 - released));
    blend(rep.target, REACH, giving);
    lookAt(rep, tmp.set(CUSTOMER_HANDOFF.x, 1.55, CUSTOMER_HANDOFF.z), smooth(seg(s5, B.carry[1] - 0.03, B.carry[1])));
    talk(rep, t, window4(s5, B.handoff[0], B.handoff[0] + 0.01, B.handoff[1], B.handoff[1] + 0.01) * 0.7);

    const receiving = smooth(seg(s5, B.handoff[0] + 0.01, B.handoff[0] + 0.035));
    blend(cust.target, REACH, receiving * (1 - released));
    blend(cust.target, HOLD, released);
    blend(cust.target, DELIGHTED, receiving);

    // Final shot: both turn to camera; the customer is thrilled with the new PC.
    const fin = smooth(seg(s5, B.final[0], B.final[1]));
    if (fin > 0) {
      rep.place(lerp(REP_HANDOFF.x, REP_FINAL.x, fin), lerp(REP_HANDOFF.z, REP_FINAL.z, fin), lerp(REP_HANDOFF.yaw, REP_FINAL.yaw, fin));
      const cf = SPOTS.customerFinal;
      cust.place(lerp(CUSTOMER_HANDOFF.x, cf.x, fin), lerp(CUSTOMER_HANDOFF.z, cf.z, fin), lerp(CUSTOMER_HANDOFF.yaw, cf.yaw, fin));
      lookAt(rep, CAMERA_SIDE, fin * 0.85);
      lookAt(cust, CAMERA_SIDE, fin * 0.85);
      blend(rep.target, wave("r", t), window4(s5, B.final[0], B.final[0] + 0.02, 0.985, 1.0));
      add(cust.target, hop(t), window4(s5, B.final[0], B.final[0] + 0.01, B.final[1] - 0.01, B.final[1]));
      blend(rep.target, HAPPY, fin);
      blend(cust.target, DELIGHTED, fin);
    }
  }, (f: FrameState) => {
    // PC placement after characters have moved, so it sits in their hands.
    const s5 = f.local[4];
    const B = BUILD_BEATS;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!pc.current.visible || !rep || !cust) return;

    const lift = easeInOutCubic(seg(s5, B.lift[0], B.lift[1]));
    const give = easeInOutCubic(seg(s5, B.handoff[0] + 0.01, B.handoff[1] - 0.01));
    if (f.active !== 4 || lift <= 0) {
      pc.current.position.copy(CASE_POS);
      pc.current.rotation.set(0, CASE_YAW, 0);
    } else {
      // High while over the table, lowered once clear of it.
      const clear = smooth(seg(s5, B.carry[0] + 0.02, B.carry[0] + 0.045));
      holdLocal.lerpVectors(HOLD_HIGH, HOLD_LOW, clear);
      rep.toParent(holdLocal, hold);
      hold.y -= PC_HALF_HEIGHT;
      cust.toParent(HOLD_LOW, hold2);
      hold2.y -= PC_HALF_HEIGHT;
      if (give <= 0) pc.current.position.lerpVectors(CASE_POS, hold, lift);
      else pc.current.position.lerpVectors(hold, hold2, give);
      pc.current.position.y += Math.sin(Math.PI * lift) * 0.12 * (1 - Math.min(1, give * 4)) + Math.sin(Math.PI * give) * 0.08;
      const finalTurn = smooth(seg(s5, B.final[0], B.final[1]));
      pc.current.rotation.set(0, lerp(lerp(CASE_YAW, 0.18, lift), 0, finalTurn), 0);
    }

    // The closing label floats beside the new owner (clear of the logo behind them).
    const handoff = world.anchors.get("handoff");
    handoff.pos.copy(cust.root.position).add(HANDOFF_LABEL);
  });

  return (
    <group>
      <group ref={bench} visible={false}>
        {/* shipped parcel */}
        <group ref={parcel} position={PARCEL_POS}>
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

      <Confetti ref={confetti} position={[0, 1.5, 1.05]} count={34} spread={1.0} power={2.0} palette="gold" />

      {/* The PC. Case-local origin = floor centre; the open side faces +Z. */}
      <group ref={pc} visible={false} position={CASE_POS} rotation={[0, CASE_YAW, 0]}>
        <mesh geometry={geo.box()} material={std("#111114", { roughness: 0.5, metalness: 0.3 })} position={[0, 0.35, -0.165]} scale={[0.66, 0.7, 0.02]} castShadow />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.705, 0]} />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.0125, 0]} />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} castShadow />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[-0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} castShadow />
        <mesh geometry={geo.box()} material={std(COLORS.charcoal, { roughness: 0.5 })} position={[0, 0.09, 0]} scale={[0.62, 0.14, 0.32]} />
        <mesh geometry={geo.box()} material={rgbRed} position={[0, 0.162, 0.16]} scale={[0.6, 0.008, 0.006]} />
        <mesh geometry={geo.box()} material={rgbGold} position={[0.315, 0.4, 0.17]} scale={[0.008, 0.56, 0.008]} />
        <group position={[0.31, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Fan radius={0.08} speed={fanSpeed} ring={rgbRed} />
        </group>
        <group position={[0.31, 0.53, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Fan radius={0.08} speed={fanSpeed} ring={rgbRed} />
        </group>
        <group position={[-0.31, 0.53, -0.02]} rotation={[0, Math.PI / 2, 0]}>
          <Fan radius={0.07} speed={fanSpeed} ring={rgbGold} />
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
            <GpuModel fanSpeed={fanSpeed} rgb={rgbGold} />
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
        <group ref={panel} visible={false}>
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
