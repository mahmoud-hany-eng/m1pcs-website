// Tests for the staff diagnostics (src/lib/staff/diagnostics.ts). Run with: npm run gateway:diag:test
// LOCAL tests: no Supabase, no hosted pooler. They prove that each failure class writes ONE log line in a fixed
// vocabulary, and that no secret, host, message or URL can reach the log.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./support/alias-loader.mjs", import.meta.url);
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
let diag = null;
let gateway = null;
let skip = false;
try {
  diag = await import("../../src/lib/staff/diagnostics.ts");
  gateway = await import("../../src/lib/staff/gateway.ts");
} catch (error) {
  // CI (M1_REQUIRE_PG=1) must FAIL on any import error: a real defect in the website code must never turn into a green skip.
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}

function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ lines, value }), (error) => ({ lines, error }))
    .finally(() => { console.error = original; });
}
const LINE = /^\[staff\] diag stage=(config|auth|authz|network|tls|login|timeout|other) (reason|code)=[A-Za-z0-9_]{3,40}$/;

describe("staff diagnostics: classification", { skip }, () => {
  const cases = [
    [{ code: "ECONNREFUSED" }, "network", "ECONNREFUSED"], [{ code: "ENOTFOUND" }, "network", "ENOTFOUND"], [{ code: "ETIMEDOUT" }, "network", "ETIMEDOUT"],
    [{ code: "EAI_AGAIN" }, "network", "EAI_AGAIN"], [{ code: "57P03" }, "network", "57P03"], [{ code: "08006" }, "network", "08006"],
    [{ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }, "tls", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"], [{ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "tls", "ERR_TLS_CERT_ALTNAME_INVALID"],
    [{ code: "CERT_HAS_EXPIRED" }, "tls", "CERT_HAS_EXPIRED"], [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls", "DEPTH_ZERO_SELF_SIGNED_CERT"],
    [{ code: "28P01" }, "login", "28P01"], [{ code: "28000" }, "login", "28000"], [{ code: "XX000" }, "login", "XX000"], [{ code: "42501" }, "authz", "42501"],
    [{ message: "timeout exceeded when trying to connect" }, "timeout", "POOL_CONNECT_TIMEOUT"],
    [{ message: "Connection terminated due to connection timeout" }, "timeout", "CLIENT_CONNECT_TIMEOUT"],
    [{ message: "Connection terminated unexpectedly" }, "network", "CONNECTION_TERMINATED"],
    [{ message: "The server does not support SSL connections" }, "tls", "SERVER_REFUSED_TLS"],
    [{ code: "22P02" }, "other", "22P02"], [{}, "other", "NO_CODE"], [null, "other", "NO_CODE"], ["a string", "other", "NO_CODE"],
  ];
  for (const [input, stage, code] of cases) {
    test(`${JSON.stringify(input)} -> ${stage} ${code}`, () => assert.deepEqual(diag.classifyGatewayFailure(input), { stage, code }));
  }
  test("a hostile or odd code, or any message, can never become part of the output", () => {
    for (const code of ["has space", "lower_case", "x".repeat(60), "pa$$word", "a\nb", ["postgre", "sql://u", ":p@h/db"].join("")]) {
      assert.deepEqual(diag.classifyGatewayFailure({ code, message: "password=hunter2 host=db.internal" }), { stage: "other", code: "NO_CODE" }, code);
    }
  });
});

describe("staff diagnostics: what reaches the log", { skip }, () => {
  test("each event has exactly one fixed shape", async () => {
    const events = [
      { stage: "config", reason: "env_missing" }, { stage: "config", reason: "not_a_url" }, { stage: "config", reason: "host_override" },
      { stage: "auth", reason: "unavailable" }, { stage: "auth", reason: "not_configured" }, { stage: "authz", reason: "permission_refused" },
      { stage: "network", code: "ECONNREFUSED" }, { stage: "tls", code: "ERR_TLS_CERT_ALTNAME_INVALID" }, { stage: "login", code: "28P01" },
    ];
    for (const event of events) {
      const { lines } = await captureErrors(() => diag.logStaffDiagnostic(event));
      assert.equal(lines.length, 1);
      assert.match(lines[0], LINE, lines[0]);
    }
  });

  // The real gateway, with no network needed: every one of these used to write NOTHING.
  const secretPassword = "pw-should-never-appear-123";
  const withUrl = (host, port, query = "") => {
    const u = new URL(`postgresql://${host}:${port}/postgres${query}`);
    u.username = "m1_staff_gateway.projectref";
    u.password = secretPassword;
    return u.toString();
  };
  const staff = { userId: "0859a4d6-865f-4ede-8180-ce69c74242c8", sessionId: "11111111-1111-4111-8111-111111111111", email: null };
  const scenarios = [
    ["variable missing", undefined, "stage=config reason=env_missing"],
    ["value pasted with quotes", `"${withUrl("127.0.0.1", 9)}"`, "stage=config reason=not_a_url"],
    ["wrong scheme", "https://example.test/db", "stage=config reason=unsupported_scheme"],
    ["host override", withUrl("127.0.0.1", 9, "?host=other.example"), "stage=config reason=host_override"],
    ["connection refused", withUrl("127.0.0.1", 9), "stage=network code=ECONNREFUSED"],
  ];
  for (const [label, value, expected] of scenarios) {
    test(`${label}: one line, ${expected}, no secret in it`, async () => {
      await gateway.closeGateway();
      const saved = process.env.STAFF_GATEWAY_DATABASE_URL;
      if (value === undefined) delete process.env.STAFF_GATEWAY_DATABASE_URL;
      else process.env.STAFF_GATEWAY_DATABASE_URL = value;
      try {
        const { lines, error } = await captureErrors(() => gateway.staffCall(staff, "is_staff_member"));
        assert.equal(error?.name, "StaffUnavailableError");
        assert.equal(lines.length, 1, JSON.stringify(lines));
        assert.match(lines[0], LINE);
        assert.ok(lines[0].endsWith(expected), lines[0]);
        for (const forbidden of [secretPassword, "127.0.0.1", "m1_staff_gateway", "projectref", "postgresql", "example.test", "other.example"]) assert.ok(!lines[0].includes(forbidden), `the log line must not contain ${forbidden}`);
      } finally {
        await gateway.closeGateway();
        if (saved === undefined) delete process.env.STAFF_GATEWAY_DATABASE_URL;
        else process.env.STAFF_GATEWAY_DATABASE_URL = saved;
      }
    });
  }
});

describe("staff diagnostics: the source keeps it that way", { skip }, () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = readdirSync(join(ROOT, "src/lib/staff")).filter((f) => f.endsWith(".ts")).map((f) => `src/lib/staff/${f}`);
  test("diagnostics.ts holds the only console call in the staff library, and it has the fixed format", () => {
    const withConsole = files.filter((f) => /console\./.test(strip(readFileSync(join(ROOT, f), "utf8"))));
    assert.deepEqual(withConsole, ["src/lib/staff/diagnostics.ts"]);
    const calls = [...strip(readFileSync(join(ROOT, "src/lib/staff/diagnostics.ts"), "utf8")).matchAll(/console\.[a-z]+\([^;]*;/g)].map((m) => m[0]);
    assert.deepEqual(calls, ["console.error(`[staff] diag stage=${event.stage} ${detail}`);"]);
  });
  test("diagnostics.ts never reads the environment, the message text of an unknown error, or a URL", () => {
    const code = strip(readFileSync(join(ROOT, "src/lib/staff/diagnostics.ts"), "utf8"));
    assert.doesNotMatch(code, /process\.env|connectionString|\.stack|JSON\.stringify|String\(error\)/);
  });
});
