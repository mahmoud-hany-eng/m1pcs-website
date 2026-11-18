// Static checks on the Supabase foundation. No database, no network: they read the files and fail on a pattern that
// must never be committed (a credential, a customer address, a wide API surface) or a convention that keeps the
// migrations safe to run on a real project. The behaviour of the SQL itself is tested in db.test.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = "supabase/tests/static.test.mjs";
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function walk(rel, keep = () => true) {
  const out = [];
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const child = `${rel}/${name}`;
    const full = join(ROOT, child);
    if (statSync(full).isDirectory()) out.push(...walk(child, keep));
    else if (keep(child)) out.push(child);
  }
  return out;
}

const migrations = walk("supabase/migrations", (p) => p.endsWith(".sql")).sort();
// Everything that holds the Supabase foundation, except this file (whose patterns would match themselves).
const scanned = [
  ...walk("supabase", (p) => p !== SELF && !p.endsWith(".png")),
  ...walk("src/lib/platform"),
  ".env.example",
  ...walk("docs/project-memory/architecture", (p) => /SUPABASE/i.test(p)),
  ...walk("docs/project-memory/runs/PLAT-0001"),
].filter((p) => existsSync(join(ROOT, p)));

describe("migrations are well formed", () => {
  it("there are migrations, named <14-digit timestamp>_<snake_case>.sql, in strictly increasing order", () => {
    assert.ok(migrations.length >= 10);
    const names = migrations.map((p) => p.split("/").pop());
    for (const name of names) assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/, name);
    const stamps = names.map((n) => n.slice(0, 14));
    assert.deepEqual(stamps, [...stamps].sort(), "migration timestamps must sort in file order");
    assert.equal(new Set(stamps).size, stamps.length, "duplicate migration timestamp");
  });

  it("no migration creates roles or extensions, drops anything, or deletes data", () => {
    for (const p of migrations) {
      const sql = read(p).replace(/--.*$/gm, "");
      assert.doesNotMatch(sql, /^\s*(create|alter)\s+role\b/im, `${p}: roles belong to the platform, not a migration`);
      assert.doesNotMatch(sql, /^\s*create\s+extension\b/im, `${p}: an extension is a deliberate, reviewed change`);
      assert.doesNotMatch(sql, /^\s*(drop\s+(table|schema|view|function)|truncate|delete\s+from)\b/im, `${p}: destructive statement`);
    }
  });

  it("the test-only shim is not a migration", () => {
    assert.ok(existsSync(join(ROOT, "supabase/tests/support/supabase_shim.sql")));
    assert.ok(!migrations.some((p) => /shim/i.test(p)));
    assert.ok(!migrations.some((p) => /auth\.users\s*\(/i.test(read(p)) && /create\s+table\s+auth\.users/i.test(read(p))), "a migration must not create auth.users");
  });

  it("every table in the public schema enables row level security in the migrations", () => {
    const all = migrations.map(read).join("\n");
    const created = [...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(public|private)\.([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`);
    assert.ok(created.length >= 25, `expected the full table set, found ${created.length}`);
    for (const table of created) {
      assert.match(all, new RegExp(`alter\\s+table\\s+${table.replace(".", "\\.")}\\s+enable\\s+row\\s+level\\s+security`, "i"), `${table} must enable row level security`);
    }
  });

  it("every SECURITY DEFINER function pins its search_path", () => {
    let seen = 0;
    for (const p of migrations) {
      for (const [header] of read(p).matchAll(/create\s+(?:or\s+replace\s+)?function[\s\S]*?\bas\s+\$\$/gi)) {
        if (!/security\s+definer/i.test(header)) continue;
        seen += 1;
        assert.match(header, /set\s+search_path\s*=\s*''/i, `${p}: a definer function without search_path = ''\n${header.slice(0, 160)}`);
      }
    }
    assert.ok(seen >= 20, `expected many definer functions, saw ${seen}`);
  });

  it("no function body trusts JWT metadata for authorization", () => {
    for (const p of migrations) {
      const sql = read(p).replace(/--.*$/gm, "");
      assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i, `${p}: user-editable metadata must never decide access`);
      assert.doesNotMatch(sql, /app_metadata/i, `${p}: authorization comes from the staff tables, not from claims`);
    }
  });
});

describe("nothing secret or personal is committed", () => {
  const patterns = [
    ["a JWT or Supabase key", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["a Supabase secret key", /sb_secret_[A-Za-z0-9_-]{8,}/],
    ["a Supabase access token", /sbp_[0-9a-f]{20,}/],
    ["a connection string with a password", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i],
    ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["an assigned service-role key", /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S/],
    ["an assigned database password", /(?:DB_PASSWORD|POSTGRES_PASSWORD)\s*=\s*\S/i],
  ];
  it("no file holds a credential", () => {
    assert.ok(scanned.length > 15, "the scan found too few files to be meaningful");
    for (const p of scanned) {
      const text = read(p);
      for (const [label, re] of patterns) assert.doesNotMatch(text, re, `${p}: looks like ${label}`);
    }
  });

  it("every email address is on a reserved example domain, and every phone number is a synthetic test number", () => {
    for (const p of scanned) {
      const text = read(p);
      for (const [email] of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        assert.match(email, /@(?:[a-z0-9-]+\.)*example\.(?:test|com)$/i, `${p}: ${email} is not a reserved example address`);
      }
      for (const [phone] of text.matchAll(/\+974\d{8}/g)) {
        assert.match(phone, /^\+9745555\d{4}$/, `${p}: ${phone} is not a synthetic number`);
      }
    }
  });

  it(".env.example lists names only: every assignment is empty, and the service key is never public", () => {
    const names = [];
    for (const line of read(".env.example").split("\n")) {
      const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      names.push(m[1]);
      assert.equal(m[2].trim(), "", `${m[1]} must have no value`);
    }
    assert.ok(names.includes("NEXT_PUBLIC_SUPABASE_URL") && names.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") && names.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert.ok(!names.some((n) => n.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET|PRIVATE/.test(n)), "a secret must not carry a public prefix");
  });

  it("the names in src/lib/platform/env.ts are documented in .env.example", () => {
    const code = read("src/lib/platform/env.ts");
    const documented = read(".env.example");
    for (const [, name] of code.matchAll(/"((?:NEXT_PUBLIC_)?SUPABASE_[A-Z_]+)"/g)) assert.ok(documented.includes(name), `${name} missing from .env.example`);
  });

  it("the repository ignores real environment files", () => {
    const ignore = read(".gitignore");
    assert.match(ignore, /^\.env\*\.local$/m);
    assert.match(ignore, /^\.env$/m);
    assert.match(read("supabase/.gitignore"), /^\.env$/m);
  });
});

describe("configuration exposes as little as possible", () => {
  it("config.toml exposes only the public schema through the API and holds no secret or remote reference", () => {
    const toml = read("supabase/config.toml").replace(/^\s*#.*$/gm, "");
    assert.match(toml, /^\s*schemas\s*=\s*\["public"\]\s*$/m, "only `public` may be exposed");
    assert.doesNotMatch(toml, /["']private["']|["']admin["']/, "private and admin must never be exposed");
    assert.match(toml, /^\s*project_id\s*=\s*"m1pcs-platform-local"\s*$/m);
    assert.doesNotMatch(toml, /\b(secret|password|api_key|token)\s*=\s*"(?!env\()/i, "a secret must come from env(...), never be written here");
    assert.match(toml, /enable_anonymous_sign_ins\s*=\s*false/);
  });
});

describe("customer-facing TypeScript carries no private concept", () => {
  it("the customer-facing interfaces never mention costs, margins, suppliers or internal fields", () => {
    const code = read("src/lib/platform/database.types.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const customerPart = code.slice(0, code.indexOf("export interface AdminOrderFinancials"));
    assert.ok(customerPart.length > 1000, "the marker for the staff-only shapes moved");
    for (const word of ["supplier", "cost", "margin", "internal", "staff_note", "admin_note", "password", "token"]) {
      assert.ok(!new RegExp(word, "i").test(customerPart), `customer-facing types mention "${word}"`);
    }
  });
});

describe("the public quotation flow does not depend on the platform", () => {
  it("no website file outside src/lib/platform imports the platform code or a Supabase client", () => {
    const files = walk("src", (p) => /\.(ts|tsx|js|jsx|mjs)$/.test(p) && !p.startsWith("src/lib/platform/"));
    assert.ok(files.length > 50, "the scan found too few website files");
    for (const p of files) {
      const text = read(p);
      assert.doesNotMatch(text, /lib\/platform/, `${p} must not import the platform code in Phase 1`);
      assert.doesNotMatch(text, /@supabase\//, `${p} must not import a Supabase package in Phase 1`);
    }
  });

  it("package.json adds no Supabase dependency and has the database test scripts", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      assert.ok(!Object.keys(pkg[section] ?? {}).some((n) => n.startsWith("@supabase/") || n === "supabase"), `${section} must not hold Supabase packages in Phase 1`);
    }
    assert.ok(pkg.scripts["db:test"] && pkg.scripts["db:test:static"]);
  });

  it("the quote form and the WhatsApp message builder do not mention the platform at all", () => {
    for (const p of ["src/components/forms/QuoteForm.tsx", "src/lib/whatsapp.ts", "src/lib/quote-schema.ts", "src/types/quote.ts"]) {
      assert.ok(existsSync(join(ROOT, p)), `${p} must still exist`);
      assert.doesNotMatch(read(p), /supabase|lib\/platform/i, p);
    }
  });
});

describe("supporting files exist", () => {
  it("the README and the real-Supabase checklist are present", () => {
    for (const p of ["supabase/README.md", "supabase/tests/REAL_SUPABASE_CHECKS.md", "supabase/tests/support/supabase_shim.sql"]) {
      assert.ok(existsSync(join(ROOT, p)), relative(ROOT, join(ROOT, p)));
    }
  });
});
