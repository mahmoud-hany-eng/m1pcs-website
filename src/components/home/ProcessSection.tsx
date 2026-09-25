"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { Container } from "@/components/ui/Container";

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
 * "Your PC. Your Parts. Your Budget." — the calm, light-themed process
 * section between the dark Featured Spec Story and the dark Built by M1
 * section. Desktop pins a large stage number + headline in a sticky
 * viewport while five stages crossfade over the scroll track; mobile (and
 * reduced motion, any width) gets a plain stacked flow with whileInView
 * reveals — same pattern established in FeaturedSpecScroll.
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
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.7, ease: EASE },
      };

  return (
    <>
      <section className="bg-[#F6F3EE] pb-16 pt-24 sm:pb-20 sm:pt-32 lg:pt-40">
        <Container>
          <motion.h2
            {...introReveal}
            className="font-display text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-[1.02] tracking-tight text-[#1C1917]"
          >
            <span className="block">Your PC.</span>
            <span className="block">Your Parts.</span>
            <span className="block">Your Budget.</span>
          </motion.h2>
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

  useMotionValueEvent(smoothProgress, "change", (p) => {
    stageMotion.forEach(({ opacity, y }, i) => {
      opacity.set(interp(p, ranges[i], opOuts[i]));
      y.set(interp(p, ranges[i], yOuts[i]));
    });
  });

  return (
    // ~240vh: 100svh (minus header) pinned viewport + ~140vh of actual
    // scroll distance the five stages play out over — deliberately
    // shorter/faster than the Featured Spec Story's 300vh.
    <div ref={sectionRef} className="relative h-[240vh] bg-[#F6F3EE]">
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center lg:gap-16">
            <div className="relative h-32 lg:h-40">
              {STAGES.map((stage, i) => (
                <motion.span
                  key={stage.headline}
                  style={{ opacity: stageMotion[i].opacity, y: stageMotion[i].y }}
                  className="absolute inset-0 flex items-center font-display text-[clamp(4rem,9vw,7rem)] font-bold leading-none tracking-tight text-[#1C1917]"
                >
                  {String(i + 1).padStart(2, "0")}
                </motion.span>
              ))}
            </div>

            <div className="relative min-h-[10rem] lg:min-h-[9rem]">
              {STAGES.map((stage, i) => (
                <motion.div
                  key={stage.headline}
                  style={{ opacity: stageMotion[i].opacity, y: stageMotion[i].y }}
                  className="absolute inset-0 flex flex-col justify-center gap-4"
                >
                  <h3 className="font-display text-[clamp(2.25rem,4.5vw,3.75rem)] font-bold leading-[1.05] tracking-tight text-[#1C1917]">
                    {stage.headline}
                  </h3>
                  <p className="max-w-md text-lg text-[#6B6358]">{stage.supporting}</p>
                </motion.div>
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
    <section className="bg-[#F6F3EE] py-20 sm:py-28">
      <Container>
        <div className="flex flex-col gap-14">
          {STAGES.map((stage, i) => (
            <motion.div key={stage.headline} {...reveal(0.05 * i)} className="flex flex-col gap-3">
              <span className="font-display text-4xl font-bold leading-none tracking-tight text-[#1C1917]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-3xl font-bold leading-tight tracking-tight text-[#1C1917] sm:text-4xl">
                {stage.headline}
              </h3>
              <p className="max-w-md text-base text-[#6B6358] sm:text-lg">{stage.supporting}</p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
