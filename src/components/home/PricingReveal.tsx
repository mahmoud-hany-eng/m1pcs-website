"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

/** Premium, restrained "expo-out" easing — matches the other homepage sections. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * "Why don't we show fixed prices?" — same content and behavior as the
 * original homepage block (kept verbatim from page.tsx), given its own
 * "editorial split reveal" motion identity: an oversized low-contrast
 * background word, a mask/clip heading reveal, a side-entering CTA and a
 * thin animated rule line — distinct from every other section's motion so
 * this section (which may stay on the final homepage) doesn't read as a
 * copy-pasted fade-up.
 */
export function PricingReveal() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  const bgWordReveal = reduceMotion
    ? { initial: { opacity: 1, y: 0 }, whileInView: {}, viewport: { once: true }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 40 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: false, margin: "-10% 0px" },
        transition: { duration: 1, ease: EASE },
      };

  const headingReveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.4 },
      }
    : {
        initial: { y: "100%" },
        whileInView: { y: 0 },
        viewport: { once: false, margin: "-10% 0px" },
        transition: { duration: 0.8, ease: EASE },
      };

  const copyReveal = {
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: reduceMotion, margin: "-10% 0px" },
    transition: { duration: 0.6, delay: reduceMotion ? 0 : 0.35 },
  };

  const ruleReveal = reduceMotion
    ? { initial: { scaleX: 1 }, whileInView: {}, viewport: { once: true }, transition: { duration: 0 } }
    : {
        initial: { scaleX: 0 },
        whileInView: { scaleX: 1 },
        viewport: { once: false, margin: "-10% 0px" },
        transition: { duration: 0.7, delay: 0.5, ease: EASE },
      };

  const ctaReveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-10% 0px" },
        transition: { duration: 0.4 },
      }
    : {
        initial: { opacity: 0, x: 40 },
        whileInView: { opacity: 1, x: 0 },
        viewport: { once: false, margin: "-10% 0px" },
        transition: { duration: 0.6, delay: 0.4, ease: EASE },
      };

  return (
    <section className="relative overflow-hidden border-b border-border bg-surface">
      <motion.span
        {...bgWordReveal}
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 select-none whitespace-nowrap font-display text-[24vw] font-bold leading-none tracking-tight text-text-primary/[0.035] lg:block"
      >
        PRICING
      </motion.span>

      <Container className="relative py-16 sm:py-24">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col items-start gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent sm:text-sm">
              Pricing
            </span>

            <div className="overflow-hidden">
              <motion.h2
                {...headingReveal}
                className="max-w-3xl font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl lg:text-5xl"
              >
                Why don&rsquo;t we show fixed prices?
              </motion.h2>
            </div>

            <motion.p
              {...copyReveal}
              className="max-w-2xl text-base text-text-secondary sm:text-lg"
            >
              PC component prices and availability can change frequently.
              Instead of displaying outdated pricing, M1 prepares quotations
              using current component availability and pricing at the time of
              your request.
            </motion.p>

            <motion.span
              {...ruleReveal}
              aria-hidden="true"
              style={{ transformOrigin: "left" }}
              className="mt-3 h-px w-20 bg-border-strong"
            />
          </div>

          <motion.div
            {...ctaReveal}
            className="flex flex-col gap-4 sm:flex-row lg:justify-end"
          >
            <Button href="/build-my-pc" size="lg">
              Request Current Price
            </Button>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
