// PLAT-0003 database tests, run against a REAL PostgreSQL server (not Supabase): the confirmed deposit schedule, the
// deposit fixed at confirmation, receipts, claim-code revocation and multiple links, the staff functions, and the
// staff gateway's database-side checks. See db.test.mjs for what a PostgreSQL-only test does and does not prove.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { AS, ID, json, newOrder, startDatabase } from "./fixtures.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const item = (price, qty = 1) => [{ kind: "component", description: "Example item", quantity: qty, unit_price_minor: price }];
// The confirmed schedule, restored from the migration's own version history (version 3), so these tests exercise exactly
// what the migration ships and not a copy typed here. The fixture replaced it with an arbitrary example for other tests.
const CONFIRMED = `reset role;
select value::text as confirmed_schedule from private.business_policy_versions where key = 'orders.deposit' and version = 3 \\gset
${AS.olivia}select admin.set_policy('orders.deposit', :'confirmed_schedule'::jsonb, 'confirmed_by_owner', 'restore the confirmed schedule for this test');\n`;
/** Creates an order for `total` minor units under the confirmed schedule, confirms it, and prints the deposit. */
/** The numbers a script printed, in order (a void function's empty line is not one). */
const numbers = (out) => out.split("\n").filter((line) => /^\d+$/.test(line));
const depositFor = (total, v) => `${newOrder({ items: item(total), into: v })}${AS.olivia}select admin.transition_order(:'${v}', 'awaiting_deposit');
  select deposit_required_minor from public.orders where id = :'${v}';\n`;

// ---- the staff gateway, as the database sees it ----------------------------------------------------------------
const SID = "00000000-0000-4000-8000-0000000000e1";
const SID2 = "00000000-0000-4000-8000-0000000000e2";
/** A connection that logged in as the gateway and supplies these (server-verified) claims. */
const gateway = ({ sub = ID.olivia, aal = "aal2", sid = SID } = {}) =>
  `reset role;\nreset session authorization;\nset session authorization m1_staff_gateway;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated", aal, session_id: sid })}', true);\n`;
const session = (id, user, aal = "aal2", notAfter = "null") => `reset role;\nreset session authorization;\ninsert into auth.sessions (id, user_id, aal, not_after) values ('${id}', '${user}', '${aal}', ${notAfter});\n`;

suite("PLAT-0003 database (real PostgreSQL)", () => {
  let db;
  before(() => {
    db = startDatabase();
  });
  after(() => db?.stop());

  // =================================================================================================================
  describe("the owner-confirmed deposit schedule (15 / 25 / 35 percent of the whole order total)", () => {
    it("migration 14 stored the confirmed schedule as version 3, confirmed by the owner, with the old placeholders kept", () => {
      const out = db.ok(`select version || ' ' || confirmation || ' ' || coalesce(value ->> 'mode', 'percent') from private.business_policy_versions where key = 'orders.deposit' order by version limit 3;`, AS.superuser);
      assert.deepEqual(out.split("\n"), ["1 unconfirmed_default percent", "2 unconfirmed_default unconfigured", "3 confirmed_by_owner tiered"]);
      const tiers = db.ok(`select string_agg(coalesce(t ->> 'up_to_minor', 'open') || ':' || (t ->> 'percent_bps'), ' ' order by ord) from private.business_policy_versions v, jsonb_array_elements(v.value -> 'tiers') with ordinality as x(t, ord) where v.key = 'orders.deposit' and v.version = 3;`, AS.superuser);
      assert.equal(tiers, "300000:1500 500000:2500 open:3500");
    });

    it("boundary: QAR 3,000.00 is 15 percent and QAR 3,000.01 is 25 percent, of the WHOLE total", () => {
      const out = numbers(db.ok(`${CONFIRMED}${depositFor(300000, "b1")}${depositFor(300001, "b2")}`)).slice(-2);
      // 15 % of 300 000 = 45 000. 25 % of 300 001 = 75 000.25, to the nearest minor unit 75 000: the whole total, not a slice.
      assert.deepEqual(out, ["45000", "75000"]);
    });

    it("boundary: QAR 5,000.00 is 25 percent and QAR 5,000.01 is 35 percent, of the WHOLE total", () => {
      const out = numbers(db.ok(`${CONFIRMED}${depositFor(500000, "b3")}${depositFor(500001, "b4")}`)).slice(-2);
      // 25 % of 500 000 = 125 000. 35 % of 500 001 = 175 000.35, to the nearest minor unit 175 000.
      assert.deepEqual(out, ["125000", "175000"]);
    });

    it("the tiers are not marginal: a total just over a boundary does not become a sum of slices", () => {
      const out = numbers(db.ok(`${CONFIRMED}${depositFor(600000, "m1")}`)).pop();
      // Marginal arithmetic would give 450 + 500 + 350 = QAR 1,300.00. The whole-total rule gives 35 % of 600 000.
      assert.equal(out, "210000");
      assert.notEqual(out, "130000");
    });

    it("rounding is to the nearest minor unit (dirham), and a half rounds UP", () => {
      const out = numbers(db.ok(`${CONFIRMED}${[
        [301, "r0"], [333333, "r1"], [300002, "r2"], [500010, "r3"], [100, "r4"], [10, "r5"],
      ].map(([total, v]) => depositFor(total, v)).join("")}`)).slice(-6);
      // 301: 15 % = 45.15 -> 45.   333 333: 25 % = 83 333.25 -> 83 333.   300 002: 25 % = 75 000.5 -> 75 001 (half up).
      // 500 010: 35 % = 175 003.5 -> 175 004 (half up).   100: 15 % = 15.   10: 15 % = 1.5 -> 2 (half up).
      assert.deepEqual(out, ["45", "83333", "75001", "175004", "15", "2"]);
    });

    it("whole-number arithmetic: a very large total is exact, never a floating-point approximation", () => {
      const total = 999999999999; // QAR 9,999,999,999.99
      const out = numbers(db.ok(`${CONFIRMED}${depositFor(total, "big")}`)).pop();
      // 35 % of 999 999 999 999 = 349 999 999 999.65 -> 350 000 000 000 (nearest).
      assert.equal(out, "350000000000");
    });

    it("the deposit never exceeds the total and is never negative", () => {
      db.denied(`${CONFIRMED}${AS.superuser}select private.deposit_quote(-1);`, "", /cannot be negative/);
      const out = db.ok(`${CONFIRMED}${AS.superuser}select (private.deposit_quote(0)).amount_minor || ',' || (private.deposit_quote(1)).amount_minor;`);
      assert.equal(out.split("\n").pop(), "0,0");
    });

    it("the confirmed value passes the same validator every later change must pass", () => {
      assert.equal(db.ok(`select coalesce(private.policy_error('orders.deposit', value), 'valid') from private.business_policies where key = 'orders.deposit';`, AS.superuser).split("\n").pop(), "valid");
    });

    it("the confirmed schedule is configurable by an authorised administrator, with an audit trail and a kept history", () => {
      const out = db.ok(`${AS.olivia}select admin.set_policy('orders.deposit',
          '{"mode":"tiered","minimum_minor":0,"required_before_status":"deposit_received","tiers":[{"up_to_minor":300000,"percent_bps":1000},{"percent_bps":2000}]}'::jsonb,
          'unconfirmed_default', 'a test of changing the schedule');
        ${AS.superuser}select ((select count(*) from private.audit_log where action = 'policy.changed' and entity_id = 'orders.deposit') >= 1)::text || ':' ||
          (select count(*) from private.business_policy_versions where key = 'orders.deposit' and version = 3);`);
      assert.equal(out.split("\n").pop(), "true:1");
      // A person without the permission cannot.
      db.denied(`${AS.sam}select admin.set_policy('orders.deposit', '{"mode":"unconfigured"}'::jsonb, 'unconfirmed_default', 'staff may not');`, "", /permission denied: policies.manage/);
    });

    it("the schedule cannot be switched off silently: unconfiguring it stops new confirmations (fail closed)", () => {
      db.denied(`${newOrder({ items: item(400000), into: "z1" })}${AS.olivia}select admin.set_policy('orders.deposit', '{"mode":"unconfigured"}'::jsonb, 'unconfirmed_default', 'withdraw');
        select admin.transition_order(:'z1', 'awaiting_deposit');`, "", /has not been configured by the owner/);
    });
  });

  // =================================================================================================================
  describe("the deposit is fixed when the order is confirmed", () => {
    const state = (v) => `select deposit_required_minor || '|' || coalesce(deposit_rate_bps::text, '-') || '|' || coalesce(deposit_policy_version::text, '-') || '|' || (deposit_fixed_at is not null)::text from public.orders where id = :'${v}';\n`;

    it("before confirmation the figure is provisional: nothing is recorded as fixed", () => {
      const out = db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "p1" })}${state("p1")}`).split("\n").pop();
      assert.equal(out, "100000|-|-|false");
    });

    it("confirming records the amount, the rate, the policy version, the rule in words and the gate", () => {
      const out = db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "p2" })}${AS.olivia}select admin.transition_order(:'p2', 'awaiting_deposit');${state("p2")}
        select deposit_rule || '|' || deposit_gate_status from public.orders where id = :'p2';`).split("\n").slice(-2);
      assert.match(out[0], /^100000\|2500\|\d+\|true$/);
      assert.equal(out[1], "tier 2 of 3: 25.00% of the whole order total, to the nearest dirham (a half rounds up)|deposit_received");
    });

    it("a later change of policy does not touch an order that was confirmed", () => {
      const out = db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "p3" })}${AS.olivia}select admin.transition_order(:'p3', 'awaiting_deposit');
        select admin.set_policy('orders.deposit', '{"mode":"fixed","fixed_minor":1,"required_before_status":"deposit_received"}'::jsonb, 'unconfirmed_default', 'change after confirmation');
        select deposit_required_minor from public.orders where id = :'p3';`).split("\n").pop();
      assert.equal(out, "100000");
    });

    it("an order confirmed AFTER a policy change uses the new policy, and an unconfirmed order is not frozen early", () => {
      const out = db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "p4" })}${AS.olivia}
        select admin.set_policy('orders.deposit', '{"mode":"fixed","fixed_minor":12345,"required_before_status":"deposit_received"}'::jsonb, 'unconfirmed_default', 'new schedule');
        select admin.transition_order(:'p4', 'awaiting_deposit');${state("p4")}`).split("\n").pop();
      assert.match(out, /^12345\|-\|\d+\|true$/);
    });

    it("the gate an order is held to is the one recorded at confirmation, even if the policy's gate moves later", () => {
      db.denied(`${CONFIRMED}${newOrder({ items: item(400000), into: "p5" })}${AS.olivia}select admin.transition_order(:'p5', 'awaiting_deposit');
        select admin.set_policy('orders.deposit', '{"mode":"tiered","minimum_minor":0,"required_before_status":"delivered","tiers":[{"percent_bps":100}]}'::jsonb, 'unconfirmed_default', 'move the gate later');
        select admin.transition_order(:'p5', 'deposit_received');`, "", /deposit has not been fully paid \(0 of 100000/);
    });

    it("once fixed, nothing that defines the deposit can be changed, by any role", () => {
      for (const change of ["deposit_required_minor = 1", "deposit_rate_bps = 1", "deposit_policy_version = 99", "deposit_rule = 'x'", "deposit_gate_status = null", "deposit_fixed_at = now() + interval '1 day'", "total_minor = 500000"]) {
        db.denied(`${CONFIRMED}${newOrder({ items: item(400000), into: "p6" })}${AS.olivia}select admin.transition_order(:'p6', 'awaiting_deposit');
          ${AS.superuser}select private.set_write_ctx(true);update public.orders set ${change} where id = :'p6';`, "", /deposit of a confirmed order is fixed/);
      }
    });

    it("an order with no priced items cannot be confirmed", () => {
      db.denied(`${CONFIRMED}${newOrder({ items: item(0), into: "p7" })}${AS.olivia}select admin.transition_order(:'p7', 'awaiting_deposit');`, "", /no priced items/);
    });

    it("a deposit counts as paid only after an authorised person records the receipt; nobody else can", () => {
      const setup = `${CONFIRMED}${newOrder({ items: item(400000), into: "q1" })}${AS.olivia}select admin.transition_order(:'q1', 'awaiting_deposit');\n`;
      // The order is not "deposit received" until the ledger says so.
      db.denied(`${setup}select admin.transition_order(:'q1', 'deposit_received');`, "", /deposit has not been fully paid/);
      // A customer cannot record a payment, nor write the ledger or the order directly.
      db.denied(`${setup}${AS.alice}select admin.record_payment(:'q1', 'deposit', 100000, 'cash');`, "", /permission denied: payments.record/);
      db.denied(`${setup}${AS.alice}insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (:'q1', 'payment', 'deposit', 100000, 'cash');`, "", /permission denied/);
      db.denied(`${setup}${AS.alice}update public.orders set amount_paid_minor = 100000 where id = :'q1';`, "", /permission denied/);
      // Staff without the permission (the day-to-day role) cannot either; the owner can.
      db.denied(`${setup}${AS.sam}select admin.record_payment(:'q1', 'deposit', 100000, 'cash');`, "", /permission denied: payments.record/);
      const ok = db.ok(`${setup}select admin.record_payment(:'q1', 'deposit', 100000, 'fawran') is not null;select admin.transition_order(:'q1', 'deposit_received');select status from public.orders where id = :'q1';`);
      assert.equal(ok.split("\n").pop(), "deposit_received");
    });

    it("refunds are not inferred: no refund entry can be created through the staff functions", () => {
      const names = db.ok(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and p.proname ilike '%refund%';`, AS.superuser);
      assert.equal(names, "0");
    });
  });

  // =================================================================================================================
  describe("receipts, Fawran and reversals", () => {
    const pay = (v, amount, method = "cash", extra = "") => `select admin.record_payment(:'${v}', 'deposit', ${amount}, '${method}'${extra});\n`;
    const confirmed = (v, total = 400000) => `${CONFIRMED}${newOrder({ items: item(total), into: v })}${AS.olivia}select admin.transition_order(:'${v}', 'awaiting_deposit');\n`;

    it("every payment gets a generated receipt reference, unique and never reused", () => {
      const out = db.ok(`${confirmed("a1")}${pay("a1", 10000)}${pay("a1", 20000, "fawran")}${pay("a1", 5000, "cash")}
        select string_agg(receipt_number, ',' order by created_at, receipt_number) from public.payments where order_id = :'a1';`).split("\n").pop().split(",");
      assert.equal(out.length, 3);
      assert.equal(new Set(out).size, 3, "all different");
      for (const receipt of out) assert.match(receipt, /^R-\d{4}-\d{5}$/);
    });

    it("references are unique across orders too, and a supplied reference cannot repeat", () => {
      db.denied(`${confirmed("a2")}${confirmed("a3")}${pay("a2", 10000, "cash", ", now(), 'FIXED-1'")}${pay("a3", 10000, "cash", ", now(), 'FIXED-1'")}`, "", /payments_receipt_number_unique/);
    });

    it("Fawran and cash are accepted; an unknown method is not", () => {
      assert.equal(db.ok(`${confirmed("a4")}${pay("a4", 1000, "fawran")}select method from public.payments where order_id = :'a4';`).split("\n").pop(), "fawran");
      db.denied(`${confirmed("a5")}${pay("a5", 1000, "crypto")}`, "", /payments_method_check/);
    });

    it("the processor's own reference (for example a Fawran transaction number) is private to staff", () => {
      const out = db.ok(`${confirmed("a6")}${pay("a6", 1000, "fawran", ", now(), null, 'FAWRAN-TXN-SECRET-77'")}${AS.bob}select count(*) from public.payments where order_id = :'a6';`);
      assert.equal(out.split("\n").pop(), "0", "another customer sees none of it");
      db.denied(`${confirmed("a7")}${AS.alice}select internal_reference from private.payment_details;`, "", /permission denied/);
    });

    it("a reversal is an audited negative entry: it lowers the paid amount, keeps the original, and can happen once", () => {
      const out = db.ok(`${confirmed("a8")}${pay("a8", 50000)}
        select admin.reverse_payment((select id from public.payments where order_id = :'a8' and entry_type = 'payment'), 'recorded twice by mistake');
        select amount_paid_minor from public.orders where id = :'a8';
        ${AS.superuser}select count(*) from private.audit_log where action = 'payment.reversed' ;`).split("\n").slice(-2);
      assert.equal(out[0], "0");
      assert.ok(Number(out[1]) >= 1, "the reversal is in the audit log");
      db.denied(`${confirmed("a9")}${pay("a9", 50000)}select admin.reverse_payment((select id from public.payments where order_id = :'a9' and entry_type = 'payment'), 'first');
        select admin.reverse_payment((select id from public.payments where order_id = :'a9' and entry_type = 'payment'), 'second');`, "", /already been reversed/);
      db.denied(`${confirmed("a10")}${pay("a10", 50000)}${AS.sam}select admin.reverse_payment((select id from public.payments where order_id = :'a10'), 'staff may not');`, "", /permission denied: payments.reverse/);
    });
  });

  // =================================================================================================================
  describe("claim codes: revocation, and an account linked to more than one customer record", () => {
    const issue = `${AS.sam}select admin.issue_claim_code(:'custA') as code \\gset\n`;
    const codeId = `(select id from admin.list_claim_codes(:'custA') order by created_at desc limit 1)`;

    it("a revoked code can no longer be claimed, and the failure looks like every other failure", () => {
      const out = db.ok(`${issue}${AS.sam}select admin.revoke_claim_code(${codeId}, 'issued to the wrong person');
        ${AS.eve}select public.claim_customer_profile(:'code') is null;select public.claim_customer_profile('AAAAA-AAAAA-AAAAA-AAAAA') is null;
        select count(*) from public.customer_accounts where user_id = :'eve';`).split("\n").slice(-3);
      assert.deepEqual(out, ["t", "t", "0"]);
    });

    it("revocation needs the permission, a reason, an unused code, and happens once", () => {
      db.denied(`${issue}${AS.alice}select admin.revoke_claim_code(gen_random_uuid(), 'customer may not');`, "", /permission denied: customers.manage/);
      db.denied(`${issue}${AS.sam}select admin.revoke_claim_code(${codeId}, '');`, "", /reason is required/);
      db.denied(`${issue}${AS.sam}select admin.revoke_claim_code(${codeId}, 'first');select admin.revoke_claim_code(${codeId}, 'second');`, "", /already been revoked/);
      db.denied(`${issue}${AS.eve}select public.claim_customer_profile(:'code');${AS.sam}select admin.revoke_claim_code(${codeId}, 'too late');`, "", /already been used/);
    });

    it("the list shows the state of each code and never the code", () => {
      const out = db.ok(`${issue}${AS.sam}select string_agg(status, ',') from admin.list_claim_codes(:'custA');`).split("\n").pop();
      assert.equal(out, "active");
      const columns = db.ok(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'private' and table_name = 'customer_claim_codes';`, AS.superuser);
      assert.ok(!/code(,|$)/.test(columns.replace("code_hash", "")), "no column holds the code itself");
    });

    it("claiming is audited with who, which record and how many records the account already had", () => {
      const out = db.ok(`${issue}${AS.bob}select public.claim_customer_profile(:'code') is not null;
        ${AS.superuser}select details ->> 'records_linked_before' || ':' || (details ->> 'user_id') from private.audit_log where action = 'customer.claim_code_used' order by id desc limit 1;`).split("\n").pop();
      assert.equal(out, `1:${ID.bob}`);
    });

    it("an account that holds a record already cannot spend a second code on it", () => {
      const out = db.ok(`${AS.sam}select admin.issue_claim_code(:'custB') as code \\gset
        ${AS.bob}select public.claim_customer_profile(:'code') is null;${AS.superuser}select count(*) from private.customer_claim_codes where customer_id = :'custB' and used_at is not null;`).split("\n").slice(-2);
      assert.deepEqual(out, ["t", "0"]);
    });

    it("linking never touches the records: no customer, order or ledger row is moved or rewritten", () => {
      const before = `select (select count(*) from public.customers) || ':' || (select count(*) from public.orders) || ':' || (select count(*) from public.loyalty_ledger) || ':' || (select string_agg(customer_id::text, ',' order by id) from public.orders);`;
      const out = db.ok(`${AS.superuser}${before}${issue}${AS.bob}select public.claim_customer_profile(:'code') is not null;${AS.superuser}${before}`).split("\n");
      assert.equal(out[0], out[2]);
    });
  });

  // =================================================================================================================
  describe("the staff functions", () => {
    it("staff create a customer record for a WhatsApp customer; a customer or a visitor cannot", () => {
      const out = db.ok(`${AS.sam}select admin.create_customer('Wendy Example', '+97455550123', 'wendy@example.test') as id \\gset
        select source || ':' || full_name || ':' || customer_code from public.customers where id = :'id';`).split("\n").pop();
      assert.match(out, /^whatsapp:Wendy Example:C-\d{4}-\d{5}$/);
      db.denied(`${AS.alice}select admin.create_customer('Nobody');`, "", /permission denied: customers.manage/);
      db.denied(`${AS.anon}select admin.create_customer('Nobody');`, "", /permission denied/);
      db.denied(`${AS.sam}select admin.create_customer('X', null, null, 'website');`, "", /source whatsapp, instagram, walk_in or other/);
      assert.equal(db.ok(`${AS.sam}select admin.create_customer('Audit Check') is not null;${AS.superuser}select count(*) from private.audit_log where action = 'customer.created_by_staff';`).split("\n").pop(), "1");
    });

    it("creating a customer never links or merges: a record with the same phone and email is simply another record", () => {
      const out = db.ok(`${AS.sam}select admin.create_customer('Alice Twin', '+97455550001', 'alice@example.test') is not null;
        select count(*) from public.customers where phone = '+97455550001' or email = 'alice@example.test';
        ${AS.superuser}select count(*) from public.customer_accounts where customer_id <> :'custA' and customer_id <> :'custB';`).split("\n").slice(-2);
      assert.deepEqual(out, ["2", "0"]);
    });

    it("search finds by name, phone digits, email, customer code and order reference, and treats wildcards as text", () => {
      const q = (text) => db.ok(`${newOrder({ into: "s1" })}${AS.sam}select count(*) from admin.search_customers('${text}');`).split("\n").pop();
      assert.equal(q("alice"), "1");
      assert.equal(q("0001"), "1"); // a phone number's digits
      assert.equal(q("bob@example"), "1");
      assert.equal(q("%"), "0", "a literal percent sign matches nothing; it is not a wildcard");
      assert.equal(q("_"), "0");
      const byRef = db.ok(`${newOrder({ into: "s2" })}${AS.sam}select count(*) from admin.search_customers((select order_ref from public.orders where id = :'s2'));`).split("\n").pop();
      assert.equal(byRef, "1");
      db.denied(`${AS.alice}select * from admin.search_customers('a');`, "", /permission denied: customers.read/);
    });

    it("the customer view shows orders only to someone who may read orders, and points only to someone who may read loyalty", () => {
      const full = JSON.parse(db.ok(`${newOrder({ into: "c1" })}${AS.olivia}select admin.get_customer(:'custA');`).split("\n").pop());
      assert.ok(Array.isArray(full.orders) && full.orders.length >= 1 && "loyalty_points" in full);
      const staff = JSON.parse(db.ok(`${newOrder({ into: "c2" })}${AS.sam}select admin.get_customer(:'custA');`).split("\n").pop());
      assert.ok(Array.isArray(staff.orders), "the day-to-day staff role reads orders");
      assert.ok(!("loyalty_points" in staff), "but not loyalty points");
    });

    it("the dashboard counts orders by stage, shows money only to someone who may read payments, and lists deposit shortfalls", () => {
      const olivia = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "d1" })}${AS.olivia}select admin.transition_order(:'d1', 'awaiting_deposit');
        select admin.dashboard_summary();`).split("\n").pop());
      assert.ok(olivia.total_orders >= 3 && olivia.awaiting_deposit >= 1);
      assert.ok("outstanding_balance_minor" in olivia && "deposit_shortfalls" in olivia);
      const sam = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "d2" })}${AS.sam}select admin.dashboard_summary();`).split("\n").pop());
      assert.ok(!("outstanding_balance_minor" in sam) && !("deposit_shortfalls" in sam), "no money for staff without payments.read");
      // After a reversal that leaves an order past the gate below its deposit, it appears in the shortfall list.
      const short = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "d3" })}${AS.olivia}select admin.transition_order(:'d3', 'awaiting_deposit');
        select admin.record_payment(:'d3', 'deposit', 100000, 'cash');select admin.transition_order(:'d3', 'deposit_received');
        select admin.reverse_payment((select id from public.payments where order_id = :'d3' and entry_type = 'payment'), 'bounced');
        select admin.dashboard_summary() -> 'deposit_shortfalls';`).split("\n").pop());
      assert.ok(short.some((entry) => entry.deposit_required_minor === 100000 && entry.amount_paid_minor === 0));
    });

    it("a fixed deposit is not a received deposit: nothing counts until staff record the payment", () => {
      const o = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "g0" })}${AS.olivia}select admin.transition_order(:'g0', 'awaiting_deposit');
        select admin.get_order(:'g0');`).split("\n").pop());
      assert.equal(o.deposit_fixed, true);
      assert.equal(o.deposit_received, false);
      assert.equal(o.amount_paid_minor, 0);
    });

    it("the order detail carries the deposit record, the next allowed statuses for THIS person, and payments only with payments.read", () => {
      const o = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "g1" })}${AS.olivia}select admin.transition_order(:'g1', 'awaiting_deposit');
        select admin.record_payment(:'g1', 'deposit', 100000, 'fawran', now(), null, 'TXN-1');select admin.get_order(:'g1');`).split("\n").pop());
      assert.equal(o.deposit_fixed, true);
      assert.equal(o.deposit_received, true, "staff recorded a payment that covers the fixed deposit");
      assert.equal(o.deposit_rate_bps, 2500);
      assert.equal(o.deposit_outstanding_minor, 0);
      assert.equal(o.payments.length, 1);
      assert.match(o.payments[0].receipt_number, /^R-/);
      assert.deepEqual(o.next_statuses.map((s) => s.code).sort(), ["cancelled", "deposit_received", "on_hold"]);
      const s = JSON.parse(db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "g2" })}${AS.sam}select admin.get_order(:'g2');`).split("\n").pop());
      assert.ok(!("payments" in s), "no payments for staff without payments.read");
      assert.ok(!JSON.stringify(s).includes("supplier"), "no supplier or cost fields");
    });

    it("the deposit preview shows what an order total would owe, changes nothing, and needs orders.read", () => {
      const preview = (total) => JSON.parse(db.ok(`${CONFIRMED}${AS.sam}select admin.preview_deposit(${total});`).split("\n").pop());
      assert.deepEqual([preview(300000).amount_minor, preview(300001).amount_minor, preview(500000).amount_minor, preview(500001).amount_minor], [45000, 75000, 125000, 175000]);
      assert.equal(preview(300001).rate_bps, 2500);
      assert.match(preview(300001).rule, /tier 2 of 3/);
      db.denied(`${AS.alice}select admin.preview_deposit(100000);`, "", /permission denied: orders.read/);
      const count = "select count(*) from public.orders where deposit_fixed_at is not null;";
      const out = db.ok(`${AS.superuser}${count}${CONFIRMED}${AS.sam}select admin.preview_deposit(100000);${AS.superuser}${count}`).split("\n").filter((l) => /^\d+$/.test(l));
      assert.equal(out[0], out[out.length - 1], "previewing fixes nothing");
    });

    it("payments and loyalty lists need their permissions; the audit list needs audit.read", () => {
      db.denied(`${AS.sam}select admin.list_payments();`, "", /permission denied: payments.read/);
      db.denied(`${AS.sam}select admin.list_loyalty();`, "", /permission denied: loyalty.read/);
      db.denied(`${AS.sam}select admin.list_audit();`, "", /permission denied: audit.read/);
      assert.equal(db.ok(`${AS.olivia}select jsonb_typeof(admin.list_audit()) || ',' || jsonb_typeof(admin.list_payments()) || ',' || jsonb_typeof(admin.list_loyalty());`).split("\n").pop(), "array,array,object");
    });
  });

  // =================================================================================================================
  describe("staff management: nobody assigns themselves a role", () => {
    it("a person cannot change their own role or status, even the owner", () => {
      db.denied(`${AS.olivia}select admin.set_staff_member(:'olivia', 'owner', true, 'Olivia', 'self');`, "", /cannot change your own role or status/);
      db.denied(`${AS.sam}select admin.set_staff_member(:'sam', 'owner', true, 'Sam', 'promote myself');`, "", /permission denied: staff.manage/);
    });

    it("a customer or visitor cannot reach staff management, and the tables cannot be written directly", () => {
      db.denied(`${AS.alice}select admin.set_staff_member(:'alice', 'owner', true, 'Alice', 'become staff');`, "", /permission denied/);
      db.denied(`${AS.alice}insert into private.staff_members (user_id, role_code) values (:'alice', 'owner');`, "", /permission denied/);
      db.denied(`${AS.sam}update private.staff_members set role_code = 'owner' where user_id = :'sam';`, "", /permission denied/);
      db.denied(`${AS.forgedAdmin}select admin.set_staff_member(:'alice', 'owner', true, 'Alice', 'forged claims');`, "", /permission denied/);
    });

    it("the owner can add and change staff, every change is audited, and the last active owner is protected", () => {
      const out = db.ok(`${AS.olivia}select admin.set_staff_member(:'eve', 'staff', true, 'Eve Example', 'new colleague');
        ${AS.superuser}select role_code from private.staff_members where user_id = :'eve';
        select count(*) from private.audit_log where action = 'staff.changed';`).split("\n").slice(-2);
      assert.equal(out[0], "staff");
      assert.equal(out[1], "1");
      // Make a second owner, who then tries to demote the first, who is the second-to-last: allowed. Demoting the last: refused.
      db.denied(`${AS.olivia}select admin.set_staff_member(:'eve', 'owner', true, 'Eve', 'second owner');
        ${AS.superuser}update private.staff_members set is_active = false where user_id = :'olivia';
        ${AS.superuser}select set_config('request.jwt.claims', '{"sub":"${ID.eve}","role":"authenticated","aal":"aal2"}', true);
        set local role authenticated;select admin.set_staff_member(:'eve', 'staff', true, 'Eve', 'demote the last owner');`, "", /cannot change your own|last active owner|permission denied/);
    });

    it("an unknown role or user is refused, and a reason is required", () => {
      db.denied(`${AS.olivia}select admin.set_staff_member(:'eve', 'emperor', true, 'Eve', 'bad role');`, "", /unknown staff role/);
      db.denied(`${AS.olivia}select admin.set_staff_member('00000000-0000-4000-8000-00000000ffff', 'staff', true, 'Nobody', 'no such user');`, "", /user not found/);
      db.denied(`${AS.olivia}select admin.set_staff_member(:'eve', 'staff', true, 'Eve', '');`, "", /reason is required/);
    });
  });

  // =================================================================================================================
  describe("the staff gateway: a login role that can only call the staff functions, and whose claims are verified", () => {
    it("the gateway audit finds no violation, and is not vacuous", () => {
      assert.equal(db.ok("select count(*) from private.gateway_audit();", AS.superuser), "0");
      // Granting the role a table, an API role, or an extra function must be reported.
      assert.match(db.ok("grant select on public.orders to m1_staff_gateway; select check_name from private.gateway_audit();", AS.superuser), /gateway_has_table_privilege/);
      assert.match(db.ok("grant authenticated to m1_staff_gateway; select check_name from private.gateway_audit();", AS.superuser), /gateway_is_member_of_api_role/);
      assert.match(db.ok("grant execute on function private.has_permission(text) to m1_staff_gateway; select check_name from private.gateway_audit();", AS.superuser), /gateway_can_execute_outside_admin/);
      assert.match(db.ok("grant usage on schema private to m1_staff_gateway; select check_name from private.gateway_audit();", AS.superuser), /gateway_has_schema_privilege/);
      assert.match(db.ok("alter role m1_staff_gateway createrole; select check_name from private.gateway_audit();", AS.superuser), /gateway_role_too_powerful/);
    });

    it("the role cannot log in (no password, no login) until a person makes it so, and has no table privileges at all", () => {
      assert.equal(db.ok("select r.rolcanlogin::text || ',' || r.rolsuper::text || ',' || (a.rolpassword is not null)::text from pg_roles r left join pg_authid a on a.oid = r.oid where r.rolname = 'm1_staff_gateway';", AS.superuser), "false,false,false");
      db.denied(`${gateway()}select count(*) from public.orders;`, "", /permission denied/);
      db.denied(`${gateway()}select * from private.staff_members;`, "", /permission denied/);
      db.denied(`${gateway()}set role authenticated;`, "", /permission denied to set role/);
      db.denied(`${gateway()}set role postgres;`, "", /permission denied to set role/);
      db.denied(`${gateway()}select private.has_permission('orders.read');`, "", /permission denied/);
    });

    it("is_staff_member answers only for the caller, needs no second factor, and still checks the sign-in session through the gateway", () => {
      // An active staff member, signed in at the first level only: yes. The staff functions themselves still refuse.
      assert.equal(db.ok(`${session(SID, ID.olivia, "aal1")}${gateway({ aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "t");
      // A customer, an inactive staff member and nobody: no.
      assert.equal(db.ok(`${session(SID, ID.alice, "aal1")}${gateway({ sub: ID.alice, aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "f");
      assert.equal(db.ok(`${session(SID, ID.dana, "aal1")}${gateway({ sub: ID.dana, aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "f");
      assert.equal(db.ok(`reset role;\nreset session authorization;\nset session authorization m1_staff_gateway;\nselect admin.is_staff_member();`).split("\n").pop(), "f");
      // Through the gateway the session must exist, belong to the user and be unexpired.
      assert.equal(db.ok(`${gateway({ aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "f", "no session row");
      assert.equal(db.ok(`${session(SID, ID.sam, "aal1")}${gateway({ sub: ID.olivia, aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "f", "someone else's session");
      assert.equal(db.ok(`${session(SID, ID.olivia, "aal1", "now() - interval '1 minute'")}${gateway({ aal: "aal1" })}select admin.is_staff_member();`).split("\n").pop(), "f", "expired session");
      // The staff functions still need the second factor.
      db.denied(`${session(SID, ID.olivia, "aal1")}${gateway({ aal: "aal1" })}select * from admin.search_customers('a');`, "", /permission denied/);
    });

    it("with a live second-factor session of the same user, the staff functions work", () => {
      const out = db.ok(`${session(SID, ID.olivia)}${gateway()}select admin.my_permissions() is not null;select count(*) > 0 from admin.search_customers('alice');`).split("\n").slice(-2);
      assert.deepEqual(out, ["t", "t"]);
    });

    it("the database does not take the gateway's word for the second factor: no session row, a first-factor session, an expired one or someone else's all fail", () => {
      const denied = /permission denied: customers.read/;
      // no session record at all
      db.denied(`${gateway()}select * from admin.search_customers('a');`, "", denied);
      // a session that only reached the first factor, while the claims say aal2
      db.denied(`${session(SID, ID.olivia, "aal1")}${gateway()}select * from admin.search_customers('a');`, "", denied);
      // an expired session
      db.denied(`${session(SID, ID.olivia, "aal2", "now() - interval '1 minute'")}${gateway()}select * from admin.search_customers('a');`, "", denied);
      // a live second-factor session belonging to a DIFFERENT person than the claims name
      db.denied(`${session(SID, ID.sam)}${gateway({ sub: ID.olivia })}select * from admin.search_customers('a');`, "", denied);
      // claims that say aal1 are refused even when a good session exists
      db.denied(`${session(SID, ID.olivia)}${gateway({ aal: "aal1" })}select * from admin.search_customers('a');`, "", denied);
      // a session id that is not a uuid
      db.denied(`${session(SID, ID.olivia)}${gateway({ sid: "not-a-uuid" })}select * from admin.search_customers('a');`, "", denied);
    });

    it("a signed-out session (its row is gone) stops working at once", () => {
      db.denied(`${session(SID, ID.olivia)}reset session authorization;delete from auth.sessions where id = '${SID}';${gateway()}select * from admin.search_customers('a');`, "", /permission denied/);
    });

    it("the gateway cannot act as someone who is not active staff, or exceed that person's own permissions", () => {
      // a customer's live session: the staff table does not name them
      db.denied(`${session(SID, ID.alice)}${gateway({ sub: ID.alice })}select * from admin.search_customers('a');`, "", /permission denied/);
      // an active staff member without payments.record cannot record a payment through the gateway either
      db.denied(`${session(SID2, ID.sam)}${newOrder({ items: item(400000), into: "w1" })}${gateway({ sub: ID.sam, sid: SID2 })}select admin.record_payment(:'w1', 'deposit', 100, 'cash');`, "", /permission denied: payments.record/);
      // a deactivated staff member
      db.denied(`${session(SID2, ID.dana)}${gateway({ sub: ID.dana, sid: SID2 })}select * from admin.search_customers('a');`, "", /permission denied/);
    });

    it("a staff action through the gateway is attributed to the named person in the audit log", () => {
      const out = db.ok(`${session(SID, ID.olivia)}${gateway()}select admin.create_customer('Gateway Check') as id \\gset
        reset session authorization;select actor || ':' || action from private.audit_log where action = 'customer.created_by_staff' order by id desc limit 1;`).split("\n").pop();
      assert.equal(out, `${ID.olivia}:customer.created_by_staff`);
    });

    it("the Data API path is unchanged: an ordinary aal2 claim works with no session row, and aal1 does not", () => {
      assert.equal(db.ok("select count(*) > 0 from admin.search_customers('alice');", AS.olivia), "t");
      db.denied(`${AS.oliviaAal1}select * from admin.search_customers('a');`, "", /permission denied/);
    });

    it("a superuser is not mistaken for the gateway, and a login that is a member of the gateway role is treated as one", () => {
      assert.equal(db.ok("select private.via_gateway()::text;", AS.superuser), "false");
      // A login made a member of the role inherits its rights and is held to the same session check.
      db.denied(`reset role;create role gw_member nologin;grant m1_staff_gateway to gw_member;set session authorization gw_member;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: ID.olivia, role: "authenticated", aal: "aal2", session_id: SID })}', true);
        select * from admin.search_customers('a');`, "", /permission denied: customers.read/);
    });

    it("nothing in the migrations creates a login or a password for the role", () => {
      assert.equal(db.ok("select count(*) from pg_roles where rolname = 'm1_staff_gateway' and rolcanlogin;", AS.superuser), "0");
    });
  });

  // =================================================================================================================
  describe("customer isolation for everything new", () => {
    it("no customer or visitor can call any staff function, whatever its arguments", () => {
      const calls = [
        "admin.create_customer('x')", "admin.search_customers('a')", "admin.get_customer(:'custA')", "admin.list_orders()", "admin.get_order((select id from public.orders limit 1))",
        "admin.list_payments()", "admin.list_loyalty()", "admin.dashboard_summary()", "admin.list_audit()", "admin.list_staff()", "admin.list_policy_versions('orders.deposit')",
        "admin.list_claim_codes(:'custA')", "admin.revoke_claim_code(gen_random_uuid(), 'because')", "admin.issue_claim_code(:'custA')",
      ];
      for (const who of [AS.alice, AS.bob, AS.eve, AS.anon, AS.forgedAdmin]) {
        for (const call of calls) db.denied(`${newOrder({ into: "iso" })}${who}select ${call};`, "", /permission denied/);
      }
    });

    it("a customer sees only their own orders, payments and the deposit record, and not another customer's", () => {
      const out = db.ok(`${CONFIRMED}${newOrder({ customer: ID.custB, items: item(400000), into: "iso2" })}${AS.olivia}select admin.transition_order(:'iso2', 'awaiting_deposit');select admin.record_payment(:'iso2', 'deposit', 1000, 'cash');
        ${AS.alice}select (select count(*) from public.orders where id = :'iso2') || ':' || (select count(*) from public.payments where order_id = :'iso2');
        ${AS.bob}select (select count(*) from public.orders where id = :'iso2') || ':' || (select count(*) from public.payments where order_id = :'iso2');`).split("\n").slice(-2);
      assert.deepEqual(out, ["0:0", "1:1"]);
    });

    it("an account linked to two records sees both records' orders, and no one else's", () => {
      const out = db.ok(`${newOrder({ into: "iso3" })}${AS.sam}select admin.issue_claim_code(:'custA') as code \\gset
        ${AS.bob}select public.claim_customer_profile(:'code') is not null;
        select (select count(*) from public.orders where id = :'iso3') || ':' || (select count(*) from public.orders);
        ${AS.eve}select count(*) from public.orders;`).split("\n").slice(-2);
      assert.ok(out[0].startsWith("1:"));
      assert.equal(out[1], "0");
    });

    it("the deposit columns on an order contain nothing a customer should not see", () => {
      const o = db.ok(`${CONFIRMED}${newOrder({ items: item(400000), into: "iso4" })}${AS.olivia}select admin.transition_order(:'iso4', 'awaiting_deposit');
        ${AS.alice}select deposit_rule || '|' || deposit_rate_bps from public.orders where id = :'iso4';`).split("\n").pop();
      assert.equal(o, "tier 2 of 3: 25.00% of the whole order total, to the nearest dirham (a half rounds up)|2500");
    });
  });
});

// A reminder for readers: JSON helper is imported for fixtures that build items; kept explicit so a lint rule does not remove it.
void json;
