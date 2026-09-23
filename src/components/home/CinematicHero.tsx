"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

/** Premium, restrained "expo-out" easing — no springy/bouncy motion. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Cinematic homepage hero. Two-column product-launch composition on
 * desktop (headline+copy+CTAs left, hero PC right, via flex-row-reverse so
 * the PC stays first in DOM order); on mobile the PC leads (before any
 * copy), which read stronger than interleaving it mid-text once tested
 * against the real photo — a deliberate stack, not a shrunk desktop copy.
 *
 * The PC photo (public/hero/featured-build.webp) is never recolored,
 * cropped, or filtered — only resized/positioned via CSS transform, with a
 * very low-opacity ambient glow placed *behind* it.
 */
export function CinematicHero() {
  const sectionRef = useRef<HTMLElement>(null);

  // Both default to the SSR-safe "unknown yet" state (false) so the
  // server-rendered markup always matches the client's first paint — they
  // only flip after mount, via matchMedia, which is a normal client update.
  // Framer Motion's own useReducedMotion() reads matchMedia synchronously
  // on the client's *first* render, which diverges from the SSR pass
  // whenever the visitor actually has reduced motion enabled (a real
  // hydration-mismatch error, verified against this exact component) —
  // hence rolling it by hand instead of using that hook.
  const [reduceMotion, setReduceMotion] = useState(false);
  const [scrollFxEnabled, setScrollFxEnabled] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    function update() {
      const reduced = motionQuery.matches;
      setReduceMotion(reduced);
      setScrollFxEnabled(desktopQuery.matches && !reduced);
    }

    update();
    motionQuery.addEventListener("change", update);
    desktopQuery.addEventListener("change", update);
    return () => {
      motionQuery.removeEventListener("change", update);
      desktopQuery.removeEventListener("change", update);
    };
  }, []);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const scrollScale = useTransform(scrollYProgress, [0, 1], [1, 1.03]);

  const rise = (delay: number) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.4, delay },
        }
      : {
          initial: { opacity: 0, y: 26 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <section ref={sectionRef} className="relative overflow-hidden bg-background">
      {/* Ambient light behind the PC only — extremely low opacity, no
          filter/overlay ever touches the photo itself. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(42% 38% at 74% 46%, rgb(var(--color-primary) / 0.12) 0%, transparent 72%)",
        }}
      />

      <Container className="relative flex min-h-[85svh] flex-col justify-center py-24 sm:py-28 lg:min-h-[90svh] lg:py-16">
        <div className="flex flex-col gap-12 lg:flex-row-reverse lg:items-center lg:justify-between lg:gap-12 xl:gap-20">
          {/* PC — first in the DOM (leads on mobile), sits on the right on
              desktop via flex-row-reverse. */}
          <motion.div
            style={{ scale: scrollFxEnabled ? scrollScale : 1 }}
            className="mx-auto w-full max-w-[320px] sm:max-w-[400px] lg:mx-0 lg:max-w-[480px] lg:shrink-0 xl:max-w-[560px]"
          >
            <motion.div
              {...(reduceMotion
                ? {
                    initial: { opacity: 0 },
                    animate: { opacity: 1 },
                    transition: { duration: 0.5, delay: 0.1 },
                  }
                : {
                    initial: { opacity: 0, scale: 0.97, y: 10 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    transition: { duration: 0.9, delay: 0.1, ease: EASE },
                  })}
              className="relative aspect-[1206/1724] w-full"
            >
              <Image
                src="/hero/featured-build.webp"
                alt="M1 Gaming PCs custom build with red interior lighting and tempered glass panels"
                fill
                sizes="(min-width: 1280px) 560px, (min-width: 1024px) 480px, (min-width: 640px) 400px, 320px"
                priority
                className="object-contain"
              />
            </motion.div>
          </motion.div>

          {/* Copy + CTAs — second in the DOM (below the PC on mobile),
              sits on the left on desktop via flex-row-reverse. */}
          <div className="flex flex-col items-start gap-8">
            <motion.h1
              {...rise(0)}
              className="font-display text-[clamp(3.5rem,9vw,8rem)] font-bold leading-[0.95] tracking-tight text-text-primary"
            >
              <span className="block">Built</span>
              <span className="block">Different.</span>
            </motion.h1>

            <motion.p
              {...rise(0.12)}
              className="max-w-md text-lg text-text-secondary sm:text-xl"
            >
              Custom gaming PCs.
              <br />
              Built in Qatar.
            </motion.p>

            <motion.div
              {...rise(0.24)}
              className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row"
            >
              <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
                Build Your PC
              </Button>
              <Button href="/products" variant="outline" size="lg" className="w-full sm:w-auto">
                Shop Components
              </Button>
            </motion.div>
          </div>
        </div>
      </Container>
    </section>
  );
}
