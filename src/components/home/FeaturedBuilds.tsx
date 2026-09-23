"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DM_Serif_Display } from "next/font/google";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { BuildImageFrame } from "@/components/cards/BuildImageFrame";
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
/** Low-bounce, heavy-feeling settle for the active/inactive card transition. */
const CARD_SPRING = { type: "spring", stiffness: 260, damping: 32, mass: 0.9 } as const;

/**
 * Homepage "Built by M1" showcase — a uniform-card horizontal gallery
 * (native overflow-x + scroll-snap, not a hijacked/virtual carousel) built
 * entirely from the existing BuildImageFrame + completedBuilds. Every card
 * is the same size; only the surrounding scale/opacity of the *frame*
 * changes with proximity to center — the photo inside never crops,
 * stretches, or otherwise changes from how it already renders on
 * /completed-builds.
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
    <section className="bg-background py-24 sm:py-28 lg:py-32">
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
        <BuildGallery reduceMotion={reduceMotion} />
      </motion.div>
    </section>
  );
}

function BuildGallery({ reduceMotion }: { reduceMotion: boolean }) {
  const builds = completedBuilds.filter((b) => b.imageSrc);
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    let ticking = false;
    function computeActive() {
      const railEl = railRef.current;
      if (!railEl) return;
      const railRect = railEl.getBoundingClientRect();
      const railCenter = railRect.left + railRect.width / 2;
      let closestIndex = 0;
      let closestDistance = Infinity;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cardCenter = r.left + r.width / 2;
        const distance = Math.abs(cardCenter - railCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      });
      setActive(closestIndex);
      ticking = false;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(computeActive);
    }

    computeActive();
    rail.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  function scrollToIndex(index: number) {
    const rail = railRef.current;
    const card = cardRefs.current[index];
    if (!rail || !card) return;
    const railRect = rail.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const delta = cardRect.left + cardRect.width / 2 - (railRect.left + railRect.width / 2);
    rail.scrollBy({ left: delta, behavior: "smooth" });
  }

  function onRailKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollToIndex(Math.min(active + 1, builds.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollToIndex(Math.max(active - 1, 0));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        ref={railRef}
        role="region"
        aria-label="Completed builds gallery"
        aria-roledescription="carousel"
        tabIndex={0}
        onKeyDown={onRailKeyDown}
        className="scrollbar-hide flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-2 pl-[6.5vw] pr-[6.5vw] sm:pl-[12.5vw] sm:pr-[12.5vw] lg:gap-8 lg:pl-[calc(50%_-_clamp(180px,19vw,280px))] lg:pr-[calc(50%_-_clamp(180px,19vw,280px))]"
      >
        {builds.map((build, i) => (
          <GalleryCard
            key={build.slug}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            build={build}
            index={i}
            isActive={i === active}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>

      <Container>
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-medium tracking-wide text-text-muted">
            {String(active + 1).padStart(2, "0")} / {String(builds.length).padStart(2, "0")}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Previous build"
              disabled={active === 0}
              onClick={() => scrollToIndex(Math.max(active - 1, 0))}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <button
              type="button"
              aria-label="Next build"
              disabled={active === builds.length - 1}
              onClick={() => scrollToIndex(Math.min(active + 1, builds.length - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30"
            >
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </div>
      </Container>
    </div>
  );
}

function GalleryCard({
  build,
  index,
  isActive,
  reduceMotion,
  ref,
}: {
  build: CompletedBuild;
  index: number;
  isActive: boolean;
  reduceMotion: boolean;
  ref: (el: HTMLDivElement | null) => void;
}) {
  if (!build.imageSrc) return null;

  const target = reduceMotion
    ? { scale: 1, opacity: 1, y: 0 }
    : isActive
      ? { scale: 1, opacity: 1, y: 0 }
      : { scale: 0.94, opacity: 0.6, y: 16 };

  return (
    <div
      ref={ref}
      className="w-[87vw] shrink-0 snap-center sm:w-[75vw] lg:w-[clamp(360px,38vw,560px)]"
    >
      <motion.div
        animate={target}
        transition={reduceMotion ? { duration: 0 } : CARD_SPRING}
        className="flex flex-col gap-5"
      >
        <BuildImageFrame
          src={build.imageSrc}
          alt={build.imageAlt}
          scale={build.imageScale}
          translateX={build.imageTranslateX}
          translateY={build.imageTranslateY}
        />

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="font-display text-lg font-semibold text-text-primary">{build.name}</h3>
          <p className="text-sm text-text-secondary">
            {build.cpu} &middot; {build.gpu}
          </p>
          <Link
            href="/completed-builds"
            className="group mt-2 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-accent"
          >
            View Build
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
              &rarr;
            </span>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
