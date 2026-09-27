"use client";

import { useRef } from "react";
import * as THREE from "three";
import { bell, easeInOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, angleLerp, lookAt, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { DOOR_X, HOME, HOUSE_FRONT_Z, Home, ROAD_Z, Road, type HomeApi } from "../home";
import { Car, CAR, SEAT, TRUNK_PC, type CarApi } from "../car";
import { handsOnWheel, seatSequence, type SeatState } from "../carChoreo";
import { DELIGHTED, HAPPY, HOLD, REACH, add, blend, hop, walk, wave } from "../poses";
import { Confetti, type ConfettiApi } from "../ui3d";
import { CASE_POS, CASE_YAW, setupIdle } from "./ChapterBuild";
import { SPOTS } from "../layout";
import { CH } from "../../story";

/**
 * Chapter 7 — Delivered to Your Home. The rep carries the finished PC to the
 * M1 car, loads it into the boot, gets in, drives across to the customer's
 * home, gets out, takes the PC from the boot and hands it over at the front
 * door. Every position is a pure function of the chapter's scroll progress:
 * the car only moves while you scroll, and scrolling back drives it home in
 * reverse. Beats are separated by short holds, so each action reads.
 */
export const DELIVER_BEATS = {
  toPc: [0.035, 0.075],
  lift: [0.075, 0.1],
  toTrunkA: [0.1, 0.18],
  trunkA: [0.17, 0.19, 0.225, 0.25],
  load: [0.19, 0.225],
  toDoorA: [0.25, 0.29],
  doorA: [0.28, 0.305, 0.36, 0.385],
  getIn: [0.305, 0.36],
  drive: [0.4, 0.6],
  doorB: [0.615, 0.64, 0.7, 0.725],
  getOut: [0.64, 0.7],
  toTrunkB: [0.715, 0.755],
  trunkB: [0.745, 0.77, 0.8, 0.82],
  unload: [0.77, 0.8],
  toHouse: [0.81, 0.865],
  houseDoor: [0.845, 0.875],
  stepOut: [0.86, 0.885],
  give: [0.89, 0.925],
  burst: 0.935,
  final: [0.925, 0.968],
} as const;

/** The car faces west (−X) in the lane nearest the homes: its driver's side faces the camera. */
const CAR_YAW = -Math.PI / 2;
const CAR_Z = ROAD_Z - 0.3;
/** Parked at the far end of the studio's bridge — outside even an ultra-wide frame of the studio shots. */
export const CAR_START_X = -10.2;
export const CAR_END_X = HOME.x - 2.2;

/** Car x at chapter progress t (parked, eased drive, parked). */
export function carX(t: number) {
  return lerp(CAR_START_X, CAR_END_X, easeInOutCubic(seg(t, DELIVER_BEATS.drive[0], DELIVER_BEATS.drive[1])));
}

/** Car-local → studio space for a car at x (yaw −π/2: local +Z → −X, local +X → +Z). */
function toWorld(cx: number, local: THREE.Vector3, out: THREE.Vector3) {
  return out.set(cx - local.z, local.y, CAR_Z + local.x);
}

const Y = (x: number, z: number) => new THREE.Vector2(x, z);
const HOLD_LOCAL = new THREE.Vector3(0, 1.02, 0.47);
const PC_HALF_HEIGHT = 0.35;
const BENCH = Y(-0.28, 0.9);
/** Behind the boot, facing the car (west). */
const trunkStand = (cx: number) => Y(cx + CAR.front + 0.42, CAR_Z);
/** Beside the driver's door, facing out (the end of the get-out sequence). */
const doorStand = (cx: number) => {
  const p = toWorld(cx, new THREE.Vector3(SEAT.x + 1.16, 0, SEAT.z + 0.06), new THREE.Vector3());
  return Y(p.x, p.z);
};
const STAND_A = doorStand(CAR_START_X);
const STAND_B = doorStand(CAR_END_X);
const TRUNK_A = trunkStand(CAR_START_X);
const TRUNK_B = trunkStand(CAR_END_X);
const REP_TO_PC = [Y(SPOTS.repSetup.x, SPOTS.repSetup.z), Y(-1.2, 0.95), BENCH];
const REP_TO_TRUNK_A = [BENCH, Y(-2.2, 1.35), Y(TRUNK_A.x + 0.55, CAR_Z + 0.25), TRUNK_A];
const REP_TO_DOOR_A = [TRUNK_A, Y(TRUNK_A.x + 0.1, CAR_Z + 1.55), Y(STAND_A.x + 0.9, STAND_A.y + 0.05), STAND_A];
const REP_TO_TRUNK_B = [STAND_B, Y(STAND_B.x + 1.0, STAND_B.y), Y(TRUNK_B.x + 0.15, CAR_Z + 1.55), TRUNK_B];
// At the door the two face each other across the camera's view (both in three-quarter profile,
// never back-to-lens): the rep arrives from the car's side (west), the customer steps out and turns to them.
const FRONT_DOOR_STAND = Y(DOOR_X - 0.42, HOUSE_FRONT_Z + 0.84);
const CUST_PORCH = Y(DOOR_X + 0.28, HOUSE_FRONT_Z + 0.5);
const REP_AT_DOOR_YAW = Math.atan2(CUST_PORCH.x - FRONT_DOOR_STAND.x, CUST_PORCH.y - FRONT_DOOR_STAND.y);
const CUST_AT_DOOR_YAW = Math.atan2(FRONT_DOOR_STAND.x - CUST_PORCH.x, FRONT_DOOR_STAND.y - CUST_PORCH.y);
const REP_TO_HOUSE = [TRUNK_B, Y(TRUNK_B.x + 0.5, CAR_Z - 1.0), Y(DOOR_X - 0.46, HOUSE_FRONT_Z + 1.4), FRONT_DOOR_STAND];
const CUST_INSIDE = Y(DOOR_X, HOUSE_FRONT_Z - 0.75);
const CUST_OUT = [CUST_INSIDE, Y(DOOR_X + 0.05, HOUSE_FRONT_Z - 0.02), CUST_PORCH];
const HANDOVER = new THREE.Vector3((FRONT_DOOR_STAND.x + CUST_PORCH.x) / 2, 1.05, (FRONT_DOOR_STAND.y + CUST_PORCH.y) / 2);
const REP_FINAL = { x: DOOR_X - 0.5, z: HOUSE_FRONT_Z + 0.98, yaw: 0.28 };
const CUST_FINAL = { x: DOOR_X + 0.34, z: HOUSE_FRONT_Z + 0.62, yaw: -0.14 };
const CAMERA_SIDE = new THREE.Vector3(DOOR_X, 1.7, HOUSE_FRONT_Z + 9);
const STRIDE = 0.95;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const hold = new THREE.Vector3();
const custHold = new THREE.Vector3();
const trunkPos = new THREE.Vector3();
const seat: SeatState = { x: 0, z: 0, yaw: 0, wheel: 0, step: 0 };
const qHold = new THREE.Quaternion();
const qTrunk = new THREE.Quaternion();
const qBench = new THREE.Quaternion();
const qCust = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const qLie = new THREE.Quaternion();

/** Places a walker by the last path segment that has started (later segments win). */
function walkSegments(
  char: Parameters<typeof walkPath>[0],
  s: number,
  legs: readonly { path: readonly THREE.Vector2[]; span: readonly [number, number] | readonly number[]; from: number; to: number; carrying?: boolean }[],
) {
  let active = legs[0];
  for (const leg of legs) if (s >= leg.span[0]) active = leg;
  walkPath(char, active.path, seg(s, active.span[0], active.span[1]), active.from, active.to, active.carrying);
}

export function ChapterDeliver() {
  const world = useWorld();
  const car = useRef<CarApi>(null);
  const house = useRef<HomeApi>(null);
  const confetti = useRef<ConfettiApi>(null);

  useScene(60, (f: FrameState) => {
    const B = DELIVER_BEATS;
    const t = f.local[CH.deliver];
    const clock = f.clock;
    const A = world.anchors;

    // The street, the parked car and the customer's home are always there: the car is off-camera until
    // the walk to it, and the home is far enough down the street that distance fog hides it until the drive.
    const c = car.current;
    if (!c || !house.current) return;

    // ---------------- the car: parked, driven west, parked at the customer's home
    const cx = carX(t);
    const driving = window4(t, B.drive[0], B.drive[0] + 0.03, B.drive[1] - 0.03, B.drive[1]);
    c.root.position.set(cx, 0, CAR_Z);
    c.root.rotation.set(0, CAR_YAW, 0);
    // A barely-there suspension settle while it moves.
    c.root.position.y = Math.abs(Math.sin((CAR_START_X - cx) * 2.2)) * 0.006 * driving;
    c.setRoll((CAR_START_X - cx) / CAR.wheelR);
    c.setDoor(Math.max(window4(t, ...B.doorA), window4(t, ...B.doorB)) * 1);
    c.setTrunk(Math.max(window4(t, ...B.trunkA), window4(t, ...B.trunkB)));

    // ---------------- the home: front door opens for the delivery
    house.current.setDoor(easeInOutCubic(seg(t, B.houseDoor[0], B.houseDoor[1])));

    // ---------------- crisp labels
    const here = f.active === CH.deliver ? 1 : 0;
    const onTheWay = A.get("car");
    onTheWay.pos.set(cx, 2.15, CAR_Z);
    onTheWay.align = "above";
    onTheWay.opacity = window4(t, B.drive[0] + 0.005, B.drive[0] + 0.035, B.drive[1] - 0.04, B.drive[1] - 0.01) * here;
    const homeTag = A.get("home");
    homeTag.pos.set(DOOR_X - 1.2, 5.3, HOUSE_FRONT_Z - 1.6);
    // (the tag hangs above the upper floor)
    homeTag.align = "above";
    homeTag.opacity = window4(t, B.drive[1] - 0.06, B.drive[1] - 0.03, B.toTrunkB[1], B.toTrunkB[1] + 0.03) * here;
    const delivered = A.get("delivered");
    const dl = smooth(seg(t, B.final[0] + 0.005, B.final[0] + 0.03));
    delivered.opacity = dl * here;
    delivered.offsetY = (1 - dl) * 10;
    delivered.align = "above";

    // A short gold burst at the hand-over, fully faded before the final hold.
    confetti.current?.set((t - B.burst) * 30, here === 1 && t > B.burst && t < 1);

    // ---------------- characters
    if (f.active !== CH.deliver) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    setupIdle(rep);

    // Leave the monitor and pick up the finished PC.
    const leaveMonitor = smooth(seg(t, 0, B.toPc[0] + 0.02));
    rep.target.headYaw = lerp(rep.target.headYaw, 0, leaveMonitor);
    rep.target.headPitch = lerp(rep.target.headPitch, 0, leaveMonitor);
    walkSegments(rep, t, [
      { path: REP_TO_PC, span: B.toPc, from: SPOTS.repSetup.yaw, to: Math.PI },
      { path: REP_TO_TRUNK_A, span: B.toTrunkA, from: Math.PI, to: -Math.PI / 2, carrying: true },
      { path: REP_TO_DOOR_A, span: B.toDoorA, from: -Math.PI / 2, to: 0 },
    ]);

    // Into the car (the get-out sequence, run backwards), drive, and out again.
    const inCar = t >= B.getIn[0] && t < B.getOut[1];
    if (inCar) {
      const u = t < B.drive[0] ? 1 - seg(t, B.getIn[0], B.getIn[1]) : seg(t, B.getOut[0], B.getOut[1]);
      seatSequence(u, rep.target, seat);
      toWorld(cx, tmp.set(seat.x, 0, seat.z), tmp);
      rep.place(tmp.x, tmp.z, CAR_YAW + seat.yaw);
      // A step or two away from the car at the end (and a step back to it before sitting).
      add(rep.target, walk((seat.step / STRIDE) * Math.PI * 2), bell(u, 0.86, 1) * 0.8);
      handsOnWheel(rep, (l, o) => toWorld(cx, l, o), seat.wheel, (side, p, w, elbow) => aimArm(rep, side, p, w, elbow));
      // Eyes on the road while driving.
      const eyesOnRoad = window4(t, B.getIn[1], B.drive[0], B.drive[1], B.getOut[0]);
      lookAt(rep, tmp.set(cx - 6, 1.3, CAR_Z), eyesOnRoad * 0.8);
      rep.target.smile = lerp(rep.target.smile, 0.75, eyesOnRoad);
    }

    if (t >= B.getOut[1]) {
      walkSegments(rep, t, [
        { path: REP_TO_TRUNK_B, span: B.toTrunkB, from: 0, to: -Math.PI / 2 },
        { path: REP_TO_HOUSE, span: B.toHouse, from: -Math.PI / 2, to: REP_AT_DOOR_YAW, carrying: true },
      ]);
    }

    // Lifting, loading and unloading reach forward; carrying holds the PC at the chest.
    const reach = Math.max(
      window4(t, B.lift[0] - 0.01, B.lift[0] + 0.01, B.lift[1] - 0.012, B.lift[1]),
      window4(t, B.load[0] - 0.012, B.load[0] + 0.01, B.load[1] - 0.012, B.load[1] + 0.008),
      window4(t, B.unload[0] - 0.012, B.unload[0] + 0.01, B.unload[1] - 0.012, B.unload[1] + 0.008),
    );
    const carrying = Math.max(
      window4(t, B.lift[0] + 0.012, B.lift[1], B.load[0], B.load[1] - 0.012),
      window4(t, B.unload[0] + 0.012, B.unload[1], B.give[0] + 0.012, B.give[1]),
    );
    blend(rep.target, HOLD, carrying);
    blend(rep.target, REACH, reach * 0.9);
    // Bending into the boot.
    rep.target.lean = lerp(rep.target.lean, 0.42, Math.max(window4(t, B.load[0], B.load[0] + 0.012, B.load[1] - 0.01, B.load[1] + 0.008), window4(t, B.unload[0] - 0.008, B.unload[0] + 0.012, B.unload[1] - 0.012, B.unload[1])));
    rep.target.smile = lerp(rep.target.smile, 0.9, smooth(seg(t, B.lift[1], B.toTrunkA[0] + 0.02)));
    // Glances at the boot and door while working.
    lookAt(rep, toWorld(cx, tmp.set(0, 0.8, -2.3), tmp2), Math.max(window4(t, ...B.trunkA), window4(t, ...B.trunkB)) * 0.8);

    // At the front door: greet, then offer the PC.
    tmp.set(CUST_PORCH.x, 1.55, CUST_PORCH.y);
    lookAt(rep, tmp, window4(t, B.toHouse[1] - 0.02, B.toHouse[1], B.final[0], B.final[0] + 0.015));
    talk(rep, clock, window4(t, B.stepOut[0], B.stepOut[0] + 0.01, B.give[0], B.give[0] + 0.01) * 0.7);
    const offer = window4(t, B.give[0] - 0.015, B.give[0] + 0.005, B.give[1] - 0.008, B.give[1] + 0.008);
    aimArm(rep, "l", HANDOVER, offer, -0.5);
    aimArm(rep, "r", HANDOVER, offer, -0.5);

    // The customer opens the door, steps out and receives the PC.
    const doorOpen = seg(t, B.houseDoor[0], B.houseDoor[1]);
    resetPose(cust);
    cust.setVisible(doorOpen > 0);
    walkPath(cust, CUST_OUT, seg(t, B.stepOut[0], B.stepOut[1]), 0, CUST_AT_DOOR_YAW);
    cust.target.smile = 0.9;
    blend(cust.target, DELIGHTED, window4(t, B.stepOut[0], B.stepOut[0] + 0.015, B.give[0], B.give[0] + 0.015));
    blend(cust.target, wave("l", clock), window4(t, B.stepOut[1] - 0.012, B.stepOut[1], B.give[0] - 0.012, B.give[0]));
    tmp.set(FRONT_DOOR_STAND.x, 1.55, FRONT_DOOR_STAND.y);
    lookAt(cust, tmp, smooth(seg(t, B.stepOut[0], B.stepOut[1])));
    const receiving = window4(t, B.give[0] - 0.008, B.give[0] + 0.012, B.give[1] - 0.008, B.give[1] + 0.008);
    aimArm(cust, "l", HANDOVER, receiving, -0.5);
    aimArm(cust, "r", HANDOVER, receiving, -0.5);
    blend(cust.target, HOLD, smooth(seg(t, B.give[1] - 0.012, B.give[1] + 0.008)));
    lookAt(cust, HANDOVER, window4(t, B.give[0], B.give[0] + 0.012, B.give[1] - 0.008, B.give[1] + 0.008));

    // Final: both turn towards the camera; the rep waves, the customer is thrilled.
    const fin = smooth(seg(t, B.final[0], B.final[1]));
    if (fin > 0) {
      const rp = rep.root.position;
      rep.place(lerp(rp.x, REP_FINAL.x, fin), lerp(rp.z, REP_FINAL.z, fin), angleLerp(rep.root.rotation.y, REP_FINAL.yaw, fin));
      const cp = cust.root.position;
      cust.place(lerp(cp.x, CUST_FINAL.x, fin), lerp(cp.z, CUST_FINAL.z, fin), angleLerp(cust.root.rotation.y, CUST_FINAL.yaw, fin));
      for (const ch of [rep, cust]) {
        ch.target.headYaw = lerp(ch.target.headYaw, 0, fin);
        ch.target.headPitch = lerp(ch.target.headPitch, 0, fin);
        lookAt(ch, CAMERA_SIDE, 0.75 * fin);
      }
      blend(rep.target, wave("r", clock), fin);
      blend(rep.target, HAPPY, fin);
      blend(cust.target, DELIGHTED, fin);
      add(cust.target, hop(clock), window4(t, B.final[0], B.final[0] + 0.012, B.final[1] - 0.006, B.final[1] + 0.01));
    }
  }, (f: FrameState) => {
    // The finished PC: bench → hands → boot → (driven) → hands → customer.
    const pc = world.props.get("pc");
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!pc || !rep || !cust || f.s < CH.deliver || !car.current) return;
    const B = DELIVER_BEATS;
    const t = f.local[CH.deliver];
    const cx = carX(t);

    rep.toParent(HOLD_LOCAL, hold);
    hold.y -= PC_HALF_HEIGHT;
    qHold.setFromAxisAngle(UP, rep.root.rotation.y);
    toWorld(cx, TRUNK_PC, trunkPos);
    // Lying in the boot, glass side up, top towards the rear bumper.
    qTrunk.setFromAxisAngle(UP, CAR_YAW).multiply(qLie.setFromAxisAngle(X_AXIS, -Math.PI / 2));
    qBench.setFromAxisAngle(UP, CASE_YAW);

    pc.visible = true;
    if (t < B.lift[1]) {
      const k = easeInOutCubic(seg(t, B.lift[0], B.lift[1]));
      pc.position.lerpVectors(CASE_POS, hold, k);
      pc.position.y += Math.sin(Math.PI * k) * 0.08;
      pc.quaternion.slerpQuaternions(qBench, qHold, k);
    } else if (t < B.load[1]) {
      const k = easeInOutCubic(seg(t, B.load[0], B.load[1]));
      pc.position.lerpVectors(hold, trunkPos, k);
      pc.position.y += Math.sin(Math.PI * k) * 0.12;
      pc.quaternion.slerpQuaternions(qHold, qTrunk, k);
    } else if (t < B.unload[0]) {
      pc.position.copy(trunkPos);
      pc.quaternion.copy(qTrunk);
    } else if (t < B.give[0]) {
      const k = easeInOutCubic(seg(t, B.unload[0], B.unload[1]));
      pc.position.lerpVectors(trunkPos, hold, k);
      pc.position.y += Math.sin(Math.PI * k) * 0.12;
      pc.quaternion.slerpQuaternions(qTrunk, qHold, k);
    } else {
      cust.toParent(HOLD_LOCAL, custHold);
      custHold.y -= PC_HALF_HEIGHT;
      qCust.setFromAxisAngle(UP, cust.root.rotation.y);
      const k = easeInOutCubic(seg(t, B.give[0], B.give[1]));
      pc.position.lerpVectors(hold, custHold, k);
      pc.quaternion.slerpQuaternions(qHold, qCust, k);
    }

    const delivered = world.anchors.get("delivered");
    delivered.pos.copy(cust.root.position).add(tmp.set(0.55, 2.2, 0.1));
  });

  return (
    <group name="deliverSet">
      <group name="road">
        <Road />
      </group>
      <group name="carGroup">
        <Car ref={car} castShadow={world.quality === "high"} />
      </group>
      <group name="home">
        <Home ref={house} />
      </group>
      <Confetti ref={confetti} position={[HANDOVER.x, 1.6, HANDOVER.z]} count={34} spread={1.0} power={2.0} palette="gold" />
    </group>
  );
}
