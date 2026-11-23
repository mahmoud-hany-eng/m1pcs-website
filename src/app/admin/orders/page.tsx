import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, LinkButton, Money, SearchBar, Section, StatusBadge } from "@/components/admin/ui";
import { formatDay } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

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

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; status?: string | string[] }> }) {
  const { staff, api, can } = await requireStaff("/admin/orders");
  if (!can("orders.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
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
