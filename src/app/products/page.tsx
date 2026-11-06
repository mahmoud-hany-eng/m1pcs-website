import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CategoryCard } from "@/components/cards/CategoryCard";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";
import { JsonLd } from "@/components/seo/JsonLd";
import { categories } from "@/lib/categories";
import { hasCategoryPage } from "@/lib/category-pages";
import { contentDates } from "@/lib/content-dates";
import { itemListJsonLd, pageMetadata, webPageJsonLd } from "@/lib/seo";

const description =
  "Custom gaming PCs, graphics cards, processors, memory, storage and other PC components sourced by M1 in Qatar. Request current pricing and availability.";

export const metadata: Metadata = pageMetadata({
  title: "Gaming PC Components in Qatar",
  description,
  path: "/products",
});

export default function ProductsPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            path: "/products",
            name: "Gaming PC components in Qatar",
            description,
            type: "CollectionPage",
            dateModified: contentDates.products,
          }),
          itemListJsonLd(
            "PC component categories",
            categories.filter((c) => hasCategoryPage(c.slug)).map((c) => ({ name: c.name, path: `/products/${c.slug}` }))
          ),
        ]}
      />
      <section className="relative">
        <Container className="pb-4 pt-16 sm:pb-6 sm:pt-24">
          <SectionHeading
            as="h1"
            eyebrow="Products"
            title="Custom builds & components"
            description="M1 sources and configures components across every category below. Many items are sourced specifically per order rather than held as fixed stock, and pricing and availability change frequently — request current pricing for any category rather than relying on a fixed price list."
          />
        </Container>
      </section>

      <section className="relative overflow-x-clip">
        {/* Warm key light the grid of panes sits in. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-24 h-[640px] w-[min(1100px,140%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.11),transparent)]"
        />
        <Container className="relative py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {categories.map((category, i) => (
              <CategoryCard
                key={category.slug}
                category={category}
                index={i}
                featured={i === 0}
                detailHref={hasCategoryPage(category.slug) ? `/products/${category.slug}` : undefined}
              />
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
