import { ReactNode } from "react";
import { Container } from "@/components/ui/Container";

/**
 * Closing call-to-action for inner routes: open section, a warm pool of
 * light behind it, and the content held on one floating glass pane.
 */
export function CTABlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[360px] w-[min(900px,120%)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(231_50_37/0.16),transparent)]"
      />
      <Container className="relative py-16 sm:py-24">
        <div className="glass glass-tint-red mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-glass-lg px-6 py-10 text-center sm:px-12 sm:py-14">
          <h2 className="max-w-2xl font-display text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
            {title}
          </h2>
          {description && (
            <p className="max-w-xl text-base text-text-secondary sm:text-lg">{description}</p>
          )}
          <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">{children}</div>
        </div>
      </Container>
    </section>
  );
}
