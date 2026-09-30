"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useSpring,
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
        // Depth settle: rises, fades in and comes into focus. Text-only
        // blocks — never applied to a glass pane (a filter on the pane
        // would cut its frost off from the page behind it mid-animation).
        initial: { opacity: 0, y: 24, filter: "blur(8px)" },
        whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.8, ease: EASE },
      };

  return (
    <section className="relative overflow-hidden py-24 sm:py-28 lg:py-32">
      <Container>
        <motion.div {...introReveal} className="max-w-2xl">
          <h2 className="font-display text-[clamp(2.75rem,6vw,5rem)] font-bold leading-[1.02] tracking-tight text-white">
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

  // Same light spring used by the other scroll-progress sections — a fast
  // wheel jump glides the rows toward their new position instead of
  // visibly snapping. Native scrolling is untouched; this only smooths the
  // derived progress value feeding the row x-offsets below.
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 35,
    mass: 0.2,
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

  useMotionValueEvent(smoothProgress, "change", (p) => {
    directions.forEach((dir, i) => {
      xs[i]?.set(dir * (-TRAVEL_PERCENT + 2 * TRAVEL_PERCENT * p));
    });
  });

  return (
    <div ref={sectionRef} className="relative">
      {/* Warm light the rows travel through. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.12),transparent)]"
      />

      <div className="relative flex flex-col gap-1">
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

      {/* Two frosted panes standing at the edges of the room: each word
          slides out from behind the haze as the page scrolls, and back
          into it on the way up. Static surfaces (the text moves, the glass
          doesn't); the frost fades out toward the centre via a mask. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[11vw]">
        <div className="absolute inset-0 backdrop-blur-[10px] [-webkit-mask-image:linear-gradient(to_right,#000_30%,transparent)] [mask-image:linear-gradient(to_right,#000_30%,transparent)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/70 to-transparent" />
        <div className="absolute inset-y-[4%] right-[30%] w-px bg-gradient-to-b from-transparent via-white/[0.12] to-transparent" />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[11vw]">
        <div className="absolute inset-0 backdrop-blur-[10px] [-webkit-mask-image:linear-gradient(to_left,#000_30%,transparent)] [mask-image:linear-gradient(to_left,#000_30%,transparent)]" />
        <div className="absolute inset-0 bg-gradient-to-l from-background/70 to-transparent" />
        <div className="absolute inset-y-[4%] left-[30%] w-px bg-gradient-to-b from-transparent via-white/[0.12] to-transparent" />
      </div>
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
      className={`group flex border-b border-white/[0.06] py-3 ${
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
          viewport: { once: false, margin: "-20% 0px" },
          transition: { duration: 0.5, delay, ease: EASE },
        };

  return (
    <Container>
      <div className="flex flex-col">
        {rows.map((category, i) => (
          <motion.div key={category.slug} {...reveal(0.05 * i)}>
            <Link
              href={`/build-my-pc?category=${encodeURIComponent(category.name)}`}
              className="group flex items-center justify-between border-b border-white/[0.07] py-5"
            >
              <span className="font-display text-2xl font-bold uppercase tracking-tight text-white sm:text-3xl">
                {category.name}
              </span>
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04] text-base text-text-secondary shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_0_0_1px_rgb(255_255_255/0.1)] transition-transform group-hover:translate-x-1 group-hover:text-white"
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
