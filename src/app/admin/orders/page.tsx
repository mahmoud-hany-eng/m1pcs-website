import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, LinkButton, Money, Section, StatusBadge } from "@/components/admin/ui";
import { FinancialPerformance } from "@/components/admin/finance";
import { OrdersFilterPanel, OrdersPagination } from "@/components/admin/orders-controls";
import { Notice } from "@/components/account/ui";
import { parseReportParams } from "@/lib/staff/finance";
import { formatDay } from "@/lib/staff/format";
import { ORDER_SORTS, hasActiveFilters, ordersHiddenFields, parseOrdersListQuery, periodWords, summaryText } from "@/lib/staff/orders-list";
import { settle } from "@/lib/staff/settle";
import { requireStaff } from "@/lib/staff/session";
import type { FinancialReport, OrdersPage } from "@/lib/staff/types";

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

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrdersSearch> }) {
  const { staff, api, can } = await requireStaff("/admin/orders");
  if (!can("orders.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  const params = await searchParams;
  // The operational list's own choices (search, status, the date an order was PLACED, sort, page size, page) come from the address bar and are
  // answered by the database: filtered, sorted, counted and cut to ONE page there, never loaded whole and sliced here.
  const { query, error: queryError } = parseOrdersListQuery(params, STATUSES.map(([code]) => code));
  // The reporting period (year and month, by COMPLETION date) is separate: filtering the list never changes it, and choosing it never filters the list.
  const period = parseReportParams(first(params.fy) || undefined, first(params.fm) || undefined);
  const financeAllowed = can("finance.read");
  // Each answer is independent: a failure in the reporting part never hides the list, and the other way round.
  const [pageResult, reportResult] = await Promise.all([
    queryError
      ? null
      : settle<OrdersPage>(() =>
          api.listOrdersPage({ search: query.q || null, status: query.status || null, year: query.year, month: query.month, from: query.from, to: query.to, sort: query.sort, page: query.page, pageSize: query.size }),
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
  const sortLabel = ORDER_SORTS.find((s) => s.value === query.sort)?.label ?? "";
  const statusLabel = STATUSES.find(([code]) => code === query.status)?.[1] ?? "";
  const words = page
    ? [periodWords(page.filters), query.status ? `status: ${statusLabel}` : null, query.q ? `matching “${query.q}”` : null].filter((w): w is string => Boolean(w))
    : [];
  return (
    <AdminShell
      active="orders"
      email={staff.email}
      can={can}
      title="Orders"
      description="Every order, with what has been paid and what is still due."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={can("orders.create") ? <LinkButton href="/admin/orders/new" variant="red">New order</LinkButton> : undefined}
    >
      {reportError ? <Notice tone="error">{reportError} The order list below is not affected.</Notice> : null}
      {report ? <FinancialPerformance report={report} hidden={ordersHiddenFields(query)} /> : null}

      <Section id="orders-list" title="Orders">
        <OrdersFilterPanel query={query} statuses={STATUSES} years={page?.years ?? []} effectiveYear={page?.filters.year ?? null} reportParams={reportParams} />
        {listError ? (
          <Notice tone="error">{listError}</Notice>
        ) : page ? (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" data-testid="orders-summary-line">
              <p className="text-sm font-semibold text-white" data-testid="orders-summary" aria-live="polite">
                {summaryText(page)}
                {words.length > 0 ? <span className="font-normal text-text-secondary"> · {words.join(" · ")}</span> : hasActiveFilters(query) ? null : <span className="font-normal text-text-secondary"> · newest first</span>}
              </p>
              <p className="text-xs text-text-muted" data-testid="orders-sort-note">
                Sorted: {sortLabel}
                {query.sort === "price_asc" || query.sort === "price_desc" ? " (what the customer has to pay)" : ""}
                {page.filters.range_overrides_period ? " · custom dates are used instead of the month and year" : ""}
              </p>
            </div>
            <DataTable
              rows={page.rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/admin/orders/${r.id}`}
              empty="No orders match these filters."
              columns={[
                { key: "ref", header: "Order", cell: (r) => <span className="whitespace-nowrap">{r.order_ref}</span>, primary: true },
                { key: "customer", header: "Customer", cell: (r) => r.customer_name },
                { key: "status", header: "Status", cell: (r) => <StatusBadge code={r.status} label={r.status_label} /> },
                {
                  key: "type",
                  header: "Type",
                  cell: (r) => ((r.workflow_version ?? 1) >= 2 ? (r.fulfillment_type === "custom_pc_build" ? "Custom PC build" : r.fulfillment_type === "parts_only" ? "Parts only" : "Not chosen") : "Earlier workflow"),
                  hideOnCard: true,
                },
                {
                  // What the customer has to PAY (order total less the discount and the redeemed loyalty credit): the amount the price sort uses.
                  key: "total",
                  header: "Order price",
                  cell: (r) => (
                    <span>
                      <Money minor={r.net_payable_minor ?? r.total_minor} />
                      {(r.discount_minor ?? 0) + (r.loyalty_credit_minor ?? 0) > 0 ? (
                        <span className="block text-xs text-text-muted">
                          was <Money minor={r.total_minor} />
                        </span>
                      ) : null}
                    </span>
                  ),
                  align: "right",
                },
                { key: "paid", header: "Paid", cell: (r) => <Money minor={r.amount_paid_minor} />, align: "right" },
                { key: "balance", header: "Balance", cell: (r) => <Money minor={r.balance_due_minor} />, align: "right" },
                { key: "date", header: "Placed", cell: (r) => formatDay(r.created_at) },
              ]}
              // Eight columns need the width of a full desktop beside the sidebar; narrower screens get one card per order (with the placed date).
              cardsBelow="xl"
            />
            <OrdersPagination query={query} page={page} reportParams={reportParams} />
          </>
        ) : null}
      </Section>
    </AdminShell>
  );
}
