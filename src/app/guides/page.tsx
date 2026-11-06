import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { CTABlock } from "@/components/cta/CTABlock";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { contentDates } from "@/lib/content-dates";
import { guides } from "@/lib/guides";
import { itemListJsonLd, pageMetadata, webPageJsonLd } from "@/lib/seo";

const description =
  "Practical guides for buying a gaming PC in Qatar: how custom PC orders work, keeping a PC cool in a warm climate, and checking that parts are compatible.";

export const metadata: Metadata = pageMetadata({
  title: "Gaming PC Guides for Qatar",
  description,
  path: "/guides",
});

export default function GuidesPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            path: "/guides",
            name: "Gaming PC guides for Qatar",
            description,
            type: "CollectionPage",
            dateModified: contentDates.guides,
          }),
          itemListJsonLd(
            "Gaming PC guides",
            guides.map((g) => ({ name: g.title, path: `/guides/${g.slug}` }))
          ),
        ]}
      />

      <section className="relative">
        <Container className="pt-10 sm:pt-14">
          <Breadcrumbs path="/guides" trail={[{ name: "Guides" }]} />
        </Container>
        <Container className="pb-4 pt-8 sm:pb-6 sm:pt-10">
          <SectionHeading
            as="h1"
            align="left"
            eyebrow="Guides"
            title="Gaming PC guides for Qatar"
            description="Straightforward advice from the team that configures and builds custom gaming PCs in Qatar. No fixed price lists and no benchmark claims — just what to check and what to expect."
          />
        </Container>
      </section>

      <section className="relative">
        <Container className="py-8 sm:py-12">
          <ul className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {guides.map((g) => (
              <li key={g.slug} className="glass glass-flat glass-interactive relative flex flex-col gap-3 p-6">
                <h2 className="font-display text-xl font-semibold text-white">
                  <Link href={`/guides/${g.slug}`} className="after:absolute after:inset-0 after:content-['']">
                    {g.title}
                  </Link>
                </h2>
                <p className="text-sm text-text-secondary">{g.summary}</p>
                <span aria-hidden="true" className="mt-auto pt-2 text-sm font-semibold text-accent">
                  Read the guide &rarr;
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <CTABlock title="Ready to plan your build?" description="Tell M1 your budget and goals and request a current quotation.">
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
      </CTABlock>
    </>
  );
}
