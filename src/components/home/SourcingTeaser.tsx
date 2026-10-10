"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/SectionHeading";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const EASE = [0.16, 1, 0.3, 1] as const;

interface Claim {
  title: string;
  body: string;
  icon: "new" | "shield" | "sliders" | "route";
}

const CLAIMS: Claim[] = [
  { title: "Brand New", body: "Every component in your build is brand new.", icon: "new" },
  { title: "Trusted Brands", body: "Parts from established, trusted manufacturers.", icon: "shield" },
  { title: "Fully Custom", body: "Configured around your budget, games and performance goals.", icon: "sliders" },
  {
    title: "Sourced From The U.S.",
    body: "Based on your request, parts are sourced directly from the U.S. and shipped to Qatar.",
    icon: "route",
  },
];

/** Hairline dividers between the claim cells at 1, 2 and 4 columns. */
const CLAIM_DIVIDERS = [
  "",
  "border-t sm:border-t-0 sm:border-l",
  "border-t lg:border-t-0 lg:border-l",
  "border-t sm:border-l lg:border-t-0",
];

function ClaimIcon({ name }: { name: Claim["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "new":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path {...common} d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3z" />
          <path {...common} d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path {...common} d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
          <path {...common} d="M8.8 12.2l2.2 2.2 4.2-4.4" />
        </svg>
      );
    case "sliders":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path {...common} d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle {...common} cx="16" cy="7" r="2" />
          <circle {...common} cx="10" cy="17" r="2" />
        </svg>
      );
    case "route":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <circle {...common} cx="5" cy="17" r="2" />
          <circle {...common} cx="19" cy="7" r="2" />
          <path {...common} d="M6.5 15.5C9 9 13 7.5 17 7" strokeDasharray="2 2.6" />
        </svg>
      );
  }
}

// Route geometry (viewBox units): U.S. on the left, Qatar on the right.
const P0 = { x: 90, y: 150 };
const P1 = { x: 300, y: 10 };
const P2 = { x: 510, y: 150 };
const ROUTE = `M ${P0.x} ${P0.y} Q ${P1.x} ${P1.y} ${P2.x} ${P2.y}`;
const bezier = (t: number, a: number, b: number, c: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

function RouteVisual() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const reduce = usePrefersReducedMotion();
  const t = useMotionValue(0);
  const x = useTransform(t, (v) => bezier(v, P0.x, P1.x, P2.x));
  const y = useTransform(t, (v) => bezier(v, P0.y, P1.y, P2.y));
  const drawn = useTransform(t, (v) => Math.max(0.001, v));

  useEffect(() => {
    // Reduced motion: the parcel rests mid-route instead of travelling.
    if (reduce) {
      t.set(0.5);
      return;
    }
    if (!inView) return;
    const controls = animate(t, [0, 1], { duration: 3.4, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.6 });
    return () => controls.stop();
  }, [inView, reduce, t]);

  return (
    <svg ref={ref} viewBox="0 0 600 190" className="h-auto w-full" role="img" aria-label="Parts travelling from the United States to Qatar">
      <defs>
        <radialGradient id="teaser-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(249 194 4)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(249 194 4)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={ROUTE} fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="2" strokeDasharray="4 7" />
      <motion.path d={ROUTE} fill="none" stroke="rgb(249 194 4)" strokeWidth="2.5" strokeLinecap="round" style={{ pathLength: reduce ? 1 : drawn }} />

      {/* U.S. pin */}
      <circle cx={P0.x} cy={P0.y} r="18" fill="rgb(245 245 247 / 0.08)" />
      <circle cx={P0.x} cy={P0.y} r="7" fill="rgb(245 245 247)" />
      <text x={P0.x} y={P0.y + 34} textAnchor="middle" className="fill-text-primary font-display text-[15px] font-bold tracking-[0.2em]">
        U.S.
      </text>

      {/* Qatar pin */}
      <circle cx={P2.x} cy={P2.y} r="18" fill="rgb(231 50 37 / 0.18)" />
      <circle cx={P2.x} cy={P2.y} r="7" fill="rgb(231 50 37)" />
      <text x={P2.x} y={P2.y + 34} textAnchor="middle" className="fill-primary font-display text-[15px] font-bold tracking-[0.2em]">
        QATAR
      </text>

      {/* the parcel */}
      <motion.g style={{ x, y }}>
        <circle r="26" fill="url(#teaser-glow)" />
        <rect x="-11" y="-9" width="22" height="18" rx="3" fill="rgb(185 138 87)" />
        <rect x="-11" y="-2" width="22" height="4" fill="rgb(231 50 37)" />
      </motion.g>
    </svg>
  );
}

/**
 * Home-page teaser for the /how-it-works story: brand-new parts, trusted
 * brands, fully custom builds and U.S. sourcing on request.
 */
export function SourcingTeaser() {
  const reduce = usePrefersReducedMotion();
  const reveal = (delay = 0) =>
    reduce
      ? { initial: { opacity: 0 }, whileInView: { opacity: 1 }, viewport: { once: true, margin: "-10% 0px" }, transition: { duration: 0.4, delay } }
      : {
          initial: { opacity: 0, y: 22 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: false, margin: "-15% 0px" },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <section className="relative overflow-hidden py-20 sm:py-24 lg:py-28">
      <div
        className="pointer-events-none absolute left-1/2 top-[42%] h-[520px] w-[1000px] max-w-[160%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.14),transparent)]"
        aria-hidden="true"
      />
      <Container className="relative">
        <motion.div {...reveal()} className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <Eyebrow>Parts &amp; Sourcing</Eyebrow>
          <h2 className="mt-5 font-display text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.05] tracking-tight text-white">
            Brand-new parts. Sourced from the U.S. for your build.
          </h2>
          <p className="mt-4 max-w-xl text-base text-text-secondary sm:text-lg">
            Every build starts with your requirements. Based on your request, we source the parts directly from the U.S., then
            assemble and set up your PC in Qatar.
          </p>
        </motion.div>

        {/* One glass instrument panel: the route on top, the four claims
            as a divided strip along its base — a single pane rather than a
            grid of identical cards. */}
        <motion.div {...reveal(0.08)} className="glass mx-auto mt-12 max-w-5xl overflow-hidden rounded-glass-lg">
          <div className="mx-auto max-w-3xl px-4 pb-2 pt-8 sm:px-10">
            <RouteVisual />
          </div>
          <div className="hairline" aria-hidden="true" />
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {CLAIMS.map((c, i) => (
              <motion.li
                key={c.title}
                {...reveal(0.12 + i * 0.06)}
                className={`flex flex-col items-center gap-3 border-white/[0.06] p-6 text-center sm:p-7 ${CLAIM_DIVIDERS[i]}`}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(249_194_4/0.35)]">
                  <ClaimIcon name={c.icon} />
                </span>
                <h3 className="font-display text-lg font-bold tracking-tight text-white">{c.title}</h3>
                <p className="text-sm text-text-secondary">{c.body}</p>
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <motion.div {...reveal(0.2)} className="mt-10 flex justify-center">
          <Button href="/how-it-works" variant="glass" size="lg">
            See how it works
            <span aria-hidden="true">→</span>
          </Button>
        </motion.div>
      </Container>
    </section>
  );
}
