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
import { duplicateWarning, orderSuccessMessage, paymentSuccessMessage } from "./outcomes";
import { isUuid, parseExpectedPaid, parseIdempotencyKey, parseOrder, parsePayment, STALE_FORM_MESSAGE } from "./validation";

export type Revalidate = (path: string) => void;

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export async function createOrderWork(api: Pick<StaffApi, "similarOrders" | "createOrder">, formData: FormData, revalidate: Revalidate): Promise<StaffFormState> {
  const customerId = field(formData, "customer_id");
  if (!isUuid(customerId)) return { status: "error", fieldErrors: { customer_id: "Choose the customer first." } };
  const parsed = parseOrder(formData, customerId);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
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
  // The order's total is worked out by the database from these lines; the form never supplies it. A repeat with the
  // same key (a double click, a retry after a timeout) returns the order that was already created and says so.
  const { id, replayed } = await api.createOrder(parsed.value.customerId, parsed.value.items, parsed.value.deliveryMethod, parsed.value.deliveryAddress, idempotencyKey);
  revalidate("/admin/orders");
  return { status: "success", message: orderSuccessMessage(replayed), href: `/admin/orders/${id}` };
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
