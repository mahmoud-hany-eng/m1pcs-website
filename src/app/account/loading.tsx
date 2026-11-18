import { Container } from "@/components/ui/Container";

/** Shown while an account page is fetched. It carries no data and no name. */
export default function AccountLoading() {
  return (
    <section aria-busy="true" aria-label="Loading your account">
      <Container className="pb-16 pt-10 sm:pt-14">
        <div className="flex animate-pulse flex-col gap-6">
          <div className="h-5 w-32 rounded-full bg-border" />
          <div className="h-10 w-2/3 max-w-md rounded-glass-sm bg-border" />
          <div className="mt-4 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-9 w-24 rounded-full bg-border" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-28 rounded-glass bg-border/70" />
            ))}
          </div>
          <div className="h-56 rounded-glass bg-border/50" />
        </div>
      </Container>
    </section>
  );
}
