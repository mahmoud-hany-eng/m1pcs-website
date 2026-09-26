"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { globalAt } from "../../story";
import { COLORS, geo, glow, glowTexture } from "../assets";
import { bell, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, lookAt, place, resetPose, talk } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { chipTexture, type IconName } from "../icons2d";
import { BOARD, PART_IDS, PART_LABELS, PART_SLOTS, SPOTS, type PartId } from "../layout";
import { PART_MODELS } from "../parts";
import { add, blend, clap, nod, think, wave } from "../poses";
import { LabelSprite, TextureSprite } from "../ui3d";

/** Scene 1 beats (scene-local time 0..1). */
export const PARTS_BEATS = {
  repWave: [0.0, 0.03, 0.09, 0.13],
  customerWave: [0.02, 0.05, 0.11, 0.15],
  talk: [0.07, 0.1, 0.25, 0.28],
  chips: [0.08, 0.12, 0.16, 0.2],
  chipsMerge: [0.25, 0.31],
  repNod: [0.29, 0.36],
  appear: [0.34, 0.41, 0.48, 0.55, 0.62, 0.69],
  appearDuration: 0.07,
  compare: [0.73, 0.76, 0.82, 0.85],
  choose: [0.84, 0.862, 0.884, 0.906, 0.928, 0.95],
  cheer: [0.94, 0.96, 0.99, 1.0],
} as const;

/** Scene 2: parts fly off the table into the quotation board rows. */
export const PART_FLIGHT = { start: 0.1, stagger: 0.05, duration: 0.13 } as const;

const DISPLAY_SCALE: Record<PartId, number> = { cpu: 1.2, gpu: 0.95, ram: 1.02, ssd: 1.35, board: 0.84, case: 1.05 };

const CHIPS: { icon: IconName; caption: string }[] = [
  { icon: "wallet", caption: "BUDGET" },
  { icon: "gamepad", caption: "GAMES" },
  { icon: "palette", caption: "DESIGN" },
  { icon: "bolt", caption: "PERFORMANCE" },
];

const ORB = new THREE.Vector3(0, 1.38, 0.18);
const CUSTOMER_HEAD = new THREE.Vector3(SPOTS.customerTable.x, 1.55, SPOTS.customerTable.z);
const REP_HEAD = new THREE.Vector3(SPOTS.repTable.x, 1.55, SPOTS.repTable.z);

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export function SceneParts() {
  const world = useWorld();
  const root = useRef<THREE.Group>(null!);
  const parts = useRef<(THREE.Group | null)[]>([]);
  const models = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(THREE.Sprite | null)[]>([]);
  const chosenLabels = useRef<(THREE.Sprite | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const sparks = useRef<(THREE.Mesh | null)[]>([]);
  const chips = useRef<(THREE.Sprite | null)[]>([]);
  const orb = useRef<THREE.Group>(null!);
  const orbGlow = useRef<THREE.Sprite>(null!);

  const chipTextures = useMemo(() => CHIPS.map((c) => chipTexture(c.icon, c.caption)), []);
  const orbTexture = useMemo(() => glowTexture(COLORS.gold), []);
  const hoverTargets = useMemo(
    () => CHIPS.map((_, j) => new THREE.Vector3(-0.66 + j * 0.44, 2.02 + (j % 2) * 0.09, 0.4)),
    [],
  );

  useScene(10, (f: FrameState) => {
    const B = PARTS_BEATS;
    const s1 = f.local[0];
    const s2 = f.local[1];
    const s3 = f.local[2];
    const t = f.time;

    root.current.visible = f.p <= globalAt(2, 0.14);
    if (!root.current.visible) return;

    // ---------------- requirement chips: customer -> hover -> merge into the orb
    chips.current.forEach((chip, j) => {
      if (!chip) return;
      const popIn = easeOutBack(seg(s1, B.chips[j], B.chips[j] + 0.05));
      const merge = easeInOutCubic(seg(s1, B.chipsMerge[0] + j * 0.012, B.chipsMerge[1]));
      tmp.lerpVectors(CUSTOMER_HEAD, hoverTargets[j], easeOutCubic(seg(s1, B.chips[j], B.chips[j] + 0.06)));
      tmp.y += Math.sin(t * 1.8 + j) * 0.03;
      tmp2.lerpVectors(tmp, ORB, merge);
      chip.position.copy(tmp2);
      const size = 0.5 * Math.max(0, popIn) * (1 - merge * 0.85);
      chip.scale.set(size * (320 / 360), size, 1);
      chip.material.opacity = Math.min(1, popIn) * (1 - smooth(seg(merge, 0.7, 1)));
      chip.visible = popIn > 0.001 && merge < 1;
    });

    // ---------------- the orb that "turns requirements into parts"
    const orbOn = window4(s1, B.chipsMerge[1] - 0.03, B.chipsMerge[1], B.appear[5] + 0.03, B.appear[5] + 0.08);
    const lastEmerge = B.appear.reduce((acc, a) => (s1 >= a ? a : acc), -1);
    const kick = lastEmerge >= 0 ? bell(s1, lastEmerge, lastEmerge + 0.05) : 0;
    orb.current.visible = orbOn > 0.001;
    orb.current.scale.setScalar(Math.max(0.0001, orbOn * (0.055 + 0.012 * Math.sin(t * 5) + kick * 0.035)));
    orbGlow.current.material.opacity = orbOn * (0.35 + kick * 0.3);

    // ---------------- parts
    PART_IDS.forEach((id, i) => {
      const g = parts.current[i];
      const model = models.current[i];
      if (!g || !model) return;
      const a = B.appear[i];
      const emerge = seg(s1, a, a + B.appearDuration);
      const pop = easeOutBack(emerge);
      const flightStart = PART_FLIGHT.start + i * PART_FLIGHT.stagger;
      const flight = easeInOutCubic(seg(s2, flightStart, flightStart + PART_FLIGHT.duration));
      const vanish = smooth(seg(s3, 0.0, 0.09));
      const chosenAt = B.choose[i];
      const chosen = smooth(seg(s1, chosenAt, chosenAt + 0.015)) * (1 - smooth(seg(flight, 0, 0.2)));

      // table slot, with hover bob and emphasis while being compared / chosen
      const slot = PART_SLOTS[id];
      const cmpW = window4(s1, B.compare[0], B.compare[1], B.compare[2], B.compare[3]);
      const looked = id === "gpu" ? cmpW * (s1 < 0.785 ? 1 : 0.2) : id === "cpu" ? cmpW * (s1 >= 0.785 ? 1 : 0.2) : 0;
      tmp.copy(slot);
      tmp.y += Math.sin(t * 1.6 + i) * 0.018 + looked * 0.1 + bell(s1, chosenAt, chosenAt + 0.04) * 0.12;

      // emerging from the orb
      if (emerge < 1) {
        tmp2.copy(ORB);
        const k = easeOutCubic(emerge);
        tmp.set(lerp(tmp2.x, tmp.x, k), lerp(tmp2.y, tmp.y, k) + Math.sin(Math.PI * k) * 0.25, lerp(tmp2.z, tmp.z, k));
      }

      // flying into the quotation board (scene 2)
      if (flight > 0) {
        tmp2.set(BOARD.position.x + BOARD.iconX, BOARD.position.y + BOARD.rowY[i], BOARD.position.z + 0.08);
        const lift = Math.sin(Math.PI * flight);
        tmp.set(lerp(tmp.x, tmp2.x, flight), lerp(tmp.y, tmp2.y, flight) + lift * 0.35, lerp(tmp.z, tmp2.z, flight) + lift * 0.35);
      }
      g.position.copy(tmp);

      const baseScale = DISPLAY_SCALE[id];
      const scale = Math.max(0.0001, pop) * lerp(baseScale, baseScale * BOARD.iconScale, flight) * (1 - vanish);
      model.scale.setScalar(scale);
      model.rotation.y = (1 - smooth(emerge)) * -2.2 + Math.sin(t * 0.9 + i) * 0.12 * (1 - flight) + bell(s2, flightStart, flightStart + PART_FLIGHT.duration) * Math.PI * 2;
      g.visible = emerge > 0 && vanish < 1;

      // labels (hidden once the part is on the board — the board has its own rows)
      const labelOn = smooth(seg(s1, a + 0.03, a + 0.07)) * (1 - smooth(seg(flight, 0, 0.25)));
      const label = labels.current[i];
      const chosenLabel = chosenLabels.current[i];
      if (label) label.material.opacity = labelOn * (1 - chosen);
      if (chosenLabel) chosenLabel.material.opacity = labelOn * chosen;

      const ring = rings.current[i];
      if (ring) {
        ring.visible = chosen > 0.001;
        ring.position.set(slot.x, slot.y - 0.19, slot.z);
        ring.scale.setScalar(0.2 + chosen * 0.1 + Math.sin(t * 4 + i) * 0.006);
        (ring.material as THREE.MeshBasicMaterial).opacity = chosen * 0.9;
      }
      const spark = sparks.current[i];
      if (spark) {
        const sp = seg(s1, a + B.appearDuration * 0.7, a + B.appearDuration + 0.06);
        spark.visible = sp > 0 && sp < 1;
        spark.position.copy(slot);
        spark.scale.setScalar(0.1 + sp * 0.45);
        (spark.material as THREE.MeshBasicMaterial).opacity = (1 - sp) * 0.8;
      }
    });

    // ---------------- characters
    if (f.active !== 0) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    cust.setVisible(true);
    place(rep, SPOTS.repTable);
    place(cust, SPOTS.customerTable);

    // Default: they look at each other.
    lookAt(rep, CUSTOMER_HEAD);
    lookAt(cust, REP_HEAD);

    // Greeting.
    blend(rep.target, wave("r", t), window4(s1, ...B.repWave));
    blend(cust.target, wave("l", t + 0.5), window4(s1, ...B.customerWave));

    // Customer explains budget, games, design and performance goals.
    const talking = window4(s1, ...B.talk);
    talk(cust, t, talking);
    blend(cust.target, { lArmX: -0.95 + Math.sin(t * 3.2) * 0.18, lArmZ: 0.42, lElbow: -0.75, lElbowZ: 0.2 }, talking * 0.95);
    blend(rep.target, { smile: 0.7, brow: 0.3 }, talking);
    // Rep follows the chips as they land, then nods — "got it".
    const merging = window4(s1, B.chipsMerge[0] - 0.02, B.chipsMerge[0], B.chipsMerge[1], B.chipsMerge[1] + 0.02);
    lookAt(rep, ORB, merging);
    lookAt(cust, ORB, merging);
    add(rep.target, nod(t, 1), window4(s1, B.repNod[0], B.repNod[0] + 0.015, B.repNod[1] - 0.015, B.repNod[1]));

    // Rep presents each part as it emerges; the customer tracks it and nods.
    const newest = B.appear.reduce((acc, a, i) => (s1 >= a ? i : acc), -1);
    if (newest >= 0) {
      const present = window4(s1, B.appear[0] - 0.02, B.appear[0] + 0.01, B.appear[5] + 0.06, B.appear[5] + 0.1);
      const slot = PART_SLOTS[PART_IDS[newest]];
      aimArm(rep, "r", slot, present, -0.12);
      lookAt(rep, slot, present);
      lookAt(cust, slot, present);
      blend(rep.target, { smile: 0.8, brow: 0.35, lean: 0.08 }, present);
      talk(rep, t, present * 0.7 * (1 - bell(s1, B.appear[newest] + 0.04, B.appear[newest] + 0.07)));
      const since = s1 - B.appear[newest];
      add(cust.target, nod(t, 1), bell(since, 0.03, 0.07));
      blend(cust.target, { smile: 0.75, brow: 0.3 }, present);
    }

    // Customer compares GPU vs CPU, hand on chin.
    const cmp = window4(s1, ...B.compare);
    blend(cust.target, think("l"), cmp);
    lookAt(cust, s1 < 0.785 ? PART_SLOTS.gpu : PART_SLOTS.cpu, cmp);
    lookAt(rep, CUSTOMER_HEAD, cmp);
    blend(rep.target, { rArmX: -0.7, rArmZ: -0.45, rElbow: -0.5, smile: 0.6 }, cmp * 0.8);

    // Customer chooses: points at each part in turn; each one lights up.
    const choosing = window4(s1, B.choose[0] - 0.015, B.choose[0], B.choose[5] + 0.01, B.choose[5] + 0.03);
    const pick = B.choose.reduce((acc, c, i) => (s1 >= c - 0.01 ? i : acc), 0);
    const pickSlot = PART_SLOTS[PART_IDS[pick]];
    aimArm(cust, "l", pickSlot, choosing, -0.1);
    lookAt(cust, pickSlot, choosing);
    lookAt(rep, pickSlot, choosing * 0.7);
    blend(cust.target, { smile: 0.9, lean: 0.1 }, choosing);
    add(rep.target, nod(t, 0.8), choosing);

    // Both happy with the selection.
    const cheer = window4(s1, ...B.cheer);
    blend(rep.target, clap(t), cheer);
    blend(cust.target, { smile: 1, mouthOpen: 0.4, brow: 0.5, lArmX: -2.6, lArmZ: 0.5, lElbow: -0.3 }, cheer);
  });

  return (
    <group ref={root}>
      {chipTextures.map((tex, j) => (
        <TextureSprite
          key={j}
          texture={tex}
          width={0.3}
          height={0.34}
          ref={(el) => {
            chips.current[j] = el;
          }}
        />
      ))}

      <group ref={orb} position={ORB}>
        <mesh geometry={geo.sphere("lo")} material={glow(COLORS.gold)} />
        <TextureSprite texture={orbTexture} width={9} height={9} additive ref={orbGlow} />
      </group>

      {PART_IDS.map((id, i) => {
        const Model = PART_MODELS[id];
        return (
          <group key={id}>
            <group
              ref={(el) => {
                parts.current[i] = el;
              }}
              visible={false}
            >
              <group
                ref={(el) => {
                  models.current[i] = el;
                }}
              >
                <Model />
              </group>
              <LabelSprite
                text={PART_LABELS[id]}
                height={0.12}
                position={[0, 0.33, 0.02]}
                ref={(el) => {
                  labels.current[i] = el;
                }}
              />
              <LabelSprite
                text={PART_LABELS[id]}
                style="gold"
                check
                height={0.12}
                position={[0, 0.33, 0.02]}
                ref={(el) => {
                  chosenLabels.current[i] = el;
                }}
              />
            </group>
            <mesh
              geometry={geo.ring(0.8, 1)}
              rotation={[-Math.PI / 2, 0, 0]}
              visible={false}
              ref={(el) => {
                rings.current[i] = el;
              }}
            >
              <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh
              geometry={geo.ring(0.85, 1)}
              visible={false}
              ref={(el) => {
                sparks.current[i] = el;
              }}
            >
              <meshBasicMaterial color={COLORS.gold} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
