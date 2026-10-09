"use client";

import * as THREE from "three";
import { easeOutBack, lerp, seg, smooth, window4 } from "../anim";
import { aimArm, converse, lookAt, place, resetPose, talk } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { QUOTE_ANCHOR, SPOTS } from "../layout";
import { HAPPY, LEAN_IN, OK_L, THINK_L, add, blend, nod, talkHands } from "../poses";
import { rowArrival } from "./ChapterParts";

/** Chapter 2 beats (0..1 of the chapter). Rows 0-5 light as each part arrives (see PART_FLIGHT). */
export const QUOTE_BEATS = {
  cardIn: [0.04, 0.13],
  present: [0.05, 0.11, 0.66, 0.7],
  shipping: 0.57,
  total: 0.62,
  leanIn: [0.14, 0.19, 0.66, 0.7],
  think: [0.34, 0.38, 0.54, 0.58],
  scan: [0.66, 0.8],
  nod: [0.79, 0.81, 0.86, 0.88],
  approve: 0.86,
  ok: [0.86, 0.89, 0.94, 0.97],
  settle: [0.95, 1.0],
} as const;

const REP_HEAD = new THREE.Vector3(SPOTS.rep.x, 1.55, SPOTS.rep.z);
const CUSTOMER_HEAD = new THREE.Vector3(SPOTS.customer.x, 1.55, SPOTS.customer.z);
const CARD_POINT = new THREE.Vector3(QUOTE_ANCHOR.x - 0.1, QUOTE_ANCHOR.y - 0.1, QUOTE_ANCHOR.z + 0.1);
const reading = new THREE.Vector3();

export function ChapterQuote() {
  const world = useWorld();

  useScene(20, (f: FrameState) => {
    const B = QUOTE_BEATS;
    const s2 = f.local[1];
    const s3 = f.local[2];
    const t = f.time;
    const card = world.anchors.get("quote");

    // ---------------- the quotation card
    const cardIn = easeOutBack(seg(s2, B.cardIn[0], B.cardIn[1]), 1.3);
    const cardOut = smooth(seg(s3, 0.0, 0.08));
    card.pos.copy(QUOTE_ANCHOR);
    card.pos.y += cardOut * 0.25;
    card.align = "center";
    card.scale = Math.max(0.001, lerp(0.9, 1, Math.min(1, cardIn)) * (1 - cardOut * 0.1));
    card.opacity = Math.min(1, cardIn) * (1 - cardOut) * (f.s < 2.2 ? 1 : 0);
    for (let i = 0; i < 6; i++) card.cssVar(`r${i}`, smooth(seg(s2, rowArrival(i) - 0.012, rowArrival(i) + 0.035)));
    card.cssVar("r6", smooth(seg(s2, B.shipping, B.shipping + 0.04)));
    card.cssVar("r7", smooth(seg(s2, B.total, B.total + 0.04)));
    card.cssVar("approved", easeOutBack(seg(s2, B.approve, B.approve + 0.04), 2));

    // ---------------- characters
    if (f.active !== 1) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    resetPose(rep);
    resetPose(cust);
    rep.setVisible(true);
    cust.setVisible(true);
    place(rep, SPOTS.rep);
    place(cust, SPOTS.customer);
    lookAt(rep, CUSTOMER_HEAD);
    lookAt(cust, CARD_POINT);

    // Rep presents the quotation, walking through it line by line.
    const present = window4(s2, ...B.present);
    aimArm(rep, "r", CARD_POINT, present, -0.38);
    lookAt(rep, CARD_POINT, present * 0.7);
    talk(rep, t, present * 0.8);
    blend(rep.target, HAPPY, present * 0.6);

    // Customer leans in and reads down the rows as they appear.
    let row = 0;
    for (let i = 0; i < 6; i++) if (s2 >= rowArrival(i) - 0.02) row = i;
    if (s2 >= B.shipping - 0.02) row = 6;
    if (s2 >= B.total - 0.02) row = 7;
    const lean = window4(s2, ...B.leanIn);
    reading.set(QUOTE_ANCHOR.x, QUOTE_ANCHOR.y + 0.32 - row * 0.09, QUOTE_ANCHOR.z);
    lookAt(cust, reading, lean);
    blend(cust.target, LEAN_IN, lean);
    blend(cust.target, THINK_L, window4(s2, ...B.think));

    // A final scan of the whole summary, then approval.
    const scan = window4(s2, B.scan[0], B.scan[0] + 0.02, B.scan[1], B.scan[1] + 0.02);
    reading.set(QUOTE_ANCHOR.x, lerp(QUOTE_ANCHOR.y + 0.35, QUOTE_ANCHOR.y - 0.35, seg(s2, B.scan[0], B.scan[1])), QUOTE_ANCHOR.z);
    lookAt(cust, reading, scan);
    cust.target.brow = lerp(cust.target.brow, -0.2, scan);
    lookAt(rep, CUSTOMER_HEAD, scan);
    blend(rep.target, talkHands("r", t), scan * 0.5);

    add(cust.target, nod(t), window4(s2, ...B.nod));
    const ok = window4(s2, ...B.ok);
    blend(cust.target, OK_L, ok);
    lookAt(cust, REP_HEAD, ok);
    blend(rep.target, HAPPY, ok);
    add(rep.target, nod(t), ok * 0.6);

    converse(cust, "l", rep, "r", t, smooth(seg(s2, B.settle[0], B.settle[1])));
  });

  return null;
}
