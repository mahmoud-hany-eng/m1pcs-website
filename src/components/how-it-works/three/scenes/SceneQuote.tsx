"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { globalAt } from "../../story";
import { COLORS, canvasTexture, fonts, geo, roundRect, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, window4 } from "../anim";
import { aimArm, lookAt, place, resetPose, talk, walkBetween } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { checkBadgeTexture, drawIcon } from "../icons2d";
import { BOARD, SPOTS, type Spot } from "../layout";
import { add, blend, clap, nod, think } from "../poses";
import { PART_FLIGHT } from "./SceneParts";

/** Scene 2 beats (scene-local). */
export const QUOTE_BEATS = {
  board: [0.0, 0.1],
  repStep: [0.02, 0.1],
  present: [0.08, 0.14, 0.58, 0.62],
  shipping: 0.52,
  total: 0.57,
  review: [0.62, 0.8],
  nod: [0.79, 0.81, 0.86, 0.88],
  stamp: [0.84, 0.9],
  ok: [0.88, 0.91, 0.97, 1.0],
} as const;

/** Scene 3: the board condenses away as the confirm card takes over. */
export const BOARD_EXIT = [0.02, 0.1] as const;
export const CONFIRM_CARD_POS = new THREE.Vector3(1.0, 1.66, 0.42);

const ROW_NAMES = ["Processor", "Graphics card", "Memory", "Storage", "Motherboard", "Case"];
const REP_PRESENT: Spot = { x: -1.42, z: 0.18, yaw: 0.72 };
const CANVAS_W = 1024;
const CANVAS_H = Math.round((CANVAS_W * BOARD.height) / BOARD.width);

const rowLandAt = (i: number) => PART_FLIGHT.start + i * PART_FLIGHT.stagger + PART_FLIGHT.duration;

function boardTexture() {
  const f = fonts();
  return canvasTexture("quote-board", CANVAS_W, CANVAS_H, (ctx, w, h) => {
    const toY = (y: number) => ((BOARD.height / 2 - y) / BOARD.height) * h;
    const toX = (x: number) => ((x + BOARD.width / 2) / BOARD.width) * w;

    roundRect(ctx, 0, 0, w, h, 34);
    ctx.fillStyle = "#141416";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    // header
    const headerH = (BOARD.headerHeight / BOARD.height) * h;
    ctx.save();
    roundRect(ctx, 0, 0, w, headerH + 34, 34);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, COLORS.red);
    grad.addColorStop(1, COLORS.redDark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, headerH);
    ctx.restore();
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 54px ${f.display}`;
    ctx.fillText("QUOTATION", 48, headerH / 2 + 2);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.gold;
    ctx.font = `700 30px ${f.display}`;
    ctx.fillText("M1 GAMING PCS", w - 48, headerH / 2 + 2);

    // component rows
    ctx.textAlign = "left";
    BOARD.rowY.forEach((y, i) => {
      const cy = toY(y);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(ctx, toX(BOARD.iconX) - 40, cy - 34, 80, 68, 16);
      ctx.fill();
      ctx.fillStyle = COLORS.white;
      ctx.font = `600 38px ${f.sans}`;
      ctx.fillText(ROW_NAMES[i], toX(BOARD.iconX) + 64, cy);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(245,245,247,0.55)";
      ctx.font = `600 34px ${f.sans}`;
      ctx.fillText("QAR  • • • •", w - 48, cy);
      ctx.textAlign = "left";
      if (i < BOARD.rowY.length - 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(BOARD.iconX) + 64, cy + 30);
        ctx.lineTo(w - 48, cy + 30);
        ctx.stroke();
      }
    });

    // divider
    const dy = toY((BOARD.rowY[5] + BOARD.shippingY) / 2);
    ctx.strokeStyle = "rgba(249,194,4,0.35)";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(48, dy);
    ctx.lineTo(w - 48, dy);
    ctx.stroke();
    ctx.setLineDash([]);

    // shipping estimate
    const sy = toY(BOARD.shippingY);
    drawIcon(ctx, "truck", toX(BOARD.iconX), sy, 64, COLORS.gold);
    ctx.fillStyle = COLORS.white;
    ctx.font = `600 38px ${f.sans}`;
    ctx.fillText("Estimated shipping", toX(BOARD.iconX) + 64, sy);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.gold;
    ctx.font = `700 34px ${f.sans}`;
    ctx.fillText("Timeframe included", w - 48, sy);

    // total
    const ty = toY(BOARD.totalY);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.white;
    ctx.font = `700 44px ${f.display}`;
    ctx.fillText("Total", toX(BOARD.iconX) - 36, ty);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.gold;
    ctx.font = `700 40px ${f.display}`;
    ctx.fillText("QAR  • • • • •", w - 48, ty);
  });
}

const tmp = new THREE.Vector3();
const rowPoint = new THREE.Vector3();
const CUSTOMER_HEAD = new THREE.Vector3(SPOTS.customerTable.x, 1.55, SPOTS.customerTable.z);

export function SceneQuote() {
  const world = useWorld();
  const board = useRef<THREE.Group>(null!);
  const highlights = useRef<(THREE.Mesh | null)[]>([]);
  const stamp = useRef<THREE.Mesh>(null!);
  const texture = useMemo(() => boardTexture(), []);
  const badge = useMemo(() => checkBadgeTexture(COLORS.gold), []);
  const rowsY = useMemo(() => [...BOARD.rowY, BOARD.shippingY, BOARD.totalY], []);

  useScene(20, (f: FrameState) => {
    const B = QUOTE_BEATS;
    const s2 = f.local[1];
    const s3 = f.local[2];
    const t = f.time;

    const visible = f.p >= globalAt(1, 0) && f.p <= globalAt(2, BOARD_EXIT[1] + 0.01);
    board.current.visible = visible && s2 > 0;
    if (board.current.visible) {
      const grow = easeOutBack(seg(s2, B.board[0], B.board[1]), 1.4);
      const exit = easeInOutCubic(seg(s3, BOARD_EXIT[0], BOARD_EXIT[1]));
      board.current.scale.set(Math.max(0.0001, lerp(1, 0.2, exit)), Math.max(0.0001, grow * lerp(1, 0.2, exit)), 1);
      board.current.position.lerpVectors(BOARD.position, CONFIRM_CARD_POS, exit);
      board.current.position.y += Math.sin(t * 1.2) * 0.012;
      board.current.rotation.y = lerp(0, -0.45, exit);

      rowsY.forEach((_, i) => {
        const h = highlights.current[i];
        if (!h) return;
        const at = i < 6 ? rowLandAt(i) : i === 6 ? B.shipping : B.total;
        const fill = easeInOutCubic(seg(s2, at - 0.02, at + 0.03));
        const flash = bell(s2, at - 0.01, at + 0.06);
        h.scale.x = Math.max(0.0001, fill * (BOARD.width - 0.14));
        h.position.x = -BOARD.width / 2 + 0.07 + (fill * (BOARD.width - 0.14)) / 2;
        const reviewing = window4(s2, B.review[0], B.review[0] + 0.02, B.review[1], B.review[1] + 0.02);
        const scan = Math.abs(lerp(0, 7, seg(s2, B.review[0], B.review[1])) - i) < 0.7 ? 1 : 0;
        (h.material as THREE.MeshBasicMaterial).opacity = fill * (0.1 + flash * 0.3 + reviewing * scan * 0.18 + (i === 7 ? 0.08 : 0));
        h.visible = fill > 0.001;
      });

      const st = easeOutBack(seg(s2, B.stamp[0], B.stamp[1]), 2.4);
      stamp.current.visible = st > 0.001;
      stamp.current.scale.setScalar(Math.max(0.0001, st) * 0.36);
      stamp.current.rotation.z = (1 - Math.min(1, st)) * 0.9 - 0.18;
    }

    // ---------------- characters
    if (f.active !== 1) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    cust.setVisible(true);

    // Rep steps closer to present the board.
    const step = seg(s2, B.repStep[0], B.repStep[1]);
    walkBetween(rep, SPOTS.repTable, REP_PRESENT, step);
    place(cust, SPOTS.customerTable);

    const boardCentre = tmp.copy(BOARD.position);
    lookAt(rep, boardCentre);
    lookAt(cust, boardCentre);

    // The current row: whichever row lit most recently.
    let row = 0;
    for (let i = 0; i < 6; i++) if (s2 >= rowLandAt(i) - 0.03) row = i;
    if (s2 >= B.shipping - 0.02) row = 6;
    if (s2 >= B.total - 0.02) row = 7;
    rowPoint.set(BOARD.position.x - 0.2, BOARD.position.y + rowsY[row], BOARD.position.z + 0.05);

    // Rep presents, then traces each row as it lights up.
    const present = window4(s2, ...B.present);
    aimArm(rep, "r", rowPoint, present, -0.25);
    lookAt(rep, rowPoint, present * 0.8);
    talk(rep, t, present * 0.8);
    blend(rep.target, { smile: 0.8, brow: 0.3, lArmX: -0.35, lArmZ: 0.35, lElbow: -0.9 }, present);

    // Customer leans in and follows the rows, hand on chin.
    lookAt(cust, rowPoint, present);
    blend(cust.target, { lean: 0.12, smile: 0.55 }, present);
    blend(cust.target, think("l"), window4(s2, 0.3, 0.34, 0.56, 0.6));

    // Review: eyes scan the whole list top to bottom.
    const review = window4(s2, B.review[0], B.review[0] + 0.02, B.review[1], B.review[1] + 0.02);
    const scanY = lerp(BOARD.rowY[0], BOARD.totalY, seg(s2, B.review[0], B.review[1]));
    lookAt(cust, tmp.set(BOARD.position.x, BOARD.position.y + scanY, BOARD.position.z), review);
    blend(cust.target, { lean: 0.16, brow: -0.25, smile: 0.3 }, review);
    lookAt(rep, CUSTOMER_HEAD, review);
    blend(rep.target, { smile: 0.6 }, review);

    // Acknowledge: nods, stamp, then an "OK!" gesture from the customer.
    add(cust.target, nod(t, 1), window4(s2, ...B.nod));
    const ok = window4(s2, ...B.ok);
    blend(cust.target, { lArmX: -1.15, lArmZ: 0.45, lElbow: -1.55, smile: 1, mouthOpen: 0.3, brow: 0.5 }, ok);
    blend(rep.target, clap(t), ok * 0.9);
  });

  return (
    <group ref={board} visible={false} position={BOARD.position}>
      <mesh geometry={geo.roundBox(BOARD.width + 0.04, BOARD.height + 0.04, 0.05, 0.035)} material={std("#0f0f11", { roughness: 0.35, metalness: 0.4 })} />
      <mesh geometry={geo.plane()} position={[0, 0, 0.027]} scale={[BOARD.width, BOARD.height, 1]}>
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {rowsY.map((y, i) => (
        <mesh
          key={i}
          geometry={geo.plane()}
          position={[0, y, 0.03]}
          scale={[0.0001, 0.1, 1]}
          visible={false}
          ref={(el) => {
            highlights.current[i] = el;
          }}
        >
          <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={stamp} geometry={geo.plane()} position={[BOARD.width / 2 - 0.3, BOARD.totalY + 0.08, 0.06]} visible={false}>
        <meshBasicMaterial map={badge} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
