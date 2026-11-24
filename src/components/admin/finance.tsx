/**
 * Server components for the finance screens: an order's private cost editor, the completion banner, the Financial Performance section of the
 * Orders page, the completed-orders drill-down and a customer's order history. They only DRAW what the owner-only database functions returned;
 * every amount arrives in integer minor units, and nothing here works out a profit, a margin or a share: the database is authoritative.
 *
 * Privacy: the cost, profit and margin components are only ever rendered by pages that first checked finance.read, and the data they draw is only
 * ever returned by functions that refuse everyone else. The customer-facing site imports none of this.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, DataTable, Empty, KeyValues, Money, Section, StatusBadge } from "@/components/admin/ui";
import { AddCostForm, CostsCompleteForm, EditCostForm, VerifyCompletionForm, VoidCostForm } from "@/components/admin/forms";
import { formatQar } from "@/lib/platform/money";
import { costCategoryLabel, costKindLabel, costStateLabel, describeRevision, marginText, MONTH_NAMES, monthName, profitStateLabel } from "@/lib/staff/finance";
import { formatDay, formatWhen, methodLabel, purposeLabel } from "@/lib/staff/format";
import type {
  CompletedOrderRow,
  CompletedOrdersPage,
  CostState,
  CustomerOrderDetail,
  FinancialBucket,
  FinancialReport,
  OrderCompletion,
  OrderCostsView,
  ProfitState,
} from "@/lib/staff/types";

// ---------------------------------------------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------------------------------------------

export function CostStateBadge({ state }: { state: CostState }) {
  return <Badge tone={state === "complete" ? "done" : "paused"}>{costStateLabel(state)}</Badge>;
}

export function ProfitStateBadge({ state }: { state: ProfitState }) {
  const tone = state === "verified" ? "done" : state === "none" ? "neutral" : "paused";
  const label = state === "verified" ? "Verified" : state === "provisional" ? "Provisional" : state === "unavailable" ? "Not available" : "No completed orders";
  return <Badge tone={tone}>{label}</Badge>;
}

/** A profit that may not exist: nothing recorded is a dash with the reason, never zero. A negative profit is shown as a loss, in full. */
export function ProfitFigure({ minor, provisional }: { minor: number | null; provisional?: boolean }) {
  if (minor === null) return <span className="text-text-muted">Not available</span>;
  return (
    <span className={minor < 0 ? "text-error" : undefined}>
      <Money minor={minor} />
      {provisional ? <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">provisional</span> : null}
    </span>
  );
}

function Figure({ label, children, hint, testId }: { label: string; children: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="glass glass-flat flex min-w-0 flex-col gap-1 p-4" data-testid={testId}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</span>
      <span className="min-w-0 break-words font-display text-lg font-semibold text-white sm:text-xl">{children}</span>
      {hint ? <span className="text-xs text-text-secondary">{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Order page: completion banner
// ---------------------------------------------------------------------------------------------------------------

const BASIS_TEXT: Record<string, string> = {
  transition: "recorded automatically when the order reached Delivered / Collected",
  status_history: "taken from the order's own status history",
  owner_verified: "confirmed by the owner from their own records",
};

export function CompletionBanner({ completion, orderId }: { completion: OrderCompletion; orderId: string }) {
  if (completion.needs_verification) {
    return (
      <Section title="Completion date needs verification" id="completion">
        <div className="mb-3">
          <Badge tone="paused">Needs historical verification</Badge>
        </div>
        {completion.can_verify ? (
          <VerifyCompletionForm orderId={orderId} moves={completion.delivered_moves ?? []} />
        ) : (
          <p className="text-sm text-text-secondary" data-testid="completion-needs-verification">
            This order was delivered before completion dates were recorded and its history does not prove the exact moment. Until the owner confirms the date it is not counted in any month&apos;s reports.
          </p>
        )}
      </Section>
    );
  }
  if (!completion.completed_at) return null;
  return (
    <p className="rounded-glass-sm border border-border bg-white/[0.025] px-4 py-3 text-sm text-text-secondary" data-testid="completion-note">
      <span className="font-semibold text-white">Completed {formatWhen(completion.completed_at)}</span>
      {completion.basis ? ` (${BASIS_TEXT[completion.basis] ?? completion.basis})` : ""}. Reports count this order in the month it was completed, not the month it was placed.
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Order page: private costs
// ---------------------------------------------------------------------------------------------------------------

export function OrderCostsSection({ view, entryId }: { view: OrderCostsView; entryId: string }) {
  const s = view.summary;
  const activeEntries = view.entries.filter((e) => e.status === "active");
  const retired = view.entries.filter((e) => e.status === "voided");
  const complete = s.cost_state === "complete";
  const blocked = s.entries === 0 ? "Add at least one cost before declaring the costs complete." : s.estimated_entries > 0 ? "An estimated entry remains. Change it to the actual amount, or remove it, before declaring the costs complete." : null;
  return (
    <Section id="costs" title="Order costs (private)" aside={<CostStateBadge state={s.cost_state} />}>
      <p className="mb-4 text-xs text-text-muted">Only the owner sees this section. Customers, the website and other staff never receive a cost, a margin or a profit.</p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="order-cost-summary">
        <Figure label={view.revenue_recognized ? "Net revenue (recognized)" : "Net revenue (when completed)"} testId="cost-net-revenue" hint="Original total, less discount and loyalty credit">
          <Money minor={s.net_revenue_minor} />
        </Figure>
        <Figure label="Direct costs" testId="cost-recorded" hint={`${formatQar(s.actual_cost_minor)} actual${s.estimated_cost_minor > 0 ? ` + ${formatQar(s.estimated_cost_minor)} estimated` : ""}`}>
          {s.entries === 0 ? <span className="text-text-muted">None recorded</span> : <Money minor={s.recorded_cost_minor} />}
        </Figure>
        <Figure label="Order profit" testId="cost-profit" hint={s.profit_minor === null ? "No cost has been recorded, so a profit cannot be worked out" : s.profit_is_provisional ? "Provisional until the costs are complete" : "Costs complete"}>
          <ProfitFigure minor={s.profit_minor} provisional={s.profit_minor !== null && s.profit_is_provisional} />
        </Figure>
        <Figure label="Margin" testId="cost-margin" hint="Profit as a share of net revenue">
          {marginText(s.margin_bps)}
        </Figure>
      </div>
      {!view.revenue_recognized ? (
        <p className="mt-3 text-xs text-text-muted">
          This order is not completed yet, so no revenue is recognized for it. Costs recorded now are shown as spent or expected, and reports count the order in the month it is delivered or collected.
        </p>
      ) : null}

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Cost entries</h3>
        <DataTable
          rows={activeEntries}
          rowKey={(e) => e.id}
          empty="No cost has been recorded for this order. A missing cost is never counted as zero."
          columns={[
            { key: "description", header: "Description", cell: (e) => e.description, primary: true },
            { key: "category", header: "Category", cell: (e) => costCategoryLabel(e.category) },
            { key: "amount", header: "Amount", cell: (e) => <Money minor={e.amount_minor} />, align: "right" },
            { key: "kind", header: "Kind", cell: (e) => <Badge tone={e.cost_kind === "actual" ? "done" : "paused"}>{costKindLabel(e.cost_kind)}</Badge> },
            { key: "ref", header: "Supplier / reference", cell: (e) => e.supplier_ref ?? "—", hideOnCard: true },
            { key: "date", header: "Date", cell: (e) => formatDay(e.incurred_on) },
            { key: "notes", header: "Private note", cell: (e) => e.notes ?? "—", hideOnCard: true },
            {
              key: "actions",
              header: "",
              cell: (e, v) =>
                view.can_edit ? (
                  <div className="flex flex-col gap-2">
                    <EditCostForm orderId={view.order_id} entry={e} scope={v} />
                    <VoidCostForm orderId={view.order_id} entry={e} scope={v} />
                  </div>
                ) : null,
            },
          ]}
        />
        {retired.length > 0 ? (
          <details className="mt-3 text-sm text-text-secondary">
            <summary className="cursor-pointer text-xs font-semibold">{retired.length} removed {retired.length === 1 ? "entry" : "entries"} (kept in the history, not counted)</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {retired.map((e) => (
                <li key={e.id} className="text-xs text-text-muted line-through">
                  {e.description}: <Money minor={e.amount_minor} /> ({costCategoryLabel(e.category)})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {view.can_edit ? (
        <>
          <div className="mt-5 border-t border-border pt-5">
            <h3 className="mb-3 font-display text-base font-semibold text-white">Add a cost</h3>
            <p className="mb-3 text-xs text-text-muted">Costs can be added or corrected at any stage, including after delivery. Each change keeps the old value in the history.</p>
            <AddCostForm orderId={view.order_id} entryId={entryId} entries={view.entries.length} />
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <h3 className="mb-1 font-display text-base font-semibold text-white">Are the costs complete?</h3>
            <p className="mb-3 text-xs text-text-muted">
              {complete ? "The costs were declared complete. Any later change to an entry reopens them." : "Declare the costs complete once every direct cost of this order is entered as an actual amount. Until then its profit is provisional."}
            </p>
            <CostsCompleteForm orderId={view.order_id} complete={complete} blockedReason={blocked} />
          </div>
        </>
      ) : (
        <p className="mt-4 text-xs text-text-muted">Your role can read the costs but not change them.</p>
      )}

      <details className="mt-5 border-t border-border pt-4" data-testid="cost-history">
        <summary className="cursor-pointer text-sm font-semibold text-white">Cost history ({view.revisions.length})</summary>
        <p className="mt-2 text-xs text-text-muted">Every addition, correction and removal, with who made it and why. Entries here are never changed or deleted.</p>
        {view.revisions.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No change has been recorded yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {view.revisions.map((rev) => (
              <li key={rev.id} className="rounded-glass-sm border border-border bg-white/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                  <span>{rev.by ?? "System"}</span>
                  <span>{formatWhen(rev.at)}</span>
                </div>
                {describeRevision(rev).map((line) => (
                  <p key={line} className="mt-1 text-text-secondary">
                    {line}
                  </p>
                ))}
                {rev.reason ? <p className="mt-1 text-xs text-text-muted">Reason: {rev.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Orders page: Financial Performance
// ---------------------------------------------------------------------------------------------------------------

const periodTitle = (year: number, month: number | null): string => (month === null ? String(year) : `${monthName(month)} ${year}`);

/** The year and month pickers: a plain GET form, so a period is a link that can be shared and the page needs no script. */
export function PeriodSelector({ action, year, month, years, hidden }: { action: string; year: number; month: number | null; years: number[]; hidden?: Record<string, string> }) {
  const options = years.includes(year) ? years : [year, ...years].sort((a, b) => b - a);
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3" data-testid="period-selector">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted" htmlFor="fin-year">
        Year
        <select id="fin-year" name="fy" defaultValue={String(year)} className="glass-input min-h-[2.75rem] px-3 py-2 text-sm normal-case tracking-normal text-white">
          {options.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted" htmlFor="fin-month">
        Month
        <select id="fin-month" name="fm" defaultValue={month === null ? "" : String(month)} className="glass-input min-h-[2.75rem] px-3 py-2 text-sm normal-case tracking-normal text-white">
          <option value="">All months</option>
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center rounded-full px-5 py-2 text-sm font-semibold">
        Show
      </button>
    </form>
  );
}

const monthHref = (year: number, month: number | null, extra: string): string => `/admin/orders?fy=${year}${month === null ? "" : `&fm=${month}`}${extra}#completed-orders`;

export function FinancialPerformance({ report, hidden }: { report: FinancialReport; hidden?: Record<string, string> }) {
  const p = report.period;
  const keep = Object.entries(hidden ?? {})
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("");
  return (
    <Section
      id="financial-performance"
      title="Financial performance"
      aside={<span className="text-xs text-text-muted">Orders are counted in the month they were completed ({report.timezone === "Asia/Qatar" ? "Qatar time" : report.timezone}), not the month they were placed</span>}
    >
      <div className="mb-5">
        <PeriodSelector action="/admin/orders" year={report.year} month={report.month} years={report.years} hidden={hidden} />
      </div>
      <h3 className="mb-3 font-display text-base font-semibold text-white" data-testid="fin-period-title">
        {periodTitle(report.year, report.month)}
      </h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5" data-testid="fin-figures">
        <Figure label="Net revenue" testId="fin-net-revenue" hint="After discounts and loyalty credit">
          <Money minor={p.net_revenue_minor} />
        </Figure>
        <Figure label="Total direct cost" testId="fin-cost" hint={`${formatQar(p.actual_cost_minor)} actual${p.estimated_cost_minor > 0 ? ` + ${formatQar(p.estimated_cost_minor)} estimated` : ""}`}>
          <Money minor={p.recorded_cost_minor} />
        </Figure>
        <Figure label="Order profit" testId="fin-profit" hint={<ProfitStateBadge state={p.profit_state} />}>
          <ProfitFigure minor={p.profit_minor} />
        </Figure>
        <Figure label="Completed orders" testId="fin-count">
          {p.completed_orders}
        </Figure>
        <Figure label="Margin" testId="fin-margin" hint="Order profit ÷ net revenue">
          {marginText(p.margin_bps)}
        </Figure>
      </div>

      {p.completed_orders > 0 && p.profit_state !== "verified" ? (
        <div className="mt-4 rounded-glass-sm border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status" data-testid="fin-incomplete-warning">
          <p className="font-semibold">{profitStateLabel(p.profit_state)}.</p>
          <p className="mt-1">
            {p.orders_costs_complete} of {p.completed_orders} completed {p.completed_orders === 1 ? "order has" : "orders have"} complete costs; {p.orders_costs_incomplete} incomplete; {p.orders_costs_missing} with no cost recorded.
            {p.revenue_without_costs_minor > 0 ? ` ${formatQar(p.revenue_without_costs_minor)} of the net revenue has no cost recorded and is left out of the profit and the margin (a missing cost is never counted as zero).` : ""}
          </p>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3" data-testid="fin-cash">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Cash and Fawran received</dt>
          <dd className="text-white">
            <Money minor={p.cash_received_minor} />
          </dd>
          <dd className="text-xs text-text-muted">By payment date, net of reversals, across all orders. Not added to revenue.</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Still owed on these completed orders</dt>
          <dd className="text-white">
            <Money minor={p.outstanding_balance_minor} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Original value / discounts / credit</dt>
          <dd className="text-white">
            <Money minor={p.gross_minor} /> / <Money minor={p.discount_minor} /> / <Money minor={p.loyalty_credit_minor} />
          </dd>
        </div>
      </dl>

      {report.needs_verification.count > 0 ? (
        <div className="mt-4 rounded-glass-sm border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status" data-testid="fin-needs-verification">
          <p className="font-semibold">
            {report.needs_verification.count} delivered {report.needs_verification.count === 1 ? "order needs" : "orders need"} historical verification.
          </p>
          <p className="mt-1">
            Their exact completion date is not proven, so they are not counted in any month yet:{" "}
            {report.needs_verification.orders.map((o, i) => (
              <span key={o.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/admin/orders/${o.id}#completion`} className="underline">
                  {o.order_ref}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <h3 className="mb-2 font-display text-base font-semibold text-white">{report.year}, month by month</h3>
        <DataTable
          rows={report.months}
          rowKey={(m) => String(m.month)}
          empty="No data."
          columns={[
            {
              key: "month",
              header: "Month",
              cell: (m) => (
                <Link href={monthHref(report.year, m.month, keep)} className={report.month === m.month ? "text-accent underline" : "hover:text-accent"}>
                  {monthName(m.month ?? 1)}
                </Link>
              ),
              primary: true,
            },
            { key: "count", header: "Completed", cell: (m) => m.completed_orders, align: "right" },
            { key: "revenue", header: "Net revenue", cell: (m) => <Money minor={m.net_revenue_minor} />, align: "right" },
            { key: "cost", header: "Direct cost", cell: (m) => (m.completed_orders === 0 ? "—" : <Money minor={m.recorded_cost_minor} />), align: "right" },
            { key: "profit", header: "Order profit", cell: (m) => (m.completed_orders === 0 ? "—" : <ProfitFigure minor={m.profit_minor} provisional={m.profit_state === "provisional"} />), align: "right" },
            { key: "margin", header: "Margin", cell: (m) => (m.completed_orders === 0 ? "—" : marginText(m.margin_bps)), align: "right" },
            { key: "costs", header: "Costs", cell: (m) => <CostMix bucket={m} /> },
          ]}
        />
        <p className="mt-3 text-xs text-text-muted" data-testid="fin-definitions">
          Net revenue is the original order total less the owner-approved discount and the redeemed loyalty credit, taken when the order is completed. Order profit is net revenue less the direct costs recorded for that order. It is not the company&apos;s net profit: rent, salaries, advertising and other overheads are not included. A deposit is part of the order&apos;s revenue, never revenue of its own.
        </p>
        {report.unrecognized_costs.open_orders_minor + report.unrecognized_costs.cancelled_orders_minor + report.unrecognized_costs.delivered_unverified_minor > 0 ? (
          <p className="mt-2 text-xs text-text-muted" data-testid="fin-unrecognized">
            Costs recorded on orders that are not completed (no revenue recognized yet): {formatQar(report.unrecognized_costs.open_orders_minor)} on open orders
            {report.unrecognized_costs.cancelled_orders_minor > 0 ? `, ${formatQar(report.unrecognized_costs.cancelled_orders_minor)} on cancelled orders` : ""}
            {report.unrecognized_costs.delivered_unverified_minor > 0 ? `, ${formatQar(report.unrecognized_costs.delivered_unverified_minor)} on delivered orders awaiting verification` : ""}.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function CostMix({ bucket }: { bucket: FinancialBucket }) {
  if (bucket.completed_orders === 0) return <span className="text-text-muted">—</span>;
  const incomplete = bucket.orders_costs_incomplete + bucket.orders_costs_missing;
  return incomplete === 0 ? (
    <Badge tone="done">Complete</Badge>
  ) : (
    <span className="text-xs text-warning">
      {bucket.orders_costs_incomplete > 0 ? `${bucket.orders_costs_incomplete} incomplete` : ""}
      {bucket.orders_costs_incomplete > 0 && bucket.orders_costs_missing > 0 ? ", " : ""}
      {bucket.orders_costs_missing > 0 ? `${bucket.orders_costs_missing} with none` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Orders page: the completed-orders drill-down (by completion date, not by the date placed)
// ---------------------------------------------------------------------------------------------------------------

export function CompletedOrders({ page, pageNumber, buildHref, selector }: { page: CompletedOrdersPage; pageNumber: number; buildHref: (page: number) => string; selector?: ReactNode }) {
  const finance = page.finance;
  const last = Math.max(1, Math.ceil(page.total / page.limit));
  return (
    <Section id="completed-orders" title={`Orders completed in ${periodTitle(page.year, page.month)}`} aside={<span className="text-xs text-text-muted">{page.total} completed · by completion date</span>}>
      {selector ? <div className="mb-4">{selector}</div> : null}
      <DataTable
        rows={page.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/orders/${r.id}`}
        empty="No order was completed in this period."
        columns={[
          { key: "ref", header: "Order", cell: (r: CompletedOrderRow) => r.order_ref, primary: true },
          { key: "customer", header: "Customer", cell: (r) => r.customer_name },
          { key: "completed", header: "Completed", cell: (r) => formatDay(r.completed_at) },
          { key: "placed", header: "Placed", cell: (r) => formatDay(r.created_at), hideOnCard: true },
          { key: "gross", header: "Original total", cell: (r) => <Money minor={r.gross_minor} />, align: "right", hideOnCard: true },
          { key: "revenue", header: "Net revenue", cell: (r) => <Money minor={r.net_revenue_minor} />, align: "right" },
          ...(finance
            ? [
                { key: "cost", header: "Direct cost", cell: (r: CompletedOrderRow) => (r.cost_state === "missing" ? <span className="text-text-muted">None recorded</span> : <Money minor={(r.actual_cost_minor ?? 0) + (r.estimated_cost_minor ?? 0)} />), align: "right" as const },
                { key: "profit", header: "Order profit", cell: (r: CompletedOrderRow) => <ProfitFigure minor={r.profit_minor ?? null} provisional={r.profit_minor !== null && r.profit_minor !== undefined && r.profit_is_provisional === true} />, align: "right" as const },
                { key: "state", header: "Costs", cell: (r: CompletedOrderRow) => (r.cost_state ? <CostStateBadge state={r.cost_state} /> : null) },
              ]
            : []),
          { key: "balance", header: "Still owed", cell: (r) => <Money minor={r.balance_due_minor} />, align: "right", hideOnCard: true },
        ]}
      />
      {last > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Completed orders pages">
          {pageNumber > 1 ? (
            <Link href={buildHref(pageNumber - 1)} className="font-semibold text-accent hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-text-muted">
            Page {pageNumber} of {last}
          </span>
          {pageNumber < last ? (
            <Link href={buildHref(pageNumber + 1)} className="font-semibold text-accent hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Customer page: order history with the final net payable up front
// ---------------------------------------------------------------------------------------------------------------

export function CustomerOrderHistory({ orders, total, canSeePayments }: { orders: CustomerOrderDetail[]; total: number; canSeePayments: boolean }) {
  if (orders.length === 0) return <Empty>This customer has no orders yet.</Empty>;
  return (
    <ol className="flex flex-col gap-4" data-testid="customer-orders">
      {orders.map((o) => {
        const adjusted = o.discount_minor > 0 || o.loyalty_credit_minor > 0;
        return (
          <li key={o.id} className="rounded-glass-sm border border-border bg-white/[0.025] p-4" data-testid="customer-order">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/admin/orders/${o.id}`} className="font-display text-base font-semibold text-white hover:text-accent">
                  {o.order_ref}
                </Link>
                <p className="mt-0.5 text-xs text-text-muted">
                  {orderTypeText(o)} · placed {formatDay(o.created_at)}
                  {o.completed_at ? ` · completed ${formatDay(o.completed_at)}` : o.needs_completion_verification ? " · completion date to be verified" : ""}
                </p>
              </div>
              <StatusBadge code={o.status} label={o.status_label} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <Cell label="Original total">
                <Money minor={o.gross_minor} />
              </Cell>
              <Cell label="Discount">{o.discount_minor > 0 ? <Money minor={o.discount_minor} /> : "—"}</Cell>
              <Cell label="Loyalty credit">{o.loyalty_credit_minor > 0 ? <Money minor={o.loyalty_credit_minor} /> : "—"}</Cell>
              <Cell label="Final net payable" strong testId="net-payable">
                <Money minor={o.net_payable_minor} />
              </Cell>
              <Cell label="Paid so far">{canSeePayments ? <Money minor={o.amount_paid_minor} /> : "—"}</Cell>
              <Cell label="Outstanding">{canSeePayments ? <Money minor={o.balance_due_minor} /> : "—"}</Cell>
            </dl>
            <p className="mt-2 text-xs text-text-muted">
              {adjusted ? "The final net payable is what the customer owes after the discount and loyalty credit. " : ""}It is an amount payable, not money received: only recorded payments count as paid.
            </p>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent">Order details</summary>
              <div className="mt-3 flex flex-col gap-4">
                <DataTable
                  rows={o.items}
                  rowKey={(i) => String(i.position)}
                  empty="No items."
                  columns={[
                    { key: "item", header: "Item", cell: (i) => i.description, primary: true },
                    { key: "kind", header: "Type", cell: (i) => i.kind.replace(/_/g, " "), hideOnCard: true },
                    { key: "qty", header: "Qty", cell: (i) => i.quantity, align: "right" },
                    { key: "gross", header: "Line price", cell: (i) => <Money minor={i.line_total_minor} />, align: "right" },
                    ...(adjusted
                      ? [
                          { key: "disc", header: "Discount", cell: (i: CustomerOrderDetail["items"][number]) => (i.discount_share_minor > 0 ? <Money minor={i.discount_share_minor} /> : "—"), align: "right" as const },
                          { key: "credit", header: "Loyalty credit", cell: (i: CustomerOrderDetail["items"][number]) => (i.credit_share_minor > 0 ? <Money minor={i.credit_share_minor} /> : "—"), align: "right" as const },
                          { key: "net", header: "Net", cell: (i: CustomerOrderDetail["items"][number]) => <Money minor={i.net_line_minor} />, align: "right" as const },
                        ]
                      : []),
                  ]}
                />
                {adjusted ? <p className="text-xs text-text-muted">The discount and credit apply to the whole order. They are spread across the lines only for display, so the line nets add up exactly to the final net payable. The original prices are never changed.</p> : null}

                {canSeePayments && o.payments ? (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Payments</h4>
                    {o.payments.length === 0 ? (
                      <p className="text-sm text-text-muted">No payment recorded.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {o.payments.map((p, index) => (
                          <li key={`${p.receipt_number ?? "x"}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-text-secondary">
                            <span>
                              {p.entry_type === "payment" ? purposeLabel(p.purpose) : "Reversal"} · {methodLabel(p.method)} · {formatWhen(p.received_at)}
                              {p.receipt_number ? <span className="ml-2 font-mono text-xs text-text-muted">{p.receipt_number}</span> : null}
                              {p.reversed ? <span className="ml-2 text-xs text-error">reversed</span> : null}
                            </span>
                            <Money minor={p.amount_minor} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                {o.history.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Status history</h4>
                    <ol className="flex flex-col gap-1 text-sm text-text-secondary">
                      {o.history.map((h, index) => (
                        <li key={`${h.at}-${index}`} className="flex flex-wrap justify-between gap-2">
                          <span>{h.to_status.replace(/_/g, " ")}</span>
                          <span className="text-xs text-text-muted">{formatWhen(h.at)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {o.tracking.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Tracking and fulfillment</h4>
                    <ol className="flex flex-col gap-1.5 text-sm text-text-secondary">
                      {o.tracking.map((t, index) => (
                        <li key={`${t.published_at}-${index}`} className={t.retracted ? "text-text-muted line-through" : undefined}>
                          <span className="text-white">{t.title}</span>
                          {t.location ? ` · ${t.location}` : ""} <span className="text-xs text-text-muted">{formatWhen(t.occurred_at ?? t.published_at)}</span>
                          {t.message ? <span className="block text-xs">{t.message}</span> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <KeyValues items={[{ label: "Delivery", value: o.delivery_method ?? "Not decided" }, { label: "Deposit required", value: <Money minor={o.deposit_required_minor} /> }]} />
              </div>
            </details>
          </li>
        );
      })}
      {total > orders.length ? <li className="text-xs text-text-muted">Showing the {orders.length} most recent of {total} orders.</li> : null}
    </ol>
  );
}

function orderTypeText(o: CustomerOrderDetail): string {
  if ((o.workflow_version ?? 1) < 2) return "Earlier workflow";
  return o.fulfillment_type === "custom_pc_build" ? "Custom PC build" : o.fulfillment_type === "parts_only" ? "Parts only" : "Order type not chosen";
}

function Cell({ label, children, strong, testId }: { label: string; children: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</dt>
      <dd className={strong ? "font-display text-lg font-semibold text-white" : "text-sm text-text-secondary"}>{children}</dd>
    </div>
  );
}
