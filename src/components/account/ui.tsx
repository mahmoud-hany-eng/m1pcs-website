/**
 * Small presentational pieces for the customer area. All are server components with no state: they receive display
 * text that the view models produced from database rows, and draw it in the site's dark-glass style.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusTone, StatusView } from "@/lib/accounts/shared/view-models";

const TONE: Record<StatusTone, string> = {
  progress: "border-accent/40 bg-accent/10 text-accent",
  done: "border-success/40 bg-success/10 text-success",
  paused: "border-warning/40 bg-warning/10 text-warning",
  cancelled: "border-error/40 bg-error/10 text-error",
};

export function StatusPill({ status }: { status: StatusView }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${TONE[status.tone]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.label}
    </span>
  );
}

/** A row of segments, one per stage on the normal path, filled up to the current one. */
export function ProgressSteps({ status }: { status: StatusView }) {
  if (status.steps === 0) return null;
  const current = status.step ?? 0;
  return (
    <div>
      <div className="flex gap-1.5" role="img" aria-label={status.step ? `Stage ${status.step} of ${status.steps}: ${status.label}` : status.label}>
        {Array.from({ length: status.steps }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${index < current ? (status.tone === "done" ? "bg-success" : "bg-primary") : "bg-border-strong/70"}`}
          />
        ))}
      </div>
      {status.step ? (
        <p className="mt-2 text-xs text-text-muted">
          Stage {status.step} of {status.steps}
        </p>
      ) : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "gold" | "red" }) {
  const tint = tone === "gold" ? "glass-tint-gold" : tone === "red" ? "glass-tint-red" : "";
  return (
    <div className={`glass glass-flat ${tint} flex flex-col gap-1 p-5`}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</span>
      <span className="font-display text-2xl font-semibold text-white sm:text-3xl">{value}</span>
      {hint ? <span className="text-sm text-text-secondary">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="glass glass-flat flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span aria-hidden="true" className="mb-1 flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface-elevated text-xl text-accent">
        ◇
      </span>
      <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      <div className="max-w-md text-sm text-text-secondary">{children}</div>
      {action ? (
        <Link href={action.href} className="btn-sheen btn-glass mt-2 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="glass glass-flat p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: ReactNode }) {
  const style =
    tone === "success"
      ? "border-success/40 bg-success/10 text-success"
      : tone === "error"
        ? "border-error/40 bg-error/10 text-error"
        : "border-accent/30 bg-accent/10 text-white/90";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-glass-sm border px-4 py-3 text-sm ${style}`}>
      {children}
    </p>
  );
}

/** Shown on every account page when a preview label is configured, so a demonstration can never pass for the real thing. */
export function PreviewBanner({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div role="note" className="border-b border-warning/50 bg-warning/15 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-warning">
      {label}
    </div>
  );
}
