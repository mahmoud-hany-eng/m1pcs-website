"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { globalAt } from "../../story";
import { COLORS, canvasTexture, drawCheck, fonts, geo, glow, roundRect, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, angleLerp, lookAt, place, resetPose, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { checkBadgeTexture } from "../icons2d";
import { DELIVER_BEATS, HOLD_POINT, SPOTS, TABLE_TOP_Y } from "../layout";
import { BoardModel, CpuModel, Fan, GpuModel, SsdModel } from "../parts";
import { HOLD, add, blend, celebrate, nod, typing } from "../poses";
import { LabelSprite } from "../ui3d";

/** Scene 5 beats (scene-local). */
export const BUILD_BEATS = {
  parcelOpen: [0.15, 0.21],
  steps: {
    board: [0.21, 0.29],
    cpu: [0.28, 0.34],
    cooler: [0.33, 0.39],
    ram: [0.38, 0.44],
    gpu: [0.43, 0.51],
    ssd: [0.5, 0.56],
  },
  parcelAway: [0.56, 0.61],
  panel: [0.57, 0.63],
  power: [0.63, 0.68],
  walkToSetup: [0.64, 0.7],
  setup: [0.7, 0.77, 0.83, 0.89],
  ready: [0.89, 0.93],
  walkToPickup: [0.93, 0.965],
  pickup: [0.965, 1.0],
} as const;

type BuildStep = keyof typeof BUILD_BEATS.steps;
const BUILD_ORDER: BuildStep[] = ["board", "cpu", "cooler", "ram", "gpu", "ssd"];

const CASE_POS = new THREE.Vector3(-0.22, TABLE_TOP_Y, 0.02);
const CASE_YAW = -0.25;
const PARCEL_POS = new THREE.Vector3(1.02, TABLE_TOP_Y, 0.22);
const MONITOR_POS = new THREE.Vector3(-1.02, TABLE_TOP_Y, -0.3);
const MONITOR_YAW = 0.28;
const KEYBOARD_POS = new THREE.Vector3(-1.0, TABLE_TOP_Y + 0.012, 0.14);

const REP_BENCH = { x: 0.52, z: -0.84, yaw: -0.25 };
/** While carried, the case keeps its glass side turned towards the camera. */
const CARRY_YAW = 0.22;
const REP_SETUP = { x: -1.8, z: 0.12, yaw: 1.05 };
const REP_PICKUP = SPOTS.repPickup;
const TO_SETUP = [new THREE.Vector2(REP_BENCH.x, REP_BENCH.z), new THREE.Vector2(-1.74, -0.86), new THREE.Vector2(REP_SETUP.x, REP_SETUP.z)];
const TO_PICKUP = [new THREE.Vector2(REP_SETUP.x, REP_SETUP.z), new THREE.Vector2(-1.74, -0.9), new THREE.Vector2(REP_PICKUP.x, REP_PICKUP.z)];

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
/** The parcel's opening, expressed in case-local space. */
const PARCEL_MOUTH = PARCEL_POS.clone().add(new THREE.Vector3(0, 0.42, 0)).applyMatrix4(caseInverse);

// ---------------------------------------------------------------- setup screen

const SETUP_ITEMS = ["Windows 11 Pro", "Drivers", "Updates"] as const;

function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number[], ready: number) {
  const f = fonts();
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#101014");
  bg.addColorStop(1, "#1a0c0a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "middle";
  if (ready > 0.5) {
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.42, 64, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.gold;
    ctx.fill();
    drawCheck(ctx, w / 2, h * 0.43, 70, "#111111", 14);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.white;
    ctx.font = `700 44px ${f.display}`;
    ctx.fillText("Ready to use", w / 2, h * 0.78);
    return;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.gold;
  ctx.font = `700 26px ${f.display}`;
  ctx.fillText("M1 SETUP", 40, 44);
  SETUP_ITEMS.forEach((label, i) => {
    const y = 108 + i * 78;
    const p = progress[i];
    const done = p >= 1;
    ctx.beginPath();
    ctx.arc(58, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = done ? COLORS.gold : "rgba(255,255,255,0.12)";
    ctx.fill();
    if (done) drawCheck(ctx, 58, y + 1, 20, "#111111", 5);
    ctx.fillStyle = p > 0 ? COLORS.white : "rgba(245,245,247,0.45)";
    ctx.font = `600 30px ${f.sans}`;
    ctx.fillText(label, 92, y - 12);
    roundRect(ctx, 92, y + 12, w - 140, 12, 6);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    if (p > 0) {
      roundRect(ctx, 92, y + 12, Math.max(12, (w - 140) * Math.min(1, p)), 12, 6);
      ctx.fillStyle = done ? COLORS.gold : COLORS.red;
      ctx.fill();
    }
  });
}

// ---------------------------------------------------------------- component

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const hold = new THREE.Vector3();
const hold2 = new THREE.Vector3();

export function SceneBuild() {
  const world = useWorld();
  const bench = useRef<THREE.Group>(null!);
  const pc = useRef<THREE.Group>(null!);
  const parts = useRef<Partial<Record<BuildStep, THREE.Group | null>>>({});
  const clicks = useRef<(THREE.Mesh | null)[]>([]);
  const panel = useRef<THREE.Group>(null!);
  const parcel = useRef<THREE.Group>(null!);
  const flapL = useRef<THREE.Group>(null!);
  const flapR = useRef<THREE.Group>(null!);
  const chips = useRef<(THREE.Sprite | null)[]>([]);
  const readyBadge = useRef<THREE.Group>(null!);
  const readyLabel = useRef<THREE.Sprite>(null!);
  const fanSpeed = useRef(0);
  const screenState = useRef("");

  const rgbRed = useMemo(() => new THREE.MeshBasicMaterial({ color: "#2a2a2e", toneMapped: false }), []);
  const rgbGold = useMemo(() => new THREE.MeshBasicMaterial({ color: "#2a2a2e", toneMapped: false }), []);
  const off = useMemo(() => new THREE.Color("#2a2a2e"), []);
  const red = useMemo(() => new THREE.Color(COLORS.red), []);
  const gold = useMemo(() => new THREE.Color(COLORS.gold), []);
  const badge = useMemo(() => checkBadgeTexture(COLORS.gold), []);
  const glass = useMemo(() => std("#9fb3c8", { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.2 }), []);

  const screen = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 380;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx: canvas.getContext("2d")!, texture };
  }, []);

  const parcelTexture = useMemo(
    () =>
      canvasTexture("parcel-label", 256, 128, (ctx, w, h) => {
        ctx.fillStyle = "#f5f1e8";
        roundRect(ctx, 0, 0, w, h, 12);
        ctx.fill();
        ctx.fillStyle = COLORS.red;
        ctx.font = `800 44px ${fonts().display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("USA → QA", w / 2, h / 2 + 2);
      }),
    [],
  );

  useScene(50, (f: FrameState) => {
    const B = BUILD_BEATS;
    const s5 = f.local[4];
    const t = f.time;

    // The bench props only exist from the dive-in onwards.
    bench.current.visible = f.p >= globalAt(4, 0) - 0.002;
    pc.current.visible = f.p >= globalAt(4, 0) - 0.002;
    if (!bench.current.visible) return;

    // ---------------- parcel
    const open = easeOutBack(seg(s5, B.parcelOpen[0], B.parcelOpen[1]), 1.6);
    flapL.current.rotation.z = open * 2.1;
    flapR.current.rotation.z = -open * 2.1;
    const away = easeInOutCubic(seg(s5, B.parcelAway[0], B.parcelAway[1]));
    parcel.current.scale.setScalar(Math.max(0.0001, 1 - away));
    parcel.current.visible = away < 1 && f.active <= 4;
    parcel.current.position.set(PARCEL_POS.x + away * 0.4, PARCEL_POS.y, PARCEL_POS.z);

    // ---------------- components fly out of the parcel and into the case
    BUILD_ORDER.forEach((id, i) => {
      const g = parts.current[id];
      if (!g) return;
      const [a, b] = B.steps[id];
      const k = seg(s5, a, b);
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
      const c = clicks.current[i];
      if (c) {
        const ck = seg(s5, b - 0.005, b + 0.04);
        c.visible = ck > 0 && ck < 1;
        c.scale.setScalar(0.04 + ck * 0.22);
        (c.material as THREE.MeshBasicMaterial).opacity = (1 - ck) * 0.9;
      }
    });

    // ---------------- side glass panel slides in and closes
    const p = easeInOutCubic(seg(s5, B.panel[0], B.panel[1]));
    panel.current.position.set((1 - p) * 0.55, (1 - p) * 0.1, (1 - p) * 0.45);
    panel.current.rotation.y = (1 - p) * -0.7;
    panel.current.visible = s5 > B.panel[0] - 0.01;

    // ---------------- power on: RGB + fans
    const power = smooth(seg(s5, B.power[0], B.power[1]));
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    rgbRed.color.copy(off).lerp(red, power * pulse);
    rgbGold.color.copy(off).lerp(gold, power * (0.9 + 0.1 * Math.sin(t * 2.3)));
    fanSpeed.current = power * 16;

    // ---------------- setup screen (redrawn only when its visible state changes)
    const [w0, w1, w2, w3] = B.setup;
    const prog = [seg(s5, w0, w1), seg(s5, w1, w2), seg(s5, w2, w3)];
    const ready = seg(s5, B.ready[0], B.ready[0] + 0.01);
    const booted = s5 >= w0 - 0.02;
    const key = booted ? prog.map((v) => Math.round(v * 30)).join(",") + "|" + (ready > 0.5 ? 1 : 0) : "off";
    if (key !== screenState.current) {
      screenState.current = key;
      const { ctx, canvas } = screen;
      if (!booted) {
        ctx.fillStyle = "#08080a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        drawScreen(ctx, canvas.width, canvas.height, prog, ready);
      }
      screen.texture.needsUpdate = true;
    }

    // Floating completion chips above the monitor.
    chips.current.forEach((chip, i) => {
      if (!chip) return;
      const done = easeOutBack(seg(s5, B.setup[i + 1] - 0.005, B.setup[i + 1] + 0.03), 2);
      const fade = 1 - smooth(seg(f.local[5], 0.02, 0.08));
      chip.material.opacity = Math.min(1, done) * fade;
      chip.visible = done > 0.001 && fade > 0;
      const s = 0.1 * Math.max(0.0001, done);
      const aspect = chip.userData.aspect ?? 3;
      chip.scale.set(s * aspect, s, 1);
    });
    const rb = easeOutBack(seg(s5, B.ready[0], B.ready[1]), 2);
    const rbFade = 1 - smooth(seg(f.local[5], 0.0, 0.06));
    readyBadge.current.visible = rb > 0.001 && rbFade > 0;
    readyBadge.current.scale.setScalar(Math.max(0.0001, rb * rbFade));
    readyBadge.current.rotation.y = (1 - Math.min(1, rb)) * Math.PI;
    readyLabel.current.material.opacity = Math.min(1, rb) * rbFade;

    // ---------------- rep (scene 5 only; the customer is at home)
    if (f.active !== 4) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    cust.setVisible(false);
    rep.setVisible(true);
    resetPose(rep);
    place(rep, REP_BENCH);
    lookAt(rep, tmp.copy(CASE_POS).setY(1.3));

    // Opening the parcel.
    const opening = window4(s5, B.parcelOpen[0] - 0.03, B.parcelOpen[0], B.parcelOpen[1], B.parcelOpen[1] + 0.02);
    tmp.copy(PARCEL_POS).setY(TABLE_TOP_Y + 0.4);
    aimArm(rep, "l", tmp, opening, -0.3);
    aimArm(rep, "r", tmp, opening * 0.8, -0.3);
    lookAt(rep, tmp, opening);
    blend(rep.target, { lean: 0.2, smile: 0.8, brow: 0.4 }, opening);

    // Guiding each component: hands follow the part into the case.
    BUILD_ORDER.forEach((id) => {
      const [a, b] = B.steps[id];
      const w = window4(s5, a - 0.01, a + 0.02, b - 0.01, b + 0.015);
      if (w <= 0) return;
      const g = parts.current[id];
      if (!g) return;
      tmp.copy(g.position).applyMatrix4(caseMatrix);
      aimArm(rep, "l", tmp, w, -0.35);
      aimArm(rep, "r", tmp, w * 0.9, -0.45);
      lookAt(rep, tmp, w);
      blend(rep.target, { lean: 0.24, smile: 0.5, brow: -0.2 }, w);
    });
    add(rep.target, nod(t, 0.7), window4(s5, B.power[0], B.power[0] + 0.01, B.power[1], B.power[1] + 0.01));
    blend(rep.target, { smile: 1, brow: 0.6 }, window4(s5, B.power[0], B.power[0] + 0.01, B.walkToSetup[1], B.walkToSetup[1] + 0.02));

    // Walk to the monitor and run the setup.
    const toSetup = seg(s5, B.walkToSetup[0], B.walkToSetup[1]);
    if (toSetup > 0) walkPath(rep, TO_SETUP, toSetup, REP_BENCH.yaw, REP_SETUP.yaw);
    const setupW = window4(s5, B.setup[0] - 0.01, B.setup[0] + 0.01, B.setup[3], B.setup[3] + 0.01);
    blend(rep.target, typing(t), setupW);
    lookAt(rep, tmp.copy(MONITOR_POS).setY(1.3), setupW);
    for (let i = 1; i <= 3; i++) add(rep.target, nod(t, 1), bell(s5, B.setup[i] - 0.005, B.setup[i] + 0.02));

    // Ready!
    const cheer = window4(s5, B.ready[0], B.ready[0] + 0.01, B.ready[1] - 0.005, B.ready[1]);
    blend(rep.target, celebrate(t), cheer);

    // Back to the case, then pick the PC up.
    const toPick = seg(s5, B.walkToPickup[0], B.walkToPickup[1]);
    if (toPick > 0) walkPath(rep, TO_PICKUP, toPick, REP_SETUP.yaw, REP_PICKUP.yaw);
    const lifting = smooth(seg(s5, B.pickup[0] - 0.01, B.pickup[0] + 0.015));
    blend(rep.target, HOLD, lifting);
    blend(rep.target, { smile: 0.9 }, lifting);
  }, (f: FrameState) => {
    // PC placement, after characters have moved (so it can sit in their hands).
    const s5 = f.local[4];
    const s6 = f.local[5];
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!pc.current.visible || !rep || !cust) return;

    const onBench = () => {
      pc.current.position.copy(CASE_POS);
      pc.current.rotation.set(0, CASE_YAW, 0);
    };
    const inHands = (who: typeof rep, out: THREE.Vector3) => who.toParent(HOLD_POINT, out);

    if (f.active <= 4) {
      const lift = easeInOutCubic(seg(s5, BUILD_BEATS.pickup[0], BUILD_BEATS.pickup[1]));
      if (lift <= 0) return onBench();
      inHands(rep, hold);
      hold.y -= 0.34;
      pc.current.position.lerpVectors(CASE_POS, hold, lift);
      pc.current.position.y += Math.sin(Math.PI * lift) * 0.12;
      pc.current.rotation.set(0, angleLerp(CASE_YAW, CARRY_YAW, lift), 0);
      return;
    }

    // Scene 6: carried to the door, handed over, held by the customer.
    const D = DELIVER_BEATS;
    const give = easeInOutCubic(seg(s6, D.handoff[0], D.handoff[1]));
    inHands(rep, hold);
    hold.y -= 0.34;
    inHands(cust, hold2);
    hold2.y -= 0.34 - window4(s6, D.celebrate[0], D.celebrate[0] + 0.03, D.celebrate[1] - 0.03, D.celebrate[1]) * Math.abs(Math.sin(f.time * 7)) * 0.06;
    pc.current.position.lerpVectors(hold, hold2, give);
    pc.current.position.y += Math.sin(Math.PI * give) * 0.1;
    // Carried with the glass side presented to the camera; squared up for the final shot.
    pc.current.rotation.set(0, lerp(CARRY_YAW, 0, smooth(seg(s6, D.final[0], D.final[1]))), 0);
  });

  const setupChips = useMemo(() => SETUP_ITEMS.map((s) => s.toUpperCase()), []);

  return (
    <group>
      <group ref={bench} visible={false}>
        {/* shipped parcel */}
        <group ref={parcel} position={PARCEL_POS}>
          <mesh geometry={geo.roundBox(0.5, 0.38, 0.42, 0.03)} material={std(COLORS.cardboard, { roughness: 0.85 })} position={[0, 0.19, 0]} />
          <mesh geometry={geo.box()} material={std(COLORS.red, { roughness: 0.5 })} position={[0, 0.19, 0]} scale={[0.51, 0.385, 0.1]} />
          <mesh geometry={geo.plane()} position={[0, 0.2, 0.212]} scale={[0.26, 0.13, 1]}>
            <meshBasicMaterial map={parcelTexture} toneMapped={false} />
          </mesh>
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
              <meshBasicMaterial map={screen.texture} toneMapped={false} />
            </mesh>
            <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, -0.237, 0.012]} scale={[0.2, 0.006, 0.01]} />
          </group>
          {setupChips.map((label, i) => (
            <LabelSprite
              key={label}
              text={label}
              style="gold"
              check
              height={0.1}
              position={[0, 0.8 + i * 0.13, 0.05]}
              ref={(el) => {
                chips.current[i] = el;
                if (el) {
                  const tex = (el.material.map as THREE.Texture | null)?.image as HTMLCanvasElement | undefined;
                  el.userData.aspect = tex ? tex.width / tex.height : 3;
                }
              }}
            />
          ))}
        </group>
        <group position={KEYBOARD_POS} rotation={[0, 0.32, 0]}>
          <mesh geometry={geo.roundBox(0.46, 0.024, 0.15, 0.01)} material={std(COLORS.charcoal, { roughness: 0.45 })} />
          <mesh geometry={geo.box()} material={std("#2c2c31", { roughness: 0.6 })} position={[0, 0.014, 0]} scale={[0.42, 0.006, 0.11]} />
          <mesh geometry={geo.box()} material={rgbRed} position={[0, 0.004, 0.076]} scale={[0.44, 0.008, 0.004]} />
        </group>
      </group>

      {/* The PC. Case-local origin = floor centre; the open side faces +Z. */}
      <group ref={pc} visible={false} position={CASE_POS} rotation={[0, CASE_YAW, 0]}>
        <mesh geometry={geo.box()} material={std("#111114", { roughness: 0.5, metalness: 0.3 })} position={[0, 0.35, -0.165]} scale={[0.66, 0.7, 0.02]} />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.705, 0]} />
        <mesh geometry={geo.roundBox(0.68, 0.025, 0.37, 0.01)} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0, 0.0125, 0]} />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} />
        <mesh geometry={geo.box()} material={std("#18181b", { roughness: 0.4, metalness: 0.4 })} position={[-0.33, 0.36, 0]} scale={[0.02, 0.7, 0.37]} />
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

        {/* READY badge */}
        <group ref={readyBadge} position={[0, 1.02, 0.1]} visible={false}>
          <mesh geometry={geo.circle(48)} scale={0.16}>
            <meshBasicMaterial map={badge} transparent toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <LabelSprite ref={readyLabel} text="READY TO USE" style="gold" height={0.1} position={[0, -0.24, 0]} />
        </group>
      </group>
    </group>
  );
}
