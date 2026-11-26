// Mutation check for the simplified Orders page, cost and profit, PDF receipts and the three-entry account menu (PLAT-0007-a3). Not part of CI (it runs the suites
// many times): run it by hand with
//   node --disable-warning=ExperimentalWarning supabase/tests/mutation/run-orders-overview-mutations.mjs [id ...]
// Each mutation breaks ONE rule in a COPY of the working tree (the real files are never touched), runs the suites that are supposed to notice, and requires at
// least one of them to FAIL. A mutation that survives (every suite still passes) means a rule is not really tested. The two browser mutations (B1, B2) rebuild the
// copy first, so they are slow; the others need no build.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIG = "supabase/migrations/20261126120000_orders_overview_and_receipts.sql";
const DB = "supabase/tests/orders-overview.db.test.mjs";
const PAGES = "supabase/tests/orders.pages.db.test.mjs";
const STATIC = "supabase/tests/orders-overview.static.test.mjs";
const STATIC_MAIN = "supabase/tests/static.test.mjs";
const LIB = "supabase/tests/orders-list-lib.test.mjs";
const RLIB = "supabase/tests/receipts-lib.test.mjs";
const BROWSER = "supabase/tests/orders.layout.browser.test.mjs";
const TOOLBAR = "src/components/admin/orders-toolbar.tsx";
const PAGE = "src/app/admin/orders/page.tsx";
const RECEIPTS = "src/components/admin/receipts.tsx";
const ROUTE = "src/app/admin/receipts/[id]/route.ts";
const LIBLIST = "src/lib/staff/orders-list.ts";
const NAV = "src/lib/accounts/shared/header-nav.ts";
const RULES = "src/lib/staff/receipts.ts";
const DISMISS = "src/lib/menu-dismiss.ts";

/** [id, what the mutation breaks, [[file, text to find, replacement, occurrences?]...], the suites, any of which must catch it] */
const MUTATIONS = [
  ["O01", "migration: cost and profit keys are in every answer, for ordinary staff too", [[MIG, "|| case when fin then jsonb_build_object('cost_minor'", "|| case when true then jsonb_build_object('cost_minor'"]], [DB, PAGES]],
  ["O02", "migration: receipt keys are in every answer, for ordinary staff too", [[MIG, "|| case when rcp then jsonb_build_object('receipt_count'", "|| case when true then jsonb_build_object('receipt_count'"]], [DB, PAGES]],
  ["O03", "migration: a profit sort is allowed without finance.read", [[MIG, "  if sort_key in ('profit_asc', 'profit_desc') then\n    perform private.require_permission('finance.read');", "  if false then\n    perform private.require_permission('finance.read');"]], [DB]],
  ["O04", "migration: an order with no cost entry has a cost of zero (and so a profit equal to its price)", [[MIG, "case when r.order_id is null then null else coalesce(r.actual_minor, 0) + coalesce(r.estimated_minor, 0) end as cost_minor", "coalesce(r.actual_minor, 0) + coalesce(r.estimated_minor, 0) as cost_minor"]], [DB, PAGES]],
  ["O05", "migration: orders with an unknown profit sort FIRST under the profit sorts", [[MIG, "nulls last", "nulls first", 2]], [DB, PAGES]],
  ["O06", "migration: the order price is the original total, not what the customer pays", [[MIG, "o.net_payable_minor, c.full_name as customer_name,", "o.total_minor as net_payable_minor, c.full_name as customer_name,"]], [DB, PAGES]],
  ["O07", "migration: a file that is not a PDF is accepted by the function", [[MIG, "  if substring(p_content from 1 for 5) <> '\\x255044462d'::bytea then", "  if false then"]], [DB]],
  ["O08", "migration: the size limit is not checked by the function", [[MIG, "  if octet_length(p_content) > 4194304 then", "  if false then"]], [DB]],
  ["O09", "migration: the same file can be attached twice to one order", [[MIG, "  if exists (select 1 from private.order_receipts where order_id = o.id and sha256 = file_hash and status = 'active') then", "  if false then"]], [DB]],
  ["O10", "migration: an order can hold any number of receipts", [[MIG, "if active_count >= 10 then", "if active_count >= 1000000 then"]], [DB]],
  ["O11", "migration: a retry of the same upload is not recognised (it is refused, not answered as a repeat)", [[MIG, "    if existing.order_id = o.id and existing.sha256 = file_hash then", "    if false then"]], [DB]],
  ["O12", "migration: attaching a receipt needs no permission", [[MIG, "  perform private.require_permission('payments.record');\n  if p_receipt_id is null and private.via_gateway() then", "  if p_receipt_id is null and private.via_gateway() then"]], [DB]],
  ["O13", "migration: removing a receipt needs no permission", [[MIG, "  perform private.require_permission('payments.record');\n  if char_length(why) < 3", "  if char_length(why) < 3"]], [DB]],
  ["O14", "migration: reading a receipt's file needs no permission", [[MIG, "  perform private.require_permission('payments.read');\n  select * into r from private.order_receipts where id = p_receipt_id and status = 'active';", "  select * into r from private.order_receipts where id = p_receipt_id and status = 'active';"]], [DB]],
  ["O15", "migration: a removed receipt is still served", [[MIG, "where id = p_receipt_id and status = 'active';", "where id = p_receipt_id;"]], [DB]],
  ["O16", "migration: a receipt can be removed without a reason", [[MIG, "  if char_length(why) < 3 or char_length(why) > 300 then", "  if false then"]], [DB]],
  ["O17", "migration: a receipt can be edited or deleted (the identity guard is gone)", [[MIG, "create or replace trigger order_receipts_identity before update or delete on private.order_receipts\n  for each row execute function private.guard_order_receipt_identity();", "-- (mutated: no identity guard)"]], [DB]],
  ["O18", "migration: the receipts table is readable by signed-in users", [[MIG, "revoke all on table private.order_receipts from anon, authenticated, service_role;", "revoke all on table private.order_receipts from anon, authenticated, service_role;\ngrant select on table private.order_receipts to authenticated;"]], [DB]],
  ["O19", "migration: row level security is not enabled on the receipts table", [[MIG, "alter table private.order_receipts enable row level security;", "-- (mutated: no row level security)"]], [DB]],
  ["O20", "migration: the new functions are executable by anon", [[MIG, "    execute format('grant execute on function %s to authenticated, m1_staff_gateway', f);", "    execute format('grant execute on function %s to authenticated, m1_staff_gateway, anon', f);"]], [DB]],
  ["O21", "migration: the file name is not cleaned (folders and quotes stay)", [[MIG, "  n := regexp_replace(n, '^.*[\\\\/]', '');", "  n := n;"]], [DB]],
  ["O22", "migration: every row lists every order's receipts (the join to the order is lost)", [[MIG, "where rcp and rc.order_id = x.id and rc.status = 'active'", "where rcp and rc.status = 'active'"]], [DB]],
  ["O23", "migration: removed receipts are still listed on the page", [[MIG, "    where rcp and rc.order_id = x.id and rc.status = 'active'\n  ) rr on true;", "    where rcp and rc.order_id = x.id\n  ) rr on true;"]], [DB]],
  ["O24", "migration: the audit trail carries the file", [[MIG, "'size_bytes', octet_length(p_content), 'sha256', file_hash)", "'size_bytes', octet_length(p_content), 'sha256', file_hash, 'content', encode(p_content, 'base64'))"]], [DB]],
  ["U01", "page: the cost and profit columns are drawn whatever the database said", [[PAGE, "if (page.can_see_finance) {", "if (true) {"]], [PAGES, STATIC]],
  ["U02", "page: the receipts column is drawn whatever the database said", [[PAGE, "if (page.can_see_receipts) {", "if (true) {"]], [PAGES, STATIC]],
  ["U03", "toolbar: the Sort menu is open when the page loads", [[TOOLBAR, "key={`sort:${address}`} name=\"orders-menu\"", "key={`sort:${address}`} open name=\"orders-menu\""]], [PAGES, STATIC]],
  ["U04", "sorts: the profit sorts are offered to everyone", [[LIBLIST, "ORDER_SORTS.filter((s) => canSeeFinance || !s.needsFinance)", "ORDER_SORTS.filter(() => true)"]], [LIB, PAGES]],
  ["U05", "sorts: a profit sort in the address is accepted from a person who may not see costs", [[LIBLIST, "sortsFor(options.canSeeFinance ?? true)", "sortsFor(true)"]], [LIB, PAGES]],
  ["U06", "page: the profit-sort rule is given the wrong permission", [[PAGE, "{ canSeeFinance: financeAllowed }", "{ canSeeFinance: true }"]], [PAGES, STATIC]],
  ["U07", "receipts: the panel is not a popover (no way to open it without script)", [[RECEIPTS, "popover=\"auto\" role=\"dialog\"", "role=\"dialog\""]], [PAGES, STATIC]],
  ["U08", "receipts: the upload form is always drawn, even for a person who may not manage receipts", [[RECEIPTS, "{canManage ? (\n            count >= MAX_RECEIPTS_PER_ORDER", "{true ? (\n            count >= MAX_RECEIPTS_PER_ORDER"]], [PAGES]],
  ["U09", "route: any signed-in staff member may read a receipt (no payments.read check)", [[ROUTE, " || !state.permissions.has(\"payments.read\")", ""]], [STATIC]],
  ["U10", "route: the browser may guess the file's type", [[ROUTE, "  \"X-Content-Type-Options\": \"nosniff\",\n", ""]], [STATIC]],
  ["U11", "route: a receipt may be cached", [[ROUTE, "\"Cache-Control\": \"private, no-store\"", "\"Cache-Control\": \"public, max-age=3600\""]], [STATIC]],
  ["U12", "actions: uploading and removing need only orders.read", [["src/lib/staff/actions.ts", "run(\"/admin/orders\", \"payments.record\", formData", "run(\"/admin/orders\", \"orders.read\", formData", 2]], [STATIC]],
  ["U13", "gateway: the file is sent as text, not as a bound bytea", [["src/lib/staff/gateway.ts", "$3::text, $4::bytea) as r)", "$3::text, $4::text) as r)"]], [STATIC, DB]],
  ["U14", "rules: the last byte of the PDF signature (the dash after %PDF) is not looked at", [[RULES, "bytes[4] === 0x2d;", "true;"]], [RLIB]],
  ["U15", "rules: the size limit is 5 MB, past what the hosting platform accepts", [[RULES, "MAX_RECEIPT_BYTES = 4 * 1024 * 1024", "MAX_RECEIPT_BYTES = 5 * 1024 * 1024"]], [RLIB, STATIC]],
  ["U16", "page: the monthly report is open on every load", [[PAGE, "open={period.year !== null || period.month !== null}", "open"]], [PAGES]],
  ["U17", "toolbar: searching drops the financial report's period", [[TOOLBAR, "hiddenFields(query, { q: \"\" }, reportParams)", "hiddenFields(query, { q: \"\" }, {})"]], [PAGES]],
  ["U18", "filter count: the search counts as a filter", [[LIBLIST, "return (query.status ? 1 : 0) +", "return (query.q ? 1 : 0) + (query.status ? 1 : 0) +"]], [LIB, PAGES]],
  ["U19", "header: Create Account is offered again", [[NAV, "{ href: \"/account/orders\", label: \"Track my order\", hiddenOn: [] },\n  ];", "{ href: \"/account/orders\", label: \"Track my order\", hiddenOn: [] },\n    { href: \"/auth/sign-up\", label: \"Create Account\", hiddenOn: [] },\n  ];"]], [LIB, STATIC_MAIN]],
  ["U20", "header: \"My account\" is marked current on the orders page too", [[NAV, ", hiddenOn: [], exact: true }", ", hiddenOn: [] }"]], [LIB]],
  ["U21", "header: \"Log in\" is left out on the sign-in page", [[NAV, "hiddenOn: [\"/account\", \"/admin\"]", "hiddenOn: [\"/account\", \"/admin\", \"/auth/sign-in\"]"]], [LIB]],
  ["U22", "header: the entries are in another order", [[NAV, "{ href: \"/auth/sign-in\", label: \"Log in\", hiddenOn: [\"/account\", \"/admin\"] },\n    { href: \"/account\", label: \"My account\", hiddenOn: [], exact: true },", "{ href: \"/account\", label: \"My account\", hiddenOn: [], exact: true },\n    { href: \"/auth/sign-in\", label: \"Log in\", hiddenOn: [\"/account\", \"/admin\"] },"]], [LIB, STATIC_MAIN]],
  ["B1", "browser: Escape no longer closes the Sort and Filter menus", [[DISMISS, "if (event.key !== \"Escape\") return;", "return;"]], [BROWSER]],
  ["B2", "browser: the Sort menu is see-through (no opaque surface)", [[TOOLBAR, "border border-border-strong bg-surface-elevated p-2 shadow", "border border-border-strong p-2 shadow"]], [BROWSER]],
];
const only = new Set(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "m1-orders-overview-mutation-"));
const copy = join(work, "tree");
for (const dir of ["src", "supabase", "ops", "docs", "public"]) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
for (const f of ["package.json", "tsconfig.json", "next.config.ts", "tailwind.config.ts", "postcss.config.mjs", "next-env.d.ts", "eslint.config.mjs", "vercel.json"]) cpSync(join(ROOT, f), join(copy, f));
symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));

const results = [];
try {
  for (const [id, what, edits, suites] of MUTATIONS) {
    if (only.size && !only.has(id)) continue;
    const originals = new Map();
    let notApplied = null;
    for (const [file, find, replace, expected = 1] of edits) {
      const path = join(copy, file);
      const text = originals.has(file) ? readFileSync(path, "utf8") : readFileSync(path, "utf8");
      if (!originals.has(file)) originals.set(file, text);
      const hits = text.split(find).length - 1;
      if (hits !== expected) {
        notApplied = `NOT APPLIED (${file}: the text occurs ${hits} times, expected ${expected})`;
        break;
      }
      writeFileSync(path, text.split(find).join(replace));
    }
    if (notApplied) {
      for (const [file, text] of originals) writeFileSync(join(copy, file), text);
      results.push({ id, what, verdict: notApplied });
      console.log(`${id}  ${notApplied}  ${what}`);
      continue;
    }
    const caught = [];
    for (const suite of suites) {
      const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--test", suite], {
        cwd: copy, encoding: "utf8", timeout: 600_000, env: { ...process.env, M1_REQUIRE_PG: "1" },
      });
      const failing = (r.stdout.match(/^\s*not ok /gm) ?? []).length;
      if (r.status !== 0 && failing > 0) caught.push(`${suite.split("/").pop()} (${failing} failing)`);
    }
    for (const [file, text] of originals) writeFileSync(join(copy, file), text);
    results.push({ id, what, verdict: caught.length ? `CAUGHT by ${caught.join(", ")}` : "SURVIVED" });
    console.log(`${id}  ${caught.length ? "caught" : "SURVIVED"}  ${what}  ${caught.join(", ")}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
const survived = results.filter((r) => !r.verdict.startsWith("CAUGHT"));
console.log(`\n${results.length - survived.length} of ${results.length} mutations caught.`);
for (const r of survived) console.log(`  ${r.id}: ${r.verdict}  (${r.what})`);
process.exit(survived.length ? 1 : 0);
