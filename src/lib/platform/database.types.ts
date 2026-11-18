/**
 * TypeScript shapes for the business-platform database (supabase/migrations).
 *
 * Only what a CUSTOMER session may read is described here, plus the shapes the staff functions return. Supplier
 * costs, margins, internal payment references, staff notes and the status-change history live in the `private`
 * schema and have no type in this file on purpose: nothing in the browser bundle can name them.
 *
 * These interfaces are maintained by hand until the project generates types from a real Supabase project. A test
 * (supabase/tests/db.test.mjs, "typed interfaces match the database") compares every interface below with the
 * migrated database, so a column added in SQL and forgotten here fails the suite.
 *
 * Money is always an integer count of minor units (1 QAR = 100). Never a float. See ./money.ts.
 */

export type Uuid = string;
/** ISO 8601 text, as PostgREST returns timestamptz. */
export type Timestamp = string;
/** An integer number of minor units of QAR (dirhams). */
export type MinorUnits = number;

export type PreferredLanguage = "en" | "ar";
export type CustomerSource = "website" | "whatsapp" | "instagram" | "walk_in" | "other";
export type AccountLinkMethod = "self_signup" | "claim_code" | "admin";

/** table: public.customers */
export interface CustomerRow {
  id: Uuid;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_language: PreferredLanguage;
  delivery_address: string | null;
  source: CustomerSource;
  marketing_consent: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * The only customer columns a customer session may change (column-level UPDATE grant). Identity and linking
 * columns are not here: a customer cannot rename their own record's identity, source or code.
 */
export type CustomerProfileEdit = Partial<
  Pick<CustomerRow, "full_name" | "phone" | "email" | "preferred_language" | "delivery_address" | "marketing_consent">
>;

/** table: public.customer_accounts */
export interface CustomerAccountRow {
  user_id: Uuid;
  customer_id: Uuid;
  linked_via: AccountLinkMethod;
  linked_at: Timestamp;
}

/** table: public.quote_categories (the 18 categories of the public quote form) */
export interface QuoteCategoryRow {
  label: string;
  sort_order: number;
}

export type QuotationStatus = "submitted" | "in_review" | "quoted" | "accepted" | "declined" | "expired" | "converted";
export type QuotationSource = "website_form" | "whatsapp" | "admin";

/** table: public.quotations */
export interface QuotationRow {
  id: Uuid;
  quote_ref: string;
  customer_id: Uuid | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  category: string;
  requested_budget_minor: MinorUnits | null;
  quantity: number;
  product_preference: string;
  specific_model: string | null;
  /** The category-specific answers of the quote form, as the form produced them. */
  requested_specs: Record<string, string | string[]>;
  additional_notes: string | null;
  source: QuotationSource;
  status: QuotationStatus;
  /** Present only once staff have quoted. A customer never sees a draft price. */
  quoted_total_minor: MinorUnits | null;
  valid_until: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** table: public.quotation_lines (visible to a customer only once the quotation is quoted) */
export interface QuotationLineRow {
  id: Uuid;
  quotation_id: Uuid;
  position: number;
  description: string;
  quantity: number;
  unit_price_minor: MinorUnits;
  line_total_minor: MinorUnits;
}

/** table: public.order_statuses. The vocabulary is data, not code (OQ-0005), so a status code is plain text. */
export interface OrderStatusRow {
  code: string;
  sort_order: number;
  customer_label: string;
  customer_description: string;
  is_terminal: boolean;
  is_provisional: boolean;
}

export type PlacedVia = "website" | "whatsapp" | "admin";
export type DeliveryMethod = "delivery" | "collection";

/** table: public.orders. The amounts are the agreed price and what has been paid: nothing about cost or margin. */
export interface OrderRow {
  id: Uuid;
  order_ref: string;
  customer_id: Uuid;
  quotation_id: Uuid | null;
  status: string;
  currency: "QAR";
  total_minor: MinorUnits;
  deposit_required_minor: MinorUnits;
  amount_paid_minor: MinorUnits;
  balance_due_minor: MinorUnits;
  delivery_method: DeliveryMethod | null;
  delivery_address: string | null;
  placed_via: PlacedVia;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type OrderItemKind = "component" | "build_service" | "delivery" | "discount" | "other";

/** table: public.order_items */
export interface OrderItemRow {
  id: Uuid;
  order_id: Uuid;
  position: number;
  kind: OrderItemKind;
  description: string;
  quantity: number;
  unit_price_minor: MinorUnits;
  line_total_minor: MinorUnits;
}

/** table: public.order_tracking_events (updates that staff chose to publish to the customer) */
export interface OrderTrackingEventRow {
  id: Uuid;
  order_id: Uuid;
  status_code: string | null;
  title: string;
  message: string | null;
  published_at: Timestamp;
}

export type PaymentEntryType = "payment" | "reversal" | "refund";
export type PaymentPurpose = "deposit" | "balance" | "other";
export type PaymentMethod = "cash" | "bank_transfer" | "card" | "other";

/**
 * table: public.payments. A row exists only after staff recorded a real receipt: submitting a quotation or an
 * order never creates one. Internal references and notes are in the private schema.
 */
export interface PaymentRow {
  id: Uuid;
  order_id: Uuid;
  entry_type: PaymentEntryType;
  purpose: PaymentPurpose;
  /** Positive for a payment, negative for a reversal or refund. */
  amount_minor: MinorUnits;
  currency: "QAR";
  method: PaymentMethod;
  receipt_number: string | null;
  received_at: Timestamp;
  reverses_payment_id: Uuid | null;
  created_at: Timestamp;
}

export type LoyaltyEntryType = "award" | "reversal" | "adjustment";

/** table: public.loyalty_ledger (append-only; the staff reason is private) */
export interface LoyaltyLedgerRow {
  id: Uuid;
  customer_id: Uuid;
  order_id: Uuid | null;
  entry_type: LoyaltyEntryType;
  /** Positive for an award, negative for a reversal, either sign for an adjustment. Never zero. */
  points: number;
  reverses_entry_id: Uuid | null;
  description: string;
  created_at: Timestamp;
}

/** view: public.loyalty_balances. The balance is derived from the ledger; no client can set it. */
export interface LoyaltyBalanceRow {
  customer_id: Uuid | null;
  balance_points: number | null;
  entries: number | null;
}

/**
 * Functions a signed-in customer may call (schema `public`). Every other write is made by staff through the
 * `admin` functions, which are not exposed through the API in this phase.
 */
export interface CustomerFunctions {
  /** Creates the caller's own customer record and links it. Returns the new customer id. */
  create_my_customer_profile: {
    args: { p_full_name: string; p_phone?: string | null; p_email?: string | null; p_preferred_language?: PreferredLanguage };
    returns: Uuid;
  };
  /**
   * Links the caller to an existing customer record using a one-time code that staff issued. Returns the customer
   * id, or null for any failure (wrong, used or expired code, or too many attempts). The failure is deliberately
   * not described.
   */
  claim_customer_profile: { args: { p_code: string }; returns: Uuid | null };
}

/** Staff-only shapes (schema `admin`). Described for the later admin phase; no customer code may import these. */
export interface AdminOrderFinancials {
  order_id: Uuid;
  revenue_minor: MinorUnits;
  cost_qar_minor: MinorUnits;
  cost_usd_minor: MinorUnits;
  items_without_cost: number;
  /** Null unless every cost is in QAR: no exchange rate is assumed (OQ-0012). */
  margin_qar_minor: MinorUnits | null;
}

export type PolicyConfirmation = "unconfirmed_default" | "confirmed_by_owner";

export interface AdminPolicyRow {
  key: string;
  value: Record<string, unknown>;
  description: string;
  confirmation: PolicyConfirmation;
  open_question: string | null;
  version: number;
}

/** The `public` tables and views, keyed by name. */
export interface PublicTables {
  customers: CustomerRow;
  customer_accounts: CustomerAccountRow;
  quote_categories: QuoteCategoryRow;
  quotations: QuotationRow;
  quotation_lines: QuotationLineRow;
  order_statuses: OrderStatusRow;
  orders: OrderRow;
  order_items: OrderItemRow;
  order_tracking_events: OrderTrackingEventRow;
  payments: PaymentRow;
  loyalty_ledger: LoyaltyLedgerRow;
  loyalty_balances: LoyaltyBalanceRow;
}
