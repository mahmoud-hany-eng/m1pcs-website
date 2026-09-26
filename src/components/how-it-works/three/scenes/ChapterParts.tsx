"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, canvasTexture, geo, glow, std } from "../assets";
import { bell, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, consultIdle, lookAt, pointAlong, talk } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { PART_IDS, PART_SLOTS, PROJECTOR, QUOTE_ANCHOR, SPOTS, type PartId } from "../layout";
import { PART_MODELS } from "../parts";
import { HAPPY, THINK_L, add, blend, nod, talkHands, wave } from "../poses";

const SLOT_LIST = PART_IDS.map((id) => PART_SLOTS[id]);

/** Chapter 1 beats (0..1 of the chapter). */
export const PARTS_BEATS = {
  tags: [0.0, 0.03, 0.22, 0.26],
  repWave: [0.03, 0.06, 0.12, 0.15],
  customerWave: [0.06, 0.09, 0.15, 0.18],
  talk: [0.15, 0.18, 0.35, 0.38],
  chips: [0.18, 0.225, 0.27, 0.315],
  chipsIn: [0.38, 0.45],
  tap: [0.37, 0.41, 0.44, 0.47],
  appear: [0.47, 0.51, 0.55, 0.59, 0.63, 0.67],
  appearDuration: 0.06,
  compare: [0.72, 0.75, 0.82, 0.85],
  choose: [0.85, 0.87, 0.89, 0.91, 0.93, 0.95],
  settle: [0.95, 1.0],
} as const;

/** Chapter 2: parts lift off and merge into the quotation, one row at a time. */
export const PART_FLIGHT = { start: 0.12, stagger: 0.06, duration: 0.1 } as const;
export const rowArrival = (i: number) => PART_FLIGHT.start + i * PART_FLIGHT.stagger + PART_FLIGHT.duration;

const DISPLAY_SCALE: Record<PartId, number> = { cpu: 1.1, gpu: 0.8, ram: 0.9, storage: 1.12, board: 0.78, case: 1.0 };
const CHIP_IDS = ["chip-budget", "chip-games", "chip-performance", "chip-design"] as const;
/**
 * Chips form a tidy 2×2 cluster in screen space: beside the customer's head
 * on wide screens, in a fixed slot above the scene on narrow ones (where the
 * customer stands at the screen edge).
 */
const CHIP_GRID = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
const CHIP_CLUSTER = new THREE.Vector3(1.28, 2.4, 0.05);
const CHIP_SLOT_TALL = { x: 0.5, y: 0.08 };
const CUSTOMER_MOUTH = new THREE.Vector3(SPOTS.customer.x - 0.1, 1.5, SPOTS.customer.z + 0.1);
const PROJECTOR_TOP = new THREE.Vector3(PROJECTOR.x, PROJECTOR.y + 0.08, PROJECTOR.z);

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const aim = new THREE.Vector3();

/** Continuous "which item" index: rises by one through each [at - lead, at + lag] window. */
function stepIndex(t: number, ats: readonly number[], lead: number, lag: number) {
  let k = -1;
  for (const at of ats) k += smooth(seg(t, at - lead, at + lag));
  return k;
}

function beamTexture() {
  return canvasTexture("projector-beam", 64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(249,194,4,0.55)");
    g.addColorStop(0.35, "rgba(249,194,4,0.16)");
    g.addColorStop(1, "rgba(249,194,4,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function ChapterParts() {
  const world = useWorld();
  const root = useRef<THREE.Group>(null!);
  const parts = useRef<(THREE.Group | null)[]>([]);
  const models = useRef<(THREE.Group | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const sparks = useRef<(THREE.Mesh | null)[]>([]);
  const projector = useRef<THREE.Group>(null!);
  const projectorRing = useRef<THREE.MeshBasicMaterial>(null!);
  const beam = useRef<THREE.Mesh>(null!);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null!);

  const beamTex = useMemo(() => beamTexture(), []);
  const ringDim = useMemo(() => new THREE.Color("#4a3a08"), []);
  const ringLit = useMemo(() => new THREE.Color(COLORS.gold), []);

  useScene(10, (f: FrameState) => {
    const B = PARTS_BEATS;
    const s1 = f.local[0];
    const s2 = f.local[1];
    const s3 = f.local[2];
    const t = f.clock;
    const A = world.anchors;
    const compact = f.layout === "tall";
    // Phones: the customer stands at the screen edge, so their needs gather in a slot above the scene.
    const phone = compact && f.width < 600;

    const inStudioConsult = f.s <= 2.2;
    root.current.visible = inStudioConsult;
    projector.current.visible = f.s <= 3.3;

    // ---------------- projector: glows while it turns needs into parts, and projects the quote
    const projOn = Math.max(
      window4(s1, B.chipsIn[0], B.chipsIn[1], B.appear[5] + 0.08, B.appear[5] + 0.14),
      window4(s2, 0.0, 0.08, 0.6, 0.7),
    );
    projectorRing.current.color.copy(ringDim).lerp(ringLit, Math.min(1, projOn + 0.15 * Math.sin(t * 3) * projOn));
    beam.current.visible = projOn > 0.01;
    beamMat.current.opacity = projOn * (0.85 + 0.15 * Math.sin(t * 5));
    beam.current.scale.set(1, lerp(0.6, s2 > 0 ? 1.9 : 1, projOn), 1);

    // ---------------- requirement chips: out of the conversation, then into the projector
    const merge = easeInOutCubic(seg(s1, B.chipsIn[0], B.chipsIn[1]));
    CHIP_IDS.forEach((id, j) => {
      const a = A.get(id);
      const pop = easeOutBack(seg(s1, B.chips[j], B.chips[j] + 0.05), 1.6);
      const travel = easeOutCubic(seg(s1, B.chips[j], B.chips[j] + 0.07));
      if (phone) {
        // Screen slot: blend out of the customer's mouth into the slot, then back into the projector.
        a.pos.lerpVectors(CUSTOMER_MOUTH, PROJECTOR_TOP, merge);
        a.slotX = CHIP_SLOT_TALL.x;
        a.slotY = CHIP_SLOT_TALL.y;
        a.slotMix = travel * (1 - merge);
      } else {
        tmp.lerpVectors(CUSTOMER_MOUTH, CHIP_CLUSTER, travel);
        a.pos.copy(tmp.lerp(PROJECTOR_TOP, merge));
        a.slotMix = 0;
      }
      a.align = "center";
      const gx = phone ? 58 : 72;
      const gy = phone ? 19 : 24;
      a.offsetX = CHIP_GRID[j][0] * gx * travel * (1 - merge);
      a.offsetY = CHIP_GRID[j][1] * gy * travel * (1 - merge) + Math.sin(t * 1.6 + j) * 2 * (1 - merge);
      a.scale = Math.max(0.001, Math.min(1, pop) * (1 - merge * 0.6));
      a.opacity = Math.min(1, pop) * (1 - smooth(seg(merge, 0.65, 1)));
    });

    // ---------------- name tags (who's who) for the opening
    const tags = window4(s1, ...B.tags) * (f.s < 1 ? 1 : 0);
    const repTag = A.get("tag-rep");
    repTag.pos.set(SPOTS.rep.x, 2.02, SPOTS.rep.z);
    repTag.opacity = tags;
    const custTag = A.get("tag-customer");
    custTag.pos.set(SPOTS.customer.x, 2.02, SPOTS.customer.z);
    custTag.opacity = tags;

    // ---------------- parts
    const toCpu = smooth(seg(s1, 0.77, 0.8));
    const cmp = window4(s1, ...B.compare);
    PART_IDS.forEach((id, i) => {
      const g = parts.current[i];
      const model = models.current[i];
      if (!g || !model) return;
      const at = B.appear[i];
      const emerge = seg(s1, at, at + B.appearDuration);
      const pop = easeOutBack(emerge, 1.7);
      const flightStart = PART_FLIGHT.start + i * PART_FLIGHT.stagger;
      const flight = easeInOutCubic(seg(s2, flightStart, flightStart + PART_FLIGHT.duration));
      const chosenAt = B.choose[i];
      const chosen = smooth(seg(s1, chosenAt, chosenAt + 0.015)) * (1 - smooth(seg(flight, 0, 0.25)));

      const slot = PART_SLOTS[id];
      const looked = id === "gpu" ? cmp * (1 - 0.75 * toCpu) : id === "cpu" ? cmp * (0.25 + 0.75 * toCpu) : 0;
      tmp.copy(slot);
      tmp.y += Math.sin(t * 1.4 + i) * 0.014 + looked * 0.1 + bell(s1, chosenAt, chosenAt + 0.04) * 0.1;

      if (emerge < 1) {
        // Rises out of the projector and arcs to its slot.
        const k = easeOutCubic(emerge);
        tmp.set(lerp(PROJECTOR_TOP.x, tmp.x, k), lerp(PROJECTOR_TOP.y, tmp.y, k) + Math.sin(Math.PI * k) * 0.3, lerp(PROJECTOR_TOP.z, tmp.z, k));
      }
      if (flight > 0) {
        tmp2.set(QUOTE_ANCHOR.x - 0.35, QUOTE_ANCHOR.y + 0.25 - i * 0.1, QUOTE_ANCHOR.z + 0.05);
        const lift = Math.sin(Math.PI * flight);
        tmp.set(lerp(tmp.x, tmp2.x, flight), lerp(tmp.y, tmp2.y, flight) + lift * 0.3, lerp(tmp.z, tmp2.z, flight) + lift * 0.25);
      }
      g.position.copy(tmp);
      const merged = smooth(seg(flight, 0.7, 1));
      const scale = Math.max(0.0001, pop) * DISPLAY_SCALE[id] * (1 - merged) * (1 - smooth(seg(s3, 0, 0.05)));
      model.scale.setScalar(Math.max(0.0001, scale));
      model.rotation.y = (1 - smooth(emerge)) * -2.4 + Math.sin(t * 0.8 + i) * 0.14 * (1 - flight) + flight * Math.PI * 1.5;
      g.visible = emerge > 0 && merged < 1;

      // Crisp DOM label above the part. On small screens only the part being
      // presented / chosen is labelled (cross-fading), so labels never collide.
      const label = A.get(`part-${id}`);
      label.pos.set(slot.x, slot.y + (compact ? 0.26 : i % 2 === 0 ? 0.26 : 0.46), slot.z);
      label.align = "above";
      const labelOn = smooth(seg(s1, at + 0.03, at + 0.07)) * (1 - smooth(seg(s2, 0.0, 0.06)));
      let focus = 1;
      if (compact) {
        const nextAt = i < 5 ? B.appear[i + 1] : B.compare[0];
        const presented = window4(s1, at + 0.03, at + 0.06, nextAt + 0.01, nextAt + 0.035);
        const nextChoose = i < 5 ? B.choose[i + 1] : 2;
        const picked = window4(s1, chosenAt - 0.012, chosenAt + 0.004, nextChoose - 0.012, nextChoose + 0.004);
        focus = Math.max(presented, picked);
      }
      label.opacity = labelOn * focus * (f.s < 1.4 ? 1 : 0);
      label.flag("selected", chosen > 0.5);

      const ring = rings.current[i];
      if (ring) {
        ring.visible = chosen > 0.001;
        ring.position.set(slot.x, 0.957, slot.z);
        ring.scale.setScalar(0.12 + chosen * 0.035 + Math.sin(t * 3 + i) * 0.003);
        (ring.material as THREE.MeshBasicMaterial).opacity = chosen * 0.9;
      }
      const spark = sparks.current[i];
      if (spark) {
        const sp = seg(s1, at + B.appearDuration * 0.6, at + B.appearDuration + 0.05);
        spark.visible = sp > 0 && sp < 1;
        spark.position.copy(slot);
        spark.scale.setScalar(0.08 + easeOutCubic(sp) * 0.22);
        (spark.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * sp) * 0.55;
      }
    });

    // ---------------- characters (every gesture is a window that is zero at the chapter edges)
    if (f.active !== 0) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    consultIdle(rep, cust, SPOTS.rep, SPOTS.customer);

    // Greeting.
    blend(rep.target, wave("r", t), window4(s1, ...B.repWave));
    blend(cust.target, wave("l", t + 0.5), window4(s1, ...B.customerWave));

    // The customer explains their needs; the rep listens and nods.
    const talking = window4(s1, ...B.talk);
    talk(cust, t, talking);
    blend(cust.target, talkHands("l", t), talking * 0.95);
    blend(rep.target, HAPPY, talking * 0.6);
    add(rep.target, nod(t), window4(s1, 0.24, 0.26, 0.33, 0.35) * 0.7);

    // Needs go into the projector; the rep taps it.
    const tapping = window4(s1, ...B.tap);
    aimArm(rep, "r", PROJECTOR_TOP, tapping, -0.35);
    const merging = window4(s1, B.chipsIn[0] - 0.02, B.chipsIn[0], B.chipsIn[1], B.chipsIn[1] + 0.02);
    lookAt(rep, PROJECTOR_TOP, merging);
    lookAt(cust, PROJECTOR_TOP, merging);

    // Rep presents each part as it rises (the aim glides from slot to slot); the customer follows and nods.
    const present = window4(s1, B.appear[0] - 0.02, B.appear[0] + 0.01, B.appear[5] + 0.06, B.appear[5] + 0.1);
    if (present > 0) {
      pointAlong(SLOT_LIST, Math.max(0, stepIndex(s1, B.appear, 0.01, 0.02)), aim);
      aimArm(rep, "r", aim, present, -0.14);
      lookAt(rep, aim, present);
      lookAt(cust, aim, present);
      talk(rep, t, present * 0.7);
      blend(rep.target, HAPPY, present * 0.7);
      rep.target.lean = lerp(rep.target.lean, 0.08, present);
      blend(cust.target, HAPPY, present * 0.6);
    }
    let nods = 0;
    for (const at of B.appear) nods += bell(s1, at + 0.025, at + 0.07);
    add(cust.target, nod(t), nods);

    // The customer compares; the rep explains the options.
    blend(cust.target, THINK_L, cmp);
    lookAt(cust, aim.lerpVectors(PART_SLOTS.gpu, PART_SLOTS.cpu, toCpu), cmp);
    lookAt(rep, tmp.set(SPOTS.customer.x, 1.55, SPOTS.customer.z), cmp);
    blend(rep.target, talkHands("r", t), cmp * 0.9);
    talk(rep, t, cmp);

    // The customer chooses each part in turn (pointing glides from part to part).
    const choose = window4(s1, B.choose[0] - 0.015, B.choose[0], B.choose[5] + 0.01, B.choose[5] + 0.03);
    if (choose > 0) {
      pointAlong(SLOT_LIST, Math.max(0, stepIndex(s1, B.choose, 0.012, 0.004)), aim);
      aimArm(cust, "l", aim, choose, -0.1);
      lookAt(cust, aim, choose);
      lookAt(rep, aim, choose * 0.7);
      blend(cust.target, HAPPY, choose);
      add(rep.target, nod(t), choose * 0.8);
    }

    // Settled: a warm moment that eases back to the shared idle by the chapter's end.
    const settle = window4(s1, B.settle[0], B.settle[0] + 0.015, 0.985, 1.0);
    blend(rep.target, HAPPY, settle);
    blend(cust.target, HAPPY, settle);
  });

  return (
    <group>
      {/* holographic projector puck + beam */}
      <group ref={projector} name="projector" position={PROJECTOR}>
        <mesh geometry={geo.cylinder(0.17, 0.19, 40)} material={std("#141417", { roughness: 0.3, metalness: 0.6 })} position={[0, 0.018, 0]} scale={[1, 0.036, 1]} />
        <mesh geometry={geo.torus(0.15, 0.013)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.037, 0]}>
          <meshBasicMaterial ref={projectorRing} color="#4a3a08" toneMapped={false} />
        </mesh>
        <mesh geometry={geo.circle(40)} material={glow("#1e1e22")} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.038, 0]} scale={0.12} />
        <mesh ref={beam} geometry={geo.cylinder(0.24, 0.13, 40)} position={[0, 0.55, 0]} visible={false}>
          <meshBasicMaterial ref={beamMat} map={beamTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} opacity={0} />
        </mesh>
      </group>

      <group ref={root} name="partsRoot">
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
                geometry={geo.ring(0.92, 1)}
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
    </group>
  );
}
