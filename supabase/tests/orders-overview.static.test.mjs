// STATIC CHECKS FOR THE SIMPLIFIED ORDERS PAGE AND ITS RECEIPTS: what the source files must and must not contain, with no server and no database.
//   * nothing admin-only about money (cost, profit, receipts) is referenced by any customer-facing or public file;
//   * the receipt route, the two server actions, the gateway statements and the upload limit are exactly what the design says (staff only, the right
//     permission, a bound file parameter, no cache, no type guessing, GET only);
//   * the new client files import only what a client file may, hold no secret and never write raw HTML;
//   * the Orders page is built from the new pieces and no longer from the old always-visible filter form.
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
const STAFF_AREAS = ["src/lib/staff/", "src/app/admin/", "src/components/admin/"];
const inStaffArea = (p) => STAFF_AREAS.some((a) => p.startsWith(a));

describe("admin-only money data stays out of every customer-facing and public file", () => {
  const PRIVATE = /order_receipts|list_orders_overview|get_order_receipt|add_order_receipt|remove_order_receipt|receipt_count|OverviewOrderRow|OrdersOverview|ReceiptMeta|cost_minor|profit_minor|profit_is_provisional|order_costs|order_cost_rollup|admin\/receipts|can_see_finance|can_manage_receipts/;

  it("no file outside the staff code and the staff screens mentions a receipt, a cost, a profit or the staff functions that return them", () => {
    const files = sourceFiles().filter((p) => !inStaffArea(p));
    assert.ok(files.length > 80, "the scan found too few files");
    for (const p of files) assert.doesNotMatch(strip(read(p)), PRIVATE, `${p} must not reference admin-only financial data`);
  });

  it("the customer's own pages and account code have no cost, profit, margin or supplier word and no mention of the PDF receipts (a customer's payment still has its own receipt NUMBER)", () => {
    const files = sourceFiles().filter((p) => p.startsWith("src/app/account/") || p.startsWith("src/lib/accounts/") || p.startsWith("src/components/account/"));
    assert.ok(files.length > 15);
    for (const p of files) assert.doesNotMatch(strip(read(p)), /pdf receipt|receipts\b|profit|supplier|margin|\bcost(s|_)/i, `${p}: nothing admin-only is drawn for a customer`);
  });

  it("the new database objects are in schema private or admin: nothing in the migration is created in schema public or granted to the customer API", () => {
    const sql = read("supabase/migrations/20261126120000_orders_overview_and_receipts.sql");
    assert.doesNotMatch(sql, /create (or replace )?(table|view|function)\s+(if not exists\s+)?public\./i, "no public object is created");
    assert.doesNotMatch(sql, /grant\s+[^;]*\s+to\s+[^;]*\b(anon|public|service_role)\b/i, "nothing is granted to anon, PUBLIC or service_role");
    assert.match(sql, /alter table private\.order_receipts enable row level security/);
    assert.match(sql, /revoke all on table private\.order_receipts from anon, authenticated, service_role/);
    for (const fn of ["admin.list_orders_overview", "admin.add_order_receipt", "admin.remove_order_receipt", "admin.get_order_receipt"]) assert.ok(sql.includes(`create or replace function ${fn}(`), fn);
    assert.match(sql, /perform private\.require_permission\('payments\.record'\)/);
    assert.match(sql, /perform private\.require_permission\('payments\.read'\)/);
    assert.match(sql, /private\.has_permission\('finance\.read'\)/);
  });
});

describe("the receipt file route", () => {
  const route = () => read("src/app/admin/receipts/[id]/route.ts");

  it("only answers GET, only to a verified staff session that holds payments.read, and answers anyone else with the same plain 404", () => {
    const code = strip(route());
    assert.deepEqual([...code.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]), ["GET"], "no POST, PUT, PATCH or DELETE");
    assert.match(code, /getStaffState\(\)/);
    assert.match(code, /state\.state !== "ok" \|\| !state\.permissions\.has\("payments\.read"\)\) return notFound\(\)/);
    assert.match(code, /if \(!isUuid\(id\)\) return notFound\(\)/, "an address that is not an id is a 404 before anything else");
    assert.doesNotMatch(code, /redirect\(|signInUrl/, "a customer or a signed-out visitor is never redirected towards the admin area");
  });

  it("serves the file with no cache, no type guessing and a safe download name, from the staff function", () => {
    const code = strip(route());
    for (const header of ['"Cache-Control": "private, no-store"', '"X-Content-Type-Options": "nosniff"', '"X-Robots-Tag": "noindex, nofollow"', '"Referrer-Policy": "no-referrer"', '"Cross-Origin-Resource-Policy": "same-origin"']) assert.ok(code.includes(header), header);
    assert.match(code, /"Content-Type": "application\/pdf"/);
    assert.match(code, /contentDispositionFor\(file\.file_name, download\)/);
    assert.match(code, /state\.api\.getOrderReceipt\(id\)/);
    assert.doesNotMatch(code, /file_name\s*\+|`[^`]*\$\{file\.file_name\}/, "the file name never goes into a header unencoded");
  });

  it("is covered by the admin middleware (no-store and noindex on every /admin answer) and lives under /admin", () => {
    assert.ok(existsSync(join(ROOT, "src/app/admin/receipts/[id]/route.ts")));
    assert.match(read("src/middleware.ts"), /area === "\/admin" \|\| area\.startsWith\("\/admin\/"\)/);
    assert.match(read("src/middleware.ts"), /"Cache-Control", "private, no-store"/);
  });
});

describe("the receipt actions, the gateway statements and the upload limit", () => {
  it("uploading and removing need payments.record, go through the staff gateway, take the file as bytes, and never take an identity or a price from the form", () => {
    const actions = strip(read("src/lib/staff/actions.ts"));
    for (const name of ["uploadReceiptAction", "removeReceiptAction"]) {
      const body = new RegExp(`export async function ${name}[\\s\\S]*?\\n}\\n`).exec(actions)?.[0];
      assert.ok(body, name);
      assert.match(body, /return run\("\/admin\/orders", "payments\.record", formData/, `${name} needs payments.record`);
      assert.match(body, /revalidatePath\("\/admin\/orders"\)/);
    }
    const upload = /export async function uploadReceiptAction[\s\S]*?\n}\n/.exec(actions)[0];
    assert.match(upload, /parseEntryId\(formData\)/, "the receipt id is the one the form chose");
    assert.match(upload, /parseReceiptUpload\(formData\)/, "the bytes are checked on the server");
    assert.match(upload, /Buffer\.from\(upload\.bytes\)/);
    assert.doesNotMatch(upload, /formData\.get\("(user|staff|actor|role|permission|uploaded_by)/);
  });

  it("the gateway sends the file as a bound bytea parameter (never as text in the statement); both writes are listed as writes and as keyed", () => {
    const gateway = read("src/lib/staff/gateway.ts");
    assert.match(gateway, /add_order_receipt: "with c as materialized \(select admin\.add_order_receipt\(\$1::uuid, \$2::uuid, \$3::text, \$4::bytea\) as r\)/);
    assert.match(gateway, /remove_order_receipt: "with c as materialized \(select admin\.remove_order_receipt\(\$1::uuid, \$2::text\) as r\)/);
    assert.match(gateway, /get_order_receipt: "select admin\.get_order_receipt\(\$1::uuid\) as r"/);
    assert.match(gateway, /list_orders_overview: "select admin\.list_orders_overview\(\$1::text, \$2::text, \$3::integer, \$4::integer, \$5::date, \$6::date, \$7::text, \$8::integer, \$9::integer\) as r"/);
    const writes = /const WRITE_CALLS[\s\S]*?\]\);/.exec(gateway)[0];
    const keyed = /const KEYED_CALLS[\s\S]*?\]\);/.exec(gateway)[0];
    for (const name of ["add_order_receipt", "remove_order_receipt"]) {
      assert.ok(writes.includes(`"${name}"`), `${name} is a write call`);
      assert.ok(keyed.includes(`"${name}"`), `${name} is a keyed call`);
    }
    for (const name of ["list_orders_overview", "get_order_receipt"]) assert.ok(!writes.includes(`"${name}"`), `${name} is a read`);
    const api = strip(read("src/lib/staff/api.ts"));
    assert.match(api, /addOrderReceipt: async \(orderId: string, receiptId: string, fileName: string, content: Buffer\)/);
  });

  it("the upload limit: a server action may carry a 4 MB PDF (4.5 MB is what the hosting platform accepts in one request), and the PDF limit is 4 MB", () => {
    assert.match(read("next.config.ts"), /serverActions:\s*\{\s*bodySizeLimit:\s*"4\.5mb"\s*\}/);
    assert.match(read("src/lib/staff/receipts.ts"), /MAX_RECEIPT_BYTES = 4 \* 1024 \* 1024/);
    assert.match(read("supabase/migrations/20261126120000_orders_overview_and_receipts.sql"), /size_bytes between 1 and 4194304/);
  });
});

describe("the new client files and the Orders page", () => {
  const NEW_CLIENT = ["src/components/admin/receipts.tsx", "src/components/admin/MenuDismiss.tsx"];

  it("the receipts panel and the menu-dismiss wrapper are client files that import only what a client file may; the pure rules module imports no server code", () => {
    for (const p of NEW_CLIENT) {
      const text = read(p);
      assert.match(text, /^\s*["']use client["']/, p);
      const imports = [...strip(text).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const i of imports) assert.match(i, /^(react|@\/lib\/staff\/(actions|form-state|format|receipts|types)|@\/lib\/menu-dismiss|\.\/use-idempotency-key)$/, `${p} imports ${i}`);
      assert.doesNotMatch(text, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function|document\.write/, `${p} never writes raw HTML`);
    }
    for (const p of ["src/lib/staff/receipts.ts", "src/lib/menu-dismiss.ts"]) {
      const text = strip(read(p));
      assert.doesNotMatch(text, /server-only|from\s+["'](pg|node:|next\/headers)/, `${p} is plain code a browser may load`);
      assert.doesNotMatch(text, /process\.env|\bBuffer\b/, `${p} reads no environment and uses no Node-only type`);
    }
    assert.deepEqual([...strip(read("src/lib/menu-dismiss.ts")).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]), [], "menu-dismiss.ts imports nothing, so it can be run in a bare page");
  });

  it("the panel is the browser's own popover, opened by a button and closed by its own means: no script is needed to open or close it", () => {
    const text = strip(read("src/components/admin/receipts.tsx"));
    assert.match(text, /popover="auto"/);
    assert.match(text, /popoverTarget=\{id\}/);
    assert.match(text, /popoverTargetAction="hide"/);
    assert.match(text, /role="dialog"/);
    assert.match(text, /type="file"[\s\S]*?accept="application\/pdf,\.pdf"/);
    assert.match(text, /absolute inset-0 h-full w-full cursor-pointer opacity-0/, "the browser's own file field is stretched over the drop zone");
  });

  it("the Sort and Filter menus are <details> that are closed until clicked and re-created whenever the address changes (so a choice always leaves them closed)", () => {
    const text = strip(read("src/components/admin/orders-toolbar.tsx"));
    assert.equal((text.match(/<details /g) ?? []).length, 2);
    assert.doesNotMatch(text, /<details[^>]*\sopen/, "neither starts open");
    assert.match(text, /key=\{`sort:\$\{address\}`\}/);
    assert.match(text, /key=\{`filter:\$\{address\}`\}/);
    assert.equal((text.match(/name="orders-menu"/g) ?? []).length, 2, "one group: only one is open at a time");
  });

  it("the Orders page uses the overview function and the new pieces; the old always-visible filter form and the old list function are not used by it", () => {
    const page = strip(read("src/app/admin/orders/page.tsx"));
    assert.match(page, /api\.listOrdersOverview\(/);
    assert.doesNotMatch(page, /listOrdersPage|OrdersFilterPanel|OrdersPagination|orders-controls/);
    for (const piece of ["OrdersToolbar", "OrdersPager", "ReceiptsCell", "FinancialPerformance"]) assert.match(page, new RegExp(`<${piece}`), piece);
    assert.ok(!existsSync(join(ROOT, "src/components/admin/orders-controls.tsx")), "the old controls file is gone");
    // seven columns at most, in the owner's order; cost and profit and receipts only when the database said so
    assert.deepEqual([...page.matchAll(/key: "(\w+)",\s*header: "([^"]+)"/g)].map((m) => m[2]), ["Order", "Customer", "Order price", "Cost", "Profit", "Placed", "Receipts"]);
    assert.match(page, /if \(page\.can_see_finance\)/);
    assert.match(page, /if \(page\.can_see_receipts\)/);
    assert.match(page, /parseOrdersListQuery\(params, STATUSES\.map\(\(\[code\]\) => code\), \{ canSeeFinance: financeAllowed \}\)/, "a profit sort is only accepted from a person who may see costs");
  });
});
