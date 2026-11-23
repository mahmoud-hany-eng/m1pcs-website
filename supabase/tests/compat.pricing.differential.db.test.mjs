// DIFFERENTIAL compatibility check for the PRICING AND REWARDS migrations (PLAT-0005).
//
// The question: do the three pricing migrations (20261123120000 schema, 20261123120100 functions, 20261123120200 policies) change the
// behaviour of ANY path the website deployed today relies on? Like compat.differential.db.test.mjs, this builds disposable PostgreSQL
// databases and runs ONE identical script of earlier business operations against each (keyed and key-less payments and orders, every status
// move, the deposit gate, hold / resume / cancel, loyalty awards and adjustments, payment reversal, tracking, and the refusals for a
// customer, an inactive staff member, a session without the second factor and a staff member without the permission):
//   CONTROL    = every migration up to and including the order-workflow pair (exactly what the hosted development database holds now),
//   AFTER 1    = the same plus the schema migration only,
//   AFTER 2    = the same plus the schema and the functions (before the policies change: the state a staged rollout passes through),
//   TREATMENT  = the same plus all three.
// and requires the transcripts and the resulting rows to be IDENTICAL on all four. The script's orders are all under QAR 3,000, where the
// earlier three tiers and the new five tiers agree, so a difference can only come from a change in behaviour, not from the new schedule.
//
// The only differences allowed are the ones the release documents on purpose, each asserted explicitly at the end:
//   (1) the words of the deposit rule ("tier 1 of 5" instead of "tier 1 of 3") and the version number of the deposit policy it records (4 where it
//       was 3), only once the policy migration is applied,
//   (2) additive keys in the read functions' answers (the pricing fields),
//   (3) two more owner-only permissions and two more staff functions (the order form's context and the priced create_order).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, startDatabase } from "./fixtures.mjs";
import { lines, norm, reads, scenario } from "./support/differential.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const P1 = "20261123120000_pricing_rewards_schema.sql";
const P2 = "20261123120100_pricing_rewards_functions.sql";
const P3 = "20261123120200_pricing_rewards_policies.sql";

suite("the pricing migrations preserve every earlier path (differential: the database as deployed versus the same plus the pricing migrations, in every intermediate state)", () => {
  let control;
  let after1;
  let after2;
  let treatment;
  let c;
  let a1;
  let a2;
  let t;
  let cr;
  let tr;

  before(() => {
    control = startDatabase({ schedule: "confirmed", before: P1 });
    after1 = startDatabase({ schedule: "confirmed", before: P2 });
    after2 = startDatabase({ schedule: "confirmed", before: P3 });
    treatment = startDatabase({ schedule: "confirmed" });
    c = scenario(control);
    a1 = scenario(after1);
    a2 = scenario(after2);
    t = scenario(treatment);
    cr = reads(control, c.ids);
    tr = reads(treatment, t.ids);
  });
  after(() => {
    for (const db of [control, after1, after2, treatment]) db?.stop();
  });

  it("the control really is the deployed shape (no pricing objects) and the treatment really has them", () => {
    const has = (db) => lines(db.ok("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'net_payable_minor');")).pop();
    assert.equal(has(control), "f");
    assert.equal(has(after1), "t");
    assert.equal(has(treatment), "t");
    const tiers = (db) => lines(db.ok("select jsonb_array_length(value -> 'tiers') from private.business_policies where key = 'orders.deposit';")).pop();
    assert.deepEqual([tiers(control), tiers(after1), tiers(after2), tiers(treatment)], ["3", "3", "3", "5"]);
  });

  it("the script exercised the paths it claims to (real successes AND real refusals, not an empty comparison)", () => {
    const ok = c.T.filter((l) => /=> OK /.test(l)).length;
    const err = c.T.filter((l) => /=> ERR /.test(l)).length;
    assert.ok(ok >= 40 && err >= 25, `expected a meaningful transcript, got ${ok} successes and ${err} refusals`);
  });

  it("every step of the script ends the same way in EVERY state of the rollout: the same successes, the same refusals, the same words", () => {
    for (const [name, x] of [["schema applied", a1], ["schema + functions applied", a2], ["all three applied", t]]) {
      assert.equal(x.T.length, c.T.length, name);
      const diffs = [];
      for (let i = 0; i < c.T.length; i++) if (c.T[i] !== x.T[i]) diffs.push(`control:   ${c.T[i]}\n   ${name}: ${x.T[i]}`);
      assert.deepEqual(diffs, [], `the migrations changed the outcome of ${diffs.length} step(s) (${name}):\n${diffs.join("\n")}`);
    }
  });

  it("the rows the script produced are identical: orders, amounts, receipts, history, tracking, loyalty, audit actions and idempotency keys", () => {
    const state = (x) => x.T.filter((l) => l.startsWith("STATE "));
    assert.equal(state(c).length, 7);
    for (const x of [a1, a2, t]) assert.deepEqual(state(x), state(c));
  });

  it("the read functions still return every earlier field with the same value (the deposit rule's wording, the policy version number and additive keys aside)", () => {
    const reworded = (v) => String(v).replace(/tier (\d) of 5/, "tier $1 of 3");
    const isSubset = (base, extended, path) => {
      if (Array.isArray(base)) {
        assert.ok(Array.isArray(extended), path);
        assert.equal(extended.length, base.length, `${path}: length`);
        base.forEach((x, i) => isSubset(x, extended[i], `${path}[${i}]`));
      } else if (base && typeof base === "object") {
        for (const key of Object.keys(base)) {
          assert.ok(key in extended, `${path}.${key} must still be returned`);
          isSubset(base[key], extended[key], `${path}.${key}`);
        }
      } else if (path.endsWith(".deposit_policy_version") && base !== null) {
        // the policy migration adds a version of the deposit policy (the five tiers): an order confirmed now records version 4 where it was 3
        assert.equal(extended, base + 1, path);
      } else {
        assert.equal(reworded(norm(extended)), norm(base), path);
      }
    };
    for (const name of ["getA", "getB", "getC", "list", "listHeld", "dash", "dashStaff"]) isSubset(cr[name], tr[name], name);
  });

  it("INTENDED difference 1: only the words of the deposit rule changed, and only after the policy migration", () => {
    const rule = (db, id) => lines(db.ok(`select deposit_rule from public.orders where id = '${id}';`)).pop();
    assert.match(rule(control, c.ids.a), /^tier 1 of 3: 15\.00%/);
    assert.match(rule(after2, a2.ids.a), /^tier 1 of 3: 15\.00%/, "before the policy migration the wording is the earlier one");
    assert.match(rule(treatment, t.ids.a), /^tier 1 of 5: 15\.00%/);
  });

  it("INTENDED difference 2: every earlier read key is still there; the answers only GAIN the pricing keys, and nothing else", () => {
    const keys = (db, sql, who) => Object.keys(JSON.parse(lines(db.ok(`${sql}::text;`, who)).pop())).sort();
    const earlier = keys(control, `select admin.get_order('${c.ids.a}')`, AS.olivia);
    const later = keys(treatment, `select admin.get_order('${t.ids.a}')`, AS.olivia);
    assert.deepEqual(earlier.filter((k) => !later.includes(k)), [], "no earlier key was removed");
    assert.deepEqual(later.filter((k) => !earlier.includes(k)), [
      "cash_balance_after_deposit_minor", "discount_minor", "discount_record", "loyalty_credit_minor", "loyalty_points_redeemed", "net_payable_minor", "redemption_record",
    ]);
    const listKeys = (db) => Object.keys(JSON.parse(lines(db.ok("select (admin.list_orders(null, null, 1, 0) -> 0)::text;", AS.sam)).pop())).sort();
    assert.deepEqual(listKeys(treatment).filter((k) => !listKeys(control).includes(k)), ["discount_minor", "loyalty_credit_minor", "loyalty_points_redeemed", "net_payable_minor"]);
  });

  it("INTENDED difference 3: two more owner-only permissions and two more staff functions; staff gain nothing", () => {
    const perms = (db, who) => Number(lines(db.ok("select count(*) from admin.my_permissions();", who)).pop());
    assert.equal(perms(treatment, AS.olivia) - perms(control, AS.olivia), 2);
    assert.equal(perms(treatment, AS.sam), perms(control, AS.sam), "staff gain no permission");
    const names = (db) => lines(db.ok("select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'admin'::regnamespace order by 1;"));
    const after = new Set(names(treatment));
    assert.deepEqual(names(control).filter((n) => !after.has(n)), [], "nothing the deployed website calls has disappeared");
    assert.deepEqual(names(treatment).filter((n) => !names(control).includes(n)), [
      "admin.create_order(uuid,jsonb,uuid,text,text,text,text,jsonb,bigint,bigint,bigint)",
      "admin.order_pricing_context(uuid)",
    ]);
  });

  it("the privileges and security attributes of every earlier staff function are unchanged (nobody gained or lost the right to run them)", () => {
    const sigs = (db) =>
      lines(db.ok(`select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'null') || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname <> all (array['order_pricing_context']) and p.oid::regprocedure::text not like 'admin.create_order(uuid,jsonb,uuid,text,text,text,text,jsonb,%'
        order by 1;`));
    assert.deepEqual(sigs(treatment), sigs(control));
  });

  it("the security and gateway audits report nothing, exactly as on the control", () => {
    for (const db of [control, treatment]) {
      assert.equal(lines(db.ok("select count(*) from private.security_audit();")).pop(), "0");
      assert.equal(lines(db.ok("select count(*) from private.gateway_audit();")).pop(), "0");
    }
  });
});
