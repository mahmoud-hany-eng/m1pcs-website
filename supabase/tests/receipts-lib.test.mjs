// The PDF-receipt rules that need no server and no database: what the browser answers before uploading, what the server decides from the bytes, the
// cleaned download header. LOCAL tests with plain inputs; what the database does with a receipt is proved in orders-overview.db.test.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

register("./support/alias-loader.mjs", import.meta.url);

let r = null;
let skip = false;
try {
  r = await import("../../src/lib/staff/receipts.ts");
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}

const bytes = (text) => new Uint8Array(Buffer.from(text, "latin1"));
const formWith = (file, extra = {}) => {
  const form = new FormData();
  if (file !== undefined) form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
};
const pdfFile = (name = "receipt.pdf", body = "%PDF-1.4\n%%EOF\n", type = "application/pdf") => new File([body], name, { type });

describe("PDF receipts: the rules", { skip }, () => {
  test("the limits are 4 MB and 10 receipts, and a 4 MB file leaves room under the platform's 4.5 MB request limit", () => {
    assert.equal(r.MAX_RECEIPT_BYTES, 4 * 1024 * 1024);
    assert.equal(r.MAX_RECEIPTS_PER_ORDER, 10);
    assert.ok(r.MAX_RECEIPT_BYTES + 100_000 < 4_500_000 + 250_000, "the form's own overhead fits");
  });

  test("a PDF is recognised by its first five bytes, not by its name or declared type", () => {
    assert.equal(r.isPdfBytes(bytes("%PDF-1.7\n")), true);
    assert.equal(r.isPdfBytes(bytes("%PDF-")), true);
    for (const bad of ["%PDF", "%PDF1.4", "%PDFx", "%pdf-1.4", " %PDF-1.4", "PK\x03\x04", "<html>", "MZ", ""]) assert.equal(r.isPdfBytes(bytes(bad)), false, JSON.stringify(bad));
  });

  test("the browser's quick answer: a PDF name or type passes; another type, an empty file and a file over 4 MB are answered before anything is sent", () => {
    assert.equal(r.checkReceiptChoice({ name: "a.pdf", size: 10, type: "application/pdf" }), null);
    assert.equal(r.checkReceiptChoice({ name: "A.PDF", size: 10, type: "" }), null, "a dropped file may carry no type: the name is enough here");
    assert.equal(r.checkReceiptChoice({ name: "receipt", size: 10, type: "application/pdf" }), null);
    assert.equal(r.checkReceiptChoice({ name: "photo.png", size: 10, type: "image/png" }), r.FILE_NOT_A_PDF);
    assert.equal(r.checkReceiptChoice({ name: "a.pdf", size: 0 }), r.FILE_IS_EMPTY);
    assert.equal(r.checkReceiptChoice({ name: "a.pdf", size: r.MAX_RECEIPT_BYTES }), null);
    assert.equal(r.checkReceiptChoice({ name: "a.pdf", size: r.MAX_RECEIPT_BYTES + 1 }), r.FILE_TOO_BIG);
    assert.equal(r.checkReceiptChoice(null), r.CHOOSE_A_PDF);
    assert.equal(r.checkReceiptChoice(undefined), r.CHOOSE_A_PDF);
  });

  test("the server's reading of an upload: a real PDF is accepted whatever the browser claimed; a renamed file, an empty file, a missing field and a text field are refused", async () => {
    const ok = await r.parseReceiptUpload(formWith(pdfFile("Fawran.pdf")));
    assert.equal(ok.ok, true);
    assert.equal(ok.name, "Fawran.pdf");
    assert.equal(r.isPdfBytes(ok.bytes), true);
    assert.equal((await r.parseReceiptUpload(formWith(pdfFile("noext", "%PDF-1.4", "application/octet-stream")))).ok, true, "the bytes decide, not the name or the declared type");
    assert.deepEqual(await r.parseReceiptUpload(formWith(pdfFile("fake.pdf", "just text, renamed", "application/pdf"))), { ok: false, message: r.FILE_NOT_A_PDF });
    assert.deepEqual(await r.parseReceiptUpload(formWith(pdfFile("empty.pdf", ""))), { ok: false, message: r.FILE_IS_EMPTY });
    assert.deepEqual(await r.parseReceiptUpload(formWith(undefined)), { ok: false, message: r.CHOOSE_A_PDF });
    assert.deepEqual(await r.parseReceiptUpload(formWith("not a file, a text field")), { ok: false, message: r.CHOOSE_A_PDF });
    const big = new File([new Uint8Array(r.MAX_RECEIPT_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    assert.deepEqual(await r.parseReceiptUpload(formWith(big)), { ok: false, message: r.FILE_TOO_BIG });
    const exact = new File([new Uint8Array(r.MAX_RECEIPT_BYTES).fill(0x20)], "exact.pdf");
    assert.equal((await r.parseReceiptUpload(formWith(new File([Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(r.MAX_RECEIPT_BYTES - 5, 0x20)])], "exact.pdf")))).ok, true, "exactly 4 MB is accepted");
    assert.equal(exact.size, r.MAX_RECEIPT_BYTES);
  });

  test("the removal reason is 3 to 300 characters, trimmed", () => {
    const f = (reason) => r.parseReceiptReason(formWith(undefined, reason === undefined ? {} : { reason }));
    assert.deepEqual(f("  attached to the wrong order  "), { ok: true, value: "attached to the wrong order" });
    assert.equal(f("abc").ok, true);
    assert.equal(f("x".repeat(300)).ok, true);
    for (const bad of ["", "  ", "ab", "x".repeat(301), undefined]) {
      const result = f(bad);
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.match(result.errors.reason, /3 to 300 characters/);
    }
  });

  test("sizes read like people write them", () => {
    assert.equal(r.formatFileSize(0), "0 B");
    assert.equal(r.formatFileSize(812), "812 B");
    assert.equal(r.formatFileSize(1024), "1 KB");
    assert.equal(r.formatFileSize(186_368), "182 KB");
    assert.equal(r.formatFileSize(1_258_291), "1.2 MB");
    assert.equal(r.formatFileSize(4 * 1024 * 1024), "4.0 MB");
    assert.equal(r.formatFileSize(-1), "");
    assert.equal(r.formatFileSize(Number.NaN), "");
  });

  test("the file's address: opens in the browser, or downloads", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    assert.equal(r.receiptHref(id), `/admin/receipts/${id}`);
    assert.equal(r.receiptHref(id, { download: true }), `/admin/receipts/${id}?download=1`);
  });

  test("the download header carries a safe ASCII fallback and the exact name in the standard encoded form; inline or attachment", () => {
    assert.equal(r.contentDispositionFor("Receipt 7.pdf", false), `inline; filename="Receipt 7.pdf"; filename*=UTF-8''Receipt%207.pdf`);
    assert.equal(r.contentDispositionFor("Receipt 7.pdf", true), `attachment; filename="Receipt 7.pdf"; filename*=UTF-8''Receipt%207.pdf`);
    const arabic = r.contentDispositionFor("إيصال الدفع.pdf", true);
    assert.match(arabic, /^attachment; filename="_+ _+\.pdf"; filename\*=UTF-8''%D8%A5/);
    // Nothing in a name can end the quoted value or add a parameter.
    const hostile = r.contentDispositionFor('a"; filename="evil.exe', false);
    assert.equal((hostile.match(/"/g) ?? []).length, 2, "no quote survives inside the fallback");
    assert.doesNotMatch(hostile.split("filename*=")[0], /;\s*filename="evil/);
    assert.doesNotMatch(r.contentDispositionFor("a\r\nSet-Cookie: x=1.pdf", false), /[\r\n]/);
  });
});
