/**
 * What the Import Historical Orders forms send, read on the server. Pure: no server code and no database, so every rule here is unit-tested with
 * plain FormData. The server decides: nothing the browser checked is trusted, and the database checks every value again.
 *
 * What a form may NOT supply: who is acting (the session), a permission, an order total or a loyalty balance (the database computes them), the
 * points an order earns, or the identity of a purchase. The "expected" figures of the commit form are not inputs of the import: they are the
 * figures the owner SAW, and the database refuses the commit if what it would do has changed since.
 */
import type { StaffFieldErrors } from "../form-state";
import { isUuid } from "../validation";
import { CSV_LIMITS, decodeCsvBytes } from "./csv";
import { inspectAttachment, MAX_ATTACHMENT_BYTES } from "./attachments";
import { parseMoney, type DateFormat, type YearMonthDay } from "./normalize";
import { MAX_ITEM_LINES } from "./choices";
import type { AttachmentClass, CommitConfirmation, HistoricalItem } from "./types";

/** Today's calendar date in Asia/Qatar (UTC+3, no daylight saving). */
export function qatarToday(now: Date = new Date()): YearMonthDay {
  const q = new Date(now.getTime() + 3 * 3_600_000);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate() };
}

/** A ticked checkbox: the browser sends "on" for a plain one, and the admin forms' shared checkbox sends "yes". Anything else is not ticked. */
export const isChecked = (form: FormData, name: string): boolean => {
  const value = form.get(name);
  return value === "on" || value === "yes";
};

const text = (form: FormData, name: string, max = 300): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

type FileLike = { name?: unknown; size?: unknown; arrayBuffer?: unknown };
const asFile = (value: unknown): (FileLike & { arrayBuffer: () => Promise<ArrayBuffer>; size: number }) | null => {
  const file = value as FileLike | null;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function" || typeof file.size !== "number") return null;
  return file as FileLike & { arrayBuffer: () => Promise<ArrayBuffer>; size: number };
};

const safeName = (raw: unknown, fallback: string): string => {
  const name = typeof raw === "string" ? raw : "";
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || fallback;
};

// ---------------------------------------------------------------------------------------------------------------
// The CSV
// ---------------------------------------------------------------------------------------------------------------
export const CHOOSE_A_CSV = "Choose the CSV file first.";
export const CSV_EMPTY = "That file is empty.";
export const CSV_TOO_BIG = "The file is larger than 512 KB. A historical export should be far smaller; check that it is the right file.";
export const CSV_NOT_TEXT = "The file is not a text CSV (it contains binary data or is not UTF-8). Export it again as CSV (UTF-8).";

export type CsvUpload = { ok: true; text: string; name: string; dateFormat: DateFormat | null } | { ok: false; field: string; message: string };

export async function readCsvUpload(form: FormData, field = "file"): Promise<CsvUpload> {
  const file = asFile(form.get(field));
  if (!file) return { ok: false, field, message: CHOOSE_A_CSV };
  if (file.size === 0) return { ok: false, field, message: CSV_EMPTY };
  if (file.size > CSV_LIMITS.maxBytes) return { ok: false, field, message: CSV_TOO_BIG };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return { ok: false, field, message: CSV_EMPTY };
  if (bytes.length > CSV_LIMITS.maxBytes) return { ok: false, field, message: CSV_TOO_BIG };
  const decoded = decodeCsvBytes(bytes);
  if (decoded === null) return { ok: false, field, message: CSV_NOT_TEXT };
  const choice = text(form, "date_format", 8);
  if (choice !== "" && choice !== "auto" && choice !== "dmy" && choice !== "mdy" && choice !== "iso") {
    return { ok: false, field: "date_format", message: "Choose how the dates are written." };
  }
  return { ok: true, text: decoded, name: safeName(file.name, "export.csv"), dateFormat: choice === "" || choice === "auto" ? null : choice };
}

// ---------------------------------------------------------------------------------------------------------------
// Correcting one row
// ---------------------------------------------------------------------------------------------------------------
export interface RowCorrection {
  customer: string;
  phone: string;
  date: string;
  revenue: string;
  cost: string;
}

export function parseRowCorrection(form: FormData): RowCorrection {
  return { customer: text(form, "customer"), phone: text(form, "phone"), date: text(form, "date", 40), revenue: text(form, "revenue", 40), cost: text(form, "cost", 40) };
}

export function parseDecision(form: FormData): { ok: true; decision: "import" | "skip"; reason: string | null } | { ok: false; errors: StaffFieldErrors } {
  const decision = text(form, "decision", 10);
  if (decision !== "import" && decision !== "skip") return { ok: false, errors: { decision: "Choose to import or to skip this row." } };
  const reason = text(form, "reason", 300);
  if (decision === "skip" && (reason.length < 3 || reason.length > 300)) return { ok: false, errors: { reason: "Say why this row is skipped (3 to 300 characters)." } };
  return { ok: true, decision, reason: decision === "skip" ? reason : null };
}

export function parseCustomerChoice(form: FormData): { ok: true; choice: "new" | "existing"; customerId: string | null } | { ok: false; errors: StaffFieldErrors } {
  const choice = text(form, "choice", 10);
  if (choice === "new") return { ok: true, choice, customerId: null };
  if (choice === "existing") {
    const customerId = text(form, "customer_id", 40);
    if (!isUuid(customerId)) return { ok: false, errors: { customer_id: "Choose which existing customer this is." } };
    return { ok: true, choice, customerId };
  }
  return { ok: false, errors: { choice: "Choose a new profile or an existing customer." } };
}

export function parseFlagResolution(form: FormData): { ok: true; key: string; resolution: "keep_separate" | "import_anyway"; note: string | null } | { ok: false; errors: StaffFieldErrors } {
  const key = text(form, "flag_key", 120);
  const resolution = text(form, "resolution", 20);
  if (!/^[A-Za-z0-9:_-]{3,120}$/.test(key)) return { ok: false, errors: { flag_key: "That item could not be found." } };
  if (resolution !== "keep_separate" && resolution !== "import_anyway") return { ok: false, errors: { resolution: "Choose a decision." } };
  const note = text(form, "note", 300);
  return { ok: true, key, resolution, note: note || null };
}

export function parseDiscardReason(form: FormData): { ok: true; value: string } | { ok: false; errors: StaffFieldErrors } {
  const reason = text(form, "reason", 300);
  if (reason.length < 3) return { ok: false, errors: { reason: "Say why this import is being discarded (at least 3 characters)." } };
  return { ok: true, value: reason };
}

// ---------------------------------------------------------------------------------------------------------------
// The final confirmation
// ---------------------------------------------------------------------------------------------------------------
export type CommitIntent = "check" | "import";

export function parseCommit(form: FormData): { ok: true; intent: CommitIntent; confirmation: CommitConfirmation } | { ok: false; errors: StaffFieldErrors } {
  const errors: StaffFieldErrors = {};
  const intent = text(form, "intent", 10);
  if (intent !== "check" && intent !== "import") errors.intent = "Choose to check or to import.";
  const checked = (name: string) => isChecked(form, name);
  const dateIsCompletion = checked("attest_date");
  const revenueIsFinal = checked("attest_revenue");
  const fullyPaid = checked("attest_paid");
  if (!dateIsCompletion) errors.attest_date = "Confirm that the dates are the completion dates.";
  if (!revenueIsFinal) errors.attest_revenue = "Confirm that the revenue is the final amount the customer paid.";
  if (!fullyPaid) errors.attest_paid = "Confirm that every one of these orders was fully paid.";
  const costs = text(form, "costs_complete", 4);
  if (costs !== "yes" && costs !== "no") errors.costs_complete = "Say whether the costs are the complete direct costs.";
  const digits = (name: string): number => {
    const raw = text(form, name, 16);
    return /^\d{1,13}$/.test(raw) ? Number(raw) : -1;
  };
  const expected = { orders: digits("expected_orders"), revenue_minor: digits("expected_revenue_minor"), cost_minor: digits("expected_cost_minor"), points: digits("expected_points") };
  if (Object.values(expected).some((n) => n < 0)) errors.expected = "The page is out of date. Reload it and review the import again.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    intent: intent as CommitIntent,
    confirmation: {
      phrase: text(form, "phrase", 40),
      attest: { date_is_completion_date: dateIsCompletion, revenue_is_final_payable: revenueIsFinal, orders_fully_paid: fullyPaid, costs_complete: costs === "yes" },
      expected,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------
export function parseAttachmentClass(form: FormData, field = "classification"): AttachmentClass | null {
  const value = text(form, field, 20);
  return value === "unclassified" || value === "customer_receipt" || value === "supplier_invoice" ? value : null;
}

export type AttachmentUpload =
  | { ok: true; name: string; bytes: Uint8Array; ext: "pdf" | "png"; mime: string }
  | { ok: false; message: string };

/** A PDF or PNG, looked at by its BYTES (signature, structure, no active content), not by its name or the type the browser claimed. */
export async function readAttachmentUpload(form: FormData, field = "file"): Promise<AttachmentUpload> {
  const file = asFile(form.get(field));
  if (!file) return { ok: false, message: "Choose a PDF or PNG file first." };
  if (file.size === 0) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: "That file is larger than 4 MB. Attach a smaller file." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = inspectAttachment(bytes);
  if (!verdict.ok) return { ok: false, message: verdict.message };
  return { ok: true, name: safeName(file.name, verdict.ext === "pdf" ? "receipt.pdf" : "receipt.png"), bytes, ext: verdict.ext, mime: verdict.mime };
}

export function parseUnavailableReason(form: FormData): { ok: true; value: string } | { ok: false; errors: StaffFieldErrors } {
  const reason = text(form, "reason", 300);
  if (reason.length < 3) return { ok: false, errors: { reason: "Say why the original is not available (3 to 300 characters)." } };
  return { ok: true, value: reason };
}

// ---------------------------------------------------------------------------------------------------------------
// Describing what was bought, later
// ---------------------------------------------------------------------------------------------------------------
/**
 * The item lines the owner typed (description, quantity, unit price in QAR). The lines must add up to the order's amount: the database checks that
 * against the order itself, so a typed total can never change what a customer paid.
 */
export function parseItemLines(form: FormData): { ok: true; items: HistoricalItem[]; reason: string } | { ok: false; errors: StaffFieldErrors } {
  const errors: StaffFieldErrors = {};
  const items: HistoricalItem[] = [];
  for (let i = 1; i <= MAX_ITEM_LINES; i += 1) {
    const description = text(form, `description_${i}`, 300);
    const quantityRaw = text(form, `quantity_${i}`, 6);
    const priceRaw = text(form, `price_${i}`, 20);
    if (description === "" && quantityRaw === "" && priceRaw === "") continue;
    if (description === "") {
      errors[`description_${i}`] = "Describe this line.";
      continue;
    }
    if (/[\u0000-\u001f\u007f]/.test(description)) {
      errors[`description_${i}`] = "That description has characters that cannot be saved.";
      continue;
    }
    const quantity = quantityRaw === "" ? 1 : /^\d{1,4}$/.test(quantityRaw) ? Number(quantityRaw) : 0;
    if (quantity < 1 || quantity > 1000) {
      errors[`quantity_${i}`] = "Quantity is a whole number from 1 to 1000.";
      continue;
    }
    const price = parseMoney(priceRaw);
    if (!price.ok || price.minor < 0 || price.minor > 99_999_999_999) {
      errors[`price_${i}`] = "Enter the price of one unit in QAR (for example 1,250 or 1250.50).";
      continue;
    }
    items.push({ kind: "other", description, quantity, unit_price_minor: price.minor });
  }
  if (items.length === 0 && Object.keys(errors).length === 0) errors.description_1 = "Describe at least one item.";
  const reason = text(form, "reason", 500);
  if (reason.length < 3) errors.reason = "Say what this description is based on (3 to 500 characters).";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, items, reason };
}

/** A path parameter or hidden field that must be a record id. */
export const idField = (form: FormData, name: string): string | null => {
  const value = text(form, name, 40);
  return isUuid(value) ? value : null;
};
