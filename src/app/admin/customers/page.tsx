import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, LinkButton, SearchBar, Section } from "@/components/admin/ui";
import { formatDay, sourceLabel } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { staff, api, can } = await requireStaff("/admin/customers");
  if (!can("customers.read")) return <AdminMissing active="customers" email={staff.email} can={can} />;
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").slice(0, 80);
  const rows = await api.searchCustomers(q, 50);
  return (
    <AdminShell
      active="customers"
      email={staff.email}
      can={can}
      title="Customers"
      description="Search by name, code, phone or email."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={can("customers.manage") ? <LinkButton href="/admin/customers/new" variant="red">New customer</LinkButton> : undefined}
    >
      <Section title={q ? `Results for “${q}”` : "All customers"} aside={<span className="text-xs text-text-muted">{rows.length} shown</span>}>
        <div className="mb-4">
          <SearchBar action="/admin/customers" value={q} placeholder="Search customers" />
        </div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/customers/${r.id}`}
          empty={q ? "No customer matches that search." : "No customers yet."}
          columns={[
            { key: "name", header: "Customer", cell: (r) => r.full_name, primary: true },
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.customer_code}</span> },
            { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—" },
            { key: "source", header: "Source", cell: (r) => sourceLabel(r.source) },
            { key: "orders", header: "Orders", cell: (r) => r.order_count, align: "right" },
            { key: "account", header: "Website account", cell: (r) => (r.linked_accounts > 0 ? "Linked" : "Not linked") },
            { key: "since", header: "Since", cell: (r) => formatDay(r.created_at), hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
