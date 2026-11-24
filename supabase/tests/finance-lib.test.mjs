// PLAT-0006: unit tests for the finance logic that needs no server, no database and no network: the cost categories and wording, the margin text,
// the report parameters, the description of a history row, and the parsing of every cost, completion and period field the forms send.
// LOCAL tests with plain inputs. What the database does with those values is proved in financial.db.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import { describe, test } from "node:test";
import { ROOT } from "./support/browser.mjs";

register("./support/alias-loader.mjs", import.meta.url);

let load = null;
let skip = false;
try {
  load = {
    fin: await import("../../src/lib/staff/finance.ts"),
    v: await import("../../src/lib/staff/validation.ts"),
    outcomes: await import("../../src/lib/staff/outcomes.ts"),
  };
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}
const { fin, v, outcomes } = load ?? {};

const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const GOOD = { category: "components", description: "Graphics card", amount: "1,250.50", cost_kind: "actual" };

describe("the cost categories and the words the finance screens use", { skip }, () => {
  test("the seven categories are exactly the ones the database accepts", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261124120000_order_costs_and_completion_schema.sql"), "utf8");
    const accepted = /category text not null check \(category in \(([^)]*)\)\)/.exec(sql)[1].split(",").map((s) => s.trim().replaceAll("'", ""));
    assert.deepEqual(fin.COST_CATEGORIES.map((c) => c.value), accepted);
    assert.deepEqual(fin.COST_CATEGORIES.map((c) => c.label), [
      "Components / supplier purchases", "International shipping", "Customs and import duties", "Assembly expenses", "Local delivery", "Payment processing charges", "Other direct order expenses",
    ]);
    assert.deepEqual(fin.COST_KINDS.map((k) => k.value), ["estimated", "actual"]);
  });

  test("the cost states are worded so that a missing cost is never mistaken for a zero cost", () => {
    assert.equal(fin.costStateLabel("complete"), "Costs complete");
    assert.equal(fin.costStateLabel("incomplete"), "Costs incomplete");
    assert.equal(fin.costStateLabel("missing"), "No costs recorded");
    assert.match(fin.profitStateLabel("unavailable"), /Not available/);
    assert.match(fin.profitStateLabel("provisional"), /Provisional/);
    assert.match(fin.profitStateLabel("verified"), /Verified/);
    assert.match(fin.profitStateLabel("none"), /No completed orders/);
  });

  test("a margin is written to one decimal from whole basis points, with a dash when there is none, and negative margins are shown as losses", () => {
    assert.equal(fin.marginText(null), "—");
    assert.equal(fin.marginText(undefined), "—");
    assert.equal(fin.marginText(0), "0.0%");
    assert.equal(fin.marginText(4000), "40.0%");
    assert.equal(fin.marginText(1250), "12.5%");
    assert.equal(fin.marginText(1255), "12.6%", "rounded, not truncated");
    assert.equal(fin.marginText(10000), "100.0%");
    assert.equal(fin.marginText(-250), "-2.5%");
    assert.equal(fin.marginText(-4), "0.0%", "never negative zero");
    assert.equal(fin.marginText(-12345), "-123.5%");
  });

  test("the report parameters accept only a real year and month, and ignore anything else", () => {
    assert.deepEqual(fin.parseReportParams("2026", "3"), { year: 2026, month: 3 });
    assert.deepEqual(fin.parseReportParams("2026", undefined), { year: 2026, month: null });
    assert.deepEqual(fin.parseReportParams(undefined, "11"), { year: null, month: 11 });
    for (const bad of ["abc", "20266", "1999", "2101", "-2026", "2026.5", " 2026", "2026;drop"]) assert.equal(fin.parseReportParams(bad, undefined).year, null, bad);
    for (const bad of ["0", "13", "x", "-1", "1.5", "100", ""]) assert.equal(fin.parseReportParams("2026", bad).month, null, bad);
    assert.equal(fin.monthName(1), "January");
    assert.equal(fin.monthName(12), "December");
    assert.equal(fin.MONTH_NAMES.length, 12);
  });
});

describe("a history row is described with the old and the new value, for every field that changed", { skip }, () => {
  test("added, edited, removed, declared complete and reopened", () => {
    assert.deepEqual(
      fin.describeRevision({ action: "created", old_values: null, new_values: { description: "Card", amount_minor: 125050, category: "components", cost_kind: "estimated" } }),
      ["Added: Card, QAR 1,250.50, Components / supplier purchases (estimated)"],
    );
    const edited = fin.describeRevision({
      action: "edited",
      old_values: { description: "Card", amount_minor: 100000, cost_kind: "estimated", supplier_ref: null, notes: null },
      new_values: { description: "Card (invoice)", amount_minor: 125000, cost_kind: "actual", supplier_ref: "INV-9", notes: null },
    });
    assert.deepEqual(edited, ["Description: Card → Card (invoice)", "Amount: QAR 1,000.00 → QAR 1,250.00", "Estimated or actual: Estimated → Actual", "Supplier or reference: none → INV-9"]);
    assert.deepEqual(fin.describeRevision({ action: "voided", old_values: { description: "Card", amount_minor: 5000 }, new_values: { status: "voided" } }), ["Removed from the totals: Card, QAR 50.00"]);
    assert.deepEqual(fin.describeRevision({ action: "marked_complete", old_values: { costs_complete: false }, new_values: { costs_complete: true } }), ["Costs declared complete"]);
    assert.deepEqual(fin.describeRevision({ action: "marked_incomplete", old_values: null, new_values: null }), ["Costs reopened"]);
  });

  test("a change that touched no value says so instead of printing nothing", () => {
    assert.deepEqual(fin.describeRevision({ action: "edited", old_values: { amount_minor: 1 }, new_values: { amount_minor: 1 } }), ["Saved with no change in value"]);
  });
});

describe("the cost fields the forms send", { skip }, () => {
  test("a valid entry becomes exact minor units; 0 is allowed; thousands separators are accepted", () => {
    const ok = v.parseCostEntry(form({ ...GOOD, supplier_ref: " ACME ", incurred_on: "2026-03-09", notes: " private " }));
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { category: "components", description: "Graphics card", amount_minor: 125050, cost_kind: "actual", supplier_ref: "ACME", incurred_on: "2026-03-09", notes: "private" });
    assert.equal(v.parseCostEntry(form({ ...GOOD, amount: "0" })).value.amount_minor, 0);
    assert.equal(v.parseCostEntry(form({ ...GOOD, amount: "1250" })).value.amount_minor, 125000);
  });

  test("every invalid field is reported by name, and nothing is accepted", () => {
    const bad = v.parseCostEntry(form({ category: "nope", description: "", amount: "-5", cost_kind: "maybe", incurred_on: "2026-02-30" }));
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ["amount", "category", "cost_kind", "description", "incurred_on"]);
    for (const amount of ["12.345", "abc", "1e3", "", "1,25", "٣٠٠"]) assert.equal(v.parseCostEntry(form({ ...GOOD, amount })).ok, false, `amount ${amount}`);
    assert.equal(v.parseCostEntry(form({ ...GOOD, description: "x".repeat(201) })).ok, false);
    assert.equal(v.parseCostEntry(form({ ...GOOD, notes: "x".repeat(1001) })).ok, false);
    assert.equal(v.parseCostEntry(form({ ...GOOD, supplier_ref: "x".repeat(121) })).ok, false);
    assert.equal(v.parseCostEntry(form({ ...GOOD, incurred_on: "2026-13-01" })).ok, false);
    assert.equal(v.parseCostEntry(form({ ...GOOD, incurred_on: "09/03/2026" })).ok, false);
  });

  test("a leap day is a real date only in a leap year", () => {
    assert.equal(v.parseCostEntry(form({ ...GOOD, incurred_on: "2028-02-29" })).ok, true);
    assert.equal(v.parseCostEntry(form({ ...GOOD, incurred_on: "2027-02-29" })).ok, false);
  });

  test("an edit needs the reason as well, and the reason is what the history keeps", () => {
    assert.equal(v.parseCostEdit(form({ ...GOOD })).ok, false);
    const ok = v.parseCostEdit(form({ ...GOOD, reason: "the invoice arrived" }));
    assert.equal(ok.ok, true);
    assert.equal(ok.value.reason, "the invoice arrived");
    assert.equal(ok.value.cost.amount_minor, 125050);
  });

  test("the entry id is a UUID chosen by the form; the version is a positive whole number", () => {
    const id = "6f1f0a52-0c51-4b53-9d0e-6c0b0e0a7c11";
    assert.equal(v.parseEntryId(form({ idempotency_key: id })), id);
    assert.equal(v.parseEntryId(form({ idempotency_key: "not-a-uuid" })), null);
    assert.equal(v.parseEntryId(form({})), null);
    assert.equal(v.parseExpectedVersion(form({ expected_version: "3" })), 3);
    for (const bad of ["0", "-1", "1.5", "x", "", "1234567"]) assert.equal(v.parseExpectedVersion(form({ expected_version: bad })), null, bad);
  });
});

describe("the optional cost rows of the new-order form", { skip }, () => {
  const row = (i, extra = {}) => ({ [`cost_category_${i}`]: "components", [`cost_description_${i}`]: "Card", [`cost_amount_${i}`]: "100", [`cost_cost_kind_${i}`]: "estimated", ...extra });

  test("costs are never required: an untouched row is skipped and no row is an empty list", () => {
    assert.deepEqual(v.parseNewOrderCosts(form({})), { ok: true, value: [] });
    assert.deepEqual(v.parseNewOrderCosts(form({ cost_category_0: "components", cost_cost_kind_0: "estimated" })), { ok: true, value: [] }, "only the defaults of an untouched row");
  });

  test("several rows are parsed in order, in minor units", () => {
    const parsed = v.parseNewOrderCosts(form({ ...row(0), ...row(1, { cost_amount_1: "2,500.75", cost_description_1: "Freight", cost_category_1: "international_shipping" }), ...row(3, { cost_amount_3: "0" }) }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value.map((c) => [c.description, c.amount_minor, c.category, c.cost_kind]), [["Card", 10000, "components", "estimated"], ["Freight", 250075, "international_shipping", "estimated"], ["Card", 0, "components", "estimated"]]);
  });

  test("a half-filled row is an error on that row's own field, and nothing is accepted", () => {
    const missingAmount = v.parseNewOrderCosts(form({ ...row(0), ...row(1, { cost_amount_1: "" }) }));
    assert.equal(missingAmount.ok, false);
    assert.deepEqual(Object.keys(missingAmount.errors), ["cost_amount_1"]);
    const missingDescription = v.parseNewOrderCosts(form({ ...row(0, { cost_description_0: "" }) }));
    assert.deepEqual(Object.keys(missingDescription.errors), ["cost_description_0"]);
    assert.equal(v.parseNewOrderCosts(form({ ...row(0, { cost_amount_0: "-1" }) })).ok, false);
  });

  test("rows beyond the limit are not read at all", () => {
    assert.equal(fin.MAX_NEW_ORDER_COSTS, 30);
    const fields = {};
    for (let i = 0; i < 40; i += 1) Object.assign(fields, row(i));
    assert.equal(v.parseNewOrderCosts(form(fields)).value.length, 30);
  });
});

describe("the completion date confirmation", { skip }, () => {
  const now = new Date("2026-11-24T10:00:00Z");

  test("a Qatar local date and time becomes the exact instant (UTC+3, no daylight saving)", () => {
    const ok = v.parseCompletionVerification(form({ completed_at: "2026-05-01T14:30", reason: "from the signed delivery note" }), now);
    assert.equal(ok.ok, true);
    assert.equal(ok.value.completedAt, "2026-05-01T11:30:00.000Z");
    const midnight = v.parseCompletionVerification(form({ completed_at: "2026-01-01T00:15", reason: "customer message" }), now);
    assert.equal(midnight.value.completedAt, "2025-12-31T21:15:00.000Z", "just after Qatar midnight is still the previous day in UTC");
  });

  test("a future date, a malformed one, an impossible one and a missing reason are all refused", () => {
    assert.equal(v.parseCompletionVerification(form({ completed_at: "2027-01-01T10:00", reason: "later" }), now).ok, false);
    assert.equal(v.parseCompletionVerification(form({ completed_at: "yesterday", reason: "later" }), now).ok, false);
    assert.equal(v.parseCompletionVerification(form({ completed_at: "2026-02-30T10:00", reason: "later" }), now).ok, false);
    const noReason = v.parseCompletionVerification(form({ completed_at: "2026-05-01T14:30", reason: "" }), now);
    assert.equal(noReason.ok, false);
    assert.ok("reason" in noReason.errors);
  });
});

describe("the messages staff read after a cost action", { skip }, () => {
  test("each says what happened, and a repeat is said to be already saved", () => {
    assert.match(outcomes.COST_SAVED, /cost/i);
    assert.match(outcomes.COST_ALREADY_SAVED, /already/i);
    assert.match(outcomes.COSTS_MARKED_COMPLETE, /complete/i);
    assert.match(outcomes.COSTS_REOPENED, /reopen|incomplete/i);
    assert.match(outcomes.COMPLETION_VERIFIED, /completion/i);
  });
});
