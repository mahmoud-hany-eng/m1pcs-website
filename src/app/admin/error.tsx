"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Nothing from the error is shown or logged here: it may describe a table or a query.
    void error;
  }, [error]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background p-6">
      <div className="glass glass-strong w-full max-w-md p-6 text-center">
        <h1 className="font-display text-xl font-bold text-white">The dashboard could not load</h1>
        <p className="mt-2 text-sm text-text-secondary">Nothing was changed. Check your connection and try again. If it keeps happening, tell the person who manages the system.</p>
        <button type="button" onClick={reset} className="btn-sheen btn-red mt-5 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold">
          Try again
        </button>
      </div>
    </div>
  );
}
