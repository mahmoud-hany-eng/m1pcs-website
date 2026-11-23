/** Typed wrappers over the gateway's fixed call list, bound to one verified person. Server only. */
import "server-only";
import { StaffOperationError, staffCall, staffCallMeta, type VerifiedStaff } from "./gateway";
import type {
  AuditRow, ClaimCodeRow, CustomerDetail, CustomerListRow, DashboardSummary, DepositPreview, LoyaltyOverview, OrderDetail,
  OrderListRow, OrderPricingContext, PaymentListRow, PolicyRow, PolicyVersionRow,
} from "./types";

export interface NewOrderItem {
  kind: "component" | "build_service" | "delivery" | "discount" | "other";
  description: string;
  quantity: number;
  unit_price_minor: number;
}

/** The discount the owner entered, in the shape the database takes (the reason is kept with the record of who authorized it). */
export type DiscountParam = { mode: "fixed"; amount_minor: number; reason: string } | { mode: "percent"; percent_bps: number; reason: string };

/** One of the customer's recent orders with the same items as the one being created: evidence for a warning, never a block. */
export interface SimilarOrder {
  order_id: string;
  order_ref: string;
  status: string;
  total_minor: number;
  created_at: string;
}
/** A keyed write's answer: the record's id, and whether this was a REPEAT of an earlier request (so nothing new was saved). */
export interface KeyedResult {
  id: string;
  replayed: boolean;
}

export function staffApi(staff: VerifiedStaff) {
  const call = <T>(name: Parameters<typeof staffCall>[1], params: readonly unknown[] = []) => staffCall<T>(staff, name, params);
  return {
    isStaffMember: () => call<boolean>("is_staff_member"),
    permissions: () => call<string[]>("my_permissions"),
    dashboard: () => call<DashboardSummary>("dashboard_summary"),
    previewDeposit: (totalMinor: number) => call<DepositPreview>("preview_deposit", [totalMinor]),

    searchCustomers: (query: string, limit = 25) => call<CustomerListRow[]>("search_customers", [query, limit]),
    getCustomer: (id: string) => call<CustomerDetail>("get_customer", [id]),
    createCustomer: (c: { fullName: string; phone: string | null; email: string | null; source: string; language: string; address: string | null }) =>
      call<string>("create_customer", [c.fullName, c.phone, c.email, c.source, c.language, c.address]),
    issueClaimCode: (customerId: string, hours: number) => call<string>("issue_claim_code", [customerId, hours]),
    revokeClaimCode: (codeId: string, reason: string) => call<string>("revoke_claim_code", [codeId, reason]),
    claimCodes: (customerId: string) => call<ClaimCodeRow[]>("list_claim_codes", [customerId]),

    listOrders: (opts: { status?: string | null; search?: string | null; limit?: number; offset?: number } = {}) =>
      call<OrderListRow[]>("list_orders", [opts.status ?? null, opts.search ?? null, opts.limit ?? 50, opts.offset ?? 0]),
    getOrder: (id: string) => call<OrderDetail>("get_order", [id]),
    // The idempotency key is chosen once per intended action and reused by every retry of it: a repeat returns the same order.
    createOrder: async (customerId: string, items: readonly NewOrderItem[], deliveryMethod: string | null, deliveryAddress: string | null, idempotencyKey: string): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "create_order", [customerId, JSON.stringify(items), deliveryMethod, deliveryAddress, idempotencyKey]);
      return { id: value, replayed };
    },
    // The order with its Pricing & Rewards: a discount (owner only) and points to redeem (owner only), created together or not at all. The
    // net payable amount and the deposit are the figures the screen SHOWED: the database refuses the order if it works out something else.
    createOrderPriced: async (
      customerId: string, items: readonly NewOrderItem[], deliveryMethod: string | null, deliveryAddress: string | null, idempotencyKey: string,
      discount: DiscountParam | null, redeemPoints: number, expectedNetMinor: number, expectedDepositMinor: number,
    ): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "create_order_priced", [
        customerId, JSON.stringify(items), deliveryMethod, deliveryAddress, idempotencyKey,
        discount ? JSON.stringify(discount) : null, redeemPoints, expectedNetMinor, expectedDepositMinor,
      ]);
      return { id: value, replayed };
    },
    orderPricingContext: (customerId: string) => call<OrderPricingContext>("order_pricing_context", [customerId]),
    // Read-only evidence for the duplicate-order warning. The order this key already created is never listed.
    similarOrders: (customerId: string, items: readonly NewOrderItem[], idempotencyKey: string) =>
      call<SimilarOrder[]>("similar_orders", [customerId, JSON.stringify(items), idempotencyKey]),
    transitionOrder: (orderId: string, toStatus: string, reason: string | null) => call<string>("transition_order", [orderId, toStatus, reason]),
    publishTracking: (orderId: string, title: string, message: string | null, statusCode: string | null) =>
      call<string>("publish_tracking_event", [orderId, title, message, statusCode]),
    // Shipment progress: where it is and when it happened. Accepted only while the order is in Live tracking (the database decides).
    publishTrackingUpdate: (orderId: string, title: string, message: string | null, location: string | null, occurredAt: string | null) =>
      call<string>("publish_tracking_update", [orderId, title, message, location, occurredAt]),
    // After Live tracking has ended: an owner-only, reasoned, visibly marked addition. The original updates stay.
    publishTrackingCorrection: (
      orderId: string, title: string, message: string | null, location: string | null, occurredAt: string | null, reason: string, correctsEventId: string | null,
    ) => call<string>("publish_tracking_correction", [orderId, title, message, location, occurredAt, reason, correctsEventId]),
    retractTracking: (eventId: string, reason: string) => call<string>("retract_tracking_event", [eventId, reason]),
    // An explicit choice, never inferred: "custom_pc_build" or "parts_only".
    setFulfillmentType: (orderId: string, fulfillmentType: string, reason: string | null) =>
      call<string>("set_order_fulfillment_type", [orderId, fulfillmentType, reason]),
    // Puts ONE existing order onto the current workflow (owner only). Returns the status it was placed at.
    adoptWorkflow: (orderId: string, reason: string, targetStatus: string | null, fulfillmentType: string | null) =>
      call<string>("adopt_new_workflow", [orderId, reason, targetStatus, fulfillmentType]),

    // The business accepts cash and Fawran. The database also knows older methods for historical records; the website
    // records only the two that are in use, so a crafted request cannot record another.
    // A repeat with the same idempotency key records nothing and returns the payment that was already recorded, as long as that
    // payment still stands. `expectedPaidMinor` is the amount already paid that the person was looking at: the database refuses
    // the payment if the order's real balance is different (someone else paid, or a payment was reversed, in the meantime).
    recordPayment: async (
      orderId: string, purpose: string, amountMinor: number, method: string, reference: string | null, notes: string | null,
      idempotencyKey: string, expectedPaidMinor: number,
    ): Promise<KeyedResult> => {
      if (method !== "cash" && method !== "fawran") throw new StaffOperationError("Payments are recorded as cash or Fawran.");
      const { value, replayed } = await staffCallMeta<string>(staff, "record_payment", [orderId, purpose, amountMinor, method, reference, notes, idempotencyKey, expectedPaidMinor]);
      return { id: value, replayed };
    },
    reversePayment: (paymentId: string, reason: string) => call<string>("reverse_payment", [paymentId, reason]),
    listPayments: (limit = 100, offset = 0) => call<PaymentListRow[]>("list_payments", [limit, offset]),

    loyalty: (customerId: string | null = null, limit = 100) => call<LoyaltyOverview>("list_loyalty", [customerId, limit]),

    policies: () => call<PolicyRow[]>("list_policies"),
    policyVersions: (key: string) => call<PolicyVersionRow[]>("list_policy_versions", [key]),
    setPolicy: (key: string, value: unknown, confirmation: "unconfirmed_default" | "confirmed_by_owner", reason: string) =>
      call<number>("set_policy", [key, JSON.stringify(value), confirmation, reason]),

    audit: (limit = 100) => call<AuditRow[]>("list_audit", [limit]),
  };
}

export type StaffApi = ReturnType<typeof staffApi>;
