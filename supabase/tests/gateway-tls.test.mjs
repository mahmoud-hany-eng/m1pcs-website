// Tests for the staff gateway's verified TLS (src/lib/staff/gateway-tls.ts). Run with: npm run gateway:tls:test
//
// WHAT THESE TESTS ARE, AND ARE NOT.
//   * "configuration" and "source" groups: pure checks on what the module hands to the driver, and on the source text.
//   * "local handshakes" group: REAL TLS handshakes with the repository's own `pg` driver against a throwaway server on
//     127.0.0.1 that uses a PRIVATE test certificate authority created by `openssl` at run time (nothing is committed:
//     no key, no certificate). They prove the enforcement logic. They do NOT contact Supabase and say NOTHING about the
//     hosted transaction pooler's certificate chain; that is checked separately by the owner (STAFF_GATEWAY.md, section 7).
// The server speaks just enough of the PostgreSQL protocol to answer the SSL request; after a successful handshake it
// answers the start-up message with a marker error, which is how a test knows the TLS channel was really established.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import pg from "pg";

register("./support/alias-loader.mjs", import.meta.url);
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// The fingerprint of the Supabase root certificate, pinned a second time here so that editing the PEM in
// src/lib/staff/supabase-root-ca.ts without a deliberate, reviewed change to this line fails the test.
const PINNED_SHA256 = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

let tlsLib = null;
let rootCa = null;
let skip = false;
try {
  tlsLib = await import("../../src/lib/staff/gateway-tls.ts");
  rootCa = await import("../../src/lib/staff/supabase-root-ca.ts");
} catch (error) {
  // CI (M1_REQUIRE_PG=1) must FAIL on any import error: a real defect in the website code must never turn into a green skip.
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { gatewayConnection, enforcedTlsConnection, GatewayConfigError } = tlsLib ?? {};

/** A URL built piece by piece so no literal "user:password@host" string sits in the repository. */
function dbUrl(host, { port = 6543, query = "" } = {}) {
  const u = new URL(`postgresql://${host}:${port}/postgres${query}`);
  u.username = "m1_staff_gateway.projectref";
  u.password = randomUUID().replaceAll("-", "");
  return u.toString();
}
const pooler = "aws-0-ap-south-1.pooler.supabase.com";

describe("verified TLS: configuration (no network)", { skip }, () => {
  test("the pinned CA is the Supabase root (fingerprint pinned twice, CA flag, self-signed, not expired)", () => {
    const cert = new X509Certificate(rootCa.SUPABASE_ROOT_CA_PEM);
    assert.equal(cert.fingerprint256, PINNED_SHA256);
    assert.equal(rootCa.SUPABASE_ROOT_CA_SHA256, PINNED_SHA256);
    assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
    assert.equal(cert.subject, cert.issuer, "a root is self-signed");
    assert.equal(cert.ca, true);
    assert.ok(new Date(cert.validTo) > new Date(), "the pinned Supabase root CA has expired: replace it (see supabase-root-ca.ts)");
    assert.equal((rootCa.SUPABASE_ROOT_CA_PEM.match(/BEGIN CERTIFICATE/g) ?? []).length, 1, "exactly one certificate is pinned");
    assert.doesNotMatch(rootCa.SUPABASE_ROOT_CA_PEM, /PRIVATE/);
  });

  test("a remote host always gets the pinned CA, verification on, the default host-name check, TLS 1.2 or newer", () => {
    const c = gatewayConnection(dbUrl(pooler));
    assert.deepEqual(Object.keys(c.ssl).sort(), ["ca", "minVersion", "rejectUnauthorized"], "nothing else may be set, in particular no checkServerIdentity");
    assert.equal(c.ssl.rejectUnauthorized, true);
    assert.equal(c.ssl.ca, rootCa.SUPABASE_ROOT_CA_PEM);
    assert.equal(c.ssl.minVersion, "TLSv1.2");
  });

  test("TLS parameters in the secret are removed, whatever their spelling, and nothing else is lost", () => {
    for (const q of ["?sslmode=no-verify", "?sslmode=require", "?sslmode=disable", "?sslmode=allow", "?sslmode=prefer", "?sslmode=verify-ca", "?ssl=false", "?ssl=0", "?ssl=true", "?SSLMODE=disable",
      "?sslrootcert=/tmp/x.crt&sslmode=verify-full", "?uselibpqcompat=true&sslmode=require", "?sslnegotiation=direct", "?sslcert=a&sslkey=b"]) {
      const c = gatewayConnection(dbUrl(pooler, { query: q }));
      assert.equal(c.ssl.rejectUnauthorized, true, q);
      assert.doesNotMatch(c.connectionString, /ssl/i, q);
      const u = new URL(c.connectionString);
      assert.equal(u.hostname, pooler);
      assert.equal(u.port, "6543");
      assert.equal(u.username, "m1_staff_gateway.projectref");
      assert.equal(u.pathname, "/postgres");
    }
    assert.match(gatewayConnection(dbUrl(pooler, { query: "?sslmode=require&application_name=x" })).connectionString, /application_name=x/);
  });

  test("a parameter that re-routes the connection is refused (it could point a loopback URL at a remote server)", () => {
    for (const host of ["127.0.0.1", "localhost", pooler]) {
      for (const q of ["?host=evil.example", "?hostaddr=10.0.0.1", "?service=x", "?HOST=evil.example"]) {
        assert.throws(() => gatewayConnection(dbUrl(host, { query: q })), (e) => e instanceof GatewayConfigError && e.problem === "host_override", `${host} ${q}`);
      }
    }
  });

  test("the local development stack (loopback) is not forced onto TLS", () => {
    for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "[::1]"]) {
      const c = gatewayConnection(dbUrl(host, { port: 54322 }));
      assert.equal(c.ssl, undefined, host);
      assert.equal(new URL(c.connectionString).port, "54322");
    }
  });

  test("a host that only looks like loopback is NOT exempt", () => {
    for (const host of ["localhost.evil.example", "127.0.0.1.evil.example", "evil.example", "127.1", "0.0.0.0", "[::ffff:7f00:1]", "%6C%6F%63%61%6C%68%6F%73%74"]) {
      assert.ok(gatewayConnection(dbUrl(host)).ssl, host);
    }
  });

  test("an unusable value is refused with a fixed code and never echoes the value", () => {
    const withToken = new URL("https://example.test/db");
    withToken.username = "u";
    withToken.password = "secret-token";
    const cases = [["", "not_a_url"], ["not a url", "not_a_url"], ["/var/run/postgresql", "not_a_url"], ["localhost/db", "not_a_url"], ["mysql://example.test/db", "unsupported_scheme"], [withToken.toString(), "unsupported_scheme"], ["postgresql:///db", "missing_host"]];
    for (const [raw, problem] of cases) {
      assert.throws(() => gatewayConnection(raw), (e) => e instanceof GatewayConfigError && e.problem === problem && !/secret-token|not a url|mysql|postgresql|\/var\/run/.test(e.message), JSON.stringify(raw));
    }
  });
});

describe("verified TLS: the source cannot weaken it", { skip }, () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  test("only gateway-tls.ts decides TLS: gateway.ts builds its pool from gatewayConnection and sets no TLS option itself", () => {
    const gateway = strip(read("src/lib/staff/gateway.ts"));
    assert.match(gateway, /import \{ gatewayConnection, GatewayConfigError \} from "\.\/gateway-tls";/);
    assert.match(gateway, /gatewayConnection\(connectionString\)/);
    assert.match(gateway, /new Pool\(\{\s*\.\.\.connection,/);
    assert.doesNotMatch(gateway, /\bssl\b|rejectUnauthorized|enforcedTlsConnection|sslmode|NODE_TLS/i);
    assert.doesNotMatch(gateway, /STAFF_GATEWAY_DATABASE_URL[^;]*\+/, "the secret is not concatenated or edited here");
  });
  test("gateway-tls.ts never relaxes verification, never replaces the host-name check, never reads the environment", () => {
    const code = strip(read("src/lib/staff/gateway-tls.ts"));
    assert.doesNotMatch(code, /rejectUnauthorized:\s*false|checkServerIdentity|NODE_TLS_REJECT_UNAUTHORIZED|process\.env|secureOptions|ciphers|servername/);
    assert.match(code, /rejectUnauthorized:\s*true/);
  });
  test("nothing but gateway.ts and the tests imports the TLS module, and nothing outside src/lib/staff holds the CA", () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of existsSync(join(ROOT, dir)) ? readdirSyncSafe(dir) : []) {
        const p = `${dir}/${name}`;
        if (/node_modules|\.next|\.git$/.test(p)) continue;
        if (isDir(p)) walk(p);
        else if (/\.(ts|tsx|mjs|js)$/.test(p) && /gateway-tls|supabase-root-ca/.test(read(p))) hits.push(p);
      }
    };
    walk("src");
    assert.deepEqual(hits.sort(), ["src/lib/staff/gateway-tls.ts", "src/lib/staff/gateway.ts", "src/lib/staff/supabase-root-ca.ts"]);
  });
});
const readdirSyncSafe = (d) => readdirSync(join(ROOT, d));
const isDir = (p) => statSync(join(ROOT, p)).isDirectory();

// ------------------------------------------------------------------------------------------------------------------
// Local handshakes. A throwaway PostgreSQL-protocol server and a private certificate authority made by openssl.
// ------------------------------------------------------------------------------------------------------------------
let opensslMissing = null;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  opensslMissing = "the openssl command is not installed; the local handshake tests need it";
}

describe("verified TLS: local handshakes against a PRIVATE test CA on 127.0.0.1 (not the hosted pooler)", { skip: skip || opensslMissing || false }, () => {
  let dir;
  const files = {};
  const sh = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });

  function makeCa(name) {
    sh("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.crt`, "-days", "2", "-subj", `/CN=Test CA ${name}`,
      "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  }
  function makeLeaf(name, ca, san, { dates } = {}) {
    writeFileSync(join(dir, `${name}.ext`), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
    sh("req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", "/CN=test-server");
    if (!dates) {
      sh("x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-CAcreateserial", "-out", `${name}.crt`, "-days", "2", "-extfile", `${name}.ext`);
    } else {
      // A certificate that is already expired needs `openssl ca`, which can set both dates.
      writeFileSync(join(dir, "index.txt"), "");
      writeFileSync(join(dir, "serial"), "0A\n");
      writeFileSync(join(dir, "ca.cnf"), `[ca]\ndefault_ca=c\n[c]\ndatabase=${join(dir, "index.txt")}\nnew_certs_dir=${dir}\nserial=${join(dir, "serial")}\ndefault_md=sha256\npolicy=p\nunique_subject=no\nx509_extensions=e\n[p]\ncommonName=supplied\n[e]\nsubjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
      sh("ca", "-batch", "-config", "ca.cnf", "-cert", `${ca}.crt`, "-keyfile", `${ca}.key`, "-in", `${name}.csr`, "-out", `${name}.crt`, "-startdate", "20200101000000Z", "-enddate", "20200102000000Z", "-notext");
    }
  }
  const pem = (name) => readFileSync(join(dir, name), "utf8");

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "m1-tls-test-"));
    makeCa("caA"); // the CA the gateway is told to trust in these tests (stands in for Supabase's root)
    makeCa("caB"); // an unrelated CA
    makeLeaf("good", "caA", "DNS:localhost");
    makeLeaf("otherCa", "caB", "DNS:localhost");
    makeLeaf("otherName", "caA", "DNS:db.other.example");
    makeLeaf("expired", "caA", "DNS:localhost", { dates: true });
    sh("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "selfsigned.key", "-out", "selfsigned.crt", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost");
    for (const n of ["caA", "caB"]) files[n] = pem(`${n}.crt`);
    for (const n of ["good", "otherCa", "otherName", "expired", "selfsigned"]) files[n] = { cert: pem(`${n}.crt`), key: pem(`${n}.key`) };
  });
  after(() => dir && rmSync(dir, { recursive: true, force: true }));

  /** mode "tls": answers the SSL request with S and speaks TLS; "refuse": answers N (a downgrade attempt); "plain": no SSL request is expected. */
  function startServer(mode, material) {
    const seen = { sslRequest: false, bytesAfterHandshake: 0, bytesAfterRefusal: 0, plainStartup: false };
    const sockets = new Set();
    const marker = (text) => {
      const field = (code, value) => Buffer.concat([Buffer.from(code), Buffer.from(`${value}\0`)]);
      const body = Buffer.concat([field("S", "FATAL"), field("V", "FATAL"), field("C", "28000"), field("M", text), Buffer.from("\0")]);
      const head = Buffer.alloc(5);
      head.write("E", 0);
      head.writeInt32BE(body.length + 4, 1);
      return Buffer.concat([head, body]);
    };
    const server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("error", () => {});
      sock.on("close", () => sockets.delete(sock));
      sock.once("data", (first) => {
        const isSslRequest = first.length === 8 && first.readUInt32BE(4) === 80877103;
        seen.sslRequest = isSslRequest;
        if (mode === "plain") {
          seen.plainStartup = !isSslRequest;
          sock.end(marker("reached-plain-server"));
          return;
        }
        if (mode === "refuse") {
          sock.write("N");
          sock.on("data", (d) => (seen.bytesAfterRefusal += d.length));
          return;
        }
        sock.write("S");
        const secure = new tls.TLSSocket(sock, { isServer: true, key: material.key, cert: material.cert, minVersion: "TLSv1.2" });
        secure.on("error", () => {});
        secure.once("data", (d) => {
          seen.bytesAfterHandshake += d.length;
          secure.end(marker("reached-tls-server"));
        });
      });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, seen, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }) })));
  }

  async function connect(config) {
    const pool = new pg.Pool({ ...config, max: 1, connectionTimeoutMillis: 4000 });
    pool.on("error", () => {});
    try {
      await pool.query("select 1");
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error.code, message: String(error.message) };
    } finally {
      await pool.end().catch(() => {});
    }
  }
  const withServer = async (mode, material, fn) => {
    const s = await startServer(mode, material);
    try {
      return await fn(s);
    } finally {
      await s.close();
    }
  };
  const REACHED = /reached-tls-server/;
  const refusedBeforeAnyStartup = (r, s, why) => {
    assert.equal(r.ok, false, why);
    assert.doesNotMatch(r.message, REACHED, why);
    assert.equal(s.seen.bytesAfterHandshake, 0, `${why}: no start-up message (user name) may be sent over a channel that failed verification`);
    assert.equal(s.seen.bytesAfterRefusal, 0, `${why}: nothing may be sent after the server refused TLS`);
  };
  const host = "localhost";

  test("POSITIVE: the right CA and a matching host name connect, and the start-up message goes over TLS", async () => {
    await withServer("tls", files.good, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      assert.equal(r.ok, false, "the marker error is the expected outcome");
      assert.match(r.message, REACHED);
      assert.equal(r.code, "28000");
      assert.ok(s.seen.sslRequest);
      assert.ok(s.seen.bytesAfterHandshake > 0);
    });
  });

  test("INVALID CERTIFICATE: signed by a CA that is not the pinned one", async () => {
    await withServer("tls", files.otherCa, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "wrong CA");
      assert.match(`${r.code} ${r.message}`, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|unable to verify/i);
    });
  });
  test("INVALID CERTIFICATE: self-signed server certificate", async () => {
    await withServer("tls", files.selfsigned, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "self-signed");
      assert.match(`${r.code} ${r.message}`, /SELF_SIGNED|DEPTH_ZERO|unable to verify|self[- ]signed/i);
    });
  });
  test("INVALID CERTIFICATE: expired server certificate from the right CA", async () => {
    await withServer("tls", files.expired, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "expired");
      assert.match(`${r.code} ${r.message}`, /CERT_HAS_EXPIRED|expired/i);
    });
  });
  test("INVALID CERTIFICATE: without the pinned CA a private CA is not trusted (it is not in Node's built-in store)", async () => {
    await withServer("tls", files.good, async (s) => {
      const r = await connect({ connectionString: dbUrl(host, { port: s.port }), ssl: { rejectUnauthorized: true } });
      refusedBeforeAnyStartup(r, s, "no pinned CA");
    });
  });

  test("HOST NAME MISMATCH: valid chain, certificate issued for another name", async () => {
    await withServer("tls", files.otherName, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "name mismatch");
      assert.match(`${r.code} ${r.message}`, /ALTNAME_INVALID|does not match|Hostname/i);
    });
  });
  test("HOST NAME MISMATCH: connecting by an address the certificate does not list", async () => {
    await withServer("tls", files.good, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl("127.0.0.1", { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "ip not in certificate");
      assert.match(`${r.code} ${r.message}`, /ALTNAME_INVALID|does not match|Hostname|IP/i);
    });
  });

  test("DOWNGRADE: the server refuses TLS (answers N): the client gives up and sends nothing more", async () => {
    await withServer("refuse", null, async (s) => {
      const r = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA));
      refusedBeforeAnyStartup(r, s, "server said N");
      assert.match(r.message, /does not support SSL/i);
      assert.ok(s.seen.sslRequest);
    });
  });
  test("DOWNGRADE: TLS parameters in the URL cannot turn verification or TLS off (checked against a wrong-CA server and a refusing server)", async () => {
    for (const q of ["?sslmode=disable", "?sslmode=no-verify", "?sslmode=prefer", "?sslmode=allow", "?sslmode=require", "?ssl=false", "?ssl=0", "?uselibpqcompat=true&sslmode=require"]) {
      await withServer("tls", files.otherCa, async (s) => {
        refusedBeforeAnyStartup(await connect(enforcedTlsConnection(dbUrl(host, { port: s.port, query: q }), files.caA)), s, `wrong CA with ${q}`);
      });
      await withServer("refuse", null, async (s) => {
        refusedBeforeAnyStartup(await connect(enforcedTlsConnection(dbUrl(host, { port: s.port, query: q }), files.caA)), s, `refusing server with ${q}`);
      });
    }
  });
  test("DOWNGRADE: the naive approach (ssl object next to a URL that carries sslmode) IS overridden by the driver, which is why the URL is stripped", async () => {
    await withServer("tls", files.good, async (s) => {
      const naive = await connect({ connectionString: dbUrl(host, { port: s.port, query: "?sslmode=verify-full" }), ssl: { ca: files.caA } });
      assert.equal(naive.ok, false);
      assert.doesNotMatch(naive.message, REACHED, "the driver let the URL replace the pinned CA: this is the hole the stripping closes");
      const fixed = await connect(enforcedTlsConnection(dbUrl(host, { port: s.port, query: "?sslmode=verify-full" }), files.caA));
      assert.match(fixed.message, REACHED);
    });
  });
  test("DOWNGRADE: the PGSSLMODE variable and NODE_TLS_REJECT_UNAUTHORIZED=0 cannot disable it", async () => {
    const saved = { PGSSLMODE: process.env.PGSSLMODE, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED };
    try {
      process.env.PGSSLMODE = "disable";
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      await withServer("tls", files.otherCa, async (s) => {
        refusedBeforeAnyStartup(await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA)), s, "wrong CA with the environment switches set");
      });
      await withServer("refuse", null, async (s) => {
        refusedBeforeAnyStartup(await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA)), s, "refusing server with PGSSLMODE=disable");
      });
      await withServer("tls", files.good, async (s) => {
        assert.match((await connect(enforcedTlsConnection(dbUrl(host, { port: s.port }), files.caA))).message, REACHED, "and it still connects when everything is right");
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("LOCAL DEVELOPMENT STACK: a loopback URL still connects without TLS, exactly as before", async () => {
    await withServer("plain", null, async (s) => {
      const r = await connect(gatewayConnection(dbUrl("127.0.0.1", { port: s.port })));
      assert.match(r.message, /reached-plain-server/);
      assert.ok(s.seen.plainStartup && !s.seen.sslRequest, "no SSL request: the local stack keeps its plain connection");
    });
  });
  test("a name that merely resolves to this machine is still enforced (the exemption is by literal name, not by where it points)", () => {
    assert.ok(gatewayConnection(dbUrl("localtest.me", { port: 6543 })).ssl);
  });
});
