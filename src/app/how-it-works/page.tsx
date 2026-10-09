import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";
import { HowItWorksExperience } from "@/components/how-it-works/HowItWorksExperience";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How M1's custom PC process works: pick your parts, review your quotation, confirm your order, U.S. sourcing, build and setup by M1, and delivery.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <>
      <HowItWorksExperience />

      <section className="border-t border-border">
        <Container className="py-14 sm:py-20">
          <p className="mx-auto max-w-2xl text-center text-sm text-text-muted">
            {siteConfig.operations.depositNote} {siteConfig.operations.deliveryNote}
          </p>
        </Container>
      </section>

      <CTABlock
        title="Start the process today"
        description="Submit your requirements and receive a custom quotation with no obligation."
      >
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
      </CTABlock>
    </>
  );
}
