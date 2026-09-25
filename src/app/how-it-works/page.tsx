import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";
import { ProcessStory } from "@/components/how-it-works/ProcessStory";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How M1's custom PC quotation process works, from your first message to delivery or collection.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Process"
            title="How it works"
            description="From your first message to a PC that's built, set up and delivered — including how we source your components."
          />
        </Container>
      </section>

      <ProcessStory />

      <section className="border-t border-border">
        <Container className="py-14 sm:py-20">
          <p className="max-w-2xl text-sm text-text-muted">
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
