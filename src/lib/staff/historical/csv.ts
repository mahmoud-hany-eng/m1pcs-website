/**
 * A small, strict CSV reader for the historical-orders import (RFC 4180: quoted fields, doubled quotes, embedded line breaks, CRLF).
 * Pure: no server code and no database, so the rules are unit-tested with plain strings.
 *
 * It never interprets a cell. A cell that looks like a formula is just text here; what to do about it is decided in normalize.ts. The reader only
 * refuses input that is clearly not a CSV the importer can trust: binary data, an unterminated quote, too many bytes, rows or columns.
 */

export const CSV_LIMITS = {
  /** The file as uploaded. The real export is a few kilobytes; this leaves room for years of orders and refuses anything absurd. */
  maxBytes: 512 * 1024,
  maxRows: 2000,
  maxColumns: 32,
  maxFieldChars: 4000,
} as const;

export interface CsvRecord {
  /** The spreadsheet row number: the header is row 1, the first data row is row 2. A cell with a line break does not shift later rows. */
  rowNumber: number;
  cells: string[];
}

export type CsvResult =
  | { ok: true; header: string[]; records: CsvRecord[]; delimiter: "," | ";" | "\t" }
  | { ok: false; code: CsvErrorCode; message: string };

export type CsvErrorCode = "empty" | "too_big" | "not_text" | "unterminated_quote" | "too_many_rows" | "too_many_columns" | "field_too_long" | "no_header";

const MESSAGES: Record<CsvErrorCode, string> = {
  empty: "The file is empty.",
  too_big: "The file is larger than 512 KB. A historical export should be far smaller; check that it is the right file.",
  not_text: "The file is not a text CSV (it contains binary data or is not UTF-8). Export it again as CSV (UTF-8).",
  unterminated_quote: "A quoted value is never closed, so the file cannot be read reliably. Check the export.",
  too_many_rows: "The file has more than 2,000 data rows. Split it into smaller files.",
  too_many_columns: "A row has more than 32 columns, which is not the expected export.",
  field_too_long: "A value is longer than 4,000 characters, which is not the expected export.",
  no_header: "The file has no header row.",
};
const fail = (code: CsvErrorCode): CsvResult => ({ ok: false, code, message: MESSAGES[code] });

/** Decodes uploaded bytes as strict UTF-8. Returns null when they are not valid UTF-8 or contain a NUL byte (binary data). */
export function decodeCsvBytes(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** The delimiter the header line uses: the most frequent of comma, semicolon and tab outside quotes (a comma when nothing is found). */
function detectDelimiter(text: string): "," | ";" | "\t" {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  if (counts[","] >= counts[";"] && counts[","] >= counts["\t"]) return ",";
  return counts[";"] >= counts["\t"] ? ";" : "\t";
}

/** Reads the text of a CSV. Completely blank lines are skipped and do not count as rows. */
export function parseCsv(input: string, limits: typeof CSV_LIMITS = CSV_LIMITS): CsvResult {
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return fail("empty");
  if (text.length > limits.maxBytes) return fail("too_big");
  // A replacement character means the decoder met bytes that are not UTF-8; control characters other than tab and line breaks are never in a real export.
  if (/�/.test(text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return fail("not_text");

  const delimiter = detectDelimiter(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let row = 1;
  let i = 0;

  const endField = (): CsvErrorCode | null => {
    if (field.length > limits.maxFieldChars) return "field_too_long";
    cells.push(field);
    field = "";
    fieldWasQuoted = false;
    if (cells.length > limits.maxColumns) return "too_many_columns";
    return null;
  };
  const endRecord = (): CsvErrorCode | null => {
    const wasQuoted = fieldWasQuoted;
    const problem = endField();
    if (problem) return problem;
    // A completely blank line is skipped, but it still counts as a row so that "row 9" is the row a spreadsheet shows as 9.
    const blank = cells.length === 1 && cells[0].trim() === "" && !wasQuoted;
    if (!blank) {
      records.push({ rowNumber: row, cells });
      if (records.length > limits.maxRows + 1) return "too_many_rows";
    }
    row += 1;
    cells = [];
    return null;
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      fieldWasQuoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      const problem = endField();
      if (problem) return fail(problem);
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      const problem = endRecord();
      if (problem) return fail(problem);
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) return fail("unterminated_quote");
  if (field !== "" || cells.length > 0) {
    const problem = endRecord();
    if (problem) return fail(problem);
  }

  if (records.length === 0) return fail("no_header");
  const [head, ...data] = records;
  if (data.length > limits.maxRows) return fail("too_many_rows");
  return { ok: true, header: head.cells.map((c) => c.trim()), records: data, delimiter };
}
