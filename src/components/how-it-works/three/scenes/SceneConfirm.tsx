"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { globalAt } from "../../story";
import { COLORS, canvasTexture, drawCheck, fonts, geo, glow, roundRect, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, lookAt, place, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { checkBadgeTexture } from "../icons2d";
import { SPOTS, TABLE_TOP_Y } from "../layout";
import { add, blend, celebrate, nod, wave } from "../poses";
import { Confetti, LabelSprite, type ConfettiApi } from "../ui3d";
import { CONFIRM_CARD_POS } from "./SceneQuote";

/** Scene 3 beats (scene-local). */
export const CONFIRM_BEATS = {
  card: [0.03, 0.11],
  read: [0.08, 0.1, 0.17, 0.19],
  press: [0.17, 0.2, 0.25, 0.28],
  pressedAt: 0.225,
  cardOut: [0.3, 0.36],
  coinIn: [0.29, 0.33],
  reach: [0.32, 0.36, 0.46, 0.5],
  coinFly: [0.36, 0.45],
  toTerminal: [0.47, 0.53],
  insert: [0.52, 0.56],
  terminal: [0.54, 0.6],
  print: [0.58, 0.66],
  receiptFloat: [0.66, 0.72],
  badge: [0.69, 0.77],
  walkToShake: [0.74, 0.83],
  highFive: [0.83, 0.87, 0.9, 0.92],
  slapAt: 0.87,
  celebrate: [0.91, 0.94, 1.0, 1.01],
} as const;

const CARD_YAW = -0.32;
const TERMINAL = new THREE.Vector3(-0.98, TABLE_TOP_Y + 0.04, 0.27);
const RECEIPT_HOVER = new THREE.Vector3(-0.62, 1.78, 0.5);
const BADGE_POS = new THREE.Vector3(0, 2.28, 0.15);
const HIGH_FIVE = new THREE.Vector3(0, 1.56, 1.22);
const MID_TABLE = new THREE.Vector3(0.05, TABLE_TOP_Y + 0.35, 0.3);

const REP_SHAKE = { x: -0.36, z: 0.98, yaw: 1.3 };
const CUSTOMER_SHAKE = { x: 0.36, z: 0.98, yaw: -1.3 };
const REP_PATH = [new THREE.Vector2(SPOTS.repTable.x, SPOTS.repTable.z), new THREE.Vector2(-1.6, 0.98), new THREE.Vector2(REP_SHAKE.x, REP_SHAKE.z)];
const CUSTOMER_PATH = [new THREE.Vector2(SPOTS.customerTable.x, SPOTS.customerTable.z), new THREE.Vector2(1.6, 0.98), new THREE.Vector2(CUSTOMER_SHAKE.x, CUSTOMER_SHAKE.z)];

function cardTexture() {
  const f = fonts();
  return canvasTexture("confirm-card", 900, 560, (ctx, w, h) => {
    roundRect(ctx, 0, 0, w, h, 40);
    ctx.fillStyle = "#141416";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(249,194,4,0.5)";
    ctx.stroke();
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 64px ${f.display}`;
    ctx.fillText("CONFIRM ORDER", w / 2, 92);
    ctx.font = `500 38px ${f.sans}`;
    ctx.fillStyle = "rgba(245,245,247,0.75)";
    drawCheck(ctx, w / 2 - 215, 180, 34, COLORS.gold, 7);
    ctx.fillText("Quotation approved", w / 2 + 20, 180);
    ctx.fillText("Deposit to confirm", w / 2, 250);
  });
}

function buttonTexture(pressed: boolean) {
  const f = fonts();
  return canvasTexture(`confirm-button|${pressed}`, 512, 128, (ctx, w, h) => {
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.fillStyle = pressed ? COLORS.white : COLORS.gold;
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 56px ${f.display}`;
    if (pressed) {
      drawCheck(ctx, w / 2 - 110, h / 2, 46, "#111111", 10);
      ctx.fillText("PLACED", w / 2 + 30, h / 2 + 3);
    } else {
      ctx.fillText("CONFIRM", w / 2, h / 2 + 3);
    }
  });
}

function receiptTexture() {
  const f = fonts();
  return canvasTexture("receipt", 360, 560, (ctx, w, h) => {
    ctx.fillStyle = "#f7f5f0";
    ctx.fillRect(0, 0, w, h);
    // zig-zag top edge
    ctx.fillStyle = "#0a0a0b";
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 12, 12);
      ctx.lineTo(x + 24, 0);
      ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#111111";
    ctx.font = `800 40px ${f.display}`;
    ctx.fillText("RECEIPT", w / 2, 70);
    ctx.font = `700 22px ${f.display}`;
    ctx.fillStyle = COLORS.red;
    ctx.fillText("M1 GAMING PCS", w / 2, 104);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < 5; i++) {
      roundRect(ctx, 36, 150 + i * 40, w - 72 - (i % 2) * 60, 14, 7);
      ctx.fill();
    }
    ctx.fillStyle = "#111111";
    ctx.font = `700 30px ${f.sans}`;
    ctx.fillText("Deposit received", w / 2, 390);
    ctx.beginPath();
    ctx.arc(w / 2, 462, 44, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.gold;
    ctx.fill();
    drawCheck(ctx, w / 2, 466, 46, "#111111", 10);
  });
}

const tmp = new THREE.Vector3();
const repHand = new THREE.Vector3();
const custHand = new THREE.Vector3();
const buttonPos = new THREE.Vector3();
const lookUp = new THREE.Vector3();

export function SceneConfirm() {
  const world = useWorld();
  const root = useRef<THREE.Group>(null!);
  const card = useRef<THREE.Group>(null!);
  const button = useRef<THREE.Group>(null!);
  const buttonIdle = useRef<THREE.Mesh>(null!);
  const buttonDone = useRef<THREE.Mesh>(null!);
  const coin = useRef<THREE.Group>(null!);
  const coinLabel = useRef<THREE.Sprite>(null!);
  const screen = useRef<THREE.MeshBasicMaterial>(null!);
  const screenCheck = useRef<THREE.Mesh>(null!);
  const receipt = useRef<THREE.Group>(null!);
  const receiptPaper = useRef<THREE.Group>(null!);
  const badge = useRef<THREE.Group>(null!);
  const badgeLabel = useRef<THREE.Sprite>(null!);
  const shock = useRef<THREE.Mesh>(null!);
  const slap = useRef<THREE.Mesh>(null!);
  const confetti = useRef<ConfettiApi>(null);

  const tex = useMemo(
    () => ({
      card: cardTexture(),
      button: buttonTexture(false),
      buttonPressed: buttonTexture(true),
      receipt: receiptTexture(),
      badge: checkBadgeTexture(COLORS.gold),
    }),
    [],
  );

  const screenIdle = useMemo(() => new THREE.Color("#1d1d20"), []);
  const screenBusy = useMemo(() => new THREE.Color(COLORS.gold), []);
  const screenOk = useMemo(() => new THREE.Color("#2a2a2e"), []);

  useScene(30, (f: FrameState) => {
    const B = CONFIRM_BEATS;
    const s3 = f.local[2];
    const s4 = f.local[3];
    const t = f.time;

    root.current.visible = f.p >= globalAt(2, 0) && f.p <= globalAt(3, 0.35);
    if (!root.current.visible) return;

    // ---------------- confirm card + button
    const cardIn = easeOutBack(seg(s3, B.card[0], B.card[1]), 1.5);
    const cardOut = easeInOutCubic(seg(s3, B.cardOut[0], B.cardOut[1]));
    card.current.visible = cardIn > 0.001 && cardOut < 1;
    card.current.scale.setScalar(Math.max(0.0001, cardIn * (1 - cardOut)));
    card.current.position.copy(CONFIRM_CARD_POS);
    card.current.position.y += Math.sin(t * 1.4) * 0.012 + cardOut * 0.25;
    const press = bell(s3, B.pressedAt - 0.015, B.pressedAt + 0.025);
    button.current.position.z = 0.03 - press * 0.022;
    const pressed = s3 >= B.pressedAt;
    buttonIdle.current.visible = !pressed;
    buttonDone.current.visible = pressed;
    buttonPos.set(0, -0.13, 0.05).applyAxisAngle(THREE.Object3D.DEFAULT_UP, CARD_YAW).add(CONFIRM_CARD_POS);

    // ---------------- terminal screen: idle -> processing -> check
    const busy = window4(s3, B.insert[0], B.insert[1], B.terminal[1] - 0.02, B.terminal[1]);
    const ok = seg(s3, B.terminal[1] - 0.02, B.terminal[1]);
    screen.current.color.copy(screenIdle).lerp(screenBusy, busy * (0.6 + 0.4 * Math.sin(t * 14))).lerp(screenOk, ok);
    screenCheck.current.visible = ok > 0;
    screenCheck.current.scale.setScalar(0.085 * easeOutBack(ok));

    // ---------------- receipt prints, then floats up to face the camera
    const print = smooth(seg(s3, B.print[0], B.print[1]));
    const float = easeInOutCubic(seg(s3, B.receiptFloat[0], B.receiptFloat[1]));
    const receiptGone = smooth(seg(s4, 0.05, 0.12));
    receipt.current.visible = print > 0.001 && receiptGone < 1;
    receiptPaper.current.scale.set(1, Math.max(0.0001, print), 1);
    tmp.set(TERMINAL.x, TERMINAL.y + 0.04, TERMINAL.z - 0.05);
    receipt.current.position.lerpVectors(tmp, RECEIPT_HOVER, float);
    receipt.current.position.y += float * Math.sin(t * 1.5) * 0.015;
    receipt.current.rotation.set(lerp(-0.2, 0, float), lerp(0.4, 0.15, float), lerp(0, -0.06, float));
    receipt.current.scale.setScalar(lerp(0.75, 1, float) * (1 - receiptGone));

    // ---------------- ORDER CONFIRMED badge + shockwave + confetti
    const bIn = easeOutBack(seg(s3, B.badge[0], B.badge[1]), 2.2);
    const bOut = smooth(seg(s4, 0.04, 0.12));
    badge.current.visible = bIn > 0.001 && bOut < 1;
    badge.current.scale.setScalar(Math.max(0.0001, bIn * (1 - bOut)));
    badge.current.position.copy(BADGE_POS);
    badge.current.position.y += Math.sin(t * 1.3) * 0.02;
    badge.current.rotation.y = (1 - Math.min(1, bIn)) * Math.PI * 1.5;
    badgeLabel.current.material.opacity = smooth(seg(s3, B.badge[0] + 0.03, B.badge[1])) * (1 - bOut);
    const sw = seg(s3, B.badge[0] + 0.02, B.badge[0] + 0.1);
    shock.current.visible = sw > 0 && sw < 1;
    shock.current.scale.setScalar(0.3 + sw * 1.1);
    (shock.current.material as THREE.MeshBasicMaterial).opacity = (1 - sw) * 0.85;
    // Burst time in "seconds": derived from scroll so it rewinds on the way back up.
    const burst = (s3 - (B.badge[0] + 0.02)) * 14;
    confetti.current?.set(burst, s3 > B.badge[0] + 0.02 && s4 < 0.1);

    const slapK = seg(s3, B.slapAt - 0.005, B.slapAt + 0.05);
    slap.current.visible = slapK > 0 && slapK < 1;
    slap.current.scale.setScalar(0.05 + slapK * 0.5);
    (slap.current.material as THREE.MeshBasicMaterial).opacity = (1 - slapK) * 0.9;

    // ---------------- characters (scene 3, and the wave goodbye in scene 4)
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;

    if (f.active === 3) {
      // The camera cranes up: both look up, wave goodbye to the parts' journey.
      resetPose(rep);
      resetPose(cust);
      place(rep, { ...REP_SHAKE, yaw: 0.35 });
      place(cust, { ...CUSTOMER_SHAKE, yaw: -0.35 });
      const up = window4(s4, 0.0, 0.04, 0.3, 0.34);
      lookUp.set(0, 6, 3.5);
      lookAt(rep, lookUp, up);
      lookAt(cust, lookUp, up);
      blend(rep.target, wave("r", t), up);
      blend(cust.target, wave("l", t + 0.3), up);
      return;
    }
    if (f.active !== 2) return;

    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    cust.setVisible(true);
    place(rep, SPOTS.repTable);
    place(cust, SPOTS.customerTable);
    lookAt(rep, tmp.set(SPOTS.customerTable.x, 1.55, SPOTS.customerTable.z));
    lookAt(cust, tmp.set(SPOTS.repTable.x, 1.55, SPOTS.repTable.z));

    // Customer reads the card, then presses CONFIRM.
    const reading = window4(s3, ...B.read);
    lookAt(cust, CONFIRM_CARD_POS, Math.max(reading, window4(s3, ...B.press)));
    blend(cust.target, { lean: 0.1, brow: -0.2, smile: 0.4 }, reading);
    const pressing = window4(s3, ...B.press);
    aimArm(cust, "l", buttonPos, pressing, -0.05);
    blend(cust.target, { lean: 0.12, smile: 0.8 }, pressing);
    lookAt(rep, CONFIRM_CARD_POS, window4(s3, B.card[0], B.card[1], B.press[3], B.press[3] + 0.02));
    blend(rep.target, { smile: 0.9, brow: 0.4 }, seg(s3, B.pressedAt, B.pressedAt + 0.03) * (1 - seg(s3, 0.3, 0.33)));

    // Deposit hand-over across the table.
    const reach = window4(s3, ...B.reach);
    aimArm(cust, "l", MID_TABLE, reach, -0.2);
    aimArm(rep, "r", MID_TABLE, reach, -0.2);
    lookAt(cust, MID_TABLE, reach);
    lookAt(rep, MID_TABLE, reach);
    blend(cust.target, { lean: 0.14, smile: 0.8 }, reach);
    blend(rep.target, { lean: 0.14, smile: 0.9 }, reach);

    // Rep takes it to the terminal.
    const toTerm = window4(s3, B.toTerminal[0], B.toTerminal[1], B.terminal[1], B.terminal[1] + 0.03);
    aimArm(rep, "r", TERMINAL, toTerm, -0.35);
    lookAt(rep, TERMINAL, toTerm);
    lookAt(cust, TERMINAL, toTerm * 0.8);
    talk(rep, t, window4(s3, B.terminal[0], B.terminal[0] + 0.02, B.print[1], B.print[1] + 0.02) * 0.7);

    // Everyone watches the receipt and the confirmation.
    const watch = window4(s3, B.print[0], B.print[0] + 0.02, B.walkToShake[0], B.walkToShake[0] + 0.02);
    lookAt(cust, RECEIPT_HOVER, watch);
    const badgeLook = window4(s3, B.badge[0], B.badge[0] + 0.02, B.walkToShake[0], B.walkToShake[0] + 0.02);
    lookAt(rep, BADGE_POS, badgeLook);
    lookAt(cust, BADGE_POS, badgeLook);
    blend(cust.target, { smile: 1, mouthOpen: 0.5, brow: 0.7 }, badgeLook);
    blend(rep.target, { smile: 1, brow: 0.5 }, badgeLook);
    add(cust.target, nod(t, 1), badgeLook * 0.6);

    // Walk around the table and high-five.
    const walkT = seg(s3, B.walkToShake[0], B.walkToShake[1]);
    if (walkT > 0) {
      walkPath(rep, REP_PATH, walkT, SPOTS.repTable.yaw, REP_SHAKE.yaw);
      walkPath(cust, CUSTOMER_PATH, walkT, SPOTS.customerTable.yaw, CUSTOMER_SHAKE.yaw);
    }
    const five = window4(s3, ...B.highFive);
    const windUp = 1 - smooth(seg(s3, B.highFive[0], B.slapAt));
    tmp.copy(HIGH_FIVE);
    tmp.y += windUp * 0.35;
    tmp.z += windUp * 0.1;
    aimArm(rep, "r", tmp, five, -0.15);
    aimArm(cust, "l", tmp, five, -0.15);
    lookAt(rep, HIGH_FIVE, five);
    lookAt(cust, HIGH_FIVE, five);
    blend(rep.target, { smile: 1, mouthOpen: 0.4, brow: 0.6 }, five);
    blend(cust.target, { smile: 1, mouthOpen: 0.6, brow: 0.7 }, five);

    const party = window4(s3, ...B.celebrate);
    if (party > 0) {
      place(rep, { ...REP_SHAKE, yaw: lerp(REP_SHAKE.yaw, 0.35, smooth(seg(s3, B.celebrate[0], B.celebrate[1]))) });
      place(cust, { ...CUSTOMER_SHAKE, yaw: lerp(CUSTOMER_SHAKE.yaw, -0.35, smooth(seg(s3, B.celebrate[0], B.celebrate[1]))) });
    }
    blend(rep.target, celebrate(t), party);
    blend(cust.target, celebrate(t + 0.2), party);
  });

  // Coin: held -> thrown -> held by rep -> into the terminal. Runs after
  // characters have moved so it sticks to their hands.
  useScene(
    31,
    () => undefined,
    (f: FrameState) => {
      const B = CONFIRM_BEATS;
      const s3 = f.local[2];
      const rep = world.rep.current;
      const cust = world.customer.current;
      const inScene = f.active === 2 && s3 >= B.coinIn[0] && s3 < B.insert[1];
      coin.current.visible = inScene;
      if (!inScene || !rep || !cust) return;
      rep.hand("r", repHand);
      cust.hand("l", custHand);
      const pop = easeOutBack(seg(s3, B.coinIn[0], B.coinIn[1]), 2);
      const fly = easeInOutCubic(seg(s3, B.coinFly[0], B.coinFly[1]));
      const insert = smooth(seg(s3, B.insert[0], B.insert[1]));
      if (fly <= 0) coin.current.position.copy(custHand);
      else if (fly < 1) {
        coin.current.position.lerpVectors(custHand, repHand, fly);
        coin.current.position.y += Math.sin(Math.PI * fly) * 0.35;
      } else coin.current.position.lerpVectors(repHand, TERMINAL, insert);
      coin.current.position.y += 0.06;
      coin.current.rotation.set(Math.PI / 2 - 0.3, f.time * 3 + fly * Math.PI * 4, 0);
      coin.current.scale.setScalar(Math.max(0.0001, pop * (1 - insert)));
      coinLabel.current.material.opacity = smooth(seg(s3, B.coinIn[1], B.coinIn[1] + 0.02)) * (1 - smooth(seg(s3, B.toTerminal[0], B.toTerminal[1])));
    },
  );

  return (
    <group ref={root} visible={false}>
      {/* confirm card */}
      <group ref={card} rotation={[0, CARD_YAW, 0]} visible={false}>
        <mesh geometry={geo.roundBox(0.92, 0.58, 0.03, 0.03)} material={std("#0f0f11", { roughness: 0.35, metalness: 0.4 })} />
        <mesh geometry={geo.plane()} position={[0, 0.02, 0.017]} scale={[0.9, 0.56, 1]}>
          <meshBasicMaterial map={tex.card} transparent toneMapped={false} />
        </mesh>
        <group ref={button} position={[0, -0.14, 0.03]}>
          <mesh ref={buttonIdle} geometry={geo.plane()} scale={[0.5, 0.125, 1]}>
            <meshBasicMaterial map={tex.button} transparent toneMapped={false} />
          </mesh>
          <mesh ref={buttonDone} geometry={geo.plane()} scale={[0.5, 0.125, 1]} visible={false}>
            <meshBasicMaterial map={tex.buttonPressed} transparent toneMapped={false} />
          </mesh>
        </group>
      </group>

      {/* deposit coin */}
      <group ref={coin} visible={false}>
        <mesh geometry={geo.cylinder(1, 1, 32)} material={std(COLORS.gold, { roughness: 0.22, metalness: 0.9 })} scale={[0.085, 0.022, 0.085]} />
        <mesh geometry={geo.torus(0.07, 0.008)} material={std("#fff1b0", { roughness: 0.2, metalness: 0.9 })} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} />
        <LabelSprite ref={coinLabel} text="DEPOSIT" style="gold" height={0.09} position={[0, 0.2, 0]} onTop />
      </group>

      {/* payment terminal */}
      <group position={TERMINAL} rotation={[0, 0.5, 0]}>
        <mesh geometry={geo.roundBox(0.22, 0.07, 0.3, 0.025)} material={std(COLORS.charcoal, { roughness: 0.35, metalness: 0.3 })} />
        <mesh geometry={geo.plane()} rotation={[-Math.PI / 2 + 0.25, 0, 0]} position={[0, 0.037, -0.03]} scale={[0.16, 0.13, 1]}>
          <meshBasicMaterial ref={screen} color="#1d1d20" toneMapped={false} />
        </mesh>
        <mesh ref={screenCheck} geometry={geo.plane()} rotation={[-Math.PI / 2 + 0.25, 0, 0]} position={[0, 0.039, -0.03]} visible={false}>
          <meshBasicMaterial map={tex.badge} transparent toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, 0.036, 0.11]} scale={[0.1, 0.004, 0.012]} />
      </group>

      {/* receipt */}
      <group ref={receipt} visible={false}>
        <group ref={receiptPaper}>
          <mesh geometry={geo.plane()} position={[0, 0.21, 0]} scale={[0.27, 0.42, 1]}>
            <meshBasicMaterial map={tex.receipt} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>

      {/* ORDER CONFIRMED */}
      <group ref={badge} visible={false}>
        <mesh geometry={geo.circle(48)} scale={0.3}>
          <meshBasicMaterial map={tex.badge} transparent toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <LabelSprite ref={badgeLabel} text="ORDER CONFIRMED" style="gold" height={0.15} position={[0, -0.43, 0]} />
      </group>
      <mesh ref={shock} geometry={geo.ring(0.9, 1)} position={BADGE_POS} visible={false}>
        <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={slap} geometry={geo.ring(0.7, 1)} position={HIGH_FIVE} visible={false}>
        <meshBasicMaterial color={COLORS.white} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Confetti ref={confetti} position={[BADGE_POS.x, BADGE_POS.y - 0.1, BADGE_POS.z]} />
    </group>
  );
}
