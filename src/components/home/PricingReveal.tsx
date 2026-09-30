"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/SectionHeading";

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
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.8, ease: EASE },
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
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.75, ease: EASE },
      };

  const copyReveal = {
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: reduceMotion, margin: "-20% 0px" },
    transition: { duration: 0.6, delay: reduceMotion ? 0 : 0.35 },
  };

  const ruleReveal = reduceMotion
    ? { initial: { scaleX: 1 }, whileInView: {}, viewport: { once: true }, transition: { duration: 0 } }
    : {
        initial: { scaleX: 0 },
        whileInView: { scaleX: 1 },
        viewport: { once: false, margin: "-20% 0px" },
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
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.6, delay: 0.4, ease: EASE },
      };

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="hairline absolute inset-x-0 top-0" />
      {/* Centred by the wrapper — Framer writes the span's own `transform`
          for its reveal, which would otherwise wipe a translate class. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden items-center justify-center overflow-hidden lg:flex"
      >
        <motion.span
          {...bgWordReveal}
          className="select-none whitespace-nowrap font-display text-[19vw] font-bold leading-none tracking-tight text-white/[0.025] [-webkit-text-stroke:1px_rgb(255_255_255/0.07)]"
        >
          PRICING
        </motion.span>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[8%] top-1/2 hidden h-[420px] w-[520px] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(249_194_4/0.1),transparent)] lg:block"
      />

      <Container className="relative py-20 sm:py-28">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col items-start gap-3">
            <Eyebrow>Pricing</Eyebrow>

            <div className="overflow-hidden">
              <motion.h2
                {...headingReveal}
                className="mt-2 max-w-3xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
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
              className="mt-3 h-px w-24 bg-gradient-to-r from-accent/70 to-transparent"
            />
          </div>

          {/* The one glass accent here: a quotation slip, gold-lit edge. */}
          <motion.div {...ctaReveal} className="flex lg:justify-end">
            <div className="glass glass-tint-gold flex w-full max-w-md flex-col gap-5 rounded-glass-lg p-7 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Quotation
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]" aria-hidden="true" />
              </div>
              <p className="font-display text-xl font-semibold leading-snug text-white sm:text-2xl">
                Current component availability and pricing, at the time of your request.
              </p>
              <div className="hairline" aria-hidden="true" />
              <Button href="/build-my-pc" size="lg" className="w-full">
                Request Current Price
              </Button>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
