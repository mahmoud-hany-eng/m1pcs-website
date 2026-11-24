/**
 * Plain, shared helpers for the finance screens: the cost categories, the wording of the cost and profit states, and how a margin is
 * written. No server imports, so both the server pages and the browser forms use the same words and the tests can check them.
 * Money is integer QAR minor units everywhere; nothing here does floating-point money arithmetic.
 */
import { formatQar } from "@/lib/platform/money";
import type { CostCategory, CostKind, CostState, OrderCostRevision, ProfitState } from "./types";

export const COST_CATEGORIES: readonly { value: CostCategory; label: string }[] = [
  { value: "components", label: "Components / supplier purchases" },
  { value: "international_shipping", label: "International shipping" },
  { value: "customs_duties", label: "Customs and import duties" },
  { value: "assembly", label: "Assembly expenses" },
  { value: "local_delivery", label: "Local delivery" },
  { value: "payment_processing", label: "Payment processing charges" },
  { value: "other", label: "Other direct order expenses" },
];
export const COST_KINDS: readonly { value: CostKind; label: string }[] = [
  { value: "estimated", label: "Estimated" },
  { value: "actual", label: "Actual" },
];
export const MAX_NEW_ORDER_COSTS = 30;

export const costCategoryLabel = (category: string): string => COST_CATEGORIES.find((c) => c.value === category)?.label ?? category;
export const costKindLabel = (kind: string): string => COST_KINDS.find((c) => c.value === kind)?.label ?? kind;

/** "Costs incomplete" covers both an order with some entries and one with none: the second says so, because it is a different problem. */
export function costStateLabel(state: CostState): string {
  return state === "complete" ? "Costs complete" : state === "incomplete" ? "Costs incomplete" : "No costs recorded";
}
export function profitStateLabel(state: ProfitState): string {
  switch (state) {
    case "verified":
      return "Verified: every completed order has complete costs";
    case "provisional":
      return "Provisional: some completed orders have incomplete or no costs";
    case "unavailable":
      return "Not available: no completed order has a cost recorded";
    default:
      return "No completed orders in this period";
  }
}

/** A margin in basis points as a percentage with one decimal ("12.5%"). Null is shown as a dash. Negative margins are legitimate. */
export function marginText(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  const tenths = Math.round(Math.abs(bps) / 10);
  // A margin that rounds to nothing is "0.0%", never "-0.0%".
  return `${bps < 0 && tenths > 0 ? "-" : ""}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? "";

/** The reporting year and month from a query string. Anything else is ignored (the database then uses the current Qatar year / all months). */
export function parseReportParams(year: string | undefined, month: string | undefined): { year: number | null; month: number | null } {
  const y = year && /^[0-9]{4}$/.test(year) && Number(year) >= 2020 && Number(year) <= 2100 ? Number(year) : null;
  const m = month && /^[0-9]{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12 ? Number(month) : null;
  return { year: y, month: m };
}

const FIELD_LABEL: Record<string, string> = {
  category: "Category",
  description: "Description",
  amount_minor: "Amount",
  cost_kind: "Estimated or actual",
  supplier_ref: "Supplier or reference",
  incurred_on: "Date",
  notes: "Private note",
  status: "Status",
};
function fieldText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (key === "amount_minor" && typeof value === "number") return formatQar(value);
  if (key === "category") return costCategoryLabel(String(value));
  if (key === "cost_kind") return costKindLabel(String(value));
  if (key === "status") return value === "voided" ? "removed from the totals" : "counted";
  return String(value);
}

/** What one history row changed, in plain words: the old value and the new one for every field that differs. Never omits a change. */
export function describeRevision(rev: Pick<OrderCostRevision, "action" | "old_values" | "new_values">): string[] {
  const fresh = rev.new_values ?? {};
  const old = rev.old_values ?? {};
  switch (rev.action) {
    case "marked_complete":
      return ["Costs declared complete"];
    case "marked_incomplete":
      return ["Costs reopened"];
    case "created": {
      const amount = typeof fresh.amount_minor === "number" ? formatQar(fresh.amount_minor) : "";
      return [`Added: ${fieldText("description", fresh.description)}, ${amount}, ${fieldText("category", fresh.category)} (${fieldText("cost_kind", fresh.cost_kind).toLowerCase()})`];
    }
    case "voided":
      return [`Removed from the totals: ${fieldText("description", old.description)}, ${typeof old.amount_minor === "number" ? formatQar(old.amount_minor) : ""}`];
    default: {
      const lines: string[] = [];
      for (const key of Object.keys(FIELD_LABEL)) {
        if (JSON.stringify(old[key] ?? null) !== JSON.stringify(fresh[key] ?? null)) lines.push(`${FIELD_LABEL[key]}: ${fieldText(key, old[key])} → ${fieldText(key, fresh[key])}`);
      }
      return lines.length ? lines : ["Saved with no change in value"];
    }
  }
}
