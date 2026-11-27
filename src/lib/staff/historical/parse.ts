/**
 * Reads the Airtable export of historical WhatsApp purchases and says, row by row, what each row is and what is wrong with it.
 * Pure (no database, no clock: today's Qatar date is passed in), so every rule is unit-tested with synthetic CSV text.
 *
 * What it produces is a PROPOSAL. Nothing here saves anything. The result is sent to the database as a staged batch; the owner reviews it,
 * corrects or skips rows, confirms what the dates and amounts mean, and only then does the database commit it, again checking everything.
 *
 * Row kinds:
 *   purchase         a customer order with a date, a revenue and (usually) a cost.
 *   ad_expense       an Instagram advertising expense. Never an order: no revenue, no order count, no points. Reported separately.
 *   invalid_summary  a spreadsheet summary or error row with no customer data (for example Month = #ERROR!). Excluded.
 *   invalid          a row that looks like a purchase but cannot be trusted as it is. It blocks the import until corrected or skipped.
 */
import { CSV_LIMITS, parseCsv, type CsvRecord } from "./csv";
import {
  fingerprintOf,
  inferDateFormat,
  loyaltyPoints,
  normalizeName,
  normalizePhone,
  parseAttachments,
  parseDate,
  parseMoney,
  parseMonthLabel,
  purchaseCanonical,
  type AttachmentExt,
  type DateFormat,
  type YearMonthDay,
} from "./normalize";

export type Severity = "error" | "warning" | "info";
export interface Issue {
  code: string;
  severity: Severity;
  field?: string;
  message: string;
}
export type RowKind = "purchase" | "ad_expense" | "invalid_summary" | "invalid";

export interface AnalyzedAttachment {
  fileName: string;
  ext: AttachmentExt;
  ref: string | null;
  host: string | null;
  expiring: boolean;
}

export interface AnalyzedRow {
  rowNumber: number;
  kind: RowKind;
  customerName: string | null;
  nameKey: string;
  phone: string | null;
  phoneKey: string;
  /** ISO date (YYYY-MM-DD) as the export states it, read with the file's date order. */
  happenedOn: string | null;
  monthLabel: string | null;
  revenueMinor: number | null;
  costMinor: number | null;
  profitMinor: number | null;
  points: number;
  occurrence: number | null;
  fingerprint: string | null;
  attachments: AnalyzedAttachment[];
  issues: Issue[];
}

export interface AnalysisSummary {
  dataRows: number;
  purchases: number;
  validPurchases: number;
  invalidRows: number;
  adExpenseRows: number;
  adExpenseMinor: number;
  invalidSummaryRows: number;
  customers: number;
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
  points: number;
  lossOrders: number;
  attachmentRefs: number;
  attachmentPdf: number;
  attachmentPng: number;
  attachmentOther: number;
  ordersWithAttachments: number;
  years: number[];
}

export type AnalyzeResult =
  | {
      ok: true;
      rows: AnalyzedRow[];
      dateFormat: DateFormat | null;
      dateFormatReason: "iso_or_text" | "forced" | "month_column" | "ambiguous" | "mixed" | "owner_choice";
      summary: AnalysisSummary;
      notes: Issue[];
    }
  | { ok: false; code: string; message: string };

export interface AnalyzeOptions {
  /** How numeric dates are ordered, when the owner chose it; null or undefined to infer it from the file. */
  dateFormat?: DateFormat | null;
  today: YearMonthDay;
  /** QAR minor units per loyalty point (the current policy: 1000 = QAR 10 per point). */
  ratePerPointMinor: number;
}

const COLUMN_ALIASES: Record<string, readonly string[]> = {
  customer: ["customer", "customername", "name", "clientname", "client"],
  phone: ["phonenumber", "phone", "mobile", "mobilenumber", "whatsapp", "whatsappnumber", "tel"],
  date: ["date", "orderdate", "transactiondate", "saledate"],
  revenue: ["revenue", "income", "sales", "saleprice", "price"],
  cost: ["cost", "costs", "directcost", "expense"],
  profit: ["profit", "margin"],
  month: ["month"],
  receipt: ["receipt", "receipts", "attachments", "attachment", "invoice", "files"],
};
const REQUIRED: readonly string[] = ["customer", "date", "revenue", "cost"];
const SPREADSHEET_ERROR = /^#(ERROR!|REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/i;
const AD_NAME_KEY = /^instagram ads?( |$)/;

const issue = (code: string, severity: Severity, message: string, field?: string): Issue => ({ code, severity, message, ...(field ? { field } : {}) });
const headerKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const MONEY_MESSAGES: Record<string, string> = {
  empty: "is missing",
  format: "is not a valid amount",
  separator: "has a comma that could be a decimal comma; write it as 1234.50 or 1,234.50",
  decimals: "has more than two decimal places",
  range: "is outside the accepted range",
};
const DATE_MESSAGES: Record<string, string> = {
  empty: "is missing",
  format: "is not a date the importer can read",
  ambiguous: "could be day-month or month-day; choose the date order for this file",
  invalid: "is not a real calendar date",
  out_of_range: "is before 2020 or after 2100",
  future: "is in the future",
};
const NAME_MESSAGES: Record<string, string> = {
  empty: "is missing",
  too_long: "is longer than 120 characters",
  characters: "contains characters that do not belong in a name",
  control: "contains control or direction-changing characters",
};

/** Reads the whole export. Never throws: a problem is a returned result. */
export function analyzeHistoricalCsv(text: string, options: AnalyzeOptions): AnalyzeResult {
  const parsed = parseCsv(text, CSV_LIMITS);
  if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.message };

  // ---- columns ---------------------------------------------------------------------------------------------
  const index: Record<string, number> = {};
  const notes: Issue[] = [];
  const claimed = new Set<number>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = parsed.header.map((h, i) => ({ h: headerKey(h), i })).filter(({ h }) => aliases.includes(h));
    if (found.length > 1) return { ok: false, code: "duplicate_column", message: `The column "${field}" appears more than once in the header. Remove the duplicate and upload again.` };
    if (found.length === 1) {
      index[field] = found[0].i;
      claimed.add(found[0].i);
    }
  }
  const missing = REQUIRED.filter((f) => index[f] === undefined);
  if (missing.length > 0) {
    return { ok: false, code: "missing_columns", message: `The file has no column for: ${missing.join(", ")}. Expected: Customer, Phone Number, Date, Revenue, Cost, Profit, Month, Receipt.` };
  }
  for (const optional of ["phone", "profit", "month", "receipt"]) {
    if (index[optional] === undefined) notes.push(issue(`no_${optional}_column`, "info", `The file has no "${optional}" column; that information is treated as missing.`));
  }
  parsed.header.forEach((h, i) => {
    if (!claimed.has(i) && h !== "") notes.push(issue("ignored_column", "info", `The column "${h.slice(0, 40)}" is not part of the import and was ignored.`));
  });

  const cell = (record: CsvRecord, field: string): string => (index[field] === undefined ? "" : (record.cells[index[field]] ?? ""));

  // ---- the file's date order -----------------------------------------------------------------------------
  const records = parsed.records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const owner = options.dateFormat === "dmy" || options.dateFormat === "mdy" || options.dateFormat === "iso" ? options.dateFormat : null;
  const inferred = owner ? { format: owner, reason: "owner_choice" as const } : inferDateFormat(records.map((r) => cell(r, "date")), records.map((r) => (index.month === undefined ? undefined : cell(r, "month"))));
  const dateFormat = inferred.format;

  // ---- rows --------------------------------------------------------------------------------------------------
  const rows: AnalyzedRow[] = records.map((record) => analyzeRow(record, cell, dateFormat, options));

  // ---- identity: the same values twice are two purchases, numbered, so a reorder or a re-upload cannot change which is which ------
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "purchase" || row.happenedOn === null || row.revenueMinor === null) continue;
    const base = purchaseCanonical({ nameKey: row.nameKey, phoneKey: row.phoneKey, happenedOn: row.happenedOn, revenueMinor: row.revenueMinor, costMinor: row.costMinor }, 0);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    row.occurrence = occurrence;
    row.fingerprint = fingerprintOf(purchaseCanonical({ nameKey: row.nameKey, phoneKey: row.phoneKey, happenedOn: row.happenedOn, revenueMinor: row.revenueMinor, costMinor: row.costMinor }, occurrence));
    if (occurrence > 1) row.issues.push(issue("identical_purchase", "warning", "Another row has exactly the same customer, date, revenue and cost. Both are kept as separate purchases; skip one if it is a repeated line."));
  }

  return { ok: true, rows, dateFormat, dateFormatReason: inferred.reason, summary: summarize(rows), notes };
}

function analyzeRow(record: CsvRecord, cell: (r: CsvRecord, f: string) => string, dateFormat: DateFormat | null, options: AnalyzeOptions): AnalyzedRow {
  const row: AnalyzedRow = {
    rowNumber: record.rowNumber,
    kind: "purchase",
    customerName: null,
    nameKey: "",
    phone: null,
    phoneKey: "",
    happenedOn: null,
    monthLabel: null,
    revenueMinor: null,
    costMinor: null,
    profitMinor: null,
    points: 0,
    occurrence: null,
    fingerprint: null,
    attachments: [],
    issues: [],
  };
  const customerRaw = cell(record, "customer");
  const phoneRaw = cell(record, "phone");
  const dateRaw = cell(record, "date");
  const revenueRaw = cell(record, "revenue");
  const costRaw = cell(record, "cost");
  const profitRaw = cell(record, "profit");
  const monthRaw = cell(record, "month");
  const receiptRaw = cell(record, "receipt");
  const blank = (s: string) => s.trim() === "";

  const errorCell = record.cells.find((c) => SPREADSHEET_ERROR.test(c.trim()));
  if (errorCell !== undefined && [customerRaw, phoneRaw, dateRaw, revenueRaw, costRaw, profitRaw, receiptRaw].every(blank)) {
    row.kind = "invalid_summary";
    row.monthLabel = null;
    row.issues.push(issue("spreadsheet_error_row", "info", "A spreadsheet error or summary row with no customer data. It is excluded."));
    return row;
  }

  // ---- who ------------------------------------------------------------------------------------------------------
  const name = normalizeName(customerRaw);
  if (name.ok) {
    row.customerName = name.value;
    row.nameKey = name.key;
    if (name.neutralized) row.issues.push(issue("text_neutralized", "warning", "The name started with a character a spreadsheet would run as a formula; it was removed.", "customer"));
  } else {
    row.issues.push(issue(`name_${name.code}`, "error", `The customer name ${NAME_MESSAGES[name.code]}.`, "customer"));
  }
  const isAd = name.ok && AD_NAME_KEY.test(name.key);

  const phone = normalizePhone(phoneRaw);
  if (phone.kind === "ok") {
    row.phone = phone.e164;
    row.phoneKey = phone.key;
    if (phone.assumedQatar) row.issues.push(issue("phone_assumed_qatar", "info", "An 8-digit number was read as a Qatar number (+974).", "phone"));
  } else if (phone.kind === "invalid") {
    row.issues.push(issue("phone_invalid", "error", "The phone number cannot be read (check the digits and the country code), or clear it.", "phone"));
  } else if (!isAd) {
    row.issues.push(issue("phone_missing", "warning", "There is no phone number, so this customer cannot be matched with anyone else's records.", "phone"));
  }

  // ---- when -----------------------------------------------------------------------------------------------------
  const date = parseDate(dateRaw, dateFormat, options.today);
  if (date.ok) row.happenedOn = date.iso;
  else row.issues.push(issue(`date_${date.code}`, "error", `The date ${DATE_MESSAGES[date.code]}.`, "date"));

  // ---- how much ---------------------------------------------------------------------------------------------------
  const revenue = blank(revenueRaw) ? null : parseMoney(revenueRaw);
  if (revenue && revenue.ok) row.revenueMinor = revenue.minor;
  else if (revenue) row.issues.push(issue("revenue_invalid", "error", `The revenue ${MONEY_MESSAGES[revenue.code]}.`, "revenue"));
  const cost = blank(costRaw) ? null : parseMoney(costRaw);
  if (cost && cost.ok) row.costMinor = cost.minor;
  else if (cost) row.issues.push(issue("cost_invalid", "error", `The cost ${MONEY_MESSAGES[cost.code]}.`, "cost"));
  const profit = blank(profitRaw) ? null : parseMoney(profitRaw);
  if (profit && profit.ok) row.profitMinor = profit.minor;
  else if (profit) row.issues.push(issue("profit_invalid", "error", `The profit ${MONEY_MESSAGES[profit.code]}.`, "profit"));

  // ---- the month column is only a cross-check -------------------------------------------------------------------
  if (!blank(monthRaw)) {
    row.monthLabel = monthRaw.trim().slice(0, 40);
    const label = parseMonthLabel(monthRaw);
    if (SPREADSHEET_ERROR.test(monthRaw.trim())) row.issues.push(issue("spreadsheet_error_cell", "error", "The Month cell holds a spreadsheet error.", "month"));
    else if (!label) row.issues.push(issue("month_unreadable", "warning", "The Month column could not be read, so it was not used as a cross-check.", "month"));
    else if (row.happenedOn && (label.y !== Number(row.happenedOn.slice(0, 4)) || label.m !== Number(row.happenedOn.slice(5, 7)))) {
      row.issues.push(issue("month_mismatch", "warning", "The Month column names a different month from the date. The date is used.", "month"));
    }
  }
  for (const [value, field] of [[customerRaw, "customer"], [revenueRaw, "revenue"], [costRaw, "cost"], [dateRaw, "date"]] as const) {
    if (SPREADSHEET_ERROR.test(value.trim())) row.issues.push(issue("spreadsheet_error_cell", "error", `The ${field} cell holds a spreadsheet error.`, field));
  }

  // ---- advertising expenses are never orders --------------------------------------------------------------------
  if (isAd) {
    row.kind = "ad_expense";
    if (row.revenueMinor !== null && row.revenueMinor !== 0) row.issues.push(issue("ad_with_revenue", "error", "An Instagram advertising row has a revenue. It cannot be both an expense and an order.", "revenue"));
    if (row.costMinor === null) row.issues.push(issue("ad_without_cost", "error", "An Instagram advertising row has no cost.", "cost"));
    else if (row.costMinor < 0) row.issues.push(issue("cost_negative", "error", "A cost cannot be negative.", "cost"));
    if (row.issues.some((i) => i.severity === "error")) row.kind = "invalid";
    else row.issues.push(issue("ad_expense", "info", "An advertising expense, excluded from customer orders, revenue and points. It is reported separately."));
    return row;
  }

  // ---- a purchase ------------------------------------------------------------------------------------------------
  if (row.revenueMinor === null && revenue === null) row.issues.push(issue("revenue_missing", "error", "The revenue is missing.", "revenue"));
  if (row.revenueMinor !== null && row.revenueMinor <= 0) row.issues.push(issue("revenue_not_positive", "error", "The revenue must be more than zero.", "revenue"));
  if (row.costMinor !== null && row.costMinor < 0) row.issues.push(issue("cost_negative", "error", "A cost cannot be negative.", "cost"));
  if (row.costMinor === null && cost === null) row.issues.push(issue("cost_missing", "warning", "There is no cost, so this order will have no cost record and no profit (a missing cost is never counted as zero).", "cost"));
  if (row.revenueMinor !== null && row.costMinor !== null && row.profitMinor !== null && row.profitMinor !== row.revenueMinor - row.costMinor) {
    row.issues.push(issue("profit_mismatch", "error", "The profit is not revenue minus cost. Correct the revenue or the cost.", "profit"));
  }
  if (row.costMinor === null && row.profitMinor !== null) row.issues.push(issue("profit_without_cost", "warning", "A profit is given but no cost; the profit is ignored.", "profit"));
  if (row.revenueMinor !== null && row.costMinor !== null && row.costMinor > row.revenueMinor) {
    row.issues.push(issue("loss_recorded", "info", "A recorded loss. It is kept exactly as written."));
  }

  // ---- attachments -------------------------------------------------------------------------------------------------
  if (!blank(receiptRaw)) {
    const { items, unreadable } = parseAttachments(receiptRaw);
    row.attachments = items.map((a) => ({ fileName: a.fileName, ext: a.ext, ref: a.ref, host: a.host, expiring: a.expiring }));
    if (unreadable) row.issues.push(issue("attachment_unreadable", "warning", "The Receipt cell has text that is not a recognisable attachment reference. Upload the original files instead.", "receipt"));
    if (items.some((a) => a.expiring)) row.issues.push(issue("attachment_expiring", "info", "The export's attachment links are temporary and may already have expired. This does not mean the receipt never existed: upload the original file when you have it.", "receipt"));
    if (items.some((a) => a.problems.includes("unsupported_type"))) row.issues.push(issue("attachment_unsupported", "warning", "An attachment is not a PDF or a PNG; only those can be stored.", "receipt"));
    if (items.some((a) => a.ref === null)) row.issues.push(issue("attachment_ref_unusable", "info", "An attachment reference was not a plain https address and was not kept.", "receipt"));
  }

  if (row.issues.some((i) => i.severity === "error")) row.kind = "invalid";
  else row.points = loyaltyPoints(row.revenueMinor ?? 0, options.ratePerPointMinor);
  return row;
}

function summarize(rows: AnalyzedRow[]): AnalysisSummary {
  const valid = rows.filter((r) => r.kind === "purchase");
  const customers = new Set(valid.map((r) => `${r.nameKey}|${r.phoneKey}`));
  const attachments = valid.flatMap((r) => r.attachments);
  const years = new Set(valid.map((r) => Number((r.happenedOn ?? "0000").slice(0, 4))));
  return {
    dataRows: rows.length,
    purchases: rows.filter((r) => r.kind === "purchase" || (r.kind === "invalid" && !AD_NAME_KEY.test(r.nameKey))).length,
    validPurchases: valid.length,
    invalidRows: rows.filter((r) => r.kind === "invalid").length,
    adExpenseRows: rows.filter((r) => r.kind === "ad_expense").length,
    adExpenseMinor: rows.filter((r) => r.kind === "ad_expense").reduce((sum, r) => sum + (r.costMinor ?? 0), 0),
    invalidSummaryRows: rows.filter((r) => r.kind === "invalid_summary").length,
    customers: customers.size,
    revenueMinor: valid.reduce((sum, r) => sum + (r.revenueMinor ?? 0), 0),
    costMinor: valid.reduce((sum, r) => sum + (r.costMinor ?? 0), 0),
    profitMinor: valid.reduce((sum, r) => sum + (r.costMinor === null ? 0 : (r.revenueMinor ?? 0) - r.costMinor), 0),
    points: valid.reduce((sum, r) => sum + r.points, 0),
    lossOrders: valid.filter((r) => r.costMinor !== null && r.revenueMinor !== null && r.costMinor > r.revenueMinor).length,
    attachmentRefs: attachments.length,
    attachmentPdf: attachments.filter((a) => a.ext === "pdf").length,
    attachmentPng: attachments.filter((a) => a.ext === "png").length,
    attachmentOther: attachments.filter((a) => a.ext === "other").length,
    ordersWithAttachments: valid.filter((r) => r.attachments.length > 0).length,
    years: [...years].filter((y) => y > 0).sort(),
  };
}
