"use client";

import * as THREE from "three";
import { lerp, seg, smooth, window4 } from "../anim";
import { aimArm, consultIdle, lookAt, talk } from "../choreo";
import { useScene, useWorld, type FrameState } from "../director";
import { QUOTE_ANCHOR, SPOTS } from "../layout";
import { HAPPY, LEAN_IN, OK_L, THINK_L, add, blend, nod, talkHands } from "../poses";
import { CH } from "../../story";
import { QUOTE_ROWS, rowArrival } from "./ChapterParts";

/**
 * Chapter 2 beats (0..1 of the chapter). The chosen parts fly into the
 * quotation one by one (see PART_FLIGHT); shipping and the estimate follow;
 * the customer reads it through and approves.
 */
export const QUOTE_BEATS = {
  cardIn: [0.05, 0.13],
  present: [0.06, 0.12, 0.64, 0.68],
  shipping: 0.58,
  total: 0.63,
  leanIn: [0.14, 0.19, 0.66, 0.7],
  think: [0.4, 0.44, 0.56, 0.6],
  scan: [0.68, 0.8],
  nod: [0.8, 0.82, 0.86, 0.88],
  approve: 0.87,
  ok: [0.87, 0.9, 0.95, 0.975],
  settle: [0.96, 1.0],
} as const;

const REP_HEAD = new THREE.Vector3(SPOTS.rep.x, 1.55, SPOTS.rep.z);
const CUSTOMER_HEAD = new THREE.Vector3(SPOTS.customer.x, 1.55, SPOTS.customer.z);
const CARD_POINT = new THREE.Vector3(QUOTE_ANCHOR.x - 0.1, QUOTE_ANCHOR.y - 0.1, QUOTE_ANCHOR.z + 0.1);
const reading = new THREE.Vector3();

export function ChapterQuote() {
  const world = useWorld();

  useScene(20, (f: FrameState) => {
    const B = QUOTE_BEATS;
    const s2 = f.local[CH.quote];
    const s3 = f.local[CH.confirm];
    const t = f.clock;
    const card = world.anchors.get("quote");

    // ---------------- the quotation card (crisp DOM; it fades and rises, never scales)
    const cardIn = smooth(seg(s2, B.cardIn[0], B.cardIn[1]));
    const cardOut = smooth(seg(s3, 0.0, 0.07));
    card.pos.copy(QUOTE_ANCHOR);
    card.pos.y += cardOut * 0.25;
    card.align = "center";
    card.offsetY = (1 - cardIn) * 14;
    card.opacity = cardIn * (1 - cardOut) * (f.s < CH.confirm + 0.2 ? 1 : 0);
    for (let i = 0; i < QUOTE_ROWS; i++) card.cssVar(`r${i}`, smooth(seg(s2, rowArrival(i) - 0.012, rowArrival(i) + 0.03)));
    card.cssVar("r5", smooth(seg(s2, B.shipping, B.shipping + 0.035)));
    card.cssVar("r6", smooth(seg(s2, B.total, B.total + 0.035)));
    card.cssVar("approved", smooth(seg(s2, B.approve, B.approve + 0.03)));

    // ---------------- characters (gestures are windows that are zero at the chapter edges)
    if (f.active !== CH.quote) return;
    const rep = world.rep.current;
    const cust = world.customer.current;
    if (!rep || !cust) return;
    consultIdle(rep, cust, SPOTS.rep, SPOTS.customer);
    lookAt(cust, CARD_POINT, window4(s2, 0.03, 0.1, 0.9, 0.97));

    // Rep presents the quotation, walking through it line by line.
    const present = window4(s2, ...B.present);
    aimArm(rep, "r", CARD_POINT, present, -0.38);
    lookAt(rep, CARD_POINT, present * 0.7);
    talk(rep, t, present * 0.7);
    blend(rep.target, HAPPY, present * 0.6);

    // Customer leans in and reads down the rows as they appear (the gaze glides row to row).
    let row = 0;
    for (let i = 0; i < QUOTE_ROWS; i++) row += smooth(seg(s2, rowArrival(i) - 0.03, rowArrival(i) + 0.01));
    row += smooth(seg(s2, B.shipping - 0.03, B.shipping + 0.01)) + smooth(seg(s2, B.total - 0.03, B.total + 0.01));
    const lean = window4(s2, ...B.leanIn);
    reading.set(QUOTE_ANCHOR.x, QUOTE_ANCHOR.y + 0.32 - Math.max(0, row - 1) * 0.1, QUOTE_ANCHOR.z);
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

    // Settled: warm smiles that ease back to the shared idle by the chapter's end.
    const settle = window4(s2, B.settle[0], B.settle[0] + 0.015, 0.985, 1.0);
    blend(rep.target, HAPPY, settle);
    blend(cust.target, HAPPY, settle);
  });

  return null;
}
