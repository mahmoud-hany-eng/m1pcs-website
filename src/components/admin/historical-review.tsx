/**
 * The review screens of the Historical Orders Import, drawn on the server for the owner only. They DRAW what the owner-only database functions
 * returned: the totals, the flags, the points. Nothing here decides a duplicate, an identity or an amount; the database does, and recomputes it at the
 * moment of the commit.
 *
 * A customer never sees any of this: the pages that use it first require import.manage, which only the owner holds.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, DataTable, KeyValues, Money, Section, Stat } from "@/components/admin/ui";
import {
  SetOrderItemsForm,
  AddAttachmentForm,
  ClassifyAttachmentForm,
  CommitImportForm,
  CorrectRowForm,
  CustomerChoiceForm,
  DiscardImportForm,
  MergeGroupsForm,
  ResolveFlagForm,
  RestoreRowForm,
  SkipRowForm,
  StoreAttachmentForm,
  UnavailableAttachmentForm,
  UnmergeGroupForm,
} from "@/components/admin/historical-forms";
import { formatQar } from "@/lib/platform/money";
import { formatWhen } from "@/lib/staff/format";
import { formatFileSize } from "@/lib/staff/receipts";
import { attachmentHref } from "@/lib/staff/historical/attachments";
import type { Issue } from "@/lib/staff/historical/parse";
import type { HistoricalOrderInfo, ImportAttachment, ImportBatch, ImportFlag, ImportGroup, ImportReport, ImportRow } from "@/lib/staff/historical/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dash = <span className="text-text-muted">—</span>;

/** A completion date as written in the file's own terms: the calendar day, never a time of day (the export has none). */
const dayLabel = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : "—";
};

const isActivePurchase = (r: ImportRow): boolean => r.kind === "purchase" && r.decision === "import" && r.status !== "skipped";

function IssueList({ issues }: { issues: Issue[] }) {
  const shown = issues.filter((i) => i.severity !== "info" || i.code === "loss_recorded" || i.code === "attachment_expiring");
  if (shown.length === 0) return dash;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {shown.map((issue, index) => (
        <li key={`${issue.code}:${index}`} className={issue.severity === "error" ? "text-error" : issue.severity === "warning" ? "text-warning" : "text-text-muted"}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------------------------------------------
export function TotalsTiles({ batch }: { batch: ImportBatch }) {
  const t = batch.totals;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="import-totals">
      <Stat label="Orders to import" value={t.orders} hint={`${t.data_rows} rows in the file`} />
      <Stat label="Customers" value={t.customers} hint="Distinct people, matched by name and phone" />
      <Stat label="Revenue" value={<Money minor={t.revenue_minor} />} hint="Final amount the customer paid" />
      <Stat label="Direct costs" value={<Money minor={t.cost_minor} />} hint={t.orders_with_cost < t.orders ? `${t.orders - t.orders_with_cost} orders have no cost in the file` : "Private to you"} />
      <Stat label="Profit" value={<Money minor={t.profit_minor} />} hint={t.loss_orders > 0 ? `${t.loss_orders} order${t.loss_orders === 1 ? "" : "s"} recorded at a loss, kept as recorded` : "Revenue minus cost"} />
      <Stat label="Loyalty points" value={t.points.toLocaleString("en-US")} hint={`1 point per ${formatQar(batch.batch.qar_per_point_minor)}, rounded down per order`} tone="gold" />
      <Stat label="Not orders" value={t.ad_rows + t.invalid_summary_rows} hint={`${t.ad_rows} advertising rows (${formatQar(t.ad_minor)}), ${t.invalid_summary_rows} invalid summary row${t.invalid_summary_rows === 1 ? "" : "s"}`} />
      <Stat label="Needs your decision" value={batch.blocking} hint={batch.blocking === 0 ? "Nothing is waiting" : "Resolve these before importing"} tone={batch.blocking === 0 ? "default" : "red"} />
    </div>
  );
}

/** The month each order will be reported under: its completion month. A check on the date meaning before anything is saved. */
export function MonthPreview({ rows }: { rows: ImportRow[] }) {
  const months = new Map<string, { orders: number; revenue: number; cost: number; costed: number }>();
  for (const r of rows.filter(isActivePurchase)) {
    if (!r.happened_on) continue;
    const key = r.happened_on.slice(0, 7);
    const m = months.get(key) ?? { orders: 0, revenue: 0, cost: 0, costed: 0 };
    m.orders += 1;
    m.revenue += r.revenue_minor ?? 0;
    if (r.cost_minor !== null) {
      m.cost += r.cost_minor;
      m.costed += 1;
    }
    months.set(key, m);
  }
  const list = [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, v]) => ({ key, ...v }));
  return (
    <Section title="Reported under the month each order was completed" id="months">
      <p className="mb-3 text-sm text-text-secondary">
        Once you confirm that the file&apos;s date is the completion date, each order counts in the Orders and financial reports in the month below (Qatar time), not in the month you import it.
      </p>
      <DataTable
        rows={list}
        rowKey={(r) => r.key}
        empty="No orders to import."
        columns={[
          { key: "month", header: "Month", primary: true, cell: (r) => `${MONTHS[Number(r.key.slice(5, 7)) - 1]} ${r.key.slice(0, 4)}` },
          { key: "orders", header: "Orders", align: "right", cell: (r) => r.orders },
          { key: "revenue", header: "Revenue", align: "right", cell: (r) => <Money minor={r.revenue} /> },
          { key: "cost", header: "Direct cost", align: "right", cell: (r) => (r.costed === r.orders ? <Money minor={r.cost} /> : <span title="Some orders have no cost in the file">{formatQar(r.cost)}*</span>) },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What needs a decision
// ---------------------------------------------------------------------------------------------------------------
const rowLabel = (row: ImportRow | undefined): string => (row ? `Row ${row.row_number}${row.customer_name ? ` · ${row.customer_name}` : ""}` : "");

export function FlagsSection({ batch, editable }: { batch: ImportBatch; editable: boolean }) {
  const rows = new Map(batch.rows.map((r) => [r.id, r]));
  const groups = new Map(batch.groups.map((g) => [g.id, g]));
  const blocking = batch.flags.filter((f) => f.severity === "error" && !f.resolved);
  const settled = batch.flags.filter((f) => f.severity === "error" && f.resolved);
  const notes = batch.flags.filter((f) => f.severity !== "error");
  return (
    <Section
      title="Needs your decision"
      id="decisions"
      aside={<Badge tone={blocking.length === 0 ? "done" : "paused"}>{blocking.length === 0 ? "Nothing waiting" : `${blocking.length} waiting`}</Badge>}
    >
      {blocking.length === 0 ? <p className="text-sm text-text-secondary">Nothing is waiting for a decision.</p> : null}
      <ul className="flex flex-col gap-4">
        {blocking.map((flag) => (
          <li key={flag.flag_key} className="rounded-glass-sm border border-warning/40 bg-warning/5 p-4" data-testid={`flag-${flag.kind}`}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">{flagTitle(flag)}</p>
            <p className="text-sm text-white/90">{flag.message}</p>
            {flag.row_id ? <p className="mt-1 text-xs text-text-muted">{rowLabel(rows.get(flag.row_id))}</p> : null}
            {flag.group_id ? (
              <p className="mt-1 text-xs text-text-muted">
                {groupLabel(groups.get(flag.group_id))}
                {flag.other_group_id ? ` and ${groupLabel(groups.get(flag.other_group_id))}` : ""}
              </p>
            ) : null}
            {editable ? <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">{flagActions(batch, flag, rows, groups)}</div> : null}
          </li>
        ))}
      </ul>
      {settled.length > 0 || notes.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-text-secondary hover:text-white">Decided and informational items ({settled.length + notes.length})</summary>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-text-secondary">
            {[...settled, ...notes].map((flag) => (
              <li key={flag.flag_key} className="rounded-glass-sm border border-border px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">{flagTitle(flag)}</span>
                {flag.resolution ? <span className="ml-2 text-xs text-success">· {flag.resolution.replace(/_/g, " ")}</span> : null}
                <p>{flag.message}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

const groupLabel = (g: ImportGroup | undefined): string => (g ? `Customer ${g.group_no} (${g.display_name}${g.phone ? `, ${g.phone}` : ""})` : "");

function flagTitle(flag: ImportFlag): string {
  switch (flag.kind) {
    case "row_invalid":
      return "A row cannot be imported as it is";
    case "possible_duplicate":
      return "Possible duplicate of an existing order";
    case "shared_phone":
      return "One phone number, different names";
    case "same_name_other_phone":
      return "One name, different phone numbers";
    case "existing_customer":
      return "A customer with this phone number already exists";
    case "previous_import":
      return "Customer from an earlier import";
    case "already_imported":
      return "Already imported";
    case "missing_phone":
      return "No phone number";
    default:
      return "Note";
  }
}

function flagActions(batch: ImportBatch, flag: ImportFlag, rows: Map<string, ImportRow>, groups: Map<string, ImportGroup>): ReactNode {
  const id = batch.batch.id;
  const row = flag.row_id ? rows.get(flag.row_id) : undefined;
  switch (flag.kind) {
    case "row_invalid":
      return row ? (
        <>
          <CorrectRowForm batchId={id} row={row} view={`flag-${flag.flag_key.slice(-8)}`} />
          <SkipRowForm batchId={id} rowId={row.id} view={`flag-${flag.flag_key.slice(-8)}`} />
        </>
      ) : null;
    case "possible_duplicate":
      return (
        <>
          <ResolveFlagForm batchId={id} flagKey={flag.flag_key} resolution="import_anyway" label="It is a different purchase: import it" testId="flag-import-anyway" />
          {row ? <SkipRowForm batchId={id} rowId={row.id} view={`dup-${flag.flag_key.slice(-8)}`} /> : null}
        </>
      );
    case "shared_phone":
    case "same_name_other_phone":
      return (
        <>
          {flag.group_id && flag.other_group_id ? <MergeGroupsForm batchId={id} fromGroup={flag.other_group_id} intoGroup={flag.group_id} /> : null}
          <ResolveFlagForm batchId={id} flagKey={flag.flag_key} resolution="keep_separate" label="They are different customers: keep separate" testId="flag-keep-separate" />
        </>
      );
    case "existing_customer": {
      const group = flag.group_id ? groups.get(flag.group_id) : undefined;
      return flag.group_id && flag.existing_customer_id ? (
        <CustomerChoiceForm batchId={id} groupId={flag.group_id} existingCustomerId={flag.existing_customer_id} existingLabel={flag.message.match(/\(([^)]+)\)/)?.[1] ?? "shown above"} current={group?.customer_choice ?? null} />
      ) : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Customers and purchases
// ---------------------------------------------------------------------------------------------------------------
export function CustomersSection({ batch, editable }: { batch: ImportBatch; editable: boolean }) {
  const byId = new Map(batch.groups.map((g) => [g.id, g]));
  const live = batch.groups.filter((g) => g.orders > 0 || g.merged_into);
  return (
    <Section title="Customers" id="customers" aside={<span className="text-xs text-text-muted">{batch.totals.customers} distinct · no sign-in is created and nobody is emailed</span>}>
      <DataTable
        rows={live}
        rowKey={(g) => g.id}
        empty="No customers."
        cardsBelow="xl"
        columns={[
          { key: "no", header: "Customer", primary: true, cell: (g) => `${g.group_no} · ${g.display_name}` },
          { key: "phone", header: "Phone", cell: (g) => g.phone ?? dash },
          { key: "orders", header: "Orders", align: "right", cell: (g) => (g.merged_into ? dash : g.orders) },
          { key: "points", header: "Points to award", align: "right", cell: (g) => (g.merged_into ? dash : g.points.toLocaleString("en-US")) },
          {
            key: "profile",
            header: "Profile",
            cell: (g) =>
              g.merged_into ? (
                <span className="text-text-secondary">Merged into customer {byId.get(g.merged_into)?.group_no}</span>
              ) : g.customer_choice === "existing" ? (
                <span className="text-text-secondary">
                  Existing {g.customer_code ?? ""}
                  {g.existing_balance_points > 0 ? ` · keeps ${g.existing_balance_points.toLocaleString("en-US")} points` : ""}
                </span>
              ) : (
                <span className="text-text-secondary">New profile</span>
              ),
          },
          { key: "act", header: "", cell: (g) => (editable && g.merged_into ? <UnmergeGroupForm batchId={batch.batch.id} groupId={g.id} /> : null) },
        ]}
      />
    </Section>
  );
}

export function PurchasesSection({ batch, editable }: { batch: ImportBatch; editable: boolean }) {
  const purchases = batch.rows.filter((r) => r.kind === "purchase" || r.kind === "invalid");
  const id = batch.batch.id;
  return (
    <Section title="Purchases" id="purchases" aside={<span className="text-xs text-text-muted">{purchases.length} rows · the number is the row in your spreadsheet (the header is row 1)</span>}>
      <DataTable
        rows={purchases}
        rowKey={(r) => r.id}
        empty="No purchases in the file."
        cardsBelow="xl"
        columns={[
          { key: "row", header: "Row", primary: true, cell: (r) => `${r.row_number} · ${r.customer_name ?? "(no name)"}` },
          { key: "date", header: "Completed", cell: (r) => dayLabel(r.happened_on) },
          { key: "revenue", header: "Revenue", align: "right", cell: (r) => (r.revenue_minor === null ? dash : <Money minor={r.revenue_minor} />) },
          { key: "cost", header: "Cost", align: "right", cell: (r) => (r.cost_minor === null ? <span className="text-text-muted">unknown</span> : <Money minor={r.cost_minor} />) },
          { key: "profit", header: "Profit", align: "right", cell: (r) => (r.profit_minor === null ? dash : <Money minor={r.profit_minor} className={r.profit_minor < 0 ? "text-error" : ""} />) },
          { key: "points", header: "Points", align: "right", cell: (r) => (isActivePurchase(r) ? r.points.toLocaleString("en-US") : dash) },
          {
            key: "state",
            header: "Status",
            cell: (r) =>
              r.status === "imported" ? (
                <Badge tone="done">Imported</Badge>
              ) : r.decision === "skip" ? (
                <div className="flex flex-col gap-1">
                  <Badge tone="neutral">Skipped</Badge>
                  {r.skip_reason ? <span className="text-xs text-text-muted">{r.skip_reason}</span> : null}
                </div>
              ) : r.kind === "invalid" ? (
                <Badge tone="cancelled">Cannot import yet</Badge>
              ) : (
                <Badge tone="progress">Will import</Badge>
              ),
          },
          { key: "notes", header: "Notes", cell: (r) => <IssueList issues={r.issues} /> },
          {
            key: "act",
            header: "",
            cell: (r, view) =>
              !editable || r.status === "imported" ? null : (
                <div className="flex flex-col gap-2">
                  {r.decision === "import" ? <CorrectRowForm batchId={id} row={r} view={view} /> : null}
                  {r.decision === "import" ? <SkipRowForm batchId={id} rowId={r.id} view={view} /> : r.skip_reason?.startsWith("already imported") ? null : <RestoreRowForm batchId={id} rowId={r.id} />}
                </div>
              ),
          },
        ]}
      />
    </Section>
  );
}

export function ExclusionsSection({ batch }: { batch: ImportBatch }) {
  const ads = batch.rows.filter((r) => r.kind === "ad_expense");
  const invalid = batch.rows.filter((r) => r.kind === "invalid_summary");
  return (
    <Section title="Left out on purpose" id="exclusions">
      <p className="mb-3 text-sm text-text-secondary">These rows are not orders. They never become an order, revenue, a customer or loyalty points.</p>
      <KeyValues
        items={[
          { label: "Instagram advertising expenses", value: ads.length === 0 ? "None" : `${ads.length} rows, ${formatQar(batch.totals.ad_minor)} in total (reported separately)` },
          { label: "Invalid summary rows", value: invalid.length === 0 ? "None" : `${invalid.length} row${invalid.length === 1 ? "" : "s"}: ${invalid.map((r) => `row ${r.row_number}`).join(", ")} (a spreadsheet error, not a purchase)` },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------
const CLASS_LABEL: Record<string, string> = { unclassified: "Not classified", customer_receipt: "Customer receipt", supplier_invoice: "Supplier invoice (internal)", internal: "Internal" };

export function AttachmentLine({ batchId, attachment, orderId, view }: { batchId: string; attachment: ImportAttachment; orderId: string | null; view: string }) {
  return (
    <li className="rounded-glass-sm border border-border px-3 py-2.5" data-testid="attachment-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm font-medium text-white">{attachment.file_name}</span>
        {attachment.status === "stored" ? (
          <Badge tone="done">Stored · {formatFileSize(attachment.byte_size ?? 0)}</Badge>
        ) : attachment.status === "unavailable" ? (
          <Badge tone="neutral">Original not available</Badge>
        ) : (
          <Badge tone="paused">Not attached yet</Badge>
        )}
        <Badge tone={attachment.classification === "supplier_invoice" ? "cancelled" : "neutral"}>{CLASS_LABEL[attachment.classification] ?? attachment.classification}</Badge>
        {attachment.customer_visible ? <Badge tone="progress">Customer may see it</Badge> : null}
      </div>
      {attachment.status !== "stored" && attachment.source_expiring ? (
        <p className="mt-1 text-xs text-text-muted">The export&apos;s link is temporary and may have expired. That does not mean the file never existed: attach the original if you have it. The importer never opens that link.</p>
      ) : null}
      {attachment.unavailable_reason ? <p className="mt-1 text-xs text-text-muted">{attachment.unavailable_reason}</p> : null}
      <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2">
        {attachment.status === "stored" ? (
          <>
            <a href={attachmentHref(attachment.id)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">
              View
            </a>
            <a href={attachmentHref(attachment.id, { download: true })} className="text-xs font-semibold text-accent hover:underline">
              Download
            </a>
            <ClassifyAttachmentForm batchId={batchId} attachmentId={attachment.id} orderId={orderId} current={attachment.classification} view={view} />
          </>
        ) : (
          <>
            <StoreAttachmentForm batchId={batchId} attachmentId={attachment.id} orderId={orderId} view={view} />
            {attachment.status === "pending" ? <UnavailableAttachmentForm batchId={batchId} attachmentId={attachment.id} orderId={orderId} view={view} /> : null}
          </>
        )}
      </div>
    </li>
  );
}

export function AttachmentsSection({ batch, editable }: { batch: ImportBatch; editable: boolean }) {
  const byRow = new Map<string, ImportAttachment[]>();
  for (const a of batch.attachments) byRow.set(a.row_id, [...(byRow.get(a.row_id) ?? []), a]);
  const withFiles = batch.rows.filter((r) => r.kind === "purchase" && r.status !== "skipped");
  const missing = batch.attachments.filter((a) => a.status !== "stored").length;
  return (
    <Section
      title="Receipts and files"
      id="attachments"
      aside={<span className="text-xs text-text-muted">{batch.attachments.length} referenced · {missing} not attached yet</span>}
    >
      <p className="mb-4 text-sm text-text-secondary">
        The export only refers to files by temporary links. A missing file never blocks an order. Attach each original you have (PDF or PNG, up to 4 MB); it is checked and stored privately. A file you mark as a supplier invoice is never shown to a customer.
      </p>
      <ul className="flex flex-col gap-4">
        {withFiles.map((row) => {
          const files = byRow.get(row.id) ?? [];
          if (files.length === 0 && !editable) return null;
          return (
            <li key={row.id}>
              <p className="mb-2 text-sm font-semibold text-white">
                {rowLabel(row)} <span className="font-normal text-text-muted">· {dayLabel(row.happened_on)}</span>
              </p>
              {files.length === 0 ? <p className="mb-2 text-xs text-text-muted">No files are referenced for this order.</p> : null}
              <ul className="flex flex-col gap-2">
                {files.map((a) => (
                  <AttachmentLine key={a.id} batchId={batch.batch.id} attachment={a} orderId={row.order_id} view={row.id} />
                ))}
              </ul>
              {editable ? (
                <div className="mt-2">
                  <AddAttachmentForm batchId={batch.batch.id} rowId={row.id} orderId={row.order_id} view={row.id} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The confirmation and the final report
// ---------------------------------------------------------------------------------------------------------------
export function ConfirmSection({ batch }: { batch: ImportBatch }) {
  const t = batch.totals;
  return (
    <Section title="Final confirmation" id="confirm">
      {t.orders === 0 ? (
        <p className="text-sm text-text-secondary">There is nothing to import in this file.</p>
      ) : (
        <>
          {batch.rate_now !== null && batch.rate_now !== batch.batch.qar_per_point_minor ? (
            <p role="alert" className="mb-4 rounded-glass-sm border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              The loyalty earning rate changed after this import was prepared, so it cannot be imported. Discard it and upload the file again.
            </p>
          ) : null}
          <CommitImportForm batchId={batch.batch.id} figures={{ orders: t.orders, revenueMinor: t.revenue_minor, costMinor: t.cost_minor, points: t.points }} blocking={batch.blocking} />
        </>
      )}
      <div className="mt-6 border-t border-border pt-4">
        <DiscardImportForm batchId={batch.batch.id} />
      </div>
    </Section>
  );
}

const WARNING_LABEL: Record<string, string> = {
  loss_recorded: "Orders recorded at a loss (kept exactly as recorded)",
  attachment_expiring: "Receipts referenced by a temporary link",
  identical_purchase: "Identical purchases in the same file (counted separately, once each)",
  cost_missing: "Orders without a cost (profit not counted for them)",
  phone_assumed_qatar: "Phone numbers read as Qatar numbers",
  phone_missing: "Customers without a phone number",
  name_cleaned: "Names that were cleaned",
};

export function ReportSection({ batch, report }: { batch: ImportBatch; report: ImportReport }) {
  const orderOf = new Map(batch.rows.map((r) => [r.row_number, r]));
  return (
    <Section title="Import report" id="report" aside={<Badge tone="done">Completed {formatWhen(report.committed_at)}</Badge>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="import-report">
        <Stat label="Orders imported" value={report.orders} hint="Completed · Historical WhatsApp order" />
        <Stat label="Customers" value={report.customers_created + report.customers_reused} hint={`${report.customers_created} new profiles, ${report.customers_reused} existing`} />
        <Stat label="Revenue" value={<Money minor={report.revenue_minor} />} hint="Reported under each completion month" />
        <Stat label="Loyalty points awarded" value={report.points.toLocaleString("en-US")} hint="Once per order" tone="gold" />
        <Stat label="Direct costs" value={<Money minor={report.cost_minor} />} hint={report.costs_declared_complete ? "Declared complete" : "Declared not yet confirmed (provisional)"} />
        <Stat label="Profit" value={<Money minor={report.profit_minor} />} hint={report.loss_orders > 0 ? `${report.loss_orders} at a loss` : undefined} />
        <Stat label="Advertising (not orders)" value={<Money minor={report.exclusions.ad_minor} />} hint={`${report.exclusions.ad_rows} rows, reported separately`} />
        <Stat label="Files still to attach" value={report.attachments.pending} hint={`${report.attachments.total} referenced`} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-white">Left out</h3>
          <KeyValues
            items={[
              { label: "Invalid summary rows", value: report.exclusions.invalid_summary_rows },
              { label: "Skipped by you", value: report.skipped.by_owner },
              { label: "Already imported earlier", value: report.skipped.already_imported },
            ]}
          />
        </div>
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-white">Warnings</h3>
          {report.warnings.length === 0 ? (
            <p className="text-sm text-text-secondary">None.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-text-secondary">
              {report.warnings.map((w) => (
                <li key={`${w.code}:${w.severity}`}>
                  {WARNING_LABEL[w.code] ?? w.code.replace(/_/g, " ")} · {w.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <h3 className="mb-2 mt-6 font-display text-sm font-semibold text-white">Orders created</h3>
      <DataTable
        rows={report.per_order}
        rowKey={(o) => String(o.row_number)}
        empty="No orders."
        columns={[
          {
            key: "ref",
            header: "Order",
            primary: true,
            cell: (o) => {
              const orderId = orderOf.get(o.row_number)?.order_id;
              return orderId ? (
                <Link href={`/admin/orders/${orderId}`} className="text-accent hover:underline">
                  {o.order_ref}
                </Link>
              ) : (
                o.order_ref
              );
            },
          },
          { key: "row", header: "File row", cell: (o) => o.row_number },
          { key: "customer", header: "Customer", cell: (o) => o.customer_code },
          { key: "points", header: "Points", align: "right", cell: (o) => o.points.toLocaleString("en-US") },
        ]}
      />
      <p className="mt-5 text-sm text-text-secondary">
        Nobody was emailed and no sign-in was created. When a customer asks to see their history, issue them a one-time claim code from their customer page; after they create their own account and enter it, their orders and points appear in their account, and your costs and profit stay hidden from them.
      </p>
      <div className="mt-3">
        <Link href="/admin/customers" className="text-sm font-semibold text-accent hover:underline">
          Open customers
        </Link>
      </div>
    </Section>
  );
}

export function NotesSection({ batch }: { batch: ImportBatch }) {
  const notes = batch.batch.notes ?? [];
  const reason = batch.batch.date_format_reason;
  const ambiguous = batch.batch.date_format === null && (reason === "ambiguous" || reason === "mixed");
  return (
    <>
      {ambiguous ? (
        <p role="alert" className="rounded-glass-sm border border-error/40 bg-error/10 px-4 py-3 text-sm text-error" data-testid="date-ambiguous">
          The dates in this file could not be read with certainty (for example 03/04/2025 is either 3 April or 4 March). Dates that could not be read are listed below. To fix them all at once, discard this import and upload the file again, choosing how the dates are written.
        </p>
      ) : null}
      {notes.length > 0 ? (
        <Section title="Notes about the file" id="notes">
          <IssueList issues={notes} />
        </Section>
      ) : null}
    </>
  );
}

export const importDateLine = (batch: ImportBatch): string => `Prepared ${formatWhen(batch.batch.created_at)}${batch.batch.source_label ? ` from ${batch.batch.source_label}` : ""}`;

// ---------------------------------------------------------------------------------------------------------------
// On an order's own page
// ---------------------------------------------------------------------------------------------------------------
/** What every staff member who may read orders sees on a historical order: what it is and why it has no tracking or deposit. */
export function HistoricalOrderNote({ completedIso }: { completedIso: string }) {
  return (
    <Section title="Historical WhatsApp order">
      <p className="text-sm text-text-secondary" data-testid="historical-note">
        This is a purchase made on WhatsApp before the website existed. Its placement date is not known, so it is listed by the day it was completed, {dayLabel(completedIso.slice(0, 10))}. It has no tracking updates and no deposit step, because none happened on this system.
      </p>
    </Section>
  );
}

/** The owner's view of a historical order: where it came from, what was confirmed, its files, and the later description of what was bought. */
export function HistoricalOrderPanel({ info, orderId, netMinor }: { info: HistoricalOrderInfo; orderId: string; netMinor: number }) {
  const files: ImportAttachment[] = info.attachments.map((a) => ({ ...a, row_id: info.row_id, source_ref: null }));
  return (
    <Section title="Historical WhatsApp order" id="historical">
      <KeyValues
        items={[
          { label: "Completion date", value: `${dayLabel(info.historical_date)} (the date you confirmed as the completion date)` },
          { label: "Placement date", value: info.placement_date_known ? "Known" : "Not known: never guessed" },
          { label: "Imported", value: `${formatWhen(info.imported_at)}${info.imported_by_name ? ` by ${info.imported_by_name}` : ""}` },
          { label: "Payment", value: "Paid in full, as you confirmed when importing it. No payment records exist for this order." },
          { label: "Loyalty points awarded", value: `${info.points_awarded.toLocaleString("en-US")} (once, when it was imported)` },
          { label: "Source", value: <Link href={`/admin/import/${info.batch_id}`} className="text-accent hover:underline">Import, row {info.source_row_number}</Link> },
        ]}
      />
      <h3 className="mb-2 mt-6 font-display text-sm font-semibold text-white">Receipts and files</h3>
      {files.length === 0 ? <p className="mb-2 text-sm text-text-muted">No files are attached to this order.</p> : null}
      <ul className="flex flex-col gap-2">
        {files.map((a) => (
          <AttachmentLine key={a.id} batchId={info.batch_id} attachment={a} orderId={orderId} view="order" />
        ))}
      </ul>
      <div className="mt-3">
        <AddAttachmentForm batchId={info.batch_id} rowId={info.row_id} orderId={orderId} view="order" />
      </div>
      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold text-accent hover:underline">Describe what was bought…</summary>
        <div className="mt-3">
          <SetOrderItemsForm orderId={orderId} netMinor={netMinor} />
        </div>
      </details>
    </Section>
  );
}
