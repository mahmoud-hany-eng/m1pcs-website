// PLAT-0004 release sequence, rehearsed on DISPOSABLE PostgreSQL servers (nothing hosted is touched):
//
//   deployed state  =  the migrations that are already applied to the hosted development database (every migration before
//                      20261121120000), plus the synthetic test fixtures
//   step 1 (expand) =  20261121120000 (transition_order, permission first) and 20261121120100 (idempotency: ADDITIVE ONLY)
//   step 2 (deploy) =  the new website goes out; the old website may still be running meanwhile
//   step 3 (contract) = supabase/release/idempotency_contract.sql, an operator script, only after the old website is gone
//
// Migrations are applied the way Supabase's apply_migration / the CLI send them: ONE multi-statement simple query, so one implicit
// transaction (psql -c). The operator scripts are run the same way and also with psql -f, to prove the guard holds either way.
//
// What it proves: the old website's writes keep working after expand; the new website's writes work after expand; both can run
// at the same time on the same order; contract cannot be applied by accident and says why; every undo script restores the
// deployed definitions byte for byte; a failed migration changes nothing and a half-applied one is repaired by running it again.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { findPgBin, MIGRATIONS_DIR } from "./harness.mjs";
import { AS, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { CUST_C, ONE, UUID, makeHelpers, newKey, seedIdempotencyFixtures } from "./support/idempotency-helpers.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const M16 = "20261121120000_transition_order_permission_first.sql";
const M17 = "20261121120100_idempotency_expand.sql";
const migration = (name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8");
const release = (name) => readFileSync(join(ROOT, "supabase/release", name), "utf8");
const CONFIRM_CONTRACT = "set m1.confirm_contract = 'old-website-retired';";
const CONFIRM_EXPAND_ROLLBACK = "set m1.confirm_expand_rollback = 'new-website-retired';";

// What the PLAT-0003 website sends (its gateway statements at the deployed commit): no key, no expected amount.
const OLD_PAY = "select admin.record_payment($1::uuid, $2::text, $3::bigint, $4::text, now(), null, $5::text, $6::text) as r";
const OLD_ORD = "select admin.create_order($1::uuid, $2::jsonb, null, 'admin', $3::text, $4::text) as r";

const stops = [];
after(() => {
  for (const d of stops) {
    try {
      d.stop();
    } catch {
      /* already stopped */
    }
  }
});

/** A database in the DEPLOYED state, with the fixtures and the gateway helpers. */
function deployed() {
  const db = startDatabase({ schedule: "confirmed", before: M16 });
  stops.push(db);
  seedIdempotencyFixtures(db, { probes: false });
  return { db, h: makeHelpers(db) };
}

/** Runs SQL as ONE simple query (psql -c): one implicit transaction, exactly what apply_migration / the CLI send. */
function oneQuery(db, sql, { session = [] } = {}) {
  const c = db.cluster;
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", c.dir, "-p", String(c.port), "-U", "postgres", "-d", c.database, "-t", "-A"];
  for (const s of session) args.push("-c", s);
  args.push("-c", sql);
  const r = spawnSync(join(c.bin, "psql"), args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
/** Runs a script file statement by statement (psql -f -): what an operator at a terminal does; a failure leaves earlier statements applied. */
function asScript(db, sql, { session = [] } = {}) {
  const c = db.cluster;
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", c.dir, "-p", String(c.port), "-U", "postgres", "-d", c.database, "-t", "-A"];
  for (const s of session) args.push("-c", s);
  args.push("-f", "-");
  const r = spawnSync(join(c.bin, "psql"), args, { encoding: "utf8", input: sql });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const q = (db, sql) => db.cluster.psql(sql.replace(/;?\s*$/, ";")).out;

const FUNCS = ["transition_order", "record_payment", "create_order", "adjust_loyalty", "similar_orders"];
/** One line per function: its exact signature and an md5 of its full definition, so "unchanged" means byte-identical. */
const defs = (db) =>
  q(db, `select p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname in ('${FUNCS.join("','")}') order by 1`);
const OLD_SIGNATURES = /admin\.(record_payment\(uuid,text,bigint,text,timestamp with time zone,text,text,text\)|create_order\(uuid,jsonb,uuid,text,text,text\)|adjust_loyalty\(uuid,integer,text\)) /;
const oldDefs = (db) => defs(db).split("\n").filter((l) => OLD_SIGNATURES.test(l)).join("\n");
const acl = (db) => q(db, `select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'null') from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname in ('${FUNCS.join("','")}') order by 1`);
const hasKeyTable = (db) => q(db, "select to_regclass('private.idempotency_keys') is not null") === "t";
const functionExists = (db, sig) => q(db, `select to_regprocedure('${sig}') is not null`) === "t";
const NEW_FUNCS = [
  "admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text, text, bigint)", "admin.create_order(uuid, jsonb, uuid, text, text, text, text)",
  "admin.adjust_loyalty(uuid, integer, text, text)", "admin.similar_orders(uuid, jsonb, text)", "private.idempotency_claim(text, text, jsonb, uuid)",
];

suite("release sequence: expand -> new website -> contract, with undo scripts (PLAT-0004 corrections C1, C6)", () => {
  // =================================================================================================================
  describe("the disposable copy of the deployed structure", () => {
    it("is built from exactly the migrations that precede this release, and has none of this release's objects", () => {
      const { db } = deployed();
      const names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      const before = names.filter((f) => f < M16);
      assert.equal(before.length, 15, "fifteen migrations are deployed to the hosted development database");
      assert.equal(hasKeyTable(db), false);
      assert.equal(functionExists(db, "admin.similar_orders(uuid, jsonb, text)"), false);
      assert.equal(functionExists(db, "admin.record_payment(uuid, text, bigint, text, timestamptz, text, text, text)"), true);
      assert.deepEqual(names.filter((f) => f >= M16), [M16, M17], "this release adds exactly two migrations, and the contract step is NOT among them");
    });

    it("this release's operator scripts live outside supabase/migrations, so no pipeline applies them by itself", () => {
      const names = readdirSync(MIGRATIONS_DIR);
      for (const f of names) assert.doesNotMatch(f, /contract|rollback/i, f);
      for (const f of ["idempotency_contract.sql", "idempotency_contract_rollback.sql", "idempotency_expand_rollback.sql", "transition_order_rollback.sql", "README.md"]) {
        assert.ok(readFileSync(join(ROOT, "supabase/release", f), "utf8").length > 100, f);
      }
    });
  });

  // =================================================================================================================
  describe("step 1, EXPAND: additive only, and the deployed website keeps working", () => {
    const state = (() => {
      let cached = null;
      return () => {
        if (cached) return cached;
        const { db, h } = deployed();
        const baseline = { defs: defs(db), old: oldDefs(db), acl: acl(db) };
        const a16 = oneQuery(db, migration(M16));
        const a17 = oneQuery(db, migration(M17));
        cached = { db, h, baseline, a16, a17 };
        return cached;
      };
    })();

    it("both migrations apply as ONE query each", () => {
      const { a16, a17 } = state();
      assert.ok(a16.ok, a16.err);
      assert.ok(a17.ok, a17.err);
    });

    it("the three old write functions are BYTE-IDENTICAL to the deployed ones, with identical privileges (only transition_order changed, by design)", () => {
      const { db, baseline } = state();
      assert.equal(oldDefs(db), baseline.old);
      assert.equal(baseline.old.split("\n").length, 3);
      const afterAcl = acl(db).split("\n").filter((l) => OLD_SIGNATURES.test(l)).join("\n");
      const beforeAcl = baseline.acl.split("\n").filter((l) => OLD_SIGNATURES.test(l)).join("\n");
      assert.equal(afterAcl, beforeAcl);
      const transitionBefore = baseline.defs.split("\n").find((l) => l.startsWith("admin.transition_order"));
      const transitionAfter = defs(db).split("\n").find((l) => l.startsWith("admin.transition_order"));
      assert.notEqual(transitionAfter, transitionBefore, "migration 16 replaced transition_order, as designed");
    });

    it("the new objects exist, and the platform audits report nothing", () => {
      const { db } = state();
      for (const f of NEW_FUNCS) assert.equal(functionExists(db, f), true, f);
      assert.equal(hasKeyTable(db), true);
      assert.equal(q(db, "select count(*) from private.security_audit()"), "0");
      assert.equal(q(db, "select count(*) from private.gateway_audit()"), "0");
    });

    it("PLAT-0003 writes still work after expand: the OLD website's payment and order statements, through the gateway role, and an old-signature loyalty adjustment", () => {
      const { h, db } = state();
      const order = h.confirmed(300000);
      const oldPayment = h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 25000, "cash", null, null], OLD_PAY);
      assert.ok(oldPayment.ok, oldPayment.err);
      assert.match(oldPayment.id, UUID);
      assert.equal(h.paidOf(order), 25000);
      const oldOrder = h.viaGateway(h.SAM, "create_order", [CUST_C, JSON.stringify(ONE(1000)), null, null], OLD_ORD);
      assert.ok(oldOrder.ok, oldOrder.err);
      assert.match(oldOrder.id, UUID);
      const direct = db.commit(`${AS.olivia}select admin.adjust_loyalty('${CUST_C}', 4, 'old signature after expand');`).split("\n").filter(Boolean).pop().trim();
      assert.match(direct, UUID);
      // The old website does not send a key: nothing was recorded in the claim table for these writes.
      assert.equal(h.count(`select count(*) from private.idempotency_keys where result_id in ('${oldPayment.id}', '${oldOrder.id}')`), 0);
    });

    it("PLAT-0004 writes work after expand: the NEW website's statements record a payment with a key and the balance it saw, repeat it harmlessly, and warn about a similar order", () => {
      const { h } = state();
      const order = h.confirmed(300000);
      const key = newKey("new");
      const a = h.pay(h.OLIVIA, order, 40000, key, { expected: 0 });
      const b = h.pay(h.OLIVIA, order, 40000, key, { expected: 0 });
      assert.ok(a.ok && b.ok, JSON.stringify([a.err, b.err]));
      assert.equal(a.id, b.id);
      assert.equal(b.replayed, true);
      assert.equal(h.paymentsOf(order), 1);
      const o = h.createOrder(h.SAM, CUST_C, ONE(2468), newKey("new"));
      assert.ok(o.ok, o.err);
      assert.equal(h.similar(h.SAM, CUST_C, ONE(2468), newKey("ask")).rows.length, 1);
    });

    it("BOTH websites at the same time on the same order (the overlap while the old one is still running): every write succeeds, the balance is exact, nothing is lost or doubled", () => {
      const { h } = state();
      const order = h.confirmed(500000);
      const steps = [
        () => h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 50000, "cash", null, null], OLD_PAY), // old website
        () => h.pay(h.PATRICK, order, 70000, newKey("mix"), { expected: 50000 }), // new website, saw the old payment
        () => h.viaGateway(h.OLIVIA, "record_payment", [order, "balance", 30000, "fawran", null, null], OLD_PAY), // old again (no safeguard: as before)
        () => h.pay(h.OLIVIA, order, 20000, newKey("mix"), { expected: 150000 }),
      ];
      for (const [i, step] of steps.entries()) {
        const r = step();
        assert.ok(r.ok, `step ${i}: ${r.err}`);
      }
      assert.equal(h.paymentsOf(order), 4);
      assert.equal(h.paidOf(order), 170000);
      // The new website's safeguard also protects it from the old website's writes: a form that missed the old website's payment is refused.
      const stale = h.pay(h.PATRICK, order, 10000, newKey("mix"), { expected: 150000 });
      assert.equal(stale.ok, false);
      assert.equal(stale.code, "M1K03");
      // Ledger invariants hold across the mixture.
      assert.equal(h.read(`select o.order_ref from public.orders o left join (select order_id, sum(amount_minor) s from public.payments group by order_id) p on p.order_id = o.id
        where o.amount_paid_minor is distinct from coalesce(p.s, 0) or o.balance_due_minor <> o.total_minor - o.amount_paid_minor`), "");
    });

    it("expand is RERUNNABLE: applying both migrations again changes nothing (definitions, privileges and the kept keys are identical)", () => {
      const { db, h } = state();
      const key = newKey("kept");
      const order = h.confirmed(100000);
      assert.ok(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).ok);
      const before = { defs: defs(db), acl: acl(db), keys: q(db, "select count(*) from private.idempotency_keys") };
      assert.ok(oneQuery(db, migration(M16)).ok);
      const again = oneQuery(db, migration(M17));
      assert.ok(again.ok, again.err);
      assert.deepEqual({ defs: defs(db), acl: acl(db), keys: q(db, "select count(*) from private.idempotency_keys") }, before);
      assert.equal(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).replayed, true, "an earlier key still answers after the rerun");
    });
  });

  // =================================================================================================================
  describe("step 3, CONTRACT: cannot be applied prematurely, says why, and closes the old key-less path only when confirmed", () => {
    const prepared = () => {
      const { db, h } = deployed();
      assert.ok(oneQuery(db, migration(M16)).ok);
      assert.ok(oneQuery(db, migration(M17)).ok);
      return { db, h, before: defs(db), beforeAcl: acl(db) };
    };

    it("WITHOUT the confirmation the script REFUSES with a clear warning, by every way of running it, and changes nothing", () => {
      const { db, h, before, beforeAcl } = prepared();
      const script = release("idempotency_contract.sql");
      for (const [label, run] of [["one query (psql -c)", () => oneQuery(db, script)], ["a script (psql -f)", () => asScript(db, script)]]) {
        const r = run();
        assert.equal(r.ok, false, label);
        assert.match(r.err, /M1C01/, label);
        assert.match(r.err, /REFUSED: the contract step would break the PLAT-0003 website\. NOTHING WAS CHANGED\./, label);
        assert.match(r.err, /HINT:\s+Apply this only after every deployment of the old website \(Production and every Preview that shares this database\) is retired or replaced/, label);
        assert.match(r.err, /set m1\.confirm_contract = 'old-website-retired'/, "the hint names the exact confirmation");
        assert.equal(defs(db), before, `${label}: no definition changed`);
        assert.equal(acl(db), beforeAcl, `${label}: no privilege changed`);
      }
      // A wrong value is no confirmation either, nor is an empty or differently-cased one.
      for (const value of ["yes", "true", "OLD-WEBSITE-RETIRED", "old-website-retired ", ""]) {
        const r = oneQuery(db, script, { session: [`set m1.confirm_contract = '${value}';`] });
        assert.equal(r.ok, false, JSON.stringify(value));
        assert.match(r.err, /M1C01/, JSON.stringify(value));
      }
      assert.equal(defs(db), before);
      // The old website still works: nothing was broken by the refused attempts.
      const order = h.confirmed();
      assert.ok(h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 1000, "cash", null, null], OLD_PAY).ok);
    });

    it("a confirmation is the operator's own act in the same session: it does not persist, and the refusal returns on the next session", () => {
      const { db, before } = prepared();
      const script = release("idempotency_contract.sql");
      assert.equal(oneQuery(db, "select 1", { session: [CONFIRM_CONTRACT] }).ok, true);
      const next = oneQuery(db, script);
      assert.equal(next.ok, false);
      assert.match(next.err, /M1C01/);
      assert.equal(defs(db), before);
    });

    it("it refuses (M1C02) when the EXPAND migration has not been applied, even with the confirmation, and changes nothing", () => {
      const { db } = deployed();
      assert.ok(oneQuery(db, migration(M16)).ok);
      const before = defs(db);
      const r = oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] });
      assert.equal(r.ok, false);
      assert.match(r.err, /M1C02/);
      assert.match(r.err, /EXPAND migration \(20261121120100\) has not been applied/);
      assert.equal(defs(db), before);
    });

    it("WITH the confirmation it applies atomically: the old statements are refused through the gateway (fail closed), the new ones and every direct caller keep working", () => {
      const { db, h } = prepared();
      const oldBefore = oldDefs(db);
      const r = oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] });
      assert.ok(r.ok, r.err);
      assert.notEqual(oldDefs(db), oldBefore, "the three old functions are now delegations");
      const order = h.confirmed(300000);
      const payments = h.count("select count(*) from public.payments");
      const orders = h.count("select count(*) from public.orders");
      const oldPay = h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 25000, "cash", null, null], OLD_PAY);
      assert.equal(oldPay.ok, false);
      assert.match(oldPay.err, /the amount already paid on the order must be supplied; reload the page and try again/);
      const oldOrd = h.viaGateway(h.SAM, "create_order", [CUST_C, JSON.stringify(ONE(1000)), null, null], OLD_ORD);
      assert.equal(oldOrd.ok, false);
      assert.match(oldOrd.err, /an idempotency key is required; reload the page and try again/);
      assert.equal(h.count("select count(*) from public.payments"), payments, "the old statement recorded nothing");
      assert.equal(h.count("select count(*) from public.orders"), orders, "the old statement created nothing");
      // a refusal still comes AFTER the permission check: an unpermitted person gets permission denied, not a hint about keys
      const staff = h.viaGateway(h.SAM, "record_payment", [order, "deposit", 25000, "cash", null, null], OLD_PAY);
      assert.match(staff.err, /permission denied: payments\.record is required/);
      // the new website's statements are unaffected
      assert.ok(h.pay(h.OLIVIA, order, 25000, newKey("post"), { expected: 0 }).ok);
      assert.ok(h.createOrder(h.SAM, CUST_C, ONE(1000), newKey("post")).ok);
      // direct database callers (an owner at a SQL prompt) behave as before
      db.commit(`${AS.olivia}select admin.record_payment('${order}', 'deposit', 1000, 'cash');`);
      assert.equal(q(db, "select count(*) from private.security_audit()"), "0");
    });

    it("it is idempotent: applying it twice leaves the same definitions", () => {
      const { db } = prepared();
      assert.ok(oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] }).ok);
      const once = defs(db);
      assert.ok(oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] }).ok);
      assert.equal(defs(db), once);
    });

    it("the same confirmation works through psql -f with a separate -c, the way an operator would run it", () => {
      const { db } = prepared();
      const r = asScript(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] });
      assert.ok(r.ok, r.err);
    });
  });

  // =================================================================================================================
  describe("UNDO: every rollback script restores the deployed definitions byte for byte, without destroying data", () => {
    it("CONTRACT rollback restores the three PLAT-0003 write functions exactly; the old website works again; the keyed overloads and the keys are untouched", () => {
      const { db, h } = deployed();
      const baseline = oldDefs(db);
      assert.ok(oneQuery(db, migration(M16)).ok);
      assert.ok(oneQuery(db, migration(M17)).ok);
      const order = h.confirmed(300000);
      const key = newKey("undo");
      assert.ok(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).ok);
      assert.ok(oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] }).ok);
      assert.notEqual(oldDefs(db), baseline);
      const keyedBefore = defs(db).split("\n").filter((l) => !OLD_SIGNATURES.test(l)).join("\n");
      for (const run of [oneQuery, asScript]) {
        const rb = run(db, release("idempotency_contract_rollback.sql"));
        assert.ok(rb.ok, rb.err);
        assert.equal(oldDefs(db), baseline, "byte-identical to the deployed definitions");
      }
      assert.equal(defs(db).split("\n").filter((l) => !OLD_SIGNATURES.test(l)).join("\n"), keyedBefore, "the keyed overloads were not touched");
      assert.ok(h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 5000, "cash", null, null], OLD_PAY).ok, "the old website works again");
      assert.equal(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).replayed, true, "the key survived");
    });

    it("transition_order rollback restores the PLAT-0003 definition exactly (and migration 16 can be applied again afterwards)", () => {
      const { db } = deployed();
      const baseline = defs(db).split("\n").find((l) => l.startsWith("admin.transition_order"));
      assert.ok(oneQuery(db, migration(M16)).ok);
      assert.notEqual(defs(db).split("\n").find((l) => l.startsWith("admin.transition_order")), baseline);
      const rb = oneQuery(db, release("transition_order_rollback.sql"));
      assert.ok(rb.ok, rb.err);
      assert.equal(defs(db).split("\n").find((l) => l.startsWith("admin.transition_order")), baseline);
      assert.ok(oneQuery(db, migration(M16)).ok);
    });

    it("EXPAND rollback REFUSES without the statement that the new website is retired, and while the contract is still applied; both refusals change nothing", () => {
      const { db } = deployed();
      assert.ok(oneQuery(db, migration(M16)).ok);
      assert.ok(oneQuery(db, migration(M17)).ok);
      const before = defs(db);
      const script = release("idempotency_expand_rollback.sql");
      const noConfirm = oneQuery(db, script);
      assert.equal(noConfirm.ok, false);
      assert.match(noConfirm.err, /M1C03/);
      assert.match(noConfirm.err, /would break the PLAT-0004 website\. NOTHING WAS CHANGED\./);
      assert.equal(defs(db), before);
      assert.ok(oneQuery(db, release("idempotency_contract.sql"), { session: [CONFIRM_CONTRACT] }).ok);
      const withContract = defs(db);
      const stillContracted = oneQuery(db, script, { session: [CONFIRM_EXPAND_ROLLBACK] });
      assert.equal(stillContracted.ok, false);
      assert.match(stillContracted.err, /M1C04/);
      assert.match(stillContracted.err, /CONTRACT step is still applied/);
      assert.equal(defs(db), withContract);
    });

    it("EXPAND rollback (after the contract was undone, with the statement) removes the keyed functions, KEEPS the key table and its rows, restores the old definitions, and expand can then be applied again", () => {
      const { db, h } = deployed();
      const baseline = oldDefs(db);
      const baselineAcl = acl(db).split("\n").filter((l) => OLD_SIGNATURES.test(l)).join("\n");
      assert.ok(oneQuery(db, migration(M16)).ok);
      assert.ok(oneQuery(db, migration(M17)).ok);
      const order = h.confirmed(100000);
      const key = newKey("keep");
      assert.ok(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).ok);
      const rows = q(db, "select count(*) from private.idempotency_keys");
      const rb = oneQuery(db, release("idempotency_expand_rollback.sql"), { session: [CONFIRM_EXPAND_ROLLBACK] });
      assert.ok(rb.ok, rb.err);
      for (const f of NEW_FUNCS) assert.equal(functionExists(db, f), false, f);
      assert.equal(hasKeyTable(db), true, "the key table is deliberately kept");
      assert.equal(q(db, "select count(*) from private.idempotency_keys"), rows);
      assert.equal(oldDefs(db), baseline);
      assert.equal(acl(db).split("\n").filter((l) => OLD_SIGNATURES.test(l)).join("\n"), baselineAcl);
      assert.ok(h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 5000, "cash", null, null], OLD_PAY).ok, "the old website works");
      // a second run finds nothing to remove and succeeds
      assert.ok(oneQuery(db, release("idempotency_expand_rollback.sql"), { session: [CONFIRM_EXPAND_ROLLBACK] }).ok);
      // and the release can be applied again, picking up the kept keys
      assert.ok(oneQuery(db, migration(M17)).ok);
      assert.equal(h.pay(h.OLIVIA, order, 10000, key, { expected: 0 }).replayed, true);
    });
  });

  // =================================================================================================================
  describe("failure and recovery, without relying on a destructive rollback", () => {
    const reference = (() => {
      let cached = null;
      return () => {
        if (cached) return cached;
        const { db } = deployed();
        assert.ok(oneQuery(db, migration(M16)).ok);
        assert.ok(oneQuery(db, migration(M17)).ok);
        cached = { defs: defs(db), acl: acl(db) };
        return cached;
      };
    })();

    it("a migration that FAILS as one query changes NOTHING (atomic): no table, no function, old definitions unchanged", () => {
      const { db } = deployed();
      const before = { defs: defs(db), acl: acl(db) };
      const r = oneQuery(db, `${migration(M17)}\nselect 1/0;`);
      assert.equal(r.ok, false);
      assert.match(r.err, /division by zero/);
      assert.equal(hasKeyTable(db), false);
      for (const f of NEW_FUNCS) assert.equal(functionExists(db, f), false, f);
      assert.deepEqual({ defs: defs(db), acl: acl(db) }, before);
    });

    it("after an atomic failure the SAME migration simply applies: recovery is a rerun, and the result equals a clean application", () => {
      const { db } = deployed();
      assert.equal(oneQuery(db, `${migration(M16)}\n${migration(M17)}\nselect 1/0;`).ok, false);
      assert.ok(oneQuery(db, migration(M16)).ok);
      const retry = oneQuery(db, migration(M17));
      assert.ok(retry.ok, retry.err);
      const ref = reference();
      assert.equal(defs(db), ref.defs);
      assert.equal(acl(db), ref.acl);
    });

    it("a HALF-applied expand (an operator ran it statement by statement and it stopped midway) is repaired by running it again, with no rollback needed", () => {
      const { db, h } = deployed();
      assert.ok(oneQuery(db, migration(M16)).ok);
      const sql = migration(M17);
      const cut = sql.indexOf("-- 4. admin.create_order");
      assert.ok(cut > 0);
      const midway = `${sql.slice(0, cut)}\nselect 1/0;\n${sql.slice(cut)}`;
      const partial = asScript(db, midway);
      assert.equal(partial.ok, false);
      assert.equal(hasKeyTable(db), true, "statement by statement leaves the early part applied: the table exists");
      assert.equal(functionExists(db, "admin.create_order(uuid, jsonb, uuid, text, text, text, text)"), false, "and the later part is missing");
      // The deployed website is not affected by the half-state.
      const order = h.confirmed();
      assert.ok(h.viaGateway(h.OLIVIA, "record_payment", [order, "deposit", 1000, "cash", null, null], OLD_PAY).ok);
      // Recovery: run the migration again.
      const fixed = asScript(db, sql);
      assert.ok(fixed.ok, fixed.err);
      const ref = reference();
      assert.equal(acl(db), ref.acl);
      assert.equal(defs(db), ref.defs);
      assert.equal(q(db, "select count(*) from private.security_audit()"), "0");
    });

    it("a pre-existing key table of the WRONG shape stops the migration (the self-check), changes nothing else, and the shape error names the problem", () => {
      const { db } = deployed();
      db.commit("create table private.idempotency_keys (actor uuid, wrong_column text); alter table private.idempotency_keys enable row level security;");
      const before = defs(db);
      const r = oneQuery(db, migration(M17));
      assert.equal(r.ok, false);
      assert.match(r.err, /private\.idempotency_keys has an unexpected shape/);
      assert.equal(defs(db), before, "the whole migration rolled back, including the functions it had created");
    });

    it("a pre-existing key table with the right column NAMES but the wrong TYPES is also refused, and the whole migration rolls back", () => {
      const { db } = deployed();
      db.commit("create table private.idempotency_keys (actor uuid, operation text, idempotency_key text, request_hash integer, result_id uuid, created_at timestamptz); alter table private.idempotency_keys enable row level security;");
      const before = defs(db);
      const r = oneQuery(db, migration(M17));
      assert.equal(r.ok, false);
      assert.match(r.err, /private\.idempotency_keys has an unexpected shape/);
      assert.match(r.err, /request_hash:integer/);
      assert.equal(defs(db), before);
    });

    it("default privileges that would grant anon execute on new functions cannot widen them: the migration revokes explicitly and its self-check confirms it", () => {
      const { db } = deployed();
      db.commit("alter default privileges in schema admin grant execute on functions to anon;");
      const before = defs(db);
      const r = oneQuery(db, migration(M17));
      // The migration revokes explicitly, so default privileges cannot widen it; it must still succeed and leave anon without access.
      assert.ok(r.ok, r.err);
      for (const f of NEW_FUNCS.filter((x) => x.startsWith("admin."))) assert.equal(q(db, `select has_function_privilege('anon', '${f}', 'execute')`), "f", f);
      assert.notEqual(defs(db), before);
    });

    it("the only script that drops anything is an operator script outside supabase/migrations (static.test.mjs forbids DROP in migrations)", () => {
      assert.match(release("idempotency_expand_rollback.sql"), /drop function/);
      for (const f of [M16, M17]) assert.doesNotMatch(migration(f).replace(/--.*$/gm, ""), /\bdrop\s+(table|schema|view|function)\b/i, f);
    });
  });
});
