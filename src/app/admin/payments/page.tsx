import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge, DataTable, Money, Section } from "@/components/admin/ui";
import { entryLabel, formatWhen, methodLabel, purposeLabel } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

export default async function PaymentsPage() {
  const { staff, api, can } = await requireStaff("/admin/payments");
  if (!can("payments.read")) notFound();
  const rows = await api.listPayments(200, 0);
  return (
    <AdminShell
      active="payments"
      email={staff.email}
      can={can}
      title="Payments"
      description="Every payment and reversal, newest first. Entries are never edited or deleted: a mistake is corrected by a reversal."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section title="Transaction history" aside={<span className="text-xs text-text-muted">{rows.length} entries</span>}>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/orders/${r.order_id}`}
          empty="No payment has been recorded yet."
          columns={[
            { key: "receipt", header: "Receipt", cell: (r) => <span className="font-mono text-xs">{r.receipt_number ?? "—"}</span>, primary: true },
            { key: "order", header: "Order", cell: (r) => r.order_ref },
            { key: "customer", header: "Customer", cell: (r) => r.customer_name },
            { key: "type", header: "Type", cell: (r) => (r.entry_type === "payment" ? purposeLabel(r.purpose) : entryLabel(r.entry_type)) },
            { key: "amount", header: "Amount", cell: (r) => <Money minor={r.amount_minor} />, align: "right" },
            { key: "method", header: "Method", cell: (r) => methodLabel(r.method) },
            { key: "when", header: "Received", cell: (r) => formatWhen(r.received_at) },
            { key: "state", header: "State", cell: (r) => (r.reversed ? <Badge tone="cancelled">Reversed</Badge> : r.entry_type === "reversal" ? <Badge tone="paused">Reversal</Badge> : <Badge tone="done">Recorded</Badge>), hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
