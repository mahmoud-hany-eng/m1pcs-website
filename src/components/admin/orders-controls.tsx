/**
 * The Orders list's controls: the filter panel and the page links. Server components with no state: a plain GET form, so everything works
 * without scripts, nothing it carries can change data, and the address bar always shows exactly what is on screen (see lib/staff/orders-list.ts).
 *
 * Layout (one coherent panel, phone first):
 *   row 1  search field and the Search button
 *   row 2  Month, Year | custom dates From, To   (the dates take precedence, and the panel says so)
 *   row 3  Status, Sort by, Rows per page, Apply and Reset
 *
 * The wide arrangements start at the xl breakpoint, not earlier: beside the dashboard's sidebar a 1024px screen leaves little more than 700px of room.
 */
import Link from "next/link";
import { MONTH_NAMES } from "@/lib/staff/finance";
import { ORDER_SORTS, PAGE_SIZES, ordersHref, type OrdersListQuery } from "@/lib/staff/orders-list";
import type { OrdersPage } from "@/lib/staff/types";

const LABEL = "flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted";
const FIELD = "glass-input min-h-[2.75rem] w-full min-w-0 px-3 py-2 text-sm normal-case tracking-normal text-white";
const BUTTON = "btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-5 py-2 text-sm font-semibold";

export function OrdersFilterPanel({
  query,
  statuses,
  years,
  effectiveYear,
  reportParams,
}: {
  query: OrdersListQuery;
  statuses: readonly (readonly [string, string])[];
  /** Years in which orders were placed (from the database), newest first. */
  years: readonly number[];
  /** The year the database applied (a month chosen with no year means the current one), shown as selected. */
  effectiveYear: number | null;
  /** The financial report's own choices (fy, fm). They ride along untouched, so filtering the list never changes the report. */
  reportParams: Readonly<Record<string, string>>;
}) {
  const rangeInUse = Boolean(query.from || query.to);
  const yearOptions = Array.from(new Set([...years, ...(effectiveYear !== null ? [effectiveYear] : []), ...(query.year !== null ? [query.year] : [])])).sort((a, b) => b - a);
  const selectedYear = effectiveYear ?? query.year;
  const resetHref = ordersHref(query, { q: "", status: "", year: null, month: null, from: null, to: null, sort: "newest", size: 5, page: 1 }, reportParams, "#orders-list");
  return (
    <form action="/admin/orders#orders-list" method="get" role="search" className="mb-5 flex flex-col gap-4 rounded-glass-sm border border-border bg-white/[0.02] p-3 sm:p-4" data-testid="orders-filters">
      {Object.entries(reportParams).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {/* Row 1: search */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="orders-row-search">
        <label className={`${LABEL} flex-1`} htmlFor="orders-search">
          Search
          <input
            id="orders-search"
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Search by order number or customer"
            maxLength={80}
            className={FIELD}
          />
        </label>
        <button type="submit" className={`${BUTTON} sm:min-w-[7.5rem]`}>
          Search
        </button>
      </div>

      {/* Row 2: when the order was placed */}
      <div className="grid gap-3 xl:grid-cols-2" data-testid="orders-row-dates">
        <fieldset className={`min-w-0 rounded-glass-sm border border-border p-3 transition-opacity ${rangeInUse ? "opacity-60" : ""}`} data-testid="orders-period" data-overridden={rangeInUse ? "true" : "false"}>
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Placed in{rangeInUse ? " · ignored" : ""}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL} htmlFor="orders-month">
              Month
              <select id="orders-month" name="month" defaultValue={query.month === null ? "" : String(query.month)} className={FIELD}>
                <option value="">All months</option>
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL} htmlFor="orders-year">
              Year
              <select id="orders-year" name="year" defaultValue={selectedYear === null ? "" : String(selectedYear)} className={FIELD}>
                <option value="">All years</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-text-muted" data-testid="orders-period-hint">
            {rangeInUse ? "Ignored while custom dates are set." : "Pick a month, a year, or both. A month with no year means that month of the current year."}
          </p>
        </fieldset>
        <fieldset className={`min-w-0 rounded-glass-sm border p-3 ${rangeInUse ? "border-accent/50 bg-accent/[0.04]" : "border-border"}`} data-testid="orders-range" data-active={rangeInUse ? "true" : "false"}>
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Or between two dates{rangeInUse ? " · in use" : ""}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL} htmlFor="orders-from">
              From date
              <input id="orders-from" type="date" name="from" defaultValue={query.from ?? ""} min="2020-01-01" max="2100-12-31" className={`${FIELD} [color-scheme:dark]`} />
            </label>
            <label className={LABEL} htmlFor="orders-to">
              To date
              <input id="orders-to" type="date" name="to" defaultValue={query.to ?? ""} min="2020-01-01" max="2100-12-31" className={`${FIELD} [color-scheme:dark]`} />
            </label>
          </div>
          <p className="mt-2 text-xs text-text-muted" data-testid="orders-range-hint">
            Both days are included (Qatar time). Leave one empty for an open-ended range. A date range takes precedence over the month and year.
          </p>
        </fieldset>
      </div>

      {/* Row 3: status, sort, rows per page, actions */}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.65fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,9rem)_auto] xl:items-end" data-testid="orders-row-controls">
        <label className={LABEL} htmlFor="orders-status">
          Status
          <select id="orders-status" name="status" defaultValue={query.status} className={FIELD}>
            {statuses.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL} htmlFor="orders-sort">
          Sort by
          <select id="orders-sort" name="sort" defaultValue={query.sort} className={FIELD}>
            {ORDER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL} htmlFor="orders-size">
          Rows per page
          <select id="orders-size" name="size" defaultValue={String(query.size)} className={FIELD}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3 sm:justify-end xl:col-span-1 xl:justify-start">
          <button type="submit" className={`${BUTTON} btn-red flex-1 sm:flex-none`} data-testid="orders-apply">
            Apply filters
          </button>
          <Link href={resetHref} className={`${BUTTON} flex-1 sm:flex-none`} data-testid="orders-reset">
            Reset filters
          </Link>
        </div>
      </div>
    </form>
  );
}

/** Previous / Next and the page count. The links keep every filter, the sort, the page size and the report's own choices. */
export function OrdersPagination({ query, page, reportParams }: { query: OrdersListQuery; page: Pick<OrdersPage, "page" | "pages" | "total">; reportParams: Readonly<Record<string, string>> }) {
  if (page.total === 0) return null;
  const href = (n: number) => ordersHref(query, { page: n }, reportParams, "#orders-list");
  const disabled = "inline-flex min-h-[2.5rem] items-center rounded-full border border-border px-4 text-sm font-semibold text-text-muted opacity-50";
  const enabled = "btn-sheen btn-glass inline-flex min-h-[2.5rem] items-center rounded-full px-4 text-sm font-semibold";
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Orders pages" data-testid="orders-pagination">
      {page.page > 1 ? (
        <Link href={href(page.page - 1)} rel="prev" className={enabled} data-testid="orders-prev">
          ← Previous
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true" data-testid="orders-prev">
          ← Previous
        </span>
      )}
      <span className="text-sm text-text-muted" data-testid="orders-page-of">
        Page {page.page} of {page.pages}
      </span>
      {page.page < page.pages ? (
        <Link href={href(page.page + 1)} rel="next" className={enabled} data-testid="orders-next">
          Next →
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true" data-testid="orders-next">
          Next →
        </span>
      )}
    </nav>
  );
}
