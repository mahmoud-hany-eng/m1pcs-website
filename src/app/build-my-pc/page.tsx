import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { QuoteForm } from "@/components/forms/QuoteForm";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Request a Quote",
  description:
    "Looking for a complete PC or a specific component? Tell M1 what you need and get a quotation with current pricing and availability.",
  alternates: { canonical: "/build-my-pc" },
};

export default function BuildMyPcPage() {
  return (
    <section className="relative">
      {/* Clipped by its own wrapper (not the section) so the sticky intro
          column keeps working. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute right-[-10%] top-20 h-[620px] w-[min(900px,120%)] rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.12),transparent)]" />
      </div>
      <Container className="relative grid grid-cols-1 gap-10 pb-16 pt-16 sm:pb-24 sm:pt-24 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] lg:gap-14">
        {/* Intro stays in view beside the long form on desktop. */}
        <div className="lg:sticky lg:top-32 lg:h-fit">
          <SectionHeading
            align="left"
            eyebrow="Get a Quote"
            title="Request a Quote"
            description="Looking for a complete PC or a specific component? Tell us what you need and we'll help you find the right option at current pricing and availability."
          />

          <p className="mt-6 text-sm text-text-secondary">
            Prefer Instagram?{" "}
            <a
              href={siteConfig.social.instagram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent hover:text-accent-hover"
            >
              Message us at {siteConfig.social.instagram.handle}
            </a>
            .
          </p>
        </div>

        <div className="glass rounded-glass-lg p-5 sm:p-8 lg:p-10">
          <Suspense fallback={<div className="text-sm text-text-secondary">Loading form…</div>}>
            <QuoteForm />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}
