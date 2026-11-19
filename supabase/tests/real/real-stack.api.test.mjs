// OFFICIAL SUPABASE LOCAL STACK TESTS (API level).
//
// WHAT THIS IS. Tests against the real Supabase services that the Supabase CLI runs in Docker: Auth (GoTrue), the REST
// layer (PostgREST) behind the Kong gateway, the supabase/postgres image, and Mailpit for email. The project's own
// emulator is not involved: nothing in this file is a mock, and the migrations were applied by `supabase start`.
//
// WHAT THIS IS NOT. A test against a hosted Supabase project. Hosted-only behaviour (rate limits on the built-in mailer,
// the dashboard's settings, custom SMTP, a hosted JWT signing-key setup, backups) still needs the development project
// described in supabase/tests/REAL_SUPABASE_CHECKS.md. The tests skip (they never pass vacuously) when no stack is running.
//
// Run with the stack up:  npm run real:test
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { jwtClaims, makeApi, makeMail, ownerClient, PASSWORD, readStack, signJwt, signUpConfirmed, sleep, tokenFromLink, uniqueEmail } from "./stack.mjs";

const stack = readStack();
const skip = stack ? false : "the official Supabase local stack is not running (start it as described in supabase/README.md)";
const api = stack ? makeApi(stack) : null;
const mail = stack ? makeMail(stack) : null;

/** A failed claim is an ordinary answer with no value (the function returns null): nothing says why, and nothing is linked. */
const assertClaimFailed = (response, message = "") => {
  assert.equal(response.status, 200, `${message} ${response.text}`);
  assert.equal(response.json, null, `${message} a claim that should fail returned ${response.text}`);
};

/** Runs one SQL statement as a signed-in identity, the way PostgREST does: the role and the claims are set for the transaction. */
async function asIdentity(client, { sub, role = "authenticated", aal = "aal2", staff = false }, sql, params = []) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role, aal, ...(staff ? {} : {}) })]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

describe("the official Supabase local stack: migrations on the real platform image", { skip, timeout: 120_000 }, () => {
  let db;
  before(async () => {
    db = await ownerClient(stack);
  });
  after(async () => db?.end());

  it("all migrations are applied, in order, on the supabase/postgres image", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(new URL("../../migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await db.query("select version from supabase_migrations.schema_migrations order by version");
    assert.deepEqual(rows.map((r) => r.version), files.map((f) => f.slice(0, 14)));
    const v = await db.query("show server_version");
    assert.match(v.rows[0].server_version, /^15\./);
  });

  it("the database's own self-checks report nothing on the real image", async () => {
    assert.deepEqual((await db.query("select * from private.security_audit()")).rows, []);
    assert.deepEqual((await db.query("select * from private.gateway_audit()")).rows, []);
  });

  it("the auth service's session table has the second-factor level column the gateway relies on", async () => {
    const { rows } = await db.query("select data_type, udt_name from information_schema.columns where table_schema = 'auth' and table_name = 'sessions' and column_name = 'aal'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].udt_name, "aal_level");
  });

  it("the staff gateway role exists without a login, without privilege, and is in no API role", async () => {
    const { rows } = await db.query(
      `select r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
              (select count(*) from pg_auth_members m where m.member = r.oid) as memberships
         from pg_roles r where r.rolname = 'm1_staff_gateway'`,
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: "0" });
  });
});

describe("the official Supabase local stack: what the REST layer exposes", { skip, timeout: 120_000 }, () => {
  let alice;
  before(async () => {
    alice = await signUpConfirmed({ api, mail, email: uniqueEmail("expose") });
  });

  it("an anonymous caller sees only the two public reference tables", async () => {
    const root = await api.call("/rest/v1/");
    assert.equal(root.status, 200);
    assert.deepEqual(Object.keys(root.json.paths).filter((p) => p !== "/").sort(), ["/order_statuses", "/quote_categories"]);
  });

  it("a signed-in customer sees only the customer-facing tables and the two customer functions", async () => {
    const root = await api.call("/rest/v1/", { token: alice.session.access_token });
    const paths = Object.keys(root.json.paths).filter((p) => p !== "/").sort();
    assert.deepEqual(paths, [
      "/customer_accounts",
      "/customers",
      "/loyalty_balances",
      "/loyalty_ledger",
      "/order_items",
      "/order_statuses",
      "/order_tracking_events",
      "/orders",
      "/payments",
      "/quotation_lines",
      "/quotations",
      "/quote_categories",
      rpcPath("claim_customer_profile"),
      rpcPath("create_my_customer_profile"),
    ].sort());
  });

  it("the admin and private schemas cannot be reached through the API, for anyone", async () => {
    for (const token of [undefined, alice.session.access_token]) {
      for (const profile of ["admin", "private", "auth", "extensions"]) {
        const get = await api.call("/rest/v1/orders", { token, headers: { "accept-profile": profile } });
        assert.equal(get.status, 406, `${profile} read: ${get.text}`);
        assert.equal(get.json.code, "PGRST106");
        const rpc = await api.call("/rest/v1/rpc/dashboard_summary", { method: "POST", body: {}, token, headers: { "content-profile": profile } });
        assert.equal(rpc.status, 406, `${profile} rpc: ${rpc.text}`);
      }
    }
  });

  it("no staff function exists in the exposed schema, under any name", async () => {
    for (const name of ["dashboard_summary", "create_order", "record_payment", "reverse_payment", "set_policy", "set_staff_member", "issue_claim_code", "transition_order"]) {
      const response = await api.call(`/rest/v1/rpc/${name}`, { method: "POST", body: {}, token: alice.session.access_token });
      assert.equal(response.status, 404, `${name}: ${response.text}`);
      assert.equal(response.json.code, "PGRST202");
    }
  });

  it("the staff tables are not exposed either", async () => {
    for (const table of ["staff_members", "staff_roles", "business_policies", "audit_log", "payments_internal"]) {
      const response = await api.call(`/rest/v1/${table}`, { token: alice.session.access_token });
      assert.equal(response.status, 404, `${table}: ${response.text}`);
    }
  });

  it("an anonymous caller cannot call the customer functions", async () => {
    const response = await api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", body: { p_code: "ABCD-EFGH" } });
    assert.ok([401, 403].includes(response.status), `${response.status} ${response.text}`);
  });
});

const rpcPath = (name) => `/rpc/${name}`;

describe("the official Supabase local stack: sign-up, email verification, sign-in, refresh and sign-out", { skip, timeout: 180_000 }, () => {
  it("sign-up creates an unconfirmed user: no session, and sign-in is refused until the address is confirmed", async () => {
    const email = uniqueEmail("signup");
    const signup = await api.call("/auth/v1/signup", { method: "POST", body: { email, password: PASSWORD } });
    assert.equal(signup.status, 200);
    assert.equal(signup.json.access_token, undefined, "no session may exist before the address is confirmed");
    assert.equal(signup.json.email, email);
    const login = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: PASSWORD } });
    assert.equal(login.status, 400);
    assert.equal(login.json.error_code, "email_not_confirmed");
  });

  it("the confirmation email arrives in the mail service, from the project's template, with a one-time link to /auth/confirm", async () => {
    const email = uniqueEmail("mail");
    await api.call(`/auth/v1/signup?redirect_to=${encodeURIComponent("http://localhost:3000/auth/confirm?next=%2Faccount")}`, { method: "POST", body: { email, password: PASSWORD } });
    const message = await mail.waitFor(email);
    assert.ok(message, "no email arrived");
    assert.equal(message.subject, "Confirm your M1 Gaming PCs account");
    const link = message.links.find((l) => l.includes("token_hash="));
    const parts = tokenFromLink(link);
    assert.equal(parts.origin, "http://localhost:3000");
    assert.equal(parts.path, "/auth/confirm");
    assert.equal(parts.type, "email");
    assert.equal(parts.next, "/account");
    assert.match(parts.token_hash, /^[0-9a-f]{20,}$/);
    assert.doesNotMatch(message.html, /password/i, "an email must never carry the password");
  });

  it("the link confirms the address once; using it again fails; the session it returns is a first-level session", async () => {
    const email = uniqueEmail("verify");
    const started = Date.now() - 1000;
    await api.call(`/auth/v1/signup?redirect_to=${encodeURIComponent("http://localhost:3000/auth/confirm?next=%2Faccount")}`, { method: "POST", body: { email, password: PASSWORD } });
    const { token_hash } = tokenFromLink((await mail.waitFor(email, { after: started })).links.find((l) => l.includes("token_hash=")));
    const first = await api.call("/auth/v1/verify", { method: "POST", body: { type: "email", token_hash } });
    assert.equal(first.status, 200);
    const claims = jwtClaims(first.json.access_token);
    assert.equal(claims.aal, "aal1");
    assert.equal(claims.role, "authenticated");
    assert.ok(claims.session_id);
    assert.equal(first.json.user.email_confirmed_at !== null, true);
    const again = await api.call("/auth/v1/verify", { method: "POST", body: { type: "email", token_hash } });
    assert.ok(again.status >= 400 && again.status < 500, `a second use must fail, got ${again.status}`);
    assert.equal(again.json?.access_token, undefined);
  });

  it("a tampered or unknown token hash is refused", async () => {
    for (const token_hash of ["0".repeat(56), "not-a-real-hash", "' or 1=1 --"]) {
      const response = await api.call("/auth/v1/verify", { method: "POST", body: { type: "email", token_hash } });
      assert.ok(response.status >= 400 && response.status < 500, `${token_hash}: ${response.status}`);
      assert.equal(response.json?.access_token, undefined);
    }
  });

  it("a wrong password and an unknown address give the same answer (no account enumeration)", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("enum") });
    const wrong = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: "wrong-password-123" } });
    const unknown = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: uniqueEmail("nobody"), password: "wrong-password-123" } });
    assert.equal(wrong.status, 400);
    assert.equal(unknown.status, 400);
    assert.equal(wrong.json.error_code, "invalid_credentials");
    assert.equal(unknown.json.error_code, "invalid_credentials");
    assert.equal(wrong.json.msg, unknown.json.msg);
  });

  it("FINDING: signing up again with a registered address is REFUSED by the real service (422 user_already_exists); it does not hide it", async (t) => {
    // The project's own emulator hid this by default. The real service does not, even with email confirmation on, so the
    // application must (and does) show the same screen for both outcomes. The browser test proves the screen.
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("dupe") });
    const again = await api.call("/auth/v1/signup", { method: "POST", body: { email: user.email, password: "Another-long-passphrase-2" } });
    assert.equal(again.status, 422);
    assert.equal(again.json.error_code, "user_already_exists");
    assert.equal(again.json.access_token, undefined);
    // The existing account is untouched: its password still works and the other one does not.
    assert.equal((await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } })).status, 200);
    assert.equal((await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: "Another-long-passphrase-2" } })).status, 400);
    t.diagnostic("the real service reveals that an address is registered; the app maps user_already_exists to the same screen as a new sign-up");
  });

  it("password sign-in returns an access token and a refresh token with the claims the app depends on", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("login") });
    const login = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } });
    assert.equal(login.status, 200);
    assert.equal(login.json.token_type, "bearer");
    assert.equal(login.json.expires_in, 3600);
    const claims = jwtClaims(login.json.access_token);
    assert.equal(claims.sub, user.userId);
    assert.equal(claims.aal, "aal1");
    assert.equal(claims.role, "authenticated");
    assert.ok(claims.session_id);
    assert.ok(login.json.refresh_token);
  });

  it("the refresh token rotates on the same session; a replayed parent is refused once its child has been used", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("refresh") });
    const refresh = (token) => api.call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: token } });
    const first = (await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } })).json;
    const second = await refresh(first.refresh_token);
    assert.equal(second.status, 200);
    assert.notEqual(second.json.refresh_token, first.refresh_token);
    assert.equal(jwtClaims(second.json.access_token).session_id, jwtClaims(first.access_token).session_id, "a refresh stays on the same session");
    // A retry of the same refresh (a lost response) is answered with the same child: no second session is created.
    const retry = await refresh(first.refresh_token);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.refresh_token, second.json.refresh_token);
    // Once the child has been used, the parent is dead (after the service's short reuse window).
    const third = await refresh(second.json.refresh_token);
    assert.equal(third.status, 200);
    await sleep(10_500);
    const replay = await refresh(first.refresh_token);
    assert.equal(replay.status, 400);
    assert.equal(replay.json.error_code, "refresh_token_already_used");
    // FINDING: the replay is refused but the session family is NOT revoked: the newest token keeps working.
    assert.equal((await refresh(third.json.refresh_token)).status, 200);
  });

  it("sign-out revokes the session: the refresh token and the auth service's own check both fail", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("logout") });
    const login = (await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } })).json;
    const before = await api.call("/auth/v1/user", { token: login.access_token });
    assert.equal(before.status, 200);
    const out = await api.call("/auth/v1/logout", { method: "POST", token: login.access_token });
    assert.equal(out.status, 204);
    const refresh = await api.call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: login.refresh_token } });
    assert.ok(refresh.status >= 400 && refresh.status < 500, `refresh after sign-out must fail, got ${refresh.status}`);
    const after = await api.call("/auth/v1/user", { token: login.access_token });
    assert.ok(after.status >= 400 && after.status < 500, `getUser after sign-out must fail, got ${after.status}`);
  });

  it("FINDING: after sign-out the REST layer still accepts the old access token until it expires (it does not check sessions)", async () => {
    // This is why the application asks the auth service (getUser) rather than trusting a token, and why the staff
    // gateway's database function checks the sign-in session in auth.sessions itself.
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("stateless") });
    const login = (await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } })).json;
    await api.call("/auth/v1/logout", { method: "POST", token: login.access_token });
    const rest = await api.call("/rest/v1/customers?select=id", { token: login.access_token });
    assert.equal(rest.status, 200, "the REST layer validates the signature and expiry only");
    assert.deepEqual(rest.json, []);
  });

  it("the REST layer refuses an expired, a tampered and an unsigned token", async (t) => {
    if (!stack.jwtSecret) return t.skip("the stack's JWT secret is not available");
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", aud: "authenticated", aal: "aal1" };
    const expired = signJwt(stack.jwtSecret, { ...base, iat: now - 7200, exp: now - 3600 });
    const r1 = await api.call("/rest/v1/customers?select=id", { token: expired });
    assert.equal(r1.status, 401);
    assert.equal(r1.json.code, "PGRST303", "JWT expired");
    const valid = signJwt(stack.jwtSecret, { ...base, iat: now, exp: now + 600 });
    const tampered = `${valid.split(".")[0]}.${Buffer.from(JSON.stringify({ ...base, role: "service_role", iat: now, exp: now + 600 })).toString("base64url")}.${valid.split(".")[2]}`;
    const r2 = await api.call("/rest/v1/customers?select=id", { token: tampered });
    assert.equal(r2.status, 401, "a payload changed after signing must be refused");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ ...base, iat: now, exp: now + 600 })).toString("base64url")}.`;
    const r3 = await api.call("/rest/v1/customers?select=id", { token: none });
    assert.equal(r3.status, 401, "alg none must be refused");
    const wrongKey = signJwt("another-secret-of-more-than-thirty-two-characters", { ...base, iat: now, exp: now + 600 });
    const r4 = await api.call("/rest/v1/customers?select=id", { token: wrongKey });
    assert.equal(r4.status, 401, "a token signed with another key must be refused");
  });

  it("password recovery: the email carries a recovery link; it works once; the old password stops working", async () => {
    const user = await signUpConfirmed({ api, mail, email: uniqueEmail("recover") });
    const started = Date.now() - 1000;
    const recover = await api.call(`/auth/v1/recover?redirect_to=${encodeURIComponent("http://localhost:3000/auth/confirm?next=%2Faccount%2Fprofile")}`, { method: "POST", body: { email: user.email } });
    assert.equal(recover.status, 200);
    const message = await mail.waitFor(user.email, { subject: "Reset your M1", after: started });
    assert.ok(message, "no recovery email arrived");
    const { token_hash, type } = tokenFromLink(message.links.find((l) => l.includes("token_hash=")));
    assert.equal(type, "recovery");
    const verified = await api.call("/auth/v1/verify", { method: "POST", body: { type: "recovery", token_hash } });
    assert.equal(verified.status, 200);
    const newPassword = "A-new-synthetic-passphrase-9";
    const update = await api.call("/auth/v1/user", { method: "PUT", token: verified.json.access_token, body: { password: newPassword } });
    assert.equal(update.status, 200);
    const old = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: user.password } });
    assert.equal(old.status, 400);
    const fresh = await api.call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: user.email, password: newPassword } });
    assert.equal(fresh.status, 200);
    const again = await api.call("/auth/v1/verify", { method: "POST", body: { type: "recovery", token_hash } });
    assert.ok(again.status >= 400, "a recovery link works once");
  });

  it("a recovery request for an unknown address gets the same answer and sends nothing", async () => {
    const email = uniqueEmail("ghost");
    const response = await api.call("/auth/v1/recover", { method: "POST", body: { email } });
    assert.equal(response.status, 200);
    await sleep(800);
    assert.equal(await mail.count(email), 0);
  });
});

describe("the official Supabase local stack: row level security, through the real REST layer with real tokens", { skip, timeout: 240_000 }, () => {
  let db, alice, bob, olivia;
  let custA, custB, orderA, orderB;
  const own = {};

  /** Staff fixtures are built the way an owner would: through the admin functions, as an identified staff member. */
  const staffSql = (sql, params) => asIdentity(db, { sub: olivia.userId, aal: "aal2" }, sql, params);

  before(async () => {
    db = await ownerClient(stack);
    [alice, bob, olivia] = await Promise.all([
      signUpConfirmed({ api, mail, email: uniqueEmail("alice") }),
      signUpConfirmed({ api, mail, email: uniqueEmail("bob") }),
      signUpConfirmed({ api, mail, email: uniqueEmail("olivia") }),
    ]);
    await db.query("insert into private.staff_members (user_id, role_code, display_name, is_active) values ($1, 'owner', 'Owner (test)', true)", [olivia.userId]);
    custA = (await staffSql("select admin.create_customer('Alice Test', '+97455550101', $1, 'whatsapp', 'en', null) as id", [alice.email])).rows[0].id;
    custB = (await staffSql("select admin.create_customer('Bob Test', '+97455550102', $1, 'whatsapp', 'en', null) as id", [bob.email])).rows[0].id;
    const items = JSON.stringify([{ kind: "component", description: "Test graphics card", quantity: 1, unit_price_minor: 350000 }]);
    orderA = (await staffSql("select admin.create_order($1, $2::jsonb) as id", [custA, items])).rows[0].id;
    orderB = (await staffSql("select admin.create_order($1, $2::jsonb) as id", [custB, items])).rows[0].id;
    await staffSql("select admin.transition_order($1, 'awaiting_deposit', 'RealStackReasonSentinel')", [orderA]);
    await staffSql("select admin.record_payment($1, 'deposit', 100000, 'fawran', now(), null, 'RealStackRefSentinel', 'RealStackNoteSentinel')", [orderA]);
    await staffSql("select admin.publish_tracking_event($1, 'Order confirmed', 'We have confirmed your order.', 'awaiting_deposit')", [orderA]);
    // Link the two customers to their accounts the way the product does: with a staff-issued claim code, through the real REST layer.
    for (const [user, customer] of [[alice, custA], [bob, custB]]) {
      const code = (await staffSql("select admin.issue_claim_code($1, 24) as code", [customer])).rows[0].code;
      own[user.email] = code;
      const claim = await api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: user.session.access_token, body: { p_code: code } });
      assert.equal(claim.status, 200, claim.text);
    }
  });
  after(async () => db?.end());

  const get = (path, user) => api.call(`/rest/v1/${path}`, { token: user?.session.access_token });

  it("a customer reads their own customer record, orders, items, tracking and payments", async () => {
    assert.deepEqual((await get("customers?select=id", alice)).json, [{ id: custA }]);
    assert.deepEqual((await get("orders?select=id", alice)).json, [{ id: orderA }]);
    assert.equal((await get("order_items?select=id", alice)).json.length, 1);
    assert.equal((await get("order_tracking_events?select=title", alice)).json.length, 1);
    const payments = (await get("payments?select=*", alice)).json;
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount_minor, 100000);
  });

  it("a customer cannot read another customer's records, by list or by id", async () => {
    assert.deepEqual((await get(`customers?id=eq.${custB}&select=id`, alice)).json, []);
    assert.deepEqual((await get(`orders?id=eq.${orderB}&select=id`, alice)).json, []);
    assert.deepEqual((await get(`order_items?order_id=eq.${orderB}&select=id`, alice)).json, []);
    assert.deepEqual((await get(`order_tracking_events?order_id=eq.${orderB}&select=id`, alice)).json, []);
    assert.deepEqual((await get(`payments?order_id=eq.${orderB}&select=id`, alice)).json, []);
    assert.deepEqual((await get(`orders?id=eq.${orderA}&select=id`, bob)).json, []);
    assert.deepEqual((await get(`customer_accounts?select=customer_id`, bob)).json, [{ customer_id: custB }]);
  });

  it("an anonymous caller reads nothing from any customer table", async () => {
    for (const table of ["customers", "orders", "order_items", "order_tracking_events", "payments", "loyalty_ledger", "customer_accounts", "quotations"]) {
      const response = await get(`${table}?select=*`, null);
      assert.ok(response.status === 401 || response.status === 403 || (response.status === 200 && response.json.length === 0), `${table}: ${response.status} ${response.text}`);
      if (response.status === 200) assert.deepEqual(response.json, []);
    }
  });

  it("what a customer receives contains no private staff data", async () => {
    const everything = JSON.stringify([
      (await get("orders?select=*", alice)).json,
      (await get("order_items?select=*", alice)).json,
      (await get("order_tracking_events?select=*", alice)).json,
      (await get("payments?select=*", alice)).json,
      (await get("customers?select=*", alice)).json,
    ]);
    for (const sentinel of ["RealStackReasonSentinel", "RealStackRefSentinel", "RealStackNoteSentinel", "internal_reference", "supplier", "unit_cost", "recorded_by"]) {
      assert.ok(!everything.includes(sentinel), `a customer response contains ${sentinel}`);
    }
  });

  it("a customer cannot change an order, a payment, an item or a tracking update, or delete anything", async () => {
    const attempts = [
      api.call(`/rest/v1/orders?id=eq.${orderA}`, { method: "PATCH", token: alice.session.access_token, body: { status: "delivered", total_minor: 1 }, headers: { prefer: "return=representation" } }),
      api.call(`/rest/v1/payments?order_id=eq.${orderA}`, { method: "PATCH", token: alice.session.access_token, body: { amount_minor: 1 }, headers: { prefer: "return=representation" } }),
      api.call("/rest/v1/payments", { method: "POST", token: alice.session.access_token, body: { order_id: orderA, entry_type: "payment", purpose: "deposit", amount_minor: 999999, method: "cash" } }),
      api.call(`/rest/v1/order_items?order_id=eq.${orderA}`, { method: "PATCH", token: alice.session.access_token, body: { unit_price_minor: 1 }, headers: { prefer: "return=representation" } }),
      api.call(`/rest/v1/order_tracking_events?order_id=eq.${orderA}`, { method: "DELETE", token: alice.session.access_token }),
      api.call(`/rest/v1/orders?id=eq.${orderA}`, { method: "DELETE", token: alice.session.access_token }),
      api.call("/rest/v1/loyalty_ledger", { method: "POST", token: alice.session.access_token, body: { points: 100000, entry_type: "earned" } }),
    ];
    for (const response of await Promise.all(attempts)) {
      assert.ok(response.status === 401 || response.status === 403 || response.status === 404 || (response.status < 300 && JSON.stringify(response.json) === "[]"), `a write succeeded: ${response.status} ${response.text}`);
    }
    // Nothing changed.
    const order = await db.query("select status, total_minor from public.orders where id = $1", [orderA]);
    assert.equal(order.rows[0].status, "awaiting_deposit");
    assert.equal(Number(order.rows[0].total_minor), 350000);
    assert.equal((await db.query("select count(*)::int as n from public.payments where order_id = $1", [orderA])).rows[0].n, 1);
  });

  it("a customer can edit only the permitted profile fields of their own record", async () => {
    const ok = await api.call(`/rest/v1/customers?id=eq.${custA}`, { method: "PATCH", token: alice.session.access_token, body: { full_name: "Alice Renamed" }, headers: { prefer: "return=representation" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json[0].full_name, "Alice Renamed");
    for (const field of [{ customer_code: "C-9999-99999" }, { source: "walk_in" }, { id: "00000000-0000-4000-8000-000000000999" }]) {
      const bad = await api.call(`/rest/v1/customers?id=eq.${custA}`, { method: "PATCH", token: alice.session.access_token, body: field, headers: { prefer: "return=representation" } });
      assert.ok(bad.status >= 400 || bad.json?.length === 0, `${JSON.stringify(field)} was accepted: ${bad.status} ${bad.text}`);
    }
    const other = await api.call(`/rest/v1/customers?id=eq.${custB}`, { method: "PATCH", token: alice.session.access_token, body: { full_name: "Hijacked" }, headers: { prefer: "return=representation" } });
    assert.ok(other.status >= 400 || other.json?.length === 0, `another customer's record was changed: ${other.text}`);
    assert.equal((await db.query("select full_name from public.customers where id = $1", [custB])).rows[0].full_name, "Bob Test");
  });

  it("a customer cannot link themselves to a record or give themselves a staff role", async () => {
    const link = await api.call("/rest/v1/customer_accounts", { method: "POST", token: alice.session.access_token, body: { user_id: alice.userId, customer_id: custB, linked_via: "admin" } });
    assert.ok(link.status >= 400, `a self-made link was accepted: ${link.status} ${link.text}`);
    const staff = await api.call("/rest/v1/staff_members", { method: "POST", token: alice.session.access_token, body: { user_id: alice.userId, role_code: "owner", is_active: true } });
    assert.equal(staff.status, 404);
    assert.equal((await db.query("select count(*)::int as n from private.staff_members where user_id = $1", [alice.userId])).rows[0].n, 0);
  });

  it("forged claims in the token's own metadata change nothing: authorization reads only the staff table", async (t) => {
    // The user's metadata is editable by the user through the auth API. It must never decide access.
    const update = await api.call("/auth/v1/user", { method: "PUT", token: alice.session.access_token, body: { data: { role: "owner", is_admin: true, permissions: ["orders.read"] } } });
    assert.equal(update.status, 200);
    const refreshed = (await api.call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: alice.session.refresh_token } })).json;
    assert.equal(jwtClaims(refreshed.access_token).user_metadata.is_admin, true, "the forged metadata is in her token");
    const orders = await api.call("/rest/v1/orders?select=id", { token: refreshed.access_token });
    assert.deepEqual(orders.json, [{ id: orderA }], "she still sees only her own order");
    const claims = await asIdentity(db, { sub: alice.userId, aal: "aal2" }, "select private.has_permission('orders.read') as r");
    assert.equal(claims.rows[0].r, false);
    t.diagnostic("forged user_metadata is accepted by the auth service and ignored by every policy and function");
  });

  it("quotations: a customer cannot change the status or the quoted total of a quotation, and cannot read another customer's", async () => {
    const q = await db.query(
      "insert into public.quotations (customer_id, category, product_preference, requested_budget_minor) values ($1, (select label from public.quote_categories order by sort_order limit 1), 'Not sure', 500000) returning id",
      [custB],
    );
    const id = q.rows[0].id;
    assert.deepEqual((await get(`quotations?id=eq.${id}&select=id`, alice)).json, []);
    const patch = await api.call(`/rest/v1/quotations?id=eq.${id}`, { method: "PATCH", token: alice.session.access_token, body: { status: "accepted", quoted_total_minor: 1 }, headers: { prefer: "return=representation" } });
    assert.ok(patch.status >= 400 || patch.json?.length === 0, `another customer's quotation was changed: ${patch.text}`);
    const row = (await db.query("select status, quoted_total_minor from public.quotations where id = $1", [id])).rows[0];
    assert.equal(row.status, "submitted");
    assert.equal(row.quoted_total_minor, null);
  });

  it("the claim flow: a used code, a wrong code and a malformed code all fail with the same empty answer", async () => {
    const eve = await signUpConfirmed({ api, mail, email: uniqueEmail("eve") });
    const claim = (code) => api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: eve.session.access_token, body: { p_code: code } });
    const reused = await claim(own[alice.email]);
    const wrong = await claim("ABCDE-FGHJK-LMNPQ-RSTUV");
    const malformed = await claim("ZZZZ-ZZZZ");
    for (const response of [reused, wrong, malformed]) assertClaimFailed(response);
    assert.equal(reused.text, wrong.text, "every failure looks identical");
    assert.equal(wrong.text, malformed.text);
    assert.deepEqual((await get("customers?select=id", eve)).json, []);
  });

  it("claiming is rate limited: after five wrong guesses in an hour even a correct code is refused, and the code is not burned", async () => {
    const mallory = await signUpConfirmed({ api, mail, email: uniqueEmail("mallory") });
    const claim = (code) => api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: mallory.session.access_token, body: { p_code: code } });
    for (let i = 0; i < 5; i += 1) assertClaimFailed(await claim(`BAD${i}-BAD${i}`), `guess ${i}`);
    const fresh = (await staffSql("select admin.issue_claim_code($1, 24) as code", [custA])).rows[0].code;
    assertClaimFailed(await claim(fresh), "a correct code while rate limited");
    assert.deepEqual((await get("customers?select=id", mallory)).json, []);
    const row = await db.query("select count(*)::int as n from private.customer_claim_codes where customer_id = $1 and used_at is null and revoked_at is null", [custA]);
    assert.ok(row.rows[0].n >= 1, "an attacker's lock-out must not spend the real owner's code");
  });

  it("a revoked code and an expired code do not link anything", async () => {
    const carol = await signUpConfirmed({ api, mail, email: uniqueEmail("carol") });
    const claim = (code) => api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: carol.session.access_token, body: { p_code: code } });
    const cust = (await staffSql("select admin.create_customer('Carol Test', '+97455550103', null, 'whatsapp', 'en', null) as id")).rows[0].id;
    const revoked = (await staffSql("select admin.issue_claim_code($1, 24) as code", [cust])).rows[0].code;
    const codeRow = (await staffSql("select id from admin.list_claim_codes($1) where status = 'active'", [cust])).rows[0].id;
    await staffSql("select admin.revoke_claim_code($1, 'issued by mistake')", [codeRow]);
    assertClaimFailed(await claim(revoked), "a revoked code");
    const expiring = (await staffSql("select admin.issue_claim_code($1, 24) as code", [cust])).rows[0].code;
    await db.query("update private.customer_claim_codes set expires_at = now() - interval '1 minute' where customer_id = $1 and used_at is null and revoked_at is null", [cust]);
    assertClaimFailed(await claim(expiring), "an expired code");
    assert.deepEqual((await get("customers?select=id", carol)).json, []);
  });

  it("a customer who already has a profile can link a second record with a new code, and sees both; nothing is merged", async () => {
    const custA2 = (await staffSql("select admin.create_customer('Alice Older Record', '+97455550104', null, 'whatsapp', 'en', null) as id")).rows[0].id;
    const items = JSON.stringify([{ kind: "component", description: "Older order item", quantity: 1, unit_price_minor: 120000 }]);
    const olderOrder = (await staffSql("select admin.create_order($1, $2::jsonb) as id", [custA2, items])).rows[0].id;
    const code = (await staffSql("select admin.issue_claim_code($1, 24) as code", [custA2])).rows[0].code;
    const claim = await api.call("/rest/v1/rpc/claim_customer_profile", { method: "POST", token: alice.session.access_token, body: { p_code: code } });
    assert.equal(claim.status, 200, claim.text);
    const orders = (await get("orders?select=id&order=created_at.asc", alice)).json.map((r) => r.id).sort();
    assert.deepEqual(orders, [orderA, olderOrder].sort());
    const customers = (await get("customers?select=id", alice)).json.map((r) => r.id).sort();
    assert.deepEqual(customers, [custA, custA2].sort(), "two separate records, linked to one account");
    const audit = await db.query("select count(*)::int as n from private.audit_log where action = 'customer.claim_code_used' and details ->> 'user_id' = $1", [alice.userId]);
    assert.equal(audit.rows[0].n, 2, "every link leaves an audit entry");
    // Bob still sees nothing of hers.
    assert.deepEqual((await get(`orders?id=eq.${olderOrder}&select=id`, bob)).json, []);
  });

  it("two customer records with the same email or phone are NOT linked to a signed-in account by that match", async () => {
    const twin = await signUpConfirmed({ api, mail, email: uniqueEmail("twin") });
    await staffSql("select admin.create_customer('Twin Match', '+97455550199', $1, 'whatsapp', 'en', null)", [twin.email]);
    assert.deepEqual((await get("customers?select=id", twin)).json, []);
    assert.deepEqual((await get("orders?select=id", twin)).json, []);
    assert.equal((await db.query("select count(*)::int as n from public.customer_accounts where user_id = $1", [twin.userId])).rows[0].n, 0);
  });
});
