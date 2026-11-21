"use server";
import "server-only";

/**
 * Server Actions for the admin area. Every action, without exception:
 *   1. goes through `requireStaff`, which answers 404 when the admin area is off or the person is not staff, sends
 *      a signed-out person to sign in and an aal1 person to the second-factor page;
 *   2. validates its input on the server, whatever the browser did, and never takes a person's identity, a role, a
 *      receipt number, a total or a balance from the form (those come from the session and the database);
 *   3. calls ONE staff function through the gateway, which authorizes again in PostgreSQL;
 *   4. returns a fixed message or a business-rule message written for staff, never a raw database error.
 * Server Actions are POST only and Next.js checks the request origin against the host (the CSRF defence).
 */
import { revalidatePath } from "next/cache";
import { formatQar } from "@/lib/platform/money";
import type { StaffContext } from "./session";
import { requireStaff } from "./session";
import { StaffOperationError, StaffPermissionError } from "./gateway";
import { echoValues, type StaffFormState } from "./form-state";
import { DENIED, duplicateWarning, failureState, orderSuccessMessage, paymentSuccessMessage } from "./outcomes";
import {
  CLAIM_CODE_HOURS,
  depositPolicyValue,
  isUuid,
  parseCustomer,
  parseDepositSchedule,
  parseExpectedPaid,
  parseIdempotencyKey,
  parseOrder,
  parsePayment,
  parseReason,
  parseTracking,
  STALE_FORM_MESSAGE,
} from "./validation";

const ORDER_STATUS = /^[a-z_]{3,40}$/;

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Runs one action as the verified staff member and turns every failure into a safe message. */
async function run(nextPath: string, permission: string, formData: FormData, work: (ctx: StaffContext) => Promise<StaffFormState>): Promise<StaffFormState> {
  const ctx = await requireStaff(nextPath);
  // Whatever goes wrong, what was typed goes back to the form so a long form is never wiped by an error.
  const failed = (state: StaffFormState): StaffFormState => (state.status === "error" && !state.values ? { ...state, values: echoValues(formData) } : state);
  // The database checks the permission again; this only avoids a round trip and gives a clear message.
  if (!ctx.can(permission)) return failed({ status: "error", message: DENIED });
  try {
    return failed(await work(ctx));
  } catch (error) {
    // Every sentence a person can read here comes from outcomes.ts, where it is checked against the situation behind it.
    return failed(failureState(error));
  }
}

const badId = (): StaffFormState => ({ status: "error", message: "That record could not be found." });

// ---------------------------------------------------------------------------------------------------------------
// Customers and claim codes
// ---------------------------------------------------------------------------------------------------------------

export async function createCustomerAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  return run("/admin/customers/new", "customers.manage", formData, async ({ api }) => {
    const parsed = parseCustomer(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    const id = await api.createCustomer(parsed.value);
    revalidatePath("/admin/customers");
    return { status: "success", message: "Customer record created.", href: `/admin/customers/${id}` };
  });
}

export async function issueClaimCodeAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const customerId = field(formData, "customer_id");
  return run(`/admin/customers/${isUuid(customerId) ? customerId : ""}`, "customers.manage", formData, async ({ api }) => {
    if (!isUuid(customerId)) return badId();
    const hours = Number(field(formData, "hours"));
    if (!(CLAIM_CODE_HOURS as readonly number[]).includes(hours)) return { status: "error", fieldErrors: { hours: "Choose how long the code lasts." } };
    const code = await api.issueClaimCode(customerId, hours);
    revalidatePath(`/admin/customers/${customerId}`);
    // Shown exactly once: only its hash is stored, so it cannot be shown again.
    return { status: "success", message: `Give this code to the customer. It works once and expires in ${hours} hours.`, secret: code };
  });
}

export async function revokeClaimCodeAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const customerId = field(formData, "customer_id");
  const codeId = field(formData, "code_id");
  return run(`/admin/customers/${isUuid(customerId) ? customerId : ""}`, "customers.manage", formData, async ({ api }) => {
    if (!isUuid(customerId) || !isUuid(codeId)) return badId();
    const reason = parseReason(formData);
    if (!reason.ok) return { status: "error", fieldErrors: reason.errors };
    await api.revokeClaimCode(codeId, reason.value);
    revalidatePath(`/admin/customers/${customerId}`);
    return { status: "success", message: "The claim code was revoked." };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Orders and tracking
// ---------------------------------------------------------------------------------------------------------------

export async function createOrderAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const customerId = field(formData, "customer_id");
  return run("/admin/orders/new", "orders.create", formData, async ({ api }) => {
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
      let similar: Awaited<ReturnType<typeof api.similarOrders>> = [];
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
    revalidatePath("/admin/orders");
    return { status: "success", message: orderSuccessMessage(replayed), href: `/admin/orders/${id}` };
  });
}

export async function transitionOrderAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "orders.transition", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const toStatus = field(formData, "to_status");
    if (!ORDER_STATUS.test(toStatus)) return { status: "error", fieldErrors: { to_status: "Choose the new status." } };
    const reasonText = field(formData, "reason");
    if (reasonText.length > 500) return { status: "error", fieldErrors: { reason: "The reason is too long (at most 500 characters)." } };
    await api.transitionOrder(orderId, toStatus, reasonText || null);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: "The status was updated." };
  });
}

export async function publishTrackingAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "tracking.publish", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const parsed = parseTracking(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.publishTracking(orderId, parsed.value.title, parsed.value.message, null);
    revalidatePath(`/admin/orders/${orderId}`);
    return { status: "success", message: "The update is now visible to the customer." };
  });
}

export async function retractTrackingAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  const eventId = field(formData, "event_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "tracking.publish", formData, async ({ api }) => {
    if (!isUuid(orderId) || !isUuid(eventId)) return badId();
    const reason = parseReason(formData);
    if (!reason.ok) return { status: "error", fieldErrors: reason.errors };
    await api.retractTracking(eventId, reason.value);
    revalidatePath(`/admin/orders/${orderId}`);
    return { status: "success", message: "The update was withdrawn. It stays in the history." };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Payments (cash and Fawran). A payment is recorded only by a person confirming receipt.
// ---------------------------------------------------------------------------------------------------------------

export async function recordPaymentAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "payments.record", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
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
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/payments");
    revalidatePath("/admin");
    return { status: "success", message: paymentSuccessMessage(replayed) };
  });
}

export async function reversePaymentAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  const paymentId = field(formData, "payment_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "payments.reverse", formData, async ({ api }) => {
    if (!isUuid(orderId) || !isUuid(paymentId)) return badId();
    const reason = parseReason(formData);
    if (!reason.ok) return { status: "error", fieldErrors: reason.errors };
    if (field(formData, "typed_confirmation") !== "REVERSE") return { status: "error", fieldErrors: { typed_confirmation: "Type REVERSE to confirm." } };
    await api.reversePayment(paymentId, reason.value);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/payments");
    revalidatePath("/admin");
    return { status: "success", message: "The payment was reversed. The original entry stays in the history." };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The deposit schedule
// ---------------------------------------------------------------------------------------------------------------

export async function setDepositScheduleAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  return run("/admin/policies", "policies.manage", formData, async ({ api }) => {
    // The gate status (the status before which a deposit is required) is carried over from the current policy.
    const current = (await api.policies()).find((p) => p.key === "orders.deposit");
    const gate = typeof (current?.value as { required_before_status?: unknown } | undefined)?.required_before_status === "string"
      ? String((current!.value as { required_before_status: string }).required_before_status)
      : "deposit_received";
    const parsed = parseDepositSchedule(formData, gate);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.setPolicy("orders.deposit", depositPolicyValue(parsed.value), "confirmed_by_owner", parsed.value.reason);
    revalidatePath("/admin/policies");
    return {
      status: "success",
      message: "The deposit schedule was saved as a new version. Orders that already have a fixed deposit keep it.",
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// A read-only preview used by the new-order form
// ---------------------------------------------------------------------------------------------------------------

export interface DepositPreviewResult {
  ok: boolean;
  /** Display text, built by the database's own rule. Never a stored value. */
  message: string;
}

/** What deposit the schedule would ask for on a total. Nothing is saved; the deposit is fixed when the order is confirmed. */
export async function previewDepositAction(totalMinor: number): Promise<DepositPreviewResult> {
  const ctx = await requireStaff("/admin/orders/new");
  if (!ctx.can("orders.read")) return { ok: false, message: DENIED };
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0 || totalMinor > 100_000_000_000) return { ok: false, message: "Add priced items first." };
  try {
    const quote = await ctx.api.previewDeposit(totalMinor);
    return { ok: true, message: `${formatQar(quote.amount_minor)} (${quote.rule})` };
  } catch (error) {
    if (error instanceof StaffOperationError) return { ok: false, message: error.message };
    return { ok: false, message: "The deposit could not be worked out right now." };
  }
}
