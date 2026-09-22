import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How M1's custom PC quotation process works, from your first message to delivery or collection.",
  alternates: { canonical: "/how-it-works" },
};

const steps = [
  {
    number: "1",
    title: "Tell Us What You Need",
    description: "Submit your budget and PC requirements.",
  },
  {
    number: "2",
    title: "Receive Your Quotation",
    description:
      "M1 recommends suitable components and prepares current pricing.",
  },
  {
    number: "3",
    title: "Review Your Build",
    description: "Review the specifications and request changes if needed.",
  },
  {
    number: "4",
    title: "Confirm Your Order",
    description: "Approve the final quotation.",
  },
  {
    number: "5",
    title: "Payment & Preparation",
    description: "Complete the agreed payment and order process.",
  },
  {
    number: "6",
    title: "Delivery / Collection",
    description:
      "Receive the completed order according to the agreed arrangement.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Process"
            title="How it works"
            description="A straightforward, six-step process from your first message to your finished PC."
          />
        </Container>
      </section>

      <section>
        <Container className="py-16 sm:py-24">
          <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step) => (
              <li
                key={step.number}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface p-6"
              >
                <span className="font-display text-3xl font-bold text-accent">
                  {step.number}
                </span>
                <h2 className="font-display text-lg font-semibold">
                  {step.title}
                </h2>
                <p className="text-sm text-text-secondary">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>

          <p className="mt-10 max-w-2xl text-sm text-text-muted">
            Timelines for quotation, preparation and delivery/collection vary
            depending on component availability and order volume. M1 will
            confirm an estimated timeline directly with you as part of your
            quotation.
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
