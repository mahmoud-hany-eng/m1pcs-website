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
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Products"
            title="Custom builds & components"
            description="M1 sources and configures components across every category below. Many items are sourced specifically per order rather than held as fixed stock, and pricing and availability change frequently — request current pricing for any category rather than relying on a fixed price list."
          />
        </Container>
      </section>

      <section>
        <Container className="py-16 sm:py-24">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard key={category.slug} category={category} />
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
