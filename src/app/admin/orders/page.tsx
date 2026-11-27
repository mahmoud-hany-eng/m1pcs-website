import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { Badge, DataTable, LinkButton, Money, type Column } from "@/components/admin/ui";
import { FinancialPerformance } from "@/components/admin/finance";
import { OrdersPager } from "@/components/admin/orders-pager";
import { OrdersToolbar } from "@/components/admin/orders-toolbar";
import { ReceiptsCell } from "@/components/admin/receipts";
import { Notice } from "@/components/account/ui";
import { parseReportParams } from "@/lib/staff/finance";
import { formatDay } from "@/lib/staff/format";
import { hasActiveFilters, ordersHiddenFields, ordersHref, parseOrdersListQuery, periodWords, summaryText } from "@/lib/staff/orders-list";
import { settle } from "@/lib/staff/settle";
import { requireStaff } from "@/lib/staff/session";
import type { FinancialReport, OrdersOverview, OverviewOrderRow } from "@/lib/staff/types";

// The filter lists every status an order can have, in the owner's order, then the two that only orders on the earlier workflow use.
const STATUSES: [string, string][] = [
  ["", "All statuses"],
  ["pending_confirmation", "Order received"],
  ["awaiting_deposit", "Awaiting deposit"],
  ["deposit_received", "Deposit confirmed"],
  ["order_confirmed", "Order confirmed"],
  ["live_tracking", "Live tracking"],
  ["arrived_in_qatar", "Order arrived in Qatar"],
  ["carrier_delivering", "Carrier delivering order to M1"],
  ["building", "M1 is building your PC"],
  ["quality_check", "Final quality checks"],
  ["items_arrived", "Items arrived at M1"],
  ["awaiting_scheduling", "Awaiting scheduling for pickup or delivery"],
  ["ready_for_delivery", "Ready for delivery or pickup"],
  ["delivered", "Delivered / Collected"],
  ["on_hold", "On hold"],
  ["cancelled", "Cancelled"],
  ["sourcing", "Sourcing (earlier workflow)"],
  ["in_transit", "In transit (earlier workflow)"],
];
const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

type OrdersSearch = Record<string, string | string[] | undefined>;

const Unknown = ({ why }: { why: string }) => (
  <span className="text-text-muted" title={why}>
    —
  </span>
);

/** Order price less cost. Green for a gain, red for a loss; "provisional" until every cost is actual and declared complete; a dash when no cost was entered (unknown, never zero). */
function ProfitCell({ row }: { row: OverviewOrderRow }) {
  if (row.profit_minor === null || row.profit_minor === undefined) return <Unknown why="No cost has been entered for this order yet" />;
  const tone = row.profit_minor > 0 ? "text-success" : row.profit_minor < 0 ? "text-error" : "text-text-secondary";
  return (
    <span>
      <Money minor={row.profit_minor} className={tone} />
      {row.profit_is_provisional ? <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">provisional</span> : null}
    </span>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrdersSearch> }) {
  const { staff, api, can } = await requireStaff("/admin/orders");
  if (!can("orders.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  const params = await searchParams;
  const financeAllowed = can("finance.read");
  // The list's own choices (search, status, the date an order was PLACED, sort, page) come from the address bar and are answered by the database:
  // filtered, sorted, counted and cut to ONE page there, never loaded whole and sliced here. A profit sort is only accepted from a person who may see costs.
  const { query, error: queryError } = parseOrdersListQuery(params, STATUSES.map(([code]) => code), { canSeeFinance: financeAllowed });
  // The reporting period (year and month, by COMPLETION date) is separate: filtering the list never changes it, and choosing it never filters the list.
  const period = parseReportParams(first(params.fy) || undefined, first(params.fm) || undefined);
  // Each answer is independent: a failure in the reporting part never hides the list, and the other way round.
  const [pageResult, reportResult] = await Promise.all([
    queryError
      ? null
      : settle<OrdersOverview>(() =>
          api.listOrdersOverview({ search: query.q || null, status: query.status || null, year: query.year, month: query.month, from: query.from, to: query.to, sort: query.sort, page: query.page, pageSize: query.size }),
        ),
    financeAllowed ? settle<FinancialReport>(() => api.financialReport(period.year, period.month)) : null,
  ]);
  const report = reportResult?.ok ? reportResult.value : null;
  const reportError = reportResult && !reportResult.ok ? reportResult.error : null;
  const page = pageResult?.ok ? pageResult.value : null;
  const listError = queryError ?? (pageResult && !pageResult.ok ? pageResult.error : null);
  // The report's choices ride along in every list link and form, and the list's choices ride along in the report's form and links. Only what
  // was actually chosen is carried (an untouched report keeps following the current Qatar year by itself).
  const reportParams: Record<string, string> = {};
  if (period.year !== null) reportParams.fy = String(period.year);
  if (period.month !== null) reportParams.fm = String(period.month);
  const statusLabel = STATUSES.find(([code]) => code === query.status)?.[1] ?? "";
  const words = page
    ? [periodWords(page.filters), query.status ? `status: ${statusLabel}` : null, query.q ? `matching “${query.q}”` : null].filter((w): w is string => Boolean(w))
    : [];
  const plainLatest = page !== null && !hasActiveFilters(query) && query.sort === "newest" && page.page === 1 && page.total > page.last;

  // Seven columns, no more: the order (a link to its page), the customer, what the customer pays, then cost and profit (only for a person who may see
  // costs: the database leaves them out for anyone else), when it was placed, and the receipts button (only for a person who may see payments).
  const columns: Column<OverviewOrderRow>[] = [];
  if (page) {
    columns.push(
      { key: "ref", header: "Order", cell: (r) => <span className="whitespace-nowrap">{r.order_ref}</span>, primary: true },
      { key: "customer", header: "Customer", cell: (r) => r.customer_name },
      // What the customer has to PAY (order total less the discount and the redeemed loyalty credit): the amount the price sort uses.
      { key: "price", header: "Order price", cell: (r) => <Money minor={r.net_payable_minor} />, align: "right" },
    );
    if (page.can_see_finance) {
      columns.push(
        { key: "cost", header: "Cost", cell: (r) => (r.cost_minor === null || r.cost_minor === undefined ? <Unknown why="No cost has been entered for this order yet" /> : <Money minor={r.cost_minor} />), align: "right" },
        { key: "profit", header: "Profit", cell: (r) => <ProfitCell row={r} />, align: "right" },
      );
    }
    columns.push({
      key: "placed",
      header: "Placed",
      // A historical WhatsApp order has no known placement date: it is listed by the day it was completed, and says so.
      cell: (r) =>
        r.origin === "historical_import" ? (
          <span className="flex flex-col gap-1" data-testid="historical-date">
            <span>Completed {formatDay(r.order_date ?? r.created_at)}</span>
            <Badge tone="neutral">Historical WhatsApp order</Badge>
          </span>
        ) : (
          formatDay(r.created_at)
        ),
    });
    if (page.can_see_receipts) {
      const uploadKeys = new Map(page.rows.map((r) => [r.id, randomUUID()]));
      columns.push({
        key: "receipts",
        header: "Receipts",
        cell: (r, view) => (
          <ReceiptsCell orderId={r.id} orderRef={r.order_ref} receipts={r.receipts ?? []} canManage={page.can_manage_receipts} uploadKey={uploadKeys.get(r.id) ?? ""} view={view} />
        ),
      });
    }
  }

  return (
    <AdminShell
      active="orders"
      email={staff.email}
      can={can}
      title="Orders"
      description="Your latest orders. Search, sort or filter to find any other."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={
        <>
        {can("import.manage") ? <LinkButton href="/admin/import">Import historical orders</LinkButton> : null}
        {can("orders.create") ? <LinkButton href="/admin/orders/new" variant="red">New order</LinkButton> : null}
      </>
      }
    >
      <section id="orders-list" aria-label="Orders" className="glass glass-flat p-4 sm:p-6" data-testid="orders-section">
        <OrdersToolbar query={query} statuses={STATUSES} years={page?.years ?? []} effectiveYear={page?.filters.year ?? null} reportParams={reportParams} canSeeFinance={financeAllowed} />
        {listError ? (
          <div className="mt-4">
            <Notice tone="error">{listError}</Notice>
          </div>
        ) : page ? (
          <>
            <div className="mb-3 mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" data-testid="orders-summary-line">
              <p className="text-sm font-semibold text-white" data-testid="orders-summary" aria-live="polite">
                {plainLatest ? `Latest ${page.last} of ${page.total} orders` : summaryText(page)}
                {words.length > 0 ? <span className="font-normal text-text-secondary"> · {words.join(" · ")}</span> : null}
                {page.filters.range_overrides_period ? <span className="font-normal text-text-muted"> · dates are used instead of the month and year</span> : null}
              </p>
              {hasActiveFilters(query) ? (
                <Link
                  href={ordersHref(query, { q: "", status: "", year: null, month: null, from: null, to: null, page: 1 }, reportParams)}
                  className="text-xs font-semibold text-text-secondary underline-offset-4 hover:text-white hover:underline"
                  data-testid="orders-clear"
                >
                  Clear search and filters
                </Link>
              ) : null}
            </div>
            <DataTable
              rows={page.rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/admin/orders/${r.id}`}
              empty="No orders match these filters."
              columns={columns}
              // Up to seven columns need the width of a full desktop beside the sidebar; narrower screens get one card per order.
              cardsBelow="xl"
            />
            <OrdersPager query={query} page={page} reportParams={reportParams} />
          </>
        ) : null}
      </section>

      {reportError ? <Notice tone="error">{reportError} The order list above is not affected.</Notice> : null}
      {report ? (
        // The monthly report is not part of the list: it stays one click away, and opens by itself once a period was chosen in it.
        <details className="group" open={period.year !== null || period.month !== null} data-testid="financial-details">
          <summary className="btn-glass inline-flex h-10 cursor-pointer select-none list-none items-center gap-2 rounded-full px-4 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden" data-testid="financial-toggle">
            Monthly financial report
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </summary>
          <div className="mt-4">
            <FinancialPerformance report={report} hidden={ordersHiddenFields(query)} />
          </div>
        </details>
      ) : null}
    </AdminShell>
  );
}
