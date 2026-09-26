"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { globalAt } from "../../story";
import { COLORS, canvasTexture, geo, glow, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, lerp, seg, smooth, window4 } from "../anim";
import { angleLerp, lookAt, place, resetPose, talk, walkPath } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { DELIVER_BEATS, DELIVERY_PATH, HOME, HOME_SPOTS, SPOTS } from "../layout";
import { HOLD, blend, clap, wave } from "../poses";
import { Confetti, LabelSprite, type ConfettiApi } from "../ui3d";

const O = HOME.origin;
const WALL_Z = O.z + HOME.wallZ;
const DOOR_LEFT = O.x - HOME.doorWidth / 2;
const CUSTOMER_PATH = [
  new THREE.Vector2(HOME_SPOTS.customerInside.x, HOME_SPOTS.customerInside.z),
  new THREE.Vector2(HOME_SPOTS.customerDoor.x, HOME_SPOTS.customerDoor.z),
  new THREE.Vector2(HOME_SPOTS.customerHandoff.x, HOME_SPOTS.customerHandoff.z),
];
const DOORBELL = new THREE.Vector3(DOOR_LEFT - 0.18, 1.2, WALL_Z + 0.13);
const STAR_OFFSETS = [
  [-0.5, 2.05, 0.1],
  [0.45, 2.2, 0.0],
  [0.75, 1.75, 0.15],
  [-0.2, 2.35, 0.05],
  [0.15, 1.95, 0.3],
  [-0.7, 1.7, 0.2],
] as const;

function warmTexture() {
  return canvasTexture("warm-doorway", 256, 512, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h * 0.55, h * 0.6);
    g.addColorStop(0, "#fff0c8");
    g.addColorStop(0.45, "#ffc46b");
    g.addColorStop(1, "#b0561d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function spillTexture() {
  return canvasTexture("warm-spill", 256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
    g.addColorStop(0, "rgba(255,196,107,0.55)");
    g.addColorStop(1, "rgba(255,196,107,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function starTexture() {
  return canvasTexture("star", 128, 128, (ctx, w, h) => {
    ctx.translate(w / 2, h / 2);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 58 : 22;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.gold;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 12;
    ctx.fill();
  });
}

const tmp = new THREE.Vector3();

export function SceneDeliver() {
  const world = useWorld();
  const home = useRef<THREE.Group>(null!);
  const door = useRef<THREE.Group>(null!);
  const warm = useRef<THREE.MeshBasicMaterial>(null!);
  const spill = useRef<THREE.MeshBasicMaterial>(null!);
  const porch = useRef<THREE.PointLight>(null!);
  const bellRing = useRef<THREE.Mesh>(null!);
  const stars = useRef<(THREE.Sprite | null)[]>([]);
  const delivered = useRef<THREE.Sprite>(null!);
  const confetti = useRef<ConfettiApi>(null);

  const tex = useMemo(() => ({ warm: warmTexture(), spill: spillTexture(), star: starTexture() }), []);

  useScene(60, (f: FrameState) => {
    const D = DELIVER_BEATS;
    const s6 = f.local[5];
    const t = f.time;

    home.current.visible = f.p >= globalAt(4, 0.5);
    if (!home.current.visible) return;

    // ---------------- door, warm light, doorbell
    const open = easeInOutCubic(seg(s6, D.doorOpen[0], D.doorOpen[1]));
    door.current.rotation.y = open * 1.55;
    warm.current.opacity = open;
    spill.current.opacity = open * 0.9;
    porch.current.intensity = 2 + open * 14;
    const ring = seg(s6, D.doorOpen[0] - 0.05, D.doorOpen[0] + 0.02);
    bellRing.current.visible = ring > 0 && ring < 1;
    bellRing.current.scale.setScalar(0.05 + ring * 0.4);
    (bellRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - ring) * 0.9;

    // ---------------- celebration stars + DELIVERED label + confetti
    stars.current.forEach((s, i) => {
      if (!s) return;
      const a = D.celebrate[0] + i * 0.03;
      const k = bell(s6, a, a + 0.12);
      s.visible = k > 0;
      const cust = HOME_SPOTS.customerHandoff;
      s.position.set(cust.x + STAR_OFFSETS[i][0] * 0.8, STAR_OFFSETS[i][1] + seg(s6, a, a + 0.12) * 0.25, cust.z + STAR_OFFSETS[i][2]);
      s.scale.setScalar(0.16 * k);
      s.material.opacity = k;
      s.material.rotation = t * 1.5 + i;
    });
    const dl = easeOutBack(seg(s6, D.final[0], D.final[1]), 2);
    delivered.current.material.opacity = Math.min(1, dl);
    delivered.current.visible = dl > 0.001;
    const aspect = delivered.current.userData.aspect ?? 4;
    delivered.current.scale.set(0.16 * aspect * Math.max(0.0001, dl), 0.16 * Math.max(0.0001, dl), 1);
    confetti.current?.set((s6 - D.final[0]) * 9, s6 > D.final[0]);

    // ---------------- characters
    if (f.active !== 5) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);

    // Rep carries the PC across to the customer's door.
    const walkT = seg(s6, D.walk[0], D.walk[1]);
    walkPath(rep, DELIVERY_PATH, walkT, SPOTS.repPickup.yaw, HOME_SPOTS.repHandoff.yaw, true);
    const carrying = 1 - smooth(seg(s6, D.handoff[0] + 0.06, D.handoff[1]));
    blend(rep.target, HOLD, carrying);
    blend(rep.target, { smile: 0.8, brow: 0.3 }, 1);
    lookAt(rep, tmp.set(O.x, 1.5, WALL_Z + 0.4), window4(s6, D.walk[1] - 0.04, D.walk[1], D.handoff[0], D.handoff[0] + 0.02));
    talk(rep, t, window4(s6, D.doorOpen[0] - 0.04, D.doorOpen[0], D.customerOut[1], D.customerOut[1] + 0.02));
    // Offer the PC forward during the hand-over.
    blend(rep.target, { lArmX: -1.25, rArmX: -1.25, lElbow: -0.55, rElbow: -0.55, lean: 0.12 }, window4(s6, D.handoff[0] - 0.03, D.handoff[0], D.handoff[1] - 0.04, D.handoff[1]));

    // Customer comes out of the house.
    const visibleCust = s6 >= D.doorOpen[0];
    cust.setVisible(visibleCust);
    const outT = seg(s6, D.customerOut[0], D.customerOut[1]);
    walkPath(cust, CUSTOMER_PATH, outT, 0, HOME_SPOTS.customerHandoff.yaw);
    blend(cust.target, { smile: 1, mouthOpen: 0.55, brow: 0.8 }, window4(s6, D.customerOut[0], D.customerOut[0] + 0.03, D.handoff[0], D.handoff[0] + 0.03));
    blend(cust.target, wave("l", t), window4(s6, D.customerOut[1] - 0.04, D.customerOut[1], D.handoff[0] - 0.02, D.handoff[0]));
    lookAt(cust, tmp.set(HOME_SPOTS.repHandoff.x, 1.5, HOME_SPOTS.repHandoff.z), smooth(seg(s6, D.customerOut[0], D.customerOut[1])));
    lookAt(rep, tmp.set(HOME_SPOTS.customerHandoff.x, 1.5, HOME_SPOTS.customerHandoff.z), smooth(seg(s6, D.customerOut[1] - 0.04, D.customerOut[1])));

    // Hand-over: customer reaches, then holds the PC.
    const receiving = smooth(seg(s6, D.handoff[0] - 0.02, D.handoff[0] + 0.04));
    blend(cust.target, HOLD, receiving);
    blend(cust.target, { lArmX: -1.25, rArmX: -1.25, lElbow: -0.55, rElbow: -0.55, lean: 0.1 }, window4(s6, D.handoff[0] - 0.02, D.handoff[0] + 0.02, D.handoff[1] - 0.05, D.handoff[1]));
    lookAt(cust, tmp.set(O.x - 0.1, 1.05, O.z), window4(s6, D.handoff[0], D.handoff[0] + 0.02, D.handoff[1] - 0.02, D.handoff[1]));

    // Customer celebrates with their new PC; rep claps.
    const party = window4(s6, D.celebrate[0], D.celebrate[0] + 0.03, D.celebrate[1] - 0.03, D.celebrate[1]);
    const hop = Math.abs(Math.sin(t * 7));
    blend(cust.target, { bob: hop * 0.12, squash: (1 - hop) * 0.04, smile: 1, mouthOpen: 0.8, brow: 0.9, headPitch: -0.15 }, party);
    blend(rep.target, clap(t), party);

    // Final shot: both turn to camera; rep waves, customer shows off the PC.
    const fin = smooth(seg(s6, D.final[0], D.final[1]));
    if (fin > 0) {
      const repPos = HOME_SPOTS.repHandoff;
      const cPos = HOME_SPOTS.customerHandoff;
      rep.place(lerp(repPos.x, HOME_SPOTS.repFinal.x, fin), lerp(repPos.z, HOME_SPOTS.repFinal.z, fin), angleLerp(repPos.yaw, HOME_SPOTS.repFinal.yaw, fin));
      cust.place(lerp(cPos.x, HOME_SPOTS.customerFinal.x, fin), lerp(cPos.z, HOME_SPOTS.customerFinal.z, fin), angleLerp(cPos.yaw, HOME_SPOTS.customerFinal.yaw, fin));
      tmp.set(O.x, 1.5, O.z + 6);
      lookAt(rep, tmp, fin);
      lookAt(cust, tmp, fin);
      blend(rep.target, wave("r", t), fin);
      blend(cust.target, { smile: 1, mouthOpen: 0.45, brow: 0.6 }, fin);
    }
    if (!visibleCust) place(cust, HOME_SPOTS.customerInside);
  });

  return (
    <group ref={home} visible={false}>
      {/* platform + a short lit bridge from the studio */}
      <mesh geometry={geo.cylinder(2.95, 3.05, 64)} material={std("#121110", { roughness: 0.85 })} position={[O.x, -0.09, O.z]} scale={[1, 0.18, 1]} receiveShadow />
      <mesh geometry={geo.torus(3.0, 0.02)} material={glow(COLORS.gold)} rotation={[Math.PI / 2, 0, 0]} position={[O.x, 0.005, O.z]} />
      <mesh geometry={geo.box()} material={std("#141416", { roughness: 0.8 })} position={[4.62, -0.02, 0.05]} rotation={[0, -0.35, 0]} scale={[0.9, 0.04, 0.7]} />
      {[-0.22, 0, 0.22].map((o) => (
        <mesh key={o} geometry={geo.box()} material={glow(COLORS.gold, 0.8)} position={[4.62 + o, 0.003, 0.05 + o * 0.36]} rotation={[0, -0.35, 0]} scale={[0.12, 0.006, 0.03]} />
      ))}

      {/* house front */}
      <group>
        <mesh geometry={geo.box()} material={std("#232327", { roughness: 0.75 })} position={[(O.x - 1.8 + DOOR_LEFT) / 2, 1.3, WALL_Z]} scale={[DOOR_LEFT - (O.x - 1.8), 2.6, 0.22]} receiveShadow />
        <mesh geometry={geo.box()} material={std("#232327", { roughness: 0.75 })} position={[(O.x + 1.8 + O.x + HOME.doorWidth / 2) / 2, 1.3, WALL_Z]} scale={[O.x + 1.8 - (O.x + HOME.doorWidth / 2), 2.6, 0.22]} receiveShadow />
        <mesh geometry={geo.box()} material={std("#232327", { roughness: 0.75 })} position={[O.x, (HOME.doorHeight + 2.6) / 2, WALL_Z]} scale={[HOME.doorWidth, 2.6 - HOME.doorHeight, 0.22]} />
        {/* door frame */}
        <mesh geometry={geo.box()} material={std(COLORS.offWhite, { roughness: 0.5 })} position={[O.x, HOME.doorHeight + 0.04, WALL_Z + 0.12]} scale={[HOME.doorWidth + 0.16, 0.08, 0.04]} />
        <mesh geometry={geo.box()} material={std(COLORS.offWhite, { roughness: 0.5 })} position={[DOOR_LEFT - 0.04, HOME.doorHeight / 2, WALL_Z + 0.12]} scale={[0.08, HOME.doorHeight, 0.04]} />
        <mesh geometry={geo.box()} material={std(COLORS.offWhite, { roughness: 0.5 })} position={[O.x + HOME.doorWidth / 2 + 0.04, HOME.doorHeight / 2, WALL_Z + 0.12]} scale={[0.08, HOME.doorHeight, 0.04]} />
        {/* warm interior seen through the doorway */}
        <mesh geometry={geo.plane()} position={[O.x, HOME.doorHeight / 2, WALL_Z - 0.35]} scale={[HOME.doorWidth + 0.3, HOME.doorHeight + 0.2, 1]}>
          <meshBasicMaterial ref={warm} map={tex.warm} transparent opacity={0} toneMapped={false} />
        </mesh>
        <mesh geometry={geo.box()} material={std("#0b0b0c")} position={[O.x, HOME.doorHeight / 2, WALL_Z - 0.4]} scale={[HOME.doorWidth + 0.4, HOME.doorHeight + 0.3, 0.02]} />
        {/* door, hinged on its left edge; opens inwards */}
        <group ref={door} position={[DOOR_LEFT, 0, WALL_Z + 0.05]}>
          <mesh geometry={geo.roundBox(HOME.doorWidth - 0.02, HOME.doorHeight - 0.02, 0.06, 0.015)} material={std(COLORS.red, { roughness: 0.5 })} position={[HOME.doorWidth / 2, HOME.doorHeight / 2, 0]} castShadow />
          <mesh geometry={geo.box()} material={std(COLORS.redDark, { roughness: 0.55 })} position={[HOME.doorWidth / 2, HOME.doorHeight * 0.7, 0.032]} scale={[0.6, 0.62, 0.01]} />
          <mesh geometry={geo.box()} material={std(COLORS.redDark, { roughness: 0.55 })} position={[HOME.doorWidth / 2, HOME.doorHeight * 0.28, 0.032]} scale={[0.6, 0.62, 0.01]} />
          <mesh geometry={geo.capsule(0.018, 0.1)} material={std(COLORS.gold, { roughness: 0.25, metalness: 0.9 })} position={[HOME.doorWidth - 0.12, 1.0, 0.06]} />
        </group>
        {/* window */}
        <group position={[O.x + 1.15, 1.4, WALL_Z + 0.12]}>
          <mesh geometry={geo.box()} material={std(COLORS.offWhite, { roughness: 0.5 })} scale={[0.86, 0.72, 0.04]} />
          <mesh geometry={geo.plane()} position={[0, 0, 0.022]} scale={[0.76, 0.62, 1]}>
            <meshBasicMaterial map={tex.warm} toneMapped={false} />
          </mesh>
          <mesh geometry={geo.box()} material={std(COLORS.offWhite)} position={[0, 0, 0.03]} scale={[0.03, 0.62, 0.02]} />
          <mesh geometry={geo.box()} material={std(COLORS.offWhite)} position={[0, 0, 0.03]} scale={[0.76, 0.03, 0.02]} />
        </group>
        {/* awning roof */}
        <mesh geometry={geo.box()} material={std("#2b1512", { roughness: 0.7 })} position={[O.x, 2.72, WALL_Z + 0.35]} rotation={[0.42, 0, 0]} scale={[3.9, 0.1, 1.0]} castShadow />
        <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[O.x, 2.52, WALL_Z + 0.8]} rotation={[0.42, 0, 0]} scale={[3.9, 0.02, 0.02]} />
        {/* porch lamp + light */}
        <mesh geometry={geo.roundBox(0.12, 0.18, 0.1, 0.02)} material={glow(COLORS.warm)} position={[O.x + 0.72, 2.12, WALL_Z + 0.16]} />
        <pointLight ref={porch} position={[O.x + 0.2, 2.0, WALL_Z + 0.9]} color={COLORS.warm} intensity={2} distance={6} decay={2} />
        {/* doorbell ring */}
        <mesh ref={bellRing} geometry={geo.ring(0.75, 1)} position={DOORBELL} visible={false}>
          <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={geo.circle(16)} material={glow(COLORS.gold)} position={[DOORBELL.x, DOORBELL.y, DOORBELL.z - 0.01]} scale={0.025} />
        {/* doormat + light spill */}
        <mesh geometry={geo.box()} material={std(COLORS.redDark, { roughness: 0.95 })} position={[O.x, 0.008, WALL_Z + 0.45]} scale={[0.95, 0.016, 0.5]} />
        <mesh geometry={geo.plane()} rotation={[-Math.PI / 2, 0, 0]} position={[O.x, 0.02, WALL_Z + 1.2]} scale={[2.2, 2.0, 1]}>
          <meshBasicMaterial ref={spill} map={tex.spill} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* plant */}
        <group position={[O.x - 1.25, 0, WALL_Z + 0.45]}>
          <mesh geometry={geo.cylinder(0.16, 0.12, 20)} material={std(COLORS.charcoal, { roughness: 0.6 })} position={[0, 0.17, 0]} scale={[1, 0.34, 1]} />
          <mesh geometry={geo.sphere("lo")} material={std("#2f5a3a", { roughness: 0.8 })} position={[0, 0.52, 0]} scale={[0.24, 0.3, 0.24]} />
          <mesh geometry={geo.sphere("lo")} material={std("#3a6b46", { roughness: 0.8 })} position={[0.1, 0.72, 0.04]} scale={[0.15, 0.18, 0.15]} />
        </group>
      </group>

      {STAR_OFFSETS.map((_, i) => (
        <sprite
          key={i}
          visible={false}
          ref={(el) => {
            stars.current[i] = el;
          }}
        >
          <spriteMaterial map={tex.star} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
      <LabelSprite
        ref={(el) => {
          delivered.current = el!;
          if (el) {
            const img = el.material.map?.image as HTMLCanvasElement | undefined;
            el.userData.aspect = img ? img.width / img.height : 4;
          }
        }}
        text="DELIVERED"
        style="gold"
        check
        position={[O.x - 0.1, 2.45, O.z + 0.3]}
      />
      <Confetti ref={confetti} position={[O.x - 0.1, 1.9, O.z + 0.2]} count={110} />
    </group>
  );
}
