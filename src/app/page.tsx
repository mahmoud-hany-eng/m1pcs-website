import type { Metadata } from "next";
import { CinematicHero } from "@/components/home/CinematicHero";
import { FeaturedSpecScroll } from "@/components/home/FeaturedSpecScroll";
import { ProcessSection } from "@/components/home/ProcessSection";
import { SourcingTeaser } from "@/components/home/SourcingTeaser";
import { FeaturedBuilds } from "@/components/home/FeaturedBuilds";
import { PartsShowcase } from "@/components/home/PartsShowcase";
import { PricingReveal } from "@/components/home/PricingReveal";
import { WhyM1 } from "@/components/home/WhyM1";
import { HomeOverview } from "@/components/home/HomeOverview";
import { FinalCTA } from "@/components/home/FinalCTA";
import { JsonLd } from "@/components/seo/JsonLd";
import { contentDates } from "@/lib/content-dates";
import { pageMetadata, serviceJsonLd, webPageJsonLd } from "@/lib/seo";

const title = "Custom Gaming PCs & Components in Qatar | M1 Gaming PCs";
const description =
  "M1 builds custom gaming PCs and sources computer components in Qatar. Tell us your budget and goals, see real completed builds, and request a current quotation.";

export const metadata: Metadata = pageMetadata({
  title,
  absoluteTitle: true,
  description,
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({ path: "/", name: title, description, dateModified: contentDates.home }),
          serviceJsonLd(),
        ]}
      />
      <CinematicHero />
      <FeaturedSpecScroll />
      <ProcessSection />
      <SourcingTeaser />
      <FeaturedBuilds />
      <PartsShowcase />
      <PricingReveal />
      <WhyM1 />
      <HomeOverview />
      <FinalCTA />
    </>
  );
}
