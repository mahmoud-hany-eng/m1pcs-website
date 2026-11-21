/** Typed wrappers over the gateway's fixed call list, bound to one verified person. Server only. */
import "server-only";
import { StaffOperationError, staffCall, type VerifiedStaff } from "./gateway";
import type {
  AuditRow, ClaimCodeRow, CustomerDetail, CustomerListRow, DashboardSummary, DepositPreview, LoyaltyOverview, OrderDetail,
  OrderListRow, PaymentListRow, PolicyRow, PolicyVersionRow,
} from "./types";

export interface NewOrderItem {
  kind: "component" | "build_service" | "delivery" | "discount" | "other";
  description: string;
  quantity: number;
  unit_price_minor: number;
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
    createOrder: (customerId: string, items: readonly NewOrderItem[], deliveryMethod: string | null, deliveryAddress: string | null, idempotencyKey: string) =>
      call<string>("create_order", [customerId, JSON.stringify(items), deliveryMethod, deliveryAddress, idempotencyKey]),
    transitionOrder: (orderId: string, toStatus: string, reason: string | null) => call<string>("transition_order", [orderId, toStatus, reason]),
    publishTracking: (orderId: string, title: string, message: string | null, statusCode: string | null) =>
      call<string>("publish_tracking_event", [orderId, title, message, statusCode]),
    retractTracking: (eventId: string, reason: string) => call<string>("retract_tracking_event", [eventId, reason]),

    // The business accepts cash and Fawran. The database also knows older methods for historical records; the website
    // records only the two that are in use, so a crafted request cannot record another.
    // A repeat with the same idempotency key records nothing and returns the payment that was already recorded.
    recordPayment: async (orderId: string, purpose: string, amountMinor: number, method: string, reference: string | null, notes: string | null, idempotencyKey: string) => {
      if (method !== "cash" && method !== "fawran") throw new StaffOperationError("Payments are recorded as cash or Fawran.");
      return call<string>("record_payment", [orderId, purpose, amountMinor, method, reference, notes, idempotencyKey]);
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
