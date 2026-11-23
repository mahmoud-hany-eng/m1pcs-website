/**
 * The state of the Pricing & Rewards section of the order form, and what it works out from it. Pure functions with no React and no server
 * imports, so the rules the screen follows are unit-tested directly (supabase/tests/pricing-lib.test.mjs) and the component stays thin.
 *
 * The screen is ADVICE; the database is the authority. Every figure shown here is computed again by `admin.create_order` from the order's items,
 * the customer's own ledger and the owner's policies, and the order is refused if the database's net payable amount or deposit differs from the
 * ones this module hands the form (`expectedNet`, `expectedDeposit`).
 */
import { parseQarToMinor } from "@/lib/platform/money";
import {
  computePricing,
  pointsEarned,
  type DepositPolicy,
  type DiscountRequest,
  type PricingFigures,
  type PricingResult,
} from "@/lib/platform/pricing";
import type { OrderPricingContext } from "./types";
import { parsePercentToBps } from "./validation";

export type DiscountMode = "none" | "fixed" | "percent";

/** What the staff member has typed and switched in the section. Text stays text until it is understood. */
export interface PricingFormState {
  discountMode: DiscountMode;
  discountAmount: string;
  discountPercent: string;
  discountReason: string;
  /** The "Redeem loyalty points" switch. */
  redeemOn: boolean;
  points: string;
}

export const EMPTY_PRICING_FORM: PricingFormState = { discountMode: "none", discountAmount: "", discountPercent: "", discountReason: "", redeemOn: false, points: "" };

/** What admin.order_pricing_context told the page about this customer and this staff member. */
export interface PricingContextView {
  pointValueMinor: number | null;
  /** Null when the signed-in person may neither redeem points nor read the loyalty ledger. */
  pointsBalance: number | null;
  canDiscount: boolean;
  canRedeem: boolean;
  /** False while the loyalty earning rule is not one that counts only payable money (discounts and redemption are switched off). */
  pricingEnabled: boolean;
  earnQarPerPointMinor: number | null;
  depositPolicy: DepositPolicy | null;
}

/** The database's answer (snake case) in the shape the form uses. */
export function toContextView(ctx: OrderPricingContext): PricingContextView {
  return {
    pointValueMinor: ctx.point_value_minor,
    pointsBalance: ctx.points_balance,
    canDiscount: ctx.can_discount,
    canRedeem: ctx.can_redeem,
    pricingEnabled: ctx.pricing_enabled,
    earnQarPerPointMinor: ctx.earn_qar_per_point_minor,
    depositPolicy: ctx.deposit_policy,
  };
}

export interface PricingView {
  /** The items give a positive total, so there is something to price. */
  active: boolean;
  /** Why the discount controls are not usable, or null. */
  discountLocked: string | null;
  /** Why the redemption switch is not usable, or null. */
  redeemLocked: string | null;
  /** The customer's points, and what they are worth in minor units (null when the staff member may not see them). */
  pointsAvailable: number | null;
  pointsAvailableMinor: number | null;
  discountError: string | null;
  reasonError: string | null;
  pointsError: string | null;
  /** A control that must still be filled in before the order can be created (no error text: it is simply unfinished). */
  incomplete: boolean;
  /** Everything the database will be told, worked out from the valid parts of the form. Null until there is a positive total. */
  result: PricingResult | null;
  figures: PricingFigures | null;
  /** Points the customer would earn on completion, on the net payable amount only. */
  pointsToEarn: number | null;
  canSubmit: boolean;
  /** Why the order cannot be created yet, in words, or null. */
  submitHint: string | null;
  /** The two figures the form sends back, so the database can check that nobody confirms a price they did not see. */
  expectedNet: string;
  expectedDeposit: string;
}

const isDigits = (value: string): boolean => /^[0-9]{1,9}$/.test(value);

/** The discount the form describes, with the reason it is not (yet) a valid one. */
function readDiscount(form: PricingFormState, locked: boolean): { discount: DiscountRequest | null; error: string | null; reasonError: string | null; incomplete: boolean } {
  if (locked || form.discountMode === "none") return { discount: null, error: null, reasonError: null, incomplete: false };
  let discount: DiscountRequest | null = null;
  let error: string | null = null;
  let incomplete = false;
  if (form.discountMode === "fixed") {
    const text = form.discountAmount.trim();
    if (text === "") incomplete = true;
    else {
      const minor = parseQarToMinor(text);
      if (minor === null || minor < 1) error = "Enter the discount in QAR, like 100 or 100.50.";
      else discount = { mode: "fixed", amountMinor: minor };
    }
  } else {
    const text = form.discountPercent.trim();
    if (text === "") incomplete = true;
    else {
      const bps = parsePercentToBps(text);
      if (bps === null || bps < 1) error = "Enter a percentage from 0.01 to 100, with at most two decimals.";
      else discount = { mode: "percent", percentBps: bps };
    }
  }
  const reason = form.discountReason.trim();
  let reasonError: string | null = null;
  if (reason === "") incomplete = true;
  else if (reason.length < 3) reasonError = "Give a reason of at least 3 characters. It is kept with the record of who authorized the discount.";
  else if (reason.length > 500) reasonError = "The reason is too long (at most 500 characters).";
  return { discount, error, reasonError, incomplete };
}

export function derivePricingView(form: PricingFormState, grossMinor: number | null, context: PricingContextView): PricingView {
  const pointValue = context.pointValueMinor ?? 0;
  const discountLocked = !context.canDiscount
    ? "Discounts can be applied by the owner only."
    : !context.pricingEnabled
      ? "Discounts are switched off until the owner sets the loyalty earning rule to count only the amount actually payable."
      : null;
  const available = context.pointsBalance;
  const redeemLocked = !context.canRedeem
    ? "Loyalty redemption can be applied by the owner only."
    : !context.pricingEnabled
      ? "Redemption is switched off until the owner sets the loyalty earning rule to count only the amount actually payable."
      : available === null || pointValue < 1
        ? "This customer's points could not be read."
        : available <= 0
          ? "This customer has no loyalty points to redeem."
          : null;

  const base: PricingView = {
    active: false,
    discountLocked,
    redeemLocked,
    pointsAvailable: available,
    pointsAvailableMinor: available === null ? null : available * pointValue,
    discountError: null,
    reasonError: null,
    pointsError: null,
    incomplete: false,
    result: null,
    figures: null,
    pointsToEarn: null,
    canSubmit: false,
    submitHint: "Add at least one priced item.",
    expectedNet: "",
    expectedDeposit: "",
  };
  if (grossMinor === null || grossMinor <= 0) return base;

  const read = readDiscount(form, discountLocked !== null);
  // Points: only while the switch is on and usable. A blank box is "not chosen yet", never zero.
  let pointsToRedeem = 0;
  let pointsError: string | null = null;
  let pointsIncomplete = false;
  if (form.redeemOn && redeemLocked === null) {
    const text = form.points.trim();
    if (text === "") pointsIncomplete = true;
    else if (!isDigits(text)) pointsError = "Enter a whole number of points.";
    else if (Number(text) < 1) pointsError = "Enter at least 1 point, or switch redemption off.";
    else pointsToRedeem = Number(text);
  }

  const result = computePricing({
    grossMinor,
    discount: read.discount,
    pointsToRedeem,
    pointsBalance: available ?? 0,
    pointValueMinor: pointValue,
    depositPolicy: context.depositPolicy,
  });
  const figures = result.figures;
  const incomplete = read.incomplete || pointsIncomplete;
  const inputError = read.error ?? read.reasonError ?? pointsError;
  const canSubmit = result.ok && !incomplete && inputError === null;
  let submitHint: string | null = null;
  if (!result.ok) submitHint = result.problem;
  else if (inputError) submitHint = inputError;
  else if (read.incomplete) submitHint = form.discountMode === "none" ? null : "Finish the discount (amount and reason), or choose No discount.";
  else if (pointsIncomplete) submitHint = "Choose how many points to redeem, or switch redemption off.";

  return {
    ...base,
    active: true,
    discountError: read.error,
    reasonError: read.reasonError,
    pointsError,
    incomplete,
    result,
    figures,
    pointsToEarn: figures && context.earnQarPerPointMinor ? pointsEarned(Math.max(figures.netPayableMinor, 0), context.earnQarPerPointMinor) : null,
    canSubmit,
    submitHint,
    expectedNet: canSubmit && figures ? String(figures.netPayableMinor) : "",
    expectedDeposit: canSubmit && figures ? String(figures.depositMinor) : "",
  };
}
