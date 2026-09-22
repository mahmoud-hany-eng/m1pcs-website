import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BuildCard } from "@/components/cards/BuildCard";
import { CTABlock } from "@/components/cta/CTABlock";
import { Button } from "@/components/ui/Button";
import { completedBuilds } from "@/lib/builds";

export const metadata: Metadata = {
  title: "Completed Builds",
  description:
    "Browse examples of custom gaming PCs previously built by M1 in Qatar, and request a similar build.",
  alternates: { canonical: "/completed-builds" },
};

export default function CompletedBuildsPage() {
  return (
    <>
      <section className="border-b border-border">
        <Container className="py-16 sm:py-24">
          <SectionHeading
            eyebrow="Portfolio"
            title="Completed builds"
            description="A selection of PCs M1 has previously configured and built for real customers in Qatar."
          />
        </Container>
      </section>

      <section>
        <Container className="py-16 sm:py-24">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {completedBuilds.map((build) => (
              <BuildCard key={build.slug} build={build} />
            ))}
          </div>
        </Container>
      </section>

      <CTABlock
        title="See something close to what you want?"
        description="Request a similar build and we'll quote current equivalent components."
      >
        <Button href="/build-my-pc" size="lg" className="w-full sm:w-auto">
          Request a PC Quote
        </Button>
      </CTABlock>
    </>
  );
}
