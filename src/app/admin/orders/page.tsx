import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, LinkButton, Money, SearchBar, Section, StatusBadge } from "@/components/admin/ui";
import { formatDay } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

const STATUSES: [string, string][] = [
  ["", "All statuses"],
  ["pending_confirmation", "Order received"],
  ["awaiting_deposit", "Awaiting deposit"],
  ["deposit_received", "Deposit received"],
  ["sourcing", "Sourcing"],
  ["in_transit", "In transit"],
  ["building", "Building"],
  ["quality_check", "Final checks"],
  ["ready_for_delivery", "Ready for delivery"],
  ["delivered", "Delivered"],
  ["on_hold", "On hold"],
  ["cancelled", "Cancelled"],
];
const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; status?: string | string[] }> }) {
  const { staff, api, can } = await requireStaff("/admin/orders");
  if (!can("orders.read")) notFound();
  const params = await searchParams;
  const q = first(params.q).slice(0, 80);
  const requested = first(params.status);
  const status = STATUSES.some(([code]) => code === requested) ? requested : "";
  const rows = await api.listOrders({ status: status || null, search: q || null, limit: 100 });
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
      <Section title="Orders" aside={<span className="text-xs text-text-muted">{rows.length} shown</span>}>
        <div className="mb-4">
          <SearchBar
            action="/admin/orders"
            value={q}
            placeholder="Search by order number or customer"
            extra={
              <select name="status" defaultValue={status} aria-label="Status" className="glass-input min-h-[2.75rem] px-3 py-2 text-sm">
                {STATUSES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
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
            { key: "total", header: "Total", cell: (r) => <Money minor={r.total_minor} />, align: "right" },
            { key: "paid", header: "Paid", cell: (r) => <Money minor={r.amount_paid_minor} />, align: "right" },
            { key: "balance", header: "Balance", cell: (r) => <Money minor={r.balance_due_minor} />, align: "right" },
            { key: "date", header: "Placed", cell: (r) => formatDay(r.created_at), hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
