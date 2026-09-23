"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { BuildImageFrame } from "@/components/cards/BuildImageFrame";
import { completedBuilds } from "@/lib/builds";
import type { CompletedBuild } from "@/types";

/** Premium, restrained "expo-out" easing — matches the other homepage sections. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Editorial column placement per build, in array order. BuildImageFrame is
 * a fixed aspect-[4/5] box, so a wider grid column only ever makes the
 * whole frame proportionally larger — it can never distort or crop the
 * photo inside it, which is what makes varying these safe.
 */
const PLACEMENT = [
  "lg:col-span-8 lg:col-start-1", // build 1 — large, featured, left
  "lg:col-span-5 lg:col-start-1", // build 2 — paired, left half
  "lg:col-span-6", // build 3 — paired, right half (auto-placed after build 2)
  "lg:col-span-8 lg:col-start-5", // build 4 — large, right-offset
  "lg:col-span-5 lg:col-start-4", // build 5 — smaller, centered, closing
];

/**
 * Homepage "Built by M1" showcase. Reuses BuildImageFrame + completedBuilds
 * exactly as they already exist for /completed-builds — no build data is
 * duplicated, and the image presentation (including each build's approved
 * imageScale/imageTranslateX/imageTranslateY) is untouched. Only the
 * surrounding editorial composition (column widths, metadata layout,
 * entrance reveal) is homepage-specific.
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
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.7, ease: EASE },
      };

  return (
    <section className="bg-background py-24 sm:py-28 lg:py-32">
      <Container>
        <motion.div {...introReveal} className="max-w-2xl">
          <h2 className="font-display text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-[1.05] tracking-tight text-text-primary">
            Built by M1.
          </h2>
          <p className="mt-4 text-lg text-text-secondary sm:text-xl">
            Real systems.
            <br />
            Built for real customers.
          </p>
        </motion.div>

        <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-20 sm:gap-y-24 lg:grid-cols-12 lg:gap-x-12">
          {completedBuilds.map((build, i) => (
            <BuildEntry
              key={build.slug}
              build={build}
              className={PLACEMENT[i] ?? "lg:col-span-6"}
              editorialLabel={i === 0 ? "M1 / 01" : undefined}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}

function BuildEntry({
  build,
  className,
  editorialLabel,
  reduceMotion,
}: {
  build: CompletedBuild;
  className: string;
  editorialLabel?: string;
  reduceMotion: boolean;
}) {
  const reveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.4 },
      }
    : {
        initial: { opacity: 0, y: 30 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.7, ease: EASE },
      };

  if (!build.imageSrc) return null;

  return (
    <motion.div {...reveal} className={`group flex flex-col gap-5 ${className}`}>
      <BuildImageFrame src={build.imageSrc} alt={build.imageAlt} scale={build.imageScale} translateX={build.imageTranslateX} translateY={build.imageTranslateY} />

      <div className="flex flex-col gap-1">
        {editorialLabel && (
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
            {editorialLabel}
          </span>
        )}
        <h3 className="font-display text-lg font-semibold text-text-primary">{build.name}</h3>
        <p className="text-sm text-text-secondary">
          {build.cpu} &middot; {build.gpu}
        </p>
        <Link
          href="/completed-builds"
          className="mt-2 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors group-hover:text-accent"
        >
          View Build
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
            &rarr;
          </span>
        </Link>
      </div>
    </motion.div>
  );
}
