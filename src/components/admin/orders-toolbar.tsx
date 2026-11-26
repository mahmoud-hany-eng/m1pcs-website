/**
 * The Orders page's three controls, and nothing else on the page above the table: a Search field, a compact Sort menu and a compact Filter panel.
 * Server components with plain GET forms and <details> dropdowns, so everything works without scripts, nothing here can change data, and the address
 * bar always shows exactly what is on screen (lib/staff/orders-list.ts). Sort and Filter are closed until clicked; only one is open at a time.
 *
 * Phone: the search field has its own row, Sort and Filter share the next one, and an open menu takes the full width below them.
 * From the small breakpoint: all three sit on one row and an open menu hangs under its own button.
 */
import Link from "next/link";
import { MONTH_NAMES } from "@/lib/staff/finance";
import { activeFilterCount, ordersHref, ordersQueryString, sortLabel, sortsFor, type OrdersListQuery } from "@/lib/staff/orders-list";
import { MenuDismiss } from "./MenuDismiss";

const LABEL = "flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted";
const FIELD = "glass-input min-h-[2.5rem] w-full min-w-0 px-3 py-1.5 text-sm normal-case tracking-normal text-white";
const MENU_BUTTON =
  "btn-glass inline-flex h-10 cursor-pointer select-none list-none items-center gap-2 rounded-full px-4 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden";
// An OPAQUE surface (not the frosted glass): the menu opens over the table, and anything showing through it would make its choices hard to read.
const PANEL = "absolute inset-x-0 top-full z-30 mt-2 rounded-glass-lg border border-border-strong bg-surface-elevated p-2 shadow-[0_24px_48px_-16px_rgb(0_0_0/0.85)] sm:inset-x-auto sm:right-0";

const Chevron = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 7.5 5 5 5-5" />
  </svg>
);

/** The query as hidden form fields, minus the choices the form itself provides. */
function hiddenFields(query: OrdersListQuery, without: Partial<OrdersListQuery>, reportParams: Readonly<Record<string, string>>): [string, string][] {
  return [...new URLSearchParams(ordersQueryString({ ...query, ...without, page: 1 }, {}, reportParams)).entries()];
}

export function OrdersToolbar({
  query,
  statuses,
  years,
  effectiveYear,
  reportParams,
  canSeeFinance,
}: {
  query: OrdersListQuery;
  statuses: readonly (readonly [string, string])[];
  /** Years in which orders were placed (from the database), newest first. */
  years: readonly number[];
  /** The year the database applied (a month chosen with no year means the current one). */
  effectiveYear: number | null;
  /** The financial report's own choices (fy, fm). They ride along untouched, so searching or filtering never changes the report. */
  reportParams: Readonly<Record<string, string>>;
  canSeeFinance: boolean;
}) {
  // A menu is re-created whenever the address changes, so it is always closed after a choice (a <details> keeps its open state across a client navigation otherwise).
  const address = ordersQueryString(query, {}, reportParams);
  const filters = activeFilterCount(query);
  const yearOptions = Array.from(new Set([...years, ...(effectiveYear !== null ? [effectiveYear] : []), ...(query.year !== null ? [query.year] : [])])).sort((a, b) => b - a);
  const selectedYear = effectiveYear ?? query.year;
  const clearHref = ordersHref(query, { status: "", year: null, month: null, from: null, to: null, page: 1 }, reportParams);
  return (
    <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="orders-toolbar">
      <MenuDismiss />

      <form action="/admin/orders" method="get" role="search" className="flex min-w-0 flex-1 items-center gap-2" data-testid="orders-search">
        {hiddenFields(query, { q: "" }, reportParams).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label htmlFor="orders-search-q" className="sr-only">
          Search orders by order number or customer
        </label>
        <input
          id="orders-search-q"
          type="search"
          name="q"
          defaultValue={query.q}
          placeholder="Search order number or customer"
          maxLength={80}
          className="glass-input min-h-[2.5rem] min-w-0 flex-1 px-4 py-2 text-sm"
        />
        <button type="submit" aria-label="Search" className="btn-sheen btn-glass inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" />
          </svg>
        </button>
      </form>

      <div className="flex gap-2">
        {/* SORT: one link per choice; the button says which one is in force. */}
        <details key={`sort:${address}`} name="orders-menu" data-menu className="group sm:relative" data-testid="orders-sort-menu">
          <summary className={MENU_BUTTON} data-testid="orders-sort-button" aria-label={`Sort: ${sortLabel(query.sort)}`}>
            <span>Sort</span>
            <span className="hidden max-w-[10rem] truncate font-normal text-text-secondary sm:inline" data-testid="orders-sort-current">
              {sortLabel(query.sort)}
            </span>
            <Chevron />
          </summary>
          <div className={`${PANEL} sm:w-60`} data-testid="orders-sort-panel">
            <ul className="flex flex-col">
              {sortsFor(canSeeFinance).map((sort) => {
                const current = sort.value === query.sort;
                return (
                  <li key={sort.value}>
                    <Link
                      href={ordersHref(query, { sort: sort.value, page: 1 }, reportParams)}
                      aria-current={current ? "true" : undefined}
                      data-testid={`orders-sort-${sort.value}`}
                      className={`flex min-h-[2.5rem] items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-sm font-medium transition-colors ${current ? "bg-white/[0.06] text-accent" : "text-text-primary/90 hover:bg-white/[0.05] hover:text-white"}`}
                    >
                      {sort.label}
                      {current ? (
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                        </svg>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>

        {/* FILTER: status, month and year, or a date range. Closed until clicked; a count on the button says how many are in use. */}
        <details key={`filter:${address}`} name="orders-menu" data-menu className="group sm:relative" data-testid="orders-filter-menu">
          <summary className={MENU_BUTTON} data-testid="orders-filter-button" aria-label={filters > 0 ? `Filter, ${filters} in use` : "Filter"}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h14M6 10h8M8.5 15h3" />
            </svg>
            <span>Filter</span>
            {filters > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-black" data-testid="orders-filter-count">
                {filters}
              </span>
            ) : null}
            <Chevron />
          </summary>
          <div className={`${PANEL} p-3.5 sm:w-80`} data-testid="orders-filter-panel">
            <form action="/admin/orders" method="get" className="flex flex-col gap-3" data-testid="orders-filter-form">
              {hiddenFields(query, { status: "", year: null, month: null, from: null, to: null }, reportParams).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <label className={LABEL}>
                Status
                <select name="status" defaultValue={query.status} className={`${FIELD} cursor-pointer`} data-testid="orders-filter-status">
                  {statuses.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={LABEL}>
                  Month
                  <select name="month" defaultValue={query.month === null ? "" : String(query.month)} className={`${FIELD} cursor-pointer`} data-testid="orders-filter-month">
                    <option value="">Any</option>
                    {MONTH_NAMES.map((name, index) => (
                      <option key={name} value={index + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  Year
                  <select name="year" defaultValue={selectedYear === null ? "" : String(selectedYear)} className={`${FIELD} cursor-pointer`} data-testid="orders-filter-year">
                    <option value="">Any</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className={LABEL}>
                  From
                  <input type="date" name="from" defaultValue={query.from ?? ""} min="2020-01-01" max="2100-12-31" className={FIELD} data-testid="orders-filter-from" />
                </label>
                <label className={LABEL}>
                  To
                  <input type="date" name="to" defaultValue={query.to ?? ""} min="2020-01-01" max="2100-12-31" className={FIELD} data-testid="orders-filter-to" />
                </label>
              </div>
              <p className="text-xs text-text-muted">Dates are the day the order was placed. A date range is used instead of the month and year.</p>
              <div className="flex items-center justify-between gap-3">
                <Link href={clearHref} className="text-sm font-semibold text-text-secondary underline-offset-4 hover:text-white hover:underline" data-testid="orders-filter-clear">
                  Clear filters
                </Link>
                <button type="submit" className="btn-sheen btn-red inline-flex min-h-[2.5rem] items-center justify-center rounded-full px-5 text-sm font-semibold" data-testid="orders-filter-apply">
                  Apply
                </button>
              </div>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
