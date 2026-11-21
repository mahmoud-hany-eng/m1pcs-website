// Shared helpers for the idempotency test suites: a real PostgreSQL database, the staff gateway role exactly as the website uses it
// (the SQL text is read out of src/lib/staff/gateway.ts), real parallel sessions, and small readers. No state is kept outside `db`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AS, ID, newOrder } from "../fixtures.mjs";
import { ROOT } from "./browser.mjs";

export const CUST_C = "00000000-0000-4000-8000-0000000000c9";
export const PAT = "00000000-0000-4000-8000-0000000000f1"; // a second owner, to prove keys are scoped to the person
export const SESSION = { olivia: "00000000-0000-4000-8000-0000000000e1", sam: "00000000-0000-4000-8000-0000000000e2", pat: "00000000-0000-4000-8000-0000000000e3" };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const GATEWAY_SOURCE = readFileSync(join(ROOT, "src/lib/staff/gateway.ts"), "utf8");

export const lines = (out) => out.split("\n").filter((l) => l !== "");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lit = (v) => (v === null ? "null" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
let counter = 0;
export const newKey = (label = "key") => `${label}-${Date.now().toString(36)}-${counter++}`;
export const ONE = (price, qty = 1, description = "Test item") => [{ kind: "component", description, quantity: qty, unit_price_minor: price }];

/** The first column is the id; a second column (when the statement reports it) says whether the answer was a repeat. */
const parseAnswer = (out) => {
  const last = lines(out).pop()?.trim() ?? "";
  const [id, replayed] = last.split("|");
  return { id, replayed: replayed === "t" };
};

/** Creates the fixture people used by every idempotency suite (a third customer, a second owner, aal2 session rows, two probe helpers). */
export function seedIdempotencyFixtures(db, { probes = true } = {}) {
  db.commit(`insert into public.customers (id, full_name, phone, email, source) values ('${CUST_C}', 'Carol Test (walk-in)', '+97455550003', 'carol@example.test', 'walk_in');`);
  db.commit(`insert into auth.users (id, email) values ('${PAT}', 'pat@example.test');
      insert into private.staff_members (user_id, role_code, display_name, is_active) values ('${PAT}', 'owner', 'Second owner (test)', true);
      insert into auth.sessions (id, user_id, aal) values ('${SESSION.olivia}', '${ID.olivia}', 'aal2'), ('${SESSION.sam}', '${ID.sam}', 'aal2'), ('${SESSION.pat}', '${PAT}', 'aal2');`);
  if (!probes) return; // the release tests apply the platform's own security audit inside the migration, so they must not add test functions to schema public first
  db.commit(`create function public.zz_attempt(stmt text) returns text language plpgsql as $f$
      begin execute stmt; return 'OK'; exception when others then return 'REFUSED: ' || sqlerrm; end $f$;`);
  db.commit(`create function public.zz_state(stmt text) returns text language plpgsql as $f$
      begin execute stmt; return 'OK'; exception when others then return sqlstate; end $f$;`);
  db.commit(`create function public.zz_count(stmt text) returns text language plpgsql as $f$
      declare n bigint; begin execute stmt into n; return n::text; exception when others then return 'DENIED'; end $f$;`);
}

export function makeHelpers(db) {
  const read = (sql, who = "") => db.ok(/;\s*$/.test(sql) ? sql : `${sql};`, who);
  const scalar = (sql, who = "") => lines(read(sql, who)).pop() ?? "";
  const attempt = (who, sql) => lines(db.ok(`select public.zz_attempt('${sql.replaceAll("'", "''")}');`, who)).pop();
  const rowsSeen = (who, sql) => lines(db.ok(`select public.zz_count('${sql.replaceAll("'", "''")}');`, who)).pop();
  const refused = (result, pattern, label = "") => {
    assert.match(result, /^REFUSED: /, `${label} should have been refused but got: ${result}`);
    assert.match(result, pattern, label);
  };
  const make = (items, customer = ID.custA) => lines(db.commit(`${newOrder({ customer, items, into: "o", who: AS.sam })}select :'o';`)).pop().trim();
  const confirmed = (total = 100000, customer = CUST_C) => {
    const id = make(ONE(total), customer);
    db.commit(`${AS.sam}select admin.transition_order('${id}', 'awaiting_deposit');`);
    return id;
  };
  const count = (sql) => Number(scalar(sql));
  const paymentsOf = (id) => count(`select count(*) from public.payments where order_id = '${id}' and entry_type = 'payment'`);
  const paidOf = (id) => count(`select amount_paid_minor from public.orders where id = '${id}'`);
  const keyRows = (key) => count(`select count(*) from private.idempotency_keys where idempotency_key = '${key}'`);

  // The staff gateway, exactly as the website uses it: the gateway database role, the person's verified claims, and the SQL text the
  // website sends (read from gateway.ts), prepared and executed with the same parameter order.
  const gatewayPrefix = (sub, sid) =>
    `reset role;\nreset session authorization;\nset session authorization m1_staff_gateway;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated", aal: "aal2", session_id: sid })}', true);\n`;
  const productionSql = (name) => {
    const match = new RegExp(`^\\s*${name}: "(.+)",$`, "m").exec(GATEWAY_SOURCE);
    assert.ok(match, `the gateway statement ${name} was found in gateway.ts`);
    return match[1];
  };
  const gatewayCall = (who, name, params, sql = productionSql(name)) =>
    `${gatewayPrefix(who.sub, who.sid)}prepare q as ${sql};\nexecute q(${params.map(lit).join(", ")});\n`;
  const OLIVIA = { sub: ID.olivia, sid: SESSION.olivia };
  const SAM = { sub: ID.sam, sid: SESSION.sam };
  const PATRICK = { sub: PAT, sid: SESSION.pat };

  /** Runs one production call in its own transaction. Returns { ok, id, replayed, err }. */
  const viaGateway = (who, name, params, sql) => {
    // VERBOSITY verbose makes psql print the SQLSTATE after "ERROR:", so a test can check the code the website's error mapping reads.
    const r = db.cluster.psql(`\\set VERBOSITY verbose\nbegin;\n${gatewayCall(who, name, params, sql)}commit;`);
    return { ok: r.ok, ...(r.ok ? parseAnswer(r.out) : { id: null, replayed: false }), err: r.err, code: /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err ?? "")?.[1] ?? null };
  };

  // A client re-sends the SAME form on a retry, so the amount it saw (the expected paid amount) is the same too. The first call with a
  // key decides it (the order's real balance at that moment, unless the test names one); a retry with that key reuses it.
  // Keys belong to a person, so the memory is per person too.
  const expectedFor = new Map();
  const expectedOf = (orderId, key, given, actor = "") => {
    const memo = `${actor}:${key}`;
    if (given !== undefined) {
      expectedFor.set(memo, given);
      return given;
    }
    if (!expectedFor.has(memo)) expectedFor.set(memo, paidOf(orderId));
    return expectedFor.get(memo);
  };
  const payParams = (orderId, amount, key, { method = "cash", purpose = "deposit", reference = null, notes = null, expected, actor = "" } = {}) =>
    [orderId, purpose, amount, method, reference, notes, key, expectedOf(orderId, key, expected, actor)];
  const pay = (who, orderId, amount, key, opts = {}) => viaGateway(who, "record_payment", payParams(orderId, amount, key, { ...opts, actor: who.sub }));
  const createOrder = (who, customer, items, key, { method = null, address = null } = {}) =>
    viaGateway(who, "create_order", [customer, JSON.stringify(items), method, address, key]);
  const similar = (who, customer, items, key = null) => {
    const r = db.cluster.psql(`begin;\n${gatewayCall(who, "similar_orders", [customer, JSON.stringify(items), key])}commit;`);
    return { ok: r.ok, rows: r.ok ? JSON.parse(lines(r.out).pop()) : null, err: r.err };
  };
  // adjust_loyalty is not one of the website's fixed gateway statements (the staff screens have no loyalty form); the same gateway role
  // and verified claims are used to prove the rule is the database's, so a future screen inherits it.
  const adjustViaGateway = (who, customer, points, reason, key) => {
    const r = db.cluster.psql(`begin;\n${gatewayPrefix(who.sub, who.sid)}prepare q as with c as materialized (select admin.adjust_loyalty($1::uuid, $2::integer, $3::text, $4::text) as r) select r, coalesce(current_setting('m1.replayed', true), '') = 'true' as replayed from c;\nexecute q(${[customer, points, reason, key].map(lit).join(", ")});\ncommit;`);
    return { ok: r.ok, ...(r.ok ? parseAnswer(r.out) : { id: null, replayed: false }), err: r.err };
  };

  /** A separate, concurrent psql session (the SAME database), so two sessions really overlap. */
  const asyncPsql = (sql, { killAfterMs = null } = {}) =>
    new Promise((resolve) => {
      const c = db.cluster;
      const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", c.dir, "-p", String(c.port), "-U", "postgres", "-t", "-A", "-F", "|", "-d", c.database, "-f", "-"];
      const child = spawn(join(c.bin, "psql"), args);
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code, signal) => resolve({ ok: code === 0, out: out.trim(), err: err.trim(), killed: signal === "SIGKILL", ...(code === 0 ? parseAnswer(out) : { id: null, replayed: false }) }));
      child.stdin.end(sql);
      if (killAfterMs !== null) setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    });
  /** The production call as one concurrent session, optionally holding its transaction open for `holdSeconds` after the call. */
  const parallel = (who, name, params, { holdSeconds = 0, timeoutMs = null } = {}) =>
    asyncPsql(`begin;\n${timeoutMs ? `set local statement_timeout = ${timeoutMs};\n` : ""}${gatewayCall(who, name, params)}${holdSeconds ? `select pg_sleep(${holdSeconds});\n` : ""}commit;`);

  /** Makes a key look `interval` old. The table is append-only, so the guard trigger is disabled for this one test-only statement (superuser, disposable database). */
  const ageKey = (key, interval) =>
    db.commit(`alter table private.idempotency_keys disable trigger idempotency_keys_append_only;
      update private.idempotency_keys set created_at = now() - interval '${interval}' where idempotency_key = '${key}';
      alter table private.idempotency_keys enable trigger idempotency_keys_append_only;`);

  /** The SQLSTATE a statement fails with when run as `who` ("OK" if it succeeds). */
  const stateOf = (who, sql) => lines(db.ok(`select public.zz_state('${sql.replaceAll("'", "''")}');`, who)).pop();
  /** Makes an order look `interval` old (triggers are bypassed for this one test-only statement: superuser, disposable database). */
  const ageOrder = (orderId, interval) =>
    db.commit(`set local session_replication_role = replica; update public.orders set created_at = now() - interval '${interval}' where id = '${orderId}';`);
  const reverse = (orderId, paymentId) => db.commit(`${AS.olivia}select admin.reverse_payment('${paymentId}', 'test reversal');`);
  const cancel = (orderId) => {
    db.commit(`${AS.sam}select admin.transition_order('${orderId}', 'on_hold', 'test');`);
    db.commit(`${AS.sam}select admin.transition_order('${orderId}', 'cancelled', 'test');`);
  };

  return {
    read, scalar, attempt, rowsSeen, refused, make, confirmed, count, paymentsOf, paidOf, keyRows, gatewayPrefix, productionSql, gatewayCall,
    OLIVIA, SAM, PATRICK, viaGateway, expectedOf, payParams, pay, createOrder, similar, adjustViaGateway, asyncPsql, parallel, ageKey, ageOrder, stateOf, reverse, cancel,
  };
}
