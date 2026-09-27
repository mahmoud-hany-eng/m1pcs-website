"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo, glow, glowTexture, std } from "../assets";
import { easeInOutCubic, seg, smooth, window4 } from "../anim";
import { frontIdle, lookAt, talk } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { SPOTS } from "../layout";
import { HAPPY, add, blend, nod, wave, type Pose } from "../poses";
import { CH } from "../../story";
import { STUDIO_RESET } from "./ChapterBuild";

/**
 * Chapter 4, in the studio: the rep places the sourcing order with U.S.
 * suppliers on a tablet (the customer watches), the order leaves as a gold
 * signal, and both wave as the camera cranes up to the globe (GlobeWorld
 * takes over from there).
 */
export const SOURCE_STUDIO_BEATS = {
  tablet: [0.02, 0.06, 0.15, 0.19],
  tap: [0.075, 0.1],
  sent: 0.1,
  signal: [0.1, 0.2],
  lookUp: [0.12, 0.15, 0.24, 0.28],
  wave: [0.15, 0.19, 0.26, 0.3],
} as const;

const HOLD_TABLET: Partial<Pose> = { lArmX: -0.72, lArmZ: -0.05, lElbow: -1.0, rArmX: -0.72, rArmZ: 0.05, rElbow: -1.0, headPitch: 0.38, lean: 0.04 };
const hand = new THREE.Vector3();
const hand2 = new THREE.Vector3();
const lookUp = new THREE.Vector3(0, 7, 3);

export function ChapterSource() {
  const world = useWorld();
  const tablet = useRef<THREE.Group>(null!);
  const screen = useRef<THREE.MeshBasicMaterial>(null!);
  const orb = useRef<THREE.Group>(null!);
  const glowTex = useMemo(() => glowTexture(COLORS.gold), []);
  const dim = useMemo(() => new THREE.Color("#1c1a14"), []);
  const lit = useMemo(() => new THREE.Color("#f0c54a"), []);

  useScene(
    35,
    (f: FrameState) => {
      const B = SOURCE_STUDIO_BEATS;
      const t4 = f.local[CH.source];
      const clock = f.clock;
      const here = f.active === CH.source ? 1 : 0;

      // Crisp DOM card above the tablet: "Sourcing order — sent to U.S. suppliers".
      const card = world.anchors.get("sourcing");
      const cardIn = smooth(seg(t4, B.tablet[0] + 0.02, B.tablet[1] + 0.02));
      card.opacity = cardIn * (1 - smooth(seg(t4, B.signal[1] - 0.04, B.signal[1] + 0.01))) * here;
      card.offsetY = (1 - cardIn) * 10;
      card.align = "above";
      card.flag("sent", t4 >= B.sent);

      const rep = world.rep.current;
      const cust = world.customer.current;
      if (!rep || !cust) return;
      // During the flight the two wait in the shared front pose (so their state never depends on
      // the scroll direction) until the build chapter takes over the studio at STUDIO_RESET.
      if (f.active === CH.ship) {
        if (f.s < STUDIO_RESET) frontIdle(rep, cust, SPOTS.repFront, SPOTS.customerFront);
        return;
      }
      if (f.active !== CH.source) return;
      frontIdle(rep, cust, SPOTS.repFront, SPOTS.customerFront);

      // The rep brings up the tablet and places the order; the customer leans in to watch.
      const hold = window4(t4, ...B.tablet);
      blend(rep.target, HOLD_TABLET, hold);
      rep.target.rArmX -= Math.sin(Math.PI * seg(t4, B.tap[0], B.tap[1])) * 0.14 * hold;
      talk(rep, clock, window4(t4, B.tablet[0], B.tablet[1], B.sent, B.sent + 0.02) * 0.6);
      const watch = window4(t4, B.tablet[0] + 0.01, B.tablet[1] + 0.01, B.sent + 0.02, B.signal[0] + 0.03);
      lookAt(cust, hand.set(SPOTS.repFront.x + 0.2, 1.1, SPOTS.repFront.z + 0.35), watch);
      cust.target.lean = cust.target.lean + 0.1 * watch;
      add(cust.target, nod(clock), window4(t4, B.sent, B.sent + 0.01, B.sent + 0.04, B.sent + 0.05) * 0.8);
      blend(rep.target, HAPPY, smooth(seg(t4, B.sent, B.sent + 0.03)));
      blend(cust.target, HAPPY, smooth(seg(t4, B.sent, B.sent + 0.03)));

      // The order leaves: both look up after it, then wave as the camera cranes up.
      const up = window4(t4, ...B.lookUp);
      lookAt(rep, lookUp, up);
      lookAt(cust, lookUp, up);
      const waving = window4(t4, ...B.wave);
      blend(rep.target, wave("r", clock), waving);
      blend(cust.target, wave("l", clock + 0.3), waving);
    },
    (f: FrameState) => {
      const B = SOURCE_STUDIO_BEATS;
      const t4 = f.local[CH.source];
      const rep = world.rep.current;
      const here = f.active === CH.source && !!rep;
      const show = here ? window4(t4, B.tablet[0], B.tablet[1] - 0.02, B.tablet[2] + 0.02, B.tablet[3]) : 0;
      tablet.current.visible = show > 0.001;
      if (tablet.current.visible && rep) {
        rep.hand("l", hand);
        rep.hand("r", hand2);
        tablet.current.position.addVectors(hand, hand2).multiplyScalar(0.5);
        tablet.current.position.y += 0.03;
        tablet.current.rotation.set(-1.0, rep.root.rotation.y, 0, "YXZ");
        tablet.current.scale.setScalar(Math.max(0.001, smooth(show)));
        screen.current.color.copy(dim).lerp(lit, smooth(seg(t4, B.tap[0], B.tap[1])));
        world.anchors.get("sourcing").pos.copy(tablet.current.position).setY(tablet.current.position.y + 0.42);
      }
      // The order rises out of the tablet and away.
      const rise = here ? seg(t4, B.signal[0], B.signal[1]) : 0;
      orb.current.visible = rise > 0 && rise < 1;
      if (orb.current.visible) {
        const k = easeInOutCubic(rise);
        orb.current.position.set(SPOTS.repFront.x + 0.25, 1.25 + k * 4.5, SPOTS.repFront.z + 0.3);
        orb.current.scale.setScalar(Math.max(0.001, smooth(seg(rise, 0, 0.1)) * (1 - smooth(seg(rise, 0.85, 1)))));
      }
    },
  );

  return (
    <group>
      <group ref={tablet} name="tablet" visible={false}>
        <mesh geometry={geo.roundBox(0.28, 0.19, 0.014, 0.014)} material={std("#101013", { roughness: 0.3, metalness: 0.5 })} />
        <mesh geometry={geo.plane()} position={[0, 0, 0.0075]} scale={[0.25, 0.16, 1]}>
          <meshBasicMaterial ref={screen} color="#1c1a14" toneMapped={false} />
        </mesh>
      </group>
      <group ref={orb} name="orderOrb" visible={false}>
        <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} scale={0.05} />
        <sprite scale={[0.6, 0.6, 1]}>
          <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      </group>
    </group>
  );
}
