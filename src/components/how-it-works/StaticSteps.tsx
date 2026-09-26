import type { ComponentType } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CHAPTERS, type Chapter } from "./story";
import { IconCheck, IconCpu, IconHome, IconPlane, IconReceipt, IconWrench } from "./ui-icons";

const ICONS: Record<Chapter["id"], ComponentType<{ className?: string }>> = {
  parts: IconCpu,
  quote: IconReceipt,
  confirm: IconCheck,
  source: IconPlane,
  build: IconWrench,
  deliver: IconHome,
};

/**
 * Motion-free version of the story for visitors who prefer reduced motion
 * or whose device can't run WebGL: the same six steps and copy, as a clear
 * vertical process.
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
          <ol className="relative mt-14 flex w-full flex-col gap-11">
            {CHAPTERS.map((step, i) => {
              const Icon = ICONS[step.id];
              return (
                <li key={step.id} className="relative flex flex-col items-center gap-3">
                  {i < CHAPTERS.length - 1 && (
                    <span className="absolute left-1/2 top-[3.75rem] h-[calc(100%-1.5rem)] w-px -translate-x-1/2 bg-gradient-to-b from-accent/40 to-transparent" aria-hidden="true" />
                  )}
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10 text-accent">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{step.headline}</h2>
                  <p className="max-w-lg text-base text-text-secondary sm:text-lg">{step.body}</p>
                </li>
              );
            })}
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
