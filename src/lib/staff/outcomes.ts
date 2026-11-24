/**
 * What the screen says after a staff action, in one place. Every sentence here must be TRUE: "nothing was changed" only
 * where the database rolled back or COMMIT was never sent, "recorded" only where a record now exists, and "already recorded"
 * where the answer was a repeat. Pure functions over the gateway's error classes and plain data, so a test can check each
 * sentence against the situation that produces it.
 */
import { formatQar } from "@/lib/platform/money";
import { StaffOperationError, StaffOutcomeUnknownError, StaffPermissionError, StaffUnavailableError, UNEXPECTED } from "./gateway";
import type { DuplicateOrderEvidence, StaffFormState } from "./form-state";
import { ageText } from "./format";

export const DENIED = "You do not have permission to do that.";

/** A failure as form state. Business-rule messages are written for staff; anything else is a fixed sentence. */
export function failureState(error: unknown): StaffFormState {
  if (error instanceof StaffPermissionError) return { status: "error", message: DENIED };
  if (error instanceof StaffOperationError) return { status: "error", message: error.message, ...(error.retireKey ? { keyRetired: true } : {}) };
  // The connection failed after COMMIT was sent: the message says the result is unknown. The key is KEPT, so sending the same form again is a repeat.
  if (error instanceof StaffOutcomeUnknownError) return { status: "error", message: error.message };
  if (error instanceof StaffUnavailableError) return { status: "error", message: error.message };
  return { status: "error", message: UNEXPECTED };
}

export const PAYMENT_RECORDED = "Payment recorded. A receipt number was generated.";
export const PAYMENT_ALREADY_RECORDED = "This payment was already recorded earlier, so nothing new was recorded. It is in the payments list below.";
export const paymentSuccessMessage = (replayed: boolean): string => (replayed ? PAYMENT_ALREADY_RECORDED : PAYMENT_RECORDED);

export const ORDER_CREATED = "Order created. The deposit is fixed when you confirm it.";
export const ORDER_ALREADY_CREATED = "This order was already created earlier, so no second order was made. Opening it now.";
export const orderSuccessMessage = (replayed: boolean): string => (replayed ? ORDER_ALREADY_CREATED : ORDER_CREATED);

export interface SimilarOrderRow {
  order_id: string;
  order_ref: string;
  status: string;
  total_minor: number;
  created_at: string;
}

/**
 * The non-blocking duplicate-order warning. Nothing was created. The person may tick the box and create the order anyway:
 * a customer can legitimately buy the same thing twice.
 */
export function duplicateWarning(similar: readonly SimilarOrderRow[], now: Date = new Date()): StaffFormState {
  const evidence: DuplicateOrderEvidence[] = similar.map((o) => ({ id: o.order_id, ref: o.order_ref, status: o.status, totalMinor: o.total_minor, createdAt: o.created_at }));
  const list = similar.map((o) => `${o.order_ref} (${formatQar(o.total_minor)}, created ${ageText(o.created_at, now)})`).join("; ");
  const what = similar.length === 1 ? "an order" : `${similar.length} orders`;
  return {
    status: "error",
    message: `This submission did not create an order. This customer already has ${what} with the same items from the last 24 hours: ${list}. If they really want another one, tick the box below and create the order again.`,
    duplicates: evidence,
  };
}

export const COST_SAVED = "Cost saved. The order's costs were recalculated.";
export const COST_ALREADY_SAVED = "This cost was already saved earlier, so nothing new was saved. It is in the list below.";
export const costSavedMessage = (replayed: boolean): string => (replayed ? COST_ALREADY_SAVED : COST_SAVED);
export const COST_EDITED = "Cost updated. The previous value is kept in the history.";
export const COST_ALREADY_EDITED = "This change was already saved earlier, so nothing new was saved.";
export const costEditedMessage = (replayed: boolean): string => (replayed ? COST_ALREADY_EDITED : COST_EDITED);
export const COST_VOIDED = "The cost entry was removed from the totals. It stays in the history.";
export const COST_ALREADY_VOIDED = "This entry was already removed, so nothing was changed.";
export const costVoidedMessage = (replayed: boolean): string => (replayed ? COST_ALREADY_VOIDED : COST_VOIDED);
export const COSTS_MARKED_COMPLETE = "The costs are marked complete. Any later change to them will mark them incomplete again.";
export const COSTS_REOPENED = "The costs are marked incomplete again.";
export const COMPLETION_VERIFIED = "The completion date was recorded. It cannot be changed.";
export const ORDER_CREATED_WITH_COSTS = "Order created, with its private costs. The deposit is fixed when you confirm it.";
