// Mutation check for pricing and rewards (PLAT-0005). Not part of CI (it runs the suites many times): run it by hand with
//   node --disable-warning=ExperimentalWarning supabase/tests/mutation/run-pricing-mutations.mjs [id ...]
// Each mutation breaks ONE rule in a COPY of the working tree (the real files are never touched), runs the suites that are supposed to
// notice, and requires at least one of them to FAIL. A mutation that survives (every suite still passes) means a rule is not really tested.
// A mutation may carry several edits (a rule defended in two places has to be broken in both).
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const M1 = "supabase/migrations/20261123120000_pricing_rewards_schema.sql";
const M2 = "supabase/migrations/20261123120100_pricing_rewards_functions.sql";
const M3 = "supabase/migrations/20261123120200_pricing_rewards_policies.sql";
const PRICING = "src/lib/platform/pricing.ts";
const FORM = "src/lib/staff/pricing-form.ts";
const FORMS = "src/components/admin/forms.tsx";
const DASH = "src/components/account/dashboard.tsx";
const DB = "supabase/tests/pricing.db.test.mjs";
const LIB = "supabase/tests/pricing-lib.test.mjs";
const PAGES = "supabase/tests/pricing.pages.db.test.mjs";

/** [id, what the mutation breaks, [[file, text to find, replacement, occurrences?]...], the suites, any of which must catch it] */
const MUTATIONS = [
  ["P01", "the deposit is worked out from the NET payable amount (a discount lowers it)", [[M2, "  dq := private.deposit_quote(p_gross_minor);", "  dq := private.deposit_quote(net);"]], [DB, LIB]],
  ["P02", "a discount needs only orders.create (staff may discount)", [[M2, "    perform private.require_permission('orders.discount');", "    perform private.require_permission('orders.create');"]], [DB]],
  ["P03", "a redemption needs only orders.create (staff may redeem)", [[M2, "    perform private.require_permission('loyalty.redeem');", "    perform private.require_permission('orders.create');"]], [DB]],
  ["P04", "no per-customer lock anywhere (two orders can spend the same points)", [
    [M1, "perform pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || new.customer_id::text, 0));", "perform pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || new.id::text, 0));"],
    [M1, "$$ select pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || p_customer_id::text, 0)) $$;", "$$ select pg_advisory_xact_lock(hashtextextended('m1.loyalty.balance:' || gen_random_uuid()::text, 0)) $$;"],
  ], [DB]],
  ["P05", "points are earned on the GROSS total (discounted money earns points)", [[M2, "else o.net_payable_minor end;\n  pts := case rounding", "else o.total_minor end;\n  pts := case rounding"]], [DB]],
  ["P06", "the award's full-payment rule compares with the gross total", [[M2, "if coalesce((trig ->> 'require_full_payment')::boolean, true) and o.amount_paid_minor < o.net_payable_minor then", "if coalesce((trig ->> 'require_full_payment')::boolean, true) and o.amount_paid_minor < o.total_minor then"]], [DB]],
  ["P07", "a payment may exceed the net payable amount (both record_payment functions)", [[M2, "if o.amount_paid_minor + p_amount_minor > o.net_payable_minor then", "if o.amount_paid_minor + p_amount_minor > o.total_minor then", 2]], [DB]],
  ["P08", "cancelling an order does not give the redeemed points back", [[M2, "    perform private.restore_redeemed_points(o.id, coalesce(nullif(btrim(p_reason), ''), 'order cancelled'));", "    null;"]], [DB, PAGES]],
  ["P09", "a restoration is not unique per redemption (points could be returned twice)", [
    [M1, "create unique index if not exists loyalty_one_restore_per_redemption on public.loyalty_ledger (reverses_entry_id)\n  where entry_type = 'redemption_restore';", "-- (mutated: no unique index)"],
    [M2, "  on conflict (reverses_entry_id) where entry_type = 'redemption_restore' do nothing\n", "\n"],
  ], [DB]],
  ["P10", "a net payable below the cash deposit is accepted at creation", [[M2, "  if net < dq.amount_minor then\n    raise exception 'the discount and loyalty credit leave %", "  if false then\n    raise exception 'the discount and loyalty credit leave %"]], [DB, LIB]],
  ["P11", "the figures the screen showed are not compared with the database's", [[M2, "  if p_expected_net_minor is not null and (quote ->> 'net_payable_minor')::bigint <> p_expected_net_minor then", "  if false then"]], [DB]],
  ["P12", "the idempotency fingerprint ignores the discount and the points", [[M2, "      'discount', d, 'redeem_points', pts,\n", "\n"]], [DB]],
  ["P13", "a discount needs no reason", [[M2, "  if char_length(reason) not between 3 and 500 then", "  if false then"]], [DB]],
  ["P14", "discounts and redemption stay on while the earning rule counts the gross total", [[M2, "as $$ select coalesce(private.policy('loyalty.earning_base') ->> 'base', '') in ('net_payable', 'amount_paid') $$;", "as $$ select true $$;"]], [DB, PAGES]],
  ["P15", "pricing can be set on an order after the transaction that created it", [[M1, "     and old.created_at is distinct from now() then", "     and false then"]], [DB]],
  ["P16", "a percentage discount rounds down instead of to the nearest 0.01 (half up)", [[M2, "else (p_gross_minor * (d ->> 'percent_bps')::bigint + 5000) / 10000 end;", "else (p_gross_minor * (d ->> 'percent_bps')::bigint) / 10000 end;"]], [DB, LIB]],
  ["P17", "a discount may exceed the order total", [[M2, "    if disc > p_gross_minor then", "    if false then"]], [DB, LIB]],
  ["P18", "points may be worth more than what is left to pay after the discount", [[M2, "    if credit > after_disc then", "    if false then"]], [DB, LIB]],
  ["P19", "more points than the balance can be redeemed (quote, redemption and ledger guard all broken)", [
    [M2, "    if pts > balance then", "    if false then"],
    [M2, "  if private.loyalty_balance(o.customer_id) < p_points then", "  if false then"],
    [M1, "       and private.loyalty_balance(new.customer_id) + new.points < 0 then", "       and false then"],
  ], [DB]],
  ["P20", "confirming an order whose net payable is below its deposit is allowed", [[M2, "       and o.net_payable_minor < (private.deposit_quote(o.total_minor)).amount_minor then", "       and false then"]], [DB]],
  ["P21", "a deposit boundary moves (QAR 10,000 becomes QAR 9,000)", [[M3, "{\"up_to_minor\": 1000000, \"percent_bps\": 3500}, {\"up_to_minor\": 1500000, \"percent_bps\": 5000}, {\"percent_bps\": 6000}]}';", "{\"up_to_minor\": 900000, \"percent_bps\": 3500}, {\"up_to_minor\": 1500000, \"percent_bps\": 5000}, {\"percent_bps\": 6000}]}';"]], [DB]],
  ["P22", "the discount record can be edited or deleted", [[M1, "create trigger order_discounts_append_only before update or delete on private.order_discounts\n  for each row execute function private.forbid_mutation();", "-- (mutated: no append-only trigger)"]], [DB]],
  ["P23", "the earlier payment entry points and the new one are open to anon", [[M2, "grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint) to authenticated, m1_staff_gateway;", "grant execute on function admin.create_order(uuid, jsonb, uuid, text, text, text, text, jsonb, bigint, bigint, bigint) to anon, authenticated, m1_staff_gateway;"]], [DB]],
  ["P24", "a discount line item is accepted by the new entry point", [[M2, "    if coalesce(it ->> 'kind', 'component') = 'discount' then", "    if false then"]], [DB]],
  ["P25", "screen: 'Use Maximum' ignores the price left after the discount", [[PRICING, "  return Math.min(pointsBalance, Math.floor(afterDiscountMinor / pointValueMinor));", "  return pointsBalance;"]], [LIB]],
  ["P26", "screen: the deposit is worked out from the net amount", [[PRICING, "  const dq = depositQuote(grossMinor, depositPolicy);", "  const dq = depositQuote(grossMinor - discountAmount(grossMinor, discount), depositPolicy);"]], [LIB]],
  ["P27", "screen: a locked discount control is still applied", [[FORM, "  if (locked || form.discountMode === \"none\") return", "  if (form.discountMode === \"none\") return"]], [LIB]],
  ["P28", "statement: the loyalty credit is no longer explained as 'not a payment'", [[PRICING, "note: \"Points used as a credit on this order. Not a payment.\"", "note: \"Points used on this order.\""]], [LIB, PAGES]],
  ["P29", "customer page: the total shown for an adjusted order is the gross, not the amount payable", [[DASH, "{order.adjusted ? order.netPayable : order.total}", "{order.total}"]], [PAGES]],
  ["P30", "form: the create button is not disabled while the pricing is invalid or blocked", [[FORMS, "disabled={created || !pricingView.canSubmit}", "disabled={created}"]], [LIB]],
  ["P31", "form: the redemption switch is never disabled", [[FORMS, "disabled={view.redeemLocked !== null}\n            onClick", "disabled={false}\n            onClick"]], [LIB, PAGES]],
  ["P32", "screen: points are earned on the gross amount in the summary", [[FORM, "pointsEarned(Math.max(figures.netPayableMinor, 0), context.earnQarPerPointMinor)", "pointsEarned(Math.max(figures.grossMinor, 0), context.earnQarPerPointMinor)"]], [LIB]],
  ["P33", "the tracking of a cancelled redemption: the order page does not say the points were returned", [["src/app/admin/orders/[id]/page.tsx", "order.redemption_record.returned ? \"The order was cancelled and the points were returned to the customer.\"", "order.redemption_record.returned ? \"\""]], [PAGES]],
  ["P34", "an order with a discount earns on the GROSS when the earning rule is the earlier 'order total' placeholder", [[M2, "when 'amount_paid' then o.amount_paid_minor else o.net_payable_minor end;", "when 'amount_paid' then o.amount_paid_minor when 'net_payable' then o.net_payable_minor else o.total_minor end;"]], [DB]],
  ["P35", "a cancellation reason of 1 or 2 characters blocks the return of redeemed points", [[M2, "case when char_length(btrim(coalesce(p_reason, ''))) between 3 and 500 then btrim(p_reason) else 'order cancelled' end, (select auth.uid()));", "coalesce(nullif(btrim(p_reason), ''), 'order cancelled'), (select auth.uid()));"]], [DB]],
];

const only = new Set(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "m1-pricing-mutation-"));
const copy = join(work, "tree");
for (const dir of ["src", "supabase", "ops", "docs"]) cpSync(join(ROOT, dir), join(copy, dir), { recursive: true });
for (const f of ["package.json", "tsconfig.json", "next.config.ts"]) cpSync(join(ROOT, f), join(copy, f));
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
