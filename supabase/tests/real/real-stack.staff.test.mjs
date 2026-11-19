// OFFICIAL SUPABASE LOCAL STACK TESTS (staff: second factor, sessions, and the server-only gateway).
//
// The staff gateway code under test is the REAL shipped module (src/lib/staff/gateway.ts and api.ts), not a copy. It talks
// to the real Postgres of the official local stack as the dedicated `m1_staff_gateway` login. The sign-in sessions it is
// checked against are REAL: created by the real Auth service, upgraded to the second level with a real one-time code
// that this test computes the way an authenticator app does, and revoked by the real sign-out.
//
// The gateway role is given a throw-away password here, for the disposable local database only, and set back to no login
// when the tests end. No password is committed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { jwtClaims, makeApi, makeMail, ownerClient, readStack, signUpConfirmed, totp, uniqueEmail } from "./stack.mjs";

register("../support/alias-loader.mjs", import.meta.url);

const stack = readStack();
let skip = stack ? false : "the official Supabase local stack is not running (start it as described in supabase/README.md)";
const api = stack ? makeApi(stack) : null;
const mail = stack ? makeMail(stack) : null;

const gatewayPassword = randomBytes(18).toString("hex");
let gatewayUrl = null;
if (stack) {
  const url = new URL(stack.dbUrl);
  url.username = "m1_staff_gateway";
  url.password = gatewayPassword;
  gatewayUrl = url.toString();
}

describe("the official Supabase local stack: staff second factor, real sessions and the shipped gateway", { skip, timeout: 300_000 }, () => {
  let db, gw; // gw = the shipped gateway module
  let olivia, sam, nina, dana;
  const people = {};

  /** Enrols an authenticator factor through the real Auth API and completes the challenge: the session becomes second-level. */
  async function addSecondFactor(user) {
    const bearer = user.session.access_token;
    const enrol = await api.call("/auth/v1/factors", { method: "POST", token: bearer, body: { factor_type: "totp", friendly_name: "test", issuer: "M1 test" } });
    assert.equal(enrol.status, 200, enrol.text);
    const factorId = enrol.json.id;
    const challenge = await api.call(`/auth/v1/factors/${factorId}/challenge`, { method: "POST", token: bearer, body: {} });
    assert.equal(challenge.status, 200, challenge.text);
    const verify = await api.call(`/auth/v1/factors/${factorId}/verify`, { method: "POST", token: bearer, body: { challenge_id: challenge.json.id, code: totp(enrol.json.totp.secret) } });
    assert.equal(verify.status, 200, verify.text);
    return { factorId, secret: enrol.json.totp.secret, session: verify.json };
  }
  const staffOf = (user, session = user.session) => ({ userId: user.userId, sessionId: jwtClaims(session.access_token).session_id, email: user.email });

  before(async () => {
    db = await ownerClient(stack);
    await db.query(`alter role m1_staff_gateway login password '${gatewayPassword}'`);
    process.env.STAFF_GATEWAY_DATABASE_URL = gatewayUrl;
    gw = { gateway: await import("../../../src/lib/staff/gateway.ts"), api: await import("../../../src/lib/staff/api.ts") };

    [olivia, sam, nina, dana] = await Promise.all(["olivia", "sam", "nina", "dana"].map((n) => signUpConfirmed({ api, mail, email: uniqueEmail(n) })));
    await db.query(
      "insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1,'owner','Owner (test)',true), ($2,'staff','Staff (test)',true), ($3,'staff','Inactive (test)',false)",
      [olivia.userId, sam.userId, dana.userId],
    );
    // aal1 = the password-only session each person has right after signing in.
    for (const [name, user] of Object.entries({ olivia, sam, nina, dana })) people[name] = { user, aal1: user.session, aal2: null };
  });

  after(async () => {
    await gw?.gateway.closeGateway();
    await db?.query("alter role m1_staff_gateway nologin password null").catch(() => {});
    await db?.end();
  });

  const aal2Of = async (name) => {
    const p = people[name];
    if (!p.aal2) p.aal2 = (await addSecondFactor(p.user)).session;
    return p.aal2;
  };

  it("a real authenticator code upgrades the same session to the second level", async () => {
    const before = jwtClaims(people.olivia.aal1.access_token);
    assert.equal(before.aal, "aal1");
    const upgraded = await aal2Of("olivia");
    const after = jwtClaims(upgraded.access_token);
    assert.equal(after.aal, "aal2");
    assert.equal(after.session_id, before.session_id, "the second factor upgrades the existing session");
    assert.ok(after.amr.some((a) => a.method === "totp"));
    const row = await db.query("select aal from auth.sessions where id = $1", [after.session_id]);
    assert.equal(row.rows[0].aal, "aal2");
  });

  it("a wrong or replayed one-time code does not upgrade a session", async () => {
    const bearer = people.nina.aal1.access_token;
    const enrol = await api.call("/auth/v1/factors", { method: "POST", token: bearer, body: { factor_type: "totp", friendly_name: "x", issuer: "M1 test" } });
    const challenge = await api.call(`/auth/v1/factors/${enrol.json.id}/challenge`, { method: "POST", token: bearer, body: {} });
    const bad = await api.call(`/auth/v1/factors/${enrol.json.id}/verify`, { method: "POST", token: bearer, body: { challenge_id: challenge.json.id, code: "000000" } });
    assert.ok(bad.status >= 400 && bad.status < 500, `a wrong code must be refused, got ${bad.status}`);
    assert.equal(jwtClaims(bearer).aal, "aal1");
    const row = await db.query("select aal from auth.sessions where id = $1", [jwtClaims(bearer).session_id]);
    assert.equal(row.rows[0].aal, "aal1");
  });

  it("the gateway runs a staff function for an active staff member on a real second-level session", async () => {
    const session = await aal2Of("olivia");
    const staff = staffOf(people.olivia.user, session);
    const permissions = await gw.api.staffApi(staff).permissions();
    assert.ok(permissions.includes("orders.read") && permissions.includes("payments.record") && permissions.includes("policies.manage"));
    const summary = await gw.api.staffApi(staff).dashboard();
    assert.equal(typeof summary.total_orders, "number");
  });

  it("the database itself refuses a first-level session even though the gateway always claims the second level", async () => {
    // The gateway sets aal2 in the claims it hands the database; the database does not trust that. It reads the sign-in
    // session in the auth service's own table, which says aal1 for a person who has not entered the code.
    const staff = staffOf(people.sam.user, people.sam.aal1);
    await assert.rejects(() => gw.api.staffApi(staff).dashboard(), (e) => e instanceof gw.gateway.StaffPermissionError);
    await assert.rejects(() => gw.api.staffApi(staff).listOrders(), (e) => e instanceof gw.gateway.StaffPermissionError);
  });

  it("a made-up session id, another person's session id and a session id of a non-staff person are all refused", async () => {
    const olivia2 = await aal2Of("olivia");
    const ninaStaff = staffOf(people.nina.user, await aal2Of("nina"));
    // 1. A session id that does not exist.
    await assert.rejects(() => gw.api.staffApi({ userId: people.olivia.user.userId, sessionId: "00000000-0000-4000-8000-0000000000ff", email: null }).dashboard(), (e) => e instanceof gw.gateway.StaffPermissionError);
    // 2. A real second-level session that belongs to someone else, presented with Olivia's identity.
    await assert.rejects(() => gw.api.staffApi({ userId: people.olivia.user.userId, sessionId: ninaStaff.sessionId, email: null }).dashboard(), (e) => e instanceof gw.gateway.StaffPermissionError);
    // 3. A non-staff person with a genuine second-level session: signed in, verified, and still not staff.
    const permissions = await gw.api.staffApi(ninaStaff).permissions();
    assert.deepEqual(permissions, []);
    await assert.rejects(() => gw.api.staffApi(ninaStaff).listOrders(), (e) => e instanceof gw.gateway.StaffPermissionError);
    assert.ok(olivia2);
  });

  it("a deactivated staff member is refused even with a genuine second-level session", async () => {
    const staff = staffOf(people.dana.user, await aal2Of("dana"));
    assert.deepEqual(await gw.api.staffApi(staff).permissions(), []);
    await assert.rejects(() => gw.api.staffApi(staff).dashboard(), (e) => e instanceof gw.gateway.StaffPermissionError);
  });

  it("a staff member without a permission is refused that function and still allowed the others", async () => {
    const staff = staffOf(people.sam.user, await aal2Of("sam"));
    const a = gw.api.staffApi(staff);
    const perms = await a.permissions();
    assert.ok(perms.includes("orders.read"));
    assert.ok(!perms.includes("payments.record"));
    assert.ok(Array.isArray(await a.listOrders()));
    await assert.rejects(() => a.listPayments(), (e) => e instanceof gw.gateway.StaffPermissionError);
    await assert.rejects(() => a.setPolicy("orders.deposit", { mode: "percent", percent_bps: 5000 }, "confirmed_by_owner", "no"), (e) => e instanceof gw.gateway.StaffPermissionError);
    await assert.rejects(() => a.audit(), (e) => e instanceof gw.gateway.StaffPermissionError);
  });

  it("nobody can assign themselves a role: the staff-management function refuses self-changes and lacks a gateway entry", async () => {
    const samStaff = staffOf(people.sam.user, await aal2Of("sam"));
    // No call named set_staff_member exists in the gateway's list, so no screen or action can reach it.
    assert.equal(Object.keys(gw.gateway).includes("CALLS"), false);
    const rows = await db.query("select count(*)::int as n from private.staff_members where user_id = $1 and role_code = 'owner'", [people.sam.user.userId]);
    assert.equal(rows.rows[0].n, 0);
    await assert.rejects(() => gw.gateway.staffCall(samStaff, "set_staff_member", [people.sam.user.userId, "owner", true]));
    // Even the owner, directly in the database, cannot change her own role.
    const attempt = db.query("begin").then(async () => {
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: people.olivia.user.userId, role: "authenticated", aal: "aal2" })]);
        await db.query("select admin.set_staff_member($1, 'owner', false, 'x')", [people.olivia.user.userId]);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    });
    await assert.rejects(() => attempt);
  });

  it("the gateway login can do nothing except run the listed staff functions", async () => {
    const client = new pg.Client({ connectionString: gatewayUrl });
    await client.connect();
    try {
      const refused = async (sql) => assert.rejects(() => client.query(sql), (e) => ["42501", "42P01", "3F000"].includes(e.code), sql);
      await refused("select * from public.orders");
      await refused("select * from public.customers");
      await refused("select * from private.staff_members");
      await refused("select * from private.audit_log");
      await refused("select * from auth.users");
      await refused("select * from auth.sessions");
      await refused("insert into public.payments (order_id, entry_type, purpose, amount_minor, method) values (gen_random_uuid(), 'payment', 'deposit', 1, 'cash')");
      await refused("update public.orders set status = 'delivered'");
      await refused("create table public.should_not_exist (x int)");
      await refused("select private.next_code('R')");
      await refused("set role postgres");
      await refused("set role authenticated");
      await refused("set role service_role");
      await refused("set role supabase_admin");
      // A staff function without any identity set is refused by the function itself.
      await assert.rejects(() => client.query("select admin.dashboard_summary()"), (e) => e.code === "42501");
      // And a function with claims it cannot back up in the auth service's own session table is refused.
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: people.olivia.user.userId, role: "authenticated", aal: "aal2", session_id: "00000000-0000-4000-8000-0000000000fe" })]);
      await assert.rejects(() => client.query("select admin.dashboard_summary()"), (e) => e.code === "42501");
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  it("the claims one request sets never leak into the next request on a pooled connection", async () => {
    const owner = staffOf(people.olivia.user, await aal2Of("olivia"));
    const outsider = staffOf(people.nina.user, await aal2Of("nina"));
    for (let i = 0; i < 12; i += 1) {
      const who = i % 2 === 0 ? owner : outsider;
      const permissions = await gw.api.staffApi(who).permissions();
      assert.equal(permissions.length > 0, who === owner, `call ${i}`);
    }
  });

  it("signing out ends the staff session at once: the same session id is refused by the database afterwards", async () => {
    const fresh = await signUpConfirmed({ api, mail, email: uniqueEmail("ruth") });
    await db.query("insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1,'staff','Ruth (test)',true)", [fresh.userId]);
    const second = (await addSecondFactor(fresh)).session;
    const staff = staffOf(fresh, second);
    assert.ok((await gw.api.staffApi(staff).permissions()).length > 0);
    assert.ok(Array.isArray(await gw.api.staffApi(staff).listOrders()));
    const out = await api.call("/auth/v1/logout", { method: "POST", token: second.access_token });
    assert.equal(out.status, 204);
    // The access token is still a valid signed token for up to an hour (the REST layer would accept it)...
    assert.equal((await api.call("/rest/v1/customers?select=id", { token: second.access_token })).status, 200);
    // ...but the session no longer exists, and the database refuses it.
    await assert.rejects(() => gw.api.staffApi(staff).listOrders(), (e) => e instanceof gw.gateway.StaffPermissionError);
    assert.deepEqual(await gw.api.staffApi(staff).permissions(), []);
  });

  it("a session past its own expiry is refused by the database", async () => {
    const fresh = await signUpConfirmed({ api, mail, email: uniqueEmail("tess") });
    await db.query("insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1,'staff','Tess (test)',true)", [fresh.userId]);
    const second = (await addSecondFactor(fresh)).session;
    const staff = staffOf(fresh, second);
    assert.ok(Array.isArray(await gw.api.staffApi(staff).listOrders()));
    await db.query("update auth.sessions set not_after = now() - interval '1 minute' where id = $1", [staff.sessionId]);
    await assert.rejects(() => gw.api.staffApi(staff).listOrders(), (e) => e instanceof gw.gateway.StaffPermissionError);
  });

  it("the whole staff journey through the real gateway: customer, order, deposit at the tier boundaries, payments, reversal, audit", async () => {
    const staff = staffOf(people.olivia.user, await aal2Of("olivia"));
    const a = gw.api.staffApi(staff);
    // The confirmed schedule, at the boundaries the owner confirmed (15% up to 3,000; 25% to 5,000; 35% above).
    const quotes = {};
    for (const minor of [300000, 300001, 500000, 500001]) quotes[minor] = await a.previewDeposit(minor);
    assert.deepEqual(Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, [v.amount_minor, v.rate_bps]])), {
      300000: [45000, 1500],
      300001: [75000, 2500],
      500000: [125000, 2500],
      500001: [175000, 3500],
    });

    const customerId = await a.createCustomer({ fullName: "Gateway Journey", phone: "+97455550188", email: null, source: "whatsapp", language: "en", address: null });
    const found = await a.searchCustomers("Gateway Journey");
    assert.ok(found.some((c) => c.id === customerId));
    const orderId = await a.createOrder(customerId, [
      { kind: "component", description: "Example case", quantity: 1, unit_price_minor: 200000 },
      { kind: "component", description: "Example GPU", quantity: 1, unit_price_minor: 150000 },
      { kind: "discount", description: "Example discount", quantity: 1, unit_price_minor: -50000 },
    ], "delivery", null);
    let order = await a.getOrder(orderId);
    assert.equal(order.total_minor, 300000);
    assert.equal(order.deposit_fixed_at, null, "the deposit is provisional until the order is confirmed");

    await a.transitionOrder(orderId, "awaiting_deposit", null);
    order = await a.getOrder(orderId);
    assert.notEqual(order.deposit_fixed_at, null);
    assert.equal(order.deposit_required_minor, 45000, "15 percent of the whole QAR 3,000.00");
    assert.equal(order.deposit_rate_bps, 1500);

    // A policy change must not touch an order whose deposit is already fixed.
    const before = (await a.policies()).find((p) => p.key === "orders.deposit");
    await a.setPolicy("orders.deposit", { ...before.value, tiers: [{ up_to_minor: 300000, percent_bps: 2000 }, { up_to_minor: 500000, percent_bps: 2500 }, { percent_bps: 3500 }] }, "confirmed_by_owner", "test: changing the schedule after confirmation");
    assert.equal((await a.getOrder(orderId)).deposit_required_minor, 45000);
    await a.setPolicy("orders.deposit", before.value, "confirmed_by_owner", "test: restoring the confirmed schedule");

    // The deposit counts only once a staff member records it. Receipt numbers are generated and unique; Fawran is accepted.
    assert.equal(order.deposit_fixed, true);
    assert.equal(order.deposit_received, false, "a fixed deposit is not a received deposit");
    const p1 = await a.recordPayment(orderId, "deposit", 45000, "fawran", "FAWRAN-REF-1", "private note");
    order = await a.getOrder(orderId);
    assert.equal(order.deposit_received, true);
    assert.equal(order.amount_paid_minor, 45000);
    const receipt = order.payments.find((p) => p.id === p1).receipt_number;
    assert.match(receipt, /^R-\d{4}-\d{5}$/);
    await assert.rejects(() => a.recordPayment(orderId, "balance", 1000, "bank_transfer", null, null), (e) => e instanceof gw.gateway.StaffOperationError, "only cash and Fawran are recorded through the website");
    const p2 = await a.recordPayment(orderId, "balance", 100000, "cash", null, null);
    const receipt2 = (await a.getOrder(orderId)).payments.find((p) => p.id === p2).receipt_number;
    assert.notEqual(receipt2, receipt);

    // A reversal adds an entry; the original stays; the second reversal is refused.
    await a.reversePayment(p2, "test: recorded in error");
    order = await a.getOrder(orderId);
    assert.equal(order.amount_paid_minor, 45000);
    assert.equal(order.payments.length, 3);
    assert.equal(order.payments.find((p) => p.id === p2).reversed, true);
    await assert.rejects(() => a.reversePayment(p2, "again"), (e) => e instanceof gw.gateway.StaffOperationError);

    // Tracking, withdrawal and the audit trail.
    const eventId = await a.publishTracking(orderId, "Parts ordered", "Example update", null);
    await a.retractTracking(eventId, "test: wrong date");
    assert.equal((await a.getOrder(orderId)).tracking.find((t) => t.id === eventId).retracted, true);
    const audit = await a.audit(200);
    const mine = audit.filter((r) => r.actor !== null);
    assert.ok(mine.length >= 8, `expected the actions to be audited, saw ${mine.length}`);
    for (const action of ["order.created", "payment.recorded", "payment.reversed", "policy.changed"]) {
      assert.ok(audit.some((r) => r.action === action), `no audit entry for ${action}`);
    }
    // Dashboard figures follow.
    const summary = await a.dashboard();
    assert.ok(summary.total_orders >= 1);
    assert.equal(typeof summary.outstanding_balance_minor, "number");
  });
});
