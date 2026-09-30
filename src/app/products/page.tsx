import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CategoryCard } from "@/components/cards/CategoryCard";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";
import { categories } from "@/lib/categories";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Custom gaming PCs, graphics cards, processors, and computer components available through M1 in Qatar. Request current pricing and availability.",
  alternates: { canonical: "/products" },
};

export default function ProductsPage() {
  return (
    <>
      <section className="relative">
        <Container className="pb-4 pt-16 sm:pb-6 sm:pt-24">
          <SectionHeading
            eyebrow="Products"
            title="Custom builds & components"
            description="M1 sources and configures components across every category below. Many items are sourced specifically per order rather than held as fixed stock, and pricing and availability change frequently — request current pricing for any category rather than relying on a fixed price list."
          />
        </Container>
      </section>

      <section className="relative">
        {/* Warm key light the grid of panes sits in. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-24 h-[640px] w-[min(1100px,140%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.11),transparent)]"
        />
        <Container className="relative py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {categories.map((category, i) => (
              <CategoryCard key={category.slug} category={category} index={i} featured={i === 0} />
            ))}
          </div>
        </Container>
      </section>

      <CTABlock
        title="Not sure which components you need?"
        description="Tell us your budget and what you play — we'll recommend a full configuration."
      >
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
      </CTABlock>
    </>
  );
}
