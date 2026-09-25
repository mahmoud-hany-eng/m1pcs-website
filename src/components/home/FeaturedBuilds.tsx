"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DM_Serif_Display } from "next/font/google";
import { AnimatePresence, motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { BuildImageFrame, buildImageTransform } from "@/components/cards/BuildImageFrame";
import { completedBuilds } from "@/lib/builds";
import type { CompletedBuild } from "@/types";

/**
 * Homepage-only editorial accent — scoped to this file, not the root
 * layout, so it's only ever fetched on pages that render this component
 * (the homepage), never loaded site-wide. Used for exactly one heading.
 *
 * Replaces Instrument Serif: that face draws numeral "1" as a plain
 * vertical stroke indistinguishable from lowercase "l" (confirmed by
 * rendering both glyphs side by side), which no amount of weight/spacing
 * could fix. DM Serif Display keeps the same elegant, high-contrast
 * editorial character but draws "1" with a real top flag and base serif,
 * so it reads unmistakably as a numeral at the same weight as the rest of
 * the phrase — no bold/size trick needed, no second font.
 */
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  style: "normal",
  display: "swap",
});

const EASE = [0.16, 1, 0.3, 1] as const;
/** Symmetric ease-in-out (unlike the sitewide expo-out EASE above, which is
 *  nearly done within the first third of its duration) — the runway needs a
 *  visible acceleration into the move and deceleration out of it, with zero
 *  bounce/overshoot, so a build crossing the depth field reads as travel
 *  through space rather than a snap-then-drift. */
const RUNWAY_EASE = [0.65, 0, 0.35, 1] as const;
const RUNWAY_TRANSITION = { duration: 0.9, ease: RUNWAY_EASE } as const;
const RUNWAY_TRANSITION_REDUCED = { duration: 0 } as const;

/** Piecewise-linear interpolation, clamped at both ends — same small helper
 *  already used identically in FeaturedSpecScroll/ProcessSection, kept local
 *  to this file per that same convention rather than shared. */
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
 * A build's on-stage depth is expressed as a single signed integer `d`,
 * relative to the active build: d=0 is active/foreground, d=1..4 are the
 * receding background queue (BACK), and d=-1/-2 are the "just handed off
 * focus" exit path (EXIT) the previous active build travels along as it's
 * replaced. Every visual property below is a pure function of `d`, so the
 * whole runway is state-driven from `activeIndex` alone — no imperative
 * animation sequencing, which is what makes rapid/rapid-reversed navigation
 * converge cleanly (Framer Motion just retargets mid-flight) and makes
 * every transition automatically reversible (going "previous" is simply the
 * same function evaluated at a different `d`, not a separate animation).
 */
interface DepthPoints {
  d: readonly number[];
  x: readonly number[];
  y: readonly number[];
  scale: readonly number[];
  opacity: readonly number[];
  blur: readonly number[];
}

const DEPTH_DESKTOP: DepthPoints = {
  d: [-2, -1, 0, 1, 2, 3, 4],
  x: [34, 20, 0, -30, -52, -70, -84],
  y: [16, 9, 0, -10, -19, -27, -33],
  scale: [0.68, 0.85, 1, 0.8, 0.6, 0.42, 0.34],
  opacity: [0, 0, 1, 0.78, 0.52, 0.3, 0],
  blur: [0, 0, 0, 0.5, 1.5, 3, 4],
};

const DEPTH_MOBILE: DepthPoints = {
  d: [-1, 0, 1, 2, 3],
  x: [24, 0, -30, -50, -60],
  y: [12, 0, -10, -17, -21],
  scale: [0.78, 1, 0.64, 0.46, 0.34],
  opacity: [0, 1, 0.6, 0.28, 0],
  blur: [0, 0, 1, 2, 3],
};

function depthStyle(d: number, points: DepthPoints) {
  return {
    x: interp(d, points.d, points.x),
    y: interp(d, points.d, points.y),
    scale: interp(d, points.d, points.scale),
    opacity: interp(d, points.d, points.opacity),
    blur: interp(d, points.d, points.blur),
  };
}

/** Exiting builds fly forward and past the viewer (in front of the whole
 *  depth stack) rather than sinking behind it, matching "foreground →
 *  exit"; the background queue is layered strictly by how far back it is. */
function depthZIndex(d: number): number {
  return d <= 0 ? 100 + Math.round(Math.abs(d) * 3) : 100 - Math.round(d * 10);
}

/**
 * Homepage "Built by M1" showcase — a depth-runway gallery (not a card
 * carousel): the active build is the large, sharp foreground hero, three
 * more recede into a soft, scaled-down, blurred background queue, and the
 * build just replaced travels forward past the viewer and fades. Every
 * build's transform is recomputed from `activeIndex` on every render (see
 * `depthStyle`), so this stays correct under rapid/rapid-reversed input.
 */
export function FeaturedBuilds() {
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

  const railReveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.4, delay: 0.1 },
      }
    : {
        initial: { opacity: 0, y: 20 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.6, delay: 0.15, ease: EASE },
      };

  return (
    <section className="overflow-x-clip bg-background py-24 sm:py-28 lg:py-32">
      <Container>
        <motion.div {...introReveal} className="max-w-2xl">
          <h2
            className={`${dmSerifDisplay.className} text-[clamp(2.75rem,5.5vw,4.75rem)] font-normal leading-[1.05] tracking-tight text-text-primary`}
          >
            {/* Same font, same weight and size as "Built by" throughout —
                DM Serif Display's numeral already reads clearly as "1" on
                its own, so no bold/size trick is needed. A hair of extra
                letter-spacing on "M1." is purely optical breathing room
                between the glyphs, not a different treatment. */}
            Built by <span className="tracking-[0.015em]">M1.</span>
          </h2>
          <p className="mt-4 text-lg text-text-secondary sm:text-xl">
            Real systems.
            <br />
            Built for real customers.
          </p>
        </motion.div>
      </Container>

      <motion.div {...railReveal} className="mt-16">
        <Container>
          <PortfolioRunway reduceMotion={reduceMotion} />
        </Container>
      </motion.div>
    </section>
  );
}

function PortfolioRunway({ reduceMotion }: { reduceMotion: boolean }) {
  const builds = useMemo(() => completedBuilds.filter((b) => b.imageSrc), []);
  const total = builds.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i + 1) % total);
  }, [total]);
  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i - 1 + total) % total);
  }, [total]);

  // Trackpad/wheel: only ever react to a clearly-horizontal gesture (two
  // finger left/right swipe), so ordinary vertical page scrolling over the
  // section is never intercepted. A short cooldown turns one continuous
  // trackpad gesture into a single "next"/"previous" rather than many.
  const wheelCooldown = useRef(false);
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaX) < 12 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelCooldown.current) return;
      wheelCooldown.current = true;
      if (e.deltaX > 0) goNext();
      else goPrev();
      window.setTimeout(() => {
        wheelCooldown.current = false;
      }, 450);
    },
    [goNext, goPrev]
  );

  // Pointer-based swipe/drag: covers mouse-drag on desktop and touch swipe
  // on mobile through one code path. `touchAction: pan-y` on the stage
  // leaves native vertical scrolling to the browser; only a clearly
  // horizontal release gesture changes the active build.
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
      if (dx < 0) goNext();
      else goPrev();
    },
    [goNext, goPrev]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    }
  }

  const points = isMobile ? DEPTH_MOBILE : DEPTH_DESKTOP;
  const activeBuild = builds[activeIndex];

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-4">
      <div
        role="region"
        aria-label="Completed builds gallery"
        aria-roledescription="carousel"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{ touchAction: "pan-y" }}
        className="relative order-1 mx-auto aspect-[4/5] w-full max-w-[300px] shrink-0 sm:max-w-[400px] lg:order-2 lg:mx-0 lg:ml-auto lg:max-w-[520px] xl:max-w-[560px]"
      >
        {builds.map((build, i) => {
          let d = i - activeIndex;
          const half = total / 2;
          if (d > half) d -= total;
          if (d <= -half) d += total;
          const clampedD = Math.max(points.d[0], Math.min(points.d[points.d.length - 1], d));
          const s = depthStyle(clampedD, points);
          const isActive = d === 0;

          if (!build.imageSrc) return null;

          return (
            <motion.div
              key={build.slug}
              aria-hidden={!isActive}
              className="absolute inset-0"
              style={{ zIndex: depthZIndex(clampedD), pointerEvents: isActive ? "auto" : "none" }}
              animate={{
                x: `${s.x}%`,
                y: `${s.y}%`,
                scale: s.scale,
                opacity: s.opacity,
                filter: `blur(${s.blur}px)`,
              }}
              whileHover={isActive && !reduceMotion ? { scale: s.scale * 1.015 } : undefined}
              transition={reduceMotion ? RUNWAY_TRANSITION_REDUCED : RUNWAY_TRANSITION}
            >
              {isActive ? (
                <BuildImageFrame
                  src={build.imageSrc}
                  alt={build.imageAlt}
                  scale={build.imageScale}
                  translateX={build.imageTranslateX}
                  translateY={build.imageTranslateY}
                />
              ) : (
                <DepthImage build={build} />
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="order-2 flex flex-col gap-6 lg:order-1 lg:w-[280px] lg:shrink-0 xl:w-[320px]">
        <div className="relative min-h-[200px] sm:min-h-[188px]">
          <AnimatePresence initial={false}>
            <BuildInfo key={activeBuild.slug} build={activeBuild} index={activeIndex} reduceMotion={reduceMotion} />
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-display text-sm font-medium tracking-wide text-text-muted">
            {String(activeIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Previous build"
              onClick={goPrev}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <button
              type="button"
              aria-label="Next build"
              onClick={goNext}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The focused build's identity — restrained on purpose (per the brief, the
 * PCs are the spectacle, the typography stays calm): a short crossfade with
 * a small vertical settle, never the runway's travel/scale/blur.
 */
function BuildInfo({
  build,
  index,
  reduceMotion,
}: {
  build: CompletedBuild;
  index: number;
  reduceMotion: boolean;
}) {
  const variants = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <motion.div
      {...variants}
      transition={reduceMotion ? { duration: 0.15 } : { duration: 0.35, ease: EASE }}
      className="absolute inset-0 flex flex-col gap-1"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
        {String(index + 1).padStart(2, "0")}
      </span>
      <h3 className="font-display text-xl font-semibold text-text-primary sm:text-2xl">
        {build.name}
      </h3>
      <p className="text-sm text-text-secondary sm:text-base">
        {build.cpu} &middot; {build.gpu}
      </p>
      <Link
        href="/completed-builds"
        className="group mt-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-accent"
      >
        View Build
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
          &rarr;
        </span>
      </Link>
    </motion.div>
  );
}

/**
 * A chrome-free rendering of the same real build photo used by
 * BuildImageFrame, for the runway's background depth layers — full
 * BuildImageFrame (its bordered showroom-stage chrome + vignette) reads
 * fine for the one dominant hero photo, but four overlapping bordered boxes
 * for the receding, scaled-down, blurred queue would read as literal "cards
 * stacked in space" rather than PCs receding into depth, so these layers
 * are just the photo itself, normalized through the exact same
 * `buildImageTransform` BuildImageFrame uses — one shared formula, not a
 * second normalization system.
 */
function DepthImage({ build }: { build: CompletedBuild }) {
  if (!build.imageSrc) return null;
  return (
    <div className="relative h-full w-full">
      <Image
        src={build.imageSrc}
        alt={build.imageAlt}
        fill
        draggable={false}
        sizes="(min-width: 1024px) 560px, 90vw"
        className="object-contain p-6 drop-shadow-[0_24px_30px_rgba(0,0,0,0.5)] sm:p-8"
        style={buildImageTransform({
          scale: build.imageScale,
          translateX: build.imageTranslateX,
          translateY: build.imageTranslateY,
        })}
      />
    </div>
  );
}
