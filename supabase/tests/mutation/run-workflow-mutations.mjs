// Mutation check for the order workflow v2 (PLAT-0004). Not part of CI (it runs the suites many times): run it by hand with
//   node --disable-warning=ExperimentalWarning supabase/tests/mutation/run-workflow-mutations.mjs [id ...]
// Each mutation breaks ONE rule in a COPY of the working tree (the real files are never touched), runs the suite that is supposed
// to notice, and requires that suite to FAIL. A mutation that survives (the suite still passes) means a rule is not really tested.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCH = "supabase/migrations/20261122120000_order_workflow_v2_schema.sql";
const FN = "supabase/migrations/20261122120100_order_workflow_v2_functions.sql";
const TL = "src/lib/workflow/timeline.ts";
const COMP = "src/components/workflow/WorkflowTimeline.tsx";
const VAL = "src/lib/staff/validation.ts";
const GW = "src/lib/staff/gateway.ts";
const WV = "supabase/tests/workflow.v2.db.test.mjs";
const LIB = "supabase/tests/workflow-lib.test.mjs";
const STATIC = "supabase/tests/static.test.mjs";
const DB = "supabase/tests/db.test.mjs";

/** [id, what the mutation breaks, file, text to find (must occur exactly once), replacement, the suites that must catch it] */
const MUTATIONS = [
  ["W01", "deposit: a policy gate later than Deposit confirmed is honoured on workflow 2 (the unpaid deposit can be confirmed)", FN, "      gate_order := least(coalesce(gate_order, private.status_order('deposit_received')), private.status_order('deposit_received'));", "      null;", [WV]],
  ["W02", "transition: a blocked move is not refused (the reason is only shown, never enforced)", FN, "  blocked := private.transition_block_reason(o, p_to_status, o.workflow_version);\n  if blocked is not null then\n    raise exception '%', blocked using errcode = '55000';\n  end if;\n", "", [WV]],
  ["W03", "transition: the explicit fulfilment choice is not required before the branch", FN, "  if o.workflow_version >= 2 and o.status = 'carrier_delivering' and o.fulfillment_type is null\n     and p_to_status in ('building', 'items_arrived') then", "  if false then", [WV]],
  ["W04", "tracking: an update is accepted after Live tracking ended", FN, "    when 'ended' then 'Live tracking has ended for this order; adding to its tracking history needs a correction by the owner'", "    when 'ended' then null", [WV]],
  ["W05", "tracking: an update is accepted before Live tracking started", FN, "    when 'not_started' then 'tracking updates can only be published while the order is in Live tracking, and it has not started yet'", "    when 'not_started' then null", [WV]],
  ["W06", "tracking: staff (tracking.publish) may add a correction", FN, "  perform private.require_permission('tracking.correct');", "  perform private.require_permission('tracking.publish');", [WV]],
  ["W07", "adoption: staff may move an order onto the new workflow", FN, "  perform private.require_permission('orders.adopt');", "  perform private.require_permission('orders.transition');", [WV]],
  ["W08", "adoption: the deposit rule is skipped (an unpaid order is placed at Order confirmed)", FN, "  if private.status_order(m.target_status) >= private.status_order('deposit_received') then", "  if false then", [WV]],
  ["W09", "dropdown: a held order is offered every status, not only where it was held from", FN, "      and (o.status <> 'on_hold' or c.to_code = 'cancelled' or c.to_code = previous)", "      and true", [WV]],
  ["W10", "transition: a held order may resume anywhere", FN, "    if previous is distinct from p_to_status then", "    if false then", [WV]],
  ["W11", "fulfilment: the type can be changed inside the branch (function)", FN, "  if eff in ('building', 'quality_check', 'items_arrived', 'awaiting_scheduling', 'ready_for_delivery', 'delivered') then", "  if false then", [WV]],
  ["W12", "tracking: the phase rule is switched off for both publishing functions", FN, "  select case private.tracking_phase(o)\n    when 'live' then null", "  select case null::text\n    when 'live' then null", [WV]],
  ["W13", "tracking: a correction is accepted while Live tracking is open", FN, "  if phase = 'live' then\n    raise exception 'Live tracking is open for this order; publish a normal tracking update' using errcode = '55000';\n  end if;\n", "", [WV]],
  ["W14", "dropdown: the reason a move is not available yet is dropped", FN, "'blocked_reason', private.transition_block_reason(o, c.to_code, o.workflow_version)) order by ns.sort_order)", "'blocked_reason', null) order by ns.sort_order)", [WV]],
  ["W15", "schema: a branch status without a type is accepted again (CHECK with NULL)", SCH, "fulfillment_type is not distinct from 'custom_pc_build'", "fulfillment_type = 'custom_pc_build'", [WV]],
  ["W16", "schema: the trigger no longer locks the type inside the branch", SCH, "  if old.fulfillment_type is not null and new.fulfillment_type is distinct from old.fulfillment_type", "  if false and new.fulfillment_type is distinct from old.fulfillment_type", [WV]],
  ["W17", "schema: Live tracking no longer owns the nested updates (stage data)", SCH, "(2, 'any', 50, 'live_tracking', true)", "(2, 'any', 50, 'live_tracking', false)", [WV]],
  ["W18", "schema: an anonymous visitor can read the stage table", SCH, "grant select on public.order_workflow_stages to authenticated, service_role;", "grant select on public.order_workflow_stages to anon, authenticated, service_role;", [WV, DB]],
  ["W19", "schema: staff are given the owner-only correction permission", SCH, "  ('owner', 'tracking.correct'), ('owner', 'orders.adopt')\non conflict do nothing;", "  ('owner', 'tracking.correct'), ('owner', 'orders.adopt'), ('staff', 'tracking.correct')\non conflict do nothing;", [WV, DB]],
  ["W20", "tracking: a time in the future is accepted", FN, "  if p_occurred_at is not null and p_occurred_at > now() + interval '1 day' then", "  if false then", [WV]],
  ["W21", "adoption map: a sourcing order is placed straight into Live tracking", SCH, "('sourcing', 'order_confirmed', true, null)", "('sourcing', 'live_tracking', true, null)", [WV]],
  ["W22", "schema: a version-2 order can be moved back to version 1", SCH, "if new.workflow_version is distinct from old.workflow_version and not (old.workflow_version = 1 and new.workflow_version = 2) then", "if false then", [WV]],
  ["W23", "migration: the release switch ships as 2 (the deployed website would start creating version-2 orders)", SCH, "   '{\"default_version\": 1}',\n   'Release switch", "   '{\"default_version\": 2}',\n   'Release switch", [WV]],
  ["W24", "transition: the deposit/payment message is reworded (the dropdown and the database must say the same)", FN, "      return format('the deposit has not been fully paid (%s of %s QAR minor units)', o.amount_paid_minor, o.deposit_required_minor);", "      return format('deposit missing (%s of %s)', o.amount_paid_minor, o.deposit_required_minor);", [WV]],
  ["W25", "model: the newest update is marked even when it was withdrawn", TL, "    if (!nodes[i].retracted) {", "    if (true) {", [LIB]],
  ["W26", "model: updates are ordered by publish time, not by when the event happened", TL, "  return time(a.at) - time(b.at) || time(a.recordedAt) - time(b.recordedAt)", "  return time(a.recordedAt) - time(b.recordedAt) || time(a.at) - time(b.at)", [LIB]],
  ["W27", "model: a customer is shown withdrawn updates", TL, "    .filter((e) => includeRetracted || !e.retracted)", "    .filter(() => true)", [LIB]],
  ["W28", "model: both branches are drawn for every order", TL, "(r.branch === \"any\" || r.branch === (order.fulfillment_type ?? null))", "(true)", [LIB]],
  ["W29", "component: the staff-only author, reasons and withdrawal notes are shown to customers", COMP, "        {audience === \"staff\" ? (\n          <div className=\"mt-1 flex flex-col gap-1 text-xs text-text-muted\">", "        {true ? (\n          <div className=\"mt-1 flex flex-col gap-1 text-xs text-text-muted\">", [LIB]],
  ["W30", "component: the Live tracking section is always open", COMP, "  const open = timeline.trackingLive;", "  const open = true;", [LIB]],
  ["W31", "component: the staff form slot is drawn for customers", COMP, "{audience === \"staff\" && trackingFooter ?", "{trackingFooter ?", [LIB]],
  ["W32", "validation: Qatar time is read as UTC", VAL, "const utc = Date.UTC(year, month - 1, day, hour - 3, minute);", "const utc = Date.UTC(year, month - 1, day, hour, minute);", [LIB]],
  ["W33", "validation: any text is accepted as a fulfilment type", VAL, "const found = FULFILLMENT_TYPES.find((type) => type === value);", "const found = value ? (value as (typeof FULFILLMENT_TYPES)[number]) : undefined;", [LIB]],
  ["W34", "gateway: the correction call is not listed as a write call", GW, "\"publish_tracking_update\", \"publish_tracking_correction\", \"set_order_fulfillment_type\", \"adopt_new_workflow\", \"retract_tracking_event\",", "\"publish_tracking_update\", \"set_order_fulfillment_type\", \"adopt_new_workflow\", \"retract_tracking_event\",", [STATIC]],
];

const only = new Set(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "m1-wf-mutation-"));
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
    const hits = original.split(find).length - 1;
    if (hits !== 1) {
      results.push({ id, what, verdict: `NOT APPLIED (the text occurs ${hits} times)` });
      console.log(`${id}  NOT APPLIED (${hits} occurrences)  ${what}`);
      continue;
    }
    writeFileSync(path, original.replace(find, () => replace));
    const caught = [];
    for (const suite of suites) {
      const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--test", suite], { cwd: copy, encoding: "utf8", timeout: 600_000, env: { ...process.env, M1_REQUIRE_PG: "1" } });
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
