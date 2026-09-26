"use client";

import { useRef } from "react";
import * as THREE from "three";
import { easeInOutCubic, easeOutBack, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, angleLerp, lookAt, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { DOOR_X, HOME, HOUSE_FRONT_Z, Home, ROAD_Z, Road, Van, type HomeApi, type VanApi } from "../home";
import { DELIGHTED, HAPPY, HOLD, REACH, add, blend, hop, wave } from "../poses";
import { Confetti, type ConfettiApi } from "../ui3d";
import { CASE_POS, CASE_YAW, setupIdle } from "./ChapterBuild";
import { SPOTS } from "../layout";

/**
 * Chapter 6 — Delivered to Your Door. The rep carries the finished PC to
 * the M1 van, drives across to the customer's home, and hands it over at
 * the front door. Every position is a function of the chapter's scroll
 * progress (s6): the van only moves while you scroll, and scrolling back
 * drives it home in reverse.
 */
export const DELIVER_BEATS = {
  arrive: [0.02, 0.14],
  toPc: [0.02, 0.07],
  lift: [0.07, 0.11],
  toVan: [0.11, 0.19],
  doorsA: [0.15, 0.2, 0.24, 0.27],
  load: [0.19, 0.24],
  toCab: [0.24, 0.31],
  inCab: [0.315, 0.64],
  drive: [0.34, 0.62],
  aroundVan: [0.64, 0.7],
  doorsB: [0.68, 0.72, 0.76, 0.79],
  unload: [0.72, 0.76],
  toDoor: [0.76, 0.83],
  doorOpen: [0.8, 0.85],
  stepOut: [0.84, 0.88],
  give: [0.885, 0.925],
  burst: 0.925,
  final: [0.93, 0.98],
} as const;

/** Waiting out of shot on the bridge, backed up to the studio, and parked past the customer's door. */
const VAN_AWAY = new THREE.Vector3(9.4, 0, ROAD_Z);
const VAN_START = new THREE.Vector3(2.9, 0, ROAD_Z);
const VAN_END = new THREE.Vector3(14.5, 0, ROAD_Z);
/** Van model faces +Z; yaw π/2 drives it east along the road. */
const VAN_YAW = Math.PI / 2;
const WHEEL_R = 0.23;
/** Where the PC rides in the cargo bay (van-local). */
const CARGO_LOCAL = new THREE.Vector3(0, 0.26, -0.45);
const HOLD_LOCAL = new THREE.Vector3(0, 1.02, 0.47);
const PC_HALF_HEIGHT = 0.35;

const Y = (x: number, z: number) => new THREE.Vector2(x, z);
const REP_TO_PC = [Y(SPOTS.repSetup.x, SPOTS.repSetup.z), Y(-1.2, 0.85), Y(-0.28, 0.86)];
const REP_TO_VAN = [Y(-0.28, 0.86), Y(0.6, 1.75), Y(VAN_START.x - 1.7, ROAD_Z)];
const REP_TO_CAB = [Y(VAN_START.x - 1.7, ROAD_Z), Y(VAN_START.x - 1.7, ROAD_Z - 0.9), Y(VAN_START.x + 0.45, ROAD_Z - 0.85)];
const REP_AROUND = [Y(VAN_END.x + 0.45, ROAD_Z - 0.85), Y(VAN_END.x - 1.7, ROAD_Z - 0.9), Y(VAN_END.x - 1.7, ROAD_Z)];
const REP_TO_DOOR = [Y(VAN_END.x - 1.7, ROAD_Z), Y(11.85, 1.6), Y(11.72, 1.02)];
const CUST_INSIDE = Y(DOOR_X, HOUSE_FRONT_Z - 0.55);
const CUST_OUT = [CUST_INSIDE, Y(DOOR_X + 0.05, HOUSE_FRONT_Z + 0.2), Y(12.42, 0.34)];
const REP_AT_DOOR_YAW = Math.atan2(12.42 - 11.72, 0.34 - 1.02);
const CUST_AT_DOOR_YAW = Math.atan2(11.72 - 12.42, 1.02 - 0.34);
const REP_FINAL = { x: 11.5, z: 1.25, yaw: 0.35 };
const CUST_FINAL = { x: 12.5, z: 0.8, yaw: -0.25 };
const CAMERA_SIDE = new THREE.Vector3(12.0, 1.7, 8);
const HANDOVER = new THREE.Vector3(12.07, 1.05, 0.68);

const tmp = new THREE.Vector3();
const hold = new THREE.Vector3();
const cargo = new THREE.Vector3();
const custHold = new THREE.Vector3();
const vanPos = new THREE.Vector3();
const vanQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

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
  const set = useRef<THREE.Group>(null!);
  const home = useRef<THREE.Group>(null!);
  const van = useRef<VanApi>(null);
  const house = useRef<HomeApi>(null);
  const confetti = useRef<ConfettiApi>(null);

  useScene(60, (f: FrameState) => {
    const B = DELIVER_BEATS;
    const s6 = f.local[5];
    const t = f.clock;
    const A = world.anchors;

    // The road and van appear while the studio is a speck on the globe; the home only when needed.
    set.current.visible = f.s > 3.3;
    home.current.visible = f.s > 4.9;
    if (!van.current || !house.current) return;

    // ---------------- van: parked, loaded, driven east, unloaded
    const backIn = easeInOutCubic(seg(s6, B.arrive[0], B.arrive[1]));
    const drive = easeInOutCubic(seg(s6, B.drive[0], B.drive[1]));
    vanPos.lerpVectors(VAN_AWAY, VAN_START, backIn);
    vanPos.x += (VAN_END.x - VAN_START.x) * drive;
    const dist = vanPos.x - VAN_START.x;
    vanPos.y = Math.abs(Math.sin(dist * 5.5)) * 0.008 * window4(s6, B.drive[0], B.drive[0] + 0.02, B.drive[1] - 0.02, B.drive[1]);
    van.current.root.position.copy(vanPos);
    van.current.root.rotation.set(0, VAN_YAW, 0);
    van.current.setRoll(dist / WHEEL_R);
    van.current.setDoors(Math.max(window4(s6, ...B.doorsA), window4(s6, ...B.doorsB)));
    const driving = f.active === 5 && s6 >= B.inCab[0] && s6 < B.inCab[1];
    van.current.setDriver(driving);

    // ---------------- the home: door opens for the delivery
    house.current.setDoor(easeInOutCubic(seg(s6, B.doorOpen[0], B.doorOpen[1])));

    // ---------------- crisp labels
    const onTheWay = A.get("van");
    onTheWay.pos.set(vanPos.x, 1.95, vanPos.z);
    onTheWay.align = "above";
    onTheWay.opacity = window4(s6, B.drive[0] - 0.01, B.drive[0] + 0.03, B.drive[1] - 0.04, B.drive[1]) * (f.active === 5 ? 1 : 0);
    const homeTag = A.get("home");
    homeTag.pos.set(HOME.x - 0.35, 3.35, HOUSE_FRONT_Z - 1.2);
    homeTag.align = "above";
    homeTag.opacity = window4(s6, 0.42, 0.47, B.toDoor[0], B.toDoor[0] + 0.04) * (f.active === 5 ? 1 : 0);
    const delivered = A.get("delivered");
    const dl = easeOutBack(seg(s6, B.final[0] + 0.005, B.final[0] + 0.04), 1.8);
    delivered.opacity = Math.min(1, dl) * (f.active === 5 ? 1 : 0);
    delivered.scale = Math.max(0.001, lerp(0.85, 1, Math.min(1, dl)));
    delivered.align = "above";

    // A short gold burst at the hand-over, fully faded before the final frame.
    confetti.current?.set((s6 - B.burst) * 24, f.active === 5 && s6 > B.burst && s6 < 1);

    // ---------------- characters
    if (f.active !== 5) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    setupIdle(rep);

    // Stop admiring the monitor and head for the finished PC.
    const leaveMonitor = smooth(seg(s6, 0, B.toPc[0] + 0.02));
    rep.target.headYaw = lerp(rep.target.headYaw, 0, leaveMonitor);
    rep.target.headPitch = lerp(rep.target.headPitch, 0, leaveMonitor);
    walkSegments(rep, s6, [
      { path: REP_TO_PC, span: B.toPc, from: SPOTS.repSetup.yaw, to: Math.PI },
      { path: REP_TO_VAN, span: B.toVan, from: Math.PI, to: Math.PI / 2, carrying: true },
      { path: REP_TO_CAB, span: B.toCab, from: Math.PI / 2, to: Math.PI / 2 },
      { path: REP_AROUND, span: B.aroundVan, from: -Math.PI / 2, to: Math.PI / 2 },
      { path: REP_TO_DOOR, span: B.toDoor, from: Math.PI / 2, to: REP_AT_DOOR_YAW, carrying: true },
    ]);
    rep.setVisible(!(s6 >= B.inCab[0] && s6 < B.inCab[1]));
    // Sinks into the cab behind the van before vanishing (and rises out of it at the house).
    rep.target.bob -= 0.6 * (smooth(seg(s6, B.inCab[0] - 0.012, B.inCab[0])) + (1 - smooth(seg(s6, B.inCab[1], B.inCab[1] + 0.012))) * (s6 >= B.inCab[1] ? 1 : 0));

    // Lifting and loading / unloading reach forward; carrying holds the PC at the chest.
    const reach = Math.max(
      window4(s6, B.lift[0] - 0.01, B.lift[0] + 0.015, B.lift[1] - 0.02, B.lift[1]),
      window4(s6, B.load[0] - 0.01, B.load[0] + 0.015, B.load[1] - 0.015, B.load[1] + 0.01),
      window4(s6, B.unload[0] - 0.01, B.unload[0] + 0.015, B.unload[1] - 0.015, B.unload[1] + 0.01),
    );
    const carrying = Math.max(
      window4(s6, B.lift[0] + 0.01, B.lift[1], B.load[0], B.load[1] - 0.01),
      window4(s6, B.unload[0] + 0.01, B.unload[1], B.give[0] + 0.01, B.give[1]),
    );
    blend(rep.target, HOLD, carrying);
    blend(rep.target, REACH, reach * 0.9);
    rep.target.smile = lerp(rep.target.smile, 0.9, smooth(seg(s6, B.lift[1], B.toVan[0] + 0.02)));

    // At the door: greet, then offer the PC.
    tmp.set(DOOR_X, 1.55, HOUSE_FRONT_Z + 0.3);
    lookAt(rep, tmp, window4(s6, B.toDoor[1] - 0.03, B.toDoor[1], B.final[0], B.final[0] + 0.02));
    talk(rep, t, window4(s6, B.stepOut[0], B.stepOut[0] + 0.01, B.give[0], B.give[0] + 0.01) * 0.7);
    const offer = window4(s6, B.give[0] - 0.02, B.give[0] + 0.005, B.give[1] - 0.01, B.give[1] + 0.01);
    aimArm(rep, "l", HANDOVER, offer, -0.5);
    aimArm(rep, "r", HANDOVER, offer, -0.5);

    // The customer opens the door, steps out and receives the PC.
    const doorOpen = seg(s6, B.doorOpen[0], B.doorOpen[1]);
    resetPose(cust);
    cust.setVisible(doorOpen > 0);
    walkPath(cust, CUST_OUT, seg(s6, B.stepOut[0], B.stepOut[1]), 0, CUST_AT_DOOR_YAW);
    cust.target.smile = 0.9;
    blend(cust.target, DELIGHTED, window4(s6, B.stepOut[0], B.stepOut[0] + 0.02, B.give[0], B.give[0] + 0.02));
    blend(cust.target, wave("l", t), window4(s6, B.stepOut[1] - 0.02, B.stepOut[1], B.give[0] - 0.015, B.give[0]));
    tmp.set(11.72, 1.55, 1.02);
    lookAt(cust, tmp, smooth(seg(s6, B.stepOut[0], B.stepOut[1])));
    const receiving = window4(s6, B.give[0] - 0.01, B.give[0] + 0.015, B.give[1] - 0.01, B.give[1] + 0.01);
    aimArm(cust, "l", HANDOVER, receiving, -0.5);
    aimArm(cust, "r", HANDOVER, receiving, -0.5);
    blend(cust.target, HOLD, smooth(seg(s6, B.give[1] - 0.015, B.give[1] + 0.01)));
    lookAt(cust, HANDOVER, window4(s6, B.give[0], B.give[0] + 0.015, B.give[1] - 0.01, B.give[1] + 0.01));

    // Final: both turn towards the camera; the rep waves, the customer is thrilled.
    const fin = smooth(seg(s6, B.final[0], B.final[1]));
    if (fin > 0) {
      const rp = rep.root.position;
      rep.place(lerp(rp.x, REP_FINAL.x, fin), lerp(rp.z, REP_FINAL.z, fin), angleLerp(rep.root.rotation.y, REP_FINAL.yaw, fin));
      const cp = cust.root.position;
      cust.place(lerp(cp.x, CUST_FINAL.x, fin), lerp(cp.z, CUST_FINAL.z, fin), angleLerp(cust.root.rotation.y, CUST_FINAL.yaw, fin));
      for (const c of [rep, cust]) {
        c.target.headYaw = lerp(c.target.headYaw, 0, fin);
        c.target.headPitch = lerp(c.target.headPitch, 0, fin);
        lookAt(c, CAMERA_SIDE, 0.75 * fin);
      }
      blend(rep.target, wave("r", t), fin);
      blend(rep.target, HAPPY, fin);
      blend(cust.target, DELIGHTED, fin);
      add(cust.target, hop(t), window4(s6, B.final[0], B.final[0] + 0.02, B.final[1] - 0.01, B.final[1] + 0.015));
    }
  }, (f: FrameState) => {
    // The finished PC: bench → rep's hands → van → rep's hands → customer's hands.
    const pc = world.props.get("pc");
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!pc || !rep || !cust || f.s < 5 || !van.current) return;
    const B = DELIVER_BEATS;
    const s6 = f.local[5];

    rep.toParent(HOLD_LOCAL, hold);
    hold.y -= PC_HALF_HEIGHT;
    const repYaw = rep.root.rotation.y;
    const vr = van.current.root;
    vanQuat.setFromAxisAngle(UP, vr.rotation.y);
    cargo.copy(CARGO_LOCAL).applyQuaternion(vanQuat).add(vr.position);
    const cargoYaw = vr.rotation.y + Math.PI / 2;

    let yaw = CASE_YAW;
    pc.visible = true;
    if (s6 < B.lift[1]) {
      const k = easeInOutCubic(seg(s6, B.lift[0], B.lift[1]));
      pc.position.lerpVectors(CASE_POS, hold, k);
      pc.position.y += Math.sin(Math.PI * k) * 0.1;
      yaw = angleLerp(CASE_YAW, repYaw, k);
    } else if (s6 < B.load[1]) {
      const k = easeInOutCubic(seg(s6, B.load[0], B.load[1]));
      pc.position.lerpVectors(hold, cargo, k);
      yaw = angleLerp(repYaw, cargoYaw, k);
    } else if (s6 < B.unload[0]) {
      pc.position.copy(cargo);
      yaw = cargoYaw;
      // Doors shut: the PC is out of sight inside the van.
      pc.visible = !(s6 > B.doorsA[3] && s6 < B.doorsB[0]);
    } else if (s6 < B.give[0]) {
      const k = easeInOutCubic(seg(s6, B.unload[0], B.unload[1]));
      pc.position.lerpVectors(cargo, hold, k);
      yaw = angleLerp(cargoYaw, repYaw, k);
    } else {
      cust.toParent(HOLD_LOCAL, custHold);
      custHold.y -= PC_HALF_HEIGHT;
      const k = easeInOutCubic(seg(s6, B.give[0], B.give[1]));
      pc.position.lerpVectors(hold, custHold, k);
      yaw = angleLerp(repYaw, cust.root.rotation.y, k);
    }
    pc.rotation.set(0, yaw, 0);

    const delivered = world.anchors.get("delivered");
    delivered.pos.copy(cust.root.position).add(tmp.set(0.62, 2.12, 0.1));
  });

  return (
    <group ref={set} name="deliverSet" visible={false}>
      <Road />
      <Van ref={van} />
      <group ref={home} name="home" visible={false}>
        <Home ref={house} />
      </group>
      <Confetti ref={confetti} position={[HANDOVER.x, 1.6, HANDOVER.z]} count={34} spread={1.0} power={2.0} palette="gold" />
    </group>
  );
}
