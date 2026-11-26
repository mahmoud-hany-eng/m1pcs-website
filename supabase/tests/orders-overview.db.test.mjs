// THE SIMPLIFIED ORDERS PAGE, IN THE DATABASE. A real PostgreSQL 16, the real migrations, the real staff functions the page calls
// (admin.list_orders_overview, admin.add_order_receipt, admin.remove_order_receipt, admin.get_order_receipt) and the website's own gateway statements
// (read out of src/lib/staff/gateway.ts), so the file travels as a bound bytea exactly as in production.
//
//   A. the rows: the order price is what the customer has to PAY; cost and profit exist only for finance.read and an unknown cost is null, never zero;
//      profit sorts (unknown last, in both directions) need finance.read; every list choice answers exactly as the earlier admin.list_orders_page does;
//   B. the receipts: real PDFs only, size and count limits, the same file never twice, cleaned names, a keyed upload that stores once, the file read
//      back byte for byte, removal that keeps the record with who/when/why, every permission, and the audit trail without the file;
//   C. nothing leaks: ordinary staff, customers and anonymous callers get neither the figures nor the files, in any key of any answer, and the
//      migration is purely additive, closed to the public API, and rerunnable.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { CUST_C, lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const MIGRATION = "20261126120000_orders_overview_and_receipts.sql";
const OVERVIEW = "admin.list_orders_overview(text, text, integer, integer, date, date, text, integer, integer)";
const FUNCTIONS = [OVERVIEW, "admin.add_order_receipt(uuid, uuid, text, bytea)", "admin.remove_order_receipt(uuid, text)", "admin.get_order_receipt(uuid)"];
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const BASE_KEYS = ["created_at", "customer_name", "id", "net_payable_minor", "order_ref"];
const FINANCE_KEYS = ["cost_minor", "cost_state", "profit_is_provisional", "profit_minor"];
const RECEIPT_KEYS = ["receipt_count", "receipts"];

/** A small but real-looking PDF; `seed` makes its bytes (and its hash) different. Returned as a hex string for SQL and as a Buffer. */
const pdf = (seed = "a") => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${seed}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");
const hexOf = (buffer) => `\\x${buffer.toString("hex")}`;
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

suite("the simplified Orders page: overview figures and PDF receipts, in the database", () => {
  let db;
  let h;
  const ids = {};
  let N = 0; // every order in the database (the fixtures make a few of their own)

  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const scalar = (sql, who = "") => read(sql, who);
  const commit = (script, who = AS.olivia) => db.commit(`${who}${script}`);
  const rewrite = (script) => db.commit(`set local session_replication_role = replica;\n${script}`);
  const overview = (args = {}, who = AS.olivia) => {
    const a = { search: null, status: null, year: null, month: null, from: null, to: null, sort: "newest", page: 1, size: 5, ...args };
    return JSON.parse(read(`select admin.list_orders_overview(${lit(a.search)}, ${lit(a.status)}, ${lit(a.year)}, ${lit(a.month)}, ${lit(a.from)}::date, ${lit(a.to)}::date, ${lit(a.sort)}, ${a.page}, ${a.size})::text`, who));
  };
  const earlier = (args = {}, who = AS.sam) => {
    const a = { search: null, status: null, year: null, month: null, from: null, to: null, sort: "newest", page: 1, size: 5, ...args };
    return JSON.parse(read(`select admin.list_orders_page(${lit(a.search)}, ${lit(a.status)}, ${lit(a.year)}, ${lit(a.month)}, ${lit(a.from)}::date, ${lit(a.to)}::date, ${lit(a.sort)}, ${a.page}, ${a.size})::text`, who));
  };
  const create = ({ customer = ID.custA, total, discount = null, points = 0 }) =>
    lines(
      commit(
        `select admin.create_order('${customer}', '${JSON.stringify([{ kind: "component", description: "Test item", quantity: 1, unit_price_minor: total }])}'::jsonb, null::uuid, 'admin'::text, null::text, null::text, null::text, ${
          discount ? `'${JSON.stringify(discount)}'::jsonb` : "null::jsonb"
        }, ${points}::bigint, null::bigint, null::bigint, null::jsonb);`,
      ),
    )
      .pop()
      .trim();
  const addCost = (orderId, amount, kind = "actual") =>
    commit(`select admin.add_order_cost('${orderId}', '${randomUUID()}', 'components', 'Parts', ${amount}, '${kind}', null, null, null);`);
  const placeAt = (id, iso) => rewrite(`update public.orders set created_at = '${iso}' where id = '${id}';`);
  const rowOf = (id, args = {}, who = AS.olivia) => overview({ size: 100, ...args }, who).rows.find((r) => r.id === id);

  // The receipt calls, as the website makes them (the gateway's own statements).
  const add = (who, orderId, name, buffer, receiptId = randomUUID()) => ({ receiptId, ...h.viaGateway(who, "add_order_receipt", [orderId, receiptId, name, hexOf(buffer)]) });
  const remove = (who, receiptId, reason = "uploaded to the wrong order") => h.viaGateway(who, "remove_order_receipt", [receiptId, reason]);
  const fetchFile = (who, receiptId) => {
    const r = db.cluster.psql(`begin;\n${h.gatewayCall(who, "get_order_receipt", [receiptId])}commit;`);
    return { ok: r.ok, value: r.ok ? JSON.parse(lines(r.out).pop()) : null, err: r.err };
  };

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
    // Thirty orders for three customers, a day apart from 1 June 2026, with 7 different prices.
    for (let i = 1; i <= 30; i += 1) {
      const customer = [ID.custA, ID.custB, CUST_C][i % 3];
      ids[`o${i}`] = create({ customer, total: 100_000 + (i % 7) * 25_000 });
      placeAt(ids[`o${i}`], new Date(Date.UTC(2026, 5, i, 9, 0, 0)).toISOString());
    }
    // One order with a discount and redeemed loyalty credit: its price is what the customer PAYS.
    commit(`select admin.adjust_loyalty('${ID.custB}', 2000, 'points for the overview test');`);
    ids.disc = create({ customer: ID.custB, total: 600_000, discount: { mode: "fixed", amount_minor: 150_000, reason: "owner discount for the overview test" }, points: 2000 });
    placeAt(ids.disc, "2026-07-02T09:00:00Z");
    // Costs: an actual cost declared complete, an estimate, an actual cost that was voided, and a cost larger than the price (a loss).
    ids.full = ids.o10; // price 100000 + (10 % 7) * 25000 = 175000
    addCost(ids.full, 60_000);
    commit(`select admin.set_order_costs_complete('${ids.full}', true, null);`);
    ids.est = ids.o11; // 200000
    addCost(ids.est, 90_000, "estimated");
    ids.voided = ids.o12; // 225000
    addCost(ids.voided, 40_000);
    const costId = scalar(`select id from private.order_costs where order_id = '${ids.voided}' limit 1`);
    commit(`select admin.void_order_cost('${costId}', 1, 'entered twice by mistake');`);
    ids.loss = ids.o13; // 250000
    addCost(ids.loss, 300_000);
    ids.cheap = ids.o14; // 100000
    addCost(ids.cheap, 10_000);
    commit(`select admin.set_order_costs_complete('${ids.cheap}', true, null);`);
    N = Number(scalar("select count(*) from public.orders"));
  });
  after(() => db?.stop());

  // ===================================================================================================================
  describe("A. the overview rows and sorts", () => {
    it("the default is the 5 newest orders, newest first, with the total and 'first-last' for 'Showing 1-5 of N'", () => {
      const a = overview();
      assert.equal(a.sort, "newest");
      assert.equal(a.page_size, 5);
      assert.equal(a.rows.length, 5);
      assert.equal(a.total, N);
      assert.equal(a.first, 1);
      assert.equal(a.last, 5);
      assert.equal(a.pages, Math.ceil(N / 5));
      const times = a.rows.map((r) => new Date(r.created_at).getTime());
      assert.deepEqual([...times].sort((x, y) => y - x), times);
      assert.equal(a.rows[0].id, scalar("select id from public.orders order by created_at desc, id desc limit 1"), "the newest order comes first");
    });

    it("a row is small: for ordinary staff exactly the order number, customer, order price, placed date and id, and no figure, flag or file in ANY key", () => {
      const a = overview({ size: 25 }, AS.sam);
      assert.equal(a.can_see_finance, false);
      assert.equal(a.can_see_receipts, false);
      assert.equal(a.can_manage_receipts, false);
      for (const r of a.rows) assert.deepEqual(Object.keys(r).sort(), BASE_KEYS);
      const text = JSON.stringify(a);
      assert.ok(!/cost|profit|receipt|supplier|margin/i.test(text.replace(/"can_see_(finance|receipts)":false|"can_manage_receipts":false/g, "")), "no private figure or receipt appears anywhere in the answer");
    });

    it("the owner's row adds cost, profit and the receipts, and the flags say so", () => {
      const a = overview({ size: 25 });
      assert.equal(a.can_see_finance, true);
      assert.equal(a.can_see_receipts, true);
      assert.equal(a.can_manage_receipts, true);
      for (const r of a.rows) assert.deepEqual(Object.keys(r).sort(), [...BASE_KEYS, ...FINANCE_KEYS, ...RECEIPT_KEYS].sort());
    });

    it("the order price is what the customer has to PAY (total - discount - redeemed credit), never the original total", () => {
      const r = rowOf(ids.disc);
      assert.equal(r.net_payable_minor, 600_000 - 150_000 - 20_000);
      assert.equal(Number(scalar(`select net_payable_minor from public.orders where id = '${ids.disc}'`)), r.net_payable_minor);
      assert.equal(rowOf(ids.disc, {}, AS.sam).net_payable_minor, r.net_payable_minor, "ordinary staff see the same price");
    });

    it("cost and profit: no entry means UNKNOWN (null), an actual cost declared complete is a firm profit, an estimate or an open cost is provisional, a voided entry does not count", () => {
      const none = rowOf(ids.o1);
      assert.equal(none.cost_minor, null, "no cost entry: unknown, never zero");
      assert.equal(none.profit_minor, null, "and so no profit, never the price minus zero");
      assert.equal(none.cost_state, "missing");
      const full = rowOf(ids.full);
      assert.equal(full.cost_minor, 60_000);
      assert.equal(full.profit_minor, 175_000 - 60_000);
      assert.equal(full.cost_state, "complete");
      assert.equal(full.profit_is_provisional, false);
      const est = rowOf(ids.est);
      assert.equal(est.cost_minor, 90_000);
      assert.equal(est.profit_minor, 200_000 - 90_000);
      assert.equal(est.profit_is_provisional, true, "an estimate is provisional");
      const voided = rowOf(ids.voided);
      assert.equal(voided.cost_minor, null, "a voided entry does not count: with no active entry the cost is unknown again");
      assert.equal(voided.profit_minor, null);
      const loss = rowOf(ids.loss);
      assert.equal(loss.profit_minor, 250_000 - 300_000, "a loss is a negative profit");
      assert.equal(loss.profit_is_provisional, true, "costs not declared complete are provisional");
    });

    it("the row's figures are the same ones the order's own cost page shows (cost recorded, profit, provisional)", () => {
      for (const id of [ids.full, ids.est, ids.loss, ids.cheap, ids.o1]) {
        const summary = JSON.parse(read(`select admin.order_costs('${id}')::text`, AS.olivia)).summary;
        const r = rowOf(id);
        assert.equal(r.cost_minor, summary.entries === 0 ? null : summary.recorded_cost_minor, id);
        assert.equal(r.profit_minor, summary.profit_minor, id);
        assert.equal(r.profit_is_provisional, summary.profit_is_provisional, id);
        assert.equal(r.net_payable_minor, summary.net_revenue_minor, id);
      }
    });

    it("sorting by profit puts the biggest or smallest first and the orders with an UNKNOWN profit last in both directions", () => {
      const asc = overview({ sort: "profit_asc", size: 100 }).rows;
      const desc = overview({ sort: "profit_desc", size: 100 }).rows;
      const known = (rows) => rows.filter((r) => r.profit_minor !== null).map((r) => r.profit_minor);
      assert.deepEqual(known(asc), [-50_000, 90_000, 110_000, 115_000]);
      assert.deepEqual(known(desc), [115_000, 110_000, 90_000, -50_000]);
      for (const rows of [asc, desc]) {
        const firstUnknown = rows.findIndex((r) => r.profit_minor === null);
        assert.equal(firstUnknown, 4, "the four known profits come first");
        assert.ok(rows.slice(4).every((r) => r.profit_minor === null), "everything after them is unknown");
      }
      assert.equal(asc.length, N);
      assert.equal(new Set(asc.map((r) => r.id)).size, N, "no order is repeated or skipped");
      // Unknown profits keep a stable order (newest first), so a page boundary never repeats or skips one.
      const unknownTimes = desc.slice(4).map((r) => new Date(r.created_at).getTime());
      assert.deepEqual([...unknownTimes].sort((x, y) => y - x), unknownTimes);
      const pages = Array.from({ length: Math.ceil(N / 5) }, (_, i) => i + 1).flatMap((p) => overview({ sort: "profit_desc", page: p }).rows.map((r) => r.id));
      assert.deepEqual(pages, desc.map((r) => r.id), "paging a profit sort gives the same order as one long page");
    });

    it("a profit sort needs finance.read: ordinary staff are refused (42501), even though the rest of the list is open to them", () => {
      for (const sort of ["profit_asc", "profit_desc"]) {
        const r = h.viaGateway(h.SAM, "list_orders_overview", [null, null, null, null, null, null, sort, 1, 5]);
        assert.equal(r.ok, false);
        assert.equal(r.code, "42501");
      }
      assert.equal(h.viaGateway(h.SAM, "list_orders_overview", [null, null, null, null, null, null, "price_asc", 1, 5]).ok, true);
    });

    it("an unknown sort is refused with a message for staff; price sorts order by what the customer pays", () => {
      const r = h.viaGateway(h.OLIVIA, "list_orders_overview", [null, null, null, null, null, null, "cost_desc", 1, 5]);
      assert.equal(r.code, "22023");
      const asc = overview({ sort: "price_asc", size: 100 }).rows.map((x) => x.net_payable_minor);
      assert.deepEqual([...asc].sort((x, y) => x - y), asc);
      const desc = overview({ sort: "price_desc", size: 100 }).rows.map((x) => x.net_payable_minor);
      assert.deepEqual([...desc].sort((x, y) => y - x), desc);
    });

    it("every list choice answers exactly as the earlier admin.list_orders_page does (search, status, month, year, date range, sort, page, size), for the owner and for ordinary staff", () => {
      rewrite(`update public.orders set status = 'on_hold' where id in ('${ids.o3}', '${ids.o8}', '${ids.o21}');`);
      const combos = [
        {}, { sort: "oldest" }, { sort: "price_asc" }, { sort: "price_desc" }, { size: 25 }, { size: 10, page: 2 }, { page: 99 },
        { search: "carol" }, { search: "alice", sort: "price_desc", size: 10 }, { search: "O-26" }, { search: "no such customer" }, { search: "50%" },
        { status: "on_hold" }, { status: "on_hold", sort: "oldest" }, { status: "cancelled" },
        { month: 6, year: 2026 }, { month: 6, year: 2026, size: 10, page: 3 }, { year: 2026 }, { year: 2025 }, { month: 7 },
        { from: "2026-06-05", to: "2026-06-09" }, { from: "2026-06-20" }, { to: "2026-06-03" }, { from: "2026-06-05", to: "2026-06-05" },
        { from: "2026-06-10", to: "2026-06-12", month: 1, year: 2020 }, { search: "bob", month: 6, year: 2026, sort: "price_asc" },
      ];
      for (const who of [AS.olivia, AS.sam]) {
        for (const c of combos) {
          const a = overview(c, who);
          const b = earlier(c, who);
          assert.deepEqual(a.rows.map((r) => r.id), b.rows.map((r) => r.id), `${JSON.stringify(c)}: same orders in the same order`);
          for (const k of ["total", "page", "pages", "page_size", "first", "last", "sort", "years"]) assert.deepEqual(a[k], b[k], `${JSON.stringify(c)}: ${k}`);
          assert.deepEqual(a.filters, b.filters, `${JSON.stringify(c)}: filters`);
          assert.deepEqual(a.rows.map((r) => r.net_payable_minor), b.rows.map((r) => r.net_payable_minor), `${JSON.stringify(c)}: the price`);
        }
      }
    });

    it("invalid choices are refused with a message for staff (month, year, dates, range order)", () => {
      for (const [args, pattern] of [
        [{ month: 13 }, /month must be 1 to 12/],
        [{ year: 1999 }, /year must be between/],
        [{ from: "2026-06-10", to: "2026-06-01" }, /start date must not be after/],
        [{ from: "1999-01-01" }, /dates must be between/],
      ]) {
        const a = { search: null, status: null, year: null, month: null, from: null, to: null, sort: "newest", page: 1, size: 5, ...args };
        db.denied(`${AS.olivia}select admin.list_orders_overview(${lit(a.search)}, ${lit(a.status)}, ${lit(a.year)}, ${lit(a.month)}, ${lit(a.from)}::date, ${lit(a.to)}::date, 'newest', 1, 5);`, "", pattern);
      }
    });
  });

  // ===================================================================================================================
  describe("B. receipts", () => {
    const order = () => ids.o20;

    it("the owner attaches a PDF through the website's own statement; it is stored once, listed with its name and size, and the file reads back byte for byte", () => {
      const file = pdf("first");
      const r = add(h.OLIVIA, order(), "Fawran receipt.pdf", file);
      assert.equal(r.ok, true, r.err);
      assert.equal(r.replayed, false);
      const row = rowOf(order());
      assert.equal(row.receipt_count, 1);
      assert.equal(row.receipts[0].id, r.receiptId);
      assert.equal(row.receipts[0].file_name, "Fawran receipt.pdf");
      assert.equal(row.receipts[0].size_bytes, file.length);
      assert.deepEqual(Object.keys(row.receipts[0]).sort(), ["file_name", "id", "size_bytes", "uploaded_at"], "the list carries no file content");
      const got = fetchFile(h.OLIVIA, r.receiptId);
      assert.equal(got.ok, true, got.err);
      const bytes = Buffer.from(got.value.content_base64, "base64");
      assert.equal(sha(bytes), sha(file), "the stored file is the uploaded file");
      assert.equal(got.value.file_name, "Fawran receipt.pdf");
      assert.equal(got.value.order_id, order());
      ids.firstReceipt = r.receiptId;
    });

    it("sending the same upload again (a double click, a retry) stores nothing twice and says it was a repeat", () => {
      const file = pdf("retry");
      const key = randomUUID();
      const first = add(h.OLIVIA, ids.o21, "retry.pdf", file, key);
      const again = add(h.OLIVIA, ids.o21, "retry.pdf", file, key);
      assert.equal(first.replayed, false);
      assert.equal(again.ok, true);
      assert.equal(again.replayed, true);
      assert.equal(Number(scalar(`select count(*) from private.order_receipts where order_id = '${ids.o21}'`)), 1);
    });

    it("a receipt id already used for a DIFFERENT file, or on another order, is refused (M1K01) and nothing is stored", () => {
      const key = randomUUID();
      assert.equal(add(h.OLIVIA, ids.o22, "one.pdf", pdf("one"), key).ok, true);
      const other = add(h.OLIVIA, ids.o22, "two.pdf", pdf("two"), key);
      assert.equal(other.ok, false);
      assert.equal(other.code, "M1K01");
      const elsewhere = add(h.OLIVIA, ids.o23, "one.pdf", pdf("one"), key);
      assert.equal(elsewhere.code, "M1K01");
      assert.equal(Number(scalar(`select count(*) from private.order_receipts where id = '${key}'`)), 1);
    });

    it("only a real PDF within the limits is accepted: empty, not a PDF, a PDF-looking name on other content, too large, and exactly 4 MiB", () => {
      const refusal = (buffer, pattern, name = "x.pdf") => {
        const r = add(h.OLIVIA, ids.o24, name, buffer);
        assert.equal(r.ok, false, `${name} should be refused`);
        assert.equal(r.code, "22023");
        assert.match(r.err, pattern);
      };
      refusal(Buffer.alloc(0), /file is empty/);
      refusal(Buffer.from("just text, called receipt.pdf"), /not a PDF/, "receipt.pdf");
      refusal(Buffer.from("MZ\x90\x00 an executable"), /not a PDF/, "setup.pdf");
      refusal(Buffer.concat([pdf("big"), Buffer.alloc(4 * 1024 * 1024)]), /too large/);
      const exact = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4 * 1024 * 1024 - 5, 0x20)]);
      const ok = add(h.OLIVIA, ids.o24, "exactly-4-mib.pdf", exact);
      assert.equal(ok.ok, true, ok.err);
      assert.equal(Number(scalar(`select size_bytes from private.order_receipts where id = '${ok.receiptId}'`)), 4 * 1024 * 1024);
      // The 5.6 MB answer is checked inside the database (the psql test helper caps what it can carry back), against the hash of what was sent.
      const served = scalar(`select encode(sha256(decode(admin.get_order_receipt('${ok.receiptId}') ->> 'content_base64', 'base64')), 'hex') || ' ' || (admin.get_order_receipt('${ok.receiptId}') ->> 'size_bytes')`, AS.olivia);
      assert.equal(served, `${sha(exact)} ${4 * 1024 * 1024}`, "a 4 MiB file is served byte for byte");
    });

    it("the file name is cleaned: no folders, no control or direction-changing characters, no quotes; always ends in .pdf; Arabic kept", () => {
      const names = [
        ["C:\\fakepath\\Receipt \"7\".PDF", "Receipt 7.pdf"],
        ["../../etc/passwd", "passwd.pdf"],
        ["  spaced   out  name .pdf ", "spaced out name.pdf"],
        ["invoice\u202Efdp.exe", "invoicefdp.exe.pdf"],
        ["no extension", "no extension.pdf"],
        ["إيصال الدفع.pdf", "إيصال الدفع.pdf"],
        ["...", "receipt.pdf"],
        ["a".repeat(300) + ".pdf", `${"a".repeat(115)}.pdf`],
      ];
      for (const [given, expected] of names) {
        const r = add(h.OLIVIA, ids.o25, given, pdf(`name-${expected}`));
        assert.equal(r.ok, true, `${given}: ${r.err}`);
        assert.equal(scalar(`select file_name from private.order_receipts where id = '${r.receiptId}'`), expected, given);
      }
    });

    it("the same file is never attached twice to one order (but may be to another); an order holds at most 10 receipts", () => {
      const file = pdf("dup");
      assert.equal(add(h.OLIVIA, ids.o26, "a.pdf", file).ok, true);
      const twice = add(h.OLIVIA, ids.o26, "renamed.pdf", file);
      assert.equal(twice.code, "22023");
      assert.match(twice.err, /already attached to this order/);
      assert.equal(add(h.OLIVIA, ids.o27, "a.pdf", file).ok, true, "another order may hold the same file");
      for (let i = 2; i <= 10; i += 1) assert.equal(add(h.OLIVIA, ids.o26, `n${i}.pdf`, pdf(`many-${i}`)).ok, true, `receipt ${i}`);
      const eleventh = add(h.OLIVIA, ids.o26, "n11.pdf", pdf("many-11"));
      assert.equal(eleventh.code, "54000");
      assert.match(eleventh.err, /up to 10 receipts/);
      assert.equal(rowOf(ids.o26).receipt_count, 10);
    });

    it("an unknown order is refused (P0002) and nothing is stored; a missing receipt id through the gateway is refused with a message", () => {
      const r = add(h.OLIVIA, randomUUID(), "x.pdf", pdf("ghost"));
      assert.equal(r.code, "P0002");
      const noKey = h.viaGateway(h.OLIVIA, "add_order_receipt", [ids.o24, null, "x.pdf", hexOf(pdf("nokey"))]);
      assert.equal(noKey.code, "22023");
      assert.match(noKey.err, /id the screen chose/);
    });

    it("who may do what: ordinary staff can neither add, read nor remove (42501), and see no receipts in the list", () => {
      const before = Number(scalar("select count(*) from private.order_receipts"));
      assert.equal(add(h.SAM, ids.o27, "sam.pdf", pdf("sam")).code, "42501");
      assert.equal(fetchFile(h.SAM, ids.firstReceipt).ok, false);
      assert.match(fetchFile(h.SAM, ids.firstReceipt).err, /permission|not allowed|42501/i);
      assert.equal(remove(h.SAM, ids.firstReceipt).code, "42501");
      assert.equal(Number(scalar("select count(*) from private.order_receipts")), before);
      assert.equal(rowOf(order(), {}, AS.sam).receipts, undefined);
      assert.equal(scalar(`select status from private.order_receipts where id = '${ids.firstReceipt}'`), "active");
    });

    it("a second owner can read what the first attached (the files belong to the order, not to the uploader)", () => {
      const got = fetchFile(h.PATRICK, ids.firstReceipt);
      assert.equal(got.ok, true, got.err);
      assert.equal(sha(Buffer.from(got.value.content_base64, "base64")), sha(pdf("first")));
    });

    it("removal needs a reason (3-300 characters), keeps the record with who/when/why, hides it from the list and the download, and a repeat changes nothing", () => {
      const r = add(h.OLIVIA, ids.o28, "to-remove.pdf", pdf("remove-me"));
      assert.equal(r.ok, true);
      for (const reason of ["", "  ", "no", "x".repeat(301)]) {
        const refused = remove(h.OLIVIA, r.receiptId, reason);
        assert.equal(refused.code, "22023", JSON.stringify(reason));
      }
      assert.equal(remove(h.OLIVIA, randomUUID()).code, "P0002");
      const done = remove(h.OLIVIA, r.receiptId, "  attached to the wrong order  ");
      assert.equal(done.ok, true, done.err);
      assert.equal(done.replayed, false);
      assert.equal(rowOf(ids.o28).receipt_count, 0);
      assert.deepEqual(rowOf(ids.o28).receipts, []);
      const gone = fetchFile(h.OLIVIA, r.receiptId);
      assert.equal(gone.ok, false, "a removed receipt is not served");
      const kept = JSON.parse(read(`select to_jsonb(r) - 'content' from private.order_receipts r where id = '${r.receiptId}'`)?.toString() || "{}");
      assert.equal(kept.status, "removed");
      assert.equal(kept.removal_reason, "attached to the wrong order");
      assert.equal(kept.removed_by, ID.olivia);
      assert.ok(kept.removed_at);
      assert.equal(sha(Buffer.from(scalar(`select encode(content, 'hex') from private.order_receipts where id = '${r.receiptId}'`), "hex")), sha(pdf("remove-me")), "the record keeps the file");
      const again = remove(h.OLIVIA, r.receiptId, "a different reason");
      assert.equal(again.ok, true);
      assert.equal(again.replayed, true);
      assert.equal(scalar(`select removal_reason from private.order_receipts where id = '${r.receiptId}'`), "attached to the wrong order", "the first reason stands");
      // The same file may be attached again after it was removed.
      assert.equal(add(h.OLIVIA, ids.o28, "to-remove.pdf", pdf("remove-me")).ok, true);
    });

    it("every add and removal is in the audit trail with who, what and which order, and never with the file", () => {
      const rows = JSON.parse(read(`select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)::text from private.audit_log a where a.action in ('order.receipt_added', 'order.receipt_removed')`));
      assert.ok(rows.length >= 10);
      assert.ok(rows.every((a) => a.actor === ID.olivia && a.entity === "order"));
      const text = JSON.stringify(rows);
      assert.ok(!/%PDF|content_base64|\\\\x2550/.test(text), "the audit trail never holds the file");
      const removed = rows.find((a) => a.action === "order.receipt_removed");
      assert.equal(removed.details.reason, "attached to the wrong order");
      assert.ok(rows.find((a) => a.action === "order.receipt_added").details.sha256.match(/^[0-9a-f]{64}$/));
    });

    it("the record cannot be deleted or edited, by anyone: no delete, no change of the file, name, order or uploader, no truncate, no write outside the staff functions", () => {
      const id = ids.firstReceipt;
      const asDatabaseOwner = (sql) => db.cluster.psql(`begin;\nreset role;\n${sql}\nrollback;`);
      assert.match(asDatabaseOwner(`delete from private.order_receipts where id = '${id}';`).err, /may only be changed through the staff functions|never deleted/);
      assert.match(asDatabaseOwner(`update private.order_receipts set file_name = 'x.pdf' where id = '${id}';`).err, /may only be changed through the staff functions|cannot be changed, only removed/);
      assert.match(asDatabaseOwner(`truncate private.order_receipts;`).err, /append-only/);
      const inContext = (sql) => asDatabaseOwner(`select private.set_write_ctx(true);\n${sql}`);
      assert.match(inContext(`delete from private.order_receipts where id = '${id}';`).err, /never deleted/);
      for (const set of [`file_name = 'x.pdf'`, `content = '\\x255044462d'::bytea, size_bytes = 5`, `order_id = '${ids.o1}'`, `uploaded_by = '${ID.sam}'`, `sha256 = repeat('0', 64)`]) {
        assert.match(inContext(`update private.order_receipts set ${set} where id = '${id}';`).err, /cannot be changed, only removed/, set);
      }
      assert.match(inContext(`insert into private.order_receipts (id, order_id, file_name, size_bytes, sha256, content) values (gen_random_uuid(), '${ids.o1}', 'x.pdf', 3, repeat('a', 64), '\\x616263'::bytea);`).err, /order_receipts_is_pdf|size_matches/);
      assert.match(inContext(`insert into private.order_receipts (id, order_id, file_name, size_bytes, sha256, content) values (gen_random_uuid(), '${ids.o1}', 'x.txt', 5, repeat('a', 64), '\\x255044462d'::bytea);`).err, /file_name|check/);
      const removedId = scalar(`select id from private.order_receipts where status = 'removed' limit 1`);
      assert.match(inContext(`update private.order_receipts set status = 'active', removed_at = null, removed_by = null, removal_reason = null where id = '${removedId}';`).err, /removed receipt cannot be changed/);
    });
  });

  // ===================================================================================================================
  describe("C. nothing leaks, and the migration is additive", () => {
    it("receipts and costs are unreachable from the customer and public API: no privilege, row level security on, and every attempt is refused", () => {
      for (const t of ["private.order_receipts", "private.order_costs"]) {
        assert.equal(scalar(`select relrowsecurity from pg_class where oid = '${t}'::regclass`), "t", t);
        for (const role of ["anon", "authenticated", "service_role"]) {
          assert.equal(scalar(`select has_any_column_privilege('${role}', '${t}', 'select,insert,update,references')`), "f", `${role} on ${t}`);
        }
        for (const who of [AS.alice, AS.anon, AS.service]) {
          h.refused(h.attempt(who, `select count(*) from ${t}`), /permission denied|does not exist/i, `${t} as ${who.slice(0, 40)}`);
        }
      }
      assert.equal(scalar(`select has_function_privilege('authenticated', 'private.receipt_file_name(text)', 'execute')`), "f");
    });

    it("the four functions are closed to anon, PUBLIC and service_role; a customer (even signed in) and an anonymous caller are refused", () => {
      for (const f of FUNCTIONS) {
        for (const role of ["anon", "public", "service_role"]) assert.equal(scalar(`select has_function_privilege('${role}', '${f}', 'execute')`), "f", `${role} ${f}`);
        for (const role of ["m1_staff_gateway", "authenticated"]) assert.equal(scalar(`select has_function_privilege('${role}', '${f}', 'execute')`), "t", `${role} ${f}`);
      }
      const calls = [
        `select admin.list_orders_overview(null, null, null, null, null, null, 'newest', 1, 5)`,
        `select admin.get_order_receipt('${ids.firstReceipt}')`,
        `select admin.add_order_receipt('${ids.o1}', gen_random_uuid(), 'x.pdf', '\\x255044462d'::bytea)`,
        `select admin.remove_order_receipt('${ids.firstReceipt}', 'a customer tries')`,
      ];
      for (const sql of calls) {
        for (const who of [AS.alice, AS.eve, AS.anon, AS.forgedAdmin, AS.oliviaAal1]) {
          const r = h.attempt(who, sql);
          assert.match(r, /^REFUSED: /, `${sql} as ${who.slice(0, 50)}`);
        }
      }
      assert.equal(scalar(`select status from private.order_receipts where id = '${ids.firstReceipt}'`), "active");
    });

    it("nothing the customer can read mentions receipts, costs or profit: no public view or function body, and the customer's own orders carry no such column", () => {
      assert.equal(Number(scalar(`select count(*) from pg_views where schemaname = 'public' and (definition ilike '%order_receipts%' or definition ilike '%order_costs%' or definition ilike '%order_cost_rollup%')`)), 0);
      assert.equal(Number(scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.prosrc ilike '%order_receipts%' or p.prosrc ilike '%order_costs%' or p.prosrc ilike '%order_cost_rollup%')`)), 0);
      const columns = scalar(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'orders' and (column_name ilike '%receipt%' or column_name ilike '%cost%' or column_name ilike '%profit%')`);
      assert.equal(columns, "", "public.orders has no receipt, cost or profit column");
      // What a signed-in customer reads of their own order is a plain row of public.orders: it cannot reach the private tables.
      assert.equal(h.attempt(AS.alice, `select to_jsonb(o) from public.orders o where customer_id = '${ID.custA}' limit 1`), "OK");
    });

    it("the migration adds exactly these functions and the receipts table, and changes nothing else (functions, columns, indexes, constraints, triggers and policies are identical)", () => {
      const fingerprint = (database) =>
        JSON.parse(
          lines(
            database.ok(
              `select jsonb_build_object(
                 'functions', (select jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid)))
                               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname in ('admin', 'private', 'public') and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
                 'columns', (select md5(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_schema, table_name, column_name))
                             from information_schema.columns where table_schema in ('public', 'private') and table_name <> 'order_receipts'),
                 'indexes', (select md5(string_agg(schemaname || '.' || indexname || ':' || indexdef, '|' order by schemaname, indexname)) from pg_indexes where schemaname in ('public', 'private') and tablename <> 'order_receipts'),
                 'constraints', (select md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname)) from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace) and conrelid::regclass::text <> 'private.order_receipts'),
                 'triggers', (select md5(string_agg(tgrelid::regclass::text || '.' || tgname, '|' order by tgrelid::regclass::text, tgname)) from pg_trigger where not tgisinternal and tgrelid::regclass::text <> 'private.order_receipts'),
                 'policies', (select md5(string_agg(schemaname || '.' || tablename || '.' || policyname, '|' order by schemaname, tablename, policyname)) from pg_policies))::text;`,
            ),
          ).pop(),
        );
      const without = startDatabase({ schedule: "confirmed", before: MIGRATION });
      seedIdempotencyFixtures(without);
      try {
        const a = fingerprint(without);
        const b = fingerprint(db);
        // Migrations that come AFTER this one (20261127120000_staff_header_profile.sql adds admin.my_staff_profile()) are not this migration's doing: leave them out of the comparison.
        for (const later of ["admin.my_staff_profile()"]) delete b.functions[later];
        const added = Object.keys(b.functions).filter((k) => !(k in a.functions)).sort();
        const changed = Object.keys(a.functions).filter((k) => a.functions[k] !== b.functions[k]);
        const removed = Object.keys(a.functions).filter((k) => !(k in b.functions));
        assert.deepEqual(added, [
          "admin.add_order_receipt(p_order_id uuid, p_receipt_id uuid, p_file_name text, p_content bytea)",
          "admin.get_order_receipt(p_receipt_id uuid)",
          "admin.list_orders_overview(p_search text, p_status text, p_year integer, p_month integer, p_from date, p_to date, p_sort text, p_page integer, p_page_size integer)",
          "admin.remove_order_receipt(p_receipt_id uuid, p_reason text)",
          "private.guard_order_receipt_identity()",
          "private.receipt_file_name(p_name text)",
        ]);
        assert.deepEqual(changed, [], "no existing function was replaced (admin.list_orders and admin.list_orders_page included)");
        assert.deepEqual(removed, []);
        for (const k of ["columns", "indexes", "constraints", "triggers", "policies"]) assert.equal(b[k], a[k], `${k} are unchanged`);
        assert.equal(Number(without.ok("select count(*) from pg_class where oid = to_regclass('private.order_receipts');").trim().split("\n").pop()), 0, "the table is new");
      } finally {
        without.stop();
      }
    });

    it("the earlier functions answer as before, for the website that is live today", () => {
      const rows = JSON.parse(lines(db.ok("select admin.list_orders(null, 'carol', 3, 1)::text;", AS.sam)).pop());
      assert.equal(rows.length, 3);
      assert.ok(!("cost_minor" in rows[0]) && !("receipts" in rows[0]));
      const page = earlier({ size: 5 }, AS.olivia);
      assert.equal(page.rows.length, 5);
      assert.ok(!("receipt_count" in page.rows[0]) && !("cost_minor" in page.rows[0]));
    });

    it("running the migration a second time succeeds and changes nothing (rerunnable): the receipts and the overview are the same", () => {
      const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
      const before = JSON.stringify(overview({ sort: "profit_desc", size: 100 }));
      const receipts = scalar("select count(*) from private.order_receipts");
      const result = db.cluster.psql(sql);
      assert.ok(result.ok, result.err);
      assert.equal(JSON.stringify(overview({ sort: "profit_desc", size: 100 })), before);
      assert.equal(scalar("select count(*) from private.order_receipts"), receipts, "the stored receipts are untouched");
    });
  });
});
