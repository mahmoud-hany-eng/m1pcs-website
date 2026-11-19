/**
 * Presentational pieces for the admin area. Server components with no state: they draw what the staff functions
 * returned. Money arrives as integer minor units and is formatted here with the shared formatter, never with floats.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { formatQar } from "@/lib/platform/money";
import { statusTone, type Tone } from "@/lib/staff/format";

const TONE: Record<Tone, string> = {
  progress: "border-accent/40 bg-accent/10 text-accent",
  done: "border-success/40 bg-success/10 text-success",
  paused: "border-warning/40 bg-warning/10 text-warning",
  cancelled: "border-error/40 bg-error/10 text-error",
  neutral: "border-border-strong bg-white/[0.04] text-text-secondary",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function StatusBadge({ code, label }: { code: string; label: string }) {
  return <Badge tone={statusTone(code)}>{label}</Badge>;
}

export function Money({ minor, className = "" }: { minor: number; className?: string }) {
  return <span className={`whitespace-nowrap tabular-nums ${className}`}>{formatQar(minor)}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "gold" | "red";
  href?: string;
}) {
  const tint = tone === "gold" ? "glass-tint-gold" : tone === "red" ? "glass-tint-red" : "";
  const body = (
    <div className={`glass glass-flat ${tint} flex h-full flex-col gap-1 p-4 sm:p-5`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</span>
      <span className="font-display text-2xl font-semibold text-white sm:text-[1.75rem]">{value}</span>
      {hint ? <span className="text-xs text-text-secondary">{hint}</span> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-glass transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="glass glass-flat p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-white sm:text-lg">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-glass-sm border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted">{children}</p>;
}

export function KeyValues({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm text-white">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LinkButton({ href, children, variant = "glass" }: { href: string; children: ReactNode; variant?: "glass" | "red" }) {
  return (
    <Link href={href} className={`btn-sheen ${variant === "red" ? "btn-red" : "btn-glass"} inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold`}>
      {children}
    </Link>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** The cell that titles a row when the table turns into cards on a phone. */
  primary?: boolean;
  /** Hidden on a phone card (still shown in the table). */
  hideOnCard?: boolean;
}

/**
 * A table on a wide screen and a stack of cards on a phone, so nothing scrolls sideways and no amount is cut off.
 * The same cells feed both, so the two views can never disagree.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  empty,
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const others = columns.filter((c) => c !== primary && !c.hideOnCard);
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="group">
                {columns.map((c, index) => (
                  <td key={c.key} className={`border-b border-border/60 px-3 py-3 align-middle text-text-secondary group-hover:bg-white/[0.03] ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {index === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium text-white hover:text-accent focus-visible:outline-2">
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-glass-sm border border-border bg-white/[0.025] p-4">
            <div className="mb-3 text-sm font-semibold text-white">
              {rowHref ? (
                <Link href={rowHref(row)} className="hover:text-accent">
                  {primary.cell(row)}
                </Link>
              ) : (
                primary.cell(row)
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {others.map((c) => (
                <div key={c.key} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{c.header}</dt>
                  <dd className="min-w-0 break-words text-sm text-text-secondary">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A GET search form: nothing it carries can change data, and the query is only ever sent to a search function. */
export function SearchBar({ action, name = "q", value, placeholder, extra }: { action: string; name?: string; value?: string; placeholder: string; extra?: ReactNode }) {
  return (
    <form action={action} method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor={`search-${name}`}>
        {placeholder}
      </label>
      <input id={`search-${name}`} type="search" name={name} defaultValue={value ?? ""} placeholder={placeholder} maxLength={80} className="glass-input min-h-[2.75rem] flex-1 px-4 py-2 text-sm" />
      {extra}
      <button type="submit" className="btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-5 text-sm font-semibold">
        Search
      </button>
    </form>
  );
}
