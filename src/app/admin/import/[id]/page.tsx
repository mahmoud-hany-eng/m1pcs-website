import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import {
  AttachmentsSection,
  ConfirmSection,
  CustomersSection,
  ExclusionsSection,
  FlagsSection,
  importDateLine,
  MonthPreview,
  NotesSection,
  PurchasesSection,
  ReportSection,
  TotalsTiles,
} from "@/components/admin/historical-review";
import { Badge, LinkButton, Section } from "@/components/admin/ui";
import { formatWhen } from "@/lib/staff/format";
import { StaffOperationError } from "@/lib/staff/gateway";
import { isUuid } from "@/lib/staff/validation";
import { requireStaff } from "@/lib/staff/session";
import type { ImportBatch } from "@/lib/staff/historical/types";

export const metadata = { title: "Review an import" };

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff, api, can } = await requireStaff(`/admin/import/${isUuid(id) ? id : ""}`);
  if (!isUuid(id) || !can("import.manage")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  let batch: ImportBatch;
  try {
    // Reading a staged import brings it up to date first, so what is shown is exactly what a commit would do now.
    batch = await api.histGetBatch(id);
  } catch (error) {
    if (error instanceof StaffOperationError) return <AdminMissing active="import" email={staff.email} can={can} message="That import was not found." />;
    throw error;
  }
  const status = batch.batch.status;
  const staged = status === "staged";
  const tone = status === "committed" ? "done" : status === "discarded" ? "neutral" : "progress";
  const label = status === "committed" ? "Imported" : status === "discarded" ? "Discarded" : "Waiting for your review";
  return (
    <AdminShell
      active="import"
      email={staff.email}
      can={can}
      title="Review an import"
      description={importDateLine(batch)}
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={<LinkButton href="/admin/import">All imports</LinkButton>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone}>{label}</Badge>
        {staged ? <span className="text-sm text-text-secondary">Nothing has been imported yet. Nothing changes until you confirm at the bottom.</span> : null}
      </div>
      {status === "discarded" ? (
        <Section title="Discarded">
          <p className="text-sm text-text-secondary">This import was discarded on {formatWhen(batch.batch.discarded_at)}. Nothing from it was imported, so no order, customer or loyalty balance changed.</p>
        </Section>
      ) : (
        <>
          {status === "committed" && batch.result ? <ReportSection batch={batch} report={batch.result} /> : null}
          {staged ? (
            <>
              <NotesSection batch={batch} />
              <TotalsTiles batch={batch} />
              <FlagsSection batch={batch} editable />
              <MonthPreview rows={batch.rows} />
              <CustomersSection batch={batch} editable />
              <PurchasesSection batch={batch} editable />
              <ExclusionsSection batch={batch} />
              <AttachmentsSection batch={batch} editable />
              <ConfirmSection batch={batch} />
            </>
          ) : (
            <>
              <MonthPreview rows={batch.rows} />
              <ExclusionsSection batch={batch} />
              <AttachmentsSection batch={batch} editable />
            </>
          )}
        </>
      )}
    </AdminShell>
  );
}
