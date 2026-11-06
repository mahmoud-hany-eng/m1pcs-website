import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { QuoteForm } from "@/components/forms/QuoteForm";
import { Button } from "@/components/ui/Button";
import { InlineText } from "@/components/seo/InlineText";
import { pageMetadata } from "@/lib/seo";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = pageMetadata({
  title: "Request a Custom Gaming PC Quote in Qatar",
  description:
    "Tell M1 what you need — a complete custom gaming PC or a specific component — and get a quotation with current pricing and availability in Qatar.",
  path: "/build-my-pc",
});

const requestSteps = [
  "Tell us your budget, the games you play and your monitor, or the specific component you want.",
  "M1 recommends a configuration or confirms the part, and you receive a quotation with current pricing and availability.",
  "Accept the quotation and agree payment and delivery with the team. Parts are then sourced from the U.S. and your PC is built, set up and delivered.",
];

export default function BuildMyPcPage() {
  return (
    <>
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
              as="h1"
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
            {/* The fallback reserves roughly the form's height so the footer does not jump
                when the form hydrates (it reads the URL's search params on the client). */}
            <Suspense fallback={<div className="min-h-[1500px] text-sm text-text-secondary sm:min-h-[1170px]">Loading form…</div>}>
              <QuoteForm />
            </Suspense>
          </div>
        </Container>
      </section>

      <section aria-labelledby="quote-process-title" className="relative">
        <Container className="pb-16 sm:pb-24">
          <h2 id="quote-process-title" className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            What happens after you request a quote
          </h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {requestSteps.map((step, i) => (
              <li key={step} className="glass glass-flat flex flex-col gap-3 p-6">
                <span className="font-display text-sm font-bold tracking-widest text-accent">{String(i + 1).padStart(2, "0")}</span>
                <p className="text-sm leading-relaxed text-text-secondary">{step}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-sm text-text-secondary">
            <InlineText text="Submitting a request is not an order and does not commit you to anything. Prices and availability change often, so every quotation is prepared individually. See [how a custom PC order works](/how-it-works), browse [completed builds](/completed-builds) for ideas, or read our [guide to ordering a custom gaming PC in Qatar](/guides/how-to-order-a-custom-gaming-pc-in-qatar)." />
          </p>
          <div className="mt-6">
            <Button href="/products" variant="glass" size="md">
              Browse PC component categories
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
