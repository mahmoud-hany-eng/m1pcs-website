"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

interface ProcessStep {
  heading: string;
  supporting: string;
  secondary?: string;
}

/**
 * Copy verbatim from the brief — no retailer names, shipping times,
 * guarantees, prices or warranty periods invented beyond what's given here
 * or already published in src/lib/site-config.ts (used for the static
 * deposit/delivery note below the story, not fabricated here).
 */
const STEPS: ProcessStep[] = [
  {
    heading: "Tell Us What You Need",
    supporting:
      "Tell us your budget, what you use the PC for, your preferred components, and the look you want.",
  },
  {
    heading: "Sourced From The U.S.",
    supporting:
      "Your selected components are sourced directly from the U.S. based on your requested specification and current availability.",
    secondary:
      "We don't push fixed inventory. We source the components selected for your build from trusted U.S. retailers and suppliers.",
  },
  {
    heading: "Review Your Quotation",
    supporting:
      "Receive a detailed quotation with your selected components, current pricing and estimated shipping timeframe.",
  },
  {
    heading: "Confirm Your Order",
    supporting:
      "Confirm your order with the applicable deposit. You'll receive a payment receipt and confirmation that the order has been placed.",
    secondary: "An Aramex tracking number is provided after shipping so you can follow the shipment.",
  },
  {
    heading: "Built. Set Up. Delivered.",
    supporting:
      "Once the parts arrive, M1 assembles and sets up your PC with Windows 11 Pro, required drivers and system updates so it is ready to use.",
    secondary:
      "Choose pickup or home delivery. Eligible warranty cases for parts supplied through M1 are handled through us.",
  },
];

const SOURCE_WORDS = ["BUDGET", "PERFORMANCE", "DESIGN", "USE CASE"];
const QUOTE_LINES = ["CPU", "GPU", "RAM", "STORAGE", "SHIPPING"];
const CONFIRM_STAGES = ["DEPOSIT", "ORDER CONFIRMED", "TRACKING"];
const DELIVERED_WORDS = ["BUILD", "SETUP", "READY", "DELIVERED"];

/** The three fixed slots' offsets (px) from the active anchor — see
 *  FocusPanel. Each is a viewport-proportional value clamped between a
 *  floor and a ceiling (computed in JS against window.innerHeight rather
 *  than CSS clamp(), since the value feeds a framer motion transform, not
 *  a stylesheet): scales down gracefully on short viewports instead of
 *  clipping, and never balloons into a huge gap on tall ones. PREV is
 *  smaller (a faded heading only needs to clear the active heading
 *  itself); NEXT is a little larger, since it has to clear the active
 *  step's own detail block underneath it — the tallest step (the
 *  quotation lines) is trimmed to fit comfortably inside it. */
const PREV_OFFSET_MIN = 160;
const PREV_OFFSET_VH_FRACTION = 0.18;
const PREV_OFFSET_MAX = 220;

const NEXT_OFFSET_MIN = 290;
const NEXT_OFFSET_VH_FRACTION = 0.32;
const NEXT_OFFSET_MAX = 320;

/** Vertical anchor for the active slot, as a percentage of the pinned
 *  viewport's height below the header — the header height itself comes
 *  from the site's actual header (h-16/h-20 in Header.tsx), already
 *  matched by this section's own sticky offset below, not a separate
 *  invented number. Close to true centre now that PREV/NEXT are a much
 *  tighter, near-symmetric cluster around it. */
const ACTIVE_ANCHOR = "46%";

function clampedOffset(min: number, vhFraction: number, max: number): number {
  if (typeof window === "undefined") return (min + max) / 2;
  return Math.min(max, Math.max(min, window.innerHeight * vhFraction));
}

/** Piecewise slot offset (px) for a panel at the given signed distance
 *  from the active slot: 0 at distance 0, -PREV at distance -1 (and
 *  beyond), +NEXT at distance +1 (and beyond) — see FocusPanel. */
function slotOffset(d: number): number {
  const prev = clampedOffset(PREV_OFFSET_MIN, PREV_OFFSET_VH_FRACTION, PREV_OFFSET_MAX);
  const next = clampedOffset(NEXT_OFFSET_MIN, NEXT_OFFSET_VH_FRACTION, NEXT_OFFSET_MAX);
  if (d <= -1) return -prev;
  if (d >= 1) return next;
  if (d <= 0) return prev * d;
  return next * d;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * The "How It Works" process story — a vertical focus stack on desktop
 * (previous/active/next items visible at once, the active one clear and
 * centred, everything else fading out completely), a per-item scroll-linked
 * fade on mobile that preserves native scrolling, and a fully-visible
 * static list under reduced motion. Every visual value is a pure function
 * of scroll position (via framer's useTransform chains off one spring), so
 * every transition is bidirectional by construction — scrolling up just
 * re-evaluates the same functions at a smaller progress value.
 */
export function ProcessStory() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (reduceMotion) return <StaticProcess />;
  if (isMobile) return <MobileFocusStack />;
  return <DesktopFocusStack />;
}

/* ------------------------------------------------------------------ */
/* Desktop — vertical focus stack                                      */
/* ------------------------------------------------------------------ */

// A single continuous "focus" position (0 -> 4, one per step) derived from
// scroll progress. Each step's own 20%-wide window holds flat once
// reached, then spends 40% of the window crossfading to the next — see the
// ProcessStory doc comment in the PR/commit for the full derivation.
const FOCUS_INPUT: number[] = [0, 0.1, 0.18, 0.3, 0.38, 0.5, 0.58, 0.7, 0.78, 1.0];
const FOCUS_OUTPUT: number[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];

function DesktopFocusStack() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 35,
    mass: 0.2,
  });

  const focus = useTransform(smoothProgress, FOCUS_INPUT, FOCUS_OUTPUT);

  return (
    <div ref={sectionRef} className="relative h-[600vh] bg-background">
      <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
        <Container className="h-full">
          <div className="relative mx-auto h-full max-w-[980px]">
            <FocusPanel index={0} step={STEPS[0]} focus={focus} />
            <FocusPanel index={1} step={STEPS[1]} focus={focus} />
            <FocusPanel index={2} step={STEPS[2]} focus={focus} />
            <FocusPanel index={3} step={STEPS[3]} focus={focus} />
            <FocusPanel index={4} step={STEPS[4]} focus={focus} />
          </div>
        </Container>
      </div>
    </div>
  );
}

function FocusPanel({
  index,
  step,
  focus,
}: {
  index: number;
  step: ProcessStep;
  focus: MotionValue<number>;
}) {
  const distance = useTransform(focus, (f) => index - f);
  const absDistance = useTransform(distance, (d) => Math.abs(d));
  const opacity = useTransform(absDistance, [0, 1, 2], [1, 0.25, 0]);
  const scale = useTransform(absDistance, [0, 1, 2], [1, 0.9, 0.85]);
  // Three fixed slots, not a continuous per-item offset: at distance -1 the
  // item sits in the PREV slot (a modest distance above centre, since a
  // faded neighbour is just a heading preview), at 0 it's in the ACTIVE
  // slot (the shared anchor below), and at +1 the NEXT slot (a much larger
  // offset, since it must clear the active step's own full detail copy,
  // which is absolutely positioned below ITS heading and can run 250-400px
  // tall depending on the step). Framer's array-based useTransform clamps
  // beyond [-1, 1], so an item 2+ away just stays parked at whichever slot
  // it last reached while fading to opacity 0 — never flies further away.
  const y = useTransform(distance, slotOffset);
  const focusStrength = useTransform(absDistance, (d) => 1 - clamp01(d / 0.45));
  const pointerEvents = useTransform(opacity, (o) => (o < 0.05 ? "none" : "auto"));
  // The two step-number treatments cross-fade rather than stack: a faded
  // neighbour shows only its bare ordinal ("02"), and only once a step is
  // genuinely active does that hand off to the "0X / 05" counter — so the
  // counter only ever appears beside the active content, never a neighbour.
  const counterOpacity = focusStrength;
  const ordinalOpacity = useTransform([opacity, focusStrength], ([o, fs]: number[]) => o * (1 - fs));

  return (
    <div className="absolute inset-x-0 -translate-y-1/2" style={{ top: ACTIVE_ANCHOR }}>
      <motion.div
        style={{ opacity, scale, y, pointerEvents }}
        className="relative mx-auto w-full max-w-[900px] text-center"
      >
        <div className="relative h-5">
          <motion.p
            style={{ opacity: counterOpacity }}
            className="absolute inset-0 font-display text-sm font-semibold tracking-[0.2em] text-text-muted"
          >
            {String(index + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </motion.p>
          <motion.span
            style={{ opacity: ordinalOpacity }}
            className="absolute inset-0 font-display text-xs font-semibold tracking-[0.2em] text-text-muted"
          >
            {String(index + 1).padStart(2, "0")}
          </motion.span>
        </div>
        <h3 className="mt-3 font-display text-[clamp(2.5rem,4.5vw,3.75rem)] font-bold leading-[1.06] tracking-tight text-text-primary">
          {step.heading}
        </h3>

        {/* Absolutely positioned so it never inflates this panel's own
            height — every panel's static footprint stays just its number
            + heading, which is what the neighbouring panels' spacing is
            measured against, preventing the detail copy of an active step
            from ever pushing its own box into a neighbour's. */}
        <motion.div
          style={{ opacity: focusStrength }}
          className="absolute left-1/2 top-full mt-5 w-full max-w-[640px] -translate-x-1/2"
        >
          {index === 1 && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Important
            </p>
          )}
          <p className="text-lg text-text-secondary">{step.supporting}</p>
          {step.secondary && <p className="mt-3 text-sm text-text-muted">{step.secondary}</p>}

          {index === 0 && <WordStagger words={SOURCE_WORDS} focusStrength={focusStrength} />}
          {index === 1 && <SourceRoute focusStrength={focusStrength} />}
          {index === 2 && <QuotationLines rows={QUOTE_LINES} focusStrength={focusStrength} />}
          {index === 3 && (
            <ConfirmProgression stages={CONFIRM_STAGES} focusStrength={focusStrength} />
          )}
          {index === 4 && (
            <>
              <DeliveredWords words={DELIVERED_WORDS} focusStrength={focusStrength} />
              <motion.div style={{ opacity: focusStrength }} className="mt-8">
                <Button href="/build-my-pc" size="lg">
                  Request a PC Quote
                </Button>
              </motion.div>
            </>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}

/** Step 1 — BUDGET / PERFORMANCE / DESIGN / USE CASE entering individually
 *  staggered as small tags once the step is active. */
function WordStagger({
  words,
  focusStrength,
}: {
  words: string[];
  focusStrength: MotionValue<number>;
}) {
  const op0 = useTransform(focusStrength, [0.05, 0.35], [0, 1]);
  const op1 = useTransform(focusStrength, [0.2, 0.5], [0, 1]);
  const op2 = useTransform(focusStrength, [0.35, 0.65], [0, 1]);
  const op3 = useTransform(focusStrength, [0.5, 0.8], [0, 1]);
  const ops = [op0, op1, op2, op3];
  const y0 = useTransform(op0, [0, 1], [10, 0]);
  const y1 = useTransform(op1, [0, 1], [10, 0]);
  const y2 = useTransform(op2, [0, 1], [10, 0]);
  const y3 = useTransform(op3, [0, 1], [10, 0]);
  const ys = [y0, y1, y2, y3];

  return (
    <div className="mx-auto mt-6 inline-flex flex-wrap justify-center gap-x-4 gap-y-1">
      {words.map((word, i) => (
        <motion.span
          key={word}
          style={{ opacity: ops[i], y: ys[i] }}
          className="font-display text-sm font-bold uppercase tracking-[0.15em] text-text-muted"
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/** Step 2 — the section's strongest visual moment: a minimal abstract
 *  sourcing route (no map, no plane, no logos) that draws while the step
 *  is active, with a small marker travelling along it. */
function SourceRoute({ focusStrength }: { focusStrength: MotionValue<number> }) {
  const lineScale = useTransform(focusStrength, [0.1, 0.7], [0, 1]);
  const dotOpacity = useTransform(focusStrength, [0.1, 0.25], [0, 1]);
  const dotX = useTransform(focusStrength, [0.1, 0.75], [0, 100]);
  const dotLeft = useTransform(dotX, (v) => `${v}%`);
  const endOpacity = useTransform(focusStrength, [0.55, 0.8], [0.3, 1]);

  return (
    <div className="mx-auto mt-7 inline-flex max-w-md items-center gap-5">
      <span className="font-display text-lg font-bold tracking-[0.1em] text-text-primary">U.S.A.</span>
      <div className="relative h-px flex-1 bg-border">
        <motion.div
          style={{ scaleX: lineScale }}
          className="absolute inset-0 origin-left bg-accent"
        />
        <motion.div
          style={{ left: dotLeft, opacity: dotOpacity }}
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
        />
      </div>
      <motion.span
        style={{ opacity: endOpacity }}
        className="font-display text-lg font-bold tracking-[0.1em] text-text-primary"
      >
        QATAR
      </motion.span>
    </div>
  );
}

/** Step 3 — an editorial quotation document made from typography only, no
 *  fake prices, rows assembling while the step is active. */
function QuotationLines({
  rows,
  focusStrength,
}: {
  rows: string[];
  focusStrength: MotionValue<number>;
}) {
  const op0 = useTransform(focusStrength, [0.05, 0.25], [0, 1]);
  const op1 = useTransform(focusStrength, [0.19, 0.39], [0, 1]);
  const op2 = useTransform(focusStrength, [0.33, 0.53], [0, 1]);
  const op3 = useTransform(focusStrength, [0.47, 0.67], [0, 1]);
  const op4 = useTransform(focusStrength, [0.61, 0.81], [0, 1]);
  const rowOps = [op0, op1, op2, op3, op4];
  const y0 = useTransform(op0, [0, 1], [10, 0]);
  const y1 = useTransform(op1, [0, 1], [10, 0]);
  const y2 = useTransform(op2, [0, 1], [10, 0]);
  const y3 = useTransform(op3, [0, 1], [10, 0]);
  const y4 = useTransform(op4, [0, 1], [10, 0]);
  const rowYs = [y0, y1, y2, y3, y4];

  return (
    <div className="mx-auto mt-5 inline-flex max-w-sm flex-col divide-y divide-border border-t border-border text-left">
      {rows.map((row, i) => (
        <motion.div
          key={row}
          style={{ opacity: rowOps[i], y: rowYs[i] }}
          className="flex items-center justify-between py-0.5"
        >
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-text-secondary">
            {row}
          </span>
          <span aria-hidden="true" className="h-px w-16 bg-border-strong" />
        </motion.div>
      ))}
    </div>
  );
}

/** Step 4 — DEPOSIT -> ORDER CONFIRMED -> TRACKING, revealing sequentially
 *  while the step is active, no invented order/tracking numbers. */
function ConfirmProgression({
  stages,
  focusStrength,
}: {
  stages: string[];
  focusStrength: MotionValue<number>;
}) {
  const stage0 = useTransform(focusStrength, [0, 0.15], [0.3, 1]);
  const connector0 = useTransform(focusStrength, [0.15, 0.35], [0, 1]);
  const stage1 = useTransform(focusStrength, [0.3, 0.5], [0.3, 1]);
  const connector1 = useTransform(focusStrength, [0.5, 0.65], [0, 1]);
  const stage2 = useTransform(focusStrength, [0.6, 0.8], [0.3, 1]);
  const stageOps = [stage0, stage1, stage2];
  const connectorOps = [connector0, connector1];

  return (
    <div className="mx-auto mt-6 inline-flex max-w-lg flex-wrap items-center justify-center gap-3">
      {stages.map((stage, i) => (
        <div key={stage} className="flex items-center gap-3">
          <motion.span
            style={{ opacity: stageOps[i] }}
            className="font-display text-sm font-bold uppercase tracking-[0.15em] text-text-primary"
          >
            {stage}
          </motion.span>
          {i < stages.length - 1 && (
            <motion.span aria-hidden="true" style={{ opacity: connectorOps[i] }} className="text-text-muted">
              &rarr;
            </motion.span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Step 5 — BUILD / SETUP / READY / DELIVERED progressing as a restrained
 *  checklist-style highlight while the step is active. */
function DeliveredWords({
  words,
  focusStrength,
}: {
  words: string[];
  focusStrength: MotionValue<number>;
}) {
  const op0 = useTransform(focusStrength, [0, 0.15], [0.3, 1]);
  const op1 = useTransform(focusStrength, [0.2, 0.4], [0.3, 1]);
  const op2 = useTransform(focusStrength, [0.4, 0.6], [0.3, 1]);
  const op3 = useTransform(focusStrength, [0.6, 0.8], [0.3, 1]);
  const ops = [op0, op1, op2, op3];

  return (
    <div className="mx-auto mt-6 inline-flex max-w-lg flex-wrap justify-center gap-x-6 gap-y-3">
      {words.map((word, i) => (
        <motion.span
          key={word}
          style={{ opacity: ops[i] }}
          className="font-display text-xl font-bold tracking-tight text-text-primary sm:text-2xl"
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile — per-item scroll-linked focus fade, fully native scrolling  */
/* ------------------------------------------------------------------ */

function MobileFocusStack() {
  return (
    <Container className="py-20 sm:py-24">
      <ol className="flex flex-col">
        {STEPS.map((step, i) => (
          <MobileFocusItem key={step.heading} step={step} index={i} />
        ))}
      </ol>
    </Container>
  );
}

function MobileFocusItem({ step, index }: { step: ProcessStep; index: number }) {
  const itemRef = useRef<HTMLLIElement>(null);

  // Tracks this item's OWN position relative to the viewport — progress
  // 0.5 exactly when its centre aligns with the viewport centre — rather
  // than one shared pinned/sticky story. No position:sticky is used on
  // mobile at all, so scrolling stays completely native; each item simply
  // fades in as it approaches the viewport's centre and fades out as it
  // leaves, independently and reversibly, in either scroll direction.
  const { scrollYProgress } = useScroll({
    target: itemRef,
    offset: ["center end", "center start"],
  });
  const smooth = useSpring(scrollYProgress, { stiffness: 180, damping: 32, mass: 0.2 });
  const deviation = useTransform(smooth, (v) => Math.abs(v - 0.5) * 2);

  const opacity = useTransform(deviation, [0, 0.35, 0.7], [1, 0.3, 0]);
  const scale = useTransform(deviation, [0, 0.35, 0.7], [1, 0.93, 0.88]);
  const focusStrength = useTransform(deviation, (d) => 1 - clamp01(d / 0.3));
  const pointerEvents = useTransform(opacity, (o) => (o < 0.05 ? "none" : "auto"));

  return (
    <li ref={itemRef} className="py-12 first:pt-0 last:pb-0 sm:py-16">
      <motion.div style={{ opacity, scale, pointerEvents }} className="origin-center">
        {index === 1 && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Important
          </p>
        )}
        <span className="block font-display text-xs font-semibold tracking-[0.2em] text-text-muted">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-text-primary sm:text-3xl">
          {step.heading}
        </h3>

        <motion.div style={{ opacity: focusStrength }} className="mt-3">
          <p className="max-w-md text-base text-text-secondary">{step.supporting}</p>
          {step.secondary && (
            <p className="mt-2 max-w-md text-sm text-text-muted">{step.secondary}</p>
          )}

          {index === 0 && <WordStagger words={SOURCE_WORDS} focusStrength={focusStrength} />}
          {index === 1 && <SourceRoute focusStrength={focusStrength} />}
          {index === 2 && <QuotationLines rows={QUOTE_LINES} focusStrength={focusStrength} />}
          {index === 3 && (
            <ConfirmProgression stages={CONFIRM_STAGES} focusStrength={focusStrength} />
          )}
          {index === 4 && (
            <>
              <DeliveredWords words={DELIVERED_WORDS} focusStrength={focusStrength} />
              <motion.div style={{ opacity: focusStrength }} className="mt-6">
                <Button href="/build-my-pc" size="lg">
                  Request a PC Quote
                </Button>
              </motion.div>
            </>
          )}
        </motion.div>
      </motion.div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Reduced motion — fully static, order-preserving, nothing hidden     */
/* ------------------------------------------------------------------ */

function StaticProcess() {
  return (
    <Container className="py-16 sm:py-20">
      <ol className="flex flex-col gap-14">
        {STEPS.map((step, i) => (
          <li key={step.heading} className="flex flex-col gap-3">
            <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="font-display text-2xl font-bold leading-tight tracking-tight text-text-primary sm:text-3xl">
              {step.heading}
            </h3>
            <p className="max-w-md text-base text-text-secondary">{step.supporting}</p>
            {step.secondary && <p className="max-w-md text-sm text-text-muted">{step.secondary}</p>}
            {i === 1 && (
              <div className="mt-2 flex max-w-xs items-center gap-3">
                <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
                  U.S.A.
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-accent/60" />
                <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
                  QATAR
                </span>
              </div>
            )}
            {i === STEPS.length - 1 && (
              <div className="mt-2">
                <Button href="/build-my-pc" size="lg">
                  Request a PC Quote
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Container>
  );
}
