import { ReactNode } from "react";
import { Container } from "@/components/ui/Container";

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
    <section className="border-y border-border bg-surface">
      <Container className="py-14 sm:py-20">
        <div className="flex flex-col items-center gap-6 text-center">
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight max-w-2xl">
            {title}
          </h2>
          {description && (
            <p className="text-text-secondary text-base sm:text-lg max-w-xl">
              {description}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            {children}
          </div>
        </div>
      </Container>
    </section>
  );
}
