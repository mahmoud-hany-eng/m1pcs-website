"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

const EASE = [0.16, 1, 0.3, 1] as const;

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

/** Piecewise-linear interpolation, clamped at both ends — same small helper
 *  already used identically in FeaturedSpecScroll/ProcessSection, kept
 *  local to this file per that same convention rather than shared. */
function interp(t: number, input: readonly number[], output: readonly number[]): number {
  if (t <= input[0]) return output[0];
  const last = input.length - 1;
  if (t >= input[last]) return output[last];
  for (let i = 0; i < last; i++) {
    if (t >= input[i] && t <= input[i + 1]) {
      const span = input[i + 1] - input[i];
      const localT = span === 0 ? 0 : (t - input[i]) / span;
      return output[i] + (output[i + 1] - output[i]) * localT;
    }
  }
  return output[last];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * The full "How It Works" story — a sticky scroll-linked two-column
 * editorial piece on desktop (own animation identity per step, not the
 * homepage's template repeated), a native vertical timeline on mobile, and
 * a fully-visible static list under reduced motion. Same state-driven
 * scroll architecture as ProcessSection/FeaturedSpecScroll: one shared
 * useScroll + useSpring source, many cheap motion values updated from a
 * single useMotionValueEvent listener, so every transition is bidirectional
 * by construction (there is no separate "reverse" animation to get wrong —
 * scrolling up just re-evaluates the same pure functions at a smaller p).
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
  if (isMobile) return <TimelineProcess />;
  return <StickyProcessStory />;
}

/* ------------------------------------------------------------------ */
/* Desktop — sticky two-column scroll story                            */
/* ------------------------------------------------------------------ */

function StickyProcessStory() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Same light spring used by every other scroll-linked story on this site
  // — smooths a fast/large scroll jump into a visible interpolation instead
  // of a teleport, without touching native scroll itself.
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 35,
    mass: 0.2,
  });

  // Five equal 20%-wide windows with a short internal crossfade at each
  // boundary — same shape as the homepage ProcessSection, just five equal
  // buckets instead of a condensed teaser, giving each step more dwell time
  // (the brief asks for enough travel that fast scrolling still reads).
  const r0: readonly number[] = [0, 0.16, 0.2];
  const r1: readonly number[] = [0.2, 0.24, 0.36, 0.4];
  const r2: readonly number[] = [0.4, 0.44, 0.56, 0.6];
  const r3: readonly number[] = [0.6, 0.64, 0.76, 0.8];
  const r4: readonly number[] = [0.8, 0.84, 1];
  const ranges = [r0, r1, r2, r3, r4];

  const opOut0: readonly number[] = [1, 1, 0];
  const opOutMid: readonly number[] = [0, 1, 1, 0];
  const opOut4: readonly number[] = [0, 1, 1];
  const opOuts = [opOut0, opOutMid, opOutMid, opOutMid, opOut4];

  const yOut0: readonly number[] = [0, 0, -16];
  const yOutMid: readonly number[] = [26, 0, 0, -16];
  const yOut4: readonly number[] = [26, 0, 0];
  const yOuts = [yOut0, yOutMid, yOutMid, yOutMid, yOut4];

  const op0 = useMotionValue(0);
  const op1 = useMotionValue(0);
  const op2 = useMotionValue(0);
  const op3 = useMotionValue(0);
  const op4 = useMotionValue(0);
  const y0 = useMotionValue(0);
  const y1 = useMotionValue(0);
  const y2 = useMotionValue(0);
  const y3 = useMotionValue(0);
  const y4 = useMotionValue(0);
  const stepOpacity = [op0, op1, op2, op3, op4];
  const stepY = [y0, y1, y2, y3, y4];

  // --- Step 1: word stagger ---
  const s1Word0 = useMotionValue(0);
  const s1Word1 = useMotionValue(0);
  const s1Word2 = useMotionValue(0);
  const s1Word3 = useMotionValue(0);
  const s1WordsGroupOp = useMotionValue(1);
  const s1HeadingOp = useMotionValue(0);
  const s1HeadingY = useMotionValue(16);

  // --- Step 2: sourcing line ---
  const s2HeadingOp = useMotionValue(0);
  const s2HeadingY = useMotionValue(16);
  const s2LineScale = useMotionValue(0);
  const s2DotX = useMotionValue(0);
  const s2DotOp = useMotionValue(0);
  const s2EndOp = useMotionValue(0.3);

  // --- Step 3: quotation lines ---
  const s3HeadingOp = useMotionValue(0);
  const s3HeadingY = useMotionValue(16);
  const s3Row0 = useMotionValue(0);
  const s3Row1 = useMotionValue(0);
  const s3Row2 = useMotionValue(0);
  const s3Row3 = useMotionValue(0);
  const s3Row4 = useMotionValue(0);
  const s3Rows: [
    typeof s3Row0,
    typeof s3Row1,
    typeof s3Row2,
    typeof s3Row3,
    typeof s3Row4,
  ] = [s3Row0, s3Row1, s3Row2, s3Row3, s3Row4];

  // --- Step 4: confirmation progression ---
  const s4HeadingOp = useMotionValue(0);
  const s4HeadingY = useMotionValue(16);
  const s4Stage0 = useMotionValue(0.3);
  const s4Stage1 = useMotionValue(0.3);
  const s4Stage2 = useMotionValue(0.3);
  const s4Stages = [s4Stage0, s4Stage1, s4Stage2];
  const s4Connector0 = useMotionValue(0);
  const s4Connector1 = useMotionValue(0);

  // --- Step 5: delivered words ---
  const s5HeadingOp = useMotionValue(0);
  const s5HeadingY = useMotionValue(16);
  const s5Word0 = useMotionValue(0.3);
  const s5Word1 = useMotionValue(0.3);
  const s5Word2 = useMotionValue(0.3);
  const s5Word3 = useMotionValue(0.3);
  const s5Words = [s5Word0, s5Word1, s5Word2, s5Word3];
  const s5SecondaryOp = useMotionValue(0);

  // Continuous progress-line fill for the left rail (0 -> 1 across the
  // whole story) and the discrete "which number is active" state (used for
  // bold/muted styling, which can't be a continuous motion value).
  const railFill = useTransform(smoothProgress, [0, 1], [0, 1]);
  const [activeStep, setActiveStep] = useState(0);

  useMotionValueEvent(smoothProgress, "change", (p) => {
    stepOpacity.forEach((mv, i) => mv.set(interp(p, ranges[i], opOuts[i])));
    stepY.forEach((mv, i) => mv.set(interp(p, ranges[i], yOuts[i])));

    const idx = Math.min(4, Math.max(0, Math.floor(p * 5)));
    setActiveStep((prev) => (prev === idx ? prev : idx));

    // local progress within each step's own full window (0 at that step's
    // start, 1 at its end) — every per-step internal animation below is a
    // pure function of this, so it's automatically reversible.
    const local1 = clamp01((p - r0[0]) / (r0[2] - r0[0]));
    s1Word0.set(interp(local1, [0, 0.16], [0, 1]));
    s1Word1.set(interp(local1, [0.08, 0.24], [0, 1]));
    s1Word2.set(interp(local1, [0.16, 0.32], [0, 1]));
    s1Word3.set(interp(local1, [0.24, 0.4], [0, 1]));
    s1WordsGroupOp.set(interp(local1, [0, 0.05, 0.55, 0.7], [0, 1, 1, 0]));
    s1HeadingOp.set(interp(local1, [0.55, 0.75], [0, 1]));
    s1HeadingY.set(interp(local1, [0.55, 0.75], [16, 0]));

    const local2 = clamp01((p - r1[0]) / (r1[3] - r1[0]));
    s2HeadingOp.set(interp(local2, [0, 0.18], [0, 1]));
    s2HeadingY.set(interp(local2, [0, 0.18], [16, 0]));
    s2LineScale.set(interp(local2, [0.2, 0.8], [0, 1]));
    s2DotOp.set(interp(local2, [0.18, 0.28], [0, 1]));
    s2DotX.set(interp(local2, [0.2, 0.82], [0, 100]));
    s2EndOp.set(interp(local2, [0.7, 0.9], [0.3, 1]));

    const local3 = clamp01((p - r2[0]) / (r2[3] - r2[0]));
    s3HeadingOp.set(interp(local3, [0, 0.16], [0, 1]));
    s3HeadingY.set(interp(local3, [0, 0.16], [16, 0]));
    s3Rows.forEach((mv, i) => {
      const start = 0.22 + i * 0.11;
      mv.set(interp(local3, [start, start + 0.14], [0, 1]));
    });

    const local4 = clamp01((p - r3[0]) / (r3[3] - r3[0]));
    s4HeadingOp.set(interp(local4, [0, 0.16], [0, 1]));
    s4HeadingY.set(interp(local4, [0, 0.16], [16, 0]));
    s4Stages[0].set(interp(local4, [0.2, 0.32], [0.3, 1]));
    s4Connector0.set(interp(local4, [0.3, 0.45], [0, 1]));
    s4Stages[1].set(interp(local4, [0.42, 0.54], [0.3, 1]));
    s4Connector1.set(interp(local4, [0.52, 0.67], [0, 1]));
    s4Stages[2].set(interp(local4, [0.64, 0.76], [0.3, 1]));
  });

  // Step 5's local progress must reach 1 well before the section itself
  // ends (r4's own end is the whole story's end), so its content settles
  // instead of feeling perpetually mid-reveal at the final resting scroll
  // position.
  useMotionValueEvent(smoothProgress, "change", (p) => {
    const local5 = clamp01((p - r4[0]) / (r4[2] - r4[0]));
    s5HeadingOp.set(interp(local5, [0, 0.16], [0, 1]));
    s5HeadingY.set(interp(local5, [0, 0.16], [16, 0]));
    s5Words.forEach((mv, i) => {
      const start = 0.22 + i * 0.09;
      mv.set(interp(local5, [start, start + 0.12], [0.3, 1]));
    });
    s5SecondaryOp.set(interp(local5, [0.65, 0.85], [0, 1]));
  });

  return (
    <div ref={sectionRef} className="relative h-[600vh] bg-background">
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
        <Container>
          <div className="grid grid-cols-[auto_1fr] gap-16 xl:gap-24">
            {/* Left — sticky, spatially stable nav */}
            <div className="flex gap-6 pt-2">
              <div className="relative w-px shrink-0 bg-border">
                <motion.div
                  aria-hidden="true"
                  style={{ scaleY: railFill }}
                  className="absolute inset-0 w-px origin-top bg-accent"
                />
              </div>
              <nav aria-label="Process steps" className="flex flex-col gap-9">
                {STEPS.map((step, i) => (
                  <span
                    key={step.heading}
                    aria-current={activeStep === i ? "step" : undefined}
                    className={`font-display text-sm font-semibold tracking-[0.15em] transition-colors duration-300 ${
                      activeStep === i ? "text-text-primary" : "text-text-muted"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                ))}
              </nav>
            </div>

            {/* Right — the current step's editorial composition */}
            <div className="relative min-h-[22rem] max-w-2xl">
              <StepPanel index={0} opacity={op0} y={y0}>
                <StepNumberGhost n={1} />
                <WordStagger
                  words={SOURCE_WORDS}
                  wordOps={[s1Word0, s1Word1, s1Word2, s1Word3]}
                  groupOpacity={s1WordsGroupOp}
                />
                <HeadingBlock
                  heading={STEPS[0].heading}
                  supporting={STEPS[0].supporting}
                  opacity={s1HeadingOp}
                  y={s1HeadingY}
                />
              </StepPanel>

              <StepPanel index={1} opacity={op1} y={y1}>
                <StepNumberGhost n={2} />
                <motion.div style={{ opacity: s2HeadingOp, y: s2HeadingY }}>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    Important
                  </p>
                  <h3 className="mt-3 font-display text-[clamp(2rem,3.5vw,3.25rem)] font-bold leading-[1.05] tracking-tight text-text-primary">
                    {STEPS[1].heading}
                  </h3>
                  <p className="mt-4 max-w-md text-lg text-text-secondary">{STEPS[1].supporting}</p>
                  {STEPS[1].secondary && (
                    <p className="mt-2 max-w-md text-sm text-text-muted">{STEPS[1].secondary}</p>
                  )}
                </motion.div>
                <SourceRoute
                  lineScale={s2LineScale}
                  dotX={s2DotX}
                  dotOpacity={s2DotOp}
                  endOpacity={s2EndOp}
                />
              </StepPanel>

              <StepPanel index={2} opacity={op2} y={y2}>
                <StepNumberGhost n={3} />
                <HeadingBlock
                  heading={STEPS[2].heading}
                  supporting={STEPS[2].supporting}
                  opacity={s3HeadingOp}
                  y={s3HeadingY}
                />
                <QuotationLines rows={QUOTE_LINES} rowOps={s3Rows} />
              </StepPanel>

              <StepPanel index={3} opacity={op3} y={y3}>
                <StepNumberGhost n={4} />
                <HeadingBlock
                  heading={STEPS[3].heading}
                  supporting={STEPS[3].supporting}
                  secondary={STEPS[3].secondary}
                  opacity={s4HeadingOp}
                  y={s4HeadingY}
                />
                <ConfirmProgression
                  stages={CONFIRM_STAGES}
                  stageOps={s4Stages}
                  connectorOps={[s4Connector0, s4Connector1]}
                />
              </StepPanel>

              <StepPanel index={4} opacity={op4} y={y4}>
                <StepNumberGhost n={5} />
                <HeadingBlock
                  heading={STEPS[4].heading}
                  supporting={STEPS[4].supporting}
                  opacity={s5HeadingOp}
                  y={s5HeadingY}
                />
                <DeliveredWords words={DELIVERED_WORDS} wordOps={s5Words} />
                {STEPS[4].secondary && (
                  <motion.p
                    style={{ opacity: s5SecondaryOp }}
                    className="mt-4 max-w-md text-sm text-text-muted"
                  >
                    {STEPS[4].secondary}
                  </motion.p>
                )}
                <motion.div style={{ opacity: s5SecondaryOp }} className="mt-8">
                  <Button href="/build-my-pc" size="lg">
                    Request a PC Quote
                  </Button>
                </motion.div>
              </StepPanel>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function StepPanel({
  index,
  opacity,
  y,
  children,
}: {
  index: number;
  opacity: ReturnType<typeof useMotionValue<number>>;
  y: ReturnType<typeof useMotionValue<number>>;
  children: React.ReactNode;
}) {
  return (
    <motion.div data-step={index} style={{ opacity, y }} className="absolute inset-0">
      {children}
    </motion.div>
  );
}

/** A large, faint step numeral behind the heading — "oversized step number
 *  used subtly as composition/depth", purely decorative. */
function StepNumberGhost({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -left-4 -top-16 select-none font-display text-[12rem] font-bold leading-none tracking-tight text-text-primary/[0.04] xl:text-[15rem]"
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}

function HeadingBlock({
  heading,
  supporting,
  secondary,
  opacity,
  y,
}: {
  heading: string;
  supporting: string;
  secondary?: string;
  opacity: ReturnType<typeof useMotionValue<number>>;
  y: ReturnType<typeof useMotionValue<number>>;
}) {
  return (
    <motion.div style={{ opacity, y }} className="relative">
      <h3 className="font-display text-[clamp(2rem,3.5vw,3.25rem)] font-bold leading-[1.05] tracking-tight text-text-primary">
        {heading}
      </h3>
      <p className="mt-4 max-w-md text-lg text-text-secondary">{supporting}</p>
      {secondary && <p className="mt-2 max-w-md text-sm text-text-muted">{secondary}</p>}
    </motion.div>
  );
}

/** Step 1 — BUDGET / PERFORMANCE / DESIGN / USE CASE enter individually
 *  with a subtle staggered rise before the group hands off to the real
 *  heading. */
function WordStagger({
  words,
  wordOps,
  groupOpacity,
}: {
  words: string[];
  wordOps: [
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
  ];
  groupOpacity: ReturnType<typeof useMotionValue<number>>;
}) {
  // Fixed 4-element tuple, always unrolled (never mapped) so these stay
  // top-level hook calls with a stable count/order every render.
  const wordY: [
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
  ] = [
    useTransform(wordOps[0], [0, 1], [14, 0]),
    useTransform(wordOps[1], [0, 1], [14, 0]),
    useTransform(wordOps[2], [0, 1], [14, 0]),
    useTransform(wordOps[3], [0, 1], [14, 0]),
  ];
  return (
    <motion.div
      style={{ opacity: groupOpacity }}
      className="absolute inset-x-0 top-0 flex flex-col gap-2"
    >
      {words.map((word, i) => (
        <motion.span
          key={word}
          style={{ opacity: wordOps[i], y: wordY[i] }}
          className="font-display text-[clamp(1.75rem,3vw,2.75rem)] font-bold tracking-tight text-text-muted"
        >
          {word}
        </motion.span>
      ))}
    </motion.div>
  );
}

/** Step 2 — the section's strongest visual moment: a minimal abstract
 *  sourcing route (no map, no plane, no logos) that draws progressively
 *  with scroll, with a small marker travelling along it. */
function SourceRoute({
  lineScale,
  dotX,
  dotOpacity,
  endOpacity,
}: {
  lineScale: ReturnType<typeof useMotionValue<number>>;
  dotX: ReturnType<typeof useMotionValue<number>>;
  dotOpacity: ReturnType<typeof useMotionValue<number>>;
  endOpacity: ReturnType<typeof useMotionValue<number>>;
}) {
  const dotLeft = useTransform(dotX, (v) => `${v}%`);
  return (
    <div className="mt-16 flex max-w-lg items-center gap-5">
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
 *  fake prices, rows assembling progressively. */
function QuotationLines({
  rows,
  rowOps,
}: {
  rows: string[];
  rowOps: [
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
    ReturnType<typeof useMotionValue<number>>,
  ];
}) {
  // Fixed 5-element tuple, always unrolled — see WordStagger's comment.
  const rowYs: [
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
    ReturnType<typeof useTransform<number, number>>,
  ] = [
    useTransform(rowOps[0], [0, 1], [10, 0]),
    useTransform(rowOps[1], [0, 1], [10, 0]),
    useTransform(rowOps[2], [0, 1], [10, 0]),
    useTransform(rowOps[3], [0, 1], [10, 0]),
    useTransform(rowOps[4], [0, 1], [10, 0]),
  ];
  return (
    <div className="mt-10 flex max-w-sm flex-col divide-y divide-border border-t border-border">
      {rows.map((row, i) => (
        <motion.div
          key={row}
          style={{ opacity: rowOps[i], y: rowYs[i] }}
          className="flex items-center justify-between py-3"
        >
          <span className="text-sm font-semibold uppercase tracking-[0.15em] text-text-secondary">
            {row}
          </span>
          <span aria-hidden="true" className="h-px w-16 bg-border-strong" />
        </motion.div>
      ))}
    </div>
  );
}

/** Step 4 — DEPOSIT -> ORDER CONFIRMED -> TRACKING, revealing sequentially,
 *  no invented order/tracking numbers. */
function ConfirmProgression({
  stages,
  stageOps,
  connectorOps,
}: {
  stages: string[];
  stageOps: ReturnType<typeof useMotionValue<number>>[];
  connectorOps: ReturnType<typeof useMotionValue<number>>[];
}) {
  return (
    <div className="mt-10 flex max-w-lg flex-wrap items-center gap-3">
      {stages.map((stage, i) => (
        <div key={stage} className="flex items-center gap-3">
          <motion.span
            style={{ opacity: stageOps[i] }}
            className="font-display text-sm font-bold uppercase tracking-[0.15em] text-text-primary"
          >
            {stage}
          </motion.span>
          {i < stages.length - 1 && (
            <motion.span
              aria-hidden="true"
              style={{ opacity: connectorOps[i] }}
              className="text-text-muted"
            >
              &rarr;
            </motion.span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Step 5 — BUILD / SETUP / READY / DELIVERED progressing as a restrained
 *  checklist-style highlight, reusing the site's existing visual language
 *  rather than a new photo. */
function DeliveredWords({
  words,
  wordOps,
}: {
  words: string[];
  wordOps: ReturnType<typeof useMotionValue<number>>[];
}) {
  return (
    <div className="mt-10 flex max-w-lg flex-wrap gap-x-6 gap-y-3">
      {words.map((word, i) => (
        <motion.span
          key={word}
          style={{ opacity: wordOps[i] }}
          className="font-display text-xl font-bold tracking-tight text-text-primary sm:text-2xl"
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile — native vertical timeline                                   */
/* ------------------------------------------------------------------ */

function TimelineProcess() {
  return (
    <Container className="py-16 sm:py-20">
      <ol className="flex flex-col">
        {STEPS.map((step, i) => (
          <TimelineStep key={step.heading} step={step} index={i} isLast={i === STEPS.length - 1} />
        ))}
      </ol>
    </Container>
  );
}

function TimelineStep({
  step,
  index,
  isLast,
}: {
  step: ProcessStep;
  index: number;
  isLast: boolean;
}) {
  const reveal = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: false, margin: "-30% 0px -30% 0px" },
    transition: { duration: 0.6, ease: EASE },
  };

  return (
    <li className="grid grid-cols-[2rem_1fr] gap-6 sm:grid-cols-[2.5rem_1fr]">
      <div className="flex flex-col items-center">
        <motion.span
          {...reveal}
          className="font-display text-sm font-bold tracking-[0.1em] text-text-primary"
        >
          {String(index + 1).padStart(2, "0")}
        </motion.span>
        {!isLast && <span aria-hidden="true" className="mt-2 w-px flex-1 bg-border" />}
      </div>

      <motion.div {...reveal} className="pb-14">
        <h3 className="font-display text-2xl font-bold leading-tight tracking-tight text-text-primary sm:text-3xl">
          {step.heading}
        </h3>
        <p className="mt-3 max-w-md text-base text-text-secondary">{step.supporting}</p>
        {step.secondary && (
          <p className="mt-2 max-w-md text-sm text-text-muted">{step.secondary}</p>
        )}
        {index === 1 && (
          <div className="mt-6 flex max-w-xs items-center gap-3">
            <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
              U.S.A.
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-accent/60" />
            <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
              QATAR
            </span>
          </div>
        )}
        {index === STEPS.length - 1 && (
          <div className="mt-6">
            <Button href="/build-my-pc" size="lg">
              Request a PC Quote
            </Button>
          </div>
        )}
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
