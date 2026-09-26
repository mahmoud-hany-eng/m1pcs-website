import type { Metadata } from "next";
import { CinematicHero } from "@/components/home/CinematicHero";
import { FeaturedSpecScroll } from "@/components/home/FeaturedSpecScroll";
import { ProcessSection } from "@/components/home/ProcessSection";
import { SourcingTeaser } from "@/components/home/SourcingTeaser";
import { FeaturedBuilds } from "@/components/home/FeaturedBuilds";
import { PartsShowcase } from "@/components/home/PartsShowcase";
import { PricingReveal } from "@/components/home/PricingReveal";
import { WhyM1 } from "@/components/home/WhyM1";
import { FinalCTA } from "@/components/home/FinalCTA";

export const metadata: Metadata = {
  title: "Custom Gaming PCs & Computer Components in Qatar",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <CinematicHero />
      <FeaturedSpecScroll />
      <ProcessSection />
      <SourcingTeaser />
      <FeaturedBuilds />
      <PartsShowcase />
      <PricingReveal />
      <WhyM1 />
      <FinalCTA />
    </>
  );
}
