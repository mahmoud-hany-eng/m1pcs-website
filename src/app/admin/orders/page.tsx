import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, LinkButton, Money, SearchBar, Section, StatusBadge } from "@/components/admin/ui";
import { CompletedOrders, FinancialPerformance, PeriodSelector } from "@/components/admin/finance";
import { Notice } from "@/components/account/ui";
import { parseReportParams } from "@/lib/staff/finance";
import { formatDay } from "@/lib/staff/format";
import { settle } from "@/lib/staff/settle";
import { requireStaff } from "@/lib/staff/session";
import type { CompletedOrdersPage, FinancialReport } from "@/lib/staff/types";

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
const COMPLETED_PAGE_SIZE = 50;

type OrdersSearch = { q?: string | string[]; status?: string | string[]; fy?: string | string[]; fm?: string | string[]; fp?: string | string[] };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrdersSearch> }) {
  const { staff, api, can } = await requireStaff("/admin/orders");
  if (!can("orders.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  const params = await searchParams;
  const q = first(params.q).slice(0, 80);
  const requested = first(params.status);
  const status = STATUSES.some(([code]) => code === requested) ? requested : "";
  // The reporting period (year and month, by COMPLETION date) is independent of the operational list below: choosing a month never filters it.
  const period = parseReportParams(first(params.fy) || undefined, first(params.fm) || undefined);
  const pageNumber = /^[0-9]{1,4}$/.test(first(params.fp)) && Number(first(params.fp)) >= 1 ? Number(first(params.fp)) : 1;
  const financeAllowed = can("finance.read");
  // Each of these is answered by the database over ALL completed orders (not the first 100 of the list), and a failure in the reporting part
  // never hides the operational list.
  const [rows, reportResult, completedResult] = await Promise.all([
    api.listOrders({ status: status || null, search: q || null, limit: 100 }),
    financeAllowed ? settle<FinancialReport>(() => api.financialReport(period.year, period.month)) : null,
    settle<CompletedOrdersPage>(() => api.completedOrders(period.year, period.month, COMPLETED_PAGE_SIZE, (pageNumber - 1) * COMPLETED_PAGE_SIZE)),
  ]);
  const report = reportResult?.ok ? reportResult.value : null;
  const completed = completedResult.ok ? completedResult.value : null;
  const reportError = (reportResult && !reportResult.ok ? reportResult.error : null) ?? (!completedResult.ok ? completedResult.error : null);
  const keepFilters: Record<string, string> = {};
  if (q) keepFilters.q = q;
  if (status) keepFilters.status = status;
  const periodQuery = `fy=${(report ?? completed)?.year ?? ""}${period.month === null ? "" : `&fm=${period.month}`}`;
  const filterQuery = `${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}`;
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
      {report ? <FinancialPerformance report={report} hidden={keepFilters} /> : null}
      {completed ? (
        <CompletedOrders
          page={completed}
          pageNumber={pageNumber}
          buildHref={(n) => `/admin/orders?${periodQuery}${filterQuery}${n > 1 ? `&fp=${n}` : ""}#completed-orders`}
          selector={report ? undefined : <PeriodSelector action="/admin/orders" year={completed.year} month={completed.month} years={completed.years} hidden={keepFilters} />}
        />
      ) : null}

      <Section title="Orders" aside={<span className="text-xs text-text-muted">{rows.length} shown</span>}>
        <div className="mb-4">
          <SearchBar
            action="/admin/orders"
            value={q}
            placeholder="Search by order number or customer"
            extra={
              <>
              {period.year !== null ? <input type="hidden" name="fy" value={period.year} /> : null}
              {period.month !== null ? <input type="hidden" name="fm" value={period.month} /> : null}
              <select name="status" defaultValue={status} aria-label="Status" className="glass-input min-h-[2.75rem] px-3 py-2 text-sm">
                {STATUSES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              </>
            }
          />
        </div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/orders/${r.id}`}
          empty="No orders match."
          columns={[
            { key: "ref", header: "Order", cell: (r) => r.order_ref, primary: true },
            { key: "customer", header: "Customer", cell: (r) => r.customer_name },
            { key: "status", header: "Status", cell: (r) => <StatusBadge code={r.status} label={r.status_label} /> },
            {
              key: "type",
              header: "Type",
              cell: (r) => ((r.workflow_version ?? 1) >= 2 ? (r.fulfillment_type === "custom_pc_build" ? "Custom PC build" : r.fulfillment_type === "parts_only" ? "Parts only" : "Not chosen") : "Earlier workflow"),
              hideOnCard: true,
            },
            {
              key: "total",
              header: "Total",
              cell: (r) => (
                <span>
                  <Money minor={r.total_minor} />
                  {(r.discount_minor ?? 0) + (r.loyalty_credit_minor ?? 0) > 0 ? (
                    <span className="block text-xs text-text-muted">
                      pays <Money minor={r.net_payable_minor ?? r.total_minor} />
                    </span>
                  ) : null}
                </span>
              ),
              align: "right",
            },
            { key: "paid", header: "Paid", cell: (r) => <Money minor={r.amount_paid_minor} />, align: "right" },
            { key: "balance", header: "Balance", cell: (r) => <Money minor={r.balance_due_minor} />, align: "right" },
            { key: "date", header: "Placed", cell: (r) => formatDay(r.created_at), hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}

