// Mutation check for the PLAT-0004 corrections. Not part of CI (it runs the suites many times): run it by hand with
//   node --disable-warning=ExperimentalWarning supabase/tests/mutation/run-mutations.mjs [id ...]
// Each mutation breaks ONE rule in a COPY of the working tree (the real files are never touched), runs the suite that is supposed
// to notice, and requires that suite to FAIL. A mutation that survives (the suite still passes) means a rule is not really tested.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIG = "supabase/migrations/20261121120100_idempotency_expand.sql";
const REL = "supabase/release/idempotency_contract.sql";
const WINDOW = "supabase/tests/idempotency.window.db.test.mjs";
const BASE = "supabase/tests/idempotency.db.test.mjs";
const RELEASE = "supabase/tests/release.db.test.mjs";
const OUTCOMES = "supabase/tests/gateway-outcomes.db.test.mjs";
const HOOK = "supabase/tests/idempotency.hook.browser.test.mjs";
const UNIT = "supabase/tests/staff-lib.test.mjs";

/** [id, what the mutation breaks, file, text to find (must occur exactly once), replacement, the suites that must catch it] */
const MUTATIONS = [
  ["M01", "claim: a REVERSED payment is answered as a repeat", MIG, "if p_operation = 'payment.record'\n     and exists (select 1 from public.payments r where r.reverses_payment_id = v_existing.result_id) then", "if false then", [WINDOW]],
  ["M02", "claim: a CANCELLED order is answered as a repeat", MIG, "if p_operation = 'order.create'\n     and exists (select 1 from public.orders o where o.id = v_existing.result_id and o.status = 'cancelled') then", "if false then", [WINDOW]],
  ["M03", "claim: the replay window never expires", MIG, "if now() - v_existing.created_at > c_replay_window then", "if false then", [WINDOW]],
  ["M04", "claim: the window is 24 HOURS (the rejected design)", MIG, "c_replay_window constant interval := interval '1 hour';", "c_replay_window constant interval := interval '24 hours';", [WINDOW]],
  ["M05", "claim: a different request under the same key is answered (fingerprint ignored)", MIG, "if v_existing.request_hash is distinct from v_hash then", "if false then", [BASE, WINDOW]],
  ["M06", "payment: the expected paid amount is not enforced", MIG, "if p_expected_paid_minor is not null and o.amount_paid_minor <> p_expected_paid_minor then", "if false then", [WINDOW, RELEASE]],
  ["M07", "payment: the expected amount is not part of the fingerprint", MIG, "      'internal_reference', p_internal_reference, 'internal_notes', p_internal_notes,\n      'expected_paid_minor', p_expected_paid_minor),", "      'internal_reference', p_internal_reference, 'internal_notes', p_internal_notes),", [WINDOW]],
  ["M08", "payment: the permission check comes AFTER the order lookup (probe for existing orders)", MIG, "  perform private.require_permission('payments.record');\n  if p_amount_minor is null or p_amount_minor <= 0 then", "  if p_amount_minor is null or p_amount_minor <= 0 then", [WINDOW]],
  ["M09", "payment: the gateway may omit the expected amount", MIG, "if p_expected_paid_minor is null and private.via_gateway() then", "if false then", [WINDOW]],
  ["M10", "similar_orders: the order created by THIS key is reported as a duplicate", MIG, "    and o.id is distinct from (\n      select k.result_id from private.idempotency_keys k\n      where k.actor = (select auth.uid()) and k.operation = 'order.create' and k.idempotency_key = p_idempotency_key)\n", "", [WINDOW]],
  ["M11", "similar_orders: anyone may ask (no permission check)", MIG, "  perform private.require_permission('orders.create');\n  if p_customer_id is null or p_items is null", "  if p_customer_id is null or p_items is null", [WINDOW]],
  ["M12", "claim: the replay flag is never set", MIG, "  perform set_config('m1.replayed', 'true', true);\n  return v_existing.result_id;", "  return v_existing.result_id;", [WINDOW, BASE]],
  ["M13", "migration: the key table loses its append-only trigger", MIG, "create or replace trigger idempotency_keys_append_only before update or delete on private.idempotency_keys\n  for each row execute function private.forbid_mutation();", "", [BASE]],
  ["M14", "migration: the claim helper becomes executable by the gateway", MIG, "revoke all on function private.idempotency_claim(text, text, jsonb, uuid)\n  from public, anon, authenticated, service_role, m1_staff_gateway;", "grant execute on function private.idempotency_claim(text, text, jsonb, uuid) to m1_staff_gateway;", [BASE, RELEASE]],
  ["M15", "contract: the operator guard is removed", REL, "if coalesce(current_setting('m1.confirm_contract', true), '') <> 'old-website-retired' then", "if false then", [RELEASE]],
  ["M16", "gateway: a lost COMMIT answer is reported as 'nothing was changed'", "src/lib/staff/gateway.ts", "if (write && stage === \"commit\") return new StaffOutcomeUnknownError(KEYED_CALLS.has(name));", "if (write && stage === \"commit\") return new StaffUnavailableError(UNAVAILABLE_NOTHING_CHANGED);", [OUTCOMES]],
  ["M17", "gateway: the driver's error event on a checked-out client is not absorbed", "src/lib/staff/gateway.ts", "    client.on(\"error\", absorb);\n", "", [OUTCOMES]],
  ["M18", "gateway: the key-retired refusals do not retire the key", "src/lib/staff/gateway.ts", "return new StaffOperationError(message.replace(/^.*?ERROR:\\s*/, \"\"), { retireKey: true });", "return new StaffOperationError(message.replace(/^.*?ERROR:\\s*/, \"\"));", [OUTCOMES, UNIT]],
  ["M19", "outcomes: a repeat is announced like a first save", "src/lib/staff/outcomes.ts", "export const paymentSuccessMessage = (replayed: boolean): string => (replayed ? PAYMENT_ALREADY_RECORDED : PAYMENT_RECORDED);", "export const paymentSuccessMessage = (replayed: boolean): string => (replayed ? PAYMENT_RECORDED : PAYMENT_RECORDED);", [UNIT, OUTCOMES]],
  ["M20", "client key store: the key is not bound to the balance the page showed", "src/lib/staff/idempotency-client.ts", "if (saved && saved.binding === binding) return saved.key;", "if (saved) return saved.key;", [UNIT, HOOK]],
  ["M21", "hook: a success does not take a new key", "src/components/admin/use-idempotency-key.ts", "    setKey(rotateKey(storeOf(), scope, binding));", "    /* no rotation */", [HOOK]],
  ["M22", "hook: any error rotates the key", "src/lib/staff/idempotency-client.ts", "return state.status === \"success\" || (state.status === \"error\" && state.keyRetired === true);", "return state.status === \"success\" || state.status === \"error\";", [UNIT, HOOK]],
  ["M23", "action body: a confirmed duplicate is still warned about (the override is ignored)", "src/lib/staff/order-actions.ts", "if (field(formData, \"confirm_duplicate\") !== \"yes\") {", "if (true) {", [OUTCOMES]],
  ["M24", "form: the order form is not locked after the order was created", "src/components/admin/forms.tsx", "<fieldset disabled={created} className=\"contents\">", "<fieldset className=\"contents\">", [BASE]],
  ["M25", "order creation: the permission check comes AFTER the customer lookup", MIG, "  perform private.require_permission('orders.create');\n  if not exists (select 1 from public.customers where id = p_customer_id) then", "  if not exists (select 1 from public.customers where id = p_customer_id) then", [WINDOW]],
  ["M26", "loyalty: the permission check comes AFTER the input validation", MIG, "  perform private.require_permission('loyalty.adjust');\n  if p_points is null or p_points = 0 then", "  if p_points is null or p_points = 0 then", [WINDOW]],
  ["M27", "payment: the permission check is MOVED after the replay (revoked access can still replay)", MIG, [
    ["  perform private.require_permission('payments.record');\n  if p_amount_minor is null or p_amount_minor <= 0 then", "  if p_amount_minor is null or p_amount_minor <= 0 then"],
    ["  if replay is not null then\n    return replay;\n  end if;\n\n  select * into o from public.orders where id = p_order_id for update;", "  if replay is not null then\n    return replay;\n  end if;\n  perform private.require_permission('payments.record');\n\n  select * into o from public.orders where id = p_order_id for update;"],
  ], null, [WINDOW]],
  ["M28", "gateway: after a connection failure the gateway waits for a ROLLBACK answer from the dead connection", "src/lib/staff/gateway.ts", "if (client && !broken) await client.query(\"rollback\")", "if (client) await client.query(\"rollback\")", [OUTCOMES]],
  ["M29", "action body: a permission failure of the duplicate check no longer stops the order", "src/lib/staff/order-actions.ts", "      if (error instanceof StaffPermissionError) throw error;\n", "", [OUTCOMES]],
  ["M30", "action body: a payment form without the expected paid amount is accepted", "src/lib/staff/order-actions.ts", "if (expectedPaid === null) return { status: \"error\", message: STALE_FORM_MESSAGE };", "", [OUTCOMES]],
  ["M31", "action body: a repeated payment is announced like a first save", "src/lib/staff/order-actions.ts", "message: paymentSuccessMessage(replayed)", "message: paymentSuccessMessage(false)", [OUTCOMES]],
  ["M32", "action body: the order list is not refreshed after an order is created", "src/lib/staff/order-actions.ts", "  revalidate(\"/admin/orders\");\n", "", [OUTCOMES]],
  ["M33", "contract rollback: the expand rollback no longer notices the contract (marker removed)", "supabase/release/idempotency_expand_rollback.sql", "and p.prosrc like '%m1:contract-wrapper%'", "and false", [RELEASE]],
  ["M34", "expand: the key table's column TYPES are not checked (names only)", MIG, [
    ["column_name || ':' || data_type", "column_name"],
    ["'actor:uuid,created_at:timestamp with time zone,idempotency_key:text,operation:text,request_hash:text,result_id:uuid'", "'actor,created_at,idempotency_key,operation,request_hash,result_id'"],
  ], null, [RELEASE]],
  ["M35", "gateway: a failed ROLLBACK does not mark the connection broken (it goes back to the pool)", "src/lib/staff/gateway.ts", "        broken = true; // the connection could not even roll back: it is destroyed, never returned to the pool", "        /* kept */", [OUTCOMES]],
  ["M36", "order creation: the quotation permission is checked AFTER the claim (a repeat skips it)", MIG, [
    ["  if p_quotation_id is not null then\n    perform private.require_permission('quotations.manage');\n  end if;\n\n  -- A retry of an order", "  -- A retry of an order"],
    ["  if p_quotation_id is not null then\n    select * into q from public.quotations where id = p_quotation_id for update;", "  if p_quotation_id is not null then\n    perform private.require_permission('quotations.manage');\n    select * into q from public.quotations where id = p_quotation_id for update;"],
  ], null, [WINDOW]],
];

const only = new Set(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "m1-mutation-"));
const copy = join(work, "tree");
for (const dir of ["src", "supabase", "ops", "docs"]) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
for (const f of ["package.json", "tsconfig.json", "next.config.ts"]) cpSync(join(ROOT, f), join(copy, f));
symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));

const results = [];
try {
  for (const [id, what, file, find, replace, suites] of MUTATIONS) {
    if (only.size && !only.has(id)) continue;
    const path = join(copy, file);
    const original = readFileSync(path, "utf8");
    // `find` may be a list of [find, replace] pairs (a mutation that needs several edits, such as MOVING a check).
    const pairs = Array.isArray(find) ? find : [[find, replace]];
    let mutated = original;
    let applied = true;
    for (const [f, r] of pairs) {
      const hits = mutated.split(f).length - 1;
      if (hits !== 1) {
        results.push({ id, what, verdict: `NOT APPLIED (the text occurs ${hits} times)` });
        applied = false;
        break;
      }
      mutated = mutated.replace(f, () => r);
    }
    if (!applied) continue;
    writeFileSync(path, mutated);
    const caught = [];
    for (const suite of suites) {
      const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--test", suite], { cwd: copy, encoding: "utf8", timeout: 600_000 });
      const failing = (r.stdout.match(/^\s*not ok /gm) ?? []).length;
      if (r.status !== 0 && failing > 0) caught.push(`${suite.split("/").pop()} (${failing} failing)`);
    }
    writeFileSync(path, original);
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
