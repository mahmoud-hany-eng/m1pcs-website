import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, LinkButton, Money, Section, Stat, StatusBadge } from "@/components/admin/ui";
import { formatDay } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

export default async function AdminOverview() {
  const { staff, api, can } = await requireStaff("/admin");
  const summary = await api.dashboard();
  const underAssembly = summary.under_assembly;
  return (
    <AdminShell
      active="overview"
      email={staff.email}
      can={can}
      title="Overview"
      description="Where every order stands today."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={can("orders.create") ? <LinkButton href="/admin/orders/new" variant="red">New order</LinkButton> : undefined}
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5" data-testid="overview-stats">
        <Stat label="Total orders" value={summary.total_orders} href={can("orders.read") ? "/admin/orders" : undefined} />
        <Stat label="Awaiting deposit" value={summary.awaiting_deposit} tone="gold" href={can("orders.read") ? "/admin/orders?status=awaiting_deposit" : undefined} />
        <Stat label="Under assembly" value={underAssembly} hint="Sourcing, in transit, building, final checks" href={can("orders.read") ? "/admin/orders?status=building" : undefined} />
        <Stat label="Ready for delivery" value={summary.ready_for_delivery} href={can("orders.read") ? "/admin/orders?status=ready_for_delivery" : undefined} />
        {summary.outstanding_balance_minor !== undefined ? (
          <Stat label="Outstanding balances" value={<Money minor={summary.outstanding_balance_minor} />} tone="red" hint={`${summary.orders_with_balance ?? 0} orders with a balance`} />
        ) : (
          <Stat label="Customers" value={summary.customers} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Stat label="Awaiting confirmation" value={summary.awaiting_confirmation} />
        <Stat label="On hold" value={summary.on_hold} />
        <Stat label="Delivered" value={summary.delivered} />
        <Stat label="Customers" value={summary.customers} href={can("customers.read") ? "/admin/customers" : undefined} />
      </div>

      {summary.deposit_shortfalls && summary.deposit_shortfalls.length > 0 ? (
        <Section title="Deposits still to collect" aside={<span className="text-xs text-text-muted">Orders that cannot move on until the deposit is confirmed</span>}>
          <DataTable
            rows={summary.deposit_shortfalls}
            rowKey={(r) => r.id}
            rowHref={(r) => `/admin/orders/${r.id}`}
            empty="Nothing to collect."
            columns={[
              { key: "ref", header: "Order", cell: (r) => r.order_ref, primary: true },
              { key: "customer", header: "Customer", cell: (r) => r.customer_name },
              { key: "required", header: "Deposit required", cell: (r) => <Money minor={r.deposit_required_minor} />, align: "right" },
              { key: "paid", header: "Received", cell: (r) => <Money minor={r.amount_paid_minor} />, align: "right" },
            ]}
          />
        </Section>
      ) : null}

      <Section title="Latest orders" aside={can("orders.read") ? <Link href="/admin/orders" className="text-sm font-semibold text-accent hover:underline">All orders</Link> : null}>
        <DataTable
          rows={summary.recent_orders}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/orders/${r.id}`}
          empty="No orders yet."
          columns={[
            { key: "ref", header: "Order", cell: (r) => r.order_ref, primary: true },
            { key: "customer", header: "Customer", cell: (r) => r.customer_name },
            { key: "status", header: "Status", cell: (r) => <StatusBadge code={r.status} label={r.status_label} /> },
            { key: "total", header: "Total", cell: (r) => <Money minor={r.total_minor} />, align: "right" },
            { key: "date", header: "Placed", cell: (r) => formatDay(r.created_at) },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
