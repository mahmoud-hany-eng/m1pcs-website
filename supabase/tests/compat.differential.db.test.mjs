// DIFFERENTIAL compatibility check for the order-workflow migrations (PLAT-0004 final release preparation).
//
// The question: do the two workflow migrations (20261122120000, 20261122120100) change the behaviour of ANY write path that the website
// deployed today relies on? This test answers it WITHOUT using the workflow feature tests: it builds two disposable PostgreSQL databases,
//   CONTROL    = every migration up to and including the idempotency expand (exactly what the hosted development database holds), and
//   TREATMENT  = the same plus the two workflow migrations,
// runs ONE identical script of earlier-workflow business operations against both (keyed and key-less payments and orders, every status
// move, the deposit gate, hold / resume / cancel, loyalty awards and adjustments, payment reversal, tracking publish and withdraw, and the
// refusals for a customer, an inactive staff member, a session without the second factor and a staff member without the permission), and
// requires the two transcripts, the resulting rows and the read functions' earlier fields to be IDENTICAL.
//
// The only differences allowed are the ones the release documents on purpose, each asserted explicitly at the end:
//   (1) the customer wording of five statuses (labels are therefore left out of every comparison),
//   (2) a HELD order's dropdown lists only its resume point and Cancel (the earlier database listed every earlier status, and the
//       transition function refused all but one),
//   (3) additive keys in the read functions' answers, and (4) two more owner-only permissions.
// Identifiers, timestamps and statement line numbers are normalised; amounts, receipts, references, statuses, messages and SQLSTATE texts are not.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, startDatabase } from "./fixtures.mjs";
import { lines, norm, reads, scenario } from "./support/differential.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const W1 = "20261122120000_order_workflow_v2_schema.sql";
const W2 = "20261122120100_order_workflow_v2_functions.sql";
// The pricing migrations (PLAT-0005) come after this release; their own differential is compat.pricing.differential.db.test.mjs.
const P1 = "20261123120000_pricing_rewards_schema.sql";
suite("the workflow migrations preserve every earlier write path (differential: hosted-shape database versus the same plus the two migrations)", () => {
  let control;
  let partial;
  let treatment;
  let c;
  let p;
  let t;
  let cr;
  let tr;

  before(() => {
    control = startDatabase({ schedule: "confirmed", before: W1 });
    // The state BETWEEN the two migrations (the first applied, the second not yet or failed): the earlier website must work there too.
    partial = startDatabase({ schedule: "confirmed", before: W2 });
    treatment = startDatabase({ schedule: "confirmed", before: P1 });
    c = scenario(control);
    p = scenario(partial);
    t = scenario(treatment);
    cr = reads(control, c.ids);
    tr = reads(treatment, t.ids);
  });
  after(() => {
    control?.stop();
    partial?.stop();
    treatment?.stop();
  });

  it("the control really is the hosted shape (no workflow objects) and the treatment really has them", () => {
    const has = (db) => lines(db.ok("select to_regclass('public.order_workflow_stages') is not null;")).pop();
    assert.equal(has(control), "f");
    assert.equal(has(treatment), "t");
  });

  it("the script exercised the paths it claims to (a transcript with real successes AND real refusals, not an empty comparison)", () => {
    const ok = c.T.filter((l) => /=> OK /.test(l)).length;
    const err = c.T.filter((l) => /=> ERR /.test(l)).length;
    assert.ok(ok >= 40 && err >= 25, `expected a meaningful transcript, got ${ok} successes and ${err} refusals`);
    for (const expected of [/replay|already/i, /M1K|used for a different request|different request/i, /permission denied/, /the deposit has not been fully paid/, /cannot move from/, /cancelled order cannot receive a payment/, /a held order can only resume at/, /amount paid on this order changed/]) {
      assert.ok(c.T.some((l) => expected.test(l)), `the transcript should contain a refusal matching ${expected}`);
    }
  });

  it("every step of the script ends the same way on both databases: the same successes, the same refusals, the same words", () => {
    assert.equal(t.T.length, c.T.length);
    const diffs = [];
    for (let i = 0; i < c.T.length; i++) if (c.T[i] !== t.T[i]) diffs.push(`control:   ${c.T[i]}\n   treatment: ${t.T[i]}`);
    assert.deepEqual(diffs, [], `the migrations changed the outcome of ${diffs.length} step(s):\n${diffs.join("\n")}`);
  });

  it("the state BETWEEN the two migrations is safe too: with only the first applied, every step, row and refusal is still identical (a failed second migration leaves the earlier website working)", () => {
    assert.equal(lines(partial.ok("select to_regclass('public.order_workflow_stages') is not null;")).pop(), "t", "the first migration is applied");
    assert.equal(lines(partial.ok("select pg_get_functiondef('admin.get_order(uuid)'::regprocedure) like '%order_next_statuses%';")).pop(), "f", "the second is not");
    assert.deepEqual(p.T, c.T);
  });

  it("the rows the script produced are identical: orders, amounts, receipts, history, tracking, loyalty, audit actions and idempotency keys", () => {
    const state = (x) => x.T.filter((l) => l.startsWith("STATE "));
    assert.equal(state(c).length, 7);
    assert.deepEqual(state(t), state(c));
  });

  it("the read functions still return every earlier field with the same value (wording and additive keys aside)", () => {
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
      } else {
        assert.equal(norm(extended), norm(base), path);
      }
    };
    for (const name of ["getA", "getB", "list", "dash", "dashStaff"]) isSubset(cr[name], tr[name], name);
    isSubset(cr.listHeld, tr.listHeld, "listHeld");
  });

  it("INTENDED difference 1: a held order's dropdown lists only its resume point and Cancel; the earlier database listed every earlier status", () => {
    const codes = (r) => r.next_statuses.map((n) => n.code).sort();
    assert.deepEqual(codes(tr.getC), ["cancelled", "in_transit"]);
    assert.ok(codes(cr.getC).length > codes(tr.getC).length, "the earlier list was longer");
    for (const code of codes(tr.getC)) assert.ok(codes(cr.getC).includes(code), `${code} was already offered`);
  });

  it("INTENDED difference 2: every other order's dropdown lists exactly the same moves as before", () => {
    const codes = (r) => r.next_statuses.map((n) => n.code).sort();
    assert.deepEqual(codes(tr.getA), codes(cr.getA));
    assert.deepEqual(codes(tr.getB), codes(cr.getB));
  });

  it("INTENDED difference 3: the read answers only GAIN keys (and two permissions); nothing earlier is renamed or removed", () => {
    const keys = (db, sql, who) => Object.keys(JSON.parse(lines(db.ok(`${sql}::text;`, who)).pop())).sort();
    const getKeys = (db, id) => keys(db, `select admin.get_order('${id}')`, AS.olivia);
    const earlier = getKeys(control, c.ids.a);
    const later = getKeys(treatment, t.ids.a);
    assert.deepEqual(earlier.filter((k) => !later.includes(k)), [], "no earlier key was removed");
    assert.ok(later.length > earlier.length);
    const perms = (db) => Number(lines(db.ok("select count(*) from admin.my_permissions();", AS.olivia)).pop());
    assert.equal(perms(treatment) - perms(control), 2);
    assert.equal(Number(lines(treatment.ok("select count(*) from admin.my_permissions();", AS.sam)).pop()), Number(lines(control.ok("select count(*) from admin.my_permissions();", AS.sam)).pop()), "staff gain no permission");
  });

  it("the signatures of the write functions the deployed website calls are unchanged, and nobody gained or lost the right to run them", () => {
    const sigs = (db) =>
      lines(db.ok(`select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'null') || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname in
        ('create_order','record_payment','reverse_payment','adjust_loyalty','transition_order','publish_tracking_event','retract_tracking_event','similar_orders','award_loyalty_for_order','reverse_loyalty_award','get_order','list_orders','dashboard_summary','create_customer','issue_claim_code','revoke_claim_code','set_policy','add_order_note','set_order_item_cost') order by 1;`)).sort();
    assert.deepEqual(sigs(treatment), sigs(control));
  });

  it("the earlier website's functions all still exist after the migrations (nothing the deployed website calls has disappeared)", () => {
    const names = (db) => lines(db.ok("select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'admin'::regnamespace order by 1;"));
    const after = new Set(names(treatment));
    const missing = names(control).filter((n) => !after.has(n));
    assert.deepEqual(missing, []);
    assert.equal(names(treatment).length - names(control).length, 4, "exactly the four new staff functions were added");
  });

  it("the security and gateway audits report nothing on the treatment, exactly as on the control", () => {
    for (const db of [control, treatment]) {
      assert.equal(lines(db.ok("select count(*) from private.security_audit();")).pop(), "0");
      assert.equal(lines(db.ok("select count(*) from private.gateway_audit();")).pop(), "0");
    }
  });
});
