/**
 * The rules for PDF receipts on an order. Pure: no server code and no database, so the browser (which answers BEFORE uploading, to save a slow
 * round trip) and the server action (which DECIDES, whatever the browser did) use the same rules, and both are unit-tested here.
 *
 * What a receipt is: a PDF (it starts with "%PDF-"), up to 4 MB (the platform refuses a request body above 4.5 MB, and the form adds a little), at
 * most 10 active receipts per order, the same file not twice on one order. The database enforces every one of these again.
 */
import type { StaffFieldErrors } from "./form-state";

export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
export const MAX_RECEIPTS_PER_ORDER = 10;
export const RECEIPT_REASON_MIN = 3;
export const RECEIPT_REASON_MAX = 300;

export const CHOOSE_A_PDF = "Choose a PDF file first.";
export const FILE_IS_EMPTY = "That file is empty. Choose the PDF receipt.";
export const FILE_NOT_A_PDF = "That file is not a PDF. Attach the receipt as a PDF.";
export const FILE_TOO_BIG = "That file is larger than 4 MB. Attach a smaller PDF.";

/** The address of a receipt's file: opens in the browser, or downloads. Served only to staff with payments.read. */
export const receiptHref = (id: string, opts: { download?: boolean } = {}): string => `/admin/receipts/${id}${opts.download ? "?download=1" : ""}`;

/** "812 B", "182 KB", "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when the bytes start with the PDF signature. A file's name or declared type proves nothing; this does. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * The browser's quick answer about a chosen or dropped file, before anything is sent. Not a security check: a browser may report no type for a
 * dropped file, so a .pdf name is enough here, and the server looks at the bytes.
 */
export function checkReceiptChoice(file: { name: string; size: number; type?: string } | null | undefined): string | null {
  if (!file) return CHOOSE_A_PDF;
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) return FILE_NOT_A_PDF;
  if (file.size <= 0) return FILE_IS_EMPTY;
  if (file.size > MAX_RECEIPT_BYTES) return FILE_TOO_BIG;
  return null;
}

export type ReceiptUpload = { ok: true; name: string; bytes: Uint8Array } | { ok: false; message: string };

/** The server's reading of an upload form: a real, non-empty PDF within the limit. The bytes are checked, not the name or the declared type. */
export async function parseReceiptUpload(form: FormData, field = "file"): Promise<ReceiptUpload> {
  const value = form.get(field) as unknown;
  const file = value as { name?: unknown; size?: unknown; arrayBuffer?: unknown } | null;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function" || typeof file.size !== "number") return { ok: false, message: CHOOSE_A_PDF };
  if (file.size === 0) return { ok: false, message: FILE_IS_EMPTY };
  if (file.size > MAX_RECEIPT_BYTES) return { ok: false, message: FILE_TOO_BIG };
  const bytes = new Uint8Array(await (file as unknown as Blob).arrayBuffer());
  if (bytes.length === 0) return { ok: false, message: FILE_IS_EMPTY };
  if (bytes.length > MAX_RECEIPT_BYTES) return { ok: false, message: FILE_TOO_BIG };
  if (!isPdfBytes(bytes)) return { ok: false, message: FILE_NOT_A_PDF };
  return { ok: true, name: typeof file.name === "string" && file.name.trim() ? file.name.slice(0, 300) : "receipt.pdf", bytes };
}

/** Why a receipt is being removed: 3 to 300 characters (kept with the record). */
export function parseReceiptReason(form: FormData, field = "reason"): { ok: true; value: string } | { ok: false; errors: StaffFieldErrors } {
  const raw = form.get(field);
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < RECEIPT_REASON_MIN || reason.length > RECEIPT_REASON_MAX) {
    return { ok: false, errors: { [field]: `Give a reason of ${RECEIPT_REASON_MIN} to ${RECEIPT_REASON_MAX} characters.` } };
  }
  return { ok: true, value: reason };
}

/** The Content-Disposition header for a file name that may hold any letters: an ASCII fallback plus the exact name in the standard encoded form. */
export function contentDispositionFor(fileName: string, download: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
