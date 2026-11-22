/**
 * The `Database` type that the Supabase client is parameterised with, built from the hand-maintained row types in
 * ./database.types.ts (which a database test compares with the migrated schema). Only schema `public` is described:
 * the `private` and `admin` schemas are not exposed through the API and have no type here on purpose, so no browser
 * or server component can name a supplier cost or a staff note through this client.
 *
 * Every table is read-only for the application (Insert and Update are `never`), except that a customer may change
 * their own contact details, which the database allows through a column-level grant. All other writes happen through
 * database functions that staff or the customer's own session call.
 */
import type {
  CustomerAccountRow,
  CustomerProfileEdit,
  CustomerRow,
  LoyaltyBalanceRow,
  LoyaltyLedgerRow,
  OrderItemRow,
  OrderRow,
  OrderStatusRow,
  OrderTrackingEventRow,
  OrderWorkflowStageRow,
  PaymentRow,
  QuotationLineRow,
  QuotationRow,
  QuoteCategoryRow,
  Uuid,
  PreferredLanguage,
  CustomerFunctions,
} from "./database.types";

/**
 * The client's generics require rows to be assignable to Record<string, unknown>. A TypeScript interface is not (it has
 * no implicit index signature), but a mapped type is, so each row is wrapped. The shape is unchanged.
 */
type Plain<T> = { [K in keyof T]: T[K] };

type ReadOnlyTable<Row> = { Row: Plain<Row>; Insert: never; Update: never; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      customers: { Row: Plain<CustomerRow>; Insert: never; Update: CustomerProfileEdit; Relationships: [] };
      customer_accounts: ReadOnlyTable<CustomerAccountRow>;
      quote_categories: ReadOnlyTable<QuoteCategoryRow>;
      quotations: ReadOnlyTable<QuotationRow>;
      quotation_lines: ReadOnlyTable<QuotationLineRow>;
      order_statuses: ReadOnlyTable<OrderStatusRow>;
      order_workflow_stages: ReadOnlyTable<OrderWorkflowStageRow>;
      orders: ReadOnlyTable<OrderRow>;
      order_items: ReadOnlyTable<OrderItemRow>;
      order_tracking_events: ReadOnlyTable<OrderTrackingEventRow>;
      payments: ReadOnlyTable<PaymentRow>;
      loyalty_ledger: ReadOnlyTable<LoyaltyLedgerRow>;
    };
    Views: {
      loyalty_balances: { Row: Plain<LoyaltyBalanceRow>; Relationships: [] };
    };
    Functions: {
      create_my_customer_profile: {
        Args: { p_full_name: string; p_phone?: string | null; p_email?: string | null; p_preferred_language?: PreferredLanguage };
        Returns: Uuid;
      };
      claim_customer_profile: { Args: CustomerFunctions["claim_customer_profile"]["args"]; Returns: Uuid | null };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
