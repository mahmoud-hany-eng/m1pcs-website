// THE HISTORICAL IMPORT AND DUPLICATES: two risks the owner asked to have PROVED, on a real PostgreSQL 16 with the real migrations and the real staff functions.
// Every name, phone number and amount is SYNTHETIC.
//
//   A  A purchase is imported, then the same export is uploaded again with ONE value corrected (direct cost, customer spelling, phone, revenue, date).
//      The purchase's fingerprint includes those fields, so a corrected row has a NEW fingerprint. It must therefore never be imported silently: it is
//      recognised as a likely second version of the imported purchase and an explicit owner decision is required. Retries and concurrent imports included.
//   B  An export contains a purchase that already exists on the website as a normal order (a different phone, a different spelling, a discount, an order
//      that was completed weeks after it was placed). The importer must flag the overlap and never award a second set of points to the same purchase.
//   C  Legitimate separate purchases that merely look alike (different customers with the same amount and date; one customer buying two identical things in
//      one day) must still be importable, each with its own points, and must never be merged or dropped.
//
// "Silently" is the point: in every scenario below the test checks that nothing reached the orders, the customers or the loyalty ledger until the owner decided.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, startDatabase } from "./fixtures.mjs";
import { lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

register("./support/alias-loader.mjs", import.meta.url);

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");

let lib = null;
let skipReason = false;
try {
  lib = { p: await import("../../src/lib/staff/historical/parse.ts"), pl: await import("../../src/lib/staff/historical/payload.ts") };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skipReason = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const suite = haveServer && !skipReason ? describe : describe.skip;

const qatarToday = () => {
  const q = new Date(Date.now() + 3 * 3_600_000);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate() };
};
const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";
const csvOf = (rows) =>
  HEADER +
  rows
    .map(([name, phone, date, revenue, cost = "", receipt = ""]) => {
      const profit = cost === "" ? "" : String(Number(revenue) - Number(cost));
      return [name, phone, date, revenue, cost, profit, "", receipt].map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : String(c))).join(",");
    })
    .join("\n") +
  "\n";
const bodyOf = (text) => {
  const a = lib.p.analyzeHistoricalCsv(text, { today: qatarToday(), ratePerPointMinor: 1000 });
  assert.equal(a.ok, true, a.message);
  return JSON.stringify(lib.pl.stagePayload(a, "synthetic"));
};
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let unique = 0;
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu"];
const uniq = (stem) => {
  unique += 1;
  return `${stem} ${NAMES[unique % NAMES.length]}${NAMES[Math.floor(unique / NAMES.length) % NAMES.length]}`;
};
const phoneOf = () => {
  unique += 1;
  return `+974555${String(20000 + unique * 13).slice(-5)}`;
};

suite("historical import: a corrected re-upload and a website order are never imported silently a second time", () => {
  let db;
  let h;
  const last = (out) => lines(out).pop() ?? "";
  const J = (out) => JSON.parse(last(out));
  const commit = (sql, who = AS.olivia) => db.commit(`${who}${/;\s*$/.test(sql) ? sql : `${sql};`}`);
  const scalar = (sql) => h.scalar(sql, "");
  /** Every line a query prints (one row per line), where `scalar` is only the last one. */
  const rowsOf = (sql) => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, ""));
  const count = (sql) => h.count(sql);
  const failing = (sql, who = AS.olivia) => {
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${who}${/;\s*$/.test(sql) ? sql : `${sql};`}\ncommit;`);
    return { ok: r.ok, err: r.err ?? "", code: /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err ?? "")?.[1] ?? null };
  };
  const stage = (text) => J(commit(`select admin.hist_stage_batch($j$${bodyOf(text)}$j$::jsonb)`));
  const get = (id) => J(commit(`select admin.hist_get_batch('${id}')`));
  const confirmFor = (got) => ({
    phrase: `IMPORT ${got.totals.orders} ORDERS`,
    attest: { date_is_completion_date: true, revenue_is_final_payable: true, orders_fully_paid: true, costs_complete: true },
    expected: { orders: got.totals.orders, revenue_minor: got.totals.revenue_minor, cost_minor: got.totals.cost_minor, points: got.totals.points },
  });
  const commitCall = (id, confirmation, dry = false) => `select admin.hist_commit_batch('${id}', $c$${JSON.stringify(confirmation)}$c$::jsonb, ${dry})`;
  const counts = () =>
    JSON.parse(scalar(`select json_build_object('orders', (select count(*) from public.orders), 'customers', (select count(*) from public.customers),
      'ledger', (select count(*) from public.loyalty_ledger), 'historical', (select count(*) from private.historical_orders))::text`));
  const balanceOf = (customerId) => Number(scalar(`select private.loyalty_balance('${customerId}')`));
  const duplicatesOf = (got) => got.flags.filter((f) => f.kind === "possible_duplicate");
  const blocking = (got) => got.flags.filter((f) => f.severity === "error" && !f.resolved);

  /** Decides everything about customers (a new profile each) so that only the duplicate question is left. */
  const settleCustomers = (id) => {
    for (const f of get(id).flags.filter((x) => x.kind === "existing_customer" && !x.resolved)) commit(`select admin.hist_set_group_customer('${id}', '${f.group_id}', 'new', null)`);
    for (const f of get(id).flags.filter((x) => (x.kind === "shared_phone" || x.kind === "same_name_other_phone") && !x.resolved))
      commit(`select admin.hist_resolve_flag('${id}', '${f.flag_key}', 'keep_separate', null)`);
  };
  /** Imports rows that nothing else resembles. Returns { id, orderIds, customerIds }. */
  const importRows = (rows) => {
    const staged = stage(csvOf(rows));
    const got = get(staged.batch_id);
    assert.equal(got.blocking, 0, JSON.stringify(blocking(got)));
    J(commit(commitCall(staged.batch_id, confirmFor(got))));
    return {
      id: staged.batch_id,
      orderIds: rowsOf(`select order_id from private.historical_orders where batch_id = '${staged.batch_id}' order by source_row_number`),
    };
  };
  /** A normal website order, written the way the platform stores one (placed on `created`, completed on `completed`). Money in minor units. */
  const webOrder = ({ name, phone, total, discount = 0, created, completed = null, status = "delivered" }) => {
    const customerId = randomUUID();
    const orderId = randomUUID();
    db.commit(`select private.set_write_ctx(true);
      insert into public.customers (id, full_name, phone, source, marketing_consent, preferred_language) values ('${customerId}', '${name}', '${phone}', 'website', false, 'en');
      select private.set_write_ctx(false);`);
    db.commit(`set local session_replication_role = replica;
      insert into public.orders (id, customer_id, status, total_minor, discount_minor, created_at, completed_at)
      values ('${orderId}', '${customerId}', '${status}', ${total}, ${discount}, '${created}T09:00:00Z', ${completed ? `'${completed}T09:00:00Z'` : "null"});`);
    return { customerId, orderId, ref: scalar(`select order_ref from public.orders where id = '${orderId}'`) };
  };

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    seedIdempotencyFixtures(db, { probes: false });
    h = makeHelpers(db);
  });
  after(() => db?.stop());

  // =============================================================================================================
  describe("A. a purchase that was imported and is uploaded again with one value corrected", () => {
    const BASE = { name: "", phone: "", date: "2025-06-10", revenue: "5000", cost: "4200" };
    let imported;
    let baseOrder;
    let baseCustomer;
    let afterBase;

    before(() => {
      BASE.name = uniq("Corrected");
      BASE.phone = phoneOf();
      imported = importRows([[BASE.name, BASE.phone, BASE.date, BASE.revenue, BASE.cost]]);
      baseOrder = imported.orderIds[0];
      baseCustomer = scalar(`select customer_id from public.orders where id = '${baseOrder}'`);
      afterBase = { counts: counts(), balance: balanceOf(baseCustomer) };
      assert.equal(afterBase.balance, 500, "the imported purchase earned its points once");
    });

    const rowOf = (over = {}) => [over.name ?? BASE.name, over.phone ?? BASE.phone, over.date ?? BASE.date, over.revenue ?? BASE.revenue, over.cost ?? BASE.cost];

    it("the same row written differently (spacing, case, the country code) is the same purchase: skipped as already imported, nothing is awarded", () => {
      // The same file, written differently, is simply the same (already imported) batch: nothing new is prepared.
      const reopened = stage(csvOf([rowOf({ name: `  ${BASE.name.toUpperCase()}  ` })]));
      assert.equal(reopened.reused, true);
      assert.equal(get(reopened.batch_id).batch.status, "committed");
      // Inside a file that also holds something new, each written-differently copy of the imported row is skipped by its fingerprint.
      for (const variant of [
        { name: `  ${BASE.name.toUpperCase()}  `, phone: BASE.phone },
        { name: BASE.name, phone: BASE.phone.replace("+974", "974") },
        { name: BASE.name, phone: BASE.phone.replace("+974", "") },
      ]) {
        const staged = stage(csvOf([rowOf(variant), [uniq("Unrelated"), phoneOf(), "2025-11-03", "1300", "1000"]]));
        const got = get(staged.batch_id);
        assert.equal(got.totals.orders, 1, `${JSON.stringify(variant)}: only the unrelated row is left to import`);
        assert.ok(got.flags.some((f) => f.kind === "already_imported"), JSON.stringify(got.flags));
        assert.equal(duplicatesOf(got).length, 0);
      }
      assert.deepEqual(counts(), afterBase.counts, "staging imports nothing");
    });

    // Each correction changes ONE value (or two). A corrected row has a new fingerprint, so this is the case the fingerprint alone cannot recognise.
    const CORRECTIONS = [
      ["the direct cost", { cost: "4300" }],
      ["the customer's spelling", { name: true }],
      ["the phone number", { phone: "NEW" }],
      ["the revenue", { revenue: "5100" }],
      ["the date, by one day", { date: "NEXT_DAY" }],
      ["the date, by forty days", { date: "PLUS_40" }],
      ["the revenue and the cost together", { revenue: "5100", cost: "4300" }],
      ["the date and the cost together", { date: "PLUS_40", cost: "4300" }],
      ["both the customer's name and the phone number", { name: true, phone: "NEW" }],
    ];

    for (const [label, over] of CORRECTIONS) {
      it(`corrected ${label}: not imported silently — an unresolved duplicate decision names the earlier order, the commit is refused, and nothing is awarded`, () => {
        const row = rowOf({
          name: over.name ? `${BASE.name.slice(0, -1)}z` : undefined,
          phone: over.phone ? phoneOf() : undefined,
          revenue: over.revenue,
          cost: over.cost,
          date: over.date === "NEXT_DAY" ? addDays(BASE.date, 1) : over.date === "PLUS_40" ? addDays(BASE.date, 40) : undefined,
        });
        const staged = stage(csvOf([row]));
        const got = get(staged.batch_id);
        const dups = duplicatesOf(got);
        assert.ok(dups.length >= 1, `no duplicate decision was raised for a corrected ${label}: ${JSON.stringify(got.flags.map((f) => f.kind))}`);
        assert.ok(dups.every((f) => f.severity === "error" && !f.resolved), "it blocks until the owner decides");
        assert.ok(dups.some((f) => f.message.includes(scalar(`select order_ref from public.orders where id = '${baseOrder}'`))), "the message names the order it may duplicate");
        const refused = failing(commitCall(staged.batch_id, confirmFor(got)));
        assert.equal(refused.ok, false);
        assert.equal(refused.code, "55000");
        assert.match(refused.err, /still need your decision/);
        assert.deepEqual(counts(), afterBase.counts, "nothing was created");
        assert.equal(balanceOf(baseCustomer), afterBase.balance, "no points were added");
      });
    }

    it("the owner can say it is the same purchase (skip): nothing is imported and nothing is awarded", () => {
      const staged = stage(csvOf([rowOf({ cost: "4310" })]));
      const got = get(staged.batch_id);
      const rowId = got.rows.find((r) => r.kind === "purchase").id;
      commit(`select admin.hist_set_row_decision('${staged.batch_id}', '${rowId}', 'skip', 'the same purchase with its cost corrected')`);
      const after = get(staged.batch_id);
      assert.equal(after.totals.orders, 0);
      assert.equal(blocking(after).length, 0, "skipping answers the question");
      assert.deepEqual(counts(), afterBase.counts);
    });

    it("saying 'it is a different purchase' is an explicit, recorded decision, and only then can it import; a retry of that import does not award twice", () => {
      const staged = stage(csvOf([rowOf({ cost: "4320" })]));
      const flag = duplicatesOf(get(staged.batch_id))[0];
      assert.ok(flag);
      assert.equal(failing(`select admin.hist_resolve_flag('${staged.batch_id}', '${flag.flag_key}', 'keep_separate', null)`).code, "22023", "only the duplicate decisions apply to it");
      commit(`select admin.hist_resolve_flag('${staged.batch_id}', '${flag.flag_key}', 'import_anyway', 'a second purchase of the same amount, a different build')`);
      settleCustomers(staged.batch_id);
      const got = get(staged.batch_id);
      assert.equal(got.blocking, 0, JSON.stringify(blocking(got)));
      const before = counts();
      const first = J(commit(commitCall(staged.batch_id, confirmFor(got))));
      const second = J(commit(commitCall(staged.batch_id, confirmFor(got))));
      assert.equal(first.orders, 1);
      assert.equal(second.replayed, true, "the retry returned the stored result");
      const after = counts();
      assert.equal(after.orders - before.orders, 1);
      assert.equal(after.ledger - before.ledger, 1, "one award, however many times it is confirmed");
      assert.ok(count(`select count(*) from private.audit_log where action = 'historical_import.flag_resolved' and details ->> 'resolution' = 'import_anyway'`) >= 1, "the decision is in the audit log");
      afterBase = { counts: counts(), balance: balanceOf(baseCustomer) };
    });

    it("an export that repeats the imported row and adds a new one imports only the new one, once", () => {
      const fresh = [uniq("Fresh"), phoneOf(), "2025-06-12", "2100", "1800"];
      const staged = stage(csvOf([rowOf(), fresh]));
      const got = get(staged.batch_id);
      assert.equal(got.totals.orders, 1, "the repeated row is skipped, the new one is not");
      assert.equal(got.blocking, 0, JSON.stringify(blocking(got)));
      const before = counts();
      J(commit(commitCall(staged.batch_id, confirmFor(got))));
      assert.equal(counts().orders - before.orders, 1);
      assert.equal(counts().ledger - before.ledger, 1);
      afterBase = { counts: counts(), balance: balanceOf(baseCustomer) };
    });

    it("a corrected upload and the original, staged first and confirmed at the same moment, create the purchase once: the later commit is stopped", async () => {
      const original = [uniq("Race"), phoneOf(), "2025-07-02", "6100", "5000"];
      const a = stage(csvOf([original]));
      const b = stage(csvOf([[original[0], original[1], original[2], original[3], "5050"]]));
      const gotA = get(a.batch_id);
      const gotB = get(b.batch_id);
      assert.equal(gotA.blocking, 0);
      assert.equal(gotB.blocking, 0, "neither is an order yet, so neither sees the other when it is reviewed");
      const before = counts();
      const [ra, rb] = await Promise.all([
        h.parallel(h.OLIVIA, "hist_commit_batch", [a.batch_id, JSON.stringify(confirmFor(gotA)), "false"]),
        h.parallel(h.OLIVIA, "hist_commit_batch", [b.batch_id, JSON.stringify(confirmFor(gotB)), "false"]),
      ]);
      assert.equal([ra, rb].filter((r) => r.ok).length, 1, `exactly one of the two commits succeeds: ${ra.err} | ${rb.err}`);
      const loser = [ra, rb].find((r) => !r.ok);
      assert.match(loser.err, /still need your decision/);
      assert.equal(counts().orders - before.orders, 1);
      assert.equal(counts().ledger - before.ledger, 1, "points were awarded once");
    });

    it("two different corrections of one imported purchase, each reviewed and confirmed as 'different' before either was imported, still cannot both import: the second finds the first", () => {
      const base = [uniq("Twice"), phoneOf(), "2025-07-09", "4000", "3300"];
      importRows([base]);
      const c1 = stage(csvOf([[base[0], base[1], base[2], base[3], "3350"]]));
      const c2 = stage(csvOf([[base[0], base[1], base[2], base[3], "3360"]]));
      for (const s of [c1, c2]) {
        commit(`select admin.hist_resolve_flag('${s.batch_id}', '${duplicatesOf(get(s.batch_id))[0].flag_key}', 'import_anyway', 'checked')`);
        settleCustomers(s.batch_id);
        assert.equal(get(s.batch_id).blocking, 0);
      }
      const before = counts();
      J(commit(commitCall(c1.batch_id, confirmFor(get(c1.batch_id)))));
      const refused = failing(commitCall(c2.batch_id, confirmFor(get(c2.batch_id))));
      assert.equal(refused.code, "55000", "the first correction's order is a new overlap the owner has not decided");
      assert.match(refused.err, /still need your decision/);
      assert.equal(counts().orders - before.orders, 1);
    });
  });

  // =============================================================================================================
  describe("B. a purchase that is already a normal order on the website", () => {
    const FREEZE = "2025-09-10";
    const csvRow = (name, phone, date, revenue, cost = "400") => [name, phone, date, revenue, cost];

    it("same customer, same amount, same day: flagged, refused, nothing awarded", () => {
      const name = uniq("Web");
      const phone = phoneOf();
      const w = webOrder({ name, phone, total: 900000, created: FREEZE, completed: FREEZE });
      const before = counts();
      const staged = stage(csvOf([csvRow(name, phone, FREEZE, "9000")]));
      const got = get(staged.batch_id);
      const flag = duplicatesOf(got)[0];
      assert.ok(flag, JSON.stringify(got.flags.map((f) => f.kind)));
      assert.ok(flag.message.includes(w.ref));
      assert.equal(failing(commitCall(staged.batch_id, confirmFor(got))).code, "55000");
      assert.deepEqual(counts(), before);
    });

    // The overlap cases that need more than "same phone, same amount, within three days of the order being PLACED".
    const OVERLAPS = [
      ["the order was completed weeks after it was placed, and the export dates the purchase by its completion", { created: "2025-08-01", completed: "2025-08-27", csvDate: "2025-08-27", csvRevenue: "9000", total: 900000 }],
      ["the amount differs (a change, or a typing error) but the customer and the completion date are the same, and the order was completed weeks after it was placed", { created: "2025-08-01", completed: "2025-08-27", csvDate: "2025-08-27", csvRevenue: "8800", total: 900000 }],
      ["the customer used a different phone number on the website", { created: FREEZE, completed: FREEZE, csvDate: FREEZE, csvRevenue: "9000", total: 900000, csvPhone: "NEW" }],
      ["the customer's name is spelled differently in the export", { created: FREEZE, completed: FREEZE, csvDate: FREEZE, csvRevenue: "9000", total: 900000, csvName: "SPELLED" }],
      ["the name is the same but written in capitals with other spacing, and the phone number is different", { created: FREEZE, completed: FREEZE, csvDate: FREEZE, csvRevenue: "9000", total: 900000, csvName: "CAPITALS", csvPhone: "NEW" }],
      ["the website order had a discount, so the final amount paid is the net amount", { created: FREEZE, completed: FREEZE, csvDate: FREEZE, csvRevenue: "9000", total: 1000000, discount: 100000 }],
      ["the export dates the purchase a few days off, but the customer and the amount are the same", { created: FREEZE, completed: FREEZE, csvDate: "2025-09-24", csvRevenue: "9000", total: 900000 }],
      ["the order is still being built on the website and has not been completed yet", { created: FREEZE, completed: null, status: "building", csvDate: FREEZE, csvRevenue: "9000", total: 900000 }],
    ];
    for (const [label, o] of OVERLAPS) {
      it(`${label}: the overlap is flagged and the commit is refused`, () => {
        const name = uniq("Overlap");
        const phone = phoneOf();
        const w = webOrder({ name, phone, total: o.total, discount: o.discount ?? 0, created: o.created, completed: o.completed, status: o.status ?? "delivered" });
        const ledgerBefore = counts().ledger;
        const csvName = o.csvName === "CAPITALS" ? `  ${name.toUpperCase().replace(" ", "  ")}  ` : o.csvName ? `${name.slice(0, -1)}q` : name;
        const csvPhone = o.csvPhone ? phoneOf() : phone;
        const staged = stage(csvOf([csvRow(csvName, csvPhone, o.csvDate, o.csvRevenue)]));
        const got = get(staged.batch_id);
        const flag = duplicatesOf(got)[0];
        assert.ok(flag, `not flagged: ${JSON.stringify(got.flags.map((f) => f.kind))}`);
        assert.ok(flag.message.includes(w.ref), "it names the website order");
        const refused = failing(commitCall(staged.batch_id, confirmFor(got)));
        assert.equal(refused.code, "55000");
        assert.equal(counts().ledger, ledgerBefore, "no points were awarded");
      });
    }

    it("a website order that appears AFTER the export was reviewed stops the import: the check is made again at the moment of confirming", () => {
      const name = uniq("Late");
      const phone = phoneOf();
      const staged = stage(csvOf([csvRow(name, phone, FREEZE, "7000")]));
      const got = get(staged.batch_id);
      assert.equal(got.blocking, 0, "nothing on the website yet, so nothing to decide");
      const w = webOrder({ name, phone, total: 700000, created: FREEZE, completed: FREEZE });
      const before = counts();
      const refused = failing(commitCall(staged.batch_id, confirmFor(got)));
      assert.equal(refused.code, "55000");
      assert.match(refused.err, /still need your decision|no longer what you reviewed/);
      assert.deepEqual(counts(), before);
      assert.ok(get(staged.batch_id).flags.some((f) => f.kind === "possible_duplicate" && f.message.includes(w.ref)));
    });

    it("skipping the row keeps the website order's points as they were and imports nothing; importing it anyway is a recorded owner decision", () => {
      const name = uniq("Skip");
      const phone = phoneOf();
      const w = webOrder({ name, phone, total: 800000, created: FREEZE, completed: FREEZE });
      const balance = balanceOf(w.customerId);
      const staged = stage(csvOf([csvRow(name, phone, FREEZE, "8000")]));
      const got = get(staged.batch_id);
      commit(`select admin.hist_set_row_decision('${staged.batch_id}', '${got.rows.find((r) => r.kind === "purchase").id}', 'skip', 'already on the website')`);
      assert.equal(get(staged.batch_id).totals.orders, 0);
      assert.equal(balanceOf(w.customerId), balance);
      // and the other decision: a genuinely different purchase of the same amount and day
      const staged2 = stage(csvOf([csvRow(name, phone, FREEZE, "8000", "610")]));
      commit(`select admin.hist_resolve_flag('${staged2.batch_id}', '${duplicatesOf(get(staged2.batch_id))[0].flag_key}', 'import_anyway', 'a second purchase')`);
      settleCustomers(staged2.batch_id);
      const got2 = get(staged2.batch_id);
      assert.equal(got2.blocking, 0, JSON.stringify(blocking(got2)));
      const before = counts();
      J(commit(commitCall(staged2.batch_id, confirmFor(got2))));
      assert.equal(counts().orders - before.orders, 1);
      assert.equal(counts().ledger - before.ledger, 1);
    });

    it("a website order that was cancelled is no purchase and does not block an import", () => {
      const name = uniq("Cancelled");
      const phone = phoneOf();
      webOrder({ name, phone, total: 650000, created: FREEZE, completed: null, status: "cancelled" });
      const staged = stage(csvOf([csvRow(name, phone, FREEZE, "6500")]));
      const got = get(staged.batch_id);
      assert.equal(duplicatesOf(got).length, 0, JSON.stringify(got.flags.map((f) => f.kind)));
    });
  });

  // =============================================================================================================
  describe("C. legitimate separate purchases that merely look alike are preserved", () => {
    it("two DIFFERENT customers with the same amount, cost and date, in one export: both are imported, each with its own points", () => {
      const date = "2025-10-05";
      const before = counts();
      const r = importRows([[uniq("Twin"), phoneOf(), date, "3000", "2500"], [uniq("Twin"), phoneOf(), date, "3000", "2500"]]);
      assert.equal(r.orderIds.length, 2);
      assert.equal(counts().orders - before.orders, 2);
      assert.equal(counts().ledger - before.ledger, 2);
      assert.equal(counts().customers - before.customers, 2);
    });

    it("a different customer's website order with the same amount and date is not a reason to hold an import back", () => {
      const date = "2025-10-07";
      webOrder({ name: uniq("Someone"), phone: phoneOf(), total: 450000, created: date, completed: date });
      const staged = stage(csvOf([[uniq("Stranger"), phoneOf(), date, "4500", "3900"]]));
      const got = get(staged.batch_id);
      assert.equal(duplicatesOf(got).length, 0, JSON.stringify(got.flags.map((f) => f.kind)));
      assert.equal(got.blocking, 0);
    });

    it("a DIFFERENT customer whose purchase has the same amount, the same direct cost and the same day as an imported one (exactly what a customer with BOTH name and phone corrected looks like) is a question for the owner, and one click keeps it as its own purchase with its own points", () => {
      const date = "2025-10-12";
      importRows([[uniq("Pair"), phoneOf(), date, "2000", "1500"]]);
      const second = [uniq("Pair"), phoneOf(), date, "2000", "1500"];
      const staged = stage(csvOf([second]));
      const got = get(staged.batch_id);
      const flag = duplicatesOf(got)[0];
      assert.ok(flag, "it cannot be told apart from a corrected row, so it is asked about, never imported silently");
      assert.match(flag.message, /no customer detail matches, but the amount, the day and the direct cost are all the same/);
      assert.equal(failing(commitCall(staged.batch_id, confirmFor(got))).code, "55000");
      commit(`select admin.hist_resolve_flag('${staged.batch_id}', '${flag.flag_key}', 'import_anyway', 'a different customer who bought the same build on the same day')`);
      settleCustomers(staged.batch_id);
      const settled = get(staged.batch_id);
      assert.equal(settled.blocking, 0, JSON.stringify(blocking(settled)));
      const before = counts();
      J(commit(commitCall(staged.batch_id, confirmFor(settled))));
      assert.equal(counts().orders - before.orders, 1, "it was preserved");
      assert.equal(counts().customers - before.customers, 1, "as its own customer");
      assert.equal(counts().ledger - before.ledger, 1, "with its own points");
    });

    it("the SAME customer's later purchase (another amount, another cost, months afterwards, still before the day of the import) is a different purchase: nothing is asked", () => {
      const name = uniq("Later");
      const phone = phoneOf();
      importRows([[name, phone, "2025-03-03", "4000", "3400"]]);
      const staged = stage(csvOf([[name, phone, "2025-09-15", "5500", "4700"]]));
      const got = get(staged.batch_id);
      assert.equal(duplicatesOf(got).length, 0, JSON.stringify(got.flags.map((f) => f.kind)));
      assert.equal(blocking(got).filter((f) => f.kind === "possible_duplicate").length, 0);
    });

    it("one customer buying two identical things on one day (two identical rows in one export): both are imported; the same export again imports nothing", () => {
      const name = uniq("Double");
      const phone = phoneOf();
      const row = [name, phone, "2025-10-20", "1500", "1200"];
      const before = counts();
      const stagedFirst = stage(csvOf([row, row]));
      const gotFirst = get(stagedFirst.batch_id);
      // the two identical rows are shown to the owner as a note, never as a block
      const note = gotFirst.flags.find((f) => f.kind === "identical_rows");
      assert.ok(note && note.severity === "warning" && note.resolved === true, JSON.stringify(gotFirst.flags.map((f) => f.kind)));
      assert.equal(gotFirst.blocking, 0, JSON.stringify(blocking(gotFirst)));
      J(commit(commitCall(stagedFirst.batch_id, confirmFor(gotFirst))));
      const first = { orderIds: rowsOf(`select order_id from private.historical_orders where batch_id = '${stagedFirst.batch_id}'`) };
      assert.equal(first.orderIds.length, 2, "two purchases, not one");
      assert.equal(counts().ledger - before.ledger, 2);
      const again = stage(csvOf([row, row]));
      const got = get(again.batch_id);
      assert.equal(again.reused, true, "the same file is the same batch");
      assert.equal(got.batch.status, "committed");
      // and a re-export of the same two rows, with an unrelated row added, skips both
      const mixed = stage(csvOf([row, row, [uniq("Other"), phoneOf(), "2025-10-21", "900", "700"]]));
      const mg = get(mixed.batch_id);
      assert.equal(mg.totals.orders, 1);
      assert.equal(mg.rows.filter((r) => r.decision === "skip" && /already imported/.test(r.skip_reason ?? "")).length, 2);
    });

    it("a THIRD identical row appearing in a later export is not guessed at: it is held for the owner's decision", () => {
      const name = uniq("Triple");
      const phone = phoneOf();
      const row = [name, phone, "2025-10-25", "1800", "1400"];
      importRows([row, row]);
      const staged = stage(csvOf([row, row, row]));
      const got = get(staged.batch_id);
      assert.equal(got.totals.orders, 1, "two are skipped as imported, the third is the question");
      assert.ok(duplicatesOf(got).length >= 1, JSON.stringify(got.flags.map((f) => f.kind)));
      assert.equal(failing(commitCall(staged.batch_id, confirmFor(got))).code, "55000");
    });
  });
});
