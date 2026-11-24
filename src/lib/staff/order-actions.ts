/**
 * The bodies of the two money-creating staff actions (create an order, record a payment), separated from the Server Action shell so
 * that a test can run them against the real gateway and database. The shell (actions.ts) adds the session guard, the permission
 * check and the error-to-message mapping (outcomes.ts); these functions hold what the action DECIDES: which form is stale, when the
 * duplicate-order warning is shown, which message a first save or a repeat gets, and which pages to refresh.
 * They take the typed API and a `revalidate` callback, so they import nothing from Next.js.
 */
import type { StaffApi } from "./api";
import { StaffPermissionError } from "./gateway";
import type { StaffFormState } from "./form-state";
import { duplicateWarning, ORDER_ALREADY_CREATED, ORDER_CREATED_WITH_COSTS, orderSuccessMessage, paymentSuccessMessage } from "./outcomes";
import { isUuid, parseExpectedPaid, parseIdempotencyKey, parseNewOrderCosts, parseOrder, parsePayment, parsePricing, STALE_FORM_MESSAGE } from "./validation";

export type Revalidate = (path: string) => void;

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export async function createOrderWork(api: Pick<StaffApi, "similarOrders" | "createOrderPriced" | "createOrderCosted">, formData: FormData, revalidate: Revalidate): Promise<StaffFormState> {
  const customerId = field(formData, "customer_id");
  if (!isUuid(customerId)) return { status: "error", fieldErrors: { customer_id: "Choose the customer first." } };
  const parsed = parseOrder(formData, customerId);
  // The Pricing & Rewards fields are read in the same pass, so one answer carries every field error the form has.
  const pricing = parsePricing(formData);
  // The optional private cost rows (owner only; the database refuses them for anyone else). A form without any is an ordinary order.
  const costs = parseNewOrderCosts(formData);
  if (!parsed.ok || !pricing.ok || !costs.ok) {
    if (!pricing.ok && "stale" in pricing && parsed.ok && costs.ok) return { status: "error", message: STALE_FORM_MESSAGE };
    return {
      status: "error",
      fieldErrors: { ...(parsed.ok ? {} : parsed.errors), ...(!pricing.ok && "errors" in pricing ? pricing.errors : {}), ...(costs.ok ? {} : costs.errors) },
    };
  }
  const idempotencyKey = parseIdempotencyKey(formData);
  if (!idempotencyKey) return { status: "error", message: STALE_FORM_MESSAGE };
  // A WARNING, never a block: if this customer already has an order with the same items from the last day, say so and
  // create nothing until the person confirms. A customer can legitimately buy the same thing twice, so confirming always
  // works. The order this key already created is not reported (a retry is answered by the database below). The check is
  // advice: if it cannot run, the order is still created.
  if (field(formData, "confirm_duplicate") !== "yes") {
    let similar: Awaited<ReturnType<StaffApi["similarOrders"]>> = [];
    try {
      similar = await api.similarOrders(parsed.value.customerId, parsed.value.items, idempotencyKey);
    } catch (error) {
      if (error instanceof StaffPermissionError) throw error;
    }
    if (similar.length) return duplicateWarning(similar);
  }
  // The order's total is worked out by the database from these lines; the form never supplies it. The discount and the points are
  // applied in the same transaction as the order, owner only (the database checks the permission), and the order is refused if the
  // net payable amount or the deposit the person saw is not what the database now works out. A repeat with the same key (a double
  // click, a retry after a timeout) returns the order that was already created, spends the points once, and says so.
  // An order without costs goes through the same statement as before; one with costs saves them in the same transaction (all or nothing).
  const { id, replayed } = costs.value.length
    ? await api.createOrderCosted(
        parsed.value.customerId, parsed.value.items, parsed.value.deliveryMethod, parsed.value.deliveryAddress, idempotencyKey,
        pricing.value.discount, pricing.value.redeemPoints, pricing.value.expectedNetMinor, pricing.value.expectedDepositMinor, costs.value,
      )
    : await api.createOrderPriced(
        parsed.value.customerId, parsed.value.items, parsed.value.deliveryMethod, parsed.value.deliveryAddress, idempotencyKey,
        pricing.value.discount, pricing.value.redeemPoints, pricing.value.expectedNetMinor, pricing.value.expectedDepositMinor,
      );
  revalidate("/admin/orders");
  return { status: "success", message: replayed ? ORDER_ALREADY_CREATED : costs.value.length ? ORDER_CREATED_WITH_COSTS : orderSuccessMessage(replayed), href: `/admin/orders/${id}` };
}

export async function recordPaymentWork(api: Pick<StaffApi, "recordPayment">, formData: FormData, revalidate: Revalidate): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  if (!isUuid(orderId)) return { status: "error", message: "That record could not be found." };
  const parsed = parsePayment(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
  const { purpose, amountMinor, method, reference, notes } = parsed.value;
  const idempotencyKey = parseIdempotencyKey(formData);
  if (!idempotencyKey) return { status: "error", message: STALE_FORM_MESSAGE };
  // The amount already paid that the person was looking at. The database refuses the payment if the real balance differs.
  const expectedPaid = parseExpectedPaid(formData);
  if (expectedPaid === null) return { status: "error", message: STALE_FORM_MESSAGE };
  // A repeat with the same key records nothing and returns the payment that was already recorded (and says so), unless that
  // payment has since been reversed or the repeat is more than an hour old: then it is refused and says why.
  const { replayed } = await api.recordPayment(orderId, purpose, amountMinor, method, reference, notes, idempotencyKey, expectedPaid);
  revalidate(`/admin/orders/${orderId}`);
  revalidate("/admin/payments");
  revalidate("/admin");
  return { status: "success", message: paymentSuccessMessage(replayed) };
}
