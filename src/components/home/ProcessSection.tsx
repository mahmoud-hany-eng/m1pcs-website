"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/SectionHeading";

/** Premium, restrained "expo-out" easing — matches the other homepage sections. */
const EASE = [0.16, 1, 0.3, 1] as const;

interface ProcessStage {
  headline: string;
  supporting: string;
}

/**
 * Copy condensed from the fuller process content on /how-it-works, not
 * invented — including stage 2's U.S.-sourcing differentiator, which
 * /how-it-works now covers in full as its own step. No turnaround times,
 * prices, or guarantees are stated beyond what that page already says.
 */
const STAGES: ProcessStage[] = [
  {
    headline: "Tell us what you need.",
    supporting: "Submit your budget and PC requirements.",
  },
  {
    headline: "We source it from the U.S.",
    supporting:
      "Your selected components are sourced directly from the U.S. based on your requested specification and current availability.",
  },
  {
    headline: "Review your options.",
    supporting: "Review the specifications and request changes if needed.",
  },
  {
    headline: "We build it.",
    supporting: "Once you confirm and complete payment, we prepare and build your order.",
  },
  {
    headline: "Delivered to you.",
    supporting: "Receive your completed order by delivery or collection, as agreed.",
  },
];

/** Piecewise-linear interpolation, clamped at both ends — see FeaturedSpecScroll for why this replaces multiple useTransform instances sharing one parent scroll value. */
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

/**
 * "Your PC. Your Parts. Your Budget." — the process, told inside the glass
 * showroom. Desktop pins one focal glass pane (the section's single L3
 * surface) while five stages crossfade inside it over the scroll track; a
 * warm key light drifts behind the pane with the same scroll value, so the
 * frost visibly shifts as the story advances (and reverses with it).
 * Mobile (and reduced motion, any width) gets a plain stacked flow along a
 * lit rail with whileInView reveals — same pattern as FeaturedSpecScroll.
 */
export function ProcessSection() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  const introReveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.4 },
      }
    : {
        // Depth settle: rises, fades in and comes into focus. Text-only
        // blocks — never applied to a glass pane (a filter on the pane
        // would cut its frost off from the page behind it mid-animation).
        initial: { opacity: 0, y: 24, filter: "blur(8px)" },
        whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.8, ease: EASE },
      };

  return (
    <>
      <section className="relative pb-10 pt-24 sm:pb-14 sm:pt-32 lg:pt-40">
        <Container>
          <motion.div {...introReveal} className="flex flex-col items-start gap-6">
            <Eyebrow>The process</Eyebrow>
            <h2 className="font-display text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-[1.02] tracking-tight text-white">
              <span className="block">Your PC.</span>
              <span className="block">Your Parts.</span>
              <span className="block text-white/55">Your Budget.</span>
            </h2>
          </motion.div>
        </Container>
      </section>

      <div className={reduceMotion ? "block" : "lg:hidden"}>
        <SimpleProcess reduceMotion={reduceMotion} />
      </div>
      <div className={reduceMotion ? "hidden" : "hidden lg:block"}>
        <StickyProcess />
      </div>
    </>
  );
}

function StickyProcess() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Same light spring as FeaturedSpecScroll's sticky story — smooths a
  // fast/large scroll jump into a visible interpolation instead of a
  // teleport, without touching native scroll itself. Only rendered when
  // !reduceMotion (see the lg:hidden/hidden lg:block split below).
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 35,
    mass: 0.2,
  });

  // Five equal 20%-wide stage windows with a short internal crossfade at
  // each boundary. Stage 1 has no fade-in, stage 5 has no fade-out.
  const r0: readonly number[] = [0, 0.15, 0.2];
  const r1: readonly number[] = [0.2, 0.25, 0.35, 0.4];
  const r2: readonly number[] = [0.4, 0.45, 0.55, 0.6];
  const r3: readonly number[] = [0.6, 0.65, 0.75, 0.8];
  const r4: readonly number[] = [0.8, 0.85, 1];
  const ranges = [r0, r1, r2, r3, r4];

  const opOut0: readonly number[] = [1, 1, 0];
  const opOutMid: readonly number[] = [0, 1, 1, 0];
  const opOut4: readonly number[] = [0, 1, 1];
  const opOuts = [opOut0, opOutMid, opOutMid, opOutMid, opOut4];

  const yOut0: readonly number[] = [0, 0, -14];
  const yOutMid: readonly number[] = [24, 0, 0, -14];
  const yOut4: readonly number[] = [24, 0, 0];
  const yOuts = [yOut0, yOutMid, yOutMid, yOutMid, yOut4];

  const op0 = useMotionValue(interp(0, ranges[0], opOuts[0]));
  const op1 = useMotionValue(interp(0, ranges[1], opOuts[1]));
  const op2 = useMotionValue(interp(0, ranges[2], opOuts[2]));
  const op3 = useMotionValue(interp(0, ranges[3], opOuts[3]));
  const op4 = useMotionValue(interp(0, ranges[4], opOuts[4]));
  const y0 = useMotionValue(interp(0, ranges[0], yOuts[0]));
  const y1 = useMotionValue(interp(0, ranges[1], yOuts[1]));
  const y2 = useMotionValue(interp(0, ranges[2], yOuts[2]));
  const y3 = useMotionValue(interp(0, ranges[3], yOuts[3]));
  const y4 = useMotionValue(interp(0, ranges[4], yOuts[4]));

  const stageMotion = [
    { opacity: op0, y: y0 },
    { opacity: op1, y: y1 },
    { opacity: op2, y: y2 },
    { opacity: op3, y: y3 },
    { opacity: op4, y: y4 },
  ];

  // Rail fills (each stage's fifth of the scroll) and the key light's
  // drift behind the pane — all from the same single subscription.
  const f0 = useMotionValue(0);
  const f1 = useMotionValue(0);
  const f2 = useMotionValue(0);
  const f3 = useMotionValue(0);
  const f4 = useMotionValue(0);
  const fills = [f0, f1, f2, f3, f4];
  const glow = useMotionValue(0);
  const glowX = useTransform(glow, (v) => `${-30 + v * 90}%`);
  const amberX = useTransform(glow, (v) => `${40 - v * 70}%`);

  useMotionValueEvent(smoothProgress, "change", (p) => {
    stageMotion.forEach(({ opacity, y }, i) => {
      opacity.set(interp(p, ranges[i], opOuts[i]));
      y.set(interp(p, ranges[i], yOuts[i]));
    });
    fills.forEach((f, i) => f.set(Math.min(1, Math.max(0, p * 5 - i))));
    glow.set(p);
  });

  return (
    // ~240vh: 100svh (minus header) pinned viewport + ~140vh of actual
    // scroll distance the five stages play out over — deliberately
    // shorter/faster than the Featured Spec Story's 300vh.
    <div ref={sectionRef} className="relative h-[240vh]">
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
        {/* Key light + amber fill behind the pane, drifting with scroll
            (transform only) so the frost shifts as the stages advance. */}
        <motion.div
          aria-hidden="true"
          style={{ x: glowX }}
          className="pointer-events-none absolute left-0 top-[18%] h-[64%] w-[46%] rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.34),transparent)]"
        />
        <motion.div
          aria-hidden="true"
          style={{ x: amberX }}
          className="pointer-events-none absolute right-0 top-[40%] h-[50%] w-[34%] rounded-full bg-[radial-gradient(closest-side,rgb(249_194_4/0.12),transparent)]"
        />

        <Container className="relative">
          <div className="glass-strong rounded-glass-lg px-10 pb-10 pt-12 xl:px-14 xl:pt-14">
            <div className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.4fr)] items-center gap-12 xl:gap-16">
              <div className="relative h-36 xl:h-44">
                {STAGES.map((stage, i) => (
                  <motion.span
                    key={stage.headline}
                    style={{ opacity: stageMotion[i].opacity, y: stageMotion[i].y }}
                    className="absolute inset-0 flex items-center bg-gradient-to-b from-white via-white/80 to-white/25 bg-clip-text font-display text-[clamp(5rem,10vw,9rem)] font-bold leading-none tracking-tight text-transparent"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </motion.span>
                ))}
              </div>

              <div className="relative min-h-[11rem]">
                {STAGES.map((stage, i) => (
                  <motion.div
                    key={stage.headline}
                    style={{ opacity: stageMotion[i].opacity, y: stageMotion[i].y }}
                    className="absolute inset-0 flex flex-col justify-center gap-4"
                  >
                    <h3 className="font-display text-[clamp(2.25rem,4.2vw,3.75rem)] font-bold leading-[1.05] tracking-tight text-white">
                      {stage.headline}
                    </h3>
                    <p className="max-w-lg text-lg text-text-secondary">{stage.supporting}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Five-step rail, scrubbed by the same scroll value. */}
            <div className="mt-10 grid grid-cols-5 gap-3" aria-hidden="true">
              {STAGES.map((stage, i) => (
                <div key={stage.headline} className="flex flex-col gap-2.5">
                  <span className="h-[3px] overflow-hidden rounded-full bg-white/[0.1]">
                    <motion.span style={{ scaleX: fills[i] }} className="block h-full w-full origin-left rounded-full bg-accent" />
                  </span>
                  <span className="relative font-display text-xs font-semibold tracking-widest text-text-muted">
                    {String(i + 1).padStart(2, "0")}
                    <motion.span style={{ opacity: stageMotion[i].opacity }} className="absolute inset-0 text-white">
                      {String(i + 1).padStart(2, "0")}
                    </motion.span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function SimpleProcess({ reduceMotion }: { reduceMotion: boolean }) {
  const reveal = (delay = 0) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          whileInView: { opacity: 1 },
          viewport: { once: true, margin: "-10% 0px" },
          transition: { duration: 0.4, delay },
        }
      : {
          initial: { opacity: 0, y: 20 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: false, margin: "-20% 0px" },
          transition: { duration: 0.6, delay, ease: EASE },
        };

  return (
    <section className="relative pb-20 pt-6 sm:pb-28">
      <Container>
        <ol className="relative flex flex-col gap-12">
          {/* the lit rail the stages hang from */}
          <span aria-hidden="true" className="absolute bottom-6 left-[1.2rem] top-6 w-px bg-gradient-to-b from-accent/50 via-white/15 to-transparent" />
          {STAGES.map((stage, i) => (
            <motion.li key={stage.headline} {...reveal(0.05 * i)} className="relative grid grid-cols-[auto_1fr] items-start gap-5">
              <span className="glass-subtle flex h-10 w-10 items-center justify-center rounded-full font-display text-sm font-bold tracking-wide text-white">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex flex-col gap-2 pt-1">
                <h3 className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                  {stage.headline}
                </h3>
                <p className="max-w-md text-base text-text-secondary sm:text-lg">{stage.supporting}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
