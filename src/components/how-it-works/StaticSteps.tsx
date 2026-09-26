import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CHAPTERS } from "./story";

/**
 * Motion-free version of the story for visitors who prefer reduced motion
 * or whose device can't run WebGL. Same copy, same order, centred.
 */
export function StaticSteps() {
  return (
    <section aria-labelledby="how-it-works-title" className="border-b border-border">
      <Container className="py-16 sm:py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-accent sm:text-sm">Process</p>
          <h1 id="how-it-works-title" className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            How It Works
          </h1>
          <ol className="mt-14 flex w-full flex-col gap-12">
            {CHAPTERS.map((step, i) => (
              <li key={step.id} className="flex flex-col items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-accent/60 font-display text-sm font-bold text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{step.headline}</h2>
                <p className="max-w-lg text-base text-text-secondary sm:text-lg">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-14 flex flex-col gap-3 sm:flex-row">
            <Button href="/build-my-pc" size="lg">
              Request a PC Quote
            </Button>
            <Button href="/completed-builds" variant="outline" size="lg">
              See Completed Builds
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
