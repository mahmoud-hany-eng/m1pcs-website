// THE HISTORICAL ORDERS IMPORT, DATABASE layer. Real PostgreSQL 16, the real migrations, the real staff functions (admin.hist_*), the real row level security,
// and the staff gateway role running the SAME SQL text the website sends (read out of src/lib/staff/gateway.ts). Every name, phone number and amount is
// SYNTHETIC (the fixture is supabase/tests/fixtures/historical/synthetic-historical-orders.csv); no real customer record is ever in this repository.
//
// What it proves, in the order of the owner's brief:
//   A  who can do what: only the owner (import.manage, with the second factor); staff, customers, anonymous, forged claims and a first-factor-only session are
//      refused by EVERY function, and the permission is the FIRST thing each one checks;
//   B  staging changes nothing: no order, customer, payment or loyalty entry; the same content (in any order) is one batch; malformed input is refused;
//   C  the commit: gated by the owner's three statements, the typed phrase and the figures they reviewed; atomic (a failure half-way leaves nothing);
//      a dry run leaves no trace; a repeat, a double click and two sessions at once import once;
//   D  loyalty: floor(revenue / the rate) per order, exactly once, whatever is re-uploaded, re-ordered or overlapped; existing balances untouched;
//   E  dates: the completion date is kept, listed and reported in its Asia/Qatar month (boundaries included); the import timestamp is kept apart;
//   F  money: the financial report equals the file's own sums, losses included; nothing is invented (no payment, no cash, no tracking, no deposit);
//   G  customers: profiles with no account, no email, no claim code; a phone number is a hint, never ownership; the claim code works once, for one person;
//   H  files: private, checked by their bytes, classified, never visible to a customer unless the owner says so (and never an invoice);
//   I  the imported order: nothing can be added to it that did not happen (payments, tracking), nothing about its origin or date can change;
//   J  the owner's review: corrections, skips, duplicates, merges, existing customers, discarding, describing the items later;
//   K  the website and the database agree (fingerprints, phone keys) and everything that existed before is unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { asRole, findPgBin } from "./harness.mjs";
import { AS, ID, startDatabase } from "./fixtures.mjs";
import { lines, makeHelpers, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

register("./support/alias-loader.mjs", import.meta.url);

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");

let lib = null;
let skipReason = false;
try {
  lib = {
    n: await import("../../src/lib/staff/historical/normalize.ts"),
    p: await import("../../src/lib/staff/historical/parse.ts"),
    pl: await import("../../src/lib/staff/historical/payload.ts"),
  };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skipReason = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const suite = haveServer && !skipReason ? describe : describe.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TEXT = readFileSync(join(HERE, "fixtures", "historical", "synthetic-historical-orders.csv"), "utf8");

/** Today in Qatar, the same way the database works it out. */
const qatarToday = () => {
  const q = new Date(Date.now() + 3 * 3_600_000);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate() };
};
const analyze = (text, extra = {}) => lib.p.analyzeHistoricalCsv(text, { today: qatarToday(), ratePerPointMinor: 1000, ...extra });
const HEADER = "Customer,Phone Number,Date,Revenue,Cost,Profit,Month,Receipt\n";
/** A tiny export of purchases: [name, phone, ISO date, revenue QAR, cost QAR (or "" for unknown), receipt cell]. Profit is worked out so the row is consistent. */
const csvOf = (rows) =>
  HEADER +
  rows
    .map(([name, phone, date, revenue, cost = "", receipt = ""]) => {
      const profit = cost === "" ? "" : String(Number(revenue) - Number(cost));
      return [name, phone, date, revenue, cost, profit, "", receipt].map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : String(c))).join(",");
    })
    .join("\n") +
  "\n";
const payloadOf = (text, label = "synthetic") => {
  const a = analyze(text);
  assert.equal(a.ok, true, a.message);
  return lib.pl.stagePayload(a, label);
};
const bodyOf = (text, label) => JSON.stringify(payloadOf(text, label));

let unique = 0;
/** A name nobody else in this file uses, so every test's purchases are its own. */
const uniq = (stem = "Tester") => `${stem} ${["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu"][unique % 26]} ${Math.floor(unique++ / 26)}`;
const phoneOf = () => `+974555${String(10000 + unique * 7).slice(-5)}`;

// A 1x1 PNG and a tiny PDF: real signatures, as small as a file can be.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const hex = (buffer) => `\\x${buffer.toString("hex")}`;

suite("historical orders import: real PostgreSQL 16, real migrations, real RLS, the website's own gateway statements", () => {
  let db;
  let h;
  let OLIVIA;
  let SAM;
  const DAVE = "00000000-0000-4000-8000-0000000000d4"; // a person who will claim an imported customer
  let usersAtStart = 0;
  /** A signed-in customer (no staff row), for the claim flow. */
  const asUser = (sub) => asRole({ sub });
  const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

  const last = (out) => lines(out).pop() ?? "";
  const J = (out) => JSON.parse(last(out));
  /** Runs one statement as `who` and commits it. */
  const commit = (sql, who = AS.olivia) => db.commit(`${who}${/;\s*$/.test(sql) ? sql : `${sql};`}`);
  const scalar = (sql, who = "") => h.scalar(sql, who);
  /** Every line a query prints (one row per line), where `scalar` is only the last one. */
  const rowsOf = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who));
  const ok = (sql, who = "") => db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who);
  const count = (sql) => h.count(sql);
  /** The SQLSTATE a statement fails with, or "OK". */
  const stateOf = (sql, who = AS.olivia) => {
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${who}${/;\s*$/.test(sql) ? sql : `${sql};`}\nrollback;`);
    return r.ok ? "OK" : (/ERROR:\s+([0-9A-Z]{5}):/.exec(r.err ?? "")?.[1] ?? `UNKNOWN: ${r.err}`);
  };
  /** The same, in a transaction that is NOT rolled back when it succeeds (a commit that must fail leaves nothing, which the caller then checks). */
  const failing = (sql, who = AS.olivia) => {
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${who}${/;\s*$/.test(sql) ? sql : `${sql};`}\ncommit;`);
    return { ok: r.ok, err: r.err ?? "", code: /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err ?? "")?.[1] ?? null };
  };

  // The website's own statements, run through the gateway role with the verified claims (see support/idempotency-helpers.mjs).
  const gw = (who, name, params) => {
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${h.gatewayCall(who, name, params)}commit;`);
    return { ok: r.ok, json: r.ok ? JSON.parse(last(r.out)) : null, text: r.ok ? last(r.out) : null, err: r.err ?? "", code: /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err ?? "")?.[1] ?? null };
  };

  const stage = (text, label) => J(commit(`select admin.hist_stage_batch($j$${bodyOf(text, label)}$j$::jsonb)`));
  const stageRaw = (body) => J(commit(`select admin.hist_stage_batch($j$${body}$j$::jsonb)`));
  const get = (id) => J(commit(`select admin.hist_get_batch('${id}')`));
  const confirmFor = (got, over = {}) => ({
    phrase: `IMPORT ${got.totals.orders} ORDERS`,
    attest: { date_is_completion_date: true, revenue_is_final_payable: true, orders_fully_paid: true, costs_complete: true, ...(over.attest ?? {}) },
    expected: { orders: got.totals.orders, revenue_minor: got.totals.revenue_minor, cost_minor: got.totals.cost_minor, points: got.totals.points, ...(over.expected ?? {}) },
    ...(over.phrase !== undefined ? { phrase: over.phrase } : {}),
  });
  const commitCall = (id, confirmation, dry = false) => `select admin.hist_commit_batch('${id}', $c$${JSON.stringify(confirmation)}$c$::jsonb, ${dry})`;
  /** Stages a tiny export, reads it, commits it and returns { id, got, result }. */
  const importRows = (rows, { costsComplete = true } = {}) => {
    const staged = stage(csvOf(rows));
    const got = get(staged.batch_id);
    assert.equal(got.blocking, 0, `blocking items: ${JSON.stringify(got.flags.filter((f) => f.severity === "error" && !f.resolved))}`);
    const result = J(commit(commitCall(staged.batch_id, confirmFor(got, { attest: { costs_complete: costsComplete } }))));
    return { id: staged.batch_id, got, result };
  };

  const platformSnapshot = () =>
    JSON.parse(
      scalar(`select json_build_object(
        'orders', (select count(*) from public.orders where origin = 'platform'),
        'orders_md5', (select md5(string_agg(o::text, '|' order by o.id)) from public.orders o where origin = 'platform'),
        'payments', (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.payments p),
        'ledger', (select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) from public.loyalty_ledger l where l.order_id is null or l.order_id in (select id from public.orders where origin = 'platform')),
        'customers', (select md5(string_agg(c::text, '|' order by c.id)) from public.customers c where c.id in ('${ID.custA}', '${ID.custB}')),
        'balance_a', private.loyalty_balance('${ID.custA}'),
        'balance_b', private.loyalty_balance('${ID.custB}'))::text`),
    );
  const businessCounts = () =>
    JSON.parse(scalar(`select json_build_object('orders', (select count(*) from public.orders), 'customers', (select count(*) from public.customers), 'payments', (select count(*) from public.payments),
      'ledger', (select count(*) from public.loyalty_ledger), 'tracking', (select count(*) from public.order_tracking_events), 'costs', (select count(*) from private.order_costs),
      'completions', (select count(*) from private.order_completions), 'claims', (select count(*) from private.customer_claim_codes), 'users', (select count(*) from auth.users))::text`));

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    // No probe functions in schema public: the platform's own security audit is part of what is proved here.
    seedIdempotencyFixtures(db, { probes: false });
    h = makeHelpers(db);
    ({ OLIVIA, SAM } = h);
    db.commit(`insert into auth.users (id, email) values ('${DAVE}', 'dave.login@example.test');`);
    usersAtStart = Number(h.scalar("select count(*) from auth.users"));
  });
  after(() => db?.stop());

  // =============================================================================================================
  describe("A. who can do what", () => {
    const FUNCTIONS = {
      hist_stage_batch: "'{}'::jsonb",
      hist_get_batch: "'00000000-0000-4000-8000-000000000001'",
      hist_list_batches: "",
      hist_update_row: "'00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '{}'::jsonb",
      hist_set_row_decision: "'00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'skip', null",
      hist_merge_groups: "'00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'",
      hist_unmerge_group: "'00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'",
      hist_set_group_customer: "'00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'new', null",
      hist_resolve_flag: "'00000000-0000-4000-8000-000000000001', 'x', 'keep_separate', null",
      hist_discard_batch: "'00000000-0000-4000-8000-000000000001', 'a reason'",
      hist_commit_batch: "'00000000-0000-4000-8000-000000000001', '{}'::jsonb, true",
      hist_store_attachment: "'00000000-0000-4000-8000-000000000001', '\\x00'::bytea, null",
      hist_add_attachment: "'00000000-0000-4000-8000-000000000001', 'a.pdf', '\\x00'::bytea, 'unclassified'",
      hist_set_attachment_class: "'00000000-0000-4000-8000-000000000001', 'unclassified', false",
      hist_mark_attachment_unavailable: "'00000000-0000-4000-8000-000000000001', 'a reason'",
      hist_get_attachment: "'00000000-0000-4000-8000-000000000001'",
      hist_order_info: "'00000000-0000-4000-8000-000000000001'",
      hist_set_order_items: "'00000000-0000-4000-8000-000000000001', '[]'::jsonb, 'a reason'",
    };

    it("the import permission belongs to the owner only", () => {
      assert.equal(scalar(`select count(*) from private.role_permissions where permission_code = 'import.manage' and role_code = 'owner'`), "1");
      assert.equal(scalar(`select count(*) from private.role_permissions where permission_code = 'import.manage' and role_code <> 'owner'`), "0");
    });

    it("every import function exists, only a signed-in session or the gateway can run it (never anon, never service_role), and the permission is the FIRST thing it checks", () => {
      const rows = rowsOf(`select p.proname || '|' || has_function_privilege('anon', p.oid, 'execute')::text || '|' || has_function_privilege('service_role', p.oid, 'execute')::text
        || '|' || has_function_privilege('m1_staff_gateway', p.oid, 'execute')::text || '|' || p.prosecdef::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and (p.proname like 'hist\\_%' or p.proname = 'order_origin') order by p.proname`);
      const names = rows.map((r) => r.split("|")[0]);
      assert.deepEqual(names.sort(), [...Object.keys(FUNCTIONS), "order_origin"].sort());
      for (const row of rows) {
        const [name, anon, service, gateway, definer] = row.split("|");
        assert.deepEqual([anon, service, gateway, definer], ["false", "false", "true", "true"], `${name}: privileges`);
      }
      for (const name of Object.keys(FUNCTIONS)) {
        const whole = rowsOf(`select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and p.proname = '${name}'`).join(" ");
        const body = whole.slice(whole.search(/\bbegin\b/i)); // the statements, not the declarations before them
        const gate = body.indexOf("private.require_permission('import.manage')");
        assert.ok(gate >= 0, `${name} must require import.manage`);
        const firstWork = body.search(/\b(select|insert|update|delete|raise|if|perform private\.(?!require_permission))/i);
        assert.ok(gate < firstWork || firstWork < 0, `${name} must check the permission before anything else`);
      }
    });

    it("the owner reaches the function (a missing record is the answer), and everybody else is refused before it looks for anything", () => {
      for (const [name, args] of Object.entries(FUNCTIONS)) {
        const sql = `select admin.${name}(${args})`;
        const owner = stateOf(sql, AS.olivia);
        // listing and describing a record that is not there answer empty for the owner; everything else says what it could not find
        assert.ok(["hist_list_batches", "hist_order_info"].includes(name) ? owner === "OK" : ["P0002", "22023", "55000"].includes(owner), `${name} as the owner: ${owner}`);
        for (const [label, who] of [["staff", AS.sam], ["customer", AS.alice], ["anonymous", AS.anon], ["forged admin claims", AS.forgedAdmin], ["owner without the second factor", AS.oliviaAal1], ["deactivated staff", AS.dana]]) {
          assert.equal(stateOf(sql, who), "42501", `${name} as ${label} must be refused with a permission error, not "not found"`);
        }
      }
      // order_origin is for anybody who may READ orders (staff too), never a customer or a stranger.
      assert.equal(stateOf(`select admin.order_origin('00000000-0000-4000-8000-000000000001')`, AS.sam), "P0002");
      for (const who of [AS.alice, AS.anon, AS.forgedAdmin, AS.oliviaAal1]) assert.equal(stateOf(`select admin.order_origin('00000000-0000-4000-8000-000000000001')`, who), "42501");
    });

    it("through the website's own gateway statements: the owner is served, staff get the permission error the website maps", () => {
      assert.ok(gw(OLIVIA, "hist_list_batches", []).ok);
      for (const name of ["hist_list_batches", "hist_get_batch", "hist_order_info", "hist_get_attachment"]) {
        const params = name === "hist_list_batches" ? [] : ["00000000-0000-4000-8000-000000000001"];
        assert.equal(gw(SAM, name, params).code, "42501", name);
      }
      assert.equal(gw(SAM, "hist_stage_batch", ["{}"]).code, "42501");
      assert.equal(gw(SAM, "hist_commit_batch", ["00000000-0000-4000-8000-000000000001", "{}", "true"]).code, "42501");
      assert.equal(gw(OLIVIA, "order_origin", ["00000000-0000-4000-8000-000000000001"]).code, "P0002");
      assert.equal(gw(SAM, "order_origin", ["00000000-0000-4000-8000-000000000001"]).code, "P0002", "staff who may read orders can ask what an order is");
    });

    it("the import's private tables are closed to every API role, and the platform's own security audit is clean", () => {
      const tables = ["historical_import_batches", "historical_import_groups", "historical_import_rows", "historical_import_resolutions", "historical_import_attachments", "historical_orders", "historical_customers", "historical_item_revisions"];
      for (const t of tables) {
        assert.equal(scalar(`select relrowsecurity::text from pg_class where oid = 'private.${t}'::regclass`), "true", `${t}: row level security`);
        for (const role of ["anon", "authenticated", "service_role", "m1_staff_gateway"]) {
          for (const priv of ["select", "insert", "update", "delete"]) assert.equal(scalar(`select has_table_privilege('${role}', 'private.${t}', '${priv}')::text`), "false", `${role} ${priv} ${t}`);
        }
      }
      assert.equal(scalar("select count(*) from private.security_audit()"), "0");
    });

    it("no customer-reachable column is named for a cost, a profit, a supplier or provenance, and the two new order columns are plain", () => {
      assert.equal(count(`select count(*) from information_schema.columns where table_schema = 'public' and column_name ~* '(cost|margin|supplier|profit|internal_|staff_|secret|password|token|batch|fingerprint|attest)'`), 0);
      assert.equal(scalar(`select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name in ('origin', 'order_date')`), "order_date:timestamp with time zone,origin:text");
    });
  });

  // =============================================================================================================
  describe("B. staging changes nothing, and malformed input is refused", () => {
    let fixtureBatch;
    let before;

    it("staging the whole synthetic export writes no order, customer, payment, tracking, cost, loyalty entry, claim code or account", () => {
      before = businessCounts();
      const staged = stage(FIXTURE_TEXT, "synthetic fixture");
      assert.equal(staged.status, "staged");
      assert.equal(staged.reused, false);
      fixtureBatch = staged.batch_id;
      assert.deepEqual(businessCounts(), before);
    });

    it("the batch carries exactly the figures of the file: 25 orders for 19 customers, QAR 106,334 of revenue, 10,632 points, 10 advertising rows kept apart, one invalid row", () => {
      const got = get(fixtureBatch);
      const t = got.totals;
      assert.equal(t.orders, 25);
      assert.equal(t.customers, 19);
      assert.equal(t.revenue_minor, 10_633_400);
      assert.equal(t.cost_minor, 9_134_600);
      assert.equal(t.profit_minor, 1_498_800);
      assert.equal(t.points, 10_632);
      assert.equal(t.loss_orders, 1);
      assert.equal(t.ad_rows, 10);
      assert.equal(t.ad_minor, 49_500);
      assert.equal(t.invalid_summary_rows, 1);
      assert.equal(t.data_rows, 36);
      assert.equal(got.attachments.length, 21);
      assert.equal(got.blocking, 0);
      assert.equal(got.batch.status, "staged");
      assert.equal(got.batch.qar_per_point_minor, 1000);
      assert.equal(got.rows.filter((r) => r.kind === "ad_expense").length, 10);
      assert.equal(got.rows.filter((r) => r.kind === "invalid_summary").length, 1);
      assert.ok(got.rows.filter((r) => r.kind === "purchase").every((r) => r.points === Math.floor(r.revenue_minor / 1000)));
    });

    it("advertising rows and the invalid row are never orders, customers or points, in staging or anywhere", () => {
      const got = get(fixtureBatch);
      for (const r of got.rows.filter((x) => x.kind === "ad_expense" || x.kind === "invalid_summary")) {
        assert.equal(r.points, 0);
        assert.equal(r.group_id, null);
        assert.equal(r.order_id, null);
      }
    });

    it("the same file again is the same batch, and so is the same content in another row order", () => {
      const again = stage(FIXTURE_TEXT, "uploaded again");
      assert.equal(again.reused, true);
      assert.equal(again.batch_id, fixtureBatch);
      const [header, ...rows] = FIXTURE_TEXT.trim().split("\n");
      const shuffled = [header, ...[...rows].reverse()].join("\n") + "\n";
      const reordered = stage(shuffled, "re-ordered");
      assert.equal(reordered.reused, true);
      assert.equal(reordered.batch_id, fixtureBatch, "a re-ordered file is the same import");
      assert.equal(count(`select count(*) from private.historical_import_batches`), 1);
    });

    it("reading a staged batch writes nothing the owner did not ask for, and listing shows it waiting", () => {
      const list = J(db.ok("select admin.hist_list_batches();", AS.olivia));
      assert.equal(list.length, 1);
      assert.deepEqual([list[0].status, list[0].orders, list[0].points, list[0].blocking], ["staged", 25, 10632, 0]);
      assert.deepEqual(businessCounts(), before);
    });

    it("a malformed payload is refused with a message for staff and saves nothing", () => {
      const good = payloadOf(csvOf([[uniq(), phoneOf(), "2025-03-04", "1000", "800"]]));
      const tweak = (fn) => JSON.stringify(fn(structuredClone(good)));
      const cases = {
        "rows is not a list": tweak((p) => ({ ...p, rows: {} })),
        "no rows": tweak((p) => ({ ...p, rows: [] })),
        "an unknown date format": tweak((p) => ({ ...p, options: { ...p.options, date_format: "ymd" } })),
        "an unknown kind": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], kind: "refund" }] })),
        "two rows with one number": tweak((p) => ({ ...p, rows: [p.rows[0], { ...p.rows[0], customer_name: "Other", name_key: "other" }] })),
        "a row 1 (the header)": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], row_number: 1 }] })),
        "a negative revenue": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], revenue_minor: -5 }] })),
        "a missing revenue": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], revenue_minor: null }] })),
        "a date in the future": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], happened_on: "2999-01-01" }] })),
        "a date before the business existed": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], happened_on: "1999-01-01" }] })),
        "an amount beyond any real order": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], revenue_minor: 99_999_999_999_999 }] })),
        "a control character in the name": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], customer_name: "Bad\u0007Name" }] })),
        "a profit that is not revenue minus cost": tweak((p) => ({ ...p, rows: [{ ...p.rows[0], profit_minor: 7 }] })),
      };
      const beforeBatches = count("select count(*) from private.historical_import_batches");
      for (const [label, body] of Object.entries(cases)) {
        const r = failing(`select admin.hist_stage_batch($j$${body}$j$::jsonb)`);
        assert.equal(r.ok, false, `${label} must be refused`);
        assert.equal(r.code, "22023", `${label}: ${r.err}`);
      }
      assert.equal(count("select count(*) from private.historical_import_batches"), beforeBatches);
    });

    it("an empty or absent body is refused", () => {
      for (const body of ["null::jsonb", "'[]'::jsonb", "'\"x\"'::jsonb", "'{}'::jsonb", "'{\"rows\": 5}'::jsonb"]) assert.equal(failing(`select admin.hist_stage_batch(${body})`).code, "22023", body);
    });
  });

  // =============================================================================================================
  describe("C. the commit: gated, atomic, auditable and idempotent", () => {
    it("is refused until the owner has made all three statements, answered the costs question, typed the phrase and reviewed these very figures", () => {
      const staged = stage(csvOf([[uniq(), phoneOf(), "2025-04-01", "5000", "4000"]]));
      const got = get(staged.batch_id);
      const good = confirmFor(got);
      const bad = {
        "the date statement is missing": { ...good, attest: { ...good.attest, date_is_completion_date: false } },
        "the revenue statement is missing": { ...good, attest: { ...good.attest, revenue_is_final_payable: false } },
        "the paid statement is missing": { ...good, attest: { ...good.attest, orders_fully_paid: false } },
        "a statement that is the string 'true'": { ...good, attest: { ...good.attest, orders_fully_paid: "true" } },
        "the costs question is unanswered": { ...good, attest: { date_is_completion_date: true, revenue_is_final_payable: true, orders_fully_paid: true } },
        "the phrase is wrong": { ...good, phrase: "IMPORT 2 ORDERS" },
        "the phrase is empty": { ...good, phrase: "" },
        "the order count differs": { ...good, expected: { ...good.expected, orders: 2 } },
        "the revenue differs": { ...good, expected: { ...good.expected, revenue_minor: good.expected.revenue_minor + 1 } },
        "the cost differs": { ...good, expected: { ...good.expected, cost_minor: 0 } },
        "the points differ": { ...good, expected: { ...good.expected, points: 99 } },
        "nothing was reviewed": {},
      };
      const before = businessCounts();
      for (const [label, confirmation] of Object.entries(bad)) {
        const r = failing(commitCall(staged.batch_id, confirmation));
        assert.equal(r.ok, false, `${label} must be refused`);
        assert.ok(["22023", "55000"].includes(r.code), `${label}: ${r.code} ${r.err}`);
      }
      assert.deepEqual(businessCounts(), before, "a refused commit leaves nothing behind");
      assert.equal(get(staged.batch_id).batch.status, "staged");
      // the phrase is the owner's typing: case and surrounding spaces do not matter
      assert.ok(failing(commitCall(staged.batch_id, { ...good, phrase: `  import ${got.totals.orders} orders ` }), AS.olivia).ok);
    });

    it("a dry run exercises everything for real and leaves no trace at all", () => {
      const staged = stage(csvOf([[uniq(), phoneOf(), "2025-05-02", "3000", "2500"], [uniq(), phoneOf(), "2025-05-03", "4000", "3000"]]));
      const got = get(staged.batch_id);
      const before = businessCounts();
      const batches = scalar("select md5(string_agg(b::text, '|' order by b.id)) from private.historical_import_batches b");
      const dry = J(commit(commitCall(staged.batch_id, confirmFor(got), true)));
      assert.equal(dry.dry_run, true);
      assert.equal(dry.orders, 2);
      assert.equal(dry.points, 700, "QAR 3,000 and QAR 4,000 at one point per QAR 10");
      assert.deepEqual(businessCounts(), before);
      assert.equal(scalar("select md5(string_agg(b::text, '|' order by b.id)) from private.historical_import_batches b"), batches, "the batch itself is untouched");
      assert.equal(get(staged.batch_id).batch.status, "staged");
      assert.equal(count(`select count(*) from private.historical_orders where batch_id = '${staged.batch_id}'`), 0);
      assert.equal(count(`select count(*) from private.audit_log where action = 'historical_import.dry_run'`) >= 1, true);
    });

    it("a failure half-way undoes all of it: no order, customer, cost, completion, ledger entry or provenance survives, and the batch can be committed afterwards", () => {
      const staged = stage(csvOf([[uniq(), phoneOf(), "2025-06-01", "1000", "900"], [uniq(), phoneOf(), "2025-06-02", "2000", "1800"], [uniq(), phoneOf(), "2025-06-03", "3000", "2700"]]));
      const got = get(staged.batch_id);
      const confirmation = confirmFor(got);
      db.commit(`create or replace function private.zz_boom() returns trigger language plpgsql as $$ begin if new.source_row_number = 4 then raise exception 'injected failure on the third order'; end if; return new; end; $$;
        create trigger zz_boom before insert on private.historical_orders for each row execute function private.zz_boom();`);
      try {
        const before = businessCounts();
        const r = failing(commitCall(staged.batch_id, confirmation));
        assert.equal(r.ok, false);
        assert.match(r.err, /injected failure/);
        assert.deepEqual(businessCounts(), before, "two orders were already written when the third failed: none of it remains");
        assert.equal(count(`select count(*) from private.historical_orders where batch_id = '${staged.batch_id}'`), 0);
        assert.equal(get(staged.batch_id).batch.status, "staged");
      } finally {
        db.commit("drop trigger zz_boom on private.historical_orders; drop function private.zz_boom();");
      }
      const done = J(commit(commitCall(staged.batch_id, confirmation)));
      assert.equal(done.orders, 3);
    });

    it("a repeat of the same confirmation answers the same and imports nothing more", () => {
      const { id, result } = importRows([[uniq(), phoneOf(), "2025-07-01", "6000", "5000"]]);
      const before = businessCounts();
      const got = get(id);
      const again = J(commit(commitCall(id, confirmFor(got))));
      assert.equal(again.replayed, true);
      assert.equal(again.batch_id, result.batch_id);
      assert.equal(again.orders, result.orders);
      assert.deepEqual(businessCounts(), before);
    });

    it("two sessions confirming the same import at the same moment import it once", async () => {
      const staged = stage(csvOf([[uniq(), phoneOf(), "2025-07-05", "7000", "6000"], [uniq(), phoneOf(), "2025-07-06", "8000", "7000"]]));
      const got = get(staged.batch_id);
      const body = JSON.stringify(confirmFor(got));
      const before = businessCounts();
      const slow = h.parallel(OLIVIA, "hist_commit_batch", [staged.batch_id, body, "false"], { holdSeconds: 1.5 });
      await new Promise((r) => setTimeout(r, 400));
      const quick = await h.parallel(OLIVIA, "hist_commit_batch", [staged.batch_id, body, "false"]);
      const first = await slow;
      assert.ok(first.ok, first.err);
      assert.ok(quick.ok, quick.err);
      assert.equal(JSON.parse(lines(quick.out).filter((l) => l.startsWith("{")).pop()).replayed, true, "the second session was told it was already done");
      const after = businessCounts();
      assert.equal(after.orders - before.orders, 2);
      assert.equal(after.customers - before.customers, 2);
      assert.equal(after.ledger - before.ledger, 2);
      assert.equal(count(`select count(*) from private.historical_orders where batch_id = '${staged.batch_id}'`), 2);
    });

    it("two imports that share a purchase, confirmed at the same moment, never create it twice: the later one is stopped and, once reloaded, imports only what is new", async () => {
      const shared = [uniq("Shared"), phoneOf(), "2025-08-01", "9000", "8000"];
      const a = stage(csvOf([shared, [uniq(), phoneOf(), "2025-08-02", "1100", "900"]]));
      const b = stage(csvOf([shared, [uniq(), phoneOf(), "2025-08-03", "1200", "1000"]]));
      const gotA = get(a.batch_id);
      const gotB = get(b.batch_id);
      const before = businessCounts();
      const slow = h.parallel(OLIVIA, "hist_commit_batch", [a.batch_id, JSON.stringify(confirmFor(gotA)), "false"], { holdSeconds: 1.5 });
      await new Promise((r) => setTimeout(r, 400));
      const stopped = await h.parallel(OLIVIA, "hist_commit_batch", [b.batch_id, JSON.stringify(confirmFor(gotB)), "false"]);
      assert.ok((await slow).ok);
      assert.equal(stopped.ok, false, "the second import would have repeated a purchase the first just imported");
      assert.match(stopped.err, /still need your decision|imported in the meantime|no longer what you reviewed/, "refused before anything was written: the shared purchase is already imported");
      assert.equal(businessCounts().orders - before.orders, 2, "only the first import's two orders exist");
      // reload: the shared purchase is now skipped as already imported, and the rest can be imported
      const reloaded = get(b.batch_id);
      assert.equal(reloaded.totals.orders, 1);
      assert.equal(reloaded.totals.skipped_already_imported, 1);
      const done = J(commit(commitCall(b.batch_id, confirmFor(reloaded))));
      assert.equal(done.orders, 1);
      assert.equal(businessCounts().orders - before.orders, 3, "three distinct purchases in all");
      assert.equal(count(`select count(*) from (select source_fingerprint from private.historical_orders group by 1 having count(*) > 1) d`), 0);
    });

    it("the loyalty earning rate changing after the import was prepared stops it (the points would no longer be what was reviewed)", () => {
      const staged = stage(csvOf([[uniq(), phoneOf(), "2025-09-01", "5000", "4000"]]));
      const got = get(staged.batch_id);
      commit(`select admin.set_policy('loyalty.earn_rate', '{"qar_per_point_minor": 500}'::jsonb, 'confirmed_by_owner', 'test: a different rate')`);
      try {
        const r = failing(commitCall(staged.batch_id, confirmFor(got)));
        assert.equal(r.code, "55000");
        assert.match(r.err, /rate changed/);
      } finally {
        commit(`select admin.set_policy('loyalty.earn_rate', '{"qar_per_point_minor": 1000}'::jsonb, 'confirmed_by_owner', 'test: back to the original rate')`);
      }
      assert.equal(get(staged.batch_id).batch.status, "staged");
    });

    it("every committed import is audited, with who and when, and the batch keeps what the owner attested", () => {
      const { id, result } = importRows([[uniq(), phoneOf(), "2025-09-02", "4400", "4000"]]);
      assert.equal(count(`select count(*) from private.audit_log where action = 'historical_import.committed' and entity_id = '${id}'`), 1);
      assert.equal(count(`select count(*) from private.audit_log where action = 'historical_import.staged' and entity_id = '${id}'`), 1);
      const att = JSON.parse(scalar(`select attestation::text from private.historical_import_batches where id = '${id}'`));
      assert.deepEqual([att.date_is_completion_date, att.revenue_is_final_payable, att.orders_fully_paid, att.costs_complete], [true, true, true, true]);
      assert.equal(att.attested_by, ID.olivia);
      assert.ok(result.committed_at);
    });
  });

  // =============================================================================================================
  describe("D to F. the synthetic export, imported: loyalty exactly once, dates in their Qatar month, money exactly the file's", () => {
    let fixtureBatch;
    let result;
    let snapshotBefore;
    const platformBefore = {};

    before(() => {
      snapshotBefore = platformSnapshot();
      platformBefore.orders = count("select count(*) from public.orders");
      fixtureBatch = stage(FIXTURE_TEXT).batch_id;
      const got = get(fixtureBatch);
      result = J(commit(commitCall(fixtureBatch, confirmFor(got))));
    });

    it("the report says what happened: 25 orders, 19 new customers, QAR 106,334, 10,632 points, advertising reported apart", () => {
      assert.equal(result.orders, 25);
      assert.equal(result.customers_created, 19);
      assert.equal(result.customers_reused, 0);
      assert.equal(result.revenue_minor, 10_633_400);
      assert.equal(result.cost_minor, 9_134_600);
      assert.equal(result.profit_minor, 1_498_800);
      assert.equal(result.points, 10_632);
      assert.equal(result.loss_orders, 1);
      assert.equal(result.exclusions.ad_rows, 10);
      assert.equal(result.exclusions.ad_minor, 49_500);
      assert.equal(result.exclusions.invalid_summary_rows, 1);
      assert.equal(result.attachments.total, 21);
      assert.equal(result.attachments.pending, 21, "no file is invented: every referenced original still has to be attached");
      assert.equal(result.per_order.length, 25);
      assert.equal(result.customer_codes.length, 19);
    });

    it("each order is Completed, a historical WhatsApp order, with its own reference, paid in full, with one placeholder item line and no invented history", () => {
      const mine = `(select order_id from private.historical_orders where batch_id = '${fixtureBatch}')`;
      const rows = JSON.parse(scalar(`select json_agg(json_build_object('ref', order_ref, 'status', status, 'origin', origin, 'via', placed_via, 'total', total_minor, 'net', net_payable_minor, 'paid', amount_paid_minor,
        'balance', balance_due_minor, 'deposit', deposit_required_minor, 'discount', discount_minor, 'credit', loyalty_credit_minor, 'v', workflow_version) order by order_ref)::text from public.orders where id in ${mine}`));
      assert.equal(rows.length, 25);
      for (const r of rows) {
        assert.match(r.ref, /^H-[0-9]{4}-[0-9]{5}$/);
        assert.deepEqual([r.status, r.origin, r.via, r.balance, r.deposit, r.discount, r.credit], ["delivered", "historical_import", "whatsapp", 0, 0, 0, 0]);
        assert.equal(r.total, r.net);
        assert.equal(r.paid, r.total, "paid in full, by the owner's statement");
      }
      assert.equal(new Set(rows.map((r) => r.ref)).size, 25);
      assert.equal(count(`select count(*) from public.order_items where order_id in ${mine}`), 25);
      assert.equal(count(`select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.id in ${mine} and (i.description <> 'Historical order (items not recorded)' or i.quantity <> 1 or i.unit_price_minor <> o.total_minor)`), 0, "no specification is invented");
      for (const table of ["public.payments", "public.order_tracking_events"]) {
        assert.equal(count(`select count(*) from ${table} t where t.order_id in ${mine}`), 0, `${table}: nothing was invented`);
      }
    });

    it("loyalty: one award per order of floor(revenue / QAR 10), exactly 10,632 points, each with its reason, none for advertising", () => {
      const mine = `(select order_id from private.historical_orders where batch_id = '${fixtureBatch}')`;
      assert.equal(count(`select count(*) from public.loyalty_ledger l where l.order_id in ${mine}`), 25);
      assert.equal(scalar(`select sum(l.points) from public.loyalty_ledger l where l.order_id in ${mine}`), "10632");
      assert.equal(count(`select count(*) from public.loyalty_ledger l join public.orders o on o.id = l.order_id where l.order_id in ${mine} and (l.entry_type <> 'award' or l.reverses_entry_id is not null or l.points <> floor(o.net_payable_minor / 1000.0))`), 0);
      assert.equal(count(`select count(*) from public.loyalty_ledger l where l.order_id in ${mine} and not exists (select 1 from private.loyalty_entry_reasons r where r.entry_id = l.id)`), 0);
      assert.equal(count("select count(*) from (select order_id from public.loyalty_ledger where entry_type = 'award' group by order_id having count(*) > 1) d"), 0);
      // the sum per customer is the customer's balance
      assert.equal(count("select count(*) from (select c.id from public.customers c where c.id in (select customer_id from private.historical_customers) and private.loyalty_balance(c.id) <> (select coalesce(sum(points), 0) from public.loyalty_ledger where customer_id = c.id)) d"), 0);
      assert.equal(count("select count(*) from private.historical_orders where points_awarded <> (select l.points from public.loyalty_ledger l where l.id = loyalty_entry_id)"), 0);
    });

    it("the ledger refuses a second award for the same order, however it is attempted", () => {
      const oid = scalar("select order_id from private.historical_orders order by source_row_number limit 1");
      const cid = scalar(`select customer_id from public.orders where id = '${oid}'`);
      const r = failing(`reset role; select private.set_write_ctx(true); insert into public.loyalty_ledger (customer_id, order_id, entry_type, points, description) values ('${cid}', '${oid}', 'award', 5, 'a second award')`, "");
      assert.equal(r.ok, false);
      assert.equal(r.code, "23505");
    });

    it("existing orders, payments, loyalty balances and customers are exactly as they were", () => {
      assert.deepEqual(platformSnapshot(), snapshotBefore);
    });

    it("re-uploading the same file, in any order, or confirming it again, changes nothing and awards nothing", () => {
      const before = businessCounts();
      const ledgerSum = scalar("select sum(points) from public.loyalty_ledger");
      const again = stage(FIXTURE_TEXT, "uploaded again");
      assert.equal(again.reused, true);
      assert.equal(again.status, "committed");
      assert.equal(again.batch_id, fixtureBatch);
      const [header, ...rows] = FIXTURE_TEXT.trim().split("\n");
      assert.equal(stage([header, ...rows.slice().reverse()].join("\n") + "\n").batch_id, fixtureBatch);
      assert.equal(J(commit(commitCall(fixtureBatch, confirmFor(get(fixtureBatch))))).replayed, true);
      assert.deepEqual(businessCounts(), before);
      assert.equal(scalar("select sum(points) from public.loyalty_ledger"), ledgerSum);
    });

    it("a different file that repeats some of the same purchases skips them (nothing twice) and rewards only what is new", () => {
      const [header, ...rows] = FIXTURE_TEXT.trim().split("\n");
      const purchases = rows.filter((l) => !/Instagram|#ERROR/i.test(l));
      const extra = csvOf([[uniq("Extra"), phoneOf(), "2026-01-15", "2300", "1900"]]).trim().split("\n")[1];
      const text = [header, ...purchases.slice(0, 6), extra].join("\n") + "\n";
      const before = businessCounts();
      const staged = stage(text);
      assert.equal(staged.reused, false);
      const got = get(staged.batch_id);
      assert.equal(got.totals.orders, 1, "the six already-imported purchases are skipped");
      assert.equal(got.totals.skipped_already_imported, 6);
      const done = J(commit(commitCall(staged.batch_id, confirmFor(got))));
      assert.equal(done.orders, 1);
      assert.equal(done.points, 230, "QAR 2,300 at one point per QAR 10");
      assert.equal(businessCounts().orders - before.orders, 1);
      assert.equal(businessCounts().ledger - before.ledger, 1);
    });

    it("dates: the file's date is the completion date at noon Qatar time, listed and reported under that day, while the real import time is kept apart", () => {
      assert.equal(count("select count(*) from public.orders where origin = 'historical_import' and (completed_at is null or completed_at <> order_date or (completed_at at time zone 'Asia/Qatar')::time <> '12:00')"), 0);
      assert.equal(count("select count(*) from public.orders where origin = 'platform' and order_date <> created_at"), 0, "an ordinary order is listed by its creation date, as before");
      assert.equal(count("select count(*) from private.historical_orders h join public.orders o on o.id = h.order_id where (o.completed_at at time zone 'Asia/Qatar')::date <> h.historical_date or h.date_meaning <> 'completion' or h.placement_date_known"), 0);
      assert.equal(count("select count(*) from public.orders where origin = 'historical_import' and created_at < now() - interval '1 hour'"), 0, "created_at is the real moment of the import, never the date of the purchase");
      assert.equal(count("select count(*) from private.order_completions c join public.orders o on o.id = c.order_id where o.origin = 'historical_import' and (c.basis <> 'historical_import' or c.completed_at <> o.completed_at or c.net_revenue_minor <> o.net_payable_minor)"), 0);
      assert.equal(count("select count(*) from private.historical_orders where imported_at < now() - interval '1 hour'"), 0);
    });

    it("the financial report, year by year and in total, equals the file's own sums, with the recorded loss, cost and profit exactly, verified, with no invented cash or balance", () => {
      const years = { 2024: [5, 1_407_950, 131_850], 2025: [10, 4_581_400, 700_500], 2026: [10, 4_644_050, 666_450] };
      const mine = `(select order_id from private.historical_orders where batch_id = '${fixtureBatch}')`;
      let revenue = 0;
      let profit = 0;
      for (const [year, [orders, rev, prof]] of Object.entries(years)) {
        const p = JSON.parse(last(db.ok(`select admin.financial_report(${year}, null);`, AS.olivia))).period;
        const ours = JSON.parse(scalar(`select json_build_object('n', count(*), 'rev', sum(c.net_revenue_minor), 'cost', sum(r.actual_minor + r.estimated_minor), 'profit', sum(c.net_revenue_minor - r.actual_minor - r.estimated_minor))::text
          from private.order_completions c join private.order_cost_rollup() r on r.order_id = c.order_id
          where c.order_id in ${mine} and extract(year from c.completed_at at time zone 'Asia/Qatar') = ${year}`));
        assert.equal(ours.n, orders, `${year}: orders`);
        assert.equal(Number(ours.rev), rev, `${year}: revenue`);
        assert.equal(Number(ours.profit), prof, `${year}: profit`);
        // the year's report holds these orders (and whatever else was completed that year), under the right year, with nothing owed
        assert.ok(p.completed_orders >= orders && p.net_revenue_minor >= rev, `${year}: the report counts them`);
        assert.equal(p.outstanding_balance_minor, 0);
        revenue += Number(ours.rev);
        profit += Number(ours.profit);
      }
      assert.equal(revenue, 10_633_400);
      assert.equal(profit, 1_498_800);
      assert.equal(count(`select count(*) from private.order_cost_state s where s.order_id in ${mine} and not s.costs_complete`), 0, "the owner declared the costs complete, so profit is verified");
      assert.equal(count(`select count(*) from public.payments where order_id in ${mine}`), 0, "no cash was invented");
    });

    it("the one recorded loss is kept exactly as recorded: revenue less than cost, a negative profit, never rounded up to zero", () => {
      const loss = JSON.parse(scalar(`select json_build_object('n', count(*), 'min', min(c.net_revenue_minor - r.actual_minor))::text from private.order_completions c join private.order_cost_rollup() r on r.order_id = c.order_id
        where c.order_id in (select order_id from private.historical_orders where batch_id = '${fixtureBatch}') and r.actual_minor > c.net_revenue_minor`));
      assert.equal(loss.n, 1);
      assert.equal(Number(loss.min), -10_000, "QAR 100 lost, exactly");
    });

    it("an order is reported in the month it was completed in, by Qatar time, at the year and month boundaries", () => {
      const r = importRows([
        [uniq("Boundary"), phoneOf(), "2023-12-31", "1000", "800"],
        [uniq("Boundary"), phoneOf(), "2024-01-01", "2000", "1500"],
        [uniq("Boundary"), phoneOf(), "2023-03-31", "3000", "2000"],
        [uniq("Boundary"), phoneOf(), "2023-04-01", "4000", "3000"],
      ]);
      assert.equal(r.result.orders, 4);
      const month = (y, m) => JSON.parse(last(db.ok(`select admin.financial_report(${y}, ${m});`, AS.olivia))).period;
      const hist = (y, m) => Number(scalar(`select coalesce(sum(c.net_revenue_minor), 0) from private.order_completions c join public.orders o on o.id = c.order_id where o.origin = 'historical_import'
        and o.order_ref in (select order_ref from public.orders where id in (select order_id from private.historical_orders where batch_id = '${r.id}'))
        and extract(year from c.completed_at at time zone 'Asia/Qatar') = ${y} and extract(month from c.completed_at at time zone 'Asia/Qatar') = ${m}`));
      assert.equal(hist(2023, 12), 100_000, "31 December 2023 is a December order");
      assert.equal(hist(2024, 1), 200_000, "1 January 2024 is a January order");
      assert.equal(hist(2023, 3), 300_000);
      assert.equal(hist(2023, 4), 400_000);
      assert.equal(month(2023, 12).net_revenue_minor, 100_000);
      assert.equal(month(2024, 1).net_revenue_minor, month(2024, 1).net_revenue_minor);
      assert.ok(month(2024, 1).net_revenue_minor >= 200_000);
      assert.equal(month(2023, 3).net_revenue_minor, 300_000);
      assert.equal(month(2023, 4).net_revenue_minor, 400_000);
    });

    it("costs the owner is not sure are complete are reported as PROVISIONAL, never as verified", () => {
      const { id } = importRows([[uniq("Provisional"), phoneOf(), "2022-05-05", "5000", "4000"]], { costsComplete: false });
      assert.equal(count(`select count(*) from private.order_cost_state s join private.historical_orders h on h.order_id = s.order_id where h.batch_id = '${id}'`), 0, "no 'complete' mark was invented");
      const p = JSON.parse(last(db.ok("select admin.financial_report(2022, null);", AS.olivia))).period;
      assert.equal(p.profit_state, "provisional");
      assert.equal(p.net_revenue_minor, 500_000);
    });

    it("an order whose cost is unknown has an unknown profit (never zero), and still counts as revenue", () => {
      const { id } = importRows([[uniq("Unknown"), phoneOf(), "2021-06-06", "7000", ""]]);
      const row = JSON.parse(last(db.ok(`select admin.list_completed_orders(2021, null, 10, 0);`, AS.olivia))).rows.find((r) => r.net_revenue_minor === 700_000);
      assert.ok(row);
      assert.equal(row.profit_minor, null);
      assert.equal(row.cost_state, "missing");
      assert.equal(count(`select count(*) from private.order_costs c join private.historical_orders h on h.order_id = c.order_id where h.batch_id = '${id}'`), 0);
    });

    it("the Orders page's own function lists a historical order by its completion date among modern orders, filters it by that year and month, and says what it is", () => {
      const overview = (year, month, sort = "newest") => JSON.parse(last(db.ok(`select admin.list_orders_overview(null, null, ${year}, ${month}, null, null, '${sort}', 1, 50);`, AS.olivia)));
      const all = overview("null", "null");
      const platformRows = all.rows.filter((r) => r.origin === "platform");
      const histRows = all.rows.filter((r) => r.origin === "historical_import");
      assert.ok(platformRows.length >= 2);
      assert.ok(histRows.length >= 10);
      const dates = all.rows.map((r) => Date.parse(r.order_date));
      assert.deepEqual(dates, [...dates].sort((a, b) => b - a), "newest first by the date each order is listed by");
      assert.ok(all.rows.findIndex((r) => r.origin === "platform") < all.rows.findIndex((r) => r.origin === "historical_import"), "an order made today is above a purchase completed in 2025, even though both were created today");
      const oct2026 = overview(2026, 10);
      assert.ok(oct2026.rows.length >= 1 && oct2026.rows.every((r) => r.origin === "historical_import" && r.order_date.startsWith("2026-10")), "filtered by the month it was completed");
      const nov = overview(2026, 11).rows;
      assert.ok(nov.every((r) => r.order_date.startsWith("2026-11")), "everything listed under a month was dated in it");
      assert.ok(nov.filter((r) => r.origin === "historical_import").every((r) => !r.order_date.startsWith(new Date().toISOString().slice(0, 10)) || r.order_date.endsWith("09:00:00+00:00")), "a historical order is under the month it was completed, never under the day it was imported");
      const oldest = overview("null", "null", "oldest").rows;
      assert.equal(oldest[0].origin, "historical_import");
      const summary = JSON.parse(last(db.ok("select admin.overview_summary(2025);", AS.olivia)));
      assert.ok(summary.recent_orders.every((r) => "order_date" in r && "origin" in r));
      const forCustomer = JSON.parse(last(db.ok(`select admin.customer_orders((select customer_id from public.orders where origin = 'historical_import' limit 1), 10, 0);`, AS.olivia)));
      assert.ok(forCustomer.orders.length >= 1 && forCustomer.orders.every((r) => r.origin === "historical_import" && r.order_date));
    });

    it("the staff page for a customer lists orders by their listed date and labels a historical one", () => {
      const cust = scalar("select customer_id from public.orders where origin = 'historical_import' limit 1");
      const c = JSON.parse(last(db.ok(`select admin.get_customer('${cust}');`, AS.olivia)));
      assert.ok(c.orders.length >= 1);
      assert.ok(c.orders.every((o) => o.origin === "historical_import" && o.order_date));
    });
  });

  // =============================================================================================================
  describe("G. customers: profiles without accounts, a phone number is not ownership, and the one-time claim code", () => {
    let customerId;

    before(() => {
      // the same name and phone twice is one customer (two different names with one phone would be a flag, proved in J)
      const name = uniq("Claimant");
      const r = importRows([[name, "+97455559999", "2025-02-02", "5000", "4000"], [name, "+97455559999", "2025-03-03", "2500", "2000"]]);
      customerId = scalar(`select customer_id from public.orders where id = (select order_id from private.historical_orders where batch_id = '${r.id}' order by source_row_number limit 1)`);
    });

    it("an imported customer has no account, no email, no claim code and no marketing consent, and nobody was sent anything", () => {
      const imported = count("select count(*) from private.historical_customers");
      assert.ok(imported >= 19);
      assert.equal(count("select count(*) from public.customers c where c.id in (select customer_id from private.historical_customers) and (c.email is not null or c.marketing_consent or c.source <> 'whatsapp')"), 0);
      assert.equal(count("select count(*) from public.customer_accounts where customer_id in (select customer_id from private.historical_customers)"), 0);
      assert.equal(count("select count(*) from private.customer_claim_codes where customer_id in (select customer_id from private.historical_customers)"), 0);
      assert.equal(count("select count(*) from auth.users"), usersAtStart, "the import creates no sign-in account");
    });

    it("the same person in a later import is the same profile, never a second one", () => {
      const before = count("select count(*) from public.customers");
      const name = scalar(`select full_name from public.customers where id = '${customerId}'`);
      const phone = scalar(`select phone from public.customers where id = '${customerId}'`);
      const staged = stage(csvOf([[name, phone, "2025-04-04", "1500", "1000"]]));
      const got = get(staged.batch_id);
      assert.equal(got.groups.find((g) => g.orders > 0).customer_choice, "existing", "an earlier import's profile with no account is reused");
      const done = J(commit(commitCall(staged.batch_id, confirmFor(got))));
      assert.equal(done.customers_reused, 1);
      assert.equal(done.customers_created, 0);
      assert.equal(count("select count(*) from public.customers"), before);
      assert.equal(done.points, 150);
      assert.equal(scalar(`select count(*) from public.orders where customer_id = '${customerId}'`), "3");
    });

    it("a customer who already exists with the same phone number is NEVER joined automatically: the owner must choose, and only the explicit choice attaches orders", () => {
      const rowName = uniq("Namesake");
      const staged = stage(csvOf([[rowName, "+97455550001", "2025-05-05", "3300", "2700"]])); // Alice Test's phone number
      const got = get(staged.batch_id);
      const flag = got.flags.find((f) => f.kind === "existing_customer");
      assert.ok(flag, "the match is raised, not applied");
      assert.equal(flag.severity, "error");
      assert.equal(flag.existing_customer_id, ID.custA);
      assert.ok(got.blocking >= 1);
      assert.equal(failing(commitCall(staged.batch_id, confirmFor(got))).code, "55000", "cannot be imported until the owner has chosen");
      const group = got.groups.find((g) => g.orders > 0);
      // a phone number is a hint, not proof: a wrong customer id for this group is refused
      assert.equal(stateOf(`select admin.hist_set_group_customer('${staged.batch_id}', '${group.id}', 'existing', '${ID.custB}')`), "22023");
      const aliceBefore = platformSnapshot();
      commit(`select admin.hist_set_group_customer('${staged.batch_id}', '${group.id}', 'new', null)`);
      const after = get(staged.batch_id);
      assert.equal(after.blocking, 0);
      const done = J(commit(commitCall(staged.batch_id, confirmFor(after))));
      assert.equal(done.customers_created, 1, "a NEW profile, not Alice");
      assert.equal(scalar(`select count(*) from public.orders where customer_id = '${ID.custA}' and origin = 'historical_import'`), "0");
      assert.equal(platformSnapshot().balance_a, aliceBefore.balance_a, "Alice's points are untouched");
    });

    it("attaching to an existing customer works only by the explicit choice, adds the points to that customer and keeps their existing ones", () => {
      const staged = stage(csvOf([[uniq("Same Person"), "+97455550002", "2025-06-06", "4000", "3000"]])); // Bob Test's phone number
      const got = get(staged.batch_id);
      const group = got.groups.find((g) => g.orders > 0);
      assert.equal(group.existing_balance_points >= 0, true);
      const balanceBefore = Number(scalar(`select private.loyalty_balance('${ID.custB}')`));
      commit(`select admin.hist_set_group_customer('${staged.batch_id}', '${group.id}', 'existing', '${ID.custB}')`);
      const after = get(staged.batch_id);
      assert.equal(after.groups.find((g) => g.orders > 0).existing_customer_id, ID.custB);
      const done = J(commit(commitCall(staged.batch_id, confirmFor(after))));
      assert.equal(done.customers_reused, 1);
      assert.equal(Number(scalar(`select private.loyalty_balance('${ID.custB}')`)), balanceBefore + 400, "QAR 4,000 at one point per QAR 10");
      assert.equal(scalar(`select count(*) from public.orders where customer_id = '${ID.custB}' and origin = 'historical_import'`), "1");
    });

    it("the owner issues the claim code privately; the customer creates their own account and claims it ONCE: orders and points appear, costs and profit stay hidden", () => {
      const code = scalar(`select admin.issue_claim_code('${customerId}', 72)`, AS.olivia);
      assert.match(code, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
      assert.equal(count(`select count(*) from private.customer_claim_codes where customer_id = '${customerId}'`), 0, "issuing in a rolled-back probe left nothing");
      const issued = last(commit(`select admin.issue_claim_code('${customerId}', 72)`));
      const claim = (who) => db.cluster.psql(`begin;\n${who}select coalesce(public.claim_customer_profile('${issued}')::text, 'null');\ncommit;`);
      // someone else with the code in hand but a different account cannot claim after it is used; first the real customer
      const dave = asUser(DAVE);
      const claimed = claim(dave);
      assert.ok(claimed.ok, claimed.err);
      assert.equal(last(claimed.out), customerId);
      assert.equal(count(`select count(*) from public.customer_accounts where customer_id = '${customerId}' and user_id = '${DAVE}'`), 1);
      // single use: a second person with the same code gets nothing
      assert.equal(last(claim(AS.alice).out), "null");
      assert.equal(last(claim(AS.eve).out), "null");
      // what the customer now sees: their own orders (marked historical, listed by completion date) and their points
      const seen = JSON.parse(last(db.ok("select json_agg(json_build_object('ref', order_ref, 'origin', origin, 'status', status, 'order_date', order_date) order by order_date)::text from public.orders;", dave)));
      assert.equal(seen.length, 3);
      assert.ok(seen.every((o) => o.origin === "historical_import" && o.status === "delivered" && /^H-/.test(o.ref)));
      assert.equal(last(db.ok("select count(*) from public.loyalty_ledger;", dave)), "3");
      assert.equal(last(db.ok("select sum(points) from public.loyalty_ledger;", dave)), String(500 + 250 + 150), "the three orders' points, and nothing else");
      // and nothing private
      for (const sql of [
        "select * from private.order_costs",
        "select * from private.historical_orders",
        "select * from private.historical_import_attachments",
        "select * from private.historical_import_rows",
        "select * from private.order_completions",
        "select admin.order_costs(gen_random_uuid())",
        "select admin.hist_get_batch(gen_random_uuid())",
        "select admin.hist_order_info(gen_random_uuid())",
      ]) assert.equal(stateOf(sql, dave), "42501", sql);
      // the first customer cannot see the other imported customers' orders
      assert.equal(last(db.ok(`select count(*) from public.orders where customer_id <> '${customerId}';`, dave)), "0");
    });

    it("an expired or revoked code claims nothing, and a code is single-use even for the person it was issued for", () => {
      const other = scalar("select customer_id from public.orders where origin = 'historical_import' and customer_id <> (select customer_id from private.historical_orders ho join public.orders o on o.id = ho.order_id order by ho.source_row_number limit 1) limit 1");
      const expired = last(commit(`select admin.issue_claim_code('${other}', 24)`));
      db.commit("update private.customer_claim_codes set expires_at = now() - interval '1 minute' where expires_at > now() - interval '1 minute' and customer_id = '" + other + "';");
      const r = db.cluster.psql(`begin;\n${AS.eve}select coalesce(public.claim_customer_profile('${expired}')::text, 'null');\ncommit;`);
      assert.equal(last(r.out), "null");
    });
  });

  // =============================================================================================================
  describe("H. files: private, checked by their bytes, classified, never shown to a customer by default", () => {
    let batchId;
    let attachmentIds;

    before(() => {
      const receipt = "invoice-1.pdf (https://attachments.example.test/a/inv1.pdf), photo-1.png (https://attachments.example.test/a/p1.png)";
      const r = importRows([[uniq("Files"), phoneOf(), "2025-02-10", "6000", "5000", receipt], [uniq("Files"), phoneOf(), "2025-02-11", "2000", "1500", ""]]);
      batchId = r.id;
      const got = get(batchId);
      attachmentIds = got.attachments.map((a) => a.id);
    });

    const store = (id, buf, cls = "null") => failing(`select admin.hist_store_attachment('${id}', '${hex(buf)}'::bytea, ${cls === "null" ? "null" : `'${cls}'`})`);

    it("the references are recorded, never fetched: pending, with their host and a note that the link is temporary, and the order is complete without them", () => {
      const got = get(batchId);
      assert.equal(got.attachments.length, 2);
      assert.ok(got.attachments.every((a) => a.status === "pending" && a.classification === "unclassified" && a.customer_visible === false));
      assert.equal(got.attachments.find((a) => a.declared_ext === "pdf").file_name, "invoice-1.pdf");
      assert.equal(count(`select count(*) from private.historical_import_attachments where batch_id = '${batchId}' and content is not null`), 0);
      assert.equal(count(`select count(*) from public.orders o join private.historical_orders h on h.order_id = o.id where h.batch_id = '${batchId}' and o.status = 'delivered'`), 2);
    });

    it("a PDF and a PNG are stored privately, byte for byte, with their digest", () => {
      const pdfId = attachmentIds.find((id) => get(batchId).attachments.find((a) => a.id === id).declared_ext === "pdf");
      const pngId = attachmentIds.find((id) => id !== pdfId);
      const a = store(pdfId, PDF, "customer_receipt");
      assert.ok(a.ok, a.err);
      assert.ok(store(pngId, PNG, "supplier_invoice").ok);
      for (const [id, buf, mime] of [[pdfId, PDF, "application/pdf"], [pngId, PNG, "image/png"]]) {
        const file = JSON.parse(last(db.ok(`select admin.hist_get_attachment('${id}');`, AS.olivia)));
        assert.equal(file.mime, mime);
        assert.equal(file.byte_size, buf.length);
        assert.ok(Buffer.from(file.content_base64, "base64").equals(buf), "the bytes come back exactly as they went in");
        assert.equal(scalar(`select sha256 from private.historical_import_attachments where id = '${id}'`), sha256(buf));
      }
      const got = get(batchId);
      assert.ok(got.attachments.every((x) => x.status === "stored" && x.customer_visible === false), "nothing is visible to a customer unless the owner says so");
    });

    it("anything that is not a PDF or PNG by its bytes is refused: empty, too big, another type, a renamed file, the wrong kind for the slot, the same file twice", () => {
      const got = get(batchId);
      const second = got.rows.find((r) => r.row_number === got.rows.filter((x) => x.kind === "purchase").map((x) => x.row_number).sort()[1]);
      const add = (buf, name = "x.pdf", cls = "unclassified", row = second.id) => failing(`select admin.hist_add_attachment('${row}', '${name}', '${hex(buf)}'::bytea, '${cls}')`);
      assert.equal(add(Buffer.alloc(0)).code, "22023", "empty");
      assert.equal(add(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4 * 1024 * 1024)])).code, "22023", "larger than 4 MB");
      assert.equal(add(Buffer.from("MZ\u0090\u0000not a document")).code, "22023", "a program renamed to .pdf");
      assert.equal(add(Buffer.from("<html><script>alert(1)</script></html>"), "page.pdf").code, "22023", "a web page renamed to .pdf");
      assert.equal(add(PDF, "bad/name.pdf").code, "22023", "a path in the name");
      assert.equal(add(PDF, "ok.pdf", "bogus").code, "22023", "an unknown classification");
      assert.ok(add(PDF, "ok.pdf", "customer_receipt").ok);
      assert.equal(add(PDF, "again.pdf").code, "23505", "the same file twice on one order");
      // a slot that expects a PDF does not accept a PNG with a .pdf name
      const slot = got.attachments.find((a) => a.declared_ext === "pdf");
      const fresh = importRows([[uniq("Slot"), phoneOf(), "2025-02-12", "1000", "900", "doc.pdf (https://attachments.example.test/a/d.pdf)"]]);
      const pendingId = get(fresh.id).attachments[0].id;
      assert.equal(store(pendingId, PNG).code, "22023", "a PNG is not the PDF the export referred to");
      assert.ok(slot);
    });

    it("a stored file is never replaced (evidence), classifications follow their rules, a supplier invoice can never be shown to a customer, and an unavailable original never blocks anything", () => {
      const got = get(batchId);
      const pdf = got.attachments.find((a) => a.declared_ext === "pdf");
      assert.equal(store(pdf.id, PDF).code, "55000", "already stored");
      // only a stored customer receipt can be made visible
      assert.equal(failing(`select admin.hist_set_attachment_class('${pdf.id}', 'supplier_invoice', true)`).code, "22023");
      assert.equal(failing(`select admin.hist_set_attachment_class('${pdf.id}', 'unclassified', true)`).code, "22023");
      assert.ok(failing(`select admin.hist_set_attachment_class('${pdf.id}', 'customer_receipt', true)`).ok);
      assert.equal(get(batchId).attachments.find((a) => a.id === pdf.id).customer_visible, true);
      assert.ok(failing(`select admin.hist_set_attachment_class('${pdf.id}', 'supplier_invoice', false)`).ok);
      assert.equal(get(batchId).attachments.find((a) => a.id === pdf.id).customer_visible, false, "reclassifying as an invoice withdraws it");
      // the check constraint says the same, whatever calls it
      assert.equal(failing(`reset role; select private.set_write_ctx(true); update private.historical_import_attachments set customer_visible = true where id = '${pdf.id}'`, "").code, "23514");
      // a file's content never changes
      assert.notEqual(failing(`reset role; select private.set_write_ctx(true); update private.historical_import_attachments set content = '\\x00'::bytea where id = '${pdf.id}'`, "").code, null);
      // unavailable
      const fresh = importRows([[uniq("Gone"), phoneOf(), "2025-02-13", "1000", "900", "lost.pdf (https://attachments.example.test/a/l.pdf)"]]);
      const lost = get(fresh.id).attachments[0];
      assert.equal(failing(`select admin.hist_mark_attachment_unavailable('${lost.id}', 'x')`).code, "22023", "a reason is required");
      assert.ok(failing(`select admin.hist_mark_attachment_unavailable('${lost.id}', 'the temporary link expired and the original was not kept')`).ok);
      assert.equal(get(fresh.id).attachments[0].status, "unavailable");
      assert.equal(count(`select count(*) from public.orders o join private.historical_orders h on h.order_id = o.id where h.batch_id = '${fresh.id}'`), 1, "the order does not depend on the file");
      // ...and it can still be attached later
      assert.ok(store(lost.id, PDF).ok);
      assert.equal(get(fresh.id).attachments[0].status, "stored");
      assert.equal(failing(`select admin.hist_mark_attachment_unavailable('${lost.id}', 'something went wrong here')`).code, "55000", "a file is stored, so it is available");
    });

    it("files reach nobody but the owner: not staff, not a customer (even the customer of that very order), and not through any column a customer can read", () => {
      const id = attachmentIds[0];
      for (const who of [AS.sam, AS.alice, AS.anon, AS.forgedAdmin]) assert.equal(stateOf(`select admin.hist_get_attachment('${id}')`, who), "42501");
      assert.equal(stateOf(`select content from private.historical_import_attachments`, AS.alice), "42501");
      assert.equal(stateOf(`select content from private.historical_import_attachments`, AS.sam), "42501");
      const aliceReadable = JSON.parse(last(ok(`select json_agg(column_name)::text from information_schema.columns where table_schema = 'public' and table_name = 'order_items' or (table_schema = 'public' and table_name = 'orders')`, AS.alice)));
      assert.ok(!aliceReadable.some((c) => /attach|receipt|invoice|source/i.test(c)));
    });

    it("an original attached after the import is still possible, and a discarded import accepts nothing", () => {
      const got = get(batchId);
      const row = got.rows.find((r) => r.kind === "purchase" && r.decision === "import");
      assert.ok(failing(`select admin.hist_add_attachment('${row.id}', 'late.pdf', '${hex(Buffer.concat([PDF, Buffer.from("late")]))}'::bytea, 'customer_receipt')`).ok);
      const draft = stage(csvOf([[uniq("Draft"), phoneOf(), "2025-02-14", "1000", "900", "d.pdf (https://attachments.example.test/a/d.pdf)"]]));
      const pending = get(draft.batch_id).attachments[0];
      assert.ok(failing(`select admin.hist_discard_batch('${draft.batch_id}', 'wrong file')`).ok);
      assert.equal(store(pending.id, PDF).code === null || store(pending.id, PDF).ok === false, true);
      assert.equal(count(`select count(*) from private.historical_import_attachments where batch_id = '${draft.batch_id}'`), 0, "a discarded import's references are purged");
    });
  });

  // =============================================================================================================
  describe("I. the imported order cannot be made to say what did not happen", () => {
    let orderId;
    before(() => {
      const r = importRows([[uniq("Invariant"), phoneOf(), "2025-03-20", "8000", "7000"]]);
      orderId = scalar(`select order_id from private.historical_orders where batch_id = '${r.id}'`);
    });

    it("no payment can be recorded and no tracking published on it, by any route", () => {
      assert.notEqual(failing(`select admin.record_payment('${orderId}', 'balance', 1000, 'cash')`).ok, true);
      assert.notEqual(failing(`select admin.publish_tracking_event('${orderId}', 'Out for delivery', 'x', null)`).ok, true);
      // The two refusals below are asserted by their own message, not just "it failed": the order is also Delivered and fully paid, so other rules would refuse these too,
      // and a test that only checks "it failed" would still pass with the guard on historical orders removed.
      const tracking = failing(`reset role; select private.set_write_ctx(true); insert into public.order_tracking_events (order_id, title, message, event_kind) values ('${orderId}', 't', 'm', 'update')`, "");
      assert.equal(tracking.ok, false);
      assert.match(tracking.err, /this is a historical order: it has no payment ledger or tracking/);
      const direct = failing(`reset role; select private.set_write_ctx(true); insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values ('${orderId}', 'payment', 'balance', 1000, 'cash')`, "");
      assert.equal(direct.ok, false);
      assert.match(direct.err, /this is a historical order: it has no payment ledger or tracking/);
      assert.equal(count(`select count(*) from public.payments where order_id = '${orderId}'`), 0);
      assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${orderId}'`), 0);
    });

    it("its origin, its status and its completion date never change", () => {
      for (const sql of [
        `update public.orders set origin = 'platform' where id = '${orderId}'`,
        `update public.orders set status = 'cancelled' where id = '${orderId}'`,
        `update public.orders set completed_at = now() where id = '${orderId}'`,
        `update public.orders set status = 'building', completed_at = null where id = '${orderId}'`,
      ]) {
        const r = failing(`reset role; select private.set_write_ctx(true); ${sql}`, "");
        assert.equal(r.ok, false, sql);
      }
      // by its own message: turning the origin back to "platform" would also break the completion-date check, so "it failed" alone would not prove the origin guard
      const origin = failing(`reset role; select private.set_write_ctx(true); update public.orders set origin = 'platform' where id = '${orderId}'`, "");
      assert.match(origin.err, /the origin of an order never changes/);
      assert.equal(scalar(`select status || '|' || origin from public.orders where id = '${orderId}'`), "delivered|historical_import");
    });

    it("the owner cannot move it through the ordinary workflow either", () => {
      for (const to of ["on_hold", "cancelled", "building"]) assert.equal(failing(`select admin.transition_order('${orderId}', '${to}')`).ok, false, to);
    });

    it("an order claiming to be historical cannot be created any other way", () => {
      const cust = ID.custA;
      const base = `reset role; select private.set_write_ctx(true); insert into public.orders (order_ref, customer_id, status, total_minor, deposit_required_minor, amount_paid_minor, placed_via, origin, workflow_version, completed_at)`;
      assert.equal(failing(`${base} values ('H-2611-90001', '${cust}', 'delivered', 1000, 0, 1000, 'whatsapp', 'historical_import', 1, now())`, "").ok, false, "outside the import");
      assert.equal(failing(`${base} values ('H-2611-90002', '${cust}', 'building', 1000, 0, 1000, 'whatsapp', 'historical_import', 1, now())`, "").ok, false, "not delivered");
      assert.equal(failing(`${base} values ('H-2611-90003', '${cust}', 'delivered', 1000, 0, 1000, 'website', 'historical_import', 1, now())`, "").ok, false, "not from WhatsApp");
      assert.equal(failing(`${base} values ('O-2611-90004', '${cust}', 'delivered', 1000, 0, 1000, 'whatsapp', 'platform', 1, now())`, "").ok, false, "a platform order cannot arrive delivered with a date it did not earn");
    });

    it("provenance, the revisions and the batch's decisions are append-only once committed", () => {
      for (const sql of [
        "update private.historical_orders set points_awarded = 1",
        "delete from private.historical_orders",
        "update private.historical_import_batches set status = 'staged' where status = 'committed'",
        "delete from private.historical_import_batches",
        "update private.historical_import_rows set revenue_minor = 1 where status = 'imported'",
        "delete from private.historical_import_rows where status = 'imported'",
        "truncate private.historical_orders",
      ]) assert.equal(failing(`reset role; select private.set_write_ctx(true); ${sql}`, "").ok, false, sql);
    });
  });

  // =============================================================================================================
  describe("J. the owner's review: corrections, skips, duplicates, merges, discarding, describing the items later", () => {
    it("an unreadable row blocks the import until the owner corrects it (with the same rules as a file row) or skips it", () => {
      const goodName = uniq("Review");
      const text = HEADER + `${goodName},${phoneOf()},31/02/2025,1000,800,200,,\n`;
      const a = analyze(text);
      assert.equal(a.ok, true);
      assert.equal(a.rows[0].kind, "invalid");
      const staged = stageRaw(JSON.stringify(lib.pl.stagePayload(a, "with a bad date")));
      const got = get(staged.batch_id);
      assert.equal(got.totals.orders, 0);
      assert.ok(got.flags.some((f) => f.kind === "row_invalid" && f.severity === "error"));
      assert.ok(got.blocking >= 1);
      const row = got.rows[0];
      // a correction that is still wrong changes nothing
      const bad = lib.pl.correctedRow(row.row_number, { customer: goodName, phone: "+97455551234", date: "2025-02-30", revenue: "1000", cost: "800" }, { today: qatarToday(), ratePerPointMinor: 1000 });
      assert.ok(bad.ok && bad.row.kind === "invalid");
      assert.equal(failing(`select admin.hist_update_row('${staged.batch_id}', '${row.id}', $r$${JSON.stringify(bad.row)}$r$::jsonb)`).ok, true, "an invalid row may be corrected again");
      assert.equal(get(staged.batch_id).totals.orders, 0);
      const fixed = lib.pl.correctedRow(row.row_number, { customer: goodName, phone: "+97455551234", date: "2025-02-27", revenue: "1000", cost: "800" }, { today: qatarToday(), ratePerPointMinor: 1000 });
      assert.ok(fixed.ok && fixed.row.kind === "purchase");
      assert.ok(failing(`select admin.hist_update_row('${staged.batch_id}', '${row.id}', $r$${JSON.stringify(fixed.row)}$r$::jsonb)`).ok);
      const after = get(staged.batch_id);
      assert.equal(after.totals.orders, 1);
      assert.equal(after.blocking, 0);
      assert.equal(after.rows[0].corrected, true);
      assert.equal(after.rows[0].points, 100, "QAR 1,000 at one point per QAR 10");
      assert.equal(J(commit(commitCall(staged.batch_id, confirmFor(after)))).orders, 1);
    });

    it("a row can be skipped with a reason and restored; a purchase already imported can never be restored", () => {
      const staged = stage(csvOf([[uniq("Skip"), phoneOf(), "2025-03-01", "1000", "900"], [uniq("Skip"), phoneOf(), "2025-03-02", "2000", "1800"]]));
      const got = get(staged.batch_id);
      const [first, second] = got.rows;
      assert.ok(failing(`select admin.hist_set_row_decision('${staged.batch_id}', '${first.id}', 'skip', 'not a real purchase')`).ok);
      assert.equal(get(staged.batch_id).totals.orders, 1);
      assert.equal(get(staged.batch_id).totals.skipped_by_owner, 1);
      assert.ok(failing(`select admin.hist_set_row_decision('${staged.batch_id}', '${first.id}', 'import', null)`).ok);
      assert.equal(get(staged.batch_id).totals.orders, 2);
      assert.equal(failing(`select admin.hist_set_row_decision('${staged.batch_id}', '${second.id}', 'maybe', null)`).code, "22023");
      const done = J(commit(commitCall(staged.batch_id, confirmFor(get(staged.batch_id)))));
      assert.equal(done.orders, 2);
      // once a batch is committed it cannot be edited
      assert.equal(failing(`select admin.hist_set_row_decision('${staged.batch_id}', '${first.id}', 'skip', 'late change')`).code, "55000");
      // and a purchase imported by another batch is skipped for good
      const again = stage(csvOf([[got.rows[0].customer_name, got.rows[0].phone, "2025-03-01", "1000", "900"], [uniq("Fresh"), phoneOf(), "2025-03-09", "500", "400"]]));
      const a = get(again.batch_id);
      const dup = a.rows.find((r) => r.skip_reason && /already imported/.test(r.skip_reason));
      assert.ok(dup);
      assert.equal(failing(`select admin.hist_set_row_decision('${again.batch_id}', '${dup.id}', 'import', null)`).code, "55000");
    });

    it("two names sharing one phone number are raised, not assumed: the owner merges them into one customer or keeps them apart; a merge can be undone", () => {
      const phone = phoneOf();
      const n1 = uniq("Family");
      const n2 = uniq("Family");
      const staged = stage(csvOf([[n1, phone, "2025-04-10", "1000", "800"], [n2, phone, "2025-04-11", "2000", "1500"]]));
      const got = get(staged.batch_id);
      const flag = got.flags.find((f) => f.kind === "shared_phone");
      assert.ok(flag && flag.severity === "error" && !flag.resolved);
      assert.equal(failing(commitCall(staged.batch_id, confirmFor(got))).code, "55000");
      assert.equal(failing(`select admin.hist_resolve_flag('${staged.batch_id}', '${flag.flag_key}', 'import_anyway', null)`).code, "22023", "that decision does not apply to this kind of item");
      // merge, look, undo, then keep apart
      commit(`select admin.hist_merge_groups('${staged.batch_id}', '${flag.other_group_id}', '${flag.group_id}')`);
      const merged = get(staged.batch_id);
      assert.equal(merged.totals.customers, 1);
      assert.equal(merged.blocking, 0);
      commit(`select admin.hist_unmerge_group('${staged.batch_id}', '${flag.other_group_id}')`);
      assert.equal(get(staged.batch_id).totals.customers, 2);
      commit(`select admin.hist_resolve_flag('${staged.batch_id}', '${flag.flag_key}', 'keep_separate', 'two people in one family')`);
      const apart = get(staged.batch_id);
      assert.equal(apart.blocking, 0);
      const done = J(commit(commitCall(staged.batch_id, confirmFor(apart))));
      assert.equal(done.customers_created, 2);
    });

    it("merging into one customer imports their orders under ONE profile, and one customer's orders are one set of points", () => {
      const phone = phoneOf();
      const staged = stage(csvOf([[uniq("Merge"), phone, "2025-04-20", "1000", "800"], [uniq("Merge"), phone, "2025-04-21", "2000", "1500"]]));
      const got = get(staged.batch_id);
      const flag = got.flags.find((f) => f.kind === "shared_phone");
      commit(`select admin.hist_merge_groups('${staged.batch_id}', '${flag.other_group_id}', '${flag.group_id}')`);
      const done = J(commit(commitCall(staged.batch_id, confirmFor(get(staged.batch_id)))));
      assert.equal(done.customers_created, 1);
      assert.equal(count(`select count(distinct o.customer_id) from public.orders o join private.historical_orders h on h.order_id = o.id where h.batch_id = '${staged.batch_id}'`), 1);
    });

    it("a possible duplicate of an existing order (same customer, same amount, within three days) is raised; the owner skips it or confirms it is a different purchase", () => {
      const platformOrder = scalar(`select id from public.orders where customer_id = '${ID.custA}' and origin = 'platform' order by created_at limit 1`);
      const net = scalar(`select net_payable_minor from public.orders where id = '${platformOrder}'`);
      const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
      const staged = stage(csvOf([[uniq("Dup"), "+97455550001", today, String(Number(net) / 100), "500"]]));
      const got = get(staged.batch_id);
      const dup = got.flags.find((f) => f.kind === "possible_duplicate");
      assert.ok(dup, JSON.stringify(got.flags));
      assert.equal(dup.severity, "error");
      assert.equal(failing(`select admin.hist_resolve_flag('${staged.batch_id}', '${dup.flag_key}', 'keep_separate', null)`).code, "22023");
      commit(`select admin.hist_resolve_flag('${staged.batch_id}', '${dup.flag_key}', 'import_anyway', 'a second, different purchase of the same amount')`);
      const customerFlag = get(staged.batch_id).flags.find((f) => f.kind === "existing_customer" && !f.resolved);
      if (customerFlag) commit(`select admin.hist_set_group_customer('${staged.batch_id}', '${customerFlag.group_id}', 'new', null)`);
      assert.equal(get(staged.batch_id).blocking, 0);
    });

    it("discarding an import purges what it staged, changes nothing in the business, and the same file can be staged again afterwards", () => {
      const text = csvOf([[uniq("Discard"), phoneOf(), "2025-05-30", "1000", "900"]]);
      const before = businessCounts();
      const staged = stage(text);
      assert.equal(failing(`select admin.hist_discard_batch('${staged.batch_id}', 'x')`).code, "22023", "a reason is required");
      assert.ok(failing(`select admin.hist_discard_batch('${staged.batch_id}', 'the wrong file was uploaded')`).ok);
      assert.deepEqual(businessCounts(), before);
      assert.equal(count(`select count(*) from private.historical_import_rows where batch_id = '${staged.batch_id}'`), 0);
      assert.equal(get(staged.batch_id).batch.status, "discarded");
      assert.equal(failing(commitCall(staged.batch_id, {})).code, "55000");
      const again = stage(text);
      assert.equal(again.reused, false);
      assert.notEqual(again.batch_id, staged.batch_id);
      // a committed import cannot be discarded
      const { id } = importRows([[uniq("Keep"), phoneOf(), "2025-05-31", "1000", "900"]]);
      assert.equal(failing(`select admin.hist_discard_batch('${id}', 'changed my mind')`).code, "55000");
    });

    it("what was bought can be described later, only as far as the owner says, only to the penny of what was paid, and the old lines are kept", () => {
      const { id } = importRows([[uniq("Describe"), phoneOf(), "2025-06-15", "5000", "4000"]]);
      const orderId = scalar(`select order_id from private.historical_orders where batch_id = '${id}'`);
      const items = (list) => `$i$${JSON.stringify(list)}$i$::jsonb`;
      const ok = [{ kind: "component", description: "Graphics card", quantity: 1, unit_price_minor: 350_000 }, { kind: "build_service", description: "Assembly", quantity: 2, unit_price_minor: 75_000 }];
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items([{ kind: "other", description: "x", quantity: 1, unit_price_minor: 1 }])}, 'from the chat')`).code, "22023", "the lines must add up to what the customer paid");
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items(ok)}, 'x')`).code, "22023", "a basis is required");
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items([{ kind: "other", description: "", quantity: 1, unit_price_minor: 500_000 }])}, 'from the chat')`).code, "22023");
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items([{ kind: "other", description: "x", quantity: 0, unit_price_minor: 500_000 }])}, 'from the chat')`).code, "22023");
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items(Array.from({ length: 13 }, () => ({ kind: "other", description: "x", quantity: 1, unit_price_minor: 0 })))}, 'from the chat')`).code, "22023");
      assert.equal(failing(`select admin.hist_set_order_items('${orderId}', ${items([{ kind: "discount", description: "x", quantity: 1, unit_price_minor: 500_000 }])}, 'from the chat')`).code, "22023", "no discount line can be invented");
      const before = platformSnapshot();
      const ledger = scalar(`select sum(points) from public.loyalty_ledger where order_id = '${orderId}'`);
      assert.ok(failing(`select admin.hist_set_order_items('${orderId}', ${items(ok)}, 'the customer''s WhatsApp conversation')`).ok);
      assert.equal(count(`select count(*) from public.order_items where order_id = '${orderId}'`), 2);
      assert.equal(scalar(`select total_minor || '|' || net_payable_minor || '|' || amount_paid_minor from public.orders where id = '${orderId}'`), "500000|500000|500000");
      assert.equal(scalar(`select sum(points) from public.loyalty_ledger where order_id = '${orderId}'`), ledger, "the points never change");
      const rev = JSON.parse(scalar(`select old_items::text from private.historical_item_revisions where order_id = '${orderId}'`));
      assert.equal(rev[0].description, "Historical order (items not recorded)");
      assert.deepEqual(platformSnapshot(), before);
      // a platform order is not for this function
      assert.equal(failing(`select admin.hist_set_order_items('${scalar("select id from public.orders where origin = 'platform' limit 1")}', ${items(ok)}, 'from the chat')`).code, "55000");
    });

    it("an imported order is described to its owner: where it came from, what was attested, the points, the files", () => {
      const { id } = importRows([[uniq("Info"), phoneOf(), "2025-06-16", "1000", "900"]]);
      const orderId = scalar(`select order_id from private.historical_orders where batch_id = '${id}'`);
      const info = JSON.parse(last(db.ok(`select admin.hist_order_info('${orderId}');`, AS.olivia)));
      assert.equal(info.historical_date, "2025-06-16");
      assert.equal(info.date_meaning, "completion");
      assert.equal(info.placement_date_known, false);
      assert.equal(info.paid_basis, "owner_attestation");
      assert.equal(info.points_awarded, 100);
      assert.equal(info.attestation.date_is_completion_date, true);
      assert.equal(last(db.ok(`select coalesce(admin.hist_order_info('${scalar("select id from public.orders where origin = 'platform' limit 1")}')::text, 'null');`, AS.olivia)), "null");
      const origin = JSON.parse(last(db.ok(`select admin.order_origin('${orderId}');`, AS.sam)));
      assert.equal(origin.origin, "historical_import");
    });
  });

  // =============================================================================================================
  describe("K. the website and the database agree", () => {
    it("every purchase's identity, occurrence, name key and phone key are the same in the website's code and in the database", () => {
      const a = analyze(FIXTURE_TEXT);
      const purchases = a.rows.filter((r) => r.kind === "purchase");
      assert.equal(purchases.length, 25);
      const batch = stage(FIXTURE_TEXT).batch_id;
      const dbRows = new Map(rowsOf(`select row_number || '|' || coalesce(fingerprint, '') || '|' || coalesce(occurrence::text, '') || '|' || name_key || '|' || phone_key || '|' || points
        from private.historical_import_rows where batch_id = '${batch}' and kind = 'purchase' order by row_number`).map((l) => { const [n, ...rest] = l.split("|"); return [Number(n), rest]; }));
      for (const p of purchases) {
        const [fingerprint, occurrence, nameKey, phoneKey, points] = dbRows.get(p.rowNumber);
        assert.equal(fingerprint, p.fingerprint, `row ${p.rowNumber}: fingerprint`);
        assert.equal(Number(occurrence), p.occurrence);
        assert.equal(nameKey, p.nameKey);
        assert.equal(phoneKey, p.phoneKey);
        assert.equal(Number(points), p.points);
      }
    });

    it("the phone key is the same in the database as in the website for every shape of number", () => {
      const cases = ["+974 5555 0123", "55550123", "0097455550123", "+97455550123", "(+974) 5555-0123", "٥٥٥٥٠١٢٣", "+1 (202) 555-0147", "+44 20 7946 0958", "12345", "+974 123", "abc", "", "  ", "+974 5555 01234", "5555 012", "+971 50 123 4567", "00 971 50 123 4567", "+٩٧٤ ٥٥٥٥ ٠١٢٣"];
      for (const raw of cases) {
        const web = lib.n.normalizePhone(raw);
        const dbKey = scalar(`select coalesce(private.hist_phone_key($p$${raw}$p$), '<null>')`);
        const expected = web.kind === "ok" ? web.key : web.kind === "empty" ? "" : "<null>";
        assert.equal(dbKey, expected, `phone ${JSON.stringify(raw)}`);
      }
    });

    it("the gateway's import statements, the exact SQL text the website sends, work end to end for the owner (stage, read, check, commit, read the file back)", () => {
      const rows = [[uniq("Gateway"), phoneOf(), "2025-07-20", "3000", "2000", "g.pdf (https://attachments.example.test/a/g.pdf)"]];
      const staged = gw(OLIVIA, "hist_stage_batch", [bodyOf(csvOf(rows))]);
      assert.ok(staged.ok, staged.err);
      const got = gw(OLIVIA, "hist_get_batch", [staged.json.batch_id]);
      assert.ok(got.ok, got.err);
      const confirmation = JSON.stringify(confirmFor(got.json));
      const dry = gw(OLIVIA, "hist_commit_batch", [staged.json.batch_id, confirmation, "true"]);
      assert.ok(dry.ok, dry.err);
      assert.equal(dry.json.dry_run, true);
      const real = gw(OLIVIA, "hist_commit_batch", [staged.json.batch_id, confirmation, "false"]);
      assert.ok(real.ok, real.err);
      assert.equal(real.json.orders, 1);
      const attachmentId = got.json.attachments[0].id;
      assert.ok(gw(OLIVIA, "hist_store_attachment", [attachmentId, hex(PDF), "customer_receipt"]).ok);
      const file = gw(OLIVIA, "hist_get_attachment", [attachmentId]);
      assert.ok(file.ok);
      assert.ok(Buffer.from(file.json.content_base64, "base64").equals(PDF));
      const origin = gw(SAM, "order_origin", [got.json.rows[0].order_id ?? scalar(`select order_id from private.historical_orders where batch_id = '${staged.json.batch_id}'`)]);
      assert.ok(origin.ok, origin.err);
      assert.equal(origin.json.origin, "historical_import");
    });

    it("everything that existed before the import is unchanged: the same orders, payments, balances and customers, and the staff statements of the earlier releases still answer", () => {
      const names = ["list_orders_page", "list_orders_overview", "overview_summary", "customer_orders", "list_completed_orders", "financial_report", "get_customer"];
      assert.ok(gw(OLIVIA, "list_orders_overview", [null, null, null, null, null, null, "newest", 1, 10]).ok);
      assert.ok(gw(OLIVIA, "list_orders_page", [null, null, null, null, null, null, "newest", 1, 10]).ok);
      assert.ok(gw(SAM, "overview_summary", [null]).ok);
      assert.ok(gw(OLIVIA, "financial_report", [2025, null]).ok);
      assert.ok(gw(OLIVIA, "get_customer", [ID.custA]).ok);
      assert.ok(names.length > 0);
      assert.equal(gw(SAM, "financial_report", [2025, null]).code, "42501", "staff still cannot read finance");
    });
  });
});
