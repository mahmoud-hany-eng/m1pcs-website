// LOCAL SUPABASE EMULATOR. Not Supabase, and not a test of Supabase.
//
// What it is: a small HTTP server that answers the auth (GoTrue) and data (PostgREST) requests the customer-account
// code makes, in front of a REAL local PostgreSQL that has the REAL migrations and row level security applied. It lets
// the real Next.js app, the real @supabase/ssr cookie handling and the real database policies run together on a
// laptop, with synthetic data, and without any account, credential or network.
//
// What it is not: it does not prove that the real GoTrue, PostgREST, email delivery, rate limits or dashboard settings
// behave the same. Those need a real development Supabase project (supabase/tests/REAL_SUPABASE_CHECKS.md).
//
// Safety: it listens on 127.0.0.1 only, uses a fresh random signing secret per run, holds only synthetic data, and
// removes its database on exit.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { AS, ID, startDatabase } from "../tests/fixtures.mjs";
import { createAuth } from "./gotrue.mjs";
import { newSecret, signJwt, verifyJwt } from "./jwt.mjs";
import { RestError, buildRpcSql, buildSelectSql, buildUpdateSql, parsePgError } from "./postgrest.mjs";
import { seedPreviewData } from "./seed.mjs";
import { asRole } from "../tests/harness.mjs";

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const demoPassword = () => `Demo-${randomBytes(9).toString("base64url")}-9a`;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) reject(new RestError(413, "PGRST100", "request too large"));
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new RestError(400, "PGRST102", "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, extra = {}) {
  const payload = body === null || body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(payload);
}

export async function startEmulator({ port = 0, accessTtl = 3600, seed = true } = {}) {
  // The preview and the browser tests run on the owner-confirmed deposit schedule, never on the tests' flat example.
  const db = startDatabase({ schedule: "confirmed" });
  const secret = newSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const anonKey = signJwt({ iss: "m1-local-emulator", role: "anon", iat: issuedAt, exp: issuedAt + 10 * 365 * 24 * 3600 }, secret);
  const state = { mode: "up" };

  // Every account the auth mock creates also exists in the database's auth.users, as it would on Supabase.
  const auth = createAuth({
    secret,
    accessTtl,
    onUserCreated: (user) => {
      db.cluster.psql(`insert into auth.users (id, email) values (${sqlText(user.id)}, ${sqlText(user.email)}) on conflict (id) do nothing;`);
    },
  });

  // The people the fixtures created in the database get passwords here, so tests and the preview can sign in as them.
  const users = {};
  for (const [key, id, email] of [
    ["alice", ID.alice, "alice.login@example.test"],
    ["bob", ID.bob, "bob.login@example.test"],
    ["eve", ID.eve, "alice@example.test"],
  ]) {
    const password = demoPassword();
    auth.addUser({ id, email, password, confirmed: true });
    users[key] = { id, email, password };
  }

  const seeded = seed ? seedPreviewData(db) : { refs: [] };

  function runAs({ role, claims, statement }) {
    const script = `begin;\n\\set VERBOSITY verbose\n${asRole(role === "anon" ? { role: "anon" } : { sub: claims.sub, role: "authenticated", aal: claims.aal ?? "aal1", claims: { email: claims.email, session_id: claims.session_id } })}${statement}\ncommit;`;
    return db.cluster.psql(script);
  }

  function rest(req, url, body) {
    if (state.mode === "down") return { status: 503, body: { message: "service unavailable" } };
    if (req.headers.apikey !== anonKey) return { status: 401, body: { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." } };
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    let role = "anon";
    let claims = { role: "anon" };
    if (bearer && bearer !== anonKey) {
      const verified = verifyJwt(bearer, secret);
      if (!verified.ok) return { status: 401, body: { code: "PGRST301", details: null, hint: null, message: verified.reason === "expired" ? "JWT expired" : "JWSError JWSInvalidSignature" } };
      // Like the real PostgREST, only the token is checked here: a revoked session still works until the token expires.
      role = "authenticated";
      claims = verified.payload;
    }

    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    let statement;
    try {
      if (path.startsWith("rpc/") && req.method === "POST") statement = buildRpcSql(path.slice(4), body);
      else if (!path.includes("/") && req.method === "GET") statement = buildSelectSql(path, url.searchParams);
      else if (!path.includes("/") && req.method === "PATCH") statement = buildUpdateSql(path, url.searchParams, body);
      else throw new RestError(405, "PGRST117", "unsupported request");
    } catch (error) {
      if (error instanceof RestError) return { status: error.status, body: { code: error.code, details: null, hint: null, message: error.message } };
      throw error;
    }

    const result = runAs({ role, claims, statement });
    if (!result.ok) {
      const parsed = parsePgError(result.err);
      return { status: role === "anon" && parsed.status === 403 ? 401 : parsed.status, body: parsed.body };
    }
    let data;
    try {
      data = JSON.parse(result.out.split("\n").filter(Boolean).pop() ?? "null");
    } catch {
      return { status: 500, body: { code: "XX000", message: "the emulator could not read the database answer", details: null, hint: null } };
    }
    if ((req.headers.accept ?? "").includes("application/vnd.pgrst.object+json") && Array.isArray(data)) {
      if (data.length !== 1) return { status: 406, body: { code: "PGRST116", details: `The result contains ${data.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" } };
      data = data[0];
    }
    if (req.method === "PATCH" && (req.headers.prefer ?? "").includes("return=minimal")) return { status: 204, body: null };
    return { status: 200, body: data };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://emulator.local");
      if (url.pathname === "/__outbox" && req.method === "GET") return send(res, 200, auth.outbox);
      const body = req.method === "GET" || req.method === "DELETE" ? null : await readJson(req);
      if (url.pathname.startsWith("/auth/v1/")) {
        const out = auth.handle({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body });
        return send(res, out.status, out.body);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const out = rest(req, url, body);
        return send(res, out.status, out.body);
      }
      return send(res, 404, { message: "not found" });
    } catch (error) {
      if (error instanceof RestError) return send(res, error.status, { code: error.code, message: error.message });
      console.error("[emulator] unexpected error:", error);
      return send(res, 500, { message: "emulator error" });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    anonKey,
    users,
    seeded,
    auth,
    outbox: auth.outbox,
    db,
    /** Runs SQL as a database owner and rolls it back. Returns the output. */
    query: (sql, who = AS.superuser) => db.ok(sql, who),
    /** Runs SQL as a database owner and COMMITS it (used by tests to set up a scenario). */
    exec: (sql) => db.commit(`${AS.superuser}${sql}`),
    /** Issues a claim code the way staff do, for a customer. Returns the code, shown once. */
    // COMMITTED, so the code really exists in the database afterwards (the plain query helper rolls back).
    issueClaimCode: (customerId, hours = 72) => db.commit(`${AS.sam}select admin.issue_claim_code('${customerId}', ${hours});`).split("\n").pop(),
    setMode: (mode) => { state.mode = mode; auth.control.mode = mode; },
    setAccessTtl: (seconds) => { auth.control.accessTtl = seconds; },
    setEmailLimit: (limit) => { auth.control.emailLimitPerHour = limit; },
    revokeAllSessions: () => auth.revokeAllSessions(),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      db.stop();
    },
  };
}
