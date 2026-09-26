"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import {
  CaseIcon,
  CheckIcon,
  CpuIcon,
  ParcelIcon,
  ReceiptIcon,
} from "./icons";
import {
  SceneConfirm,
  SceneDelivered,
  SceneParts,
  SceneQuotation,
  SceneSourcing,
} from "./scenes";

interface ProcessStep {
  heading: string;
  body: string;
  secondary?: string;
  Scene: (props: { progress: MotionValue<number> }) => React.ReactElement;
  StaticIcon: (props: { size?: number }) => React.ReactElement;
}

/** Copy verbatim from the brief. */
const STEPS: ProcessStep[] = [
  {
    heading: "Pick Your Parts",
    body: "Tell us your budget, performance needs and preferred design. We help you choose the right parts for your build.",
    Scene: SceneParts,
    StaticIcon: CpuIcon,
  },
  {
    heading: "Review Your Quotation",
    body: "You receive a detailed quotation with your selected components, current pricing and estimated shipping timeframe.",
    Scene: SceneQuotation,
    StaticIcon: ReceiptIcon,
  },
  {
    heading: "Confirm Your Order",
    body: "Once you approve the quotation, a deposit confirms your order. You receive a payment receipt and confirmation that the order has been placed.",
    Scene: SceneConfirm,
    StaticIcon: CheckIcon,
  },
  {
    heading: "Sourced From The U.S.",
    body: "When requested, we source your parts directly from the U.S. and ship them to Qatar with live shipment tracking.",
    Scene: SceneSourcing,
    StaticIcon: ParcelIcon,
  },
  {
    heading: "Built. Set Up. Delivered.",
    body: "Once the parts arrive, M1 assembles and sets up your PC with Windows 11 Pro, drivers and updates so it is ready to use.",
    secondary: "Pickup or delivery can then be arranged.",
    Scene: SceneDelivered,
    StaticIcon: CaseIcon,
  },
];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Each step holds a 20%-wide scroll window: mostly flat (the scene fully
// resolved and readable), with the last 40% smoothly morphing into the
// next. Same shape already proven on this page — generous hold, a real
// scroll distance for the transition, fully reversible since focus is a
// pure function of scroll position.
const FOCUS_INPUT: number[] = [0, 0.1, 0.18, 0.3, 0.38, 0.5, 0.58, 0.7, 0.78, 1.0];
const FOCUS_OUTPUT: number[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];

/**
 * The "How It Works" process story — a cinematic scroll-driven scene
 * sequence on desktop (one illustrated scene centred at a time, morphing
 * into the next as the user scrolls), a lighter per-step version on mobile
 * that keeps native scrolling, and a fully static fallback under reduced
 * motion. Every visual value is a pure function of scroll position, so
 * every transition is bidirectional by construction.
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

  if (reduceMotion) return <StaticStory />;
  if (isMobile) return <MobileStory />;
  return <DesktopStory />;
}

/* ------------------------------------------------------------------ */
/* Desktop — cinematic scroll-driven scene sequence                    */
/* ------------------------------------------------------------------ */

function DesktopStory() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, { stiffness: 170, damping: 34, mass: 0.25 });
  const focus = useTransform(smoothProgress, FOCUS_INPUT, FOCUS_OUTPUT);

  const [activeStep, setActiveStep] = useState(0);
  useMotionValueEvent(focus, "change", (f) => {
    const idx = Math.min(4, Math.max(0, Math.round(f)));
    setActiveStep((prev) => (prev === idx ? prev : idx));
  });

  return (
    <div ref={sectionRef} className="relative h-[650vh] bg-background">
      <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
        <Container className="flex h-full flex-col items-center justify-center gap-3 sm:gap-5">
          <p className="font-display text-xs font-semibold tracking-[0.25em] text-text-muted">
            {String(activeStep + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </p>

          {/* The dominant element: a tall stage whose own SceneFrame
              centres the desk/character tableau within it, so the scene's
              visual weight sits at the middle of the stage rather than
              pinned low with dead space above it. */}
          <div className="relative h-[54vh] min-h-[360px] max-w-[720px] w-full sm:max-h-[500px]">
            <StagePanel index={0} step={STEPS[0]} focus={focus} smoothProgress={smoothProgress} />
            <StagePanel index={1} step={STEPS[1]} focus={focus} smoothProgress={smoothProgress} />
            <StagePanel index={2} step={STEPS[2]} focus={focus} smoothProgress={smoothProgress} />
            <StagePanel index={3} step={STEPS[3]} focus={focus} smoothProgress={smoothProgress} />
            <StagePanel index={4} step={STEPS[4]} focus={focus} smoothProgress={smoothProgress} />
          </div>

          <div className="relative h-[7.5rem] w-full max-w-xl text-center sm:h-[6.5rem]">
            <TextPanel index={0} step={STEPS[0]} focus={focus} />
            <TextPanel index={1} step={STEPS[1]} focus={focus} />
            <TextPanel index={2} step={STEPS[2]} focus={focus} />
            <TextPanel index={3} step={STEPS[3]} focus={focus} />
            <TextPanel index={4} step={STEPS[4]} focus={focus} />
          </div>
        </Container>
      </div>
    </div>
  );
}

function useCrossfade(focus: MotionValue<number>, index: number) {
  const distance = useTransform(focus, (f) => index - f);
  const absDistance = useTransform(distance, (d) => Math.abs(d));
  const opacity = useTransform(absDistance, [0, 0.4, 1], [1, 0, 0]);
  const scale = useTransform(absDistance, [0, 1], [1, 0.94]);
  const pointerEvents = useTransform(opacity, (o) => (o < 0.05 ? "none" : "auto"));
  return { opacity, scale, pointerEvents };
}

function StagePanel({
  index,
  step,
  focus,
  smoothProgress,
}: {
  index: number;
  step: ProcessStep;
  focus: MotionValue<number>;
  smoothProgress: MotionValue<number>;
}) {
  const { opacity, scale, pointerEvents } = useCrossfade(focus, index);
  // Distinct from the crossfade's own opacity: this is the scene's own
  // scroll position within its 20%-wide window, rising smoothly from 0 to
  // 1 across the WHOLE window (hold included) — not "how close to active"
  // (which snaps to 1 almost immediately and then stays flat through the
  // whole hold). Multi-beat scenes (coin -> confirmed -> receipt, the
  // sourcing map draw + parcel travel, build -> handoff) need this so
  // their sequence actually plays out as the user scrolls through the
  // step, instead of resolving to its final frame instantly.
  const progress = useTransform(smoothProgress, (p) => clamp01((p - index * 0.2) / 0.2));
  const Scene = step.Scene;
  return (
    <motion.div style={{ opacity, scale, pointerEvents }} className="absolute inset-0">
      <Scene progress={progress} />
    </motion.div>
  );
}

function TextPanel({ index, step, focus }: { index: number; step: ProcessStep; focus: MotionValue<number> }) {
  const { opacity, pointerEvents } = useCrossfade(focus, index);
  const y = useTransform(opacity, [0, 1], [10, 0]);
  return (
    <motion.div style={{ opacity, y, pointerEvents }} className="absolute inset-x-0 top-0">
      <h3 className="font-display text-[clamp(1.75rem,3.4vw,2.75rem)] font-bold leading-[1.08] tracking-tight text-text-primary">
        {step.heading}
      </h3>
      <p className="mx-auto mt-3 max-w-lg text-base text-text-secondary sm:text-lg">{step.body}</p>
      {step.secondary && <p className="mt-1.5 text-sm text-text-muted">{step.secondary}</p>}
      {index === STEPS.length - 1 && (
        <div className="mt-4">
          <Button href="/build-my-pc" size="lg">
            Get a Quote
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile — simplified per-step scroll-linked scenes, native scrolling */
/* ------------------------------------------------------------------ */

function MobileStory() {
  return (
    <Container className="flex flex-col gap-20 py-16 sm:py-20">
      {STEPS.map((step, i) => (
        <MobileStep key={step.heading} step={step} index={i} />
      ))}
    </Container>
  );
}

function MobileStep({ step, index }: { step: ProcessStep; index: number }) {
  const itemRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: itemRef, offset: ["center end", "center start"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 170, damping: 32, mass: 0.25 });
  const deviation = useTransform(smooth, (v) => Math.abs(v - 0.5) * 2);

  const opacity = useTransform(deviation, [0, 0.35, 0.7], [1, 0.4, 0.05]);
  const scale = useTransform(deviation, [0, 0.35, 0.7], [1, 0.96, 0.92]);
  // Monotonic across this item's own visible sweep (unlike deviation-based
  // opacity, which snaps toward "active" and then sits flat) — see the
  // matching comment on desktop's StagePanel for why multi-beat scenes
  // need this rather than a value that stops changing once "close enough".
  const progress = useTransform(smooth, (v) => clamp01((v - 0.15) / 0.55));
  const pointerEvents = useTransform(opacity, (o) => (o < 0.08 ? "none" : "auto"));

  const Scene = step.Scene;

  return (
    <div ref={itemRef} className="flex flex-col items-center text-center">
      <motion.div style={{ opacity, scale, pointerEvents }} className="w-full">
        <p className="font-display text-xs font-semibold tracking-[0.25em] text-text-muted">
          {String(index + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
        </p>
        <div className="relative mx-auto mt-4 h-[270px] w-full max-w-[380px]">
          <Scene progress={progress} />
        </div>
        <h3 className="mt-5 font-display text-2xl font-bold leading-tight tracking-tight text-text-primary">
          {step.heading}
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-base text-text-secondary">{step.body}</p>
        {step.secondary && <p className="mt-1.5 text-sm text-text-muted">{step.secondary}</p>}
        {index === STEPS.length - 1 && (
          <div className="mt-5">
            <Button href="/build-my-pc" size="lg">
              Get a Quote
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reduced motion — fully static, order-preserving, nothing hidden     */
/* ------------------------------------------------------------------ */

function StaticStory() {
  return (
    <Container className="py-16 sm:py-20">
      <ol className="flex flex-col gap-12">
        {STEPS.map((step, i) => {
          const Icon = step.StaticIcon;
          return (
            <li key={step.heading} className="flex flex-col items-start gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-strong bg-surface">
                  <Icon size={26} />
                </div>
                <span className="font-display text-sm font-bold tracking-[0.1em] text-text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="font-display text-2xl font-bold leading-tight tracking-tight text-text-primary sm:text-3xl">
                {step.heading}
              </h3>
              <p className="max-w-md text-base text-text-secondary">{step.body}</p>
              {step.secondary && <p className="max-w-md text-sm text-text-muted">{step.secondary}</p>}
              {i === STEPS.length - 1 && (
                <div className="mt-2">
                  <Button href="/build-my-pc" size="lg">
                    Get a Quote
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Container>
  );
}
