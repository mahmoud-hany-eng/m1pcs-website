/** Typed wrappers over the gateway's fixed call list, bound to one verified person. Server only. */
import "server-only";
import { StaffOperationError, staffCall, staffCallMeta, type VerifiedStaff } from "./gateway";
import type {
  AuditRow, ClaimCodeRow, CompletedOrdersPage, CustomerDetail, CustomerListRow, CustomerOrdersPage, DashboardSummary, DepositPreview, FinancialReport,
  LoyaltyOverview, NewOrderCost, OrderCompletion, OrderCostsView, OrderDetail, OrderListRow, OrderPricingContext, OrdersOverview, OrdersPage, OrdersSort, OverviewSummary, PaymentListRow,
  PolicyRow, PolicyVersionRow, ReceiptFile, StaffHeaderProfile,
} from "./types";
import type {
  AttachmentFile, CommitConfirmation, HistoricalItem, HistoricalOrderInfo, ImportBatch, ImportBatchListRow, ImportReport, OrderOrigin, StagedBatch, StoredAttachment,
} from "./historical/types";
import type { StagePayload, DbRow } from "./historical/payload";

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
    /** null when the caller is not active staff; otherwise the display name the staff table holds for them (null when none is set yet). */
    myStaffProfile: () => call<StaffHeaderProfile | null>("my_staff_profile"),
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
    // One page of the Orders list, filtered, sorted and counted by the database. Dates are Qatar calendar days (YYYY-MM-DD), inclusive.
    listOrdersPage: (o: { search: string | null; status: string | null; year: number | null; month: number | null; from: string | null; to: string | null; sort: OrdersSort; page: number; pageSize: number }) =>
      call<OrdersPage>("list_orders_page", [o.search, o.status, o.year, o.month, o.from, o.to, o.sort, o.page, o.pageSize]),
    getOrder: (id: string) => call<OrderDetail>("get_order", [id]),
    // The simplified Orders page: the same filters and paging, plus the order price, and cost, profit and receipts only where the database allows them.
    listOrdersOverview: (o: { search: string | null; status: string | null; year: number | null; month: number | null; from: string | null; to: string | null; sort: OrdersSort; page: number; pageSize: number }) =>
      call<OrdersOverview>("list_orders_overview", [o.search, o.status, o.year, o.month, o.from, o.to, o.sort, o.page, o.pageSize]),
    // PDF receipts on an order. The receipt id is chosen once by the form: sending the same upload again stores it once. The file is a bound bytea parameter.
    addOrderReceipt: async (orderId: string, receiptId: string, fileName: string, content: Buffer): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "add_order_receipt", [orderId, receiptId, fileName, content]);
      return { id: value, replayed };
    },
    removeOrderReceipt: async (receiptId: string, reason: string): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "remove_order_receipt", [receiptId, reason]);
      return { id: value, replayed };
    },
    getOrderReceipt: (receiptId: string) => call<ReceiptFile>("get_order_receipt", [receiptId]),

    // Historical orders import. Owner only: the database requires import.manage (and the second factor) on every one of these calls.
    // The website only reads the file; the database re-validates every row, decides every duplicate and commits all of it or none of it.
    histStageBatch: (payload: StagePayload) => call<StagedBatch>("hist_stage_batch", [JSON.stringify(payload)]),
    histGetBatch: (batchId: string) => call<ImportBatch>("hist_get_batch", [batchId]),
    histListBatches: () => call<ImportBatchListRow[]>("hist_list_batches"),
    histUpdateRow: (batchId: string, rowId: string, row: DbRow) => call<{ row_id: string; batch_id: string }>("hist_update_row", [batchId, rowId, JSON.stringify(row)]),
    histSetRowDecision: (batchId: string, rowId: string, decision: "import" | "skip", reason: string | null) =>
      call<string>("hist_set_row_decision", [batchId, rowId, decision, reason]),
    histMergeGroups: (batchId: string, fromGroup: string, intoGroup: string) => call<string>("hist_merge_groups", [batchId, fromGroup, intoGroup]),
    histUnmergeGroup: (batchId: string, group: string) => call<string>("hist_unmerge_group", [batchId, group]),
    histSetGroupCustomer: (batchId: string, group: string, choice: "new" | "existing", customerId: string | null) =>
      call<string>("hist_set_group_customer", [batchId, group, choice, customerId]),
    histResolveFlag: (batchId: string, flagKey: string, resolution: "keep_separate" | "import_anyway", note: string | null) =>
      call<string>("hist_resolve_flag", [batchId, flagKey, resolution, note]),
    histDiscardBatch: (batchId: string, reason: string) => call<string>("hist_discard_batch", [batchId, reason]),
    histCommitBatch: (batchId: string, confirmation: CommitConfirmation, dryRun: boolean) =>
      call<ImportReport>("hist_commit_batch", [batchId, JSON.stringify(confirmation), dryRun]),
    // Files: bound bytea parameters, never text in a statement. The database checks the bytes, not the name.
    histStoreAttachment: (attachmentId: string, content: Buffer, classification: string | null) =>
      call<StoredAttachment>("hist_store_attachment", [attachmentId, content, classification]),
    histAddAttachment: (rowId: string, fileName: string, content: Buffer, classification: string) =>
      call<StoredAttachment>("hist_add_attachment", [rowId, fileName, content, classification]),
    histSetAttachmentClass: (attachmentId: string, classification: string, customerVisible: boolean) =>
      call<string>("hist_set_attachment_class", [attachmentId, classification, customerVisible]),
    histMarkAttachmentUnavailable: (attachmentId: string, reason: string) => call<string>("hist_mark_attachment_unavailable", [attachmentId, reason]),
    histGetAttachment: (attachmentId: string) => call<AttachmentFile>("hist_get_attachment", [attachmentId]),
    // An imported order: where it came from (null for any other order), its files, and the later enrichment of its item lines.
    histOrderInfo: (orderId: string) => call<HistoricalOrderInfo | null>("hist_order_info", [orderId]),
    histSetOrderItems: (orderId: string, items: readonly HistoricalItem[], reason: string) =>
      call<{ order_id: string; lines: number }>("hist_set_order_items", [orderId, JSON.stringify(items), reason]),
    // What an order is and the date it is listed by: for any staff member who may read orders.
    orderOrigin: (orderId: string) => call<OrderOrigin>("order_origin", [orderId]),
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
    // The same order, with optional private costs ($10) saved in the same transaction. Costs need finance.manage (owner only): without it the
    // database refuses the whole order rather than quietly dropping them.
    createOrderCosted: async (
      customerId: string, items: readonly NewOrderItem[], deliveryMethod: string | null, deliveryAddress: string | null, idempotencyKey: string,
      discount: DiscountParam | null, redeemPoints: number, expectedNetMinor: number, expectedDepositMinor: number, costs: readonly NewOrderCost[],
    ): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "create_order_costed", [
        customerId, JSON.stringify(items), deliveryMethod, deliveryAddress, idempotencyKey,
        discount ? JSON.stringify(discount) : null, redeemPoints, expectedNetMinor, expectedDepositMinor, costs.length ? JSON.stringify(costs) : null,
      ]);
      return { id: value, replayed };
    },
    orderPricingContext: (customerId: string) => call<OrderPricingContext>("order_pricing_context", [customerId]),

    // Private order costs. Owner only (the database checks finance.read / finance.manage on every call).
    orderCosts: (orderId: string) => call<OrderCostsView>("order_costs", [orderId]),
    // The entry id is chosen once by the form and reused by every retry: a repeat saves nothing and returns the entry already saved.
    addOrderCost: async (orderId: string, entryId: string, c: NewOrderCost): Promise<KeyedResult> => {
      const { value, replayed } = await staffCallMeta<string>(staff, "add_order_cost", [orderId, entryId, c.category, c.description, c.amount_minor, c.cost_kind, c.supplier_ref, c.incurred_on, c.notes]);
      return { id: value, replayed };
    },
    editOrderCost: async (costId: string, expectedVersion: number, c: NewOrderCost, reason: string): Promise<{ version: number; replayed: boolean }> => {
      const { value, replayed } = await staffCallMeta<number>(staff, "edit_order_cost", [costId, expectedVersion, c.category, c.description, c.amount_minor, c.cost_kind, c.supplier_ref, c.incurred_on, c.notes, reason]);
      return { version: value, replayed };
    },
    voidOrderCost: async (costId: string, expectedVersion: number, reason: string): Promise<{ version: number; replayed: boolean }> => {
      const { value, replayed } = await staffCallMeta<number>(staff, "void_order_cost", [costId, expectedVersion, reason]);
      return { version: value, replayed };
    },
    setCostsComplete: (orderId: string, complete: boolean, reason: string | null) => call<boolean>("set_order_costs_complete", [orderId, complete, reason]),

    // Completion dates (recorded by the database when an order is delivered) and reports grouped by them, in Asia/Qatar months.
    orderCompletion: (orderId: string) => call<OrderCompletion>("order_completion", [orderId]),
    verifyHistoricalCompletion: (orderId: string, completedAt: string, reason: string) => call<string>("verify_historical_completion", [orderId, completedAt, reason]),
    financialReport: (year: number | null, month: number | null) => call<FinancialReport>("financial_report", [year, month]),
    completedOrders: (year: number | null, month: number | null, limit = 50, offset = 0) => call<CompletedOrdersPage>("list_completed_orders", [year, month, limit, offset]),
    overview: (year: number | null) => call<OverviewSummary>("overview_summary", [year]),
    customerOrders: (customerId: string, limit = 25, offset = 0) => call<CustomerOrdersPage>("customer_orders", [customerId, limit, offset]),
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
