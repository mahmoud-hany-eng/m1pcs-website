import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataTable, Section } from "@/components/admin/ui";
import { formatWhen } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";

export default async function AuditPage() {
  const { staff, api, can } = await requireStaff("/admin/audit");
  if (!can("audit.read")) notFound();
  const rows = await api.audit(200);
  return (
    <AdminShell
      active="audit"
      email={staff.email}
      can={can}
      title="Audit log"
      description="Who did what, and when. The log can be read here and cannot be changed."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section title="Recent activity" aside={<span className="text-xs text-text-muted">{rows.length} entries</span>}>
        <DataTable
          rows={rows}
          rowKey={(r) => String(r.id)}
          empty="Nothing has been recorded yet."
          columns={[
            { key: "when", header: "When", cell: (r) => formatWhen(r.at), primary: true },
            { key: "action", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
            { key: "entity", header: "Record", cell: (r) => r.entity },
            { key: "actor", header: "By", cell: (r) => r.actor ?? "system" },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
