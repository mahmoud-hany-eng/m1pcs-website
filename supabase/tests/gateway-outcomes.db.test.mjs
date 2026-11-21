// PLAT-0004 correction C6: the success and failure messages are ACCURATE, proved by driving the website's own gateway code
// (src/lib/staff/gateway.ts, api.ts, outcomes.ts) over a REAL connection to a disposable PostgreSQL server, with a small
// fault-injecting TCP proxy in between. No mocks of the driver or of the database.
//
// The one fact the messages hinge on: "nothing was changed" is said only where it is TRUE.
//   * the database answered with an error            -> it rolled the transaction back          -> "nothing was changed" is true
//   * the connection broke before COMMIT was sent    -> an open transaction can only roll back  -> "nothing was changed" is true
//   * COMMIT was sent and its answer never arrived   -> it may or may not have been saved       -> the message says exactly that
// and a repeat of an unknown outcome is safe because of the idempotency key (the same form sent again is answered with the
// original, or records exactly once).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";
import { findPgBin } from "./harness.mjs";
import { ID, startDatabase } from "./fixtures.mjs";
import { ROOT } from "./support/browser.mjs";
import { CUST_C, ONE, SESSION, makeHelpers, newKey, seedIdempotencyFixtures, sleep } from "./support/idempotency-helpers.mjs";

register("./support/alias-loader.mjs", import.meta.url);
const GATEWAY_SOURCE = readFileSync(join(ROOT, "src/lib/staff/gateway.ts"), "utf8");

const haveServer = Boolean(findPgBin());
if (!haveServer && process.env.M1_REQUIRE_PG === "1") throw new Error("M1_REQUIRE_PG=1 but no PostgreSQL server programs were found (set PG_BIN)");

let gateway = null;
let api = null;
let outcomes = null;
let skip = haveServer ? false : "no PostgreSQL server programs were found";
try {
  gateway = await import("../../src/lib/staff/gateway.ts");
  api = await import("../../src/lib/staff/api.ts");
  outcomes = await import("../../src/lib/staff/outcomes.ts");
} catch (error) {
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const suite = skip ? describe.skip : describe;

/**
 * A TCP proxy between the website's pg driver and the database. `mode` decides what it does to the NEXT matching message:
 *   pass                    forward everything
 *   drop-call               the function call is never delivered; the connection is cut (the request is lost before it runs)
 *   drop-commit-request     COMMIT is never delivered; the connection is cut (the database rolls back on disconnect)
 *   drop-commit-answer      COMMIT IS delivered and executed; its answer is thrown away and the connection is cut
 */
function startProxy(targetPort) {
  const state = { mode: "pass", sockets: new Set(), dropped: 0 };
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    state.sockets.add(client);
    state.sockets.add(upstream);
    const cut = () => {
      client.destroy();
      upstream.destroy();
    };
    let swallowAnswer = false;
    client.on("data", (chunk) => {
      const text = chunk.toString("latin1");
      if (state.mode === "drop-call" && text.includes("materialized")) {
        state.mode = "pass";
        state.dropped += 1;
        cut();
        return;
      }
      if (state.mode === "drop-call-read" && text.includes("admin.dashboard_summary")) {
        state.mode = "pass";
        state.dropped += 1;
        cut();
        return;
      }
      if (/Q\0\0\0\u000bcommit\0/.test(text)) {
        if (state.mode === "drop-commit-request") {
          state.mode = "pass";
          state.dropped += 1;
          cut();
          return;
        }
        if (state.mode === "drop-commit-answer") {
          state.mode = "pass";
          swallowAnswer = true;
        }
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (swallowAnswer) {
        state.dropped += 1;
        cut();
        return;
      }
      client.write(chunk);
    });
    client.on("error", () => {});
    upstream.on("error", () => {});
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ state, port: server.address().port, close: () => new Promise((r) => { for (const s of state.sockets) s.destroy(); server.close(r); }) }));
  });
}

suite("the website's own gateway code, over a real connection: accurate messages, honest unknowns, safe repeats (PLAT-0004 correction C6)", () => {
  let db;
  let h;
  let proxy;
  const staff = (who = "olivia") => ({ userId: who === "olivia" ? ID.olivia : ID.sam, sessionId: SESSION[who], email: null });

  before(async () => {
    db = startDatabase({ schedule: "confirmed", tcp: true });
    seedIdempotencyFixtures(db);
    h = makeHelpers(db);
    db.commit("alter role m1_staff_gateway login;"); // the production role is a login role; the disposable database's trust rule lets it in without a password
    proxy = await startProxy(db.cluster.port);
    process.env.STAFF_GATEWAY_DATABASE_URL = `postgresql://m1_staff_gateway@127.0.0.1:${proxy.port}/${db.cluster.database}`;
  });
  after(async () => {
    await gateway?.closeGateway();
    await proxy?.close();
    db?.stop();
    delete process.env.STAFF_GATEWAY_DATABASE_URL;
  });
  const reset = async () => {
    proxy.state.mode = "pass";
    await gateway.closeGateway();
  };

  const message = (error) => outcomes.failureState(error).message;
  const attemptCall = async (fn) => {
    try {
      return { value: await fn() };
    } catch (error) {
      return { error };
    }
  };

  // =================================================================================================================
  describe("what the database says, as the screen shows it", () => {
    it("a first save and a repeat: the same record, and only the repeat says so", async () => {
      await reset();
      const order = h.confirmed(200000);
      const key = newKey("e2e");
      const a = await api.staffApi(staff()).recordPayment(order, "deposit", 30000, "cash", null, null, key, 0);
      const b = await api.staffApi(staff()).recordPayment(order, "deposit", 30000, "cash", null, null, key, 0);
      assert.equal(a.replayed, false);
      assert.equal(b.replayed, true);
      assert.equal(a.id, b.id);
      assert.equal(outcomes.paymentSuccessMessage(a.replayed), "Payment recorded. A receipt number was generated.");
      assert.match(outcomes.paymentSuccessMessage(b.replayed), /already recorded earlier, so nothing new was recorded/);
      const o1 = await api.staffApi(staff("sam")).createOrder(CUST_C, ONE(4242), null, null, newKey("e2e"));
      assert.equal(o1.replayed, false);
    });

    it("the three key refusals reach the screen with the right words and the right key handling", async () => {
      await reset();
      const order = h.confirmed(200000);
      const key = newKey("e2e");
      await api.staffApi(staff()).recordPayment(order, "deposit", 30000, "cash", null, null, key, 0);
      // M1K01: same key, different data -> the form must take a new key
      const different = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 30001, "cash", null, null, key, 0));
      assert.ok(different.error instanceof gateway.StaffOperationError);
      assert.equal(different.error.retireKey, true);
      assert.deepEqual(outcomes.failureState(different.error), { status: "error", message: "this idempotency key was already used for a different request; nothing was changed", keyRetired: true });
      // M1K03: the balance moved -> a refusal, the key is NOT retired (it was never used), the page must be reloaded
      const stale = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 10000, "cash", null, null, newKey("e2e"), 0));
      assert.ok(stale.error instanceof gateway.StaffOperationError);
      assert.equal(stale.error.retireKey, false);
      assert.match(stale.error.message, /you saw QAR 0\.00, it is now QAR 300\.00\); nothing was recorded\. Reload the page and check the payments before recording again/);
      assert.equal(outcomes.failureState(stale.error).keyRetired, undefined);
      // M1K02: a reversed payment -> never "recorded", the key is retired
      const rkey = newKey("e2e");
      const first = h.pay(h.OLIVIA, order, 20000, rkey, { expected: 30000 });
      h.reverse(order, first.id);
      const reversed = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 20000, "cash", null, null, rkey, 30000));
      assert.ok(reversed.error instanceof gateway.StaffOperationError);
      assert.equal(reversed.error.retireKey, true);
      assert.match(reversed.error.message, /has since been reversed, so it was not recorded again/);
      assert.equal(h.paymentsOf(order), 2, "the first and the one just made; the stale repeat added none");
    });

    it("a business-rule refusal, a permission refusal and an unexpected database error each produce a fixed, honest sentence", async () => {
      await reset();
      const order = h.confirmed(100000);
      const tooMuch = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 100001, "cash", null, null, newKey("e2e"), 0));
      assert.equal(message(tooMuch.error), "this payment would exceed the order total");
      const denied = await attemptCall(() => api.staffApi(staff("sam")).recordPayment(order, "deposit", 100, "cash", null, null, newKey("e2e"), 0));
      assert.ok(denied.error instanceof gateway.StaffPermissionError);
      assert.equal(message(denied.error), outcomes.DENIED);
      const missing = await attemptCall(() => api.staffApi(staff()).recordPayment("00000000-0000-4000-8000-000000000000", "deposit", 100, "cash", null, null, newKey("e2e"), 0));
      assert.equal(message(missing.error), "order not found");
      // a database error the website does not know (here: a bad enum cast) must not echo anything about the database
      const unexpected = await attemptCall(() => api.staffApi(staff()).transitionOrder(order, "no_such_status_at_all", null));
      assert.ok(unexpected.error);
      assert.doesNotMatch(message(unexpected.error), /enum|column|table|relation|public\.|private\.|admin\./i);
      assert.equal(h.paymentsOf(order), 0);
    });

    it("the duplicate-order warning, end to end: evidence names the earlier order, the retry's own order is not reported, and confirming creates the second order", async () => {
      await reset();
      const items = ONE(51515, 1, "End to end duplicate");
      const first = await api.staffApi(staff("sam")).createOrder(CUST_C, items, null, null, newKey("e2e"));
      const warn = await api.staffApi(staff("sam")).similarOrders(CUST_C, items, newKey("e2e"));
      assert.equal(warn.length, 1);
      assert.equal(warn[0].order_id, first.id);
      const warning = outcomes.duplicateWarning(warn);
      assert.equal(warning.duplicates[0].id, first.id);
      assert.match(warning.message, /Nothing was created yet/);
      const second = await api.staffApi(staff("sam")).createOrder(CUST_C, items, null, null, newKey("e2e"));
      assert.notEqual(second.id, first.id, "a confirmed second order is created, not blocked");
    });
  });

  // =================================================================================================================
  describe("when the connection fails: only a lost COMMIT answer is 'unknown'", () => {
    it("COMMIT delivered, answer lost: the payment IS saved, the person is told the result is unknown (never 'nothing was changed'), and sending the same form again is answered with the original", async () => {
      await reset();
      const order = h.confirmed(200000);
      const key = newKey("lost");
      proxy.state.mode = "drop-commit-answer";
      const lost = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0));
      assert.ok(lost.error instanceof gateway.StaffOutcomeUnknownError, String(lost.error));
      assert.equal(lost.error.repeatIsSafe, true);
      const shown = outcomes.failureState(lost.error);
      assert.doesNotMatch(shown.message, /nothing was changed/i);
      assert.match(shown.message, /may or may not have been saved/);
      assert.match(shown.message, /If you send the same form again within the hour, it will not be saved twice/);
      assert.equal(shown.keyRetired, undefined, "the key is kept");
      assert.equal(h.paymentsOf(order), 1, "the truth: it WAS saved");
      await reset();
      const again = await api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0);
      assert.equal(again.replayed, true);
      assert.equal(h.paymentsOf(order), 1, "the repeat recorded nothing new");
      assert.match(outcomes.paymentSuccessMessage(again.replayed), /already recorded/);
    });

    it("COMMIT never delivered: the payment is NOT saved, the person is still told the result is unknown (the browser cannot know), and the same form then records exactly once", async () => {
      await reset();
      const order = h.confirmed(200000);
      const key = newKey("lost");
      proxy.state.mode = "drop-commit-request";
      const lost = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0));
      assert.ok(lost.error instanceof gateway.StaffOutcomeUnknownError, String(lost.error));
      await sleep(300);
      assert.equal(h.paymentsOf(order), 0, "the truth: nothing was saved (the open transaction rolled back)");
      assert.equal(h.keyRows(key), 0, "and no claim survived");
      await reset();
      const again = await api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0);
      assert.equal(again.replayed, false);
      assert.equal(h.paymentsOf(order), 1);
    });

    it("the same two cases for an ORDER, and for a non-keyed write the message never invites a blind retry", async () => {
      await reset();
      const key = newKey("lost");
      const before = h.count("select count(*) from public.orders");
      proxy.state.mode = "drop-commit-answer";
      const lost = await attemptCall(() => api.staffApi(staff("sam")).createOrder(CUST_C, ONE(60606), null, null, key));
      assert.ok(lost.error instanceof gateway.StaffOutcomeUnknownError);
      assert.equal(h.count("select count(*) from public.orders"), before + 1, "it was created");
      await reset();
      const again = await api.staffApi(staff("sam")).createOrder(CUST_C, ONE(60606), null, null, key);
      assert.equal(again.replayed, true);
      assert.equal(h.count("select count(*) from public.orders"), before + 1);
      // a status change is not keyed: an unknown outcome says "reload and check", never "send it again"
      const order = h.make(ONE(1000));
      proxy.state.mode = "drop-commit-answer";
      const status = await attemptCall(() => api.staffApi(staff("sam")).transitionOrder(order, "awaiting_deposit", null));
      assert.ok(status.error instanceof gateway.StaffOutcomeUnknownError);
      assert.equal(status.error.repeatIsSafe, false);
      assert.doesNotMatch(status.error.message, /will not be saved twice/);
      assert.match(status.error.message, /Reload the page and check before trying again/);
    });

    it("the connection cut BEFORE the call ran: nothing happened, and the message says so truthfully", async () => {
      await reset();
      const order = h.confirmed(200000);
      proxy.state.mode = "drop-call";
      const cut = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, newKey("cut"), 0));
      assert.ok(cut.error instanceof gateway.StaffUnavailableError, String(cut.error));
      assert.equal(message(cut.error), gateway.UNAVAILABLE_NOTHING_CHANGED);
      assert.match(message(cut.error), /Nothing was changed/);
      assert.equal(h.paymentsOf(order), 0, "and it is true");
    });

    it("a READ whose connection drops does not claim anything about changes, and the service recovers on the next call", async () => {
      await reset();
      proxy.state.mode = "drop-call-read";
      const cut = await attemptCall(() => api.staffApi(staff()).dashboard());
      assert.ok(cut.error instanceof gateway.StaffUnavailableError, String(cut.error));
      assert.doesNotMatch(cut.error.message, /nothing was changed|saved/i);
      assert.match(cut.error.message, /not available right now/);
      const ok = await api.staffApi(staff()).dashboard();
      assert.ok(ok);
    });

    it("the database being unreachable: a write says nothing was changed (true: it never started), and no database detail leaks", async () => {
      await reset();
      const saved = process.env.STAFF_GATEWAY_DATABASE_URL;
      process.env.STAFF_GATEWAY_DATABASE_URL = "postgresql://m1_staff_gateway@127.0.0.1:1/none";
      try {
        await gateway.closeGateway();
        const refused = await attemptCall(() => api.staffApi(staff()).recordPayment(h.confirmed(), "deposit", 100, "cash", null, null, newKey("down"), 0));
        assert.ok(refused.error instanceof gateway.StaffUnavailableError);
        assert.equal(message(refused.error), gateway.UNAVAILABLE_NOTHING_CHANGED);
        assert.doesNotMatch(message(refused.error), /127\.0\.0\.1|ECONNREFUSED|postgresql/);
      } finally {
        process.env.STAFF_GATEWAY_DATABASE_URL = saved;
        await gateway.closeGateway();
      }
    });
  });

  // =================================================================================================================
  describe("the 10-second statement limit while waiting on a claim", () => {
    it("a request that waits on another session's claim past the gateway's limit is cancelled, says so truthfully, and a later repeat is answered", async () => {
      await reset();
      const order = h.confirmed(200000);
      const key = newKey("slow");
      // another session holds the claim for 13 s (the website's gateway cancels a statement after 10 s)
      const holder = h.parallel(h.OLIVIA, "record_payment", h.payParams(order, 40000, key, { expected: 0, actor: ID.olivia }), { holdSeconds: 13 });
      await sleep(500);
      const waited = await attemptCall(() => api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0));
      assert.ok(waited.error instanceof gateway.StaffUnavailableError, String(waited.error));
      assert.equal(message(waited.error), gateway.TOO_SLOW);
      assert.match(message(waited.error), /Nothing was changed/);
      assert.ok((await holder).ok);
      assert.equal(h.paymentsOf(order), 1, "exactly one payment: the holder's");
      const repeat = await api.staffApi(staff()).recordPayment(order, "deposit", 40000, "cash", null, null, key, 0);
      assert.equal(repeat.replayed, true);
    });
  });

  // =================================================================================================================
  describe("every call is classified, and the classification matches the database", () => {
    it("the calls the gateway treats as writes are exactly the volatile admin functions it can call (plus none of the stable readers)", () => {
      const calls = [...new Set([...GATEWAY_SOURCE.matchAll(/\badmin\.([a-z_]+)\(/g)].map((m) => m[1]))];
      assert.ok(calls.length >= 20);
      const volatile = new Set(h.read(`select p.proname from pg_proc p where p.pronamespace = 'admin'::regnamespace and p.proname in (${calls.map((c) => `'${c}'`).join(",")}) and p.provolatile = 'v'`).split("\n").filter(Boolean));
      const byName = Object.fromEntries([...GATEWAY_SOURCE.matchAll(/^\s*([a-z_]+): "[^"]*?\badmin\.([a-z_]+)\(/gm)].map((m) => [m[1], m[2]]));
      for (const [callName, fn] of Object.entries(byName)) {
        const isWrite = gateway.isWriteCall(callName);
        // A volatile function that only reads (the staff-membership helpers) may be called a read; a function that writes must be a write.
        if (isWrite) assert.ok(volatile.has(fn), `${callName} is classified as a write, so admin.${fn} must be volatile`);
        else if (volatile.has(fn)) assert.ok(READ_ONLY_VOLATILE.has(fn), `${callName} -> admin.${fn} is volatile but classified as a read; if it only reads, add it to READ_ONLY_VOLATILE here on purpose`);
      }
    });
  });
});

// Volatile in the database but read-only in effect: they only look things up (they cannot be stable because they call helpers that are volatile).
const READ_ONLY_VOLATILE = new Set(["is_staff_member", "my_permissions", "dashboard_summary", "preview_deposit"]);
