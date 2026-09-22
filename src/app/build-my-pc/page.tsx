import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { QuoteForm } from "@/components/forms/QuoteForm";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Build My PC / Request a Quote",
  description:
    "Tell M1 your budget, games and performance goals to receive a custom PC quotation with current component pricing.",
  alternates: { canonical: "/build-my-pc" },
};

export default function BuildMyPcPage() {
  return (
    <section>
      <Container className="py-16 sm:py-24">
        <SectionHeading
          align="left"
          eyebrow="Build My PC"
          title="Request a quote"
          description="Answer as much as you can — anything you leave blank, we'll follow up on directly."
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
