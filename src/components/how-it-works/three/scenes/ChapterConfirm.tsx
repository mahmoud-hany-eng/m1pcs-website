"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, glowTexture, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, angleLerp, converse, lookAt, place, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { ORDER_ANCHOR, SPOTS, TABLE_TOP_Y } from "../layout";
import { DELIGHTED, HAPPY, PHONE_L, add, blend, nod, wave } from "../poses";
import { Confetti, type ConfettiApi } from "../ui3d";

/** Chapter 3 beats (0..1 of the chapter). */
export const CONFIRM_BEATS = {
  phone: [0.03, 0.09, 0.4, 0.46],
  payCard: [0.08, 0.14],
  press: [0.2, 0.24],
  paid: 0.235,
  transfer: [0.26, 0.38],
  terminal: [0.35, 0.39, 0.43, 0.47],
  received: 0.42,
  payOut: [0.37, 0.43],
  order: [0.48, 0.56],
  orderLines: [0.54, 0.58, 0.62],
  burst: 0.5,
  walk: [0.62, 0.74],
  shake: [0.74, 0.86],
  turn: [0.86, 0.94],
  settle: [0.94, 1.0],
} as const;

const TERMINAL = new THREE.Vector3(-0.98, TABLE_TOP_Y, 0.28);
const TERMINAL_TOP = new THREE.Vector3(TERMINAL.x, TERMINAL.y + 0.08, TERMINAL.z);
const HANDSHAKE = new THREE.Vector3(0, 1.02, 1.08);
const CAMERA_SIDE = new THREE.Vector3(0, 1.7, 7);
const REP_HEAD = new THREE.Vector3(SPOTS.rep.x, 1.55, SPOTS.rep.z);
const REP_PATH = [new THREE.Vector2(SPOTS.rep.x, SPOTS.rep.z), new THREE.Vector2(-1.55, 1.0), new THREE.Vector2(SPOTS.repShake.x, SPOTS.repShake.z)];
const CUSTOMER_PATH = [new THREE.Vector2(SPOTS.customer.x, SPOTS.customer.z), new THREE.Vector2(1.55, 1.0), new THREE.Vector2(SPOTS.customerShake.x, SPOTS.customerShake.z)];

const tmp = new THREE.Vector3();
const hand = new THREE.Vector3();
const phonePos = new THREE.Vector3();
const lookUp = new THREE.Vector3();

export function ChapterConfirm() {
  const world = useWorld();
  const root = useRef<THREE.Group>(null!);
  const phone = useRef<THREE.Group>(null!);
  const phoneScreen = useRef<THREE.MeshBasicMaterial>(null!);
  const pulse = useRef<THREE.Group>(null!);
  const trail = useRef<(THREE.Mesh | null)[]>([]);
  const terminalScreen = useRef<THREE.MeshBasicMaterial>(null!);
  const confetti = useRef<ConfettiApi>(null);

  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);
  const screenOff = useMemo(() => new THREE.Color("#1b1b1f"), []);
  const screenGold = useMemo(() => new THREE.Color(COLORS.gold), []);
  const screenOk = useMemo(() => new THREE.Color("#fff3c4"), []);

  useScene(30, (f: FrameState) => {
    const B = CONFIRM_BEATS;
    const s3 = f.local[2];
    const s4 = f.local[3];
    const t = f.time;
    const A = world.anchors;

    root.current.visible = f.s > 2 && f.s < 3.35;

    // ---------------- DOM: payment card, received chip, order confirmation
    const pay = A.get("pay");
    const payIn = easeOutBack(seg(s3, B.payCard[0], B.payCard[1]), 1.5);
    const payOut = smooth(seg(s3, B.payOut[0], B.payOut[1]));
    pay.opacity = Math.min(1, payIn) * (1 - payOut) * (f.active === 2 ? 1 : 0);
    pay.scale = Math.max(0.001, lerp(0.85, 1, Math.min(1, payIn)));
    pay.align = "above";
    pay.flag("press", s3 >= B.press[0] && s3 < B.press[1]);
    pay.flag("paid", s3 >= B.paid);

    const received = A.get("received");
    received.pos.set(TERMINAL.x, TERMINAL.y + 0.34, TERMINAL.z);
    received.align = "above";
    const rIn = easeOutBack(seg(s3, B.received, B.received + 0.04), 1.8);
    // Narrow screens: clear it before the order card takes the centre.
    const rOut = f.layout === "tall" ? smooth(seg(s3, B.order[0] - 0.02, B.order[0] + 0.02)) : smooth(seg(s3, 0.6, 0.66));
    received.opacity = Math.min(1, rIn) * (1 - rOut) * (f.active === 2 ? 1 : 0);
    received.scale = Math.max(0.001, lerp(0.8, 1, Math.min(1, rIn)));

    const order = A.get("order");
    order.pos.copy(ORDER_ANCHOR);
    order.align = "center";
    const oIn = easeOutBack(seg(s3, B.order[0], B.order[1]), 1.4);
    const oOut = smooth(seg(s4, 0.02, 0.1));
    order.opacity = Math.min(1, oIn) * (1 - oOut) * (f.s < 3.2 ? 1 : 0);
    order.scale = Math.max(0.001, lerp(0.88, 1, Math.min(1, oIn)));
    B.orderLines.forEach((at, i) => order.cssVar(`o${i}`, smooth(seg(s3, at, at + 0.035))));

    // ---------------- terminal screen: idle -> processing -> confirmed
    const busy = window4(s3, B.transfer[1] - 0.02, B.transfer[1], B.received - 0.01, B.received);
    const ok = smooth(seg(s3, B.received - 0.01, B.received + 0.02));
    terminalScreen.current.color.copy(screenOff).lerp(screenGold, busy * (0.65 + 0.35 * Math.sin(t * 14))).lerp(screenOk, ok * 0.85);

    // ---------------- payment pulse: phone -> terminal
    const travel = seg(s3, B.transfer[0], B.transfer[1]);
    pulse.current.visible = travel > 0 && travel < 1;
    if (pulse.current.visible) {
      const k = easeInOutCubic(travel);
      pulse.current.position.lerpVectors(phonePos, TERMINAL_TOP, k);
      pulse.current.position.y += Math.sin(Math.PI * k) * 0.45;
      trail.current.forEach((m, i) => {
        if (!m) return;
        const kk = Math.max(0, k - (i + 1) * 0.045);
        m.position.lerpVectors(phonePos, TERMINAL_TOP, kk).sub(pulse.current.position);
        m.position.y += Math.sin(Math.PI * kk) * 0.45;
        m.scale.setScalar(0.028 * (1 - i / 6));
      });
    }

    // ---------------- restrained celebration: gold/white flecks
    confetti.current?.set((s3 - B.burst) * 13, s3 > B.burst && s4 < 0.08);

    // ---------------- characters
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;

    if (f.active === 3) {
      // The camera cranes up to follow the order: both look up and wave it off.
      resetPose(rep);
      resetPose(cust);
      place(rep, SPOTS.repFront);
      place(cust, SPOTS.customerFront);
      const up = window4(s4, 0.0, 0.03, 0.12, 0.16);
      lookUp.set(0, 7, 3);
      lookAt(rep, lookUp, up);
      lookAt(cust, lookUp, up);
      blend(rep.target, wave("r", t), up);
      blend(cust.target, wave("l", t + 0.3), up);
      blend(rep.target, HAPPY, 1);
      blend(cust.target, HAPPY, 1);
      return;
    }
    if (f.active !== 2) return;

    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    cust.setVisible(true);
    place(rep, SPOTS.rep);
    place(cust, SPOTS.customer);
    lookAt(rep, phonePos);
    lookAt(cust, REP_HEAD);

    // Customer pays the deposit on their phone.
    const phoneUp = window4(s3, ...B.phone);
    blend(cust.target, PHONE_L, phoneUp);
    const pressing = bell(s3, B.press[0] - 0.01, B.press[1]);
    cust.target.lArmX -= pressing * 0.12;
    cust.target.smile = lerp(cust.target.smile, 0.9, smooth(seg(s3, B.paid, B.paid + 0.03)));
    talk(rep, t, window4(s3, 0.05, 0.08, 0.18, 0.21) * 0.7);

    // The payment reaches M1: rep checks the terminal.
    const watchTransfer = window4(s3, B.transfer[0], B.transfer[0] + 0.02, B.transfer[1], B.transfer[1] + 0.02);
    lookAt(cust, TERMINAL_TOP, watchTransfer * 0.7);
    lookAt(rep, TERMINAL_TOP, Math.max(watchTransfer, window4(s3, ...B.terminal)));
    aimArm(rep, "r", TERMINAL_TOP, window4(s3, ...B.terminal), -0.4);
    rep.target.lean = lerp(rep.target.lean, 0.12, window4(s3, ...B.terminal));
    add(rep.target, nod(t), window4(s3, B.received, B.received + 0.02, B.received + 0.06, B.received + 0.08));
    blend(rep.target, HAPPY, smooth(seg(s3, B.received, B.received + 0.03)));

    // Order confirmed: both look up at it.
    const celebrate = window4(s3, B.order[0], B.order[0] + 0.02, B.walk[0], B.walk[0] + 0.02);
    lookAt(rep, ORDER_ANCHOR, celebrate);
    lookAt(cust, ORDER_ANCHOR, celebrate);
    blend(cust.target, DELIGHTED, celebrate);
    blend(rep.target, HAPPY, celebrate);

    // Walk round to the front of the table and shake hands.
    const walkT = seg(s3, B.walk[0], B.walk[1]);
    if (walkT > 0) {
      walkPath(rep, REP_PATH, walkT, SPOTS.rep.yaw, SPOTS.repShake.yaw);
      walkPath(cust, CUSTOMER_PATH, walkT, SPOTS.customer.yaw, SPOTS.customerShake.yaw);
    }
    const shake = window4(s3, B.shake[0], B.shake[0] + 0.025, B.shake[1] - 0.02, B.shake[1]);
    const pump = Math.sin(seg(s3, B.shake[0] + 0.02, B.shake[1] - 0.02) * Math.PI * 6) * 0.1 * shake;
    aimArm(rep, "r", HANDSHAKE, shake, -0.3);
    aimArm(cust, "r", HANDSHAKE, shake, -0.3);
    rep.target.rArmX += pump;
    cust.target.rArmX += pump;
    tmp.set(SPOTS.customerShake.x, 1.55, SPOTS.customerShake.z);
    lookAt(rep, tmp, shake);
    tmp.set(SPOTS.repShake.x, 1.55, SPOTS.repShake.z);
    lookAt(cust, tmp, shake);
    blend(rep.target, HAPPY, shake);
    blend(cust.target, HAPPY, shake);

    // Turn to the camera, pleased.
    const turn = smooth(seg(s3, B.turn[0], B.turn[1]));
    if (turn > 0) {
      rep.place(lerp(SPOTS.repShake.x, SPOTS.repFront.x, turn), lerp(SPOTS.repShake.z, SPOTS.repFront.z, turn), angleLerp(SPOTS.repShake.yaw, SPOTS.repFront.yaw, turn));
      cust.place(
        lerp(SPOTS.customerShake.x, SPOTS.customerFront.x, turn),
        lerp(SPOTS.customerShake.z, SPOTS.customerFront.z, turn),
        angleLerp(SPOTS.customerShake.yaw, SPOTS.customerFront.yaw, turn),
      );
      lookAt(rep, CAMERA_SIDE, turn * 0.8);
      lookAt(cust, CAMERA_SIDE, turn * 0.8);
      blend(rep.target, HAPPY, turn);
      blend(cust.target, HAPPY, turn);
    }
    converse(rep, "r", cust, "l", t, smooth(seg(s3, B.settle[0], B.settle[1])) * 0.45);
  }, (f: FrameState) => {
    // Phone + pay card follow the customer's hand (after the rig has moved).
    const cust = world.customer.current;
    if (!cust || f.active !== 2) {
      phone.current.visible = false;
      return;
    }
    const s3 = f.local[2];
    const up = window4(s3, ...CONFIRM_BEATS.phone);
    phone.current.visible = up > 0.05;
    cust.hand("l", hand);
    phonePos.copy(hand);
    phonePos.y += 0.07;
    phone.current.position.copy(phonePos);
    phone.current.rotation.set(-0.35, cust.root.rotation.y + Math.PI * 0.85, 0);
    phone.current.scale.setScalar(Math.max(0.001, smooth(up * 1.6)));
    phoneScreen.current.color.copy(s3 >= CONFIRM_BEATS.paid ? screenGold : screenOff).lerp(screenGold, bell(s3, CONFIRM_BEATS.press[0], CONFIRM_BEATS.press[1] + 0.02));
    const pay = world.anchors.get("pay");
    pay.pos.set(phonePos.x, phonePos.y + 0.18, phonePos.z);
  });

  return (
    <group ref={root} visible={false}>
      {/* customer's phone */}
      <group ref={phone} visible={false}>
        <mesh geometry={geo.roundBox(0.09, 0.17, 0.014, 0.012)} material={std("#0d0d0f", { roughness: 0.3, metalness: 0.6 })} />
        <mesh geometry={geo.plane()} position={[0, 0, 0.0075]} scale={[0.078, 0.152, 1]}>
          <meshBasicMaterial ref={phoneScreen} color="#1b1b1f" toneMapped={false} />
        </mesh>
      </group>

      {/* payment pulse */}
      <group ref={pulse} visible={false}>
        <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} scale={0.045} />
        <sprite scale={[0.5, 0.5, 1]}>
          <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={i}
            geometry={geo.sphere("lo")}
            material={glow(COLORS.gold, 0.8 - i * 0.1)}
            ref={(el) => {
              trail.current[i] = el;
            }}
          />
        ))}
      </group>

      {/* M1 payment terminal */}
      <group position={TERMINAL} rotation={[0, 0.55, 0]}>
        <mesh geometry={geo.roundBox(0.22, 0.07, 0.3, 0.025)} material={std(COLORS.charcoal, { roughness: 0.35, metalness: 0.3 })} position={[0, 0.035, 0]} />
        <mesh geometry={geo.plane()} rotation={[-Math.PI / 2 + 0.25, 0, 0]} position={[0, 0.073, -0.03]} scale={[0.16, 0.13, 1]}>
          <meshBasicMaterial ref={terminalScreen} color="#1b1b1f" toneMapped={false} />
        </mesh>
        <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, 0.071, 0.11]} scale={[0.1, 0.004, 0.012]} />
      </group>

      <Confetti ref={confetti} position={[ORDER_ANCHOR.x, ORDER_ANCHOR.y - 0.25, ORDER_ANCHOR.z]} count={46} spread={1.1} power={2.2} palette="gold" />
    </group>
  );
}
