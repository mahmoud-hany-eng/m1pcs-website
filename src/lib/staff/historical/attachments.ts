/**
 * What may be stored as an attachment of a historical order, decided from the file's BYTES (never from its name or the type a browser claims).
 * Pure: no server code and no database. The server action runs inspectAttachment before sending anything to the database, and the database
 * checks the signature, size and SHA-256 again.
 *
 * Allowed: a PDF (a receipt or an invoice) and a PNG (a photo or a screenshot of one), up to 4 MB (the hosting platform refuses a request body above
 * 4.5 MB). A file that is empty, too big, of another type, damaged, or a PDF that carries active content (scripts, launch actions, embedded files)
 * is refused, and the person is told why.
 */
import { createHash } from "node:crypto";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export type AttachmentVerdict =
  | { ok: true; ext: "pdf" | "png"; mime: "application/pdf" | "image/png"; bytes: number; sha256: string }
  | { ok: false; code: "empty" | "too_big" | "type" | "corrupt" | "active_content"; message: string };

const REFUSALS = {
  empty: "That file is empty.",
  too_big: "That file is larger than 4 MB. Attach a smaller file.",
  type: "Only PDF and PNG files can be attached. This file is neither (its content was checked, not just its name).",
  corrupt: "That file looks damaged or incomplete, so it was not stored. Export or scan it again.",
  active_content: "That PDF contains active content (a script, a launch action or an embedded file), so it was not stored.",
} as const;
const refuse = (code: keyof typeof REFUSALS): AttachmentVerdict => ({ ok: false, code, message: REFUSALS[code] });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

export const isPdf = (b: Uint8Array): boolean => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
export const isPng = (b: Uint8Array): boolean => b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG is accepted when every chunk is whole and has a correct checksum, the first is a plausible IHDR and the last is IEND. */
function validPng(b: Uint8Array): boolean {
  if (b.length < 8 + 25 + 12) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 8;
  let first = true;
  let sawEnd = false;
  while (offset + 12 <= b.length) {
    const length = view.getUint32(offset);
    const typeStart = offset + 4;
    const dataEnd = typeStart + 4 + length;
    if (length > b.length || dataEnd + 4 > b.length) return false;
    const type = String.fromCharCode(b[typeStart], b[typeStart + 1], b[typeStart + 2], b[typeStart + 3]);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (view.getUint32(dataEnd) !== crc32(b, typeStart, dataEnd)) return false;
    if (first) {
      if (type !== "IHDR" || length !== 13) return false;
      const width = view.getUint32(typeStart + 4);
      const height = view.getUint32(typeStart + 8);
      if (width < 1 || height < 1 || width > 16384 || height > 16384) return false;
      first = false;
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  return sawEnd && offset === b.length && PNG_IEND.every((v, i) => b[b.length - 12 + i] === v);
}

const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm|ImportData)(?![A-Za-z])/;

export function inspectAttachment(bytes: Uint8Array): AttachmentVerdict {
  if (bytes.length === 0) return refuse("empty");
  if (bytes.length > MAX_ATTACHMENT_BYTES) return refuse("too_big");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (isPdf(bytes)) {
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    if (!text.slice(-2048).includes("%%EOF")) return refuse("corrupt");
    if (PDF_ACTIVE_CONTENT.test(text)) return refuse("active_content");
    return { ok: true, ext: "pdf", mime: "application/pdf", bytes: bytes.length, sha256 };
  }
  if (isPng(bytes)) {
    if (!validPng(bytes)) return refuse("corrupt");
    return { ok: true, ext: "png", mime: "image/png", bytes: bytes.length, sha256 };
  }
  return refuse("type");
}

/** The address of a stored attachment's file. Served only to the owner. */
export const attachmentHref = (id: string, opts: { download?: boolean } = {}): string => `/admin/import/files/${id}${opts.download ? "?download=1" : ""}`;
