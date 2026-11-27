"use server";
import "server-only";

/**
 * Server Actions of the Historical Orders Import. Owner only. Every action, without exception:
 *   1. goes through `run()`, which asks `requireStaff` first (404 when the admin area is off or the person is not staff, a sign-in or second-factor
 *      page otherwise) and then requires the `import.manage` permission, which only the owner holds;
 *   2. reads its form on the server (forms.ts), never takes an identity, a permission, a total, a balance or the points of an order from it;
 *   3. calls ONE staff function through the gateway, which authorizes again in PostgreSQL (permission and second factor);
 *   4. answers with a fixed sentence or a business-rule message written for staff, never a raw database error.
 *
 * Nothing here sends an email or a message, creates a sign-in account, or reaches any other service: the import only writes the platform database,
 * through the same gateway as every other staff action.
 */
import { revalidatePath } from "next/cache";
import { formatQar } from "@/lib/platform/money";
import type { StaffContext } from "../session";
import { requireStaff } from "../session";
import { echoValues, type StaffFormState } from "../form-state";
import { DENIED, failureState } from "../outcomes";
import type { StaffApi } from "../api";
import { analyzeHistoricalCsv } from "./parse";
import { correctedRow, stagePayload } from "./payload";
import {
  idField,
  isChecked,
  parseAttachmentClass,
  parseCommit,
  parseCustomerChoice,
  parseDecision,
  parseDiscardReason,
  parseFlagResolution,
  parseItemLines,
  parseRowCorrection,
  parseUnavailableReason,
  qatarToday,
  readAttachmentUpload,
  readCsvUpload,
} from "./forms";

const PERMISSION = "import.manage";

/** Runs one action as the verified owner and turns every failure into a safe message. */
async function run(nextPath: string, formData: FormData, work: (ctx: StaffContext) => Promise<StaffFormState>): Promise<StaffFormState> {
  const ctx = await requireStaff(nextPath);
  // Whatever goes wrong, what was typed goes back to the form so a long form is never wiped by an error.
  const failed = (state: StaffFormState): StaffFormState => (state.status === "error" && !state.values ? { ...state, values: echoValues(formData) } : state);
  // The database checks the permission again; this only avoids a round trip and gives a clear message.
  if (!ctx.can(PERMISSION)) return failed({ status: "error", message: DENIED });
  try {
    return failed(await work(ctx));
  } catch (error) {
    return failed(failureState(error));
  }
}

const NOT_FOUND: StaffFormState = { status: "error", message: "That import could not be found." };
const importPath = (batchId: string) => `/admin/import/${batchId}`;
const refresh = (batchId: string, extra: string[] = []) => {
  revalidatePath("/admin/import");
  revalidatePath(importPath(batchId));
  for (const path of extra) revalidatePath(path);
};

/** The loyalty earning rate in force (QAR minor units per point). Read for display only: the database uses its own copy of the policy. */
async function earningRate(api: StaffApi): Promise<number | null> {
  const policy = (await api.policies()).find((p) => p.key === "loyalty.earn_rate");
  const rate = Number((policy?.value as { qar_per_point_minor?: unknown } | undefined)?.qar_per_point_minor);
  return Number.isInteger(rate) && rate >= 1 ? rate : null;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Upload: read the file, check every row, prepare (stage) the import. Nothing is imported.
// ---------------------------------------------------------------------------------------------------------------
export async function uploadImportAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  return run("/admin/import", formData, async ({ api }) => {
    const upload = await readCsvUpload(formData);
    if (!upload.ok) return { status: "error", fieldErrors: { [upload.field]: upload.message } };
    const rate = await earningRate(api);
    if (rate === null) return { status: "error", message: "The loyalty earning rate is not set, so the points cannot be worked out. Nothing was prepared." };
    const analysis = analyzeHistoricalCsv(upload.text, { dateFormat: upload.dateFormat, today: qatarToday(), ratePerPointMinor: rate });
    if (!analysis.ok) return { status: "error", fieldErrors: { file: analysis.message } };
    const staged = await api.histStageBatch(stagePayload(analysis, upload.name));
    revalidatePath("/admin/import");
    if (staged.reused) {
      return {
        status: "success",
        message: staged.status === "committed" ? "This exact file was already imported earlier. Nothing new was prepared; opening its report." : "This exact file was already prepared. Opening it.",
        href: importPath(staged.batch_id),
      };
    }
    return { status: "success", message: "The file was read and prepared. Nothing has been imported yet: review it on the next page.", href: importPath(staged.batch_id) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The owner's review: corrections, skips, customers, duplicates
// ---------------------------------------------------------------------------------------------------------------
export async function correctRowAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const rowId = idField(formData, "row_id");
    if (!batchId || !rowId) return NOT_FOUND;
    const rate = await earningRate(api);
    if (rate === null) return { status: "error", message: "The loyalty earning rate is not set. Nothing was changed." };
    // The row keeps its place in the file: the database sets the row number itself, so none is taken from the form.
    const corrected = correctedRow(1, parseRowCorrection(formData), { today: qatarToday(), ratePerPointMinor: rate });
    if (!corrected.ok) return { status: "error", message: corrected.message };
    const errors = corrected.row.issues.filter((i) => i.severity === "error");
    if (corrected.row.kind !== "purchase" || errors.length > 0) {
      // The corrected values are still invalid: say exactly why, and change nothing.
      const why = errors.map((i) => i.message).join(" ");
      return { status: "error", message: why || "These values are not a valid purchase. Nothing was changed." };
    }
    await api.histUpdateRow(batchId, rowId, corrected.row);
    refresh(batchId);
    return { status: "success", message: "The row was corrected. The customers, duplicates and totals below were recalculated." };
  });
}

export async function rowDecisionAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const rowId = idField(formData, "row_id");
    if (!batchId || !rowId) return NOT_FOUND;
    const parsed = parseDecision(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histSetRowDecision(batchId, rowId, parsed.decision, parsed.reason);
    refresh(batchId);
    return { status: "success", message: parsed.decision === "skip" ? "The row will not be imported." : "The row will be imported." };
  });
}

export async function mergeGroupsAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const from = idField(formData, "from_group");
    const into = idField(formData, "into_group");
    if (!batchId || !from || !into || from === into) return NOT_FOUND;
    await api.histMergeGroups(batchId, from, into);
    refresh(batchId);
    return { status: "success", message: "These are now treated as one customer." };
  });
}

export async function unmergeGroupAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const group = idField(formData, "group_id");
    if (!batchId || !group) return NOT_FOUND;
    await api.histUnmergeGroup(batchId, group);
    refresh(batchId);
    return { status: "success", message: "They are separate customers again." };
  });
}

export async function customerChoiceAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const group = idField(formData, "group_id");
    if (!batchId || !group) return NOT_FOUND;
    const parsed = parseCustomerChoice(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histSetGroupCustomer(batchId, group, parsed.choice, parsed.customerId);
    refresh(batchId);
    return { status: "success", message: parsed.choice === "new" ? "A new customer profile will be created for them." : "Their orders will be added to the existing customer." };
  });
}

export async function resolveFlagAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    if (!batchId) return NOT_FOUND;
    const parsed = parseFlagResolution(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histResolveFlag(batchId, parsed.key, parsed.resolution, parsed.note);
    refresh(batchId);
    return { status: "success", message: parsed.resolution === "keep_separate" ? "Kept as separate customers." : "Confirmed: this is a separate purchase." };
  });
}

export async function discardImportAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    if (!batchId) return NOT_FOUND;
    const parsed = parseDiscardReason(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histDiscardBatch(batchId, parsed.value);
    refresh(batchId);
    return { status: "success", message: "This import was discarded. Nothing had been imported, so nothing was changed in your orders, customers or loyalty.", href: "/admin/import" };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The final confirmation: a check that changes nothing, or the import itself (one transaction: all of it or none of it)
// ---------------------------------------------------------------------------------------------------------------
export async function commitImportAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    if (!batchId) return NOT_FOUND;
    const parsed = parseCommit(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    const dryRun = parsed.intent === "check";
    const report = await api.histCommitBatch(batchId, parsed.confirmation, dryRun);
    if (dryRun) {
      // The whole import ran for real inside a transaction that was then undone: every rule and every constraint was exercised, and nothing was saved.
      return {
        status: "success",
        message: `Check passed. Importing now would create ${report.orders} orders for ${report.customers_created + report.customers_reused} customers, record ${formatQar(report.revenue_minor)} of revenue and award ${report.points.toLocaleString("en-US")} points. Nothing was saved.`,
      };
    }
    refresh(batchId, ["/admin", "/admin/orders", "/admin/customers", "/admin/loyalty"]);
    if (report.replayed) return { status: "success", message: "This import was already completed earlier, so nothing new was imported. Opening its report.", href: importPath(batchId) };
    return {
      status: "success",
      message: `Imported ${report.orders} orders. ${report.points.toLocaleString("en-US")} loyalty points were awarded, once each. No customer was emailed and no account was created.`,
      href: importPath(batchId),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Files: original receipts, attached later or when the export's links have expired
// ---------------------------------------------------------------------------------------------------------------
export async function storeAttachmentAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const attachmentId = idField(formData, "attachment_id");
    if (!batchId || !attachmentId) return NOT_FOUND;
    const upload = await readAttachmentUpload(formData);
    if (!upload.ok) return { status: "error", fieldErrors: { file: upload.message } };
    const classification = parseAttachmentClass(formData);
    await api.histStoreAttachment(attachmentId, Buffer.from(upload.bytes), classification);
    refresh(batchId, orderPaths(formData));
    return { status: "success", message: "The file was checked and stored privately." };
  });
}

export async function addAttachmentAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const rowId = idField(formData, "row_id");
    if (!batchId || !rowId) return NOT_FOUND;
    const upload = await readAttachmentUpload(formData);
    if (!upload.ok) return { status: "error", fieldErrors: { file: upload.message } };
    await api.histAddAttachment(rowId, upload.name, Buffer.from(upload.bytes), parseAttachmentClass(formData) ?? "unclassified");
    refresh(batchId, orderPaths(formData));
    return { status: "success", message: "The file was checked and stored privately." };
  });
}

export async function classifyAttachmentAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const attachmentId = idField(formData, "attachment_id");
    const classification = parseAttachmentClass(formData);
    if (!batchId || !attachmentId) return NOT_FOUND;
    if (!classification) return { status: "error", fieldErrors: { classification: "Choose what kind of document this is." } };
    // A supplier invoice is never visible to a customer, whatever the form says: the database refuses it as well.
    const visible = classification === "customer_receipt" && isChecked(formData, "customer_visible");
    await api.histSetAttachmentClass(attachmentId, classification, visible);
    refresh(batchId, orderPaths(formData));
    return { status: "success", message: "Saved." };
  });
}

export async function attachmentUnavailableAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const batchId = idField(formData, "batch_id");
  return run(importPath(batchId ?? ""), formData, async ({ api }) => {
    const attachmentId = idField(formData, "attachment_id");
    if (!batchId || !attachmentId) return NOT_FOUND;
    const parsed = parseUnavailableReason(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histMarkAttachmentUnavailable(attachmentId, parsed.value);
    refresh(batchId, orderPaths(formData));
    return { status: "success", message: "Marked as not available. The order is unaffected, and a file can still be attached later." };
  });
}

/** The order page to refresh too, when the form says which order it was on. */
function orderPaths(formData: FormData): string[] {
  const orderId = idField(formData, "order_id");
  return orderId ? [`/admin/orders/${orderId}`] : [];
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Describing what was bought (the import keeps one honest placeholder line; the money cannot change)
// ---------------------------------------------------------------------------------------------------------------
export async function setOrderItemsAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = idField(formData, "order_id");
  return run(`/admin/orders/${orderId ?? ""}`, formData, async ({ api }) => {
    if (!orderId) return { status: "error", message: "That record could not be found." };
    const parsed = parseItemLines(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.histSetOrderItems(orderId, parsed.items, parsed.reason);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    return { status: "success", message: "The description was saved. The previous lines are kept in the history, and the order's money did not change." };
  });
}
