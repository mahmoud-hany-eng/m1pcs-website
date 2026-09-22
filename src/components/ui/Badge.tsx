import { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-xs sm:text-sm font-medium text-text-secondary">
      {children}
    </span>
  );
}
