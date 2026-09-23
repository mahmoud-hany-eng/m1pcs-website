"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { Container } from "@/components/ui/Container";
import { categories } from "@/lib/categories";
import type { CategoryItem } from "@/types";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The seven hardware categories this row shows, pulled by slug from the
 * single real category list (src/lib/categories.ts) — labels and routes
 * are read from that data, never duplicated/hardcoded here. Power Supplies
 * sits last, after Cooling — both are system-support categories rather
 * than core compute/storage parts, so pairing them keeps the sequence
 * reading as a deliberate group rather than an afterthought tacked on.
 */
const SHOWCASE_SLUGS = [
  "gpus",
  "cpus",
  "ram",
  "ssd-storage",
  "motherboards",
  "cooling",
  "power-supplies",
];

/** How far each row travels, as a percent of its own width (±6% = 12% total swing — within the 5–12% spec, under the 15% cap). */
const TRAVEL_PERCENT = 6;

/**
 * "Every part matters." — a typography-only replacement for the old
 * category card grid (that grid stays in page.tsx for now; it's removed in
 * the next cleanup phase). Desktop gets oversized rows whose horizontal
 * position is driven entirely by page scroll, alternating direction per
 * row; mobile gets a plain vertical list. No cards, images, or icons.
 */
export function PartsShowcase() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  const rows = SHOWCASE_SLUGS.map((slug) => categories.find((c) => c.slug === slug)).filter(
    (c): c is CategoryItem => Boolean(c)
  );

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
        viewport: { once: false, margin: "-10% 0px" },
        transition: { duration: 0.7, ease: EASE },
      };

  return (
    <section className="overflow-hidden border-b border-border bg-background py-24 sm:py-28 lg:py-32">
      <Container>
        <motion.div {...introReveal} className="max-w-2xl">
          <h2 className="font-display text-[clamp(2.75rem,6vw,5rem)] font-bold leading-[1.02] tracking-tight text-text-primary">
            <span className="block">Every part</span>
            <span className="block">matters.</span>
          </h2>
          <p className="mt-4 text-lg text-text-secondary sm:text-xl">
            Every category is available as part of a custom build or on its
            own — many items are sourced specifically for your order rather
            than held as fixed stock.
          </p>
        </motion.div>
      </Container>

      <div className="mt-14 lg:hidden">
        <MobileParts rows={rows} reduceMotion={reduceMotion} />
      </div>
      <div className="mt-16 hidden lg:block">
        <KineticParts rows={rows} reduceMotion={reduceMotion} />
      </div>
    </section>
  );
}

/**
 * ONE section-level useScroll drives every row — a single
 * useMotionValueEvent callback updates all seven row motion values together,
 * rather than each row deriving its own transform independently (the same
 * "one shared scroll source" pattern used by ProcessSection/FeaturedSpecScroll,
 * kept here for the same reason: multiple siblings deriving position from
 * one shared progress value is where this codebase has previously hit real
 * cross-element bugs with per-row transforms).
 */
function KineticParts({ rows, reduceMotion }: { rows: CategoryItem[]; reduceMotion: boolean }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const directions = rows.map((_, i) => (i % 2 === 0 ? 1 : -1)) as (1 | -1)[];

  // Fixed seven rows -> fixed seven motion values, called unconditionally
  // (not inside the .map) to keep hook call order stable.
  const x0 = useMotionValue(0);
  const x1 = useMotionValue(0);
  const x2 = useMotionValue(0);
  const x3 = useMotionValue(0);
  const x4 = useMotionValue(0);
  const x5 = useMotionValue(0);
  const x6 = useMotionValue(0);
  const xs = [x0, x1, x2, x3, x4, x5, x6];

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    directions.forEach((dir, i) => {
      xs[i]?.set(dir * (-TRAVEL_PERCENT + 2 * TRAVEL_PERCENT * p));
    });
  });

  return (
    <div ref={sectionRef} className="flex flex-col gap-1">
      {rows.map((category, i) => (
        <PartsRow
          key={category.slug}
          category={category}
          direction={directions[i]}
          x={xs[i]}
          reduceMotion={reduceMotion}
        />
      ))}
    </div>
  );
}

function PartsRow({
  category,
  direction,
  x,
  reduceMotion,
}: {
  category: CategoryItem;
  direction: 1 | -1;
  x: MotionValue<number>;
  reduceMotion: boolean;
}) {
  const xPercent = useTransform(x, (v) => `${v}%`);

  return (
    <Link
      href={`/build-my-pc?category=${encodeURIComponent(category.name)}`}
      className={`group flex border-b border-border/60 py-3 ${
        direction === 1 ? "justify-start" : "justify-end"
      }`}
    >
      <motion.span
        style={reduceMotion ? undefined : { x: xPercent }}
        className={`flex items-center gap-6 whitespace-nowrap font-display text-[clamp(4rem,9vw,9rem)] font-bold uppercase leading-none tracking-tight text-text-secondary transition-colors duration-300 group-hover:text-text-primary group-focus-visible:text-text-primary ${
          direction === 1 ? "flex-row" : "flex-row-reverse"
        }`}
      >
        {category.name}
        <span
          aria-hidden="true"
          className={`text-text-secondary transition-all duration-300 group-hover:text-primary ${
            direction === 1 ? "group-hover:translate-x-2" : "group-hover:-translate-x-2"
          }`}
        >
          {direction === 1 ? "→" : "←"}
        </span>
      </motion.span>
    </Link>
  );
}

function MobileParts({ rows, reduceMotion }: { rows: CategoryItem[]; reduceMotion: boolean }) {
  const reveal = (delay = 0) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          whileInView: { opacity: 1 },
          viewport: { once: true, margin: "-10% 0px" },
          transition: { duration: 0.4, delay },
        }
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: false, margin: "-10% 0px" },
          transition: { duration: 0.5, delay, ease: EASE },
        };

  return (
    <Container>
      <div className="flex flex-col">
        {rows.map((category, i) => (
          <motion.div key={category.slug} {...reveal(0.05 * i)}>
            <Link
              href={`/build-my-pc?category=${encodeURIComponent(category.name)}`}
              className="group flex items-center justify-between border-b border-border/60 py-5"
            >
              <span className="font-display text-2xl font-bold uppercase tracking-tight text-text-primary sm:text-3xl">
                {category.name}
              </span>
              <span
                aria-hidden="true"
                className="text-xl text-text-secondary transition-transform group-hover:translate-x-1"
              >
                &rarr;
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </Container>
  );
}
