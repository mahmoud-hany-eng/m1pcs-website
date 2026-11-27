// The historical-orders importer's pure rules: CSV reading, cleaning of names, phones, money and dates, protection against formula and markup
// injection, the identity of a purchase, the attachment checks, and the whole synthetic export (36 rows) analysed end to end.
// LOCAL tests with plain inputs and SYNTHETIC data only. What the database does with a staged batch is proved in historical.db.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

register("./support/alias-loader.mjs", import.meta.url);

let m = null;
let skip = false;
try {
  m = {
    csv: await import("../../src/lib/staff/historical/csv.ts"),
    n: await import("../../src/lib/staff/historical/normalize.ts"),
    p: await import("../../src/lib/staff/historical/parse.ts"),
    a: await import("../../src/lib/staff/historical/attachments.ts"),
  };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { csv, n, p, a } = m ?? {};

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(HERE, "fixtures", "historical", "synthetic-historical-orders.csv");
const TODAY = { y: 2026, m: 11, d: 27 };
const analyze = (text, extra = {}) => p.analyzeHistoricalCsv(text, { today: TODAY, ratePerPointMinor: 1000, ...extra });
const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";
const one = (cells) => analyze(HEADER + cells + "\n");

describe("CSV reading", { skip }, () => {
  test("quoted commas, doubled quotes, CRLF, a BOM and a line break inside a quoted cell", () => {
    const r = csv.parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3\r\n');
    assert.equal(r.ok, true);
    assert.deepEqual(r.header, ["a", "b", "c"]);
    assert.deepEqual(r.records[0].cells, ["x, y", 'say "hi"', "line1\nline2"]);
    assert.equal(r.records[0].rowNumber, 2);
    assert.equal(r.records[1].rowNumber, 3, "a line break inside a cell does not shift the row number");
  });
  test("a blank line is skipped but still counts, so row numbers are the spreadsheet's", () => {
    const r = csv.parseCsv("a,b\n1,2\n\n3,4\n");
    assert.deepEqual(r.records.map((x) => x.rowNumber), [2, 4]);
  });
  test("refuses an unterminated quote, binary data, an empty file and absurd sizes", () => {
    assert.equal(csv.parseCsv('a,b\n"open,2\n').code, "unterminated_quote");
    assert.equal(csv.parseCsv("a,b\n1,\u0001\n").code, "not_text");
    assert.equal(csv.parseCsv("   \n").code, "empty");
    assert.equal(csv.parseCsv("a\n" + "x\n".repeat(2001)).code, "too_many_rows");
    assert.equal(csv.parseCsv("a," + "b,".repeat(40) + "\n1\n").code, "too_many_columns");
    assert.equal(csv.parseCsv("a\n" + "y".repeat(4001) + "\n").code, "field_too_long");
    assert.equal(csv.parseCsv("a\n" + "y".repeat(600 * 1024)).code, "too_big");
  });
  test("decodes only strict UTF-8 and refuses a NUL byte", () => {
    assert.equal(csv.decodeCsvBytes(new Uint8Array([0x61, 0x2c, 0x62])), "a,b");
    assert.equal(csv.decodeCsvBytes(new Uint8Array([0x61, 0xff, 0x62])), null);
    assert.equal(csv.decodeCsvBytes(new Uint8Array([0x61, 0x00, 0x62])), null);
  });
  test("a semicolon or tab separated export is read too", () => {
    assert.deepEqual(csv.parseCsv("a;b;c\n1;2;3\n").records[0].cells, ["1", "2", "3"]);
    assert.deepEqual(csv.parseCsv("a\tb\n1\t2\n").records[0].cells, ["1", "2"]);
  });
});

describe("names, formulas and markup", { skip }, () => {
  test("a name is cleaned, never rewritten; spelling variants share a key", () => {
    const x = n.normalizeName("  Aldo   Testmann ");
    assert.equal(x.value, "Aldo Testmann");
    assert.equal(x.key, "aldo testmann");
    assert.equal(n.normalizeName("ALDO TESTMANN").key, x.key);
    assert.equal(n.normalizeName("Anne-Marie O'Brien").key, n.normalizeName("anne marie OBrien").key);
    assert.equal(n.normalizeName("أحمد").key, n.normalizeName("احمد").key, "Arabic letter forms are folded");
    assert.equal(n.normalizeName("سارة").key, n.normalizeName("ساره").key);
  });
  test("a leading formula character is removed and reported; a name made only of one is refused", () => {
    for (const raw of ["=CMD|' /C calc'!A0", "+SUM(A1)", "-2+3", "@SUM(1)", "\t=1+1", "  = Bob"]) {
      const r = n.normalizeName(raw);
      assert.ok(!r.ok || (r.neutralized && !/^[=+\-@\t]/.test(r.value)), raw);
    }
    const bob = n.normalizeName("= Bob");
    assert.equal(bob.value, "Bob");
    assert.equal(bob.neutralized, true);
    assert.equal(n.normalizeName("=").code, "empty");
  });
  test("markup, control and direction-changing characters in a name are refused", () => {
    assert.equal(n.normalizeName("<script>alert(1)</script>").code, "characters");
    assert.equal(n.normalizeName("Bob\u0007").code, "control");
    assert.equal(n.normalizeName("Bob‮evil").code, "control");
    assert.equal(n.normalizeName("x".repeat(121)).code, "too_long");
    assert.equal(n.normalizeName("   ").code, "empty");
  });
});

describe("phone numbers", { skip }, () => {
  test("every common way to write one Qatar number gives one key", () => {
    const keys = ["+974 5555 0101", "55550101", "00974 5555 0101", "974-5555-0101", "+974 (5555) 0101", "٥٥٥٥٠١٠١"].map((x) => n.normalizePhone(x));
    for (const k of keys) {
      assert.equal(k.kind, "ok");
      assert.equal(k.key, "97455550101");
      assert.equal(k.e164, "+97455550101");
    }
    assert.equal(keys[1].assumedQatar, true);
    assert.equal(keys[0].assumedQatar, false);
  });
  test("an international number keeps its own country code; nothing else is guessed", () => {
    assert.equal(n.normalizePhone("+44 7700 900123").key, "447700900123");
    assert.equal(n.normalizePhone("0044 7700 900123").key, "447700900123");
    assert.equal(n.normalizePhone("").kind, "empty");
    assert.equal(n.normalizePhone("12345").code, "length");
    assert.equal(n.normalizePhone("+974 5555").code, "length", "a 974 number must have 8 digits after it");
    assert.equal(n.normalizePhone("call me").code, "characters");
    assert.equal(n.normalizePhone("=1+1").code, "characters");
    assert.equal(n.normalizePhone("5555+0101").code, "characters", "a plus is allowed only at the start");
  });
});

describe("money", { skip }, () => {
  const ok = (raw, minor) => assert.deepEqual(n.parseMoney(raw), { ok: true, minor }, raw);
  const bad = (raw, code) => assert.equal(n.parseMoney(raw).code, code, raw);
  test("every spelling of an amount gives integer minor units", () => {
    ok("QAR 1,234.50", 123450);
    ok("1234.5", 123450);
    ok("1,234", 123400);
    ok("QAR1200", 120000);
    ok("1200 QAR", 120000);
    ok("QR 99", 9900);
    ok("0", 0);
    ok("٣٥٠", 35000);
    ok("1,234.500", 123450);
    ok("+500", 50000);
  });
  test("a negative amount is a real negative, in every notation", () => {
    ok("-100", -10000);
    ok("-QAR 100.00", -10000);
    ok("QAR -100.00", -10000);
    ok("(100.00)", -10000);
    ok("−100", -10000);
  });
  test("an ambiguous, malformed or hostile amount is refused, never guessed", () => {
    bad("12,50", "separator");
    bad("1.234,50", "separator");
    bad("1,23", "separator");
    bad("1234.567", "decimals");
    bad("1e5", "format");
    bad("=1+1", "format");
    bad("@SUM(1)", "format");
    bad("12 34", "format");
    bad("QAR", "format");
    bad("abc", "format");
    bad("", "empty");
    bad("1000000000", "range");
    bad("99999999999999", "range");
  });
  test("loyalty is floor(minor / rate) per order, never negative", () => {
    assert.equal(n.loyaltyPoints(123450, 1000), 123);
    assert.equal(n.loyaltyPoints(999, 1000), 0);
    assert.equal(n.loyaltyPoints(279950, 1000), 279);
    assert.equal(n.loyaltyPoints(-5000, 1000), 0);
    assert.equal(n.loyaltyPoints(5000, 0), 0);
  });
});

describe("dates", { skip }, () => {
  const d = (raw, format = null) => n.parseDate(raw, format, TODAY);
  test("an ISO date, a written month and an ISO date-time need no date order", () => {
    assert.equal(d("2025-03-14").iso, "2025-03-14");
    assert.equal(d("14 Mar 2025").iso, "2025-03-14");
    assert.equal(d("March 14, 2025").iso, "2025-03-14");
    assert.equal(d("14-Mar-2025").iso, "2025-03-14");
    assert.equal(d("2025/03/14").iso, "2025-03-14");
  });
  test("a date-time with a zone is the date in Qatar; one without is taken as written", () => {
    assert.equal(d("2025-03-14T22:30:00.000Z").iso, "2025-03-15", "22:30 UTC is 01:30 the next day in Qatar");
    assert.equal(d("2025-03-14T20:59:00Z").iso, "2025-03-14");
    assert.equal(d("2025-03-31T21:00:00Z").iso, "2025-04-01", "a month boundary is decided in Qatar time");
    assert.equal(d("2025-03-14 23:59").iso, "2025-03-14");
    assert.equal(d("2025-03-14T10:00:00+03:00").iso, "2025-03-14");
  });
  test("a numeric date needs a certain order: one part above 12, or the order the file was told to use", () => {
    assert.equal(d("14/03/2025").iso, "2025-03-14");
    assert.equal(d("03/14/2025").iso, "2025-03-14");
    assert.equal(d("04/05/2025").code, "ambiguous");
    assert.equal(d("04/05/2025", "dmy").iso, "2025-05-04");
    assert.equal(d("04/05/2025", "mdy").iso, "2025-04-05");
    assert.equal(d("05/05/2025").iso, "2025-05-05", "the same either way");
    assert.equal(d("31/31/2025").code, "invalid");
  });
  test("a date that is not real, too early, too late or in the future is refused", () => {
    assert.equal(d("2025-02-30").code, "invalid");
    assert.equal(d("2019-12-31").code, "out_of_range");
    assert.equal(d("2026-11-28").code, "future");
    assert.equal(d("2026-11-27").iso, "2026-11-27");
    assert.equal(d("someday").code, "format");
    assert.equal(d("").code, "empty");
    assert.equal(d("=1+1").code, "format");
  });
  test("the file's date order is inferred only when it is certain", () => {
    assert.equal(n.inferDateFormat(["14/03/2025", "02/04/2025"]).format, "dmy");
    assert.equal(n.inferDateFormat(["03/14/2025", "02/04/2025"]).format, "mdy");
    assert.equal(n.inferDateFormat(["14/03/2025", "03/14/2025"]).reason, "mixed");
    assert.equal(n.inferDateFormat(["02/04/2025", "03/05/2025"]).reason, "ambiguous");
    assert.equal(n.inferDateFormat(["2025-03-14", "14 Mar 2025"]).reason, "iso_or_text");
    // the Month column breaks a tie only when it agrees with exactly one reading
    assert.equal(n.inferDateFormat(["02/04/2025", "03/05/2025"], ["April 2025", "May 2025"]).format, "dmy");
    assert.equal(n.inferDateFormat(["02/04/2025", "03/05/2025"], ["February 2025", "March 2025"]).format, "mdy");
    assert.equal(n.inferDateFormat(["02/04/2025"], ["June 2025"]).reason, "ambiguous");
  });
  test("a historical date is stored at 12:00 Qatar time so no conversion can move it to another day", () => {
    assert.equal(n.qatarNoonOf("2025-03-31"), "2025-03-31T12:00:00+03:00");
    assert.equal(new Date(n.qatarNoonOf("2025-03-31")).toISOString(), "2025-03-31T09:00:00.000Z");
  });
});

describe("attachment references", { skip }, () => {
  test("names and https references are read; nothing is fetched", () => {
    const r = n.parseAttachments("invoice-1.pdf (https://attachments.example.test/x/invoice-1.pdf), photo.png (https://v5.airtableusercontent.com/v3/u/abc/photo.png?X-Amz-Expires=3600)");
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items.map((i) => i.ext), ["pdf", "png"]);
    assert.equal(r.items[0].expiring, false);
    assert.equal(r.items[1].expiring, true, "an Airtable temporary link is flagged");
  });
  test("an unsafe or unusable reference is not kept as a link", () => {
    const r = n.parseAttachments("a.pdf (http://example.test/a.pdf), b.pdf (https://user:pw@example.test/b.pdf), ../../etc/passwd.png (https://example.test/x)");
    assert.equal(r.items[0].ref, null);
    assert.equal(r.items[1].ref, null);
    assert.equal(r.items[2].fileName, "passwd.png", "a path in a name is dropped");
  });
  test("file names lose paths, control characters and formula triggers", () => {
    assert.equal(n.cleanFileName("=cmd|' /C calc'!A0.pdf").name.startsWith("="), false);
    assert.equal(n.cleanFileName("a/b\\c.pdf").name, "c.pdf");
    assert.equal(n.cleanFileName("evil‮fdp.exe").name.includes("‮"), false);
    assert.ok(n.cleanFileName("x".repeat(300) + ".pdf").name.length <= 120);
    assert.ok(n.cleanFileName("x".repeat(300) + ".pdf").name.endsWith(".pdf"));
  });
  test("unreadable text in the cell is reported, not silently dropped", () => {
    assert.equal(n.parseAttachments("see the folder").unreadable, true);
    assert.equal(n.parseAttachments("").items.length, 0);
  });
});

describe("the identity of a purchase", { skip }, () => {
  const base = { nameKey: "aldo testmann", phoneKey: "97455550101", happenedOn: "2025-03-14", revenueMinor: 123450, costMinor: 100000 };
  test("it uses only what the export says, and is stable", () => {
    assert.equal(n.fingerprintOf(n.purchaseCanonical(base, 1)), n.fingerprintOf(n.purchaseCanonical({ ...base }, 1)));
    assert.notEqual(n.fingerprintOf(n.purchaseCanonical(base, 1)), n.fingerprintOf(n.purchaseCanonical(base, 2)), "the second identical row is a different purchase");
    assert.notEqual(n.fingerprintOf(n.purchaseCanonical(base, 1)), n.fingerprintOf(n.purchaseCanonical({ ...base, revenueMinor: 123451 }, 1)));
    assert.notEqual(n.fingerprintOf(n.purchaseCanonical(base, 1)), n.fingerprintOf(n.purchaseCanonical({ ...base, costMinor: null }, 1)), "an unknown cost is not a zero cost");
    assert.match(n.fingerprintOf("x"), /^[0-9a-f]{64}$/);
  });
});

describe("one row at a time", { skip }, () => {
  const row = (cells) => {
    const r = one(cells);
    assert.equal(r.ok, true);
    return r.rows[0];
  };
  test("a good purchase becomes a purchase with its points", () => {
    const r = row("Aldo Testmann,+974 5555 0101,2025-03-14,QAR 2799.50,QAR 2472.00,QAR 327.50,March 2025,");
    assert.equal(r.kind, "purchase");
    assert.equal(r.revenueMinor, 279950);
    assert.equal(r.costMinor, 247200);
    assert.equal(r.points, 279);
    assert.equal(r.phone, "+97455550101");
    assert.equal(r.happenedOn, "2025-03-14");
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
  });
  test("a recorded loss is preserved and flagged only as information", () => {
    const r = row("Aldo Testmann,55550101,2025-03-14,2080,2180,-100,March 2025,");
    assert.equal(r.kind, "purchase");
    assert.equal(r.profitMinor, -10000);
    assert.ok(r.issues.some((i) => i.code === "loss_recorded" && i.severity === "info"));
  });
  test("Profit must equal Revenue minus Cost", () => {
    const r = row("Aldo Testmann,55550101,2025-03-14,1000,800,250,March 2025,");
    assert.equal(r.kind, "invalid");
    assert.ok(r.issues.some((i) => i.code === "profit_mismatch"));
  });
  test("a missing cost is unknown, never zero; a missing phone is a warning", () => {
    const r = row("Aldo Testmann,,2025-03-14,1000,,,March 2025,");
    assert.equal(r.kind, "purchase");
    assert.equal(r.costMinor, null);
    assert.ok(r.issues.some((i) => i.code === "cost_missing"));
    assert.ok(r.issues.some((i) => i.code === "phone_missing"));
    assert.notEqual(r.fingerprint, row("Aldo Testmann,,2025-03-14,1000,0,,March 2025,").fingerprint);
  });
  test("zero or negative revenue, a negative cost and a future or impossible date are errors", () => {
    for (const cells of [
      "Aldo,55550101,2025-03-14,0,0,0,March 2025,",
      "Aldo,55550101,2025-03-14,-500,0,,March 2025,",
      "Aldo,55550101,2025-03-14,500,-5,,March 2025,",
      "Aldo,55550101,2027-01-01,500,400,,January 2027,",
      "Aldo,55550101,2025-02-30,500,400,,February 2025,",
      "Aldo,55550101,,500,400,,,",
      ",55550101,2025-03-14,500,400,,March 2025,",
    ]) assert.equal(row(cells).kind, "invalid", cells);
  });
  test("a Month that disagrees with the date is a warning and the date wins", () => {
    const r = row("Aldo,55550101,2025-03-14,500,400,100,April 2025,");
    assert.equal(r.kind, "purchase");
    assert.equal(r.happenedOn, "2025-03-14");
    assert.ok(r.issues.some((i) => i.code === "month_mismatch"));
  });
  test("an Instagram AD row is an expense, whatever its spelling, never an order", () => {
    for (const name of ["Instagram AD", "instagram ad", "INSTAGRAM ADS", "Instagram  Ad"]) {
      const r = row(`${name},,2025-04-11,,QAR 50.00,-QAR 50.00,April 2025,`);
      assert.equal(r.kind, "ad_expense", name);
      assert.equal(r.costMinor, 5000);
      assert.equal(r.points, 0);
      assert.equal(r.fingerprint, null);
    }
    assert.equal(row("Instagram AD,,2025-04-11,500,50,,April 2025,").kind, "invalid", "an ad row with a revenue is ambiguous, not silently an order or an expense");
    assert.equal(row("Instagram AD,,2025-04-11,,,,April 2025,").kind, "invalid");
  });
  test("a spreadsheet error row with no customer data is excluded; the same error in a real row is an error", () => {
    assert.equal(row(",,,,,,#ERROR!,").kind, "invalid_summary");
    assert.equal(row(",,,,,,#REF!,").kind, "invalid_summary");
    assert.equal(row("Aldo,55550101,2025-03-14,#ERROR!,400,,March 2025,").kind, "invalid");
  });
  test("injection attempts in any cell never become a formula, a number or markup", () => {
    assert.equal(row("=HYPERLINK(\"http://evil\"),55550101,2025-03-14,500,400,100,March 2025,").kind, "invalid", "quote marks and parentheses are not a name");
    const neutral = row("+Bob Test,55550101,2025-03-14,500,400,100,March 2025,");
    assert.equal(neutral.customerName, "Bob Test");
    assert.ok(neutral.issues.some((i) => i.code === "text_neutralized"));
    assert.equal(row("Bob,55550101,2025-03-14,=500,400,,March 2025,").kind, "invalid");
    assert.equal(row("Bob,55550101,=NOW(),500,400,,March 2025,").kind, "invalid");
    assert.equal(row("Bob,=cmd|calc,2025-03-14,500,400,,March 2025,").kind, "invalid");
    assert.equal(row("<img src=x onerror=alert(1)>,55550101,2025-03-14,500,400,,March 2025,").kind, "invalid");
    const att = row('Bob,55550101,2025-03-14,500,400,100,March 2025,"=evil.pdf (https://x.example.test/a.pdf)"');
    assert.equal(att.attachments[0].fileName.startsWith("="), false);
  });
});

describe("the whole synthetic export", { skip }, () => {
  const text = skip ? "" : readFileSync(FIXTURE, "utf8");
  const r = skip ? null : analyze(text);
  test("36 data rows: 25 purchases, 10 advertising expenses and 1 invalid summary row, nothing needs correcting", () => {
    assert.equal(r.ok, true);
    assert.equal(r.summary.dataRows, 36);
    assert.equal(r.summary.validPurchases, 25);
    assert.equal(r.summary.adExpenseRows, 10);
    assert.equal(r.summary.invalidSummaryRows, 1);
    assert.equal(r.summary.invalidRows, 0);
    assert.equal(r.dateFormat, null);
    assert.equal(r.dateFormatReason, "iso_or_text");
  });
  test("the purchase figures: revenue 106,334, cost 91,346, profit 14,988, loyalty 10,632", () => {
    assert.equal(r.summary.revenueMinor, 10_633_400);
    assert.equal(r.summary.costMinor, 9_134_600);
    assert.equal(r.summary.profitMinor, 1_498_800);
    assert.equal(r.summary.revenueMinor - r.summary.costMinor, r.summary.profitMinor);
    assert.equal(r.summary.points, 10_632);
    assert.equal(r.summary.lossOrders, 1);
    assert.equal(r.rows.filter((x) => x.kind === "purchase" && x.profitMinor === -10000).length, 1, "exactly one loss, of exactly QAR 100");
  });
  test("the 10 advertising rows add up to QAR 495 and are not orders", () => {
    assert.equal(r.summary.adExpenseMinor, 49_500);
    assert.ok(r.rows.filter((x) => x.kind === "ad_expense").every((x) => x.fingerprint === null && x.points === 0));
  });
  test("19 distinct customers by normalised name and phone, though the file spells them in more ways", () => {
    assert.equal(r.summary.customers, 19);
    const rawPairs = new Set(text.split("\n").slice(1).filter(Boolean).map((l) => l.split(",").slice(0, 2).join("|")));
    assert.ok(rawPairs.size > 19, "the raw spellings are more varied than the customers");
  });
  test("21 attachment references across 12 orders: 11 PDFs and 10 PNGs, 13 orders without any", () => {
    assert.equal(r.summary.attachmentRefs, 21);
    assert.equal(r.summary.ordersWithAttachments, 12);
    assert.equal(r.summary.attachmentPdf, 11);
    assert.equal(r.summary.attachmentPng, 10);
    assert.equal(r.summary.attachmentOther, 0);
    assert.equal(r.rows.filter((x) => x.kind === "purchase" && x.attachments.length === 0).length, 13);
  });
  test("the purchases span 2024, 2025 and 2026", () => {
    assert.deepEqual(r.summary.years, [2024, 2025, 2026]);
  });
  test("reordering the rows or uploading the file again gives the same purchases (same fingerprints)", () => {
    const lines = text.trimEnd().split("\n");
    const header = lines[0];
    const body = lines.slice(1);
    const fp = (res) => res.rows.filter((x) => x.fingerprint).map((x) => x.fingerprint).sort();
    const reversed = analyze([header, ...[...body].reverse()].join("\n") + "\n");
    assert.deepEqual(fp(reversed), fp(r));
    assert.deepEqual(fp(analyze(text)), fp(r));
    assert.equal(new Set(fp(r)).size, 25, "25 distinct purchases");
  });
  test("two identical rows are two purchases whichever comes first, and the second is flagged", () => {
    const row = "Aldo,55550101,2025-03-14,500,400,100,March 2025,";
    const x = analyze(HEADER + row + "\n" + row + "\n");
    assert.equal(new Set(x.rows.map((y) => y.fingerprint)).size, 2);
    assert.deepEqual(x.rows.map((y) => y.occurrence), [1, 2]);
    assert.ok(x.rows[1].issues.some((i) => i.code === "identical_purchase"));
  });
  test("a day-first or month-first export is read with the order the file implies, and an ambiguous one asks", () => {
    const rowsDmy = HEADER + "A,55550101,14/03/2025,500,400,100,March 2025,\nB,55550102,02/04/2025,500,400,100,April 2025,\n";
    assert.equal(analyze(rowsDmy).dateFormat, "dmy");
    const rowsAmb = HEADER + "A,55550101,02/04/2025,500,400,100,,\nB,55550102,03/05/2025,500,400,100,,\n";
    const amb = analyze(rowsAmb);
    assert.equal(amb.dateFormatReason, "ambiguous");
    assert.ok(amb.rows.every((x) => x.kind === "invalid" && x.issues.some((i) => i.code === "date_ambiguous")));
    const chosen = analyze(rowsAmb, { dateFormat: "mdy" });
    assert.equal(chosen.rows[0].happenedOn, "2025-02-04");
    assert.equal(chosen.dateFormatReason, "owner_choice");
  });
  test("a missing required column is refused with a clear message", () => {
    const x = analyze("Customer,Date,Revenue\nA,2025-03-14,500\n");
    assert.equal(x.ok, false);
    assert.match(x.message, /cost/i);
  });
});

describe("attachment files", { skip }, () => {
  const PNG_1x1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");
  test("a real PNG and a plain PDF are accepted, with their SHA-256", () => {
    const png = a.inspectAttachment(PNG_1x1);
    assert.equal(png.ok, true);
    assert.equal(png.mime, "image/png");
    assert.match(png.sha256, /^[0-9a-f]{64}$/);
    assert.equal(a.inspectAttachment(PDF).mime, "application/pdf");
  });
  test("a damaged PNG, a truncated PDF and a renamed other file are refused by their content", () => {
    const broken = Uint8Array.from(PNG_1x1);
    broken[40] ^= 0xff;
    assert.equal(a.inspectAttachment(broken).code, "corrupt");
    assert.equal(a.inspectAttachment(PNG_1x1.slice(0, 40)).code, "corrupt");
    assert.equal(a.inspectAttachment(new TextEncoder().encode("%PDF-1.4\nno end marker")).code, "corrupt");
    assert.equal(a.inspectAttachment(new TextEncoder().encode("MZ\u0090 this is a program")).code, "type");
    assert.equal(a.inspectAttachment(new TextEncoder().encode("<html><script>alert(1)</script></html>")).code, "type");
    assert.equal(a.inspectAttachment(new Uint8Array(0)).code, "empty");
  });
  test("a PDF with a script, a launch action or an embedded file is refused", () => {
    for (const word of ["/JavaScript", "/JS (app.alert(1))", "/Launch", "/EmbeddedFile"]) {
      const bytes = new TextEncoder().encode(`%PDF-1.4\n1 0 obj<< ${word} >>endobj\n%%EOF\n`);
      assert.equal(a.inspectAttachment(bytes).code, "active_content", word);
    }
    assert.equal(a.inspectAttachment(new TextEncoder().encode("%PDF-1.4\n/Producer (JSON) /JSON\n%%EOF\n")).ok, true, "a longer name that merely starts with JS is not a script");
  });
  test("the 4 MB limit is exact", () => {
    const at = new Uint8Array(a.MAX_ATTACHMENT_BYTES);
    at.set(PDF);
    at.set(new TextEncoder().encode("\n%%EOF\n"), at.length - 7);
    assert.equal(a.inspectAttachment(at).ok, true);
    assert.equal(a.inspectAttachment(new Uint8Array(a.MAX_ATTACHMENT_BYTES + 1)).code, "too_big");
  });
});
