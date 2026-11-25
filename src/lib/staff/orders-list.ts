/**
 * The Orders list's choices, read from the address bar and written back into it. Pure: no server code, no database, no clock except what is
 * passed in, so the rules are unit-tested and both the page and its links use the same ones.
 *
 * The address is the single source of truth, so a filtered, sorted page can be bookmarked or sent to someone and shows exactly the same list:
 *
 *   q        the search text (order number, customer name or customer code)
 *   status   one status code
 *   year     the year the orders were PLACED in         \  a month with no year means that month of the current Qatar year
 *   month    the month (1-12) they were placed in        /
 *   from     first Qatar calendar day, inclusive (YYYY-MM-DD)  \  a custom range wins over the year and the month
 *   to       last Qatar calendar day, inclusive (YYYY-MM-DD)   /  either end may be left open
 *   sort     newest (default) | oldest | price_asc | price_desc   (price = what the customer has to pay)
 *   size     5 (default) | 10 | 25 rows per page
 *   page     1-based
 *
 * The financial report's own choices (fy, fm: by COMPLETION date) are separate, and are carried through untouched.
 */
import { MONTH_NAMES } from "./finance";
import type { OrdersPage, OrdersSort } from "./types";

export const ORDER_SORTS: readonly { value: OrdersSort; label: string }[] = [
  { value: "newest", label: "Newest orders first" },
  { value: "oldest", label: "Oldest orders first" },
  { value: "price_asc", label: "Lowest order price first" },
  { value: "price_desc", label: "Highest order price first" },
];
export const PAGE_SIZES: readonly number[] = [5, 10, 25];
export const DEFAULT_PAGE_SIZE = 5;
export const MIN_YEAR = 2020;
export const MAX_YEAR = 2100;
const MAX_PAGE = 100_000;

export interface OrdersListQuery {
  q: string;
  status: string;
  year: number | null;
  month: number | null;
  from: string | null;
  to: string | null;
  sort: OrdersSort;
  size: number;
  page: number;
}
export type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const first = (value: string | readonly string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : ((value as string | undefined) ?? ""));

export const DEFAULT_QUERY: OrdersListQuery = { q: "", status: "", year: null, month: null, from: null, to: null, sort: "newest", size: DEFAULT_PAGE_SIZE, page: 1 };

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** "2026-11-25" as people write it: "25 Nov 2026". */
export function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1].slice(0, 3)} ${m[1]}`;
}

type Day = { ok: true; value: string | null } | { ok: false; message: string };
/** An empty value is "no date". Anything else must be a real calendar day written YYYY-MM-DD, inside the supported years. */
export function parseDay(text: string): Day {
  const value = text.trim();
  if (value === "") return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const y = m ? Number(m[1]) : 0;
  const mo = m ? Number(m[2]) : 0;
  const d = m ? Number(m[3]) : 0;
  if (!m || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
    return { ok: false, message: `“${value.slice(0, 20)}” is not a real date. Pick it from the calendar or write it as YYYY-MM-DD.` };
  }
  if (y < MIN_YEAR || y > MAX_YEAR) return { ok: false, message: `The date ${dayText(value)} is outside the supported years (${MIN_YEAR} to ${MAX_YEAR}).` };
  return { ok: true, value };
}

/**
 * Reads the choices. Anything unreadable falls back to its default (an unknown sort, a page size that is not offered, a status that does not
 * exist), EXCEPT the two dates and their order: a date that is not real, or a start after the end, is an ERROR the screen explains, because
 * quietly showing a different list than the one asked for would mislead. `statuses` is the list of status codes the screen offers.
 */
export function parseOrdersListQuery(raw: RawParams, statuses: readonly string[]): { query: OrdersListQuery; error: string | null } {
  const q = first(raw.q).trim().slice(0, 80);
  const requestedStatus = first(raw.status);
  const status = statuses.includes(requestedStatus) ? requestedStatus : "";
  const yearText = first(raw.year);
  const year = /^[0-9]{4}$/.test(yearText) && Number(yearText) >= MIN_YEAR && Number(yearText) <= MAX_YEAR ? Number(yearText) : null;
  const monthText = first(raw.month);
  const month = /^[0-9]{1,2}$/.test(monthText) && Number(monthText) >= 1 && Number(monthText) <= 12 ? Number(monthText) : null;
  const sortText = first(raw.sort);
  const sort = (ORDER_SORTS.find((s) => s.value === sortText)?.value ?? "newest") as OrdersSort;
  const sizeText = first(raw.size);
  const size = /^[0-9]{1,3}$/.test(sizeText) && PAGE_SIZES.includes(Number(sizeText)) ? Number(sizeText) : DEFAULT_PAGE_SIZE;
  const pageText = first(raw.page);
  const page = /^[0-9]{1,6}$/.test(pageText) && Number(pageText) >= 1 ? Math.min(Number(pageText), MAX_PAGE) : 1;

  const fromDay = parseDay(first(raw.from));
  const toDay = parseDay(first(raw.to));
  let error: string | null = null;
  if (!fromDay.ok) error = fromDay.message;
  else if (!toDay.ok) error = toDay.message;
  const from = fromDay.ok ? fromDay.value : null;
  const to = toDay.ok ? toDay.value : null;
  if (!error && from && to && from > to) {
    error = `The start date (${dayText(from)}) is after the end date (${dayText(to)}). Swap them, or change one of them.`;
  }
  return { query: { q, status, year, month, from, to, sort, size, page }, error };
}

/** The address query for a choice set: every default is left out, so the plain page is just /admin/orders. `extra` carries the report's own choices. */
export function ordersQueryString(query: OrdersListQuery, overrides: Partial<OrdersListQuery> = {}, extra: Readonly<Record<string, string>> = {}): string {
  const o = { ...query, ...overrides };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(extra)) if (value !== "") params.set(name, value);
  if (o.q) params.set("q", o.q);
  if (o.status) params.set("status", o.status);
  if (o.year !== null) params.set("year", String(o.year));
  if (o.month !== null) params.set("month", String(o.month));
  if (o.from) params.set("from", o.from);
  if (o.to) params.set("to", o.to);
  if (o.sort !== "newest") params.set("sort", o.sort);
  if (o.size !== DEFAULT_PAGE_SIZE) params.set("size", String(o.size));
  if (o.page > 1) params.set("page", String(o.page));
  return params.toString();
}
export function ordersHref(query: OrdersListQuery, overrides: Partial<OrdersListQuery> = {}, extra: Readonly<Record<string, string>> = {}, hash = ""): string {
  const qs = ordersQueryString(query, overrides, extra);
  return `/admin/orders${qs ? `?${qs}` : ""}${hash}`;
}

/** The list's choices as hidden form fields, so another form on the page (the report's period) can keep them. The page is kept too. */
export function ordersHiddenFields(query: OrdersListQuery): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(ordersQueryString(query)).entries());
}

/** True when any narrowing choice is active (anything but the plain default list); the sort and page size alone do not count. */
export function hasActiveFilters(query: OrdersListQuery): boolean {
  return Boolean(query.q || query.status || query.year !== null || query.month !== null || query.from || query.to);
}

/** The period in words, from what the DATABASE applied (not from what was typed): "placed in November 2026", "placed from 10 Nov 2026 to 25 Nov 2026". */
export function periodWords(filters: OrdersPage["filters"]): string | null {
  if (filters.from || filters.to) {
    if (filters.from && filters.to) return filters.from === filters.to ? `placed on ${dayText(filters.from)}` : `placed from ${dayText(filters.from)} to ${dayText(filters.to)}`;
    return filters.from ? `placed on or after ${dayText(filters.from)}` : `placed on or before ${dayText(filters.to as string)}`;
  }
  if (filters.year !== null && filters.month !== null) return `placed in ${MONTH_NAMES[filters.month - 1]} ${filters.year}`;
  if (filters.year !== null) return `placed in ${filters.year}`;
  return null;
}

/** "Showing 1–5 of 23 orders", or "No orders match" when nothing does. */
export function summaryText(page: Pick<OrdersPage, "total" | "first" | "last">): string {
  if (page.total === 0) return "No orders match";
  return `Showing ${page.first}–${page.last} of ${page.total} ${page.total === 1 ? "order" : "orders"}`;
}
