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
    <section>
      <Container className="py-16 sm:py-24">
        <SectionHeading
          align="left"
          eyebrow="Get a Quote"
          title="Request a Quote"
          description="Looking for a complete PC or a specific component? Tell us what you need and we'll help you find the right option at current pricing and availability."
        />

        <p className="mt-4 text-sm text-text-secondary">
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

        <div className="mt-10 max-w-3xl">
          <Suspense fallback={<div className="text-text-secondary text-sm">Loading form…</div>}>
            <QuoteForm />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}
