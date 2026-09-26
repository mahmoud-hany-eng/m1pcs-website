"use client";

import Link from "next/link";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { STEPS, sceneLocal, type StoryStep } from "./story";

export type StackLayout = "wide" | "tall";

/**
 * Vertical spacing of the stack. The active step's heading sits at 0 with
 * its body underneath, so the next step needs more room below than the
 * previous step needs above; `lift` re-centres the whole group.
 */
const GEOMETRY: Record<StackLayout, { up: number; down: number; lift: number; neighbourScale: number }> = {
  wide: { up: 132, down: 232, lift: -52, neighbourScale: 0.6 },
  tall: { up: 92, down: 168, lift: -40, neighbourScale: 0.62 },
};

function StepBlock({
  step,
  index,
  focus,
  progress,
  layout,
}: {
  step: StoryStep;
  index: number;
  focus: MotionValue<number>;
  progress: MotionValue<number>;
  layout: StackLayout;
}) {
  const g = GEOMETRY[layout];
  const d = useTransform(focus, (f) => index - f);
  const y = useTransform(d, (v) => (v < 0 ? v * g.up : v * g.down) + g.lift);
  const opacity = useTransform(d, (v) => {
    const a = Math.abs(v);
    return a <= 1 ? 1 - a * 0.7 : Math.max(0, 0.3 - (a - 1) * 0.6);
  });
  const scale = useTransform(d, (v) => 1 - Math.min(1, Math.abs(v)) * (1 - g.neighbourScale));
  const bodyOpacity = useTransform(d, (v) => Math.max(0, 1 - Math.abs(v) * 2.6));
  const pointerEvents = useTransform(d, (v) => (Math.abs(v) < 0.35 ? "auto" : "none"));
  const isLast = index === STEPS.length - 1;
  const ctaOpacity = useTransform(progress, (p) => (isLast ? Math.max(0, Math.min(1, (sceneLocal(p, index) - 0.55) / 0.2)) : 0));
  const ctaEvents = useTransform(ctaOpacity, (o) => (o > 0.5 ? "auto" : "none"));

  const wide = layout === "wide";

  return (
    <motion.li
      style={{ y, opacity, scale, pointerEvents }}
      className="absolute inset-x-0 top-1/2 flex origin-top flex-col items-center text-center"
    >
      <span className="mb-2 font-display text-xs font-bold uppercase tracking-[0.28em] text-accent sm:text-sm">
        Step {String(index + 1).padStart(2, "0")}
      </span>
      <h2
        className={`font-display font-bold leading-[1.05] tracking-tight text-text-primary ${
          wide ? "text-[clamp(2rem,3.1vw,3.2rem)]" : "text-[clamp(1.55rem,6.6vw,2.2rem)]"
        }`}
      >
        {step.headline}
      </h2>
      <motion.p
        style={{ opacity: bodyOpacity }}
        className={`mx-auto mt-3 text-text-secondary ${wide ? "max-w-md text-base lg:text-lg" : "max-w-[34ch] text-[0.95rem] leading-snug"}`}
      >
        {step.body}
      </motion.p>
      {isLast && (
        <motion.div
          style={{ opacity: ctaOpacity, pointerEvents: ctaEvents }}
          className={`flex items-center ${wide ? "mt-5 flex-col gap-3 min-[1400px]:flex-row" : "mt-3 flex-col gap-2"}`}
        >
          <Button href="/build-my-pc" className="whitespace-nowrap">
            Request a PC Quote
          </Button>
          {wide ? (
            <Button href="/completed-builds" variant="outline" className="whitespace-nowrap">
              See Completed Builds
            </Button>
          ) : (
            <Link href="/completed-builds" className="text-sm font-semibold text-text-secondary underline-offset-4 hover:text-accent hover:underline">
              See completed builds
            </Link>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

export function TextStack({
  focus,
  progress,
  layout,
}: {
  focus: MotionValue<number>;
  progress: MotionValue<number>;
  layout: StackLayout;
}) {
  return (
    <ol className="relative h-full w-full list-none" aria-label="How it works, step by step">
      {STEPS.map((step, i) => (
        <StepBlock key={step.id} step={step} index={i} focus={focus} progress={progress} layout={layout} />
      ))}
    </ol>
  );
}

/** Six-segment progress rail; each segment fills with its scene and jumps there on click. */
export function ProgressRail({ progress, onJump }: { progress: MotionValue<number>; onJump: (index: number) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Jump to step">
      {STEPS.map((step, i) => (
        <RailSegment key={step.id} index={i} progress={progress} label={step.headline} onJump={onJump} />
      ))}
    </div>
  );
}

function RailSegment({
  index,
  progress,
  label,
  onJump,
}: {
  index: number;
  progress: MotionValue<number>;
  label: string;
  onJump: (index: number) => void;
}) {
  const fill = useTransform(progress, (p) => sceneLocal(p, index));
  return (
    <button
      type="button"
      onClick={() => onJump(index)}
      aria-label={`Step ${index + 1}: ${label}`}
      className="group relative flex h-6 items-center"
    >
      <span className="relative block h-1 w-7 overflow-hidden rounded-full bg-white/15 transition-colors group-hover:bg-white/25 sm:w-9">
        <motion.span style={{ scaleX: fill }} className="absolute inset-0 origin-left rounded-full bg-accent" />
      </span>
    </button>
  );
}
