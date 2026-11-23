/**
 * Order pricing, as the screens show it: gross order value, discount, loyalty credit, net payable amount, the deposit and the cash that is
 * still to pay after it. Plain TypeScript with no imports beyond the money helper, so it also runs, unchanged, under the local test runner.
 *
 * THE DATABASE DECIDES. Every figure here is computed again by `private.order_pricing_quote` inside `admin.create_order`, from the order's own
 * items, the customer's own ledger and the owner's own policies, and the order is refused if the database's answer is not the one the screen
 * showed (the form sends the net payable amount and the deposit it displayed). This module exists so the staff member sees the figures change
 * as they type, and so the same words explain a refusal everywhere. A test (supabase/tests/pricing-lib.test.mjs) runs this code and the SQL
 * side by side over a grid of orders and requires them to agree to the minor unit.
 *
 * The rules (all in integer QAR minor units, 1 QAR = 100):
 *   deposit            taken from the ORIGINAL GROSS total, whatever the discount or the redemption (policy `orders.deposit`)
 *   discount           a fixed amount, or a percentage of the gross rounded to the nearest 0.01 (a half rounds up); never more than the gross
 *   loyalty credit     points x the point value; never more than the balance, never more than what is left after the discount
 *   net payable        gross - discount - credit
 *   cash after deposit net payable - deposit
 *   blocked            a net payable below the cash deposit is NOT allowed (a policy decision for the owner): the deposit is not lowered
 *                      silently, no payment is invented and no inconsistent order is created
 *   points earned      floor(net payable / earn rate): never on discounted or credited money
 */

export interface DepositTier {
  up_to_minor?: number;
  percent_bps?: number;
  fixed_minor?: number;
}
/** The value of the `orders.deposit` policy, as the database stores it. */
export interface DepositPolicy {
  mode?: "unconfigured" | "percent" | "fixed" | "tiered";
  percent_bps?: number;
  fixed_minor?: number;
  minimum_minor?: number;
  tiers?: DepositTier[];
  required_before_status?: string;
}

export interface DepositQuote {
  amountMinor: number;
  /** The percentage in basis points, or null for a fixed amount. */
  rateBps: number | null;
  /** 1-based tier that applied, when the schedule is tiered. */
  tier: number | null;
  tierCount: number | null;
}

/** Whole amount, half rounding up, in BigInt so no intermediate product can lose precision. */
function percentOf(totalMinor: number, bps: number): number {
  return Number((BigInt(totalMinor) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
}

/** The deposit for an order's GROSS total under the policy, or null when the policy is missing or not configured. Mirrors private.deposit_quote. */
export function depositQuote(grossMinor: number, policy: DepositPolicy | null | undefined): DepositQuote | null {
  if (!policy || !Number.isSafeInteger(grossMinor) || grossMinor < 0) return null;
  const mode = policy.mode ?? "percent";
  if (mode === "unconfigured") return null;
  const floorMinor = policy.minimum_minor ?? 0;
  let wanted = 0;
  let rateBps: number | null = null;
  let tier: number | null = null;
  let tierCount: number | null = null;
  if (mode === "percent") {
    rateBps = policy.percent_bps ?? 0;
    wanted = percentOf(grossMinor, rateBps);
  } else if (mode === "fixed") {
    wanted = policy.fixed_minor ?? 0;
  } else {
    const tiers = policy.tiers ?? [];
    tierCount = tiers.length;
    const index = tiers.findIndex((t) => t.up_to_minor === undefined || t.up_to_minor === null || grossMinor <= t.up_to_minor);
    if (index < 0) return null;
    tier = index + 1;
    const chosen = tiers[index];
    if (chosen.fixed_minor !== undefined) {
      wanted = chosen.fixed_minor;
    } else {
      rateBps = chosen.percent_bps ?? 0;
      wanted = percentOf(grossMinor, rateBps);
    }
  }
  return { amountMinor: Math.min(grossMinor, Math.max(floorMinor, wanted)), rateBps, tier, tierCount };
}

export type DiscountRequest = { mode: "fixed"; amountMinor: number } | { mode: "percent"; percentBps: number };

/** The discount in minor units for a gross total (a percentage is rounded to the nearest 0.01, a half rounding up). */
export function discountAmount(grossMinor: number, discount: DiscountRequest | null): number {
  if (!discount) return 0;
  return discount.mode === "fixed" ? discount.amountMinor : percentOf(grossMinor, discount.percentBps);
}

/** Loyalty points earned on a net payable amount: one point per `qarPerPointMinor`, rounded down. */
export function pointsEarned(netPayableMinor: number, qarPerPointMinor: number): number {
  if (!Number.isSafeInteger(netPayableMinor) || netPayableMinor < 0 || !Number.isSafeInteger(qarPerPointMinor) || qarPerPointMinor < 1) return 0;
  return Math.floor(netPayableMinor / qarPerPointMinor);
}

/** The most points that can be redeemed: never more than the balance, never more than what is left to pay after the discount. */
export function maxRedeemablePoints(afterDiscountMinor: number, pointsBalance: number, pointValueMinor: number): number {
  if (pointValueMinor < 1 || afterDiscountMinor < 0 || pointsBalance < 0) return 0;
  return Math.min(pointsBalance, Math.floor(afterDiscountMinor / pointValueMinor));
}

export interface PricingInput {
  grossMinor: number;
  discount: DiscountRequest | null;
  /** Points the staff member asked to redeem (0 for none). */
  pointsToRedeem: number;
  /** The customer's points available now. */
  pointsBalance: number;
  pointValueMinor: number;
  depositPolicy: DepositPolicy | null | undefined;
}

export interface PricingFigures {
  grossMinor: number;
  discountMinor: number;
  afterDiscountMinor: number;
  pointsRedeemed: number;
  creditMinor: number;
  netPayableMinor: number;
  depositMinor: number;
  depositRateBps: number | null;
  depositTier: number | null;
  /** Cash still to pay once the deposit is paid. */
  cashBalanceAfterDepositMinor: number;
  pointsBalanceAfter: number;
  /** The most points that could be redeemed against this order (balance and price permitting). */
  maxPoints: number;
  /** The most points that could be redeemed while still leaving at least the deposit to pay in cash. */
  maxPointsKeepingDeposit: number;
}

export type PricingProblemCode =
  | "no_deposit_policy"
  | "discount_exceeds_total"
  | "points_exceed_balance"
  | "credit_exceeds_remaining"
  | "net_below_deposit";

export type PricingResult =
  | { ok: true; figures: PricingFigures }
  | { ok: false; code: PricingProblemCode; problem: string; figures: PricingFigures | null };

const qar = (minor: number): string => `QAR ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Works out the order's money and refuses what the owner's rules forbid, with the reason in words. The messages match the database's, so a
 * refusal on the screen and a refusal from the server read the same.
 */
export function computePricing(input: PricingInput): PricingResult {
  const { grossMinor, discount, pointsToRedeem, pointsBalance, pointValueMinor, depositPolicy } = input;
  const dq = depositQuote(grossMinor, depositPolicy);
  if (!dq) {
    return { ok: false, code: "no_deposit_policy", problem: "The deposit schedule has not been configured by the owner, so this order cannot be priced yet.", figures: null };
  }
  const discountMinor = discountAmount(grossMinor, discount);
  const afterDiscountMinor = grossMinor - discountMinor;
  const maxPoints = maxRedeemablePoints(Math.max(afterDiscountMinor, 0), pointsBalance, pointValueMinor);
  // Points that keep at least the deposit payable in cash: net = after - points*value >= deposit
  const roomForCredit = afterDiscountMinor - dq.amountMinor;
  const maxPointsKeepingDeposit = roomForCredit < 0 || pointValueMinor < 1 ? 0 : Math.min(maxPoints, Math.floor(roomForCredit / pointValueMinor));
  const creditMinor = pointsToRedeem * pointValueMinor;
  const netPayableMinor = afterDiscountMinor - creditMinor;
  const figures: PricingFigures = {
    grossMinor,
    discountMinor,
    afterDiscountMinor,
    pointsRedeemed: pointsToRedeem,
    creditMinor,
    netPayableMinor,
    depositMinor: dq.amountMinor,
    depositRateBps: dq.rateBps,
    depositTier: dq.tier,
    cashBalanceAfterDepositMinor: netPayableMinor - dq.amountMinor,
    pointsBalanceAfter: pointsBalance - pointsToRedeem,
    maxPoints,
    maxPointsKeepingDeposit,
  };
  if (discountMinor > grossMinor) {
    return { ok: false, code: "discount_exceeds_total", problem: `The discount (${qar(discountMinor)}) is more than the order total (${qar(grossMinor)}).`, figures };
  }
  if (pointsToRedeem > pointsBalance) {
    return { ok: false, code: "points_exceed_balance", problem: `This customer has ${pointsBalance} points, so ${pointsToRedeem} cannot be redeemed.`, figures };
  }
  if (creditMinor > afterDiscountMinor) {
    return {
      ok: false,
      code: "credit_exceeds_remaining",
      problem: `The points are worth ${qar(creditMinor)}, which is more than the ${qar(afterDiscountMinor)} left to pay after the discount. Redeem at most ${maxPoints} points.`,
      figures,
    };
  }
  if (netPayableMinor < dq.amountMinor) {
    return {
      ok: false,
      code: "net_below_deposit",
      problem:
        `The discount and loyalty credit leave ${qar(netPayableMinor)} to pay, which is less than the ${qar(dq.amountMinor)} cash deposit worked out from the original order total (${qar(grossMinor)}). ` +
        "The deposit is not lowered automatically and no payment can be invented, so this order cannot be created like this. The owner has to decide how such an order is treated.",
      figures,
    };
  }
  return { ok: true, figures };
}

// ---------------------------------------------------------------------------------------------------------------
// The statement of an order: how the discount and the loyalty credit appear, for the customer and for staff.
// ---------------------------------------------------------------------------------------------------------------

export interface OrderMoney {
  total_minor: number;
  discount_minor?: number | null;
  loyalty_points_redeemed?: number | null;
  loyalty_credit_minor?: number | null;
  net_payable_minor?: number | null;
  deposit_required_minor: number;
  amount_paid_minor: number;
  balance_due_minor: number;
}

export interface StatementLine {
  key: "gross" | "discount" | "credit" | "net" | "paid" | "balance";
  label: string;
  /** The amount as it is added to the order: discounts and credit are negative. */
  amountMinor: number;
  /** A short explanation shown under the label. */
  note?: string;
  emphasis?: boolean;
}

/**
 * THE statement. A receipt or a customer statement shows these lines, in this order, and nothing else is called a payment:
 *   Order value (before discount)        the gross value, which never changes
 *   Discount                              only when there is one
 *   Loyalty credit (N points)             only when points were redeemed: a credit, not a payment
 *   Total payable                         what the customer pays in cash or Fawran
 *   Paid so far                           cash or Fawran actually received
 *   Balance due                           still to pay
 * The deposit is a rule about the order value before discount; it is shown separately by the caller (it is not a line of the sum).
 */
export function orderStatement(order: OrderMoney): StatementLine[] {
  const discount = order.discount_minor ?? 0;
  const credit = order.loyalty_credit_minor ?? 0;
  const points = order.loyalty_points_redeemed ?? 0;
  const net = order.net_payable_minor ?? order.total_minor - discount - credit;
  const lines: StatementLine[] = [{ key: "gross", label: discount > 0 || credit > 0 ? "Order value (before discount)" : "Order total", amountMinor: order.total_minor }];
  if (discount > 0) lines.push({ key: "discount", label: "Discount", amountMinor: -discount });
  if (credit > 0) {
    lines.push({ key: "credit", label: `Loyalty credit (${points.toLocaleString("en-US")} ${points === 1 ? "point" : "points"})`, amountMinor: -credit, note: "Points used as a credit on this order. Not a payment." });
  }
  if (discount > 0 || credit > 0) lines.push({ key: "net", label: "Total payable", amountMinor: net, emphasis: true });
  lines.push({ key: "paid", label: "Paid so far", amountMinor: order.amount_paid_minor, note: "Cash or Fawran received." });
  lines.push({ key: "balance", label: "Balance due", amountMinor: order.balance_due_minor, emphasis: true });
  return lines;
}
