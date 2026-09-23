"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";

const EASE = [0.16, 1, 0.3, 1] as const;

interface TrustRow {
  number: string;
  headline: string;
  supporting: string;
}

/**
 * Wording cross-checked against real, already-published copy — no invented
 * warranty periods, delivery times, savings percentages or guarantees:
 *  - Fully Custom: the homepage's own value-proposition line and process
 *    step ("Tell Us What You Need" / "Submit your budget and PC requirements").
 *  - Sourced Per Order: categories.ts / the homepage's category intro
 *    ("Many items are sourced specifically for your order rather than held
 *    as fixed stock").
 *  - Transparent Pricing: the Pricing section's own explanation ("M1
 *    prepares quotations using current component availability and pricing
 *    at the time of your request").
 *  - Built in Qatar: the hero tagline ("Custom gaming PCs. Built in Qatar.")
 *    and the site's registered legal country.
 */
const ROWS: TrustRow[] = [
  {
    number: "01",
    headline: "Fully Custom",
    supporting:
      "Every build is configured around your budget, requirements and performance goals — not picked from a fixed lineup.",
  },
  {
    number: "02",
    headline: "Sourced Per Order",
    supporting:
      "Many components are sourced specifically for your order rather than held as fixed stock, so your build reflects current availability.",
  },
  {
    number: "03",
    headline: "Transparent Pricing",
    supporting:
      "No outdated price lists. M1 prepares your quotation using current component pricing and availability at the time of your request.",
  },
  {
    number: "04",
    headline: "Built in Qatar",
    supporting:
      "Every system is configured and prepared locally in Qatar, from your first message to your finished build.",
  },
];

/**
 * "Why M1?" — quiet after the kinetic Parts section. Desktop uses a
 * spotlight/focus effect: whichever row is nearest the vertical center of
 * the viewport reads at full strength while the others dim, tracked via a
 * single lightweight IntersectionObserver (not a continuous scroll
 * listener). Mobile and reduced motion get a plain per-row fade, same
 * split pattern as ProcessSection's Simple/Sticky variants.
 */
export function WhyM1() {
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
          <h2 className="font-display text-[clamp(2.75rem,6vw,5rem)] font-bold leading-[1.02] tracking-tight text-text-primary">
            Why M1?
          </h2>
        </motion.div>
      </Container>

      <div className={reduceMotion ? "block" : "lg:hidden"}>
        <SimpleWhyM1 reduceMotion={reduceMotion} />
      </div>
      <div className={reduceMotion ? "hidden" : "hidden lg:block"}>
        <SpotlightWhyM1 />
      </div>
    </section>
  );
}

function SpotlightWhyM1() {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const idx = rowRefs.current.findIndex((el) => el === entry.target);
          if (idx !== -1) setActiveIndex(idx);
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    rowRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <Container className="mt-14">
      <div className="flex flex-col">
        {ROWS.map((row, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={row.headline}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="grid grid-cols-[auto_1fr] items-start gap-6 border-t border-border py-10 transition-[opacity,transform] duration-700 ease-out last:border-b sm:gap-10 sm:py-12"
              style={{
                opacity: isActive ? 1 : 0.5,
                transform: isActive ? "translateY(0px)" : "translateY(8px)",
              }}
            >
              <span
                className={`font-display text-2xl font-bold transition-colors duration-700 sm:text-3xl ${
                  isActive ? "text-accent" : "text-text-muted"
                }`}
              >
                {row.number}
              </span>
              <div className="flex flex-col gap-3">
                <h3
                  className={`font-display text-3xl font-bold tracking-tight transition-colors duration-700 sm:text-5xl ${
                    isActive ? "text-text-primary" : "text-text-secondary"
                  }`}
                >
                  {row.headline}
                </h3>
                <p
                  className={`max-w-xl text-base transition-colors duration-700 sm:text-lg ${
                    isActive ? "text-text-secondary" : "text-text-muted"
                  }`}
                >
                  {row.supporting}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Container>
  );
}

function SimpleWhyM1({ reduceMotion }: { reduceMotion: boolean }) {
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
          viewport: { once: true, margin: "-10% 0px" },
          transition: { duration: 0.5, delay, ease: EASE },
        };

  return (
    <Container className="mt-14">
      <div className="flex flex-col">
        {ROWS.map((row, i) => (
          <motion.div
            key={row.headline}
            {...reveal(0.05 * i)}
            className="grid grid-cols-[auto_1fr] items-start gap-6 border-t border-border py-8 last:border-b"
          >
            <span className="font-display text-xl font-bold text-accent sm:text-2xl">
              {row.number}
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
                {row.headline}
              </h3>
              <p className="max-w-xl text-sm text-text-secondary sm:text-base">
                {row.supporting}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </Container>
  );
}
