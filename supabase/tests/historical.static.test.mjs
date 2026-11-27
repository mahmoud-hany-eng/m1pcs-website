// STATIC CHECKS FOR THE HISTORICAL ORDERS IMPORT: what the source files must and must not contain, with no server and no database.
//   * the import is owner-only wherever it is reachable: every page, action, route and navigation entry asks for import.manage, and nothing a customer
//     can reach mentions the import's private tables, functions, provenance or the export's links;
//   * the importer never fetches a link, sends a message, creates a sign-in account or opens another service: the code that reads the export has no
//     network, email or auth-admin call in it;
//   * the gateway statements are the fixed, bound, write-classified calls the design says;
//   * a form sends only what the owner typed and the figures the owner SAW, never an identity, a permission, a total, a balance, a status or the points;
//   * the browser bundle gets only plain data: no form reader (it uses Node's crypto), no server module;
//   * no real data: the one fixture is synthetic, on a reserved host, and the real export's links and names appear nowhere.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const walk = (dir, keep) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, keep));
    else if (keep(rel)) out.push(relative(".", rel));
  }
  return out.sort();
};
const sourceFiles = () => walk("src", (p) => /\.(ts|tsx|js|jsx|mjs)$/.test(p));
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const IMPORT_FILES = () => [...walk("src/lib/staff/historical", () => true), "src/components/admin/historical-forms.tsx", "src/components/admin/historical-review.tsx", ...walk("src/app/admin/import", () => true)];

describe("the import is owner-only wherever it can be reached", () => {
  it("every page asks for the owner's permission before it asks the database for anything", () => {
    for (const p of ["src/app/admin/import/page.tsx", "src/app/admin/import/[id]/page.tsx"]) {
      const code = strip(read(p));
      assert.match(code, /await requireStaff\(/, `${p} must call requireStaff`);
      const gate = code.indexOf('can("import.manage")');
      assert.ok(gate > 0, `${p} must check import.manage`);
      const firstCall = code.search(/\bapi\.hist/);
      assert.ok(firstCall > gate, `${p}: the permission is checked before the first database call`);
      assert.doesNotMatch(code, /staffCall/, `${p} must not reach the gateway directly`);
    }
  });

  it("every server action goes through run(), which asks requireStaff and then import.manage; nothing is exported but async functions", () => {
    const code = strip(read("src/lib/staff/historical/actions.ts"));
    assert.match(code, /^\s*["']use server["']/);
    assert.match(code, /import\s+["']server-only["']/);
    assert.match(code, /const PERMISSION = "import\.manage"/);
    assert.match(code, /await requireStaff\(nextPath\)[\s\S]*?ctx\.can\(PERMISSION\)/);
    const exported = [...code.matchAll(/^export\s+(?!async function)(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(exported, [], `only async functions may be exported from a "use server" file (found ${exported.join(", ")})`);
    const actions = [...code.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    assert.ok(actions.length >= 14, `expected the import actions, found ${actions.length}`);
    for (const name of actions) {
      const body = code.slice(code.indexOf(`export async function ${name}(`));
      const end = body.indexOf("\nexport async function ", 10);
      const fn = end === -1 ? body : body.slice(0, end);
      assert.match(fn, /return run\(/, `${name} must authenticate through run()`);
    }
  });

  it("the order-description action runs for the owner too (it changes an order's lines, which only the import's owner may do)", () => {
    const code = strip(read("src/lib/staff/historical/actions.ts"));
    const start = code.indexOf("export async function setOrderItemsAction");
    assert.ok(start > 0);
    assert.match(code.slice(start, start + 400), /return run\(/);
  });

  it("the file route answers only GET, only to import.manage, only with the type the content proved, never cached and never guessed", () => {
    const code = strip(read("src/app/admin/import/files/[id]/route.ts"));
    assert.deepEqual([...code.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]), ["GET"]);
    assert.match(code, /permissions\.has\("import\.manage"\)/);
    assert.match(code, /isUuid\(id\)/);
    assert.match(code, /"Cache-Control": "private, no-store"/);
    assert.match(code, /"X-Content-Type-Options": "nosniff"/);
    assert.match(code, /ALLOWED_TYPES = new Set\(\["application\/pdf", "image\/png"\]\)/);
    assert.match(code, /"Content-Type": file\.mime/);
    assert.doesNotMatch(code, /searchParams\.get\("(type|mime|content)/, "the type is never taken from the request");
  });

  it("the navigation entry and the dashboard buttons appear only for the permission", () => {
    assert.match(read("src/components/admin/AdminShell.tsx"), /key: "import", href: "\/admin\/import", label: "Import orders", permission: "import\.manage"/);
    for (const p of ["src/app/admin/page.tsx", "src/app/admin/orders/page.tsx"]) assert.match(read(p), /can\("import\.manage"\) \? <LinkButton href="\/admin\/import">Import historical orders<\/LinkButton> : null/, p);
  });

  it("nothing customer-facing, public or shared names the import's private tables, functions, provenance, attestations or the export's links", () => {
    const PRIVATE = /historical_import_|historical_orders|historical_customers|historical_item_revisions|hist_[a-z_]+\(|import\.manage|source_ref|source_host|source_fingerprint|attestation|airtable|\bfingerprint\b/i;
    const files = sourceFiles().filter((p) => !p.startsWith("src/lib/staff/") && !p.startsWith("src/app/admin/") && !p.startsWith("src/components/admin/"));
    assert.ok(files.length > 80);
    for (const p of files) assert.doesNotMatch(strip(read(p)), PRIVATE, `${p} must not reference the import's private data`);
  });

  it("no customer-facing file mentions a cost, a profit or a supplier in connection with a historical order (the customer sees the date, the amount and 'Historical WhatsApp order' only)", () => {
    for (const p of ["src/app/account/orders/[ref]/page.tsx", "src/components/account/dashboard.tsx", "src/lib/accounts/shared/view-models.ts"]) {
      assert.doesNotMatch(strip(read(p)), /profit|supplier|margin|\bcost(s|_)|invoice/i, p);
    }
    assert.match(read("src/lib/accounts/shared/view-models.ts"), /\^\[OH\]-\[0-9\]\{4\}-\[0-9\]\{5\}\$/, "a historical order's reference (H-YYMM-NNNNN) opens its page");
  });

  it("the staff pages that show an order's date use the one helper, so a historical order is never said to be 'placed' on the day it was imported", () => {
    for (const p of ["src/app/admin/page.tsx", "src/app/admin/customers/[id]/page.tsx", "src/components/admin/finance.tsx"]) assert.match(read(p), /orderDateParts\(/, p);
    assert.match(read("src/app/admin/orders/page.tsx"), /r\.origin === "historical_import"[\s\S]{0,400}Completed \{formatDay\(r\.order_date \?\? r\.created_at\)\}/);
    assert.match(read("src/app/admin/orders/[id]/page.tsx"), /historical && origin\.ok \? `\$\{order\.customer\.full_name\} · completed/);
  });
});

describe("the importer reads a file and nothing else: no network, no email, no account, no other service", () => {
  it("the code that reads and checks the export opens no connection, sends nothing and creates no account", () => {
    const FORBIDDEN = /\bfetch\(|XMLHttpRequest|WebSocket|node:(http|https|net|tls|dgram|child_process|fs)|\bnodemailer\b|\bsendMail\b|\bresend\b|\bpostmark\b|\bsendgrid\b|\bmailgun\b|auth\.admin|createUser\b|inviteUserByEmail|signUp\(|signInWith|\bsmtp\b|\bwebhook\b/i;
    for (const p of IMPORT_FILES().filter((f) => /\.(ts|tsx)$/.test(f))) assert.doesNotMatch(strip(read(p)), FORBIDDEN, `${p}: the import must not reach another service`);
  });

  it("the only Node module the importer's own code imports is node:crypto, for hashing (the identity of a purchase and a file's digest)", () => {
    const seen = new Set();
    for (const p of IMPORT_FILES().filter((f) => /\.(ts|tsx)$/.test(f))) for (const [, mod] of strip(read(p)).matchAll(/from\s+["'](node:[a-z/]+)["']/g)) seen.add(mod);
    assert.deepEqual([...seen].sort(), ["node:crypto"]);
  });

  it("an attachment link from the export is only ever recorded: no file in the import reads one, opens one or links to one", () => {
    // the promise is written in the code's own comments, so this reads the raw text
    assert.match(read("src/lib/staff/historical/normalize.ts"), /recorded, never|never fetched|does not fetch anything/i);
    const review = strip(read("src/components/admin/historical-review.tsx"));
    assert.doesNotMatch(review, /\.source_ref\b|href=\{[^}]*source/, "the export's link is never drawn or followed (it is only carried as null where a type needs the field)");
  });

  it("no migration or function of the import sends anything or reaches outside the database", () => {
    for (const f of ["supabase/migrations/20261128120000_historical_import_schema.sql", "supabase/migrations/20261128120100_historical_import_functions.sql"]) {
      const sql = strip(read(f)).replace(/--.*$/gm, "");
      assert.doesNotMatch(sql, /\b(http_|pg_net|dblink|copy\s+[^;]*\bprogram\b|lo_import|lo_export|pg_read_file|create\s+extension|auth\.users|net\.http)/i, f);
      assert.doesNotMatch(sql, /insert\s+into\s+auth\./i, `${f}: no sign-in account is created`);
    }
  });
});

describe("the gateway statements are fixed, bound, and classified as writes", () => {
  const gateway = read("src/lib/staff/gateway.ts");
  const names = [...gateway.matchAll(/^\s*(hist_[a-z_]+|order_origin): "(.+)",$/gm)];
  const calls = Object.fromEntries(names.map((m) => [m[1], m[2]]));

  it("the nineteen import statements exist, each a single call of its admin function with bound parameters only", () => {
    assert.equal(Object.keys(calls).length, 19);
    for (const [name, sql] of Object.entries(calls)) {
      const fn = name === "order_origin" ? "order_origin" : name;
      assert.match(sql, new RegExp(`^select admin\\.${fn}\\(`), name);
      assert.doesNotMatch(sql, /\$\{|'\s*\+|\|\|/, `${name}: no text is built into a statement`);
      const params = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      assert.deepEqual([...new Set(params)].sort((a, b) => a - b), params.length ? Array.from({ length: Math.max(...params) }, (_, i) => i + 1) : [], `${name}: parameters are numbered from 1 without a gap`);
    }
  });

  it("every one that changes data, or that brings a staged batch up to date when read, is a WRITE call (so a failure says 'nothing was changed' only when that is true); order_origin and the reads are not", () => {
    const writes = gateway.slice(gateway.indexOf("const WRITE_CALLS"), gateway.indexOf("const KEYED_CALLS"));
    for (const name of Object.keys(calls)) {
      const isRead = ["hist_list_batches", "hist_get_attachment", "hist_order_info", "order_origin"].includes(name);
      assert.equal(writes.includes(`"${name}"`), !isRead, `${name} ${isRead ? "is a read" : "is a write"}`);
    }
    const keyed = gateway.slice(gateway.indexOf("const KEYED_CALLS"), gateway.indexOf("export const isWriteCall"));
    for (const name of Object.keys(calls)) assert.ok(!keyed.includes(`"${name}"`), `${name} carries no idempotency key: the database makes each of them safe to repeat`);
  });

  it("the file travels as a bound bytea parameter, never as text in a statement", () => {
    for (const name of ["hist_store_attachment", "hist_add_attachment"]) assert.match(calls[name], /\$\d::bytea/, name);
  });

  it("the typed API takes a typed payload and sends it as ONE bound JSON parameter", () => {
    const api = read("src/lib/staff/api.ts");
    assert.match(api, /histStageBatch: \(payload: StagePayload\) => call<StagedBatch>\("hist_stage_batch", \[JSON\.stringify\(payload\)\]\)/);
    assert.match(api, /histCommitBatch: \(batchId: string, confirmation: CommitConfirmation, dryRun: boolean\) =>\s*call<ImportReport>\("hist_commit_batch", \[batchId, JSON\.stringify\(confirmation\), dryRun\]\)/);
  });
});

describe("a form sends what the owner typed and the figures the owner saw, never an identity, a permission, a total, a balance, a status or the points", () => {
  it("no action or reader takes a forbidden field from a form", () => {
    const code = strip(read("src/lib/staff/historical/actions.ts")) + strip(read("src/lib/staff/historical/forms.ts"));
    for (const name of ["user_id", "staff_id", "role", "is_staff", "permission", "total_minor", "balance", "order_ref", "customer_code", "amount_paid", "points", "status", "origin", "completed_at", "order_date", "fingerprint", "imported_by", "attested_by", "classification_override"]) {
      assert.doesNotMatch(code, new RegExp(`(get|field|text|idField|isChecked)\\([^)]*["']${name}["']`), `a form must not supply ${name}`);
    }
  });

  it("the row number of a correction is never taken from the form (the database sets it)", () => {
    assert.doesNotMatch(strip(read("src/lib/staff/historical/actions.ts")), /get\("row_number"\)/);
  });

  it("the commit form's four 'expected' figures are the only numbers it sends, and the commit refuses unless the database finds them unchanged", () => {
    const form = strip(read("src/lib/staff/historical/forms.ts"));
    assert.match(form, /expected_orders[\s\S]*expected_revenue_minor[\s\S]*expected_cost_minor[\s\S]*expected_points/);
    const sql = read("supabase/migrations/20261128120100_historical_import_functions.sql");
    assert.match(sql, /the import is no longer what you reviewed/);
  });
});

describe("the browser gets only plain data and the server keeps its own code", () => {
  it("a client component imports only the import's actions, its choices and its types (type-only), the form kit and the shared formatters", () => {
    const code = strip(read("src/components/admin/historical-forms.tsx"));
    assert.match(code, /^\s*["']use client["']/);
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const mod of imports) assert.match(mod, /^(react|\.\/forms|@\/lib\/platform\/money|@\/lib\/staff\/(historical\/(actions|choices|types)|form-state|receipts|format))$/, `unexpected import in a client component: ${mod}`);
    assert.doesNotMatch(code, /from\s+["']@\/lib\/staff\/historical\/(forms|parse|payload|normalize|csv|attachments)["']/, "the form readers use Node's crypto and never reach the browser");
  });

  it("the plain-data modules import nothing at run time (types are erased), so they are safe in a bundle", () => {
    const choices = strip(read("src/lib/staff/historical/choices.ts"));
    assert.deepEqual([...choices.matchAll(/^import\s+(?!type)[^;]+;/gm)], []);
  });

  it("the server-only modules say so", () => {
    for (const p of ["src/lib/staff/historical/actions.ts"]) assert.match(read(p), /import\s+["']server-only["']/, p);
  });

  it("the review screens are server components (no client directive, no hook, no browser API)", () => {
    const review = strip(read("src/components/admin/historical-review.tsx"));
    assert.doesNotMatch(review, /^\s*["']use client["']/);
    assert.doesNotMatch(review, /\buse(State|Effect|Ref|ActionState|Transition)\b|window\.|document\./);
  });

  it("nothing writes raw HTML into a page", () => {
    for (const p of IMPORT_FILES().filter((f) => /\.tsx$/.test(f))) assert.doesNotMatch(read(p), /dangerouslySetInnerHTML/, p);
  });
});

describe("no real data is in the repository", () => {
  const FIXTURES = "supabase/tests/fixtures/historical";

  it("the one fixture is the synthetic export on a reserved host, with the designed shape, and the real export's links appear nowhere", () => {
    const names = readdirSync(join(ROOT, FIXTURES));
    assert.deepEqual(names, ["synthetic-historical-orders.csv"]);
    const text = read(`${FIXTURES}/${names[0]}`);
    assert.equal(text.trim().split("\n").length, 37, "header + 36 data rows");
    assert.doesNotMatch(text, /airtable|dl\.airtable|attachments\.airtableusercontent/i);
    for (const [, host] of text.matchAll(/https?:\/\/([^/\s)"]+)/g)) assert.equal(host, "attachments.example.test");
    for (const [, phone] of text.matchAll(/(\+?974[\s-]?\d[\d\s-]{6,})/g)) assert.match(phone.replace(/[\s-]/g, ""), /^\+?974555\d{5}$/, `${phone}: only the synthetic test range`);
  });

  it("no file in the repository holds a real export link: no signed or long Airtable address anywhere, and the only mentions are the host check, a comment, one synthetic unit-test link and a page test that asserts no link is drawn", () => {
    const signed = [];
    const mentions = [];
    for (const dir of ["src", "supabase", "docs", "ops"]) {
      if (!existsSync(join(ROOT, dir))) continue;
      for (const p of walk(dir, (f) => /\.(ts|tsx|mjs|js|json|sql|md|csv|txt)$/.test(f))) {
        if (p.endsWith("historical.static.test.mjs")) continue;
        const text = read(p);
        if (/airtable/i.test(text)) mentions.push(p);
        if (/X-Amz-(Signature|Credential|Security-Token)=|airtable(usercontent)?\.com\/[^\s"')]{40,}/i.test(text)) signed.push(p);
      }
    }
    assert.deepEqual(signed, [], "a signed or long export link must never be committed");
    assert.deepEqual(mentions.filter((p) => !p.startsWith("docs/")), ["src/lib/staff/historical/normalize.ts", "src/lib/staff/historical/parse.ts", "supabase/tests/historical-lib.test.mjs", "supabase/tests/historical.pages.db.test.mjs"]);
  });

  it("the test fixtures are not shipped to a customer: they live under supabase/tests, outside src and public", () => {
    assert.ok(!existsSync(join(ROOT, "public/historical")));
    assert.ok(!sourceFiles().some((p) => p.includes("fixtures/historical")));
  });
});

describe("the migrations are the additive, closed shape the design says", () => {
  const schema = read("supabase/migrations/20261128120000_historical_import_schema.sql");
  const fns = read("supabase/migrations/20261128120100_historical_import_functions.sql");

  it("every new table is private, has row level security and no API-role privilege, and is writable only through the owner's functions", () => {
    const created = [...schema.matchAll(/create table if not exists (\w+)\.(\w+)/gi)].map((m) => `${m[1]}.${m[2]}`);
    assert.equal(created.length, 8);
    for (const t of created) {
      assert.match(t, /^private\./, `${t} is private`);
      assert.match(schema, new RegExp(`alter table ${t.replace(".", "\\.")} enable row level security`), `${t}: row level security`);
    }
    assert.match(schema, /revoke all on table private\.%I from anon, authenticated, service_role/);
    assert.match(schema, /execute function private\.require_write_ctx\(\)/);
  });

  it("the only changes to existing tables are two plain columns on orders (with their checks), a widened basis list, two refusal triggers and a restated guard", () => {
    const alters = [...schema.matchAll(/^alter table ([a-z_.]+)\s+(add|drop)/gim)].map((m) => `${m[1]} ${m[2].toLowerCase()}`);
    assert.deepEqual([...new Set(alters)].sort(), ["public.orders add", "public.orders drop"]);
    assert.match(schema, /alter table private\.order_completions drop constraint if exists order_completions_basis_check/, "the basis list is widened by replacing its one check");
    assert.match(schema, /add column if not exists origin text not null default 'platform'/);
    assert.match(schema, /generated always as \(case when origin = 'historical_import' then completed_at else created_at end\) stored/);
  });

  it("every function the import adds is security definer with a pinned search path, closed to anon and service_role, and checks import.manage first", () => {
    const defs = [...fns.matchAll(/create or replace function (admin\.\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\bas\s+\$\$/gi)];
    const adminOnes = defs.filter((d) => /^admin\.(hist_|order_origin)/.test(d[1]));
    assert.equal(adminOnes.length, 19);
    for (const d of adminOnes) {
      assert.match(d[0], /security definer/i, d[1]);
      assert.match(d[0], /set search_path = ''/i, d[1]);
    }
    assert.match(fns, /revoke all on function %s from public, anon, service_role/);
  });

  it("the commit is one transaction with a dry-run branch that undoes everything, and the dry-run signal is caught inside the function", () => {
    assert.match(fns, /raise exception 'dry run' using errcode = 'M1D01'/);
    assert.match(fns, /exception when sqlstate 'M1D01' then/);
  });

  it("each order gets at most one award by the ledger's own rule, and the award is made in the same transaction as the order", () => {
    assert.match(fns, /insert into public\.loyalty_ledger \(customer_id, order_id, entry_type, points, description\)/);
    assert.match(fns, /floor|\/ b\.qar_per_point_minor/);
  });
});
