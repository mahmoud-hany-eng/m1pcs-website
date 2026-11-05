import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

// The 404 status already keeps this out of the index; `noindex` makes it explicit.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="relative">
      <Container className="flex flex-col items-center gap-8 py-24 text-center sm:py-32">
        <SectionHeading
          as="h1"
          eyebrow="404"
          title="We couldn't find that page"
          description="The link may be out of date, or the page may have moved. These are good places to continue."
        />
        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
          <Button href="/" size="lg" className="w-full sm:w-auto">
            Back to home
          </Button>
          <Button href="/completed-builds" variant="glass" size="lg" className="w-full sm:w-auto">
            See completed builds
          </Button>
          <Button href="/build-my-pc" variant="glass" size="lg" className="w-full sm:w-auto">
            Request a quote
          </Button>
        </div>
      </Container>
    </section>
  );
}
