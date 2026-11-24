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
import { StaffOperationError } from "./gateway";
import { echoValues, type StaffFormState } from "./form-state";
import { DENIED, failureState } from "./outcomes";
import { createOrderWork, recordPaymentWork } from "./order-actions";
import {
  CLAIM_CODE_HOURS,
  depositPolicyValue,
  isUuid,
  parseCompletionVerification,
  parseCostEdit,
  parseCostEntry,
  parseCustomer,
  parseDepositSchedule,
  parseEntryId,
  parseExpectedVersion,
  parseFulfillmentType,
  parseReason,
  parseTracking,
  parseTrackingCorrection,
  STALE_FORM_MESSAGE,
} from "./validation";
import {
  COMPLETION_VERIFIED,
  COSTS_MARKED_COMPLETE,
  COSTS_REOPENED,
  costEditedMessage,
  costSavedMessage,
  costVoidedMessage,
} from "./outcomes";

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
  // What the action decides lives in order-actions.ts, where a test runs it against the real gateway and database.
  return run("/admin/orders/new", "orders.create", formData, ({ api }) => createOrderWork(api, formData, revalidatePath));
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
    // Whether the order is in Live tracking is decided by the database, in the same transaction as the write.
    await api.publishTrackingUpdate(orderId, parsed.value.title, parsed.value.message, parsed.value.location, parsed.value.occurredAt);
    revalidatePath(`/admin/orders/${orderId}`);
    return { status: "success", message: "The update is now visible to the customer." };
  });
}

/** After Live tracking has ended: owner only. The database re-checks the permission, the reason and the order's tracking phase. */
export async function publishTrackingCorrectionAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "tracking.correct", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const parsed = parseTrackingCorrection(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    const v = parsed.value;
    await api.publishTrackingCorrection(orderId, v.title, v.message, v.location, v.occurredAt, v.reason, v.correctsEventId);
    revalidatePath(`/admin/orders/${orderId}`);
    return { status: "success", message: "The correction was added to the tracking history and is marked as a correction for the customer." };
  });
}

/** The fulfilment type is an explicit choice (Custom PC build or Parts only); nothing infers it from the items or the notes. */
export async function setFulfillmentTypeAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "orders.transition", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const parsed = parseFulfillmentType(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.setFulfillmentType(orderId, parsed.value, null);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    return { status: "success", message: "The order type was saved." };
  });
}

/** Owner only, one order at a time, with a reason: puts an existing order on the current workflow. */
export async function adoptWorkflowAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "orders.adopt", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const reason = parseReason(formData);
    if (!reason.ok) return { status: "error", fieldErrors: reason.errors };
    const target = field(formData, "target_status");
    if (target !== "" && !ORDER_STATUS.test(target)) return { status: "error", fieldErrors: { target_status: "Choose one of the listed statuses." } };
    const type = field(formData, "fulfillment_type");
    if (type !== "" && !parseFulfillmentType(formData).ok) return { status: "error", fieldErrors: { fulfillment_type: "Choose Custom PC build or Parts only." } };
    await api.adoptWorkflow(orderId, reason.value, target || null, type || null);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: "The order now follows the current workflow. Its earlier history is unchanged." };
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
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "payments.record", formData, ({ api }) => recordPaymentWork(api, formData, revalidatePath));
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


// ---------------------------------------------------------------------------------------------------------------
// Private order costs and completion dates. Owner only: the permission is checked here for a clear message and again by the database.
// ---------------------------------------------------------------------------------------------------------------

export async function addOrderCostAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "finance.manage", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const parsed = parseCostEntry(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    const entryId = parseEntryId(formData);
    if (!entryId) return { status: "error", message: STALE_FORM_MESSAGE };
    // The entry id was chosen by the form: sending the same form again (a double click, a retry) saves nothing twice.
    const { replayed } = await api.addOrderCost(orderId, entryId, parsed.value);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: costSavedMessage(replayed) };
  });
}

export async function editOrderCostAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  const costId = field(formData, "cost_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "finance.manage", formData, async ({ api }) => {
    if (!isUuid(orderId) || !isUuid(costId)) return badId();
    const parsed = parseCostEdit(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    const version = parseExpectedVersion(formData);
    if (version === null) return { status: "error", message: STALE_FORM_MESSAGE };
    const { replayed } = await api.editOrderCost(costId, version, parsed.value.cost, parsed.value.reason);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: costEditedMessage(replayed) };
  });
}

export async function voidOrderCostAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  const costId = field(formData, "cost_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "finance.manage", formData, async ({ api }) => {
    if (!isUuid(orderId) || !isUuid(costId)) return badId();
    const reason = parseReason(formData);
    if (!reason.ok) return { status: "error", fieldErrors: reason.errors };
    const version = parseExpectedVersion(formData);
    if (version === null) return { status: "error", message: STALE_FORM_MESSAGE };
    const { replayed } = await api.voidOrderCost(costId, version, reason.value);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: costVoidedMessage(replayed) };
  });
}

/** Declares the order's costs complete (no reason needed) or reopens them (a reason is kept in the history). */
export async function setCostsCompleteAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "finance.manage", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const complete = field(formData, "complete") === "yes";
    let reason: string | null = null;
    if (!complete) {
      const parsed = parseReason(formData);
      if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
      reason = parsed.value;
    }
    await api.setCostsComplete(orderId, complete, reason);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: complete ? COSTS_MARKED_COMPLETE : COSTS_REOPENED };
  });
}

/** The owner's one-time confirmation of the completion date of an order delivered before dates were recorded. */
export async function verifyCompletionAction(_previous: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const orderId = field(formData, "order_id");
  return run(`/admin/orders/${isUuid(orderId) ? orderId : ""}`, "finance.verify", formData, async ({ api }) => {
    if (!isUuid(orderId)) return badId();
    const parsed = parseCompletionVerification(formData);
    if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
    await api.verifyHistoricalCompletion(orderId, parsed.value.completedAt, parsed.value.reason);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { status: "success", message: COMPLETION_VERIFIED };
  });
}
