"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { Container } from "@/components/ui/Container";

/** Premium, restrained "expo-out" easing — matches CinematicHero. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Piecewise-linear interpolation, clamped at both ends. Used instead of
 * stacking several independent `useTransform(scrollYProgress, ...)` calls
 * for the four stages: with 4 sibling motion.div's each deriving opacity+y
 * from the same parent scroll value via separate useTransform instances,
 * this exact framer-motion version (13.4.1) was observed applying the
 * wrong instance's opacity to the wrong element — confirmed via a
 * MotionValue.on("change") subscription (correct: op0 read 0 past stage 1)
 * against getComputedStyle on the actual DOM node (wrong: showed a
 * different, drifting value) in both dev and a clean production build,
 * ruling out a dev-only/HMR artifact. A single subscription that computes
 * and `.set()`s every derived value itself sidesteps whatever internal
 * scheduling issue that pattern hits.
 */
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

const HERO_IMAGE_SRC = "/hero/featured-build.webp";
const HERO_IMAGE_ALT =
  "M1 Gaming PCs custom build with red interior lighting and tempered glass panels";

interface SpecStage {
  eyebrow: string;
  lines: string[];
  supporting: string;
}

/**
 * Copy cross-checked against existing site wording (siteConfig's "Custom
 * PCs. Built Around You." tagline, the consultation-led/no-fixed-inventory
 * model already described in lib/categories.ts, and the Qatar-built claim
 * already used in the footer and CinematicHero). No specs, prices, or
 * performance numbers are attributed to this particular hero PC — its exact
 * configuration hasn't been confirmed.
 */
const STAGES: SpecStage[] = [
  {
    eyebrow: "BUILT AROUND YOU",
    lines: ["Your build.", "Your requirements."],
    supporting: "Start with what you play, what you need, and your budget.",
  },
  {
    eyebrow: "COMPONENTS",
    lines: ["Chosen together."],
    supporting: "A balanced system starts with choosing the right parts together.",
  },
  {
    eyebrow: "CUSTOM",
    lines: ["No fixed configuration."],
    supporting: "Each system can be tailored around the customer's requirements.",
  },
  {
    eyebrow: "M1 GAMING PCS",
    lines: ["Configured around you."],
    supporting: "Custom gaming PCs built in Qatar.",
  },
];

/**
 * Homepage "Featured PC / Spec Scroll Story" — the one section that uses
 * true scroll-driven storytelling. Desktop pins the hero PC in a sticky
 * viewport while four short stages crossfade over ~200vh of scroll, driven
 * by a single section-level scroll-progress value (not one listener per
 * stage). Mobile (and reduced motion, at any width) instead gets a normal
 * stacked flow with `whileInView` reveals — no sticky pin, no scroll-linked
 * transforms, no artificial scroll length.
 *
 * Continuity with CinematicHero: same image file, same aspect ratio, a
 * similar right-hand position/size, and the sticky container only ever
 * starts rendering pinned once Hero has fully scrolled out of view (Hero
 * isn't sticky), so the two PCs are never visible at once — the hand-off
 * reads as continuous without needing a single shared DOM node.
 */
export function FeaturedSpecScroll() {
  // SSR-safe: both default to the "normal motion, unknown width" state so
  // server and first client paint always agree; corrected after mount via
  // matchMedia. (See CinematicHero for why this can't use Framer's own
  // useReducedMotion() directly — it reads matchMedia synchronously on the
  // client's first render, which caused a real hydration mismatch there.)
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  return (
    <>
      {/* Mobile (always) + reduced-motion (any width): simple stacked flow. */}
      <div className={reduceMotion ? "block" : "lg:hidden"}>
        <SimpleStages reduceMotion={reduceMotion} />
      </div>

      {/* Desktop, normal motion: sticky scroll-driven story. */}
      <div className={reduceMotion ? "hidden" : "hidden lg:block"}>
        <StickyScrollStory />
      </div>
    </>
  );
}

function StageEyebrow({ children }: { children: string }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent sm:text-sm">
      {children}
    </span>
  );
}

function StickyScrollStory() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Whole-PC motion across the ENTIRE sequence — heavy/stationary, not
  // animated per stage. Scale 1 → 1.035, a few px of drift, nothing more.
  const pcScale = useTransform(scrollYProgress, [0, 1], [1, 1.035]);
  const pcX = useTransform(scrollYProgress, [0, 1], [0, 14]);
  const pcY = useTransform(scrollYProgress, [0, 1], [0, -10]);

  // Very subtle ambient warm-up over the whole sequence (one continuous
  // interpolation, not four discrete gradient swaps) — echoes Hero's own
  // low-opacity glow for continuity.
  const glowOpacity = useTransform(scrollYProgress, [0, 1], [0.08, 0.16]);

  // Four fixed stage windows (25% of progress each) with a short internal
  // crossfade at each boundary so at most one stage is ever fully
  // readable. Stage 1 has no fade-in and stage 4 has no fade-out.
  const r0: readonly number[] = [0, 0.19, 0.25];
  const r1: readonly number[] = [0.25, 0.31, 0.44, 0.5];
  const r2: readonly number[] = [0.5, 0.56, 0.69, 0.75];
  const r3: readonly number[] = [0.75, 0.81, 1];

  const opOut0: readonly number[] = [1, 1, 0];
  const opOut1: readonly number[] = [0, 1, 1, 0];
  const opOut2: readonly number[] = [0, 1, 1, 0];
  const opOut3: readonly number[] = [0, 1, 1];

  const yOut0: readonly number[] = [0, 0, -20];
  const yOut1: readonly number[] = [24, 0, 0, -20];
  const yOut2: readonly number[] = [24, 0, 0, -20];
  const yOut3: readonly number[] = [24, 0, 0];

  const op0 = useMotionValue(interp(0, r0, opOut0));
  const op1 = useMotionValue(interp(0, r1, opOut1));
  const op2 = useMotionValue(interp(0, r2, opOut2));
  const op3 = useMotionValue(interp(0, r3, opOut3));
  const y0 = useMotionValue(interp(0, r0, yOut0));
  const y1 = useMotionValue(interp(0, r1, yOut1));
  const y2 = useMotionValue(interp(0, r2, yOut2));
  const y3 = useMotionValue(interp(0, r3, yOut3));

  const stageMotion = [
    { opacity: op0, y: y0 },
    { opacity: op1, y: y1 },
    { opacity: op2, y: y2 },
    { opacity: op3, y: y3 },
  ];

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    op0.set(interp(p, r0, opOut0));
    y0.set(interp(p, r0, yOut0));
    op1.set(interp(p, r1, opOut1));
    y1.set(interp(p, r1, yOut1));
    op2.set(interp(p, r2, opOut2));
    y2.set(interp(p, r2, yOut2));
    op3.set(interp(p, r3, opOut3));
    y3.set(interp(p, r3, yOut3));
  });

  return (
    // ~300vh: 100svh (minus header) for the pinned viewport + ~200vh of
    // actual scroll distance the four stages play out over. Tuned in
    //-browser against the 280–320vh guidance rather than left at a guess.
    <div ref={sectionRef} className="relative h-[300vh]">
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center overflow-hidden bg-background sm:top-20 sm:h-[calc(100svh-5rem)]">
        <motion.div
          aria-hidden="true"
          style={{
            opacity: glowOpacity,
            background:
              "radial-gradient(42% 38% at 74% 46%, rgb(var(--color-primary)) 0%, transparent 72%)",
          }}
          className="pointer-events-none absolute inset-0"
        />

        <Container className="relative flex w-full flex-row-reverse items-center justify-between gap-12 xl:gap-20">
          {/* PC — same asset/position language as CinematicHero, on the
              right, moving only as one continuous whole-sequence drift. */}
          <motion.div
            style={{ scale: pcScale, x: pcX, y: pcY }}
            className="w-full max-w-[420px] shrink-0 xl:max-w-[500px]"
          >
            <div className="relative aspect-[1206/1724] w-full">
              <Image
                src={HERO_IMAGE_SRC}
                alt={HERO_IMAGE_ALT}
                fill
                sizes="(min-width: 1280px) 500px, 420px"
                className="object-contain"
              />
            </div>
          </motion.div>

          {/* Stage text — absolutely stacked in a shared box so stages
              crossfade in place instead of pushing each other around. */}
          <div className="relative min-h-[22rem] w-full max-w-xl lg:min-h-[24rem]">
            {STAGES.map((stage, i) => (
              <motion.div
                key={stage.eyebrow}
                style={{ opacity: stageMotion[i].opacity, y: stageMotion[i].y }}
                className="absolute inset-0 flex flex-col items-start justify-center gap-5"
              >
                <StageEyebrow>{stage.eyebrow}</StageEyebrow>
                <h2 className="font-display text-[clamp(3rem,6vw,6.25rem)] font-bold leading-[0.98] tracking-tight text-text-primary">
                  {stage.lines.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </h2>
                <p className="max-w-md text-lg text-text-secondary">{stage.supporting}</p>
              </motion.div>
            ))}

            {/* Minimal stage indicator — all four numbers stay visible at a
                dim baseline; the active one's brighter twin crossfades on
                top of it, following that stage's own opacity curve. */}
            <div className="absolute -bottom-2 left-0 flex gap-4 lg:-bottom-4">
              {STAGES.map((stage, i) => (
                <span
                  key={stage.eyebrow}
                  className="relative font-display text-xs font-semibold tracking-widest text-text-muted"
                >
                  {String(i + 1).padStart(2, "0")}
                  <motion.span
                    style={{ opacity: stageMotion[i].opacity }}
                    className="absolute inset-0 text-text-primary"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </motion.span>
                </span>
              ))}
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function SimpleStages({ reduceMotion }: { reduceMotion: boolean }) {
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
          viewport: { once: true, margin: "-10% 0px" },
          transition: { duration: 0.6, delay, ease: EASE },
        };

  return (
    <section className="relative overflow-hidden bg-background py-20 sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 35% at 50% 30%, rgb(var(--color-primary) / 0.1) 0%, transparent 72%)",
        }}
      />

      <Container className="relative flex flex-col gap-16">
        <motion.div
          {...reveal(0)}
          className="mx-auto w-full max-w-[320px] sm:max-w-[400px]"
        >
          <div className="relative aspect-[1206/1724] w-full">
            <Image
              src={HERO_IMAGE_SRC}
              alt={HERO_IMAGE_ALT}
              fill
              sizes="(min-width: 640px) 400px, 320px"
              className="object-contain"
            />
          </div>
        </motion.div>

        <div className="flex flex-col gap-14">
          {STAGES.map((stage, i) => (
            <motion.div
              key={stage.eyebrow}
              {...reveal(0.05 * i)}
              className="flex flex-col items-start gap-4"
            >
              <StageEyebrow>{stage.eyebrow}</StageEyebrow>
              <h2 className="font-display text-[clamp(2.25rem,9vw,3.25rem)] font-bold leading-[1.05] tracking-tight text-text-primary">
                {stage.lines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </h2>
              <p className="max-w-md text-base text-text-secondary sm:text-lg">
                {stage.supporting}
              </p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
