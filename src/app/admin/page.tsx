import Link from "next/link";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ProfitFigure, ProfitStateBadge } from "@/components/admin/finance";
import { DataTable, LinkButton, Money, Section, Stat, StatusBadge } from "@/components/admin/ui";
import { Notice } from "@/components/account/ui";
import { marginText, parseReportParams } from "@/lib/staff/finance";
import { formatDay, orderDateParts } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";
import { settle } from "@/lib/staff/settle";

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

/** A titled group of figures. The heading is real text, so a screen reader announces the group and the page reads as three groups, not a wall of cards. */
function Group({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          {title}
        </h2>
        {note ? <p className="text-xs text-text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const { staff, api, can } = await requireStaff("/admin");
  const params = await searchParams;
  // The year only affects the completed and financial figures. It defaults to the current calendar year (Qatar time) in the database, so
  // it rolls over by itself on 1 January and nothing here ever hard-codes a year.
  const { year } = parseReportParams(first(params.year) || undefined, undefined);
  const result = await settle(() => api.overview(year));
  const shell = {
    active: "overview" as const,
    email: staff.email,
    can,
    title: "Overview",
    description: "Where the business stands: current work, finished orders and the money they brought in.",
    previewLabel: process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null,
    actions: (
      <>
        {can("import.manage") ? <LinkButton href="/admin/import">Import historical orders</LinkButton> : null}
        {can("orders.create") ? <LinkButton href="/admin/orders/new" variant="red">New order</LinkButton> : null}
      </>
    ),
  };
  if (!result.ok) {
    return (
      <AdminShell {...shell}>
        <Notice tone="error">{result.error} The overview could not be loaded. Nothing was changed. Reload the page to try again.</Notice>
      </AdminShell>
    );
  }
  const o = result.value;
  const orders = can("orders.read");
  const fin = o.financial;
  const a = o.needs_attention;
  // Completed orders are counted by completion date in the Financial performance section (owner only). Everyone else is taken to the delivered orders.
  const completedHref = fin ? `/admin/orders?fy=${o.year}#financial-performance` : "/admin/orders?status=delivered#orders-list";
  const attention: { key: string; label: string; count: number; href?: string }[] = [
    { key: "confirm", label: "Awaiting confirmation", count: a.awaiting_confirmation, href: orders ? "/admin/orders?status=pending_confirmation" : undefined },
    { key: "deposit", label: "Awaiting deposit", count: a.awaiting_deposit, href: orders ? "/admin/orders?status=awaiting_deposit" : undefined },
    { key: "hold", label: "On hold", count: a.on_hold, href: orders ? "/admin/orders?status=on_hold" : undefined },
    ...(a.deposit_shortfalls !== undefined ? [{ key: "shortfall", label: "Deposit not fully received", count: a.deposit_shortfalls, href: orders ? "/admin/orders?status=awaiting_deposit" : undefined }] : []),
    ...(a.completed_with_balance !== undefined ? [{ key: "balance", label: "Completed with a balance still owed", count: a.completed_with_balance, href: orders ? completedHref : undefined }] : []),
    { key: "verify", label: "Completion date to verify", count: a.completion_to_verify, href: orders ? (fin ? "/admin/orders#financial-performance" : "/admin/orders") : undefined },
  ];
  const open = attention.filter((item) => item.count > 0);
  return (
    <AdminShell {...shell}>
      <form action="/admin" method="get" className="flex flex-wrap items-end gap-3" data-testid="overview-year">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted" htmlFor="ov-year">
          Year
          <select id="ov-year" name="year" defaultValue={String(o.year)} className="glass-input min-h-[2.75rem] px-3 py-2 text-sm normal-case tracking-normal text-white">
            {(o.years.includes(o.year) ? o.years : [o.year, ...o.years].sort((x, y) => y - x)).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center rounded-full px-5 py-2 text-sm font-semibold">
          Show
        </button>
        <p className="pb-2 text-xs text-text-muted">The year changes the completed and financial figures only. Active orders are always the work in progress today.</p>
      </form>

      <Group id="grp-operations" title="Operations">
        <div className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="overview-operations">
          <Stat label="Active orders" value={o.active_orders} hint="Current workload: not delivered and not cancelled" href={orders ? "/admin/orders" : undefined} />
          <Stat label={`Completed orders, ${o.year}`} value={o.completed_orders} hint="Counted by the date they were completed" href={orders ? completedHref : undefined} />
        </div>
      </Group>

      {fin ? (
        <Group id="grp-financial" title="Financial performance" note={`Orders completed in ${o.year}, counted by completion date`}>
          <div className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="overview-financial">
            <Stat label="Total net revenue" value={<Money minor={fin.net_revenue_minor} />} hint="After discounts and loyalty credit" tone="gold" />
            <Stat
              label="Total order profit"
              value={<ProfitFigure minor={fin.profit_minor} provisional={fin.profit_state === "provisional"} />}
              hint={fin.profit_minor === null ? "Not available until a cost is recorded" : `Margin ${marginText(fin.margin_bps)} · order profit, not company profit`}
            />
          </div>
          {fin.completed_orders > 0 && fin.profit_state !== "verified" ? (
            <p className="rounded-glass-sm border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="status" data-testid="overview-profit-warning">
              <ProfitStateBadge state={fin.profit_state} /> {fin.orders_costs_incomplete} completed {fin.orders_costs_incomplete === 1 ? "order has" : "orders have"} incomplete costs and {fin.orders_costs_missing} {fin.orders_costs_missing === 1 ? "has" : "have"} none recorded. Missing costs are never counted as zero.
            </p>
          ) : null}
          {orders ? (
            <Link href={`/admin/orders?fy=${o.year}#financial-performance`} className="text-sm font-semibold text-accent hover:underline" data-testid="overview-reports-link">
              Detailed monthly reports in Orders
            </Link>
          ) : null}
        </Group>
      ) : null}

      <Group id="grp-attention" title="Needs attention">
        {open.length === 0 ? (
          <p className="rounded-glass-sm border border-dashed border-border-strong px-4 py-3 text-sm text-text-muted" data-testid="overview-attention">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="overview-attention">
            {open.map((item) => (
              <li key={item.key}>
                {item.href ? (
                  <Link href={item.href} className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-sm text-warning hover:bg-warning/15">
                    <span className="font-semibold tabular-nums">{item.count}</span> {item.label}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-sm text-warning">
                    <span className="font-semibold tabular-nums">{item.count}</span> {item.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Section title="Recent orders" aside={orders ? <Link href="/admin/orders" className="text-sm font-semibold text-accent hover:underline">All orders</Link> : null}>
        <DataTable
          rows={o.recent_orders}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/orders/${r.id}`}
          empty="No orders yet."
          columns={[
            { key: "ref", header: "Order", cell: (r) => r.order_ref, primary: true },
            { key: "customer", header: "Customer", cell: (r) => r.customer_name },
            { key: "status", header: "Status", cell: (r) => <StatusBadge code={r.status} label={r.status_label} /> },
            { key: "total", header: "Original total", cell: (r) => <Money minor={r.total_minor} />, align: "right", hideOnCard: true },
            { key: "payable", header: "Net payable", cell: (r) => <Money minor={r.net_payable_minor} />, align: "right" },
            {
              key: "date",
              header: "Placed",
              cell: (r) => {
                const d = orderDateParts(r);
                return d.historical ? `Completed ${formatDay(d.iso)} · Historical WhatsApp order` : formatDay(d.iso);
              },
            },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
