"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { buildGeneralContactMessage, buildWhatsAppLink } from "@/lib/whatsapp";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Homepage-only closing CTA — a deliberate visual bookend to CinematicHero.
 * Reuses the exact same hero photo (public/hero/featured-build.webp,
 * completely unchanged — only resized/positioned via CSS, same as the
 * Hero's own treatment of it), but here the PC is a supporting object
 * behind the headline rather than the focal point. Does not touch the
 * shared CTABlock used by other routes.
 */
export function FinalCTA() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(motionQuery.matches);
    update();
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);

  const whatsappHref = buildWhatsAppLink(buildGeneralContactMessage());

  const pcReveal = reduceMotion
    ? {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: "-15% 0px" },
        transition: { duration: 0.5 },
      }
    : {
        initial: { opacity: 0, scale: 1.07, y: 12 },
        whileInView: { opacity: 1, scale: 1, y: 0 },
        viewport: { once: false, margin: "-20% 0px" },
        transition: { duration: 0.8, ease: EASE },
      };

  const lineReveal = (delay: number) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          whileInView: { opacity: 1 },
          viewport: { once: true, margin: "-15% 0px" },
          transition: { duration: 0.4, delay },
        }
      : {
          initial: { y: "100%" },
          whileInView: { y: 0 },
          viewport: { once: false, margin: "-20% 0px" },
          transition: { duration: 0.75, delay, ease: EASE },
        };

  const fadeReveal = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: reduceMotion, margin: "-20% 0px" },
    transition: { duration: reduceMotion ? 0.4 : 0.6, delay, ease: EASE },
  });

  return (
    <section className="relative isolate flex min-h-[75svh] items-center overflow-hidden py-24 sm:min-h-[85svh] sm:py-28">
      {/* Bleeds off the right edge and is oversized relative to its own
          box on every breakpoint (mobile already had this right; desktop
          used to anchor flush at the edge, small and fully opaque, which
          read as an isolated product cutout rather than atmosphere — the
          wider box + right-edge bleed + lower opacity here is the same
          mobile formula, just scaled up). The inner wrapper carries a
          static zoom independent of the entrance motion.div's own
          scale/y, so the two transforms don't collide. */}
      <motion.div
        {...pcReveal}
        className="pointer-events-none absolute -right-12 bottom-0 w-[70vw] max-w-[380px] opacity-70 sm:right-0 sm:w-[42vw] sm:opacity-90 lg:-right-32 lg:w-[68vw] lg:max-w-[860px] lg:opacity-35"
      >
        <div className="relative aspect-[1206/1724] w-full lg:scale-125">
          <Image
            src="/hero/featured-build.webp"
            alt="M1 Gaming PCs custom build with red interior lighting and tempered glass panels"
            fill
            sizes="(min-width: 1024px) 860px, (min-width: 640px) 42vw, 70vw"
            className="object-contain"
          />
        </div>
      </motion.div>

      {/* Darkens the text side only, purely with CSS — the photo itself is
          never filtered/recolored, this sits in front of it as a separate
          layer so the headline stays legible over the PC. Extends further
          right on desktop (rather than fading to fully transparent) so the
          now-larger PC still reads as blended atmosphere, not a crisp
          cutout sitting on top of the background. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40 sm:via-background/70 sm:to-transparent lg:via-background/80 lg:to-background/55"
      />

      {/* The PC dissolves into the floor instead of meeting the footer
          on a hard edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background"
      />

      <Container className="relative">
        <div className="flex max-w-3xl flex-col items-start gap-10">
          <h2 className="font-display text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.98] tracking-tight text-white">
            <span className="block overflow-hidden">
              <motion.span {...lineReveal(0)} className="block">
                Ready to build
              </motion.span>
            </span>
            <span className="block overflow-hidden">
              <motion.span {...lineReveal(0.1)} className="block">
                yours?
              </motion.span>
            </span>
          </h2>

          {/* The floating glass control area — the only pane in the
              section, hovering over the PC so the build frosts through. */}
          <motion.div {...fadeReveal(0.45)} className="glass w-full rounded-glass-lg p-2 sm:w-auto">
            <div className="flex flex-col gap-5 px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:gap-8 sm:py-2 sm:pl-5 sm:pr-1">
              <p className="text-base leading-snug text-text-secondary sm:text-lg">
                Tell us what you need.
                <br />
                <span className="text-white">We&rsquo;ll help you build it.</span>
              </p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <Button href="/build-my-pc" size="lg" className="w-full whitespace-nowrap sm:w-auto">
                  Build Your PC
                </Button>
                {whatsappHref && (
                  <Button
                    href={whatsappHref}
                    external
                    variant="whatsapp"
                    size="lg"
                    className="w-full whitespace-nowrap sm:w-auto"
                  >
                    WhatsApp Us
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
