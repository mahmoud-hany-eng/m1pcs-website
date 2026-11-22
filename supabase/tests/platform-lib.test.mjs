// Unit tests for src/lib/platform (money helpers and the environment contract). No database needed.
// Node strips TypeScript types itself from version 22.18, so the .ts files are imported directly.
// Keys below are built at run time from synthetic payloads: no key-shaped text is stored in the repository.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

let money;
let env;
let loadError = null;
try {
  money = await import("../../src/lib/platform/money.ts");
  env = await import("../../src/lib/platform/env.ts");
} catch (error) {
  // CI (M1_REQUIRE_PG=1) must FAIL on any import error: a real defect in the website code must never turn into a green skip.
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  loadError = error;
}
const skip = loadError ? `this Node version cannot import TypeScript directly (${loadError.code ?? loadError.message}); use Node 22.18 or newer` : false;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fakeJwt = (role) => `${b64url({ alg: "none" })}.${b64url({ role, iss: "synthetic-test" })}.${"x".repeat(12)}`;
const GOOD_URL = "https://project-ref.example.test";
// New-style key prefixes, assembled at run time so no key-shaped literal exists in the file.
const newSecretKey = () => ["sb", "secret", "synthetic"].join("_");
const newPublishableKey = () => ["sb", "publishable", "synthetic"].join("_");

describe("money helpers (integer minor units of QAR)", { skip }, () => {
  test("formatQar groups thousands and always shows two decimals", () => {
    assert.equal(money.formatQar(0), "QAR 0.00");
    assert.equal(money.formatQar(5), "QAR 0.05");
    assert.equal(money.formatQar(99900), "QAR 999.00");
    assert.equal(money.formatQar(125050), "QAR 1,250.50");
    assert.equal(money.formatQar(123456789), "QAR 1,234,567.89");
    assert.equal(money.formatQar(-500), "-QAR 5.00");
  });

  test("formatQar refuses a fraction of a minor unit, NaN and Infinity", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      assert.throws(() => money.formatQar(bad), RangeError);
    }
  });

  test("parseQarToMinor reads the ways a person types an amount", () => {
    assert.equal(money.parseQarToMinor("1250"), 125000);
    assert.equal(money.parseQarToMinor("1,250.50"), 125050);
    assert.equal(money.parseQarToMinor("QAR 99.9"), 9990);
    assert.equal(money.parseQarToMinor("qr 5"), 500);
    assert.equal(money.parseQarToMinor("  0.05 "), 5);
    assert.equal(money.parseQarToMinor("0"), 0);
  });

  test("parseQarToMinor returns null for anything that is not an exact amount", () => {
    for (const bad of ["", " ", "-5", "+5", "1.234", "1,2,3", "1e3", "12abc", "NaN", "Infinity", ".5", "5.", "1,23", "QAR", "١٢٣", "9".repeat(14)]) {
      assert.equal(money.parseQarToMinor(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
    assert.equal(money.parseQarToMinor(undefined), null);
    assert.equal(money.parseQarToMinor(12), null);
  });

  test("a formatted amount parses back to the same minor units", () => {
    for (const minor of [0, 1, 99, 100, 101, 99999, 100000, 123456789]) {
      assert.equal(money.parseQarToMinor(money.formatQar(minor)), minor);
    }
  });

  test("sumMinor is exact and refuses floats and overflow", () => {
    assert.equal(money.sumMinor([350000, 50000, -1000]), 399000);
    assert.equal(money.sumMinor([]), 0);
    assert.throws(() => money.sumMinor([0.1, 0.2]), RangeError);
    assert.throws(() => money.sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
  });

  test("isMinorUnits accepts safe integers only", () => {
    assert.ok(money.isMinorUnits(0) && money.isMinorUnits(-7) && money.isMinorUnits(Number.MAX_SAFE_INTEGER));
    for (const bad of [1.2, "5", null, undefined, Number.NaN, 2 ** 60]) assert.ok(!money.isMinorUnits(bad));
  });
});

describe("environment contract for Supabase", { skip }, () => {
  test("the variable names are the documented ones, and only the anon key is public", () => {
    assert.deepEqual([...env.PUBLIC_ENV_NAMES], ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    assert.deepEqual([...env.SERVER_ENV_NAMES], ["SUPABASE_SERVICE_ROLE_KEY"]);
    for (const name of env.SERVER_ENV_NAMES) assert.ok(!name.startsWith("NEXT_PUBLIC_"), `${name} must never be public`);
  });

  test("with no variables set the site is simply not configured: no throw, names only", () => {
    assert.equal(env.isSupabaseConfigured({}), false);
    const result = env.readSupabasePublicConfig({});
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["NEXT_PUBLIC_SUPABASE_URL is not set", "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set"]);
    assert.equal(env.readSupabaseServerConfig({}).ok, false);
  });

  test("a valid public configuration is accepted and the URL is reduced to its origin", () => {
    const result = env.readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: `${GOOD_URL}/rest/v1/`, NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt("anon") });
    assert.equal(result.ok, true);
    assert.equal(result.config.url, GOOD_URL);
    assert.equal(env.isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: newPublishableKey() }), true);
  });

  test("the URL must be https, except for localhost, and must carry no credentials", () => {
    const anon = fakeJwt("anon");
    const bad = (url) => env.readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon });
    assert.equal(bad("http://project-ref.example.test").ok, false);
    assert.equal(bad("not a url").ok, false);
    assert.equal(bad("https://user:secret@project-ref.example.test").ok, false);
    assert.equal(bad("http://localhost:54321").ok, true);
    assert.equal(bad("http://127.0.0.1:54321").ok, true);
  });

  test("a privileged key in the public variable is refused, in both key formats", () => {
    for (const key of [fakeJwt("service_role"), newSecretKey()]) {
      const result = env.readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: key });
      assert.equal(result.ok, false);
      assert.match(result.problems.join(" "), /privileged key/);
    }
  });

  test("the server configuration needs a distinct service-role key", () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt("anon") };
    assert.equal(env.readSupabaseServerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: fakeJwt("service_role") }).ok, true);
    assert.equal(env.readSupabaseServerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: newSecretKey() }).ok, true);
    assert.equal(env.readSupabaseServerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: base.NEXT_PUBLIC_SUPABASE_ANON_KEY }).ok, false);
    // An opaque key of unknown format passes the role checks, so only the "must differ" rule can refuse it.
    const opaque = { ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: "opaque-key-of-unknown-format" };
    const same = env.readSupabaseServerConfig({ ...opaque, SUPABASE_SERVICE_ROLE_KEY: opaque.NEXT_PUBLIC_SUPABASE_ANON_KEY });
    assert.equal(same.ok, false);
    assert.match(same.problems.join(" "), /must not be the same key/);
    assert.equal(env.readSupabaseServerConfig({ ...opaque, SUPABASE_SERVICE_ROLE_KEY: "a-different-opaque-key" }).ok, true);
    assert.equal(env.readSupabaseServerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: fakeJwt("anon") }).ok, false);
    assert.equal(env.readSupabaseServerConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: newPublishableKey() }).ok, false);
    assert.equal(env.readSupabaseServerConfig({ ...base }).ok, false);
  });

  test("a problem report never contains a value, whichever rule rejected it", () => {
    const privileged = fakeJwt("service_role");
    const cases = [
      // each input reaches a different rule: credentials in the URL, a malformed URL, plain http, a privileged key
      { NEXT_PUBLIC_SUPABASE_URL: "https://user:pw-sentinel@host.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-sentinel-value" },
      { NEXT_PUBLIC_SUPABASE_URL: "not a url pw-sentinel", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-sentinel-value" },
      { NEXT_PUBLIC_SUPABASE_URL: "http://pw-sentinel.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon with space sentinel" },
      { NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: privileged },
    ];
    for (const input of cases) {
      const result = env.readSupabasePublicConfig(input);
      assert.equal(result.ok, false);
      const text = JSON.stringify(result);
      for (const value of Object.values(input)) assert.ok(!text.includes(value), `a problem repeated ${value.slice(0, 20)}`);
      assert.ok(!text.includes("pw-sentinel") && !text.includes("sentinel-value") && !text.includes("host.example.test"));
    }
    const server = env.readSupabaseServerConfig({ NEXT_PUBLIC_SUPABASE_URL: GOOD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "opaque-anon-sentinel", SUPABASE_SERVICE_ROLE_KEY: "service sentinel with spaces" });
    assert.equal(server.ok, false);
    assert.ok(!JSON.stringify(server).includes("sentinel"));
  });

  test("the server reader refuses to run in a browser", () => {
    globalThis.window = {};
    try {
      assert.throws(() => env.readSupabaseServerConfig({}), /never run in a browser/);
    } finally {
      delete globalThis.window;
    }
  });
});
