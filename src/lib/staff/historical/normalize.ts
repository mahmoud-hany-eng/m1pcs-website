/**
 * The cleaning and checking rules for one cell of the historical export. Pure functions on strings, unit-tested with plain inputs; nothing here
 * touches a database, a network or the clock (the caller passes today's Qatar date in).
 *
 * Principles, in the order they matter:
 *   1. A cell is DATA, never an instruction. A leading = + - @ tab or carriage return could make a spreadsheet run it as a formula; text that
 *      starts that way is cleaned and the person is told. Numbers and dates that do not parse as exactly what they should be are refused, not
 *      guessed at.
 *   2. Nothing is invented. A missing phone stays missing, a missing cost stays unknown (never zero), an ambiguous date is not resolved by guessing.
 *   3. Money is whole minor units (1 QAR = 100). No floating point is ever used on an amount.
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic and Eastern Arabic-Indic digits become 0-9; everything else is unchanged. */
export function toAsciiDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const a = ARABIC_INDIC.indexOf(ch);
    const b = EXT_ARABIC_INDIC.indexOf(ch);
    out += a >= 0 ? String(a) : b >= 0 ? String(b) : ch;
  }
  return out;
}

/** Trims and collapses every run of white space (including non-breaking and zero-width spaces) to one space. */
export function collapseSpaces(text: string): string {
  return text.replace(/[\s ​-‍⁠﻿]+/g, " ").trim();
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/;
const FORMULA_TRIGGERS = /^[=+\-@\t\r|%]+/;

export interface CleanText {
  value: string;
  /** True when a leading formula trigger was removed. */
  neutralized: boolean;
}

/**
 * Removes the characters a spreadsheet would treat as the start of a formula (= + - @ tab carriage-return, and the | and % used by DDE
 * payloads) from the FRONT of a text cell. Used for names and file names, never for numbers (a "-" is a sign there).
 */
export function neutralizeFormula(text: string): CleanText {
  const trimmed = collapseSpaces(text);
  const cleaned = trimmed.replace(FORMULA_TRIGGERS, "").replace(/^\s+/, "");
  return { value: cleaned, neutralized: cleaned !== trimmed };
}

export type NameResult =
  | { ok: true; value: string; key: string; neutralized: boolean }
  | { ok: false; code: "empty" | "too_long" | "characters" | "control" };

/** Letters and marks of any script, digits, space and the few punctuation marks real names and business names use. */
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .'’\-,&()/]+$/u;

/** Folds a name so that spelling variants of the same name compare equal: case, accents, Arabic marks and letter forms, punctuation, spacing. */
export function nameKey(display: string): string {
  return display
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ̀-ͯ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A customer's name as it will be stored: cleaned, never rewritten. Refuses control characters and characters that have no place in a name. */
export function normalizeName(raw: string): NameResult {
  if (BIDI_CONTROLS.test(raw) || CONTROL_CHARS.test(raw.replace(/[\t\r\n]/g, " "))) return { ok: false, code: "control" };
  const { value, neutralized } = neutralizeFormula(raw.normalize("NFC"));
  if (value === "") return { ok: false, code: "empty" };
  if (value.length > 120) return { ok: false, code: "too_long" };
  if (!NAME_CHARS.test(value)) return { ok: false, code: "characters" };
  const key = nameKey(value);
  if (key === "") return { ok: false, code: "empty" };
  return { ok: true, value, key, neutralized };
}

// ---------------------------------------------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------------------------------------------

export type PhoneResult =
  | { kind: "empty" }
  | { kind: "ok"; key: string; e164: string; assumedQatar: boolean }
  | { kind: "invalid"; code: "characters" | "length" };

/**
 * The matching key of a phone number: its digits with the country code, no plus. Eight digits are a Qatar local number (974 is added); 00 and +
 * mean "country code follows". Nothing else is guessed. The SQL function private.hist_phone_key applies the same rules (a test compares them).
 */
export function normalizePhone(raw: string): PhoneResult {
  const trimmed = toAsciiDigits(collapseSpaces(raw));
  if (trimmed === "") return { kind: "empty" };
  if (!/^\+?[0-9 ()\-.]+$/.test(trimmed)) return { kind: "invalid", code: "characters" };
  let digits = trimmed.replace(/\D/g, "");
  let international = trimmed.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }
  let assumedQatar = false;
  if (!international && digits.length === 8) {
    digits = `974${digits}`;
    assumedQatar = true;
  }
  if (digits.length < 7 || digits.length > 15) return { kind: "invalid", code: "length" };
  if (digits.startsWith("974") && digits.length !== 11) return { kind: "invalid", code: "length" };
  return { kind: "ok", key: digits, e164: `+${digits}`, assumedQatar };
}

// ---------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------

export type MoneyResult = { ok: true; minor: number } | { ok: false; code: "empty" | "format" | "separator" | "decimals" | "range" };

/** The largest amount accepted in one cell: QAR 100,000,000. A bigger number in an order export is a typing or spreadsheet error. */
export const MAX_MINOR = 100_000_000 * 100;

const CURRENCY_PREFIX = /^(qar|qr|ر\.\s?ق|ريال)\s*/i;
const CURRENCY_SUFFIX = /\s*(qar|qr|ر\.\s?ق|ريال)$/i;

/**
 * "QAR 1,234.50", "1234.5", "-QAR 100", "QAR -100.00", "(100.00)", "١٢٣٤" -> integer minor units. A comma is a thousands separator only when
 * it sits between groups of three digits; anything else ("12,50") is refused because it could be a decimal comma. More than two decimals
 * are refused unless the extra digits are zeros. Scientific notation, text and formulas are refused.
 */
export function parseMoney(raw: string): MoneyResult {
  let s = toAsciiDigits(collapseSpaces(raw)).replace(/[−–—]/g, "-");
  if (s === "") return { ok: false, code: "empty" };
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  for (let guard = 0; guard < 4; guard += 1) {
    const before = s;
    if (s.startsWith("-")) {
      negative = !negative;
      s = s.slice(1).trim();
    } else if (s.startsWith("+")) {
      s = s.slice(1).trim();
    }
    s = s.replace(CURRENCY_PREFIX, "").replace(CURRENCY_SUFFIX, "").trim();
    if (s === before) break;
  }
  s = s.replace(/٬/g, ",").replace(/٫/g, ".");
  if (!/^[0-9][0-9,.]*$/.test(s)) return { ok: false, code: "format" };
  const hasComma = s.includes(",");
  if (hasComma ? !/^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$/.test(s) : !/^[0-9]+(\.[0-9]+)?$/.test(s)) {
    return { ok: false, code: hasComma ? "separator" : "format" };
  }
  const [whole, fraction = ""] = s.replace(/,/g, "").split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return { ok: false, code: "decimals" };
  const cents = Number((fraction + "00").slice(0, 2));
  if (whole.length > 12) return { ok: false, code: "range" };
  const minor = Number(whole) * 100 + cents;
  if (minor > MAX_MINOR) return { ok: false, code: "range" };
  return { ok: true, minor: negative ? -minor : minor };
}

/** floor(minor / ratePerPointMinor): one point per QAR 10 at the current policy (rate 1000). Never negative, never fractional. */
export function loyaltyPoints(revenueMinor: number, ratePerPointMinor: number): number {
  if (!Number.isInteger(revenueMinor) || revenueMinor <= 0 || !Number.isInteger(ratePerPointMinor) || ratePerPointMinor < 1) return 0;
  return Math.floor(revenueMinor / ratePerPointMinor);
}

// ---------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------

export type DateFormat = "iso" | "dmy" | "mdy";
export interface YearMonthDay {
  y: number;
  m: number;
  d: number;
}
export type DateResult = ({ ok: true; iso: string } & YearMonthDay) | { ok: false; code: "empty" | "format" | "ambiguous" | "invalid" | "out_of_range" | "future" };

/** The earliest year the platform's reports and cost records accept. */
export const MIN_YEAR = 2020;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
const isoOf = ({ y, m, d }: YearMonthDay): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function validCalendarDate({ y, m, d }: YearMonthDay): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The date in Qatar (UTC+3, no daylight saving) of an instant given as an ISO date-time with an offset. */
function qatarDateOf(instantMs: number): YearMonthDay {
  const local = new Date(instantMs + 3 * 3600 * 1000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

function finish(parts: YearMonthDay, today: YearMonthDay): DateResult {
  if (!validCalendarDate(parts)) return { ok: false, code: "invalid" };
  if (parts.y < MIN_YEAR || parts.y > 2100) return { ok: false, code: "out_of_range" };
  if (isoOf(parts) > isoOf(today)) return { ok: false, code: "future" };
  return { ok: true, iso: isoOf(parts), ...parts };
}

/**
 * Reads one date cell. `format` says how a numeric date with slashes, dashes or dots is ordered (day-month-year or month-day-year); with `null`
 * such a date is accepted only when one part is above 12 (so the order is certain). ISO dates (2025-03-14), written months (14 Mar 2025,
 * March 14, 2025) and ISO date-times need no format. A date-time with a zone is converted to its date in Qatar; one without is taken as written.
 * A date that is in the future in Qatar, before 2020 or not on the calendar is refused.
 */
export function parseDate(raw: string, format: DateFormat | null, today: YearMonthDay): DateResult {
  const s = toAsciiDigits(collapseSpaces(raw));
  if (s === "") return { ok: false, code: "empty" };

  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const [, y, mo, d, hh, mi, ss = "0", zone] = m;
    const parts = { y: Number(y), m: Number(mo), d: Number(d) };
    if (!validCalendarDate(parts) || Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) return { ok: false, code: "invalid" };
    if (!zone) return finish(parts, today);
    const offset = zone.toUpperCase() === "Z" ? 0 : (zone.startsWith("-") ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    const instant = Date.UTC(parts.y, parts.m - 1, parts.d, Number(hh), Number(mi), Number(ss)) - offset * 60_000;
    return finish(qatarDateOf(instant), today);
  }

  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return finish({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, today);

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    let order: "dmy" | "mdy" | null = format === "dmy" || format === "mdy" ? format : null;
    if (order === null) {
      if (a > 12 && b <= 12) order = "dmy";
      else if (b > 12 && a <= 12) order = "mdy";
      else if (a > 12 && b > 12) return { ok: false, code: "invalid" };
      else if (a === b) order = "dmy"; // 05/05/2025 reads the same either way
      else return { ok: false, code: "ambiguous" };
    }
    return finish(order === "dmy" ? { y, m: b, d: a } : { y, m: a, d: b }, today);
  }

  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTH_NAMES[m[2].toLowerCase()];
    return month ? finish({ y: Number(m[3]), m: month, d: Number(m[1]) }, today) : { ok: false, code: "format" };
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    return month ? finish({ y: Number(m[3]), m: month, d: Number(m[2]) }, today) : { ok: false, code: "format" };
  }
  return { ok: false, code: "format" };
}

/** "March 2025", "Mar 2025", "2025-03", "03/2025" -> year and month, or null when the cell says something else (an error value, text). */
export function parseMonthLabel(raw: string): { y: number; m: number } | null {
  const s = toAsciiDigits(collapseSpaces(raw));
  let m = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTH_NAMES[m[1].toLowerCase()]) return { y: Number(m[2]), m: MONTH_NAMES[m[1].toLowerCase()] };
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { y: Number(m[1]), m: Number(m[2]) };
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { y: Number(m[2]), m: Number(m[1]) };
  return null;
}

/**
 * Which order the numeric dates of a whole file use. A file is read with ONE order, chosen once: a date above 12 in the first or second place
 * settles it, a file that settles both ways is refused (mixed), and a file that settles neither is decided only if the Month column agrees with
 * exactly one reading. Anything else is "ambiguous" and the owner must choose.
 */
export function inferDateFormat(
  dates: readonly string[],
  months: readonly (string | undefined)[] = [],
): { format: DateFormat | null; reason: "iso_or_text" | "forced" | "month_column" | "ambiguous" | "mixed" } {
  let dmyForced = false;
  let mdyForced = false;
  let numeric = 0;
  const undecided: number[] = [];
  dates.forEach((raw, index) => {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(toAsciiDigits(collapseSpaces(raw)));
    if (!m) return;
    numeric += 1;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmyForced = true;
    else if (b > 12 && a <= 12) mdyForced = true;
    else if (a !== b) undecided.push(index);
  });
  if (numeric === 0) return { format: null, reason: "iso_or_text" };
  if (dmyForced && mdyForced) return { format: null, reason: "mixed" };
  if (dmyForced) return { format: "dmy", reason: "forced" };
  if (mdyForced) return { format: "mdy", reason: "forced" };
  if (undecided.length === 0) return { format: "dmy", reason: "forced" };
  let dmyAgrees = 0;
  let mdyAgrees = 0;
  for (const index of undecided) {
    const label = months[index] === undefined ? null : parseMonthLabel(months[index] as string);
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(toAsciiDigits(collapseSpaces(dates[index])));
    if (!label || !m) continue;
    if (label.y === Number(m[3]) && label.m === Number(m[2])) dmyAgrees += 1;
    if (label.y === Number(m[3]) && label.m === Number(m[1])) mdyAgrees += 1;
  }
  if (dmyAgrees > 0 && mdyAgrees === 0) return { format: "dmy", reason: "month_column" };
  if (mdyAgrees > 0 && dmyAgrees === 0) return { format: "mdy", reason: "month_column" };
  return { format: null, reason: "ambiguous" };
}

/** The moment stored for a date-only historical completion: 12:00 in Qatar (09:00 UTC), so no timezone conversion can move it to another day or month. */
export const qatarNoonOf = (isoDate: string): string => `${isoDate}T12:00:00+03:00`;

// ---------------------------------------------------------------------------------------------------------------
// Attachment references
// ---------------------------------------------------------------------------------------------------------------

export type AttachmentExt = "pdf" | "png" | "other";
export interface AttachmentRef {
  fileName: string;
  ext: AttachmentExt;
  /** The https reference from the export, or null when it was not a plain https address. Never fetched by the importer. */
  ref: string | null;
  host: string | null;
  /** True for hosts and links that are known to stop working (the export's temporary download links). */
  expiring: boolean;
  problems: ("insecure_scheme" | "credentials" | "too_long" | "bad_url" | "name_cleaned" | "unsupported_type")[];
}

const EXPIRING_HOSTS = /(^|\.)(airtableusercontent\.com|airtable\.com)$/i;

/** A file name safe to store and to show: no path, no control or direction character, no characters a file system or a spreadsheet treats specially. */
export function cleanFileName(raw: string): { name: string; changed: boolean } {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  let name = collapseSpaces(base.replace(CONTROL_CHARS, "").replace(BIDI_CONTROLS, "")).replace(/[:*?"<>|]/g, "_");
  name = name.replace(FORMULA_TRIGGERS, "").replace(/^\.+/, "").trim();
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    name = dot > 0 && name.length - dot <= 6 ? name.slice(0, 120 - (name.length - dot)) + name.slice(dot) : name.slice(0, 120);
  }
  return { name, changed: name !== base };
}

function extOf(name: string): AttachmentExt {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ext === "pdf" ? "pdf" : ext === "png" ? "png" : "other";
}

/**
 * Reads the "Receipt" cell of the export: "name.pdf (https://...), photo.png (https://...)". The references are recorded, never opened: the
 * importer does not fetch anything (an export's links are temporary, and fetching a person-supplied address from the server would be a risk).
 */
export function parseAttachments(raw: string): { items: AttachmentRef[]; unreadable: boolean } {
  const text = collapseSpaces(raw);
  if (text === "") return { items: [], unreadable: false };
  const found: { name: string; url: string }[] = [];
  const pair = /([^,()]*?)\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
  let consumed = 0;
  for (let m = pair.exec(text); m; m = pair.exec(text)) {
    found.push({ name: m[1].replace(/^[\s,;]+/, ""), url: m[2] });
    consumed += m[0].length;
  }
  if (found.length === 0) {
    for (const m of text.matchAll(/https?:\/\/[^\s,)]+/gi)) found.push({ name: "", url: m[0] });
  }
  const seen = new Set<string>();
  const items: AttachmentRef[] = [];
  for (const entry of found) {
    const problems: AttachmentRef["problems"] = [];
    let ref: string | null = null;
    let host: string | null = null;
    let expiring = false;
    try {
      const u = new URL(entry.url);
      host = u.hostname.toLowerCase();
      if (u.protocol !== "https:") problems.push("insecure_scheme");
      else if (u.username || u.password) problems.push("credentials");
      else if (entry.url.length > 2000) problems.push("too_long");
      else ref = u.toString();
      expiring = EXPIRING_HOSTS.test(host) || /[?&](x-amz-expires|expires)=/i.test(entry.url);
      if (entry.name === "") entry.name = decodeURIComponent(u.pathname.split("/").pop() ?? "").slice(0, 200);
    } catch {
      problems.push("bad_url");
    }
    const cleaned = cleanFileName(entry.name === "" ? "attachment" : entry.name);
    if (cleaned.changed) problems.push("name_cleaned");
    const ext = extOf(cleaned.name);
    if (ext === "other") problems.push("unsupported_type");
    const key = `${cleaned.name}|${ref ?? entry.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ fileName: cleaned.name === "" ? "attachment" : cleaned.name, ext, ref, host, expiring, problems });
  }
  return { items, unreadable: consumed === 0 && items.length === 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Identity of a purchase (what makes a re-upload recognisable)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The text a purchase is identified by. It uses ONLY what the export says (who, when, how much, what it cost) so a re-upload, a re-ordering of
 * the rows or a different file name cannot change it. `occurrence` is 1 for the first row with these exact values, 2 for the second, so two
 * genuinely identical purchases are two purchases, and which of them is which never matters (they are interchangeable).
 */
export function purchaseCanonical(p: { nameKey: string; phoneKey: string; happenedOn: string; revenueMinor: number; costMinor: number | null }, occurrence: number): string {
  return ["v1", p.nameKey, p.phoneKey, p.happenedOn, String(p.revenueMinor), p.costMinor === null ? "-" : String(p.costMinor), String(occurrence)].join("|");
}

export const fingerprintOf = (canonical: string): string => createHash("sha256").update(canonical, "utf8").digest("hex");
