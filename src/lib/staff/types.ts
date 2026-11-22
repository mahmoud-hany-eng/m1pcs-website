import type { AdoptionOption, FulfillmentType, NextStatus, TrackingPhase, WorkflowStageEntry } from "@/lib/workflow/types";
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
