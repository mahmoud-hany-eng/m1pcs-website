// The OWNER-DEFINED ORDER WORKFLOW (workflow version 2), DATABASE layer: real PostgreSQL 16, the real migrations, the real staff
// functions (admin.*) and the real row level security. Every figure is an integer in QAR minor units (1 QAR = 100). Every
// name is synthetic. Harness-supplied JWT claims stand in for Supabase Auth, as in every database test in this folder: a pass
// here proves the DATABASE's behaviour given those claims, not the website and not the real second factor.
//
// What it proves, in the order of the owner's brief:
//   A  the complete new sequence, and that every move not on it is refused;      B  Live tracking as ONE status with nested updates;
//   C  the deposit gate (the tiers, the exact boundary, no manual bypass);       D  the two fulfilment branches;
//   E  hold, resume and cancel;  F  existing (legacy) orders, including one shaped like the synthetic order O-2611-00001;
//   G  loyalty, payments, receipts and duplicates;  H  staff permissions, customer visibility, MFA and the append-only history.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { asRole, findPgBin } from "./harness.mjs";
import { AS, ID, newOrder, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");
const suite = haveServer ? describe : describe.skip;

const CUST = "00000000-0000-4000-8000-0000000000c9"; // a walk-in customer without a sign-in: the mechanics orders
const one = (price) => [{ kind: "component", description: "Test item", quantity: 1, unit_price_minor: price }];
const lines = (out) => out.split("\n").filter((l) => l !== "");
const tierBps = (total) => (total <= 300000n ? 1500n : total <= 500000n ? 2500n : total <= 1000000n ? 3500n : total <= 1500000n ? 5000n : 6000n); // the owner's five tiers (PLAT-0005)
const deposit = (total) => (total * tierBps(total) + 5000n) / 10000n;

const V2_COMMON = ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"];
const CUSTOM_BRANCH = ["building", "quality_check"];
const PARTS_BRANCH = ["items_arrived", "awaiting_scheduling"];

suite("order workflow v2: database layer (real PostgreSQL 16, real migrations, real RLS)", () => {
  let db;

  before(() => {
    db = startDatabase({ schedule: "confirmed" });
    db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${CUST}', 'Carol Test (walk-in)', '+97455550003', 'carol@example.test', 'walk_in');`);
    db.commit(`create function public.zz_attempt(stmt text) returns text language plpgsql as $f$
      begin execute stmt; return 'OK'; exception when others then return 'REFUSED: ' || sqlerrm; end $f$;`);
    db.commit(`create function public.zz_count(stmt text) returns text language plpgsql as $f$
      declare n bigint; begin execute stmt into n; return n::text; exception when others then return 'DENIED'; end $f$;`);
  });
  after(() => db?.stop());

  // ---- helpers -------------------------------------------------------------------------------------------------
  const read = (sql, who = "") => lines(db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who)).pop() ?? "";
  const act = (who, sql) => db.commit(`${who}${sql}`);
  const attempt = (who, sql) => lines(db.ok(`select public.zz_attempt('${sql.replaceAll("'", "''")}');`, who)).pop();
  const rowsSeen = (who, sql) => lines(db.ok(`select public.zz_count('${sql.replaceAll("'", "''")}');`, who)).pop();
  const refused = (result, pattern, label = "") => {
    assert.match(result, /^REFUSED: /, `${label} should have been refused but got: ${result}`);
    assert.match(result, pattern, label);
  };
  const make = (total = 100000, { customer = CUST, who = AS.sam } = {}) => lines(db.commit(`${newOrder({ customer, items: one(total), into: "o", who })}select :'o';`)).pop().trim();
  const move = (id, to, who = AS.sam) => act(who, `select admin.transition_order('${id}', '${to}', 'test');`);
  const tryMove = (id, to, who = AS.sam) => attempt(who, `select admin.transition_order('${id}', '${to}', 'test')`);
  const pay = (id, amount, purpose = "deposit") => act(AS.olivia, `select admin.record_payment('${id}', '${purpose}', ${amount}, 'cash');`);
  const get = (id, who = AS.sam) => JSON.parse(read(`select admin.get_order('${id}')::text`, who));
  const status = (id) => read(`select status from public.orders where id = '${id}'`);
  const nexts = (id, who = AS.sam) => get(id, who).next_statuses;
  const nextCodes = (id, who = AS.sam) => nexts(id, who).map((n) => n.code).sort();
  const events = (id) => lines(read(`select coalesce(string_agg(title, '|' order by coalesce(occurred_at, published_at), published_at), '') from public.order_tracking_events where order_id = '${id}'`)).join("");
  const count = (sql) => Number(read(sql));
  const setSwitch = (version) =>
    act(AS.olivia, `select admin.set_policy('orders.workflow', '{"default_version": ${version}}'::jsonb, 'confirmed_by_owner', 'test: release switch');`);
  const publish = (id, title, { who = AS.sam, loc = null, at = null, msg = null } = {}) =>
    act(who, `select admin.publish_tracking_update('${id}', '${title}', ${msg ? `'${msg}'` : "null"}, ${loc ? `'${loc}'` : "null"}, ${at ? `'${at}'::timestamptz` : "null"});`);
  const tryPublish = (id, title, who = AS.sam) => attempt(who, `select admin.publish_tracking_update('${id}', '${title}', null, null, null)`);

  /** A version-2 order driven to `target` along the owner's path, with the deposit (or, if asked, everything) paid. */
  function v2Order(target, { total = 100000, type = null, full = false } = {}) {
    const id = make(total);
    if (type) act(AS.sam, `select admin.set_order_fulfillment_type('${id}', '${type}');`);
    if (target === "pending_confirmation") return id;
    move(id, "awaiting_deposit");
    if (target === "awaiting_deposit") return id;
    pay(id, full ? total : Number(deposit(BigInt(total))));
    const branch = type === "custom_pc_build" ? CUSTOM_BRANCH : type === "parts_only" ? PARTS_BRANCH : [];
    for (const step of [...V2_COMMON.slice(2), ...branch, "ready_for_delivery", "delivered"]) {
      if (status(id) === target) break;
      move(id, step);
    }
    assert.equal(status(id), target, `the fixture reached ${target}`);
    return id;
  }

  // ---- legacy orders, created BEFORE the release switch (the default is still workflow 1) ---------------------------------
  const legacy = {};
  function legacyOrder(name, steps, { total = 120000, payAll = false, tracking = 0 } = {}) {
    const id = make(total);
    legacy[name] = id;
    for (const s of steps) {
      move(id, s);
      if (s === "awaiting_deposit") pay(id, Number(deposit(BigInt(total))));
    }
    if (payAll) pay(id, total - Number(deposit(BigInt(total))), "balance");
    for (let i = 1; i <= tracking; i++) act(AS.sam, `select admin.publish_tracking_event('${id}', 'Legacy update ${i}', 'Message ${i}', 'in_transit');`);
    return id;
  }
  const V1_TO = { sourcing: ["awaiting_deposit", "deposit_received", "sourcing"], in_transit: ["awaiting_deposit", "deposit_received", "sourcing", "in_transit"] };
  before(() => {
    legacyOrder("pending", []);
    legacyOrder("awaiting", ["awaiting_deposit"]);
    legacyOrder("deposit", ["awaiting_deposit", "deposit_received"]);
    legacyOrder("sourcing", V1_TO.sourcing);
    // Shaped like the synthetic hosted order O-2611-00001: in transit, two payments making it fully paid, four tracking updates, no loyalty yet.
    legacyOrder("transit", V1_TO.in_transit, { payAll: true, tracking: 4 });
    legacyOrder("building", [...V1_TO.in_transit, "building"]);
    legacyOrder("quality", [...V1_TO.in_transit, "building", "quality_check"]);
    legacyOrder("ready", [...V1_TO.in_transit, "building", "quality_check", "ready_for_delivery"]);
    legacyOrder("delivered", [...V1_TO.in_transit, "building", "quality_check", "ready_for_delivery", "delivered"], { payAll: true });
    legacyOrder("held", [...V1_TO.in_transit, "building", "on_hold"]);
    legacyOrder("cancelled", ["awaiting_deposit", "cancelled"]);
  });

  // =================================================================================================================
  describe("the release switch: nothing changes for existing orders until the owner flips it", () => {
    it("ships as workflow 1: a new order follows the earlier workflow and has no fulfilment type", () => {
      assert.equal(read("select value::text from private.business_policies where key = 'orders.workflow'"), '{"default_version": 1}');
      const id = make();
      assert.equal(read(`select workflow_version || ':' || coalesce(fulfillment_type, 'none') from public.orders where id = '${id}'`), "1:none");
      assert.deepEqual(nextCodes(id), ["awaiting_deposit", "cancelled"]);
    });

    it("every pre-existing order is on workflow 1 with its status unchanged by the migrations", () => {
      assert.equal(count("select count(*) from public.orders where workflow_version <> 1"), 0);
      assert.equal(status(legacy.transit), "in_transit");
      assert.equal(status(legacy.held), "on_hold");
      assert.equal(status(legacy.delivered), "delivered");
    });

    it("only the owner can change it, only to 1 or 2, and the change is versioned and audited", () => {
      refused(attempt(AS.sam, `select admin.set_policy('orders.workflow', '{"default_version": 2}'::jsonb, 'confirmed_by_owner', 'staff try')`), /permission denied: policies\.manage/, "staff");
      refused(attempt(AS.olivia, `select admin.set_policy('orders.workflow', '{"default_version": 3}'::jsonb, 'confirmed_by_owner', 'bad value')`), /default_version must be 1/, "3");
      refused(attempt(AS.olivia, `select admin.set_policy('orders.workflow', '{"default_version": "2"}'::jsonb, 'confirmed_by_owner', 'a string')`), /default_version must be 1/, "string");
      refused(attempt(AS.olivia, `select admin.set_policy('orders.workflow', '{"default_version": 2, "x": 1}'::jsonb, 'confirmed_by_owner', 'extra key')`), /allows only default_version/, "extra key");
      setSwitch(2);
      assert.equal(read("select version from private.business_policies where key = 'orders.workflow'"), "2");
      assert.equal(count("select count(*) from private.audit_log where action = 'policy.changed' and entity_id = 'orders.workflow'"), 1);
    });

    it("after the switch NEW orders are workflow 2; the existing ones stay on workflow 1", () => {
      const id = make();
      assert.equal(read(`select workflow_version from public.orders where id = '${id}'`), "2");
      for (const id of Object.values(legacy)) assert.equal(read(`select workflow_version from public.orders where id = '${id}'`), "1");
    });

    it("the switch can be put back to 1 (a rollback of the setting, not of any order)", () => {
      setSwitch(1);
      const id = make();
      assert.equal(read(`select workflow_version from public.orders where id = '${id}'`), "1");
      setSwitch(2);
      assert.equal(read(`select workflow_version from public.orders where id = '${make()}'`), "2");
    });

    it("an order's workflow can only ever move from 1 to 2, never back", () => {
      const id = make();
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set workflow_version = 1 where id = '${id}'`), /only move from version 1 to version 2/, "2 to 1");
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set workflow_version = 3 where id = '${id}'`), /only move from version 1 to version 2|orders_workflow_version_check|check constraint/, "3");
    });
  });

  // =================================================================================================================
  describe("A. the complete sequence, and the moves that are not on it", () => {
    it("the stage data is exactly the owner's sequence, with the branches between the carrier step and the ready step", () => {
      const stages = (branch) => read(`select string_agg(status_code, ',' order by position) from public.order_workflow_stages where workflow_version = 2 and branch = '${branch}'`);
      assert.equal(stages("any"), "pending_confirmation,awaiting_deposit,deposit_received,order_confirmed,live_tracking,arrived_in_qatar,carrier_delivering,ready_for_delivery,delivered");
      assert.equal(stages("custom_pc_build"), "building,quality_check");
      assert.equal(stages("parts_only"), "items_arrived,awaiting_scheduling");
      assert.equal(read("select count(*) from public.order_workflow_stages where workflow_version = 2 and shows_tracking"), "1");
      assert.equal(read("select status_code from public.order_workflow_stages where workflow_version = 2 and shows_tracking"), "live_tracking");
    });

    it("the customer wording is the owner's", () => {
      const label = (code) => read(`select customer_label from public.order_statuses where code = '${code}'`);
      assert.deepEqual(
        ["awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "building", "quality_check", "items_arrived", "awaiting_scheduling", "ready_for_delivery", "delivered"].map(label),
        ["Awaiting deposit", "Deposit confirmed", "Order confirmed", "Live tracking", "Order arrived in Qatar", "Carrier delivering order to M1", "M1 is building your PC", "Final quality checks", "Items arrived at M1", "Awaiting scheduling for pickup or delivery", "Ready for delivery or pickup", "Delivered / Collected"],
      );
    });

    it("a custom PC order walks the whole sequence, every move is recorded, and the stage list it shows is the common stages plus the build branch", () => {
      const id = make(250000);
      const seen = [status(id)];
      move(id, "awaiting_deposit");
      pay(id, Number(deposit(250000n)));
      for (const step of ["deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"]) move(id, step);
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'custom_pc_build');`);
      for (const step of ["building", "quality_check", "ready_for_delivery"]) move(id, step);
      pay(id, 250000 - Number(deposit(250000n)), "balance");
      move(id, "delivered");
      seen.push(status(id));
      assert.deepEqual(seen, ["pending_confirmation", "delivered"]);
      assert.equal(read(`select string_agg(to_status, ',' order by id) from private.order_status_history where order_id = '${id}'`),
        "pending_confirmation,awaiting_deposit,deposit_received,order_confirmed,live_tracking,arrived_in_qatar,carrier_delivering,building,quality_check,ready_for_delivery,delivered");
      assert.deepEqual(get(id).stages.map((s) => s.code),
        ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "building", "quality_check", "ready_for_delivery", "delivered"]);
      assert.deepEqual(nexts(id), []);
    });

    it("every move that is not on the sequence is refused, with the database's reason", () => {
      const id = v2Order("live_tracking");
      for (const to of ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "carrier_delivering", "building", "ready_for_delivery", "delivered", "sourcing", "in_transit", "items_arrived"]) {
        refused(tryMove(id, to), /an order cannot move from live_tracking to /, `live_tracking -> ${to}`);
      }
      assert.deepEqual(nextCodes(id), ["arrived_in_qatar", "cancelled", "on_hold"]);
      refused(tryMove(id, "no_such_status"), /an order cannot move/, "unknown");
    });

    it("the earlier workflow's two stages cannot be entered by a version-2 order", () => {
      const id = v2Order("order_confirmed");
      refused(tryMove(id, "sourcing"), /an order cannot move from order_confirmed to sourcing/, "sourcing");
      refused(tryMove(id, "in_transit"), /an order cannot move from order_confirmed to in_transit/, "in_transit");
    });

    it("a finished order and a cancelled order have no next move", () => {
      const done = v2Order("delivered", { type: "parts_only", full: true });
      assert.equal(status(done), "delivered");
      assert.deepEqual(nexts(done), []);
      for (const to of ["on_hold", "cancelled", "ready_for_delivery"]) refused(tryMove(done, to), /an order cannot move from delivered/, `delivered -> ${to}`);
      const gone = make();
      move(gone, "cancelled");
      assert.deepEqual(nexts(gone), []);
      refused(tryMove(gone, "awaiting_deposit"), /an order cannot move from cancelled/, "cancelled");
    });

    it("the staff status dropdown lists only valid next moves, and the database accepts exactly those (no drift)", () => {
      const id = v2Order("order_confirmed");
      const listed = nextCodes(id);
      assert.deepEqual(listed, ["cancelled", "live_tracking", "on_hold"]);
      const all = lines(read("select string_agg(code, E'\\n') from public.order_statuses")).join("");
      for (const code of read("select string_agg(code, ',') from public.order_statuses").split(",")) {
        const result = tryMove(id, code);
        assert.equal(result === "OK", listed.includes(code), `${code}: ${result}`);
      }
      assert.ok(all.length > 0);
    });

    it("the graph is complete: from Order received both branches reach Delivered, and no stage is a dead end except the two terminal ones", () => {
      const edges = lines(db.ok("select from_code || '>' || to_code || '>' || branch from private.order_workflow_transitions where workflow_version = 2;")).map((l) => l.split(">"));
      const reach = (type) => {
        const seen = new Set(["pending_confirmation"]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const [from, to, branch] of edges) if (seen.has(from) && !seen.has(to) && (branch === "any" || branch === type) && !["on_hold", "cancelled"].includes(to)) { seen.add(to); grew = true; }
        }
        return seen;
      };
      for (const type of ["custom_pc_build", "parts_only"]) {
        const reached = reach(type);
        assert.ok(reached.has("delivered"), `${type} reaches delivered`);
        for (const stage of V2_COMMON) assert.ok(reached.has(stage), `${type} passes ${stage}`);
      }
      assert.ok(reach("custom_pc_build").has("building") && !reach("custom_pc_build").has("items_arrived"));
      assert.ok(reach("parts_only").has("awaiting_scheduling") && !reach("parts_only").has("quality_check"));
    });
  });

  // =================================================================================================================
  describe("C. payment and deposit rules", () => {
    it("the deposit tiers are preserved on workflow 2: up to QAR 3,000 -> 15%, up to 5,000 -> 25%, above -> 35% (to the nearest minor unit)", () => {
      for (const total of [100000n, 300000n, 300001n, 500000n, 500001n, 750000n]) {
        const id = make(Number(total));
        move(id, "awaiting_deposit");
        assert.equal(read(`select deposit_required_minor from public.orders where id = '${id}'`), String(deposit(total)), `total ${total}`);
      }
    });

    it("Deposit confirmed needs the whole recorded deposit: one minor unit short is refused, the exact deposit is accepted", () => {
      const id = make(200000);
      move(id, "awaiting_deposit");
      const need = Number(deposit(200000n));
      refused(tryMove(id, "deposit_received"), /the deposit has not been fully paid \(0 of 30000/, "nothing paid");
      pay(id, need - 1);
      refused(tryMove(id, "deposit_received"), /the deposit has not been fully paid \(29999 of 30000/, "one short");
      pay(id, 1);
      move(id, "deposit_received");
      assert.equal(status(id), "deposit_received");
    });

    it("the dropdown says why a move is not available yet, and the same words come back from the database", () => {
      const id = make(200000);
      move(id, "awaiting_deposit");
      const blocked = nexts(id).find((n) => n.code === "deposit_received");
      assert.match(blocked.blocked_reason, /the deposit has not been fully paid \(0 of 30000/);
      assert.equal(nexts(id).find((n) => n.code === "cancelled").blocked_reason, null);
      refused(tryMove(id, "deposit_received"), new RegExp(blocked.blocked_reason.replace(/[()]/g, ".")), "same words");
      pay(id, 30000);
      assert.equal(nexts(id).find((n) => n.code === "deposit_received").blocked_reason, null);
    });

    it("the status is never a way around the payment: no direct status write, a customer cannot move an order, staff cannot record money", () => {
      const id = make(200000);
      move(id, "awaiting_deposit");
      refused(attempt(AS.sam, `update public.orders set status = 'deposit_received' where id = '${id}'`), /permission denied/, "direct update by staff");
      refused(attempt(AS.superuser, `update public.orders set status = 'deposit_received' where id = '${id}'`), /only be changed through the staff functions/, "direct update outside the functions");
      refused(attempt(AS.sam, `select admin.record_payment('${id}', 'deposit', 30000, 'cash')`), /permission denied: payments\.record/, "staff cannot record a payment");
      refused(tryMove(id, "deposit_received", AS.alice), /permission denied: orders\.transition/, "customer");
      assert.equal(status(id), "awaiting_deposit");
    });

    it("a deposit policy gate set LATER than Deposit confirmed cannot be used to confirm the deposit unpaid on workflow 2 (the same gate does let workflow 1 through)", () => {
      act(AS.superuser, `update private.business_policies set value = jsonb_set(value, '{required_before_status}', '"building"'), version = version + 1 where key = 'orders.deposit';`);
      try {
        const v2 = make(200000);
        move(v2, "awaiting_deposit");
        assert.equal(read(`select deposit_gate_status from public.orders where id = '${v2}'`), "building");
        refused(tryMove(v2, "deposit_received"), /the deposit has not been fully paid/, "workflow 2 is held to the deposit from Deposit confirmed onward");
        setSwitch(1);
        const v1 = make(200000);
        move(v1, "awaiting_deposit");
        assert.equal(tryMove(v1, "deposit_received"), "OK", "workflow 1 keeps its policy-defined gate");
      } finally {
        setSwitch(2);
        act(AS.superuser, `update private.business_policies set value = jsonb_set(value, '{required_before_status}', '"deposit_received"'), version = version + 1 where key = 'orders.deposit';`);
      }
    });

    it("a payment reversed below the deposit stops the order advancing (and resuming) until the deposit is whole again", () => {
      const id = make(200000);
      move(id, "awaiting_deposit");
      pay(id, 30000);
      move(id, "deposit_received");
      move(id, "order_confirmed");
      const payment = read(`select id from public.payments where order_id = '${id}' and entry_type = 'payment'`);
      act(AS.olivia, `select admin.reverse_payment('${payment}', 'test reversal');`);
      refused(tryMove(id, "live_tracking"), /the deposit has not been fully paid/, "advance");
      move(id, "on_hold");
      refused(tryMove(id, "order_confirmed"), /the deposit has not been fully paid/, "resume");
      pay(id, 30000);
      move(id, "order_confirmed");
      assert.equal(status(id), "order_confirmed");
    });

    it("Order confirmed is a separate acknowledgment: it needs Deposit confirmed first and is a staff step (no payment is recorded by it)", () => {
      const id = make(200000);
      move(id, "awaiting_deposit");
      refused(tryMove(id, "order_confirmed"), /an order cannot move from awaiting_deposit to order_confirmed/, "skip");
      pay(id, 30000);
      move(id, "deposit_received");
      const paymentsBefore = count(`select count(*) from public.payments where order_id = '${id}'`);
      move(id, "order_confirmed");
      assert.equal(count(`select count(*) from public.payments where order_id = '${id}'`), paymentsBefore);
    });
  });

  // =================================================================================================================
  describe("D. fulfilment type and the two branches", () => {
    it("no order is assumed to be either kind: the type is empty until staff choose, for every new order", () => {
      const id = make();
      assert.equal(read(`select coalesce(fulfillment_type, 'unset') from public.orders where id = '${id}'`), "unset");
      // even an order made of components only, or with a build service, stays unset
      const parts = lines(db.commit(`${newOrder({ customer: CUST, items: [{ kind: "component", description: "Graphics card", quantity: 1, unit_price_minor: 50000 }], into: "p", who: AS.sam })}select :'p';`)).pop().trim();
      const build = lines(db.commit(`${newOrder({ customer: CUST, items: [{ kind: "build_service", description: "Custom gaming PC build", quantity: 1, unit_price_minor: 50000 }], into: "b", who: AS.sam })}select :'b';`)).pop().trim();
      for (const o of [parts, build]) assert.equal(read(`select coalesce(fulfillment_type, 'unset') from public.orders where id = '${o}'`), "unset");
    });

    it("an order cannot leave 'Carrier delivering order to M1' until the type is chosen, and the dropdown shows both branches blocked with the reason", () => {
      const id = v2Order("carrier_delivering");
      for (const to of ["building", "items_arrived"]) refused(tryMove(id, to), /choose Custom PC build or Parts only/, to);
      const listed = nexts(id);
      assert.deepEqual(listed.map((n) => n.code).sort(), ["building", "cancelled", "items_arrived", "on_hold"]);
      for (const code of ["building", "items_arrived"]) assert.match(listed.find((n) => n.code === code).blocked_reason, /choose Custom PC build or Parts only/);
      assert.equal(status(id), "carrier_delivering");
    });

    it("custom PC build: building -> final quality checks -> ready, and the parts-only stages are refused (and the reverse)", () => {
      const id = v2Order("carrier_delivering", { type: "custom_pc_build" });
      assert.deepEqual(nextCodes(id), ["building", "cancelled", "on_hold"]);
      refused(tryMove(id, "items_arrived"), /an order cannot move from carrier_delivering to items_arrived/, "parts stage");
      move(id, "building");
      assert.deepEqual(nextCodes(id), ["cancelled", "on_hold", "quality_check"]);
      move(id, "quality_check");
      assert.deepEqual(nextCodes(id), ["building", "cancelled", "on_hold", "ready_for_delivery"], "a failed check can go back to building (rework)");
      refused(tryMove(id, "awaiting_scheduling"), /an order cannot move from quality_check/, "parts stage");
      move(id, "ready_for_delivery");
      assert.equal(status(id), "ready_for_delivery");
    });

    it("parts only: items arrived -> awaiting scheduling -> ready, and the build stages are refused", () => {
      const id = v2Order("carrier_delivering", { type: "parts_only" });
      assert.deepEqual(nextCodes(id), ["cancelled", "items_arrived", "on_hold"]);
      refused(tryMove(id, "building"), /an order cannot move from carrier_delivering to building/, "build stage");
      move(id, "items_arrived");
      refused(tryMove(id, "quality_check"), /an order cannot move from items_arrived/, "build stage");
      refused(tryMove(id, "ready_for_delivery"), /an order cannot move from items_arrived to ready_for_delivery/, "skip scheduling");
      move(id, "awaiting_scheduling");
      move(id, "ready_for_delivery");
      assert.equal(status(id), "ready_for_delivery");
      assert.deepEqual(get(id).stages.map((s) => s.code).slice(-4), ["items_arrived", "awaiting_scheduling", "ready_for_delivery", "delivered"]);
    });

    it("the type is a staff choice that is audited, can be corrected before the branch, and cannot change once the order is inside it", () => {
      const id = v2Order("carrier_delivering");
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'parts_only', 'first choice');`);
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'custom_pc_build', 'corrected');`);
      assert.equal(read(`select fulfillment_type from public.orders where id = '${id}'`), "custom_pc_build");
      assert.equal(count(`select count(*) from private.audit_log where action = 'order.fulfillment_set' and entity_id = '${id}'`), 2);
      move(id, "building");
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'parts_only')`), /cannot change once the order has entered its branch/, "inside the branch");
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set fulfillment_type = 'parts_only' where id = '${id}'`), /cannot change once the order has entered its branch/, "trigger");
      move(id, "on_hold");
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'parts_only')`), /cannot change once the order has entered its branch/, "held inside the branch");
      assert.equal(attempt(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'custom_pc_build')`), "OK", "choosing the same value again is a no-op");
    });

    it("the type is validated, needs permission, is refused on earlier-workflow, cancelled orders, and the database refuses a branch status without the matching type", () => {
      const id = make();
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'both')`), /must be custom_pc_build or parts_only/, "bad value");
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${id}', null)`), /must be custom_pc_build or parts_only/, "null");
      refused(attempt(AS.alice, `select admin.set_order_fulfillment_type('${id}', 'parts_only')`), /permission denied: orders\.transition/, "customer");
      refused(attempt(AS.dana, `select admin.set_order_fulfillment_type('${id}', 'parts_only')`), /permission denied/, "deactivated staff");
      refused(attempt(AS.oliviaAal1, `select admin.set_order_fulfillment_type('${id}', 'parts_only')`), /permission denied/, "no second factor");
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${legacy.sourcing}', 'parts_only')`), /on the earlier workflow/, "earlier workflow");
      const gone = make();
      move(gone, "cancelled");
      refused(attempt(AS.sam, `select admin.set_order_fulfillment_type('${gone}', 'parts_only')`), /cancelled order cannot be changed/, "cancelled");
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set status = 'building' where id = '${id}'`), /orders_branch_consistent|check constraint/, "branch status without a type");
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set status = 'building', fulfillment_type = 'parts_only' where id = '${id}'`), /orders_branch_consistent|check constraint/, "wrong type for the stage");
    });
  });

  // =================================================================================================================
  describe("E. hold, resume and cancel", () => {
    it("an order can be held from the deposit stage to ready, and a held order offers only its own resume point and Cancel", () => {
      for (const [stop, type] of [["awaiting_deposit", null], ["order_confirmed", null], ["live_tracking", null], ["carrier_delivering", "parts_only"], ["building", "custom_pc_build"], ["items_arrived", "parts_only"], ["awaiting_scheduling", "parts_only"], ["ready_for_delivery", "custom_pc_build"]]) {
        const id = v2Order(stop, { type });
        assert.equal(status(id), stop, stop);
        move(id, "on_hold");
        assert.deepEqual(nextCodes(id), ["cancelled", stop].sort(), `held from ${stop}`);
        assert.equal(get(id).held_from, stop);
        move(id, stop);
        assert.equal(status(id), stop);
      }
    });

    it("a held order cannot resume anywhere but where it was held, and the refusal says where", () => {
      const id = v2Order("live_tracking");
      move(id, "on_hold");
      for (const to of ["order_confirmed", "arrived_in_qatar", "carrier_delivering", "deposit_received"]) refused(tryMove(id, to), /a held order can only resume at live_tracking \(or be cancelled\)/, to);
      move(id, "live_tracking");
    });

    it("hold is not offered before the deposit stage or after delivery; cancel is offered until delivery", () => {
      const fresh = make();
      assert.deepEqual(nextCodes(fresh), ["awaiting_deposit", "cancelled"]);
      refused(tryMove(fresh, "on_hold"), /an order cannot move from pending_confirmation to on_hold/, "hold before deposit stage");
      const ready = v2Order("ready_for_delivery", { type: "parts_only" });
      assert.ok(nextCodes(ready).includes("cancelled") && nextCodes(ready).includes("on_hold") && nextCodes(ready).includes("delivered"));
    });

    it("cancelling is final and keeps everything: payments, history and tracking stay; no further payment or tracking is accepted", () => {
      const id = v2Order("live_tracking", { total: 100000 });
      publish(id, "Left the warehouse");
      move(id, "cancelled");
      assert.equal(status(id), "cancelled");
      assert.equal(count(`select count(*) from public.payments where order_id = '${id}'`), 1);
      assert.equal(events(id), "Left the warehouse");
      refused(attempt(AS.olivia, `select admin.record_payment('${id}', 'balance', 100, 'cash')`), /cancelled order cannot receive a payment/, "payment");
      refused(tryPublish(id, "After cancel"), /cancelled order cannot receive tracking updates/, "tracking");
      assert.equal(get(id).tracking_phase, "cancelled");
    });

    it("a held order cannot take a new shipping update either: it waits until the order is back in Live tracking", () => {
      const id = v2Order("live_tracking");
      move(id, "on_hold");
      refused(tryPublish(id, "While held"), /on hold; tracking updates can be published again when it returns to Live tracking/, "held");
      assert.equal(get(id).tracking_phase, "paused");
      move(id, "live_tracking");
      publish(id, "Back on its way");
      assert.equal(events(id), "Back on its way");
    });
  });

  // =================================================================================================================
  describe("B. Live tracking: one status with nested updates", () => {
    it("the status starts no updates by itself: reaching Live tracking creates no tracking entry and no location", () => {
      const id = v2Order("live_tracking");
      assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${id}'`), 0);
      assert.deepEqual(get(id).tracking, []);
    });

    it("no shipping update is accepted before Live tracking starts (either function), at any earlier stage", () => {
      for (const stop of ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed"]) {
        const id = v2Order(stop);
        assert.equal(get(id).tracking_phase, "not_started", stop);
        refused(tryPublish(id, "Too early"), /Live tracking, and it has not started yet/, stop);
        refused(attempt(AS.sam, `select admin.publish_tracking_event('${id}', 'Too early', null, null)`), /has not started yet/, `${stop} (the earlier function)`);
        assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${id}'`), 0);
      }
    });

    it("in Live tracking staff publish updates with a location and a time; the author is recorded, the audit entry written, and the stage is Live tracking", () => {
      const id = v2Order("live_tracking");
      publish(id, "Packed", { loc: "Miami, USA", at: "2026-11-20T08:00:00Z", msg: "Packed and sealed" });
      publish(id, "Departed", { loc: "Miami airport", at: "2026-11-21T09:30:00Z" });
      assert.equal(get(id).tracking_phase, "live");
      const t = get(id).tracking;
      assert.deepEqual(t.map((e) => [e.title, e.location, e.event_kind, e.status_code, e.by]), [["Packed", "Miami, USA", "update", "live_tracking", "Staff (test)"], ["Departed", "Miami airport", "update", "live_tracking", "Staff (test)"]]);
      assert.equal(t[0].message, "Packed and sealed");
      assert.equal(count(`select count(*) from private.tracking_event_authors a join public.order_tracking_events e on e.id = a.event_id where e.order_id = '${id}' and a.user_id = '${ID.sam}'`), 2);
      assert.equal(count(`select count(*) from private.audit_log where action = 'tracking.published' and entity_id = '${id}'`), 2);
    });

    it("updates are ordered by when the event happened (then when it was published), whatever order staff entered them in", () => {
      const id = v2Order("live_tracking");
      publish(id, "Third", { at: "2026-11-22T10:00:00Z" });
      publish(id, "First", { at: "2026-11-20T10:00:00Z" });
      publish(id, "Second", { at: "2026-11-21T10:00:00Z" });
      publish(id, "No time given");
      assert.deepEqual(get(id).tracking.map((e) => e.title), ["First", "Second", "Third", "No time given"]);
      assert.equal(events(id), "First|Second|Third|No time given");
    });

    it("the inputs are validated: a title is required, the location is at most 120 characters, a time in the future is refused", () => {
      const id = v2Order("live_tracking");
      refused(tryPublish(id, ""), /title_check|check constraint/, "empty title");
      refused(attempt(AS.sam, `select admin.publish_tracking_update('${id}', 'x', null, '${"L".repeat(121)}', null)`), /location_check|check constraint/, "long location");
      refused(attempt(AS.sam, `select admin.publish_tracking_update('${id}', 'x', null, null, now() + interval '3 days')`), /cannot be in the future/, "future");
      assert.equal(attempt(AS.sam, `select admin.publish_tracking_update('${id}', 'x', null, '   ', null)`), "OK", "a blank location is stored as none");
      assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${id}'`), 0, "the probes above rolled back");
    });

    it("moving past Live tracking keeps every update visible, and the same list still reads in order", () => {
      const id = v2Order("live_tracking");
      publish(id, "One", { at: "2026-11-20T10:00:00Z" });
      publish(id, "Two", { at: "2026-11-21T10:00:00Z" });
      move(id, "arrived_in_qatar");
      move(id, "carrier_delivering");
      assert.equal(get(id).tracking_phase, "ended");
      assert.deepEqual(get(id).tracking.map((e) => e.title), ["One", "Two"]);
      // the customer's own session still reads them (customer RLS: owner only)
    });

    it("after Live tracking has ended a normal update is refused with the reason, in both functions", () => {
      const id = v2Order("arrived_in_qatar");
      refused(tryPublish(id, "Late"), /Live tracking has ended for this order; adding to its tracking history needs a correction by the owner/, "ended");
      refused(attempt(AS.sam, `select admin.publish_tracking_event('${id}', 'Late', null, null)`), /Live tracking has ended/, "the earlier function");
      refused(tryPublish(id, "Late", AS.olivia), /Live tracking has ended/, "even the owner: a normal update is not the correction process");
    });

    it("a correction after Live tracking is owner-only, needs a reason, is marked as a correction, may point at the update it corrects, and keeps the original", () => {
      const id = v2Order("live_tracking");
      publish(id, "Wrong city", { loc: "Dallas", at: "2026-11-20T10:00:00Z" });
      move(id, "arrived_in_qatar");
      const wrong = get(id).tracking[0].id;
      const correct = (who, reason = "wrong city typed", corrects = wrong) =>
        attempt(who, `select admin.publish_tracking_correction('${id}', 'Corrected location', 'It was Houston', 'Houston', null, ${reason === null ? "null" : `'${reason}'`}, ${corrects ? `'${corrects}'` : "null"})`);
      refused(correct(AS.sam), /permission denied: tracking\.correct/, "staff cannot");
      refused(correct(AS.alice), /permission denied: tracking\.correct/, "a customer cannot");
      refused(correct(AS.oliviaAal1), /permission denied/, "no second factor");
      refused(correct(AS.olivia, null), /a reason is required/, "no reason");
      refused(correct(AS.olivia, "ab"), /a reason is required/, "short reason");
      refused(attempt(AS.olivia, `select admin.publish_tracking_correction('${id}', 'x', null, null, null, 'because', '${get(id).id}')`), /does not belong to this order|invalid input syntax|violates foreign key/, "something that is not an update of this order");
      const other = v2Order("live_tracking");
      publish(other, "Another order update");
      const foreign = get(other).tracking[0].id;
      refused(correct(AS.olivia, "wrong city typed", foreign), /does not belong to this order/, "another order's update");
      act(AS.olivia, `select admin.publish_tracking_correction('${id}', 'Corrected location', 'It was Houston', 'Houston', null, 'wrong city typed', '${wrong}');`);
      const t = get(id).tracking;
      assert.deepEqual(t.map((e) => [e.title, e.event_kind]), [["Wrong city", "update"], ["Corrected location", "correction"]]);
      assert.equal(t[1].corrects_event_id, wrong);
      assert.equal(t[1].correction_reason, "wrong city typed");
      assert.equal(t[1].by, "Owner (test)");
      assert.equal(t[0].location, "Dallas", "the original is untouched");
      assert.equal(count(`select count(*) from private.audit_log where action = 'tracking.corrected' and entity_id = '${id}'`), 1);
    });

    it("a correction is refused while Live tracking is open, before it starts, on a cancelled order, and on an order of the earlier workflow", () => {
      const live = v2Order("live_tracking");
      const early = v2Order("order_confirmed");
      const gone = v2Order("live_tracking");
      move(gone, "cancelled");
      const c = (id) => attempt(AS.olivia, `select admin.publish_tracking_correction('${id}', 'x', null, null, null, 'because', null)`);
      refused(c(live), /Live tracking is open for this order; publish a normal tracking update/, "open");
      refused(c(early), /only be added after Live tracking has started/, "before");
      refused(c(gone), /only be added after Live tracking has started/, "cancelled");
      refused(c(legacy.transit), /on the earlier workflow/, "earlier workflow");
    });

    it("a correction can be added while the order is held from Live tracking, and after delivery", () => {
      const held = v2Order("live_tracking");
      publish(held, "Original");
      move(held, "on_hold");
      act(AS.olivia, `select admin.publish_tracking_correction('${held}', 'Held correction', null, null, null, 'fixing a typo', null);`);
      const done = v2Order("delivered", { type: "custom_pc_build", full: true });
      act(AS.olivia, `select admin.publish_tracking_correction('${done}', 'After delivery', null, 'Doha', null, 'owner note for the record', null);`);
      assert.equal(get(held).tracking.length, 2);
      assert.equal(get(done).tracking[0].event_kind, "correction");
    });

    it("withdrawing an update still works in every phase, keeps it in the staff history with who and why, and hides it from the customer", () => {
      const id = v2Order("live_tracking");
      publish(id, "Posted by mistake");
      move(id, "arrived_in_qatar");
      const eventId = get(id).tracking[0].id;
      refused(attempt(AS.alice, `select admin.retract_tracking_event('${eventId}', 'because')`), /permission denied: tracking\.publish/, "customer");
      act(AS.sam, `select admin.retract_tracking_event('${eventId}', 'posted on the wrong order');`);
      const t = get(id).tracking[0];
      assert.equal(t.retracted, true);
      assert.equal(t.retraction_reason, "posted on the wrong order");
      assert.equal(count(`select count(*) from public.order_tracking_events where id = '${eventId}'`), 1, "the row is never deleted");
    });

    it("the tracking history is append-only: no update or delete of an update, a retraction or a correction, by anyone", () => {
      const id = v2Order("live_tracking");
      publish(id, "Immutable", { loc: "X" });
      move(id, "arrived_in_qatar");
      act(AS.olivia, `select admin.publish_tracking_correction('${id}', 'Fix', null, null, null, 'a reason', null);`);
      const first = get(id).tracking[0].id;
      const fix = get(id).tracking[1].id;
      for (const sql of [
        `update public.order_tracking_events set title = 'changed' where id = '${first}'`, `update public.order_tracking_events set location = 'changed' where id = '${first}'`,
        `delete from public.order_tracking_events where id = '${first}'`, `update private.tracking_event_corrections set reason = 'changed' where event_id = '${fix}'`,
        `delete from private.tracking_event_corrections where event_id = '${fix}'`, `truncate private.tracking_event_corrections`,
      ]) refused(attempt(AS.superuser, `select private.set_write_ctx(true); ${sql}`), /append-only|cannot be (updated|deleted|truncated)|not allowed|forbidden|read-only/i, sql);
    });

    it("tracking_phase tells the staff page where Live tracking is at every stage", () => {
      const phase = (stop, type) => get(v2Order(stop, { type })).tracking_phase;
      assert.deepEqual(["awaiting_deposit", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"].map((s) => phase(s)), ["not_started", "not_started", "live", "ended", "ended"]);
      assert.equal(get(legacy.transit).tracking_phase, null, "an earlier-workflow order has no phase");
    });

    it("a version 1 order keeps publishing exactly as before (no phase rule): the earlier function still works, and the new one adds a location", () => {
      const id = legacy.sourcing;
      act(AS.sam, `select admin.publish_tracking_event('${id}', 'Old way', 'still works', 'sourcing');`);
      act(AS.sam, `select admin.publish_tracking_update('${id}', 'New way', null, 'Somewhere', null);`);
      assert.deepEqual(get(id).tracking.map((e) => e.title), ["Old way", "New way"]);
      assert.equal(get(id).tracking[0].status_code, "sourcing");
      assert.equal(get(id).tracking[1].status_code, null);
    });
  });

  // =================================================================================================================
  describe("customer visibility (row level security)", () => {
    let mine;
    before(() => {
      mine = lines(db.commit(`${newOrder({ customer: ID.custA, items: one(200000), into: "m", who: AS.sam })}select :'m';`)).pop().trim();
      move(mine, "awaiting_deposit");
      pay(mine, 30000);
      for (const s of ["deposit_received", "order_confirmed", "live_tracking"]) move(mine, s);
      publish(mine, "Visible update", { loc: "Atlanta, USA", at: "2026-11-21T10:00:00Z" });
      publish(mine, "Withdrawn update");
      act(AS.sam, `select admin.retract_tracking_event((select id from public.order_tracking_events where order_id = '${mine}' and title = 'Withdrawn update'), 'wrong order');`);
      move(mine, "arrived_in_qatar");
      act(AS.olivia, `select admin.publish_tracking_correction('${mine}', 'Visible correction', null, 'Atlanta, USA', null, 'private owner reason', null);`);
    });

    it("the owner of the order sees their updates after Live tracking ended, with the location, the time and the correction mark, but not a withdrawn one", () => {
      assert.equal(read(`select string_agg(title || '/' || coalesce(location, '-') || '/' || event_kind, ',' order by published_at) from public.order_tracking_events where order_id = '${mine}'`, AS.alice),
        "Visible update/Atlanta, USA/update,Visible correction/Atlanta, USA/correction");
      assert.equal(rowsSeen(AS.alice, `select count(*) from public.order_tracking_events where order_id = '${mine}'`), "2");
    });

    it("another customer, an anonymous visitor and a signed-in stranger see none of it", () => {
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.order_tracking_events where order_id = '${mine}'`), "0");
      assert.equal(rowsSeen(AS.eve, `select count(*) from public.order_tracking_events where order_id = '${mine}'`), "0");
      assert.equal(rowsSeen(AS.anon, `select count(*) from public.order_tracking_events`), "DENIED");
    });

    it("the customer sees the workflow and the type of their own order only, and the stage list needs a signed-in session", () => {
      assert.equal(read(`select workflow_version || ':' || coalesce(fulfillment_type, 'none') from public.orders where id = '${mine}'`, AS.alice), "2:none");
      assert.equal(rowsSeen(AS.bob, `select count(*) from public.orders where id = '${mine}'`), "0");
      assert.equal(rowsSeen(AS.alice, "select count(*) from public.order_workflow_stages"), "22");
      assert.equal(rowsSeen(AS.anon, "select count(*) from public.order_workflow_stages"), "DENIED");
    });

    it("what is staff-only stays staff-only: reasons, authors, the transition rules, the adoption map, the retraction and correction records", () => {
      for (const table of ["private.tracking_event_corrections", "private.tracking_event_retractions", "private.tracking_event_authors", "private.order_workflow_transitions", "private.workflow_adoption_map", "private.order_status_history"]) {
        assert.equal(rowsSeen(AS.alice, `select count(*) from ${table}`), "DENIED", table);
        assert.equal(rowsSeen(AS.anon, `select count(*) from ${table}`), "DENIED", table);
      }
    });

    it("a customer cannot write anything of the workflow, and cannot call any staff function of it", () => {
      for (const sql of [
        `update public.order_workflow_stages set position = 99`, `insert into public.order_workflow_stages values (2, 'any', 99, 'delivered', false)`,
        `update public.orders set fulfillment_type = 'parts_only' where id = '${mine}'`, `update public.orders set workflow_version = 1 where id = '${mine}'`,
        `insert into public.order_tracking_events (order_id, title) values ('${mine}', 'forged')`,
      ]) refused(attempt(AS.alice, sql), /permission denied/, sql);
      for (const sql of [
        `select admin.publish_tracking_update('${mine}', 'x', null, null, null)`, `select admin.publish_tracking_correction('${mine}', 'x', null, null, null, 'because', null)`,
        `select admin.set_order_fulfillment_type('${mine}', 'parts_only')`, `select admin.adopt_new_workflow('${legacy.sourcing}', 'because')`,
      ]) refused(attempt(AS.alice, sql), /permission denied/, sql);
      refused(attempt(AS.forgedAdmin, `select admin.adopt_new_workflow('${legacy.sourcing}', 'because')`), /permission denied/, "forged claims");
    });
  });

  // =================================================================================================================
  describe("F. existing orders: compatibility and the deliberate move onto the new workflow", () => {
    it("every legacy order keeps working exactly as before on workflow 1, and cannot enter a version-2 stage by a normal move", () => {
      assert.deepEqual(nextCodes(legacy.sourcing), ["building", "cancelled", "in_transit", "on_hold"]);
      refused(tryMove(legacy.sourcing, "live_tracking"), /an order cannot move from sourcing to live_tracking/, "v2 stage");
      refused(tryMove(legacy.transit, "arrived_in_qatar"), /an order cannot move from in_transit to arrived_in_qatar/, "v2 stage");
      assert.equal(tryMove(legacy.sourcing, "in_transit"), "OK");
      assert.deepEqual(nextCodes(legacy.held), ["building", "cancelled"], "a held legacy order offers only its resume point and Cancel");
      assert.equal(get(legacy.transit).workflow_version, 1);
      assert.deepEqual(get(legacy.transit).stages.map((s) => s.code), ["pending_confirmation", "awaiting_deposit", "deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"]);
    });

    it("moving an order onto the new workflow is owner-only, needs a reason, and nothing else can do it", () => {
      const sql = (id, extra = "") => `select admin.adopt_new_workflow('${id}', ${extra || "'moved by the owner'"})`;
      refused(attempt(AS.sam, sql(legacy.sourcing)), /permission denied: orders\.adopt/, "staff");
      refused(attempt(AS.alice, sql(legacy.sourcing)), /permission denied: orders\.adopt/, "customer");
      refused(attempt(AS.oliviaAal1, sql(legacy.sourcing)), /permission denied/, "no second factor");
      refused(attempt(AS.dana, sql(legacy.sourcing)), /permission denied/, "deactivated");
      refused(attempt(AS.olivia, sql(legacy.sourcing, "''")), /a reason is required/, "no reason");
      refused(attempt(AS.olivia, sql(legacy.sourcing, "'a valid reason', 'live_tracking'")), /an order in sourcing can be moved to: order_confirmed/, "target not in the map");
      refused(attempt(AS.olivia, `select admin.adopt_new_workflow('${legacy.sourcing}', 'reason', null, 'both')`), /must be custom_pc_build or parts_only/, "bad type");
    });

    it("the placement map is exactly the documented one (defaults and choices), and has no row for a held or cancelled order", () => {
      assert.equal(read("select string_agg(legacy_status || '>' || target_status || ':' || is_default || ':' || coalesce(requires_fulfillment, '-'), ', ' order by legacy_status, target_status) from private.workflow_adoption_map"),
        "awaiting_deposit>awaiting_deposit:true:-, building>building:true:custom_pc_build, building>items_arrived:false:parts_only, delivered>delivered:true:-, deposit_received>deposit_received:true:-, in_transit>arrived_in_qatar:false:-, in_transit>carrier_delivering:false:-, in_transit>live_tracking:true:-, pending_confirmation>pending_confirmation:true:-, quality_check>quality_check:true:custom_pc_build, ready_for_delivery>ready_for_delivery:true:-, sourcing>order_confirmed:true:-");
    });

    it("a held order and a cancelled order are not moved; a version-2 order cannot be moved again", () => {
      refused(attempt(AS.olivia, `select admin.adopt_new_workflow('${legacy.held}', 'because')`), /resume the order before moving it/, "held");
      refused(attempt(AS.olivia, `select admin.adopt_new_workflow('${legacy.cancelled}', 'because')`), /cancelled order stays as it is/, "cancelled");
      refused(attempt(AS.olivia, `select admin.adopt_new_workflow('${make()}', 'because')`), /already on the current workflow/, "version 2");
    });

    it("every legacy status has a placement: the default, the choices, and what it implies for the type", () => {
      const placed = (name, extra = "") => attempt(AS.olivia, `select admin.adopt_new_workflow('${legacy[name]}', 'reason'${extra})`);
      for (const name of ["pending", "awaiting", "deposit", "sourcing", "transit"]) assert.equal(placed(name), "OK", name);
      refused(placed("building"), /needs the fulfilment type custom_pc_build/, "building needs the type");
      refused(placed("building", ", null, 'parts_only'"), /needs the fulfilment type custom_pc_build/, "building is a build stage");
      assert.equal(placed("building", ", null, 'custom_pc_build'"), "OK");
      assert.equal(placed("building", ", 'items_arrived', 'parts_only'"), "OK", "a legacy parts order that was in 'building' is placed at items arrived");
      refused(placed("building", ", 'items_arrived', 'custom_pc_build'"), /needs the fulfilment type parts_only/, "mismatch");
      refused(placed("quality"), /needs the fulfilment type custom_pc_build/, "quality needs the type");
      assert.equal(placed("quality", ", null, 'custom_pc_build'"), "OK");
      assert.equal(placed("ready"), "OK");
      assert.equal(placed("delivered"), "OK");
      refused(placed("transit", ", 'delivered'"), /an order in in_transit can be moved to: live_tracking/, "no skipping");
    });

    it("an order whose deposit is not whole cannot be placed at or beyond Deposit confirmed", () => {
      act(AS.superuser, `update private.business_policies set value = jsonb_set(value, '{required_before_status}', '"building"'), version = version + 1 where key = 'orders.deposit';`);
      try {
        setSwitch(1);
        const id = make(200000);
        move(id, "awaiting_deposit");
        move(id, "deposit_received");
        move(id, "sourcing");
        setSwitch(2);
        refused(attempt(AS.olivia, `select admin.adopt_new_workflow('${id}', 'because')`), /the deposit has not been fully paid/, "unpaid");
        pay(id, 30000);
        assert.equal(attempt(AS.olivia, `select admin.adopt_new_workflow('${id}', 'because')`), "OK");
      } finally {
        setSwitch(2);
        act(AS.superuser, `update private.business_policies set value = jsonb_set(value, '{required_before_status}', '"deposit_received"'), version = version + 1 where key = 'orders.deposit';`);
      }
    });

    it("the synthetic order shape (in transit, two payments, four tracking updates): adoption places it in Live tracking and preserves EVERYTHING", () => {
      const id = legacy.transit;
      const snap = () => ({
        payments: read(`select string_agg(p.id || ':' || p.amount_minor || ':' || p.receipt_number || ':' || p.received_at, ',' order by p.id) from public.payments p where p.order_id = '${id}'`),
        events: read(`select string_agg(e.id || ':' || e.title || ':' || coalesce(e.message, '-') || ':' || e.published_at || ':' || coalesce(a.user_id::text, '-'), ',' order by e.id) from public.order_tracking_events e left join private.tracking_event_authors a on a.event_id = e.id where e.order_id = '${id}'`),
        history: read(`select string_agg(h.id || ':' || coalesce(h.from_status, '-') || '>' || h.to_status || ':' || h.changed_at, ',' order by h.id) from private.order_status_history h where h.order_id = '${id}'`),
        money: read(`select total_minor || ':' || deposit_required_minor || ':' || amount_paid_minor || ':' || deposit_fixed_at || ':' || order_ref from public.orders where id = '${id}'`),
        loyalty: count(`select count(*) from public.loyalty_ledger where order_id = '${id}'`),
        receipts: count("select count(distinct receipt_number) from public.payments"),
      });
      const before = snap();
      assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${id}'`), 4);
      assert.equal(count(`select count(*) from public.payments where order_id = '${id}'`), 2);
      const placed = lines(db.commit(`${AS.olivia}select admin.adopt_new_workflow('${id}', 'owner moved the synthetic order');`)).pop();
      assert.equal(placed, "live_tracking");
      const after = snap();
      assert.deepEqual({ ...after, history: null }, { ...before, history: null }, "payments, receipts, tracking updates (with authors and times), money and loyalty are untouched");
      assert.ok(after.history.startsWith(before.history), "the earlier history is intact, and one row was added after it");
      assert.equal(after.history.split(",").length, before.history.split(",").length + 1);
      assert.equal(read(`select from_status || '>' || to_status || ':' || reason from private.order_status_history where order_id = '${id}' order by id desc limit 1`), "in_transit>live_tracking:Moved to the current workflow: owner moved the synthetic order");
      assert.equal(count(`select count(*) from private.audit_log where action = 'order.workflow_adopted' and entity_id = '${id}'`), 1);
      const g = get(id);
      assert.deepEqual([g.workflow_version, g.status, g.tracking_phase, g.tracking.length], [2, "live_tracking", "live", 4]);
      assert.equal(count(`select count(*) from public.order_tracking_events where order_id = '${id}' and event_kind = 'update'`), 4);
    });

    it("the hosted synthetic order's EXACT figures (QAR 4,350.55; deposit 1,087.64; balance payment 3,262.91; two receipts; four updates) survive adoption, and loyalty is awarded once, later", () => {
      // The values below were read (read-only) from the hosted development database for order O-2611-00001 and are rebuilt here from scratch.
      setSwitch(1);
      const id = make(435055);
      setSwitch(2);
      move(id, "awaiting_deposit");
      assert.equal(read(`select deposit_required_minor || '|' || deposit_rate_bps || '|' || deposit_rule from public.orders where id = '${id}'`),
        "108764|2500|tier 2 of 5: 25.00% of the whole order total, to the nearest dirham (a half rounds up)");
      act(AS.olivia, `select admin.record_payment('${id}', 'deposit', 108764, 'fawran');`);
      for (const s of ["deposit_received", "sourcing", "in_transit"]) move(id, s);
      for (const [title, msg] of [["Synthetic update 1", "one"], ["Synthetic update 2", "two"], ["Synthetic update 3", "three"], ["Synthetic update 4", "four"]]) {
        act(AS.sam, `select admin.publish_tracking_event('${id}', '${title}', '${msg}', 'in_transit');`);
      }
      act(AS.olivia, `select admin.record_payment('${id}', 'balance', 326291, 'fawran');`);
      const figures = () => read(`select o.total_minor || '|' || o.deposit_required_minor || '|' || o.amount_paid_minor || '|' || o.balance_due_minor || '|' || coalesce(o.delivery_method, 'undecided') || '|'
        || (select string_agg(p.purpose || ':' || p.amount_minor || ':' || p.method, ',' order by p.amount_minor) from public.payments p where p.order_id = o.id) || '|'
        || (select count(distinct p.receipt_number) from public.payments p where p.order_id = o.id) || '|'
        || (select count(*) from public.order_tracking_events e where e.order_id = o.id) || '|'
        || (select count(*) from private.order_status_history h where h.order_id = o.id) || '|'
        || (select count(*) from public.loyalty_ledger l where l.order_id = o.id) from public.orders o where o.id = '${id}'`).split("|");
      const [total, deposit, paid, due, delivery, payments, receipts, updates, history, loyalty] = figures();
      assert.deepEqual([total, deposit, paid, due, delivery, payments, receipts, updates, history, loyalty],
        ["435055", "108764", "435055", "0", "undecided", "deposit:108764:fawran,balance:326291:fawran", "2", "4", "5", "0"]);
      const rows = () => read(`select (select string_agg(p.id || p.receipt_number || p.amount_minor || p.received_at, ',' order by p.id) from public.payments p where p.order_id = '${id}') || '#'
        || (select string_agg(e.id || e.title || e.message || e.published_at || coalesce(a.user_id::text, '-'), ',' order by e.id) from public.order_tracking_events e left join private.tracking_event_authors a on a.event_id = e.id where e.order_id = '${id}')`);
      const rowsBefore = rows();
      assert.equal(lines(db.commit(`${AS.olivia}select admin.adopt_new_workflow('${id}', 'rehearsal of the hosted synthetic order');`)).pop().trim(), "live_tracking");
      const after = figures();
      assert.deepEqual(after.slice(0, 8), ["435055", "108764", "435055", "0", "undecided", "deposit:108764:fawran,balance:326291:fawran", "2", "4"], "money, receipts and updates are unchanged");
      assert.deepEqual(after.slice(8), ["6", "0"], "the history gained exactly one row; adoption awarded nothing");
      assert.equal(rows(), rowsBefore, "every payment (with its receipt and date) and every update (with its author and time) is byte for byte the same");
      // it finishes on the new path; points are earned once, at delivery, on the whole total (QAR 4,350.55 -> 435 points)
      publish(id, "Landed", { loc: "Doha" });
      for (const s of ["arrived_in_qatar", "carrier_delivering"]) move(id, s);
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'custom_pc_build');`);
      for (const s of ["building", "quality_check", "ready_for_delivery"]) {
        move(id, s);
        assert.equal(count(`select count(*) from public.loyalty_ledger where order_id = '${id}'`), 0, s);
      }
      move(id, "delivered");
      assert.equal(read(`select string_agg(entry_type || ':' || points, ',') from public.loyalty_ledger where order_id = '${id}'`), "award:435");
      act(AS.olivia, `select admin.award_loyalty_for_order('${id}');`);
      assert.equal(count(`select count(*) from public.loyalty_ledger where order_id = '${id}'`), 1, "asking again never awards a second time");
      assert.equal(figures().slice(0, 5).join("|"), "435055|108764|435055|0|undecided");
    });

    it("the adopted order carries on: it accepts new updates (nested after the four), the customer sees all five, and it finishes on the new path", () => {
      const id = legacy.transit;
      publish(id, "Arrived at the hub", { loc: "Doha hub" });
      assert.equal(get(id).tracking.length, 5);
      move(id, "arrived_in_qatar");
      move(id, "carrier_delivering");
      refused(tryMove(id, "building"), /choose Custom PC build or Parts only/, "explicit choice still required");
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'parts_only');`);
      for (const s of ["items_arrived", "awaiting_scheduling", "ready_for_delivery", "delivered"]) move(id, s);
      assert.equal(status(id), "delivered");
    });

    it("a version-2 order cannot be placed back on workflow 1 by anyone", () => {
      refused(attempt(AS.superuser, `select private.set_write_ctx(true); update public.orders set workflow_version = 1 where id = '${legacy.transit}'`), /only move from version 1 to version 2/, "back");
    });
  });

  // =================================================================================================================
  describe("G. loyalty, payments, receipts and duplicates", () => {
    const points = (id) => read(`select coalesce(string_agg(entry_type || ':' || points, ',' order by created_at, id), '') from public.loyalty_ledger where order_id = '${id}'`);

    it("no points before the order is delivered, even fully paid at every earlier stage", () => {
      const id = make(250000);
      move(id, "awaiting_deposit");
      pay(id, 250000);
      for (const s of ["deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"]) { move(id, s); assert.equal(points(id), "", s); }
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'custom_pc_build');`);
      for (const s of ["building", "quality_check", "ready_for_delivery"]) { move(id, s); assert.equal(points(id), "", s); }
      move(id, "delivered");
      assert.equal(points(id), "award:250", "one point per QAR 10, awarded once when the order is delivered and fully paid");
    });

    it("delivered with a balance still due awards nothing; paying the balance afterwards awards exactly once", () => {
      const id = make(250000);
      move(id, "awaiting_deposit");
      pay(id, Number(deposit(250000n)));
      for (const s of ["deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"]) move(id, s);
      act(AS.sam, `select admin.set_order_fulfillment_type('${id}', 'parts_only');`);
      for (const s of ["items_arrived", "awaiting_scheduling", "ready_for_delivery", "delivered"]) move(id, s);
      assert.equal(points(id), "", "balance due: no award");
      pay(id, 250000 - Number(deposit(250000n)), "balance");
      assert.equal(points(id), "award:250");
      act(AS.olivia, `select admin.award_loyalty_for_order('${id}'); select admin.award_loyalty_for_order('${id}');`);
      assert.equal(points(id), "award:250", "asking again never awards a second time");
    });

    it("a hold or a resume around delivery never awards, and a cancelled order never does", () => {
      const id = v2Order("ready_for_delivery", { type: "parts_only", full: true });
      move(id, "on_hold");
      move(id, "ready_for_delivery");
      assert.equal(points(id), "");
      move(id, "delivered");
      assert.equal(points(id).split(",").length, 1);
      const gone = v2Order("live_tracking", { full: true });
      move(gone, "cancelled");
      assert.equal(points(gone), "");
    });

    it("moving the order through the new workflow records no payment and mints no receipt", () => {
      const id = make(100000);
      move(id, "awaiting_deposit");
      pay(id, 15000);
      const before = [count("select count(*) from public.payments"), count("select count(distinct receipt_number) from public.payments")];
      for (const s of ["deposit_received", "order_confirmed", "live_tracking"]) move(id, s);
      publish(id, "x");
      for (const s of ["arrived_in_qatar", "carrier_delivering"]) move(id, s);
      assert.deepEqual([count("select count(*) from public.payments"), count("select count(distinct receipt_number) from public.payments")], before);
    });

    it("a payment recorded twice with the same key is one payment with one receipt, on a workflow-2 order too", () => {
      const id = make(100000);
      move(id, "awaiting_deposit");
      const sql = `select admin.record_payment('${id}', 'deposit', 15000, 'cash', null, null, null, null, 'wf2-key-0001', 0);`;
      const first = lines(act(AS.olivia, sql)).pop();
      const again = lines(act(AS.olivia, sql)).pop();
      assert.equal(first.trim(), again.trim(), "the repeat returns the original payment");
      assert.equal(count(`select count(*) from public.payments where order_id = '${id}'`), 1);
      assert.equal(count(`select count(distinct receipt_number) from public.payments where order_id = '${id}'`), 1);
      assert.equal(read(`select amount_paid_minor from public.orders where id = '${id}'`), "15000");
    });

    it("the whole payment ledger still adds up to what the orders say, across both workflows", () => {
      assert.equal(count(`select count(*) from public.orders o where o.amount_paid_minor <> coalesce((select sum(p.amount_minor) from public.payments p where p.order_id = o.id), 0)`), 0);
    });
  });

  // =================================================================================================================
  describe("H. the overview, security audits, and the migrations themselves", () => {
    it("the dashboard counts the new stages and keeps every old key", () => {
      const s = JSON.parse(read("select admin.dashboard_summary()::text", AS.olivia));
      for (const key of ["total_orders", "awaiting_confirmation", "awaiting_deposit", "under_assembly", "ready_for_delivery", "delivered", "on_hold", "cancelled", "customers", "recent_orders", "outstanding_balance_minor"]) assert.ok(key in s, key);
      for (const key of ["order_confirmed", "live_tracking", "awaiting_scheduling"]) assert.equal(typeof s[key], "number", key);
    });

    it("the order list carries the workflow and the type, and filters by any of the new statuses", () => {
      const rows = JSON.parse(read("select admin.list_orders('live_tracking', null, 100, 0)::text", AS.sam));
      assert.ok(rows.length > 0 && rows.every((r) => r.status === "live_tracking" && r.workflow_version === 2 && "fulfillment_type" in r));
    });

    it("the database's own security audit and the gateway audit report nothing", () => {
      // (the two zz_ helpers are this test's own probes; every other finding would be real)
      assert.equal(read("select coalesce(string_agg(check_name || ' ' || detail, ', '), '') from private.security_audit() where detail not like 'public.zz\\_%'"), "");
      assert.equal(read("select coalesce(string_agg(check_name || ' ' || detail, ', '), '') from private.gateway_audit() where detail not like 'public.zz\\_%'"), "");
    });

    it("the gateway role may run the four new staff functions and nothing private", () => {
      for (const sig of ["admin.set_order_fulfillment_type(uuid, text, text)", "admin.publish_tracking_update(uuid, text, text, text, timestamptz)", "admin.publish_tracking_correction(uuid, text, text, text, timestamptz, text, uuid)", "admin.adopt_new_workflow(uuid, text, text, text)"]) {
        assert.equal(read(`select has_function_privilege('m1_staff_gateway', '${sig}', 'execute')`), "t", sig);
        assert.equal(read(`select has_function_privilege('anon', '${sig}', 'execute') or has_function_privilege('public', '${sig}', 'execute')`), "f", sig);
      }
    });

    it("only the owner holds the two new permissions", () => {
      assert.equal(read("select string_agg(role_code || ':' || permission_code, ',' order by role_code, permission_code) from private.role_permissions where permission_code in ('tracking.correct', 'orders.adopt')"), "owner:orders.adopt,owner:tracking.correct");
      assert.equal(read("select count(*) from private.role_permissions where role_code = 'staff'"), "10");
    });

    it("the migrations are RERUNNABLE: applying both again changes no definition, no row count and no privilege", () => {
      // On the database as this release left it: the pricing migrations (PLAT-0005) replace some of the same functions later, so re-applying
      // the workflow pair on top of THEM would (rightly) put the older definitions back. Their own rerun test is in pricing.db.test.mjs.
      const own = startDatabase({ schedule: "confirmed", before: "20261123120000_pricing_rewards_schema.sql" });
      try {
        const oread = (sql) => lines(own.ok(/;\s*$/.test(sql) ? sql : `${sql};`)).pop() ?? "";
        const snapshot = () => oread(`select md5(string_agg(x, '|' order by x)) from (
          select pg_get_functiondef(p.oid) as x from pg_proc p where p.pronamespace in ('admin'::regnamespace, 'private'::regnamespace)
          union all select 'status:' || code || ':' || customer_label || ':' || is_provisional from public.order_statuses
          union all select 'stage:' || workflow_version || branch || position || status_code from public.order_workflow_stages
          union all select 'move:' || workflow_version || from_code || to_code || branch from private.order_workflow_transitions
          union all select 'adopt:' || legacy_status || target_status from private.workflow_adoption_map
          union all select 'perm:' || role_code || permission_code from private.role_permissions
          union all select 'acl:' || p.oid::regprocedure::text || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'admin'::regnamespace) s`);
        const before = snapshot();
        const policyVersion = oread("select version from private.business_policies where key = 'orders.workflow'");
        for (const file of ["20261122120000_order_workflow_v2_schema.sql", "20261122120100_order_workflow_v2_functions.sql"]) {
          const result = own.cluster.psql(readFileSync(join(ROOT, "supabase", "migrations", file), "utf8"));
          assert.ok(result.ok, `${file}: ${result.err}`);
        }
        assert.equal(snapshot(), before);
        assert.equal(oread("select version from private.business_policies where key = 'orders.workflow'"), policyVersion, "the release switch the owner set is not reset by a rerun");
      } finally {
        own.stop();
      }
    });
  });

  // =================================================================================================================
  // Observations for the owner (release preparation). Tests tagged [OBSERVED] record CURRENT behaviour that needs a business decision; they do
  // not decide it. Each one is written so that it fails, loudly, on the day the behaviour is changed on purpose.
  describe("[OBSERVED] business-integrity observations (documented, deliberately not changed in this release)", () => {
    it("[OBSERVED] an order whose delivery method is still 'Not decided' can reach Ready for delivery and Delivered / Collected, and no staff function can set the method afterwards", () => {
      const id = v2Order("ready_for_delivery", { type: "parts_only", full: true });
      assert.equal(read(`select coalesce(delivery_method, 'undecided') from public.orders where id = '${id}'`), "undecided");
      move(id, "delivered");
      assert.equal(status(id), "delivered", "nothing checks the delivery method before Delivered / Collected");
      assert.equal(read("select coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none') from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname ~* 'deliver'"), "none",
        "the method can only be given when the order is created; there is no function to decide it later");
    });

    it("[OBSERVED] who did what IS recorded for every status move and payment (the user id); the dashboard shows a dash only when the staff member has no display name", () => {
      const erin = "00000000-0000-4000-8000-0000000000e9";
      db.commit(`insert into auth.users (id, email) values ('${erin}', 'erin@example.test');
        insert into private.staff_members (user_id, role_code, display_name, is_active) values ('${erin}', 'owner', null, true);`);
      const asErin = asRole({ sub: erin, aal: "aal2" });
      const id = make(100000);
      act(asErin, `select admin.transition_order('${id}', 'awaiting_deposit', 'by a staff member without a display name');`);
      act(asErin, `select admin.record_payment('${id}', 'deposit', 15000, 'cash');`);
      act(AS.olivia, `select admin.transition_order('${id}', 'deposit_received', 'by a staff member with a display name');`);
      // recorded: the actor's id, in the history, the payment details and the audit log
      assert.equal(read(`select string_agg((changed_by = '${erin}')::text, ',' order by id) from private.order_status_history where order_id = '${id}' and to_status = 'awaiting_deposit'`), "true");
      assert.equal(read(`select (recorded_by = '${erin}')::text from private.payment_details where payment_id = (select id from public.payments where order_id = '${id}')`), "true");
      assert.equal(count(`select count(*) from private.audit_log where actor = '${erin}' and action in ('order.transition', 'payment.recorded')`), 2);
      // shown: the display name, or nothing (a dash on the screen) when there is none
      const g = get(id, AS.olivia);
      assert.deepEqual(g.history.filter((h) => h.to_status !== "pending_confirmation").map((h) => h.by), [null, "Owner (test)"]);
      assert.deepEqual(g.payments.map((p) => p.recorded_by), [null]);
      // setting the display name (an owner function that already exists) makes the same, unchanged, history show the name
      act(AS.olivia, `select admin.set_staff_member('${erin}', 'owner', true, 'Erin (test)', 'give the staff member a display name');`);
      const named = get(id, AS.olivia);
      assert.deepEqual(named.history.filter((h) => h.to_status !== "pending_confirmation").map((h) => h.by), ["Erin (test)", "Owner (test)"]);
      assert.deepEqual(named.payments.map((p) => p.recorded_by), ["Erin (test)"]);
      assert.equal(read(`select (changed_by = '${erin}')::text from private.order_status_history where order_id = '${id}' and to_status = 'awaiting_deposit'`), "true", "the history itself was never rewritten");
    });
  });

  // =================================================================================================================
  describe("the operator undo script (supabase/release/order_workflow_v2_rollback.sql)", () => {
    const script = () => readFileSync(join(ROOT, "supabase", "release", "order_workflow_v2_rollback.sql"), "utf8");
    const confirm = "set m1.confirm_workflow_rollback = 'new-website-retired';\n";

    it("is not a migration, so no pipeline applies it by itself", () => {
      const migrations = readFileSync(join(ROOT, "package.json"), "utf8");
      assert.ok(migrations.length > 0);
      assert.equal(existsSync(join(ROOT, "supabase", "migrations", "order_workflow_v2_rollback.sql")), false);
    });

    it("refuses without the confirmation, and refuses while any order is on workflow 2, changing nothing", () => {
      const before = read("select md5(pg_get_functiondef('admin.get_order(uuid)'::regprocedure))");
      const plain = db.cluster.psql(script());
      assert.equal(plain.ok, false);
      assert.match(plain.err, /REFUSED: this restores the earlier staff functions/);
      const guarded = db.cluster.psql(confirm + script());
      assert.equal(guarded.ok, false);
      assert.match(guarded.err, /order\(s\) are on the new workflow/);
      assert.equal(read("select md5(pg_get_functiondef('admin.get_order(uuid)'::regprocedure))"), before);
      assert.equal(read("select value::text from private.business_policies where key = 'orders.workflow'"), '{"default_version": 2}');
    });

    it("on a database with no workflow-2 order it restores the deployed functions, resets the switch, deletes nothing, and the migration re-applies cleanly afterwards", () => {
      const fresh = startDatabase({ schedule: "confirmed" });
      try {
        const q = (sql) => lines(fresh.ok(sql.endsWith(";") ? sql : `${sql};`)).pop() ?? "";
        const orders = q("select count(*) from public.orders");
        fresh.commit(`${AS.olivia}select admin.set_policy('orders.workflow', '{"default_version": 2}'::jsonb, 'confirmed_by_owner', 'test');`);
        const result = fresh.cluster.psql(confirm + script());
        assert.ok(result.ok, result.err);
        assert.equal(q("select value::text from private.business_policies where key = 'orders.workflow'"), '{"default_version": 1}');
        assert.equal(q("select count(*) from public.orders"), orders, "no order touched");
        assert.equal(q("select count(*) from public.order_workflow_stages"), "22", "the additive data stays");
        assert.equal(q("select pg_get_functiondef('admin.get_order(uuid)'::regprocedure) like '%order_next_statuses%'"), "f");
        assert.equal(q("select pg_get_functiondef('admin.transition_order(uuid, text, text)'::regprocedure) like '%workflow_edge_permission%'"), "f");
        // the earlier functions work on an earlier-workflow order again (the deployed behaviour)
        const id = lines(fresh.commit(`${newOrder({ customer: ID.custA, items: one(100000), into: "o", who: AS.sam })}select :'o';`)).pop().trim();
        fresh.commit(`${AS.sam}select admin.transition_order('${id}', 'awaiting_deposit', 'x');`);
        const got = JSON.parse(lines(fresh.ok(`${AS.sam}select admin.get_order('${id}')::text;`)).pop());
        assert.ok(!("stages" in got) && got.next_statuses.every((n) => !("blocked_reason" in n)), "the earlier shape");
        // running it twice is harmless
        assert.ok(fresh.cluster.psql(confirm + script()).ok);
        // and the migration puts the new functions back
        const again = fresh.cluster.psql(readFileSync(join(ROOT, "supabase", "migrations", "20261122120100_order_workflow_v2_functions.sql"), "utf8"));
        assert.ok(again.ok, again.err);
        assert.equal(q("select pg_get_functiondef('admin.get_order(uuid)'::regprocedure) like '%order_next_statuses%'"), "t");
      } finally {
        fresh.stop();
      }
    });
  });
});
