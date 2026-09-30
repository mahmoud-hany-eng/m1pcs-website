"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/SectionHeading";
import { siteConfig } from "@/lib/site-config";

/** Premium, restrained "expo-out" easing — no springy/bouncy motion. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Cinematic homepage hero. Two-column product-launch composition on
 * desktop (headline+copy+CTAs left, brand mark right, via flex-row-reverse
 * so the mark stays first in DOM order); on mobile the mark leads (before
 * any copy) — a deliberate stack, not a shrunk desktop copy.
 *
 * Shows the logo (public/logo.png, never edited/cropped as a file) rather
 * than the hero PC photo: the PC photo now appears in FeaturedSpecScroll
 * immediately below instead, so the two sections read as "introduce the
 * brand, then show the product" rather than repeating the same photo
 * twice back to back.
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
    <section ref={sectionRef} className="relative overflow-hidden">
      {/* Key light behind the brand mark plus a faint amber fill low on the
          left — atmosphere only; no filter/overlay ever touches the mark. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(40% 42% at 72% 46%, rgb(var(--color-primary) / 0.2) 0%, transparent 72%), radial-gradient(35% 35% at 8% 92%, rgb(var(--color-accent) / 0.05) 0%, transparent 70%)",
        }}
      />

      <Container className="relative flex min-h-[85svh] flex-col justify-center py-24 sm:py-28 lg:min-h-[90svh] lg:py-16">
        <div className="flex flex-col gap-12 lg:flex-row-reverse lg:items-center lg:justify-between lg:gap-12 xl:gap-20">
          {/* Brand mark — first in the DOM (leads on mobile), sits on the
              right on desktop via flex-row-reverse. Sized to the logo's own
              4:5 aspect ratio rather than the PC photo's. */}
          <motion.div
            style={{ scale: scrollFxEnabled ? scrollScale : 1 }}
            className="mx-auto w-full max-w-[260px] sm:max-w-[320px] lg:mx-0 lg:max-w-[380px] lg:shrink-0 xl:max-w-[440px]"
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
              className="relative aspect-[4/5] w-full"
            >
              {/* A clear glass lens the mark floats in front of: the key
                  light behind it frosts through, a hairline catches the
                  top-left edge. Accent only — the mark itself is never
                  behind glass. */}
              <div
                aria-hidden="true"
                className="glass-subtle absolute left-1/2 top-[47%] aspect-square w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={
                  {
                    // Lens rim: clear in the middle, catching light at the edge.
                    "--glass-fill":
                      "radial-gradient(circle at 50% 50%, rgb(255 255 255 / 0.012) 58%, rgb(255 255 255 / 0.055) 100%)",
                  } as React.CSSProperties
                }
              />
              <Image
                src="/logo.png"
                alt="M1 Gaming PCs"
                fill
                sizes="(min-width: 1280px) 440px, (min-width: 1024px) 380px, (min-width: 640px) 320px, 260px"
                priority
                className="object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.5)]"
              />
            </motion.div>

            {/* Caption slab under the mark — the brand's own tagline. */}
            <motion.div {...rise(0.4)} className="mt-2 hidden justify-center lg:flex">
              <span className="glass-subtle flex items-center gap-3 rounded-full px-5 py-2.5 text-sm text-text-secondary">
                <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-transparent to-accent/80" />
                {siteConfig.brand.tagline}
                <span aria-hidden="true" className="h-px w-6 bg-gradient-to-l from-transparent to-accent/80" />
              </span>
            </motion.div>
          </motion.div>

          {/* Copy + CTAs — second in the DOM (below the PC on mobile),
              sits on the left on desktop via flex-row-reverse. */}
          <div className="flex flex-col items-start gap-8">
            <motion.div {...rise(0)} className="-mb-2">
              <Eyebrow tone="red">M1 Gaming PCs &middot; Qatar</Eyebrow>
            </motion.div>
            <motion.h1
              {...rise(0.05)}
              className="font-display text-[clamp(3.5rem,9vw,8rem)] font-bold leading-[0.95] tracking-tight text-white"
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
              <Button href="/products" variant="glass" size="lg" className="w-full sm:w-auto">
                Shop Components
              </Button>
            </motion.div>
          </div>
        </div>
      </Container>
    </section>
  );
}
