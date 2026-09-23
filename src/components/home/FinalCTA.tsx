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
        viewport: { once: true, margin: "-15% 0px" },
        transition: { duration: 1, ease: EASE },
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
          viewport: { once: true, margin: "-15% 0px" },
          transition: { duration: 0.8, delay, ease: EASE },
        };

  const fadeReveal = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-15% 0px" },
    transition: { duration: reduceMotion ? 0.4 : 0.6, delay, ease: EASE },
  });

  return (
    <section className="relative isolate flex min-h-[75svh] items-center overflow-hidden bg-background py-24 sm:min-h-[85svh] sm:py-28">
      <motion.div
        {...pcReveal}
        className="pointer-events-none absolute -right-12 bottom-0 w-[70vw] max-w-[380px] opacity-70 sm:right-0 sm:w-[42vw] sm:opacity-90 lg:max-w-[520px] lg:opacity-100"
      >
        <div className="relative aspect-[1206/1724] w-full">
          <Image
            src="/hero/featured-build.webp"
            alt="M1 Gaming PCs custom build with red interior lighting and tempered glass panels"
            fill
            sizes="(min-width: 1024px) 520px, (min-width: 640px) 42vw, 70vw"
            className="object-contain"
          />
        </div>
      </motion.div>

      {/* Darkens the text side only, purely with CSS — the photo itself is
          never filtered/recolored, this sits in front of it as a separate
          layer so the headline stays legible over the PC. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40 sm:via-background/70 sm:to-transparent"
      />

      <Container className="relative">
        <div className="flex max-w-2xl flex-col items-start gap-8">
          <h2 className="font-display text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.98] tracking-tight text-text-primary">
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

          <motion.p
            {...fadeReveal(0.45)}
            className="max-w-md text-lg text-text-secondary sm:text-xl"
          >
            Tell us what you need.
            <br />
            We&rsquo;ll help you build it.
          </motion.p>

          <motion.div
            {...fadeReveal(0.6)}
            className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row"
          >
            <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
              Build Your PC
            </Button>
            {whatsappHref && (
              <Button
                href={whatsappHref}
                external
                variant="whatsapp"
                size="lg"
                className="w-full sm:w-auto"
              >
                WhatsApp Us
              </Button>
            )}
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
