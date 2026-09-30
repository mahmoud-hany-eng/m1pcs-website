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
      <section className="relative">
        <Container className="pb-4 pt-16 sm:pb-6 sm:pt-24">
          <SectionHeading
            eyebrow="Portfolio"
            title="Completed builds"
            description="A selection of PCs M1 has previously configured and built for real customers in Qatar."
          />
        </Container>
      </section>

      <section className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-24 h-[700px] w-[min(1100px,140%)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.1),transparent)]"
        />
        <Container className="relative py-12 sm:py-16">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
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
