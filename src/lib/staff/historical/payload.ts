/**
 * Turns what the importer read (parse.ts) into the one JSON document the database stages (admin.hist_stage_batch), and reads the owner's corrections
 * of a single row with the SAME rules as a file row. Pure: no server code, no database.
 *
 * The database does not trust this document: it re-checks every field, recomputes each purchase's identity and decides what is a duplicate.
 */
import { analyzeHistoricalCsv, type AnalyzeResult, type AnalyzedRow, type Issue } from "./parse";
import type { DateFormat, YearMonthDay } from "./normalize";

export interface DbRow {
  row_number: number;
  kind: AnalyzedRow["kind"];
  customer_name: string | null;
  name_key: string;
  phone: string | null;
  phone_key: string;
  happened_on: string | null;
  month_label: string | null;
  revenue_minor: number | null;
  cost_minor: number | null;
  profit_minor: number | null;
  issues: Issue[];
  attachments: { file_name: string; ext: string; ref: string | null; host: string | null; expiring: boolean }[];
}

export interface StagePayload {
  options: { date_format: DateFormat | null; date_format_reason: string; parser_version: number; source_label: string | null; notes: Issue[] };
  rows: DbRow[];
}

/** A row's fields as the database stores them. A negative revenue or cost in a row that is already invalid is sent as missing: the issue says why. */
export function toDbRow(row: AnalyzedRow): DbRow {
  const nonNegative = (v: number | null): number | null => (v === null || v < 0 ? null : v);
  return {
    row_number: row.rowNumber,
    kind: row.kind,
    customer_name: row.customerName,
    name_key: row.nameKey,
    phone: row.phone,
    phone_key: row.phoneKey,
    happened_on: row.happenedOn,
    month_label: row.monthLabel,
    revenue_minor: nonNegative(row.revenueMinor),
    cost_minor: nonNegative(row.costMinor),
    profit_minor: row.profitMinor,
    issues: row.issues,
    attachments: row.attachments.map((a) => ({ file_name: a.fileName, ext: a.ext, ref: a.ref, host: a.host, expiring: a.expiring })),
  };
}

export function stagePayload(analysis: Extract<AnalyzeResult, { ok: true }>, sourceLabel: string | null = null): StagePayload {
  return {
    options: { date_format: analysis.dateFormat, date_format_reason: analysis.dateFormatReason, parser_version: 1, source_label: sourceLabel, notes: analysis.notes },
    rows: analysis.rows.map(toDbRow),
  };
}

const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";
const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * The owner's correction of one row: the typed values are read by the very same analysis as a file row (so a correction can never be more lenient
 * than the file), with the date typed as YYYY-MM-DD. Returns the row to send, or why it cannot be one.
 */
export function correctedRow(
  rowNumber: number,
  fields: { customer: string; phone: string; date: string; revenue: string; cost: string },
  context: { today: YearMonthDay; ratePerPointMinor: number },
): { ok: true; row: DbRow } | { ok: false; message: string } {
  const line = [fields.customer, fields.phone, fields.date, fields.revenue, fields.cost, "", "", ""].map(quote).join(",");
  const result = analyzeHistoricalCsv(HEADER + line + "\n", { dateFormat: "iso", today: context.today, ratePerPointMinor: context.ratePerPointMinor });
  if (!result.ok) return { ok: false, message: result.message };
  const [row] = result.rows;
  if (!row || (row.kind !== "purchase" && row.kind !== "invalid")) {
    return { ok: false, message: row?.kind === "ad_expense" ? "That reads as an Instagram advertising expense, which is not an order." : "That row could not be read." };
  }
  // The row keeps its place in the file; its attachments are not part of a correction.
  return { ok: true, row: { ...toDbRow({ ...row, rowNumber }), attachments: [] } };
}
