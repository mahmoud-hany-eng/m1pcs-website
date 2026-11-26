/**
 * Previous / Next under the table, shown only when there is more than one page. Plain links that carry every choice (search, filters, sort and the
 * financial report's own period), so a page is bookmarkable and nothing here can change data.
 */
import Link from "next/link";
import { ordersHref, type OrdersListQuery } from "@/lib/staff/orders-list";
import type { OrdersOverview } from "@/lib/staff/types";

const LINK = "btn-sheen btn-glass inline-flex min-h-[2.5rem] items-center justify-center rounded-full px-4 text-sm font-semibold";
const OFF = "inline-flex min-h-[2.5rem] items-center justify-center rounded-full border border-border px-4 text-sm font-semibold text-text-muted opacity-60";

export function OrdersPager({ query, page, reportParams }: { query: OrdersListQuery; page: Pick<OrdersOverview, "page" | "pages">; reportParams: Readonly<Record<string, string>> }) {
  if (page.pages <= 1) return null;
  return (
    <nav aria-label="Orders pages" className="mt-4 flex items-center justify-between gap-3" data-testid="orders-pager">
      {page.page > 1 ? (
        <Link href={ordersHref(query, { page: page.page - 1 }, reportParams)} rel="prev" className={LINK} data-testid="orders-prev">
          Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={OFF} data-testid="orders-prev">
          Previous
        </span>
      )}
      <span className="text-sm text-text-secondary" data-testid="orders-page-of">
        Page {page.page} of {page.pages}
      </span>
      {page.page < page.pages ? (
        <Link href={ordersHref(query, { page: page.page + 1 }, reportParams)} rel="next" className={LINK} data-testid="orders-next">
          Next
        </Link>
      ) : (
        <span aria-disabled="true" className={OFF} data-testid="orders-next">
          Next
        </span>
      )}
    </nav>
  );
}
