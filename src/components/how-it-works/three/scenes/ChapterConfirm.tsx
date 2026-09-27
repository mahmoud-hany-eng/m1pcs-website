"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, glowTexture, std } from "../assets";
import { bell, easeInOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, angleLerp, consultIdle, lookAt, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { ORDER_ANCHOR, SPOTS, TABLE_TOP_Y } from "../layout";
import { DELIGHTED, HAPPY, PHONE_L, add, blend, nod } from "../poses";
import { Confetti, type ConfettiApi } from "../ui3d";
import { CH } from "../../story";

/**
 * Chapter 3 beats (0..1 of the chapter): the customer pays the deposit on
 * their phone, the payment reaches the M1 terminal, the terminal prints a
 * receipt that the rep slides across the table, the customer reads it, the
 * order is confirmed, and the two shake hands.
 */
export const CONFIRM_BEATS = {
  phone: [0.04, 0.1, 0.36, 0.42],
  payCard: [0.08, 0.14],
  press: [0.19, 0.23],
  paid: 0.22,
  transfer: [0.25, 0.35],
  terminal: [0.32, 0.36, 0.4, 0.44],
  received: 0.38,
  payOut: [0.34, 0.4],
  print: [0.42, 0.5],
  tear: [0.5, 0.53],
  slide: [0.53, 0.59],
  pickUp: [0.59, 0.62],
  read: [0.62, 0.69],
  pocket: [0.7, 0.735],
  order: [0.66, 0.73],
  orderLines: [0.71, 0.735, 0.76],
  burst: 0.69,
  walk: [0.78, 0.86],
  shake: [0.86, 0.93],
  turn: [0.93, 0.975],
} as const;

const TERMINAL = new THREE.Vector3(-0.98, TABLE_TOP_Y, 0.28);
const TERMINAL_YAW = 0.55;
const TERMINAL_TOP = new THREE.Vector3(TERMINAL.x, TERMINAL.y + 0.08, TERMINAL.z);
/** Where the receipt comes out of the terminal (world). */
const SLOT = new THREE.Vector3(0, 0.075, -0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), TERMINAL_YAW).add(TERMINAL);
const SLIDE_FROM = new THREE.Vector3(-0.72, TABLE_TOP_Y + 0.004, 0.36);
const SLIDE_TO = new THREE.Vector3(0.86, TABLE_TOP_Y + 0.004, 0.36);
const HANDSHAKE = new THREE.Vector3(0, 1.02, 1.08);
const CAMERA_SIDE = new THREE.Vector3(0, 1.7, 7);
/** Where the customer holds the phone (in front of their chest) — what the rep glances at. */
const PHONE_POINT = new THREE.Vector3(SPOTS.customer.x - 0.27, 1.2, SPOTS.customer.z + 0.22);
const REP_PATH = [new THREE.Vector2(SPOTS.rep.x, SPOTS.rep.z), new THREE.Vector2(-1.55, 1.0), new THREE.Vector2(SPOTS.repShake.x, SPOTS.repShake.z)];
const CUSTOMER_PATH = [new THREE.Vector2(SPOTS.customer.x, SPOTS.customer.z), new THREE.Vector2(1.55, 1.0), new THREE.Vector2(SPOTS.customerShake.x, SPOTS.customerShake.z)];
const RECEIPT_H = 0.2;
const RECEIPT_TOP = SLOT.clone().setY(SLOT.y + RECEIPT_H * 0.85);

/** Where the receipt lies on the table while it slides across (a pure function of s3). */
function receiptOnTable(s3: number, out: THREE.Vector3) {
  const B = CONFIRM_BEATS;
  return out.lerpVectors(SLIDE_FROM, SLIDE_TO, easeInOutCubic(seg(s3, B.slide[0] + 0.012, B.slide[1])));
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const hand = new THREE.Vector3();
const phonePos = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const eul = new THREE.Euler();

export function ChapterConfirm() {
  const world = useWorld();
  const root = useRef<THREE.Group>(null!);
  const phone = useRef<THREE.Group>(null!);
  const phoneScreen = useRef<THREE.MeshBasicMaterial>(null!);
  const pulse = useRef<THREE.Group>(null!);
  const trail = useRef<(THREE.Mesh | null)[]>([]);
  const terminalScreen = useRef<THREE.MeshBasicMaterial>(null!);
  const receipt = useRef<THREE.Group>(null!);
  const receiptPaper = useRef<THREE.Group>(null!);
  const confetti = useRef<ConfettiApi>(null);

  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);
  const screenOff = useMemo(() => new THREE.Color("#1b1b1f"), []);
  const screenGold = useMemo(() => new THREE.Color(COLORS.gold), []);
  const screenOk = useMemo(() => new THREE.Color("#fff3c4"), []);

  useScene(30, (f: FrameState) => {
    const B = CONFIRM_BEATS;
    const s3 = f.local[CH.confirm];
    const s4 = f.local[CH.source];
    const t = f.clock;
    const A = world.anchors;
    const here = f.active === CH.confirm ? 1 : 0;

    // The M1 terminal stays on the desk through the consultation, and leaves (shrinking away)
    // while the studio is a speck on the globe — the bench is set up differently for the build.
    const away = smooth(seg(s4, 0.3, 0.42));
    root.current.visible = away < 1;
    root.current.scale.setScalar(Math.max(0.0001, 1 - away));

    // ---------------- DOM: deposit card, payment received, receipt, order confirmation (fade + lift, never scaled)
    const pay = A.get("pay");
    const payIn = smooth(seg(s3, B.payCard[0], B.payCard[1]));
    const payOut = smooth(seg(s3, B.payOut[0], B.payOut[1]));
    pay.opacity = payIn * (1 - payOut) * here;
    pay.offsetY = (1 - payIn) * 10;
    pay.align = "above";
    pay.flag("press", s3 >= B.press[0] && s3 < B.press[1]);
    pay.flag("paid", s3 >= B.paid);

    const received = A.get("received");
    received.pos.set(TERMINAL.x, TERMINAL.y + 0.34, TERMINAL.z);
    received.align = "above";
    const rIn = smooth(seg(s3, B.received, B.received + 0.03));
    const rOut = smooth(seg(s3, B.print[1] - 0.02, B.print[1] + 0.02));
    received.opacity = rIn * (1 - rOut) * here;
    received.offsetY = (1 - rIn) * 8;

    const receiptTag = A.get("receipt");
    receiptTag.align = "above";
    const tagIn = smooth(seg(s3, B.read[0], B.read[0] + 0.025));
    receiptTag.opacity = tagIn * (1 - smooth(seg(s3, B.read[1] - 0.01, B.read[1] + 0.02))) * here;
    receiptTag.offsetY = (1 - tagIn) * 8;

    const order = A.get("order");
    order.pos.copy(ORDER_ANCHOR);
    order.align = "center";
    const oIn = smooth(seg(s3, B.order[0], B.order[1]));
    // Stays up through the handshake and is gone before the next chapter's card appears.
    const oOut = smooth(seg(s3, B.turn[0], B.turn[1]));
    order.opacity = oIn * (1 - oOut) * here;
    order.offsetY = (1 - oIn) * 14;
    B.orderLines.forEach((at, i) => order.cssVar(`o${i}`, smooth(seg(s3, at, at + 0.03))));

    // ---------------- terminal screen: idle -> processing -> confirmed
    const busy = window4(s3, B.transfer[1] - 0.02, B.transfer[1], B.received - 0.01, B.received);
    const ok = smooth(seg(s3, B.received - 0.01, B.received + 0.02));
    terminalScreen.current.color.copy(screenOff).lerp(screenGold, busy * (0.65 + 0.35 * Math.sin(t * 9))).lerp(screenOk, ok * 0.85);

    // ---------------- restrained celebration: gold/white flecks
    confetti.current?.set((s3 - B.burst) * 13, s3 > B.burst && s4 < 0.06);

    // ---------------- characters (gestures are windows that are zero at the chapter edges)
    if (f.active !== CH.confirm) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;

    consultIdle(rep, cust, SPOTS.rep, SPOTS.customer);
    lookAt(rep, PHONE_POINT, window4(s3, 0.03, 0.09, B.transfer[0], B.transfer[0] + 0.03));

    // Customer pays the deposit on their phone.
    const phoneUp = window4(s3, ...B.phone);
    blend(cust.target, PHONE_L, phoneUp);
    const pressing = bell(s3, B.press[0] - 0.01, B.press[1]);
    cust.target.lArmX -= pressing * 0.12;
    cust.target.smile = lerp(cust.target.smile, 0.9, smooth(seg(s3, B.paid, B.paid + 0.03)));
    talk(rep, t, window4(s3, 0.06, 0.09, 0.18, 0.21) * 0.7);

    // The payment reaches M1: the rep checks the terminal.
    const watchTransfer = window4(s3, B.transfer[0], B.transfer[0] + 0.02, B.transfer[1], B.transfer[1] + 0.02);
    lookAt(cust, TERMINAL_TOP, watchTransfer * 0.7);
    lookAt(rep, TERMINAL_TOP, Math.max(watchTransfer, window4(s3, ...B.terminal)));
    aimArm(rep, "r", TERMINAL_TOP, window4(s3, ...B.terminal), -0.4);
    rep.target.lean = lerp(rep.target.lean, 0.12, window4(s3, ...B.terminal));
    add(rep.target, nod(t), window4(s3, B.received, B.received + 0.02, B.received + 0.05, B.received + 0.07));
    blend(rep.target, HAPPY, smooth(seg(s3, B.received, B.received + 0.03)));

    // The receipt: printed, torn off, slid across the table, picked up and read.
    // (Aims use the receipt's scripted path — never last frame's position — so the pose is a pure function of scroll.)
    const printing = window4(s3, B.print[0], B.print[0] + 0.02, B.tear[1], B.tear[1] + 0.01);
    lookAt(rep, SLOT, printing);
    const pushEnd = B.slide[0] + (B.slide[1] - B.slide[0]) * 0.4;
    const tearing = window4(s3, B.tear[0] - 0.02, B.tear[0] + 0.005, pushEnd - 0.01, pushEnd + 0.012);
    // Hand target: the top of the printed receipt, then down onto the table and a short push across it.
    receiptOnTable(Math.min(s3, pushEnd), tmp2).setY(TABLE_TOP_Y + 0.05);
    tmp.lerpVectors(RECEIPT_TOP, tmp2, smooth(seg(s3, B.slide[0], B.slide[0] + 0.015)));
    aimArm(rep, "r", tmp, tearing, -0.3);
    lookAt(rep, tmp, tearing);
    rep.target.lean = lerp(rep.target.lean, 0.2, window4(s3, B.tear[1] - 0.012, B.slide[0] + 0.008, pushEnd, pushEnd + 0.012));
    receiptOnTable(s3, tmp);
    lookAt(cust, tmp, window4(s3, B.slide[0], B.slide[0] + 0.02, B.pickUp[1], B.pickUp[1] + 0.01));
    const picking = window4(s3, B.pickUp[0] - 0.015, B.pickUp[0] + 0.005, B.pickUp[1] - 0.005, B.pickUp[1] + 0.01);
    aimArm(cust, "l", tmp.copy(SLIDE_TO).setY(SLIDE_TO.y + 0.03), picking, -0.25);
    cust.target.lean = lerp(cust.target.lean, 0.18, picking);
    const reading = window4(s3, B.pickUp[1] - 0.005, B.read[0], B.read[1], B.pocket[0] + 0.01);
    blend(cust.target, PHONE_L, reading);
    blend(cust.target, HAPPY, smooth(seg(s3, B.read[0], B.read[0] + 0.03)) * 0.9);
    add(cust.target, nod(t), window4(s3, B.read[0] + 0.02, B.read[0] + 0.03, B.read[1] - 0.02, B.read[1]) * 0.7);
    talk(rep, t, window4(s3, B.slide[1], B.slide[1] + 0.01, B.read[1] - 0.01, B.read[1]) * 0.6);

    // Order confirmed: both look up at it.
    const celebrate = window4(s3, B.order[0] + 0.02, B.order[0] + 0.04, B.walk[0], B.walk[0] + 0.02);
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
    const shake = window4(s3, B.shake[0], B.shake[0] + 0.02, B.shake[1] - 0.02, B.shake[1]);
    const pump = Math.sin(seg(s3, B.shake[0] + 0.02, B.shake[1] - 0.02) * Math.PI * 6) * 0.1 * shake;
    aimArm(rep, "r", HANDSHAKE, shake, -0.3);
    aimArm(cust, "r", HANDSHAKE, shake, -0.3);
    rep.target.rArmX += pump;
    cust.target.rArmX += pump;
    tmp.set(SPOTS.customerShake.x, 1.55, SPOTS.customerShake.z);
    lookAt(rep, tmp, shake);
    tmp.set(SPOTS.repShake.x, 1.55, SPOTS.repShake.z);
    lookAt(cust, tmp, shake);
    blend(rep.target, HAPPY, smooth(seg(s3, B.walk[0], B.shake[0] + 0.02)));
    blend(cust.target, HAPPY, smooth(seg(s3, B.walk[0], B.shake[0] + 0.02)));

    // Turn to the camera: ends exactly in the shared front state that chapter 4 starts from.
    const turn = smooth(seg(s3, B.turn[0], B.turn[1]));
    if (turn > 0) {
      rep.place(lerp(SPOTS.repShake.x, SPOTS.repFront.x, turn), lerp(SPOTS.repShake.z, SPOTS.repFront.z, turn), angleLerp(SPOTS.repShake.yaw, SPOTS.repFront.yaw, turn));
      cust.place(
        lerp(SPOTS.customerShake.x, SPOTS.customerFront.x, turn),
        lerp(SPOTS.customerShake.z, SPOTS.customerFront.z, turn),
        angleLerp(SPOTS.customerShake.yaw, SPOTS.customerFront.yaw, turn),
      );
      for (const c of [rep, cust]) {
        c.target.headYaw = lerp(c.target.headYaw, 0, turn);
        c.target.headPitch = lerp(c.target.headPitch, 0, turn);
        lookAt(c, CAMERA_SIDE, 0.8 * turn);
      }
      rep.target.smile = lerp(rep.target.smile, 1, turn);
      rep.target.brow = lerp(rep.target.brow, 0.45, turn);
      cust.target.smile = lerp(cust.target.smile, 1, turn);
      cust.target.brow = lerp(cust.target.brow, 0.45, turn);
    }
  }, (f: FrameState) => {
    // Phone, pay card and receipt follow the hands (after the rig has moved).
    const B = CONFIRM_BEATS;
    const s3 = f.local[CH.confirm];
    const rep = world.rep.current;
    const cust = world.customer.current;
    const active = f.active === CH.confirm && !!rep && !!cust;

    // ---- receipt
    const printed = seg(s3, B.print[0], B.print[1]);
    const pocketed = smooth(seg(s3, B.pocket[0], B.pocket[1]));
    receipt.current.visible = active && printed > 0 && pocketed < 1;
    if (receipt.current.visible && rep && cust) {
      // Printing: the paper grows up out of the slot (width eases in over the first moment, so nothing pops).
      receiptPaper.current.scale.set(Math.max(0.001, smooth(seg(printed, 0, 0.12))), Math.max(0.001, easeInOutCubic(printed)), 1);
      // Poses: standing in the slot → in the rep's hand → flat on the table → sliding → in the customer's hand.
      const tear = easeInOutCubic(seg(s3, B.tear[0], B.tear[1]));
      const down = easeInOutCubic(seg(s3, B.slide[0], B.slide[0] + 0.015));
      const slide = seg(s3, B.slide[0] + 0.012, B.slide[1]);
      const pick = easeInOutCubic(seg(s3, B.pickUp[0], B.pickUp[1]));
      rep.hand("r", hand);
      const p = receipt.current.position;
      p.copy(SLOT);
      qa.setFromEuler(eul.set(0, TERMINAL_YAW, 0));
      if (tear > 0) {
        tmp.copy(hand).setY(hand.y - RECEIPT_H * 0.5);
        p.lerp(tmp, tear);
      }
      if (down > 0) {
        p.lerp(SLIDE_FROM, down);
        qb.setFromEuler(eul.set(-Math.PI / 2, 0.15, 0));
        qa.slerp(qb, down);
      }
      if (slide > 0) receiptOnTable(s3, p);
      if (pick > 0) {
        cust.hand("l", hand);
        tmp.copy(hand).setY(hand.y + 0.02);
        p.lerp(tmp, pick);
        qb.setFromEuler(eul.set(-0.5, cust.root.rotation.y + Math.PI, 0));
        qa.slerp(qb, pick);
      }
      if (s3 >= B.pickUp[1]) {
        cust.hand("l", hand);
        p.copy(hand).setY(hand.y + 0.02);
        qa.setFromEuler(eul.set(-0.5, cust.root.rotation.y + Math.PI, 0));
      }
      receipt.current.quaternion.copy(qa);
      receipt.current.scale.setScalar(Math.max(0.001, 1 - pocketed));
      world.anchors.get("receipt").pos.copy(p).setY(p.y + 0.3);
    }

    // ---- phone + pay card
    if (!active || !cust) {
      phone.current.visible = false;
      pulse.current.visible = false;
      return;
    }
    const up = window4(s3, ...B.phone);
    phone.current.visible = up > 0.001;
    cust.hand("l", hand);
    phonePos.copy(hand);
    phonePos.y += 0.07;
    phone.current.position.copy(phonePos);
    phone.current.rotation.set(-0.35, cust.root.rotation.y + Math.PI * 0.85, 0);
    phone.current.scale.setScalar(Math.max(0.001, smooth(up * 1.6)));
    phoneScreen.current.color.copy(s3 >= B.paid ? screenGold : screenOff).lerp(screenGold, bell(s3, B.press[0], B.press[1] + 0.02));
    const pay = world.anchors.get("pay");
    pay.pos.set(phonePos.x, phonePos.y + 0.18, phonePos.z);

    // Payment pulse: phone -> terminal (placed here, where the hand position is current).
    const travel = seg(s3, B.transfer[0], B.transfer[1]);
    pulse.current.visible = travel > 0 && travel < 1;
    if (pulse.current.visible) {
      const k = easeInOutCubic(travel);
      pulse.current.scale.setScalar(Math.max(0.001, smooth(seg(travel, 0, 0.12)) * (1 - smooth(seg(travel, 0.88, 1)))));
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
  });

  return (
    <group ref={root} name="confirm" visible={false}>
      {/* customer's phone */}
      <group ref={phone} name="phone" visible={false}>
        <mesh geometry={geo.roundBox(0.09, 0.17, 0.014, 0.012)} material={std("#0d0d0f", { roughness: 0.3, metalness: 0.6 })} />
        <mesh geometry={geo.plane()} position={[0, 0, 0.0075]} scale={[0.078, 0.152, 1]}>
          <meshBasicMaterial ref={phoneScreen} color="#1b1b1f" toneMapped={false} />
        </mesh>
      </group>

      {/* payment pulse */}
      <group ref={pulse} name="pulse" visible={false}>
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

      {/* the printed receipt (paper grows up from its bottom edge) */}
      <group ref={receipt} name="receipt" visible={false}>
        <group ref={receiptPaper}>
          <mesh geometry={geo.plane()} position={[0, RECEIPT_H / 2, 0]} scale={[0.1, RECEIPT_H, 0.001]}>
            <meshStandardMaterial color="#f7f5ef" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={geo.plane()} position={[0, RECEIPT_H - 0.025, 0.001]} scale={[0.08, 0.018, 0.001]} material={std(COLORS.red, { roughness: 0.7 })} />
          {[0.14, 0.12, 0.1, 0.08, 0.05].map((y, i) => (
            <mesh key={y} geometry={geo.plane()} position={[i === 4 ? 0.012 : -0.005, y, 0.001]} scale={[i === 4 ? 0.05 : 0.062, 0.006, 0.001]} material={std("#8b8b90", { roughness: 0.8 })} />
          ))}
        </group>
      </group>

      {/* M1 payment terminal */}
      <group position={TERMINAL} rotation={[0, TERMINAL_YAW, 0]}>
        <mesh geometry={geo.roundBox(0.22, 0.07, 0.3, 0.025)} material={std(COLORS.charcoal, { roughness: 0.35, metalness: 0.3 })} position={[0, 0.035, 0]} />
        <mesh geometry={geo.plane()} rotation={[-Math.PI / 2 + 0.25, 0, 0]} position={[0, 0.073, 0.02]} scale={[0.16, 0.13, 1]}>
          <meshBasicMaterial ref={terminalScreen} color="#1b1b1f" toneMapped={false} />
        </mesh>
        <mesh geometry={geo.box()} material={std("#050506")} position={[0, 0.071, -0.1]} scale={[0.12, 0.004, 0.012]} />
        <mesh geometry={geo.box()} material={glow(COLORS.red, 0.7)} position={[0, 0.071, 0.13]} scale={[0.1, 0.004, 0.01]} />
      </group>

      <Confetti ref={confetti} position={[ORDER_ANCHOR.x, ORDER_ANCHOR.y - 0.25, ORDER_ANCHOR.z]} count={46} spread={1.1} power={2.2} palette="gold" />
    </group>
  );
}
