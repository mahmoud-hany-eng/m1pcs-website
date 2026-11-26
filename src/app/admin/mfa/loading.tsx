import { Container } from "@/components/ui/Container";

// The second-step page is a single card, not the dashboard frame, so it gets its own placeholder (static, no animation, no data).
const block = "block rounded-md bg-white/[0.07]";

export default function MfaLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading
      </p>
      <Container className="flex justify-center pb-20 pt-12 sm:pt-20">
        <div className="glass glass-strong w-full max-w-md p-6 sm:p-8" aria-hidden="true">
          <div className="mb-6 flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">M1 staff</span>
            <span className={`${block} h-8 w-3/4`} />
            <span className={`${block} h-3 w-full`} />
            <span className={`${block} h-3 w-2/3`} />
          </div>
          <span className={`${block} h-11 w-full`} />
        </div>
      </Container>
    </div>
  );
}
