import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, Section } from "@/components/admin/ui";
import { formatWhen } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

/** How each ledger entry type reads to staff. A redemption is an order credit (not a payment); a restoration gives the points of a cancelled order back. */
const ENTRY_LABEL: Record<string, string> = {
  award: "award",
  reversal: "reversal",
  adjustment: "adjustment",
  redemption: "redeemed on an order",
  redemption_restore: "returned (order cancelled)",
};

export default async function LoyaltyPage() {
  const { staff, api, can } = await requireStaff("/admin/loyalty");
  if (!can("loyalty.read")) return <AdminMissing active="loyalty" email={staff.email} can={can} />;
  const data = await api.loyalty(null, 100);
  return (
    <AdminShell
      active="loyalty"
      email={staff.email}
      can={can}
      title="Loyalty"
      description="Balances and history. Points are earned on delivered, fully paid orders. Redemption is not available yet."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section title="Balances">
        <DataTable
          rows={data.balances}
          rowKey={(b) => b.customer_id}
          rowHref={(b) => `/admin/customers/${b.customer_id}`}
          empty="No points have been earned yet."
          columns={[
            { key: "name", header: "Customer", cell: (b) => b.full_name, primary: true },
            { key: "code", header: "Code", cell: (b) => <span className="font-mono text-xs">{b.customer_code}</span> },
            { key: "points", header: "Points", cell: (b) => <span className="tabular-nums">{b.balance_points}</span>, align: "right" },
            { key: "entries", header: "Entries", cell: (b) => b.entries, align: "right" },
          ]}
        />
      </Section>
      <Section title="Recent history">
        <DataTable
          rows={data.entries}
          rowKey={(e) => e.id}
          empty="No loyalty activity yet."
          columns={[
            { key: "when", header: "When", cell: (e) => formatWhen(e.created_at), primary: true },
            { key: "customer", header: "Customer", cell: (e) => e.full_name },
            { key: "type", header: "Type", cell: (e) => ENTRY_LABEL[e.entry_type] ?? e.entry_type.replace(/_/g, " ") },
            { key: "points", header: "Points", cell: (e) => <span className="tabular-nums">{e.points > 0 ? `+${e.points}` : e.points}</span>, align: "right" },
            { key: "order", header: "Order", cell: (e) => e.order_ref ?? "—" },
            { key: "note", header: "Note", cell: (e) => e.description, hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
