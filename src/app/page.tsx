import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CategoryCard } from "@/components/cards/CategoryCard";
import { CTABlock } from "@/components/cta/CTABlock";
import { CinematicHero } from "@/components/home/CinematicHero";
import { FeaturedSpecScroll } from "@/components/home/FeaturedSpecScroll";
import { ProcessSection } from "@/components/home/ProcessSection";
import { FeaturedBuilds } from "@/components/home/FeaturedBuilds";
import { categories } from "@/lib/categories";

export const metadata: Metadata = {
  title: "Custom Gaming PCs & Computer Components in Qatar",
  alternates: { canonical: "/" },
};

const processSteps = [
  { title: "Tell Us What You Need", description: "Submit your budget and PC requirements." },
  { title: "Receive Your Quotation", description: "M1 recommends suitable components and prepares current pricing." },
  { title: "Review Your Build", description: "Review the specifications and request changes if needed." },
];

export default function HomePage() {
  return (
    <>
      <CinematicHero />
      <FeaturedSpecScroll />
      <ProcessSection />
      <FeaturedBuilds />

      {/* Value proposition */}
      <section className="border-b border-border">
        <Container className="py-14 sm:py-20">
          <p className="mx-auto max-w-3xl text-center font-display text-xl sm:text-2xl font-semibold leading-snug text-text-primary">
            We don&rsquo;t just build PCs — we help you choose the right
            parts, avoid unnecessary costs, and get the best performance for
            your budget.
          </p>
        </Container>
      </section>

      {/* Why quotation instead of fixed prices */}
      <section className="border-b border-border bg-surface">
        <Container className="py-16 sm:py-24">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <SectionHeading
              align="left"
              eyebrow="Pricing"
              title="Why don't we show fixed prices?"
              description="PC component prices and availability can change frequently. Instead of displaying outdated pricing, M1 prepares quotations using current component availability and pricing at the time of your request."
            />
            <div className="flex flex-col gap-4 sm:flex-row lg:justify-end">
              <Button href="/build-my-pc" size="lg">
                Request Current Price
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* Business categories */}
      <section>
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="What we offer"
            title="Built from the components you need"
            description="Every category below is available as part of a custom build or on its own. Many items are sourced specifically for your order rather than held as fixed stock — request current pricing and availability any time."
          />
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard key={category.slug} category={category} />
            ))}
          </div>
        </Container>
      </section>

      {/* How it works preview */}
      <section className="border-y border-border bg-surface">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Process"
            title="How it works"
            description="A simple, transparent process from first message to finished build."
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {processSteps.map((step, index) => (
              <div
                key={step.title}
                className="flex flex-col gap-3 rounded-card border border-border bg-background p-6"
              >
                <span className="font-display text-2xl font-bold text-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-lg font-semibold">
                  {step.title}
                </h3>
                <p className="text-sm text-text-secondary">{step.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <Link
              href="/how-it-works"
              className="text-sm font-semibold text-accent hover:text-accent-hover"
            >
              See the full process &rarr;
            </Link>
          </div>
        </Container>
      </section>

      <CTABlock
        title="Ready to build your next PC?"
        description="Tell us your budget and requirements — there's no obligation and no payment required to get a quotation."
      >
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
        <Button href="/contact" variant="outline" size="lg" className="w-full sm:w-auto">
          Contact Us
        </Button>
      </CTABlock>
    </>
  );
}
