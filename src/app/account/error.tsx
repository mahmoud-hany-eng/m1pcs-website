"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { Container } from "@/components/ui/Container";

/**
 * The error state for the account area. It never shows the error: the message could name a table or a query. The
 * detail goes to the server log only (without personal data); the customer sees a calm, fixed message and can retry.
 */
export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // reset() alone only re-renders what the browser already has, and the failure came from the server. Refreshing the
  // route fetches the page again, so a brief outage clears as soon as the service is back.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <section>
      <Container className="flex justify-center pb-20 pt-16">
        <div role="alert" className="glass glass-strong flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
          <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full border border-warning/50 bg-warning/10 text-xl text-warning">
            !
          </span>
          <h1 className="font-display text-2xl font-bold text-white">We could not load your account</h1>
          <p className="text-sm text-text-secondary">
            This is usually temporary. Nothing has been changed. Try again, and if it keeps happening, message M1 on WhatsApp and we will help.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={retry} className="btn-sheen btn-red inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold">
              Try again
            </button>
            <Link href="/" className="btn-sheen btn-glass inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold">
              Back to the website
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
