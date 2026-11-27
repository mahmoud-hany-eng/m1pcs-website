import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { UploadImportForm } from "@/components/admin/historical-forms";
import { Badge, DataTable, Money, Section } from "@/components/admin/ui";
import { Notice } from "@/components/account/ui";
import { formatWhen } from "@/lib/staff/format";
import { requireStaff } from "@/lib/staff/session";
import { settle } from "@/lib/staff/settle";
import type { ImportBatchListRow } from "@/lib/staff/historical/types";

export const metadata = { title: "Import historical orders" };

const STATUS: Record<ImportBatchListRow["status"], { label: string; tone: "progress" | "done" | "neutral" }> = {
  staged: { label: "Waiting for your review", tone: "progress" },
  committed: { label: "Imported", tone: "done" },
  discarded: { label: "Discarded", tone: "neutral" },
};

export default async function ImportPage() {
  const { staff, api, can } = await requireStaff("/admin/import");
  // Owner only: anyone else gets the same "not available" as for a page that does not exist.
  if (!can("import.manage")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  const batches = await settle(() => api.histListBatches());
  return (
    <AdminShell
      active="import"
      email={staff.email}
      can={can}
      title="Import historical orders"
      description="Bring in the purchases that were agreed on WhatsApp before the website existed. You review everything first; nothing is saved until you confirm."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section title="How it works">
        <ol className="grid gap-3 text-sm text-text-secondary sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["1. Upload", "Choose the CSV. It is only read and checked."],
            ["2. Review", "See the customers, purchases, left-out rows and totals."],
            ["3. Decide", "Fix a row, skip it, merge two spellings of one customer, or keep two people apart."],
            ["4. Confirm", "Say the date is the completion date and the orders were paid, then type the confirmation."],
            ["5. Report", "Orders appear under the month they were completed, with their loyalty points, once."],
          ].map(([title, text]) => (
            <li key={title} className="rounded-glass-sm border border-border p-3">
              <p className="font-semibold text-white">{title}</p>
              <p className="mt-1">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-text-secondary">
          No customer is emailed or messaged, and no sign-in account is created. Customers claim their history later, with a one-time code you give them yourself. Instagram advertising rows and invalid rows are never orders.
        </p>
      </Section>
      <Section title="Upload a file">
        <UploadImportForm />
      </Section>
      <Section title="Earlier imports">
        {!batches.ok ? (
          <Notice tone="error">{batches.error} The list could not be loaded. Nothing was changed.</Notice>
        ) : (
          <DataTable
            rows={batches.value}
            rowKey={(b) => b.id}
            empty="Nothing has been uploaded yet."
            columns={[
              {
                key: "when",
                header: "Prepared",
                primary: true,
                cell: (b) => (
                  <Link href={`/admin/import/${b.id}`} className="text-accent hover:underline">
                    {formatWhen(b.created_at)}
                  </Link>
                ),
              },
              { key: "status", header: "Status", cell: (b) => <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge> },
              { key: "orders", header: "Orders", align: "right", cell: (b) => b.orders },
              { key: "revenue", header: "Revenue", align: "right", cell: (b) => <Money minor={b.revenue_minor} /> },
              { key: "points", header: "Points", align: "right", cell: (b) => b.points.toLocaleString("en-US") },
              { key: "blocking", header: "Waiting", align: "right", cell: (b) => (b.status === "staged" ? b.blocking : "—") },
            ]}
          />
        )}
      </Section>
    </AdminShell>
  );
}
