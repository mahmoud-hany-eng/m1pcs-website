"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DM_Serif_Display } from "next/font/google";
import { AnimatePresence, motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { buildImageTransform } from "@/components/cards/BuildImageFrame";
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
 *
 * `x`/`y` are raw pixels, not percentages of each layer's own box — every
 * layer starts from the exact same anchored box (see the identical wrapper
 * each one renders in), so a pixel offset gives consistent, predictable
 * spacing between silhouettes regardless of how much a given depth level's
 * `scale` has shrunk it. (An earlier percentage-based version compounded
 * with `scale` in a way that read as cramped/overlapping.)
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
  x: [190, 100, 0, -300, -510, -680, -820],
  y: [30, 18, 0, -5, -10, -16, -22],
  scale: [0.62, 0.85, 1, 0.8, 0.6, 0.45, 0.34],
  opacity: [0, 0, 1, 0.55, 0.32, 0.16, 0],
  blur: [0, 0, 0, 0.5, 1.5, 2.5, 3.5],
};

const DEPTH_MOBILE: DepthPoints = {
  d: [-1, 0, 1, 2, 3],
  x: [64, 0, -160, -260, -330],
  y: [10, 0, -3, -6, -10],
  scale: [0.85, 1, 0.72, 0.54, 0.4],
  opacity: [0, 1, 0.5, 0.25, 0.12],
  blur: [0, 0, 0.5, 1.5, 2.5],
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

/** Exiting builds sit above the receding background queue (matching
 *  "foreground → exit" — the build that just had focus stays in front of
 *  the queue as it fades, it doesn't sink behind), which is layered strictly
 *  by how far back it is. */
function depthZIndex(d: number): number {
  return d <= 0 ? 100 - Math.round(Math.abs(d) * 5) : 100 - Math.round(d * 10);
}

/**
 * Homepage "Built by M1" showcase — a depth-runway gallery: real PC photos
 * floating free (no card/frame chrome), the active build large and sharp on
 * the right, up to three more receding to the left into a smaller, fainter,
 * softly blurred background queue, and the build just replaced fading out
 * in place. Every build's transform is recomputed from `activeIndex` on
 * every render (see `depthStyle`), so this stays correct under
 * rapid/rapid-reversed input.
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

      <motion.div {...railReveal} className="mt-14 lg:mt-16">
        <PortfolioRunway reduceMotion={reduceMotion} />
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
  // horizontal release gesture changes the active build. Native image drag
  // is disabled per-image (see RunwayImage) so it never swallows the
  // pointerup this relies on.
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
    <div className="flex flex-col gap-8 lg:gap-10">
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
        className="relative h-[400px] w-full sm:h-[460px] lg:h-[480px] xl:h-[540px]"
      >
        {/* Restrained environmental support for the active PC only — a soft
            ambient glow and a grounding floor shadow, both anchored to the
            fixed "active" slot rather than animated per-build. Explicitly
            not a card: no border, no fill box, no edges — just atmosphere. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-[2%] w-[220px] sm:w-[280px] lg:w-[300px] xl:w-[360px]"
        >
          <div className="absolute left-1/2 top-1/2 h-[70%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.07] blur-[80px]" />
          <div className="absolute bottom-[6%] left-1/2 h-[10%] w-[85%] -translate-x-1/2 rounded-full bg-black/50 blur-2xl" />
        </div>

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
            <div
              key={build.slug}
              className="absolute inset-y-0 right-[2%] flex items-center"
              style={{ zIndex: depthZIndex(clampedD), pointerEvents: isActive ? "auto" : "none" }}
            >
              <motion.div
                aria-hidden={!isActive}
                className="aspect-[4/5] w-[220px] sm:w-[280px] lg:w-[300px] xl:w-[360px]"
                animate={{
                  x: s.x,
                  y: s.y,
                  scale: s.scale,
                  opacity: s.opacity,
                  filter: `blur(${s.blur}px)`,
                }}
                whileHover={isActive && !reduceMotion ? { scale: s.scale * 1.02 } : undefined}
                transition={reduceMotion ? RUNWAY_TRANSITION_REDUCED : RUNWAY_TRANSITION}
              >
                <RunwayImage build={build} isActive={isActive} />
              </motion.div>
            </div>
          );
        })}
      </div>

      <Container>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-border pt-6">
          <div className="relative min-h-[64px] flex-1 basis-[280px]">
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
      </Container>
    </div>
  );
}

/**
 * The focused build's identity — deliberately compact (a title line, one
 * spec line, and a link, not the full spec sheet BuildCard shows on
 * /completed-builds) so it reads as a caption for the runway rather than
 * competing with it for space. A short crossfade with a small vertical
 * settle, never the runway's own travel/scale/blur.
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
      className="absolute inset-0 flex flex-wrap items-baseline gap-x-3 gap-y-1"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
        {String(index + 1).padStart(2, "0")}
      </span>
      <h3 className="font-display text-lg font-semibold text-text-primary sm:text-xl">
        {build.name}
      </h3>
      <p className="text-sm text-text-secondary">
        {build.cpu} &middot; {build.gpu}
      </p>
      <Link
        href="/completed-builds"
        className="group ml-auto inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-accent sm:ml-0"
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
 * A single, chrome-free rendering of a real build photo used at every depth
 * level, active included — no border, no background panel, no vignette:
 * just the transparent-background cutout with a drop shadow, normalized
 * through the exact same `buildImageTransform` BuildImageFrame uses on
 * /completed-builds, so the per-build imageScale/imageTranslateX/
 * imageTranslateY tuning carries over unchanged. `draggable={false}`
 * matters here, not just cosmetically — Next/Image's underlying `<img>` is
 * natively draggable in Chromium, which was found to swallow the
 * `pointerup` this component's swipe handling depends on.
 */
function RunwayImage({ build, isActive }: { build: CompletedBuild; isActive: boolean }) {
  if (!build.imageSrc) return null;
  return (
    <div className="relative h-full w-full">
      <Image
        src={build.imageSrc}
        alt={build.imageAlt}
        fill
        draggable={false}
        sizes="(min-width: 1024px) 360px, 60vw"
        className={
          isActive
            ? "object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)]"
            : "object-contain drop-shadow-[0_20px_26px_rgba(0,0,0,0.5)]"
        }
        style={buildImageTransform({
          scale: build.imageScale,
          translateX: build.imageTranslateX,
          translateY: build.imageTranslateY,
        })}
      />
    </div>
  );
}
