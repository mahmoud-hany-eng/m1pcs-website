/**
 * The shapes the historical import functions return (admin.hist_*), as the website reads them. Owner only: nothing here reaches a customer.
 * Money is in minor units (1/100 QAR). Dates are calendar days (YYYY-MM-DD) in Asia/Qatar unless a field says timestamp.
 */
import type { Issue } from "./parse";

export type ImportStatus = "staged" | "committed" | "discarded";
export type RowKind = "purchase" | "ad_expense" | "invalid_summary" | "invalid";
export type RowDecision = "import" | "skip";
export type RowStatus = "staged" | "skipped" | "imported";
export type CustomerChoice = "new" | "existing";
export type AttachmentStatus = "pending" | "stored" | "unavailable";
export type AttachmentClass = "unclassified" | "customer_receipt" | "supplier_invoice" | "internal";

export interface ImportTotals {
  orders: number;
  revenue_minor: number;
  cost_minor: number;
  orders_with_cost: number;
  profit_minor: number;
  points: number;
  loss_orders: number;
  customers: number;
  ad_rows: number;
  ad_minor: number;
  invalid_summary_rows: number;
  invalid_rows: number;
  skipped_by_owner: number;
  skipped_already_imported: number;
  data_rows: number;
}

/** A thing the owner must look at: `error` blocks the import until decided, `warning`/`info` do not. */
export interface ImportFlag {
  flag_key: string;
  kind: "row_invalid" | "already_imported" | "possible_duplicate" | "identical_rows" | "shared_phone" | "same_name_other_phone" | "missing_phone" | "existing_customer" | "previous_import" | string;
  severity: "error" | "warning" | "info";
  row_id: string | null;
  group_id: string | null;
  other_group_id: string | null;
  existing_customer_id: string | null;
  message: string;
  resolved: boolean;
  resolution: string | null;
}

export interface ImportRow {
  id: string;
  row_number: number;
  kind: RowKind;
  customer_name: string | null;
  phone: string | null;
  happened_on: string | null;
  month_label: string | null;
  revenue_minor: number | null;
  cost_minor: number | null;
  profit_minor: number | null;
  points: number;
  issues: Issue[];
  decision: RowDecision;
  skip_reason: string | null;
  status: RowStatus;
  corrected: boolean;
  group_id: string | null;
  group_no: number | null;
  order_ref: string | null;
  order_id: string | null;
}

export interface ImportGroup {
  id: string;
  group_no: number;
  display_name: string;
  phone: string | null;
  merged_into: string | null;
  customer_choice: CustomerChoice;
  existing_customer_id: string | null;
  customer_code: string | null;
  orders: number;
  points: number;
  existing_balance_points: number;
}

export interface ImportAttachment {
  id: string;
  row_id: string;
  position: number;
  file_name: string;
  declared_ext: string | null;
  status: AttachmentStatus;
  classification: AttachmentClass;
  customer_visible: boolean;
  source_expiring: boolean;
  source_host: string | null;
  source_ref: string | null;
  byte_size: number | null;
  mime: string | null;
  unavailable_reason: string | null;
}

export interface ImportReport {
  batch_id: string;
  committed_at: string;
  orders: number;
  customers_created: number;
  customers_reused: number;
  revenue_minor: number;
  cost_minor: number;
  profit_minor: number;
  orders_with_cost: number;
  loss_orders: number;
  points: number;
  qar_per_point_minor: number;
  costs_declared_complete: boolean;
  skipped: { by_owner: number; already_imported: number };
  exclusions: { ad_rows: number; ad_minor: number; invalid_summary_rows: number };
  attachments: { total: number; pending: number };
  warnings: { code: string; severity: string; count: number }[];
  customer_codes: string[];
  per_order: { row_number: number; order_ref: string; customer_code: string; points: number }[];
  replayed?: boolean;
  dry_run?: boolean;
}

export interface ImportBatch {
  batch: {
    id: string;
    status: ImportStatus;
    created_at: string;
    committed_at: string | null;
    discarded_at: string | null;
    date_format: "iso" | "dmy" | "mdy" | null;
    date_format_reason: string | null;
    qar_per_point_minor: number;
    notes: Issue[];
    source_label: string | null;
  };
  rate_now: number | null;
  totals: ImportTotals;
  flags: ImportFlag[];
  blocking: number;
  rows: ImportRow[];
  groups: ImportGroup[];
  attachments: ImportAttachment[];
  result: ImportReport | null;
}

export interface ImportBatchListRow {
  id: string;
  status: ImportStatus;
  created_at: string;
  committed_at: string | null;
  discarded_at: string | null;
  orders: number;
  revenue_minor: number;
  points: number;
  blocking: number;
}

export interface StagedBatch {
  batch_id: string;
  status: ImportStatus;
  reused: boolean;
}

export interface CommitConfirmation {
  phrase: string;
  attest: { date_is_completion_date: boolean; revenue_is_final_payable: boolean; orders_fully_paid: boolean; costs_complete: boolean };
  expected: { orders: number; revenue_minor: number; cost_minor: number; points: number };
}

/** What a historical order is, for the owner's order page: where it came from, what was attested, which files it has. */
export interface HistoricalOrderInfo {
  order_id: string;
  batch_id: string;
  source_row_number: number;
  historical_date: string;
  date_meaning: "completion";
  placement_date_known: boolean;
  imported_at: string;
  imported_by_name: string | null;
  paid_basis: "owner_attestation";
  points_awarded: number;
  attestation: { date_is_completion_date: boolean; revenue_is_final_payable: boolean; orders_fully_paid: boolean; costs_complete: boolean; attested_at: string } | null;
  item_revisions: number;
  row_id: string;
  attachments: {
    id: string;
    position: number;
    file_name: string;
    declared_ext: string | null;
    status: AttachmentStatus;
    classification: AttachmentClass;
    customer_visible: boolean;
    source_expiring: boolean;
    source_host: string | null;
    byte_size: number | null;
    mime: string | null;
    unavailable_reason: string | null;
  }[];
}

/** What an order is, for any staff member who may read orders: a platform order, or a historical import, and the date it is listed by. */
export interface OrderOrigin {
  origin: "platform" | "historical_import";
  order_date: string;
  completed_at: string | null;
  created_at: string;
}

export interface StoredAttachment {
  id: string;
  mime: string;
  byte_size: number;
  sha256: string;
}

export interface AttachmentFile {
  id: string;
  file_name: string;
  mime: string;
  byte_size: number;
  content_base64: string;
}

export interface HistoricalItem {
  kind: "component" | "build_service" | "delivery" | "other";
  description: string;
  quantity: number;
  unit_price_minor: number;
}
