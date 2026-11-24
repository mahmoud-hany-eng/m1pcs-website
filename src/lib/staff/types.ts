import type { AdoptionOption, FulfillmentType, NextStatus, TrackingPhase, WorkflowStageEntry } from "@/lib/workflow/types";
import type { DepositPolicy } from "@/lib/platform/pricing";
export type { AdoptionOption, FulfillmentType, NextStatus, TrackingPhase, WorkflowStageEntry };

/** The shapes the staff functions return (all money in integer QAR minor units). Hand-maintained, like the other row types. */
export interface DashboardSummary {
  total_orders: number;
  awaiting_confirmation: number;
  awaiting_deposit: number;
  /** The next three exist once the order workflow migration is applied (absent from an earlier database). */
  order_confirmed?: number;
  live_tracking?: number;
  awaiting_scheduling?: number;
  under_assembly: number;
  ready_for_delivery: number;
  delivered: number;
  on_hold: number;
  cancelled: number;
  customers: number;
  /** Present only for someone who may read payments. */
  outstanding_balance_minor?: number;
  orders_with_balance?: number;
  deposit_shortfalls?: DepositShortfall[];
  recent_orders: RecentOrder[];
}
export interface DepositShortfall {
  id: string;
  order_ref: string;
  status: string;
  deposit_required_minor: number;
  amount_paid_minor: number;
  customer_name: string;
}
export interface RecentOrder {
  id: string;
  order_ref: string;
  status: string;
  status_label: string;
  total_minor: number;
  created_at: string;
  customer_name: string;
}
export interface CustomerListRow {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  created_at: string;
  order_count: number;
  linked_accounts: number;
}
export interface CustomerOrderRow {
  id: string;
  order_ref: string;
  status: string;
  status_label: string;
  total_minor: number;
  amount_paid_minor: number;
  balance_due_minor: number;
  created_at: string;
}
export interface CustomerDetail {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  preferred_language: string;
  delivery_address: string | null;
  marketing_consent: boolean;
  created_at: string;
  linked_accounts: number;
  orders?: CustomerOrderRow[];
  loyalty_points?: number;
}
export interface ClaimCodeRow {
  id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  status: "active" | "used" | "revoked" | "expired";
}
export interface OrderListRow {
  id: string;
  order_ref: string;
  status: string;
  status_label: string;
  total_minor: number;
  deposit_required_minor: number;
  /** The amount was fixed when the order was confirmed. It does NOT mean any money has arrived. */
  deposit_fixed: boolean;
  /** Staff have recorded payments that cover the fixed deposit. The only way a deposit counts as paid. */
  deposit_received: boolean;
  amount_paid_minor: number;
  balance_due_minor: number;
  created_at: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  /** Present once the order workflow migration is applied; an earlier database leaves them out. */
  workflow_version?: number;
  fulfillment_type?: FulfillmentType | null;
  /** Present once the pricing migration is applied. `total_minor` is always the GROSS order value; what has to be paid is `net_payable_minor`. */
  discount_minor?: number;
  loyalty_points_redeemed?: number;
  loyalty_credit_minor?: number;
  net_payable_minor?: number;
}
export interface OrderItemDetail {
  position: number;
  kind: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
}
export interface OrderHistoryEntry {
  from_status: string | null;
  to_status: string;
  at: string;
  reason: string | null;
  by: string | null;
}
export interface TrackingEntry {
  id: string;
  status_code: string | null;
  title: string;
  message: string | null;
  published_at: string;
  retracted: boolean;
  retraction_reason: string | null;
  /** The fields below come with the order workflow migration; an earlier database leaves them out. */
  location?: string | null;
  occurred_at?: string | null;
  event_kind?: "update" | "correction";
  corrects_event_id?: string | null;
  correction_reason?: string | null;
  /** Who published it (staff display name). */
  by?: string | null;
}

export interface PaymentEntry {
  id: string;
  entry_type: "payment" | "reversal" | "refund";
  purpose: string;
  amount_minor: number;
  method: string;
  receipt_number: string | null;
  received_at: string;
  reverses_payment_id: string | null;
  reversed: boolean;
  recorded_by: string | null;
  internal_reference: string | null;
}
export interface OrderDetail {
  id: string;
  order_ref: string;
  status: string;
  status_label: string;
  customer: { id: string; customer_code: string; full_name: string; phone: string | null; email: string | null };
  total_minor: number;
  deposit_required_minor: number;
  /** The amount was fixed when the order was confirmed. It does NOT mean any money has arrived. */
  deposit_fixed: boolean;
  /** Staff have recorded payments that cover the fixed deposit. The only way a deposit counts as paid. */
  deposit_received: boolean;
  deposit_fixed_at: string | null;
  deposit_rate_bps: number | null;
  deposit_policy_version: number | null;
  deposit_rule: string | null;
  deposit_gate_status: string | null;
  amount_paid_minor: number;
  balance_due_minor: number;
  deposit_outstanding_minor: number;
  delivery_method: string | null;
  delivery_address: string | null;
  placed_via: string;
  created_at: string;
  items: OrderItemDetail[];
  history: OrderHistoryEntry[];
  tracking: TrackingEntry[];
  next_statuses: NextStatus[];
  workflow_version?: number;
  fulfillment_type?: FulfillmentType | null;
  tracking_phase?: TrackingPhase | null;
  /** The status the order was put on hold from, while it is on hold. */
  held_from?: string | null;
  status_is_terminal?: boolean;
  /** The order is inside its fulfilment branch, so its type can no longer be changed. */
  fulfillment_locked?: boolean;
  stages?: WorkflowStageEntry[];
  /** Owner only, earlier-workflow orders only: where this order could be placed on the current workflow. */
  adoption_options?: AdoptionOption[] | null;
  /** Present only for someone who may read payments. */
  payments?: PaymentEntry[];
  /**
   * The money, kept apart (present once the pricing migration is applied). `total_minor` is the GROSS value and never changes; the deposit is
   * taken from it. What the customer has to pay is `net_payable_minor`; `balance_due_minor` is that less the cash received.
   */
  discount_minor?: number;
  loyalty_points_redeemed?: number;
  loyalty_credit_minor?: number;
  net_payable_minor?: number;
  cash_balance_after_deposit_minor?: number;
  /** Who authorized the discount and why (staff only). Null when the order has no discount. */
  discount_record?: {
    mode: "fixed" | "percent";
    percent_bps: number | null;
    amount_minor: number;
    base_minor: number;
    reason: string;
    authorized_by: string | null;
    authorized_at: string;
  } | null;
  /** The points spent on the order. `returned` is true once a cancellation gave them back. */
  redemption_record?: { points: number; credit_minor: number; at: string; returned: boolean } | null;
}
/** What the order form needs for one customer's Pricing & Rewards section (admin.order_pricing_context). */
export interface OrderPricingContext {
  point_value_minor: number | null;
  earn_qar_per_point_minor: number | null;
  earning_base: string | null;
  /** False while the loyalty earning rule is not one that counts only payable money: discounts and redemption are switched off. */
  pricing_enabled: boolean;
  can_discount: boolean;
  can_redeem: boolean;
  /** Null for a staff member who may neither redeem points nor read the loyalty ledger. */
  points_balance: number | null;
  deposit_policy: DepositPolicy | null;
  deposit_policy_version: number | null;
}
export interface PaymentListRow {
  id: string;
  entry_type: "payment" | "reversal" | "refund";
  purpose: string;
  amount_minor: number;
  method: string;
  receipt_number: string | null;
  received_at: string;
  created_at: string;
  reverses_payment_id: string | null;
  reversed: boolean;
  order_id: string;
  order_ref: string;
  customer_id: string;
  customer_name: string;
  recorded_by: string | null;
  internal_reference: string | null;
}
export interface LoyaltyOverview {
  balances: { customer_id: string; customer_code: string; full_name: string; balance_points: number; entries: number }[];
  entries: { id: string; customer_id: string; full_name: string; entry_type: string; points: number; description: string; created_at: string; order_ref: string | null }[];
}
export interface PolicyRow {
  key: string;
  value: Record<string, unknown>;
  description: string;
  confirmation: "unconfirmed_default" | "confirmed_by_owner";
  open_question: string | null;
  version: number;
}
export interface PolicyVersionRow {
  version: number;
  value: Record<string, unknown>;
  confirmation: string;
  changed_at: string;
  changed_by: string | null;
  reason: string | null;
}
export interface DepositPreview {
  amount_minor: number;
  rate_bps: number | null;
  policy_version: number;
  rule: string;
}
export interface AuditRow {
  id: number;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor: string | null;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------
// Order costs, completion and financial reporting (PLAT-0006). Everything here comes from the owner-only finance functions of
// the database, except the completion fields and the customer order history, which any staff member who may read orders can see
// (they carry no cost, margin or supplier). Amounts are integer QAR minor units.
// ---------------------------------------------------------------------------------------------------------------
export type CostCategory = "components" | "international_shipping" | "customs_duties" | "assembly" | "local_delivery" | "payment_processing" | "other";
export type CostKind = "estimated" | "actual";
/** missing: no entry (the cost is UNKNOWN, never zero). incomplete: entries exist but are not declared complete, or an estimate remains. complete: declared complete. */
export type CostState = "missing" | "incomplete" | "complete";
/** none: no completed order. unavailable: completed orders but no cost entry on any. provisional: some order lacks complete costs. verified: every order has complete costs. */
export type ProfitState = "none" | "unavailable" | "provisional" | "verified";

export interface OrderCostEntry {
  id: string;
  category: CostCategory;
  description: string;
  amount_minor: number;
  cost_kind: CostKind;
  supplier_ref: string | null;
  incurred_on: string;
  notes: string | null;
  status: "active" | "voided";
  version: number;
  created_at: string;
  updated_at: string;
}
export interface OrderCostRevision {
  id: number;
  cost_id: string | null;
  action: "created" | "edited" | "voided" | "marked_complete" | "marked_incomplete";
  revision: number | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  by: string | null;
  at: string;
}
export interface OrderCostSummary {
  gross_minor: number;
  discount_minor: number;
  loyalty_credit_minor: number;
  net_revenue_minor: number;
  amount_paid_minor: number;
  balance_due_minor: number;
  actual_cost_minor: number;
  estimated_cost_minor: number;
  recorded_cost_minor: number;
  entries: number;
  estimated_entries: number;
  cost_state: CostState;
  costs_complete: boolean;
  /** NULL when no cost is recorded: there is no profit to show, and it is never revenue minus zero. */
  profit_minor: number | null;
  profit_is_provisional: boolean;
  margin_bps: number | null;
}
export interface OrderCostsView {
  order_id: string;
  order_ref: string;
  status: string;
  completed_at: string | null;
  /** True once the order is completed: the revenue is the snapshot taken then. Before that it is what the revenue WOULD be. */
  revenue_recognized: boolean;
  needs_completion_verification: boolean;
  can_edit: boolean;
  summary: OrderCostSummary;
  entries: OrderCostEntry[];
  revisions: OrderCostRevision[];
}
export interface OrderCompletion {
  order_id: string;
  completed_at: string | null;
  basis: "transition" | "status_history" | "owner_verified" | null;
  basis_reason: string | null;
  needs_verification: boolean;
  can_verify: boolean;
  delivered_moves: { from_status: string | null; at: string; reason: string | null }[] | null;
}
/** One New-order cost row as the form sends it (amounts already in minor units). */
export interface NewOrderCost {
  category: CostCategory;
  description: string;
  amount_minor: number;
  cost_kind: CostKind;
  supplier_ref: string | null;
  incurred_on: string | null;
  notes: string | null;
}

/** One bucket of the report: the whole selected period, or one month of the year. */
export interface FinancialBucket {
  month: number | null;
  completed_orders: number;
  gross_minor: number;
  discount_minor: number;
  loyalty_credit_minor: number;
  net_revenue_minor: number;
  actual_cost_minor: number;
  estimated_cost_minor: number;
  recorded_cost_minor: number;
  orders_costs_complete: number;
  orders_costs_incomplete: number;
  orders_costs_missing: number;
  profit_minor: number | null;
  profit_basis_revenue_minor: number;
  margin_bps: number | null;
  revenue_without_costs_minor: number;
  profit_state: ProfitState;
  outstanding_balance_minor: number;
  /** Cash and Fawran received (net of reversals) by the PAYMENT date: cash flow, never added to revenue. */
  cash_received_minor: number;
}
export interface FinancialReport {
  year: number;
  month: number | null;
  timezone: string;
  currency: string;
  period: FinancialBucket;
  months: FinancialBucket[];
  years: number[];
  needs_verification: { count: number; orders: { id: string; order_ref: string }[] };
  unrecognized_costs: { open_orders_minor: number; cancelled_orders_minor: number; delivered_unverified_minor: number };
}
export interface CompletedOrderRow {
  id: string;
  order_ref: string;
  customer_id: string;
  customer_name: string;
  completed_at: string;
  created_at: string;
  workflow_version: number;
  fulfillment_type: FulfillmentType | null;
  gross_minor: number;
  discount_minor: number;
  loyalty_credit_minor: number;
  net_revenue_minor: number;
  amount_paid_minor: number;
  balance_due_minor: number;
  // Present only for a person who holds finance.read.
  actual_cost_minor?: number;
  estimated_cost_minor?: number;
  cost_state?: CostState;
  profit_minor?: number | null;
  profit_is_provisional?: boolean;
  margin_bps?: number | null;
}
export interface CompletedOrdersPage {
  year: number;
  month: number | null;
  total: number;
  limit: number;
  offset: number;
  finance: boolean;
  /** Every year that has a completed order, plus the current one (Qatar calendar), newest first. */
  years: number[];
  rows: CompletedOrderRow[];
}
export interface OverviewSummary {
  year: number;
  years: number[];
  active_orders: number;
  completed_orders: number;
  needs_attention: {
    awaiting_confirmation: number;
    awaiting_deposit: number;
    on_hold: number;
    completion_to_verify: number;
    deposit_shortfalls?: number;
    completed_with_balance?: number;
  };
  recent_orders: { id: string; order_ref: string; status: string; status_label: string; total_minor: number; net_payable_minor: number; created_at: string; customer_name: string }[];
  /** Present only for a person who holds finance.read. */
  financial?: {
    net_revenue_minor: number;
    profit_minor: number | null;
    margin_bps: number | null;
    profit_state: ProfitState;
    completed_orders: number;
    orders_costs_complete: number;
    orders_costs_incomplete: number;
    orders_costs_missing: number;
  };
}
export interface CustomerOrderLine {
  position: number;
  kind: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  discount_share_minor: number;
  credit_share_minor: number;
  net_line_minor: number;
}
export interface CustomerOrderPayment {
  entry_type: string;
  purpose: string;
  amount_minor: number;
  method: string;
  receipt_number: string | null;
  received_at: string;
  reversed: boolean;
}
export interface CustomerOrderDetail {
  id: string;
  order_ref: string;
  status: string;
  status_label: string;
  workflow_version: number;
  fulfillment_type: FulfillmentType | null;
  delivery_method: string | null;
  created_at: string;
  completed_at: string | null;
  needs_completion_verification: boolean;
  gross_minor: number;
  discount_minor: number;
  loyalty_points_redeemed: number;
  loyalty_credit_minor: number;
  net_payable_minor: number;
  deposit_required_minor: number;
  amount_paid_minor: number;
  balance_due_minor: number;
  items: CustomerOrderLine[];
  history: { from_status: string | null; to_status: string; at: string }[];
  tracking: { title: string; message: string | null; location: string | null; occurred_at: string | null; published_at: string; event_kind: string; retracted: boolean }[];
  /** Present only for a person who holds payments.read. */
  payments?: CustomerOrderPayment[];
}
export interface CustomerOrdersPage {
  total: number;
  limit: number;
  offset: number;
  orders: CustomerOrderDetail[];
}
