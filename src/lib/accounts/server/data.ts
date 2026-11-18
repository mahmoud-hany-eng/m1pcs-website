/**
 * Reads for the customer dashboard. Every query runs as the signed-in customer, with their own session, so row level
 * security in the database decides what comes back: another customer's rows, supplier costs, staff notes and internal
 * payment references are not in the tables this client can see, and they are not requested here.
 *
 * No function takes a customer id from the browser. The one lookup that needs an id uses the user id that the auth
 * service verified, and the database would return nothing for anyone else's even if it were wrong.
 */
import type {
  CustomerRow,
  LoyaltyBalanceRow,
  LoyaltyLedgerRow,
  OrderItemRow,
  OrderRow,
  OrderStatusRow,
  OrderTrackingEventRow,
  PaymentRow,
} from "@/lib/platform/database.types";
import type { AppSupabaseClient } from "./client";

/** A read failed. The message is generic on purpose; the detail is not shown to the customer. */
export class AccountsDataError extends Error {
  constructor() {
    super("account data could not be loaded");
    this.name = "AccountsDataError";
  }
}

function fail(label: string, error: { code?: string } | null): never {
  // Only the failing step and the error code are logged: never the query, the row data or the customer's details.
  console.error(`[accounts] ${label} failed${error?.code ? ` (${error.code})` : ""}`);
  throw new AccountsDataError();
}

export async function loadCustomer(supabase: AppSupabaseClient, userId: string): Promise<CustomerRow | null> {
  const link = await supabase.from("customer_accounts").select("customer_id").eq("user_id", userId).maybeSingle();
  if (link.error) fail("customer link", link.error);
  if (!link.data) return null;
  const customer = await supabase.from("customers").select("*").eq("id", link.data.customer_id).maybeSingle();
  if (customer.error) fail("customer profile", customer.error);
  return customer.data;
}

export async function loadStatuses(supabase: AppSupabaseClient): Promise<OrderStatusRow[]> {
  const result = await supabase.from("order_statuses").select("*").order("sort_order", { ascending: true });
  if (result.error) fail("order statuses", result.error);
  return result.data ?? [];
}

export async function loadOrders(supabase: AppSupabaseClient): Promise<OrderRow[]> {
  const result = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
  if (result.error) fail("orders", result.error);
  return result.data ?? [];
}

export interface OrderDetail {
  order: OrderRow;
  items: OrderItemRow[];
  events: OrderTrackingEventRow[];
  payments: PaymentRow[];
}

/** One order by its reference. A reference that is not the signed-in customer's own finds nothing: the same as one that does not exist. */
export async function loadOrderDetail(supabase: AppSupabaseClient, ref: string): Promise<OrderDetail | null> {
  const found = await supabase.from("orders").select("*").eq("order_ref", ref).maybeSingle();
  if (found.error) fail("order", found.error);
  const order = found.data;
  if (!order) return null;
  const [items, events, payments] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", order.id).order("position", { ascending: true }),
    supabase.from("order_tracking_events").select("*").eq("order_id", order.id).order("published_at", { ascending: true }),
    supabase.from("payments").select("*").eq("order_id", order.id).order("received_at", { ascending: true }),
  ]);
  if (items.error) fail("order items", items.error);
  if (events.error) fail("order tracking", events.error);
  if (payments.error) fail("order payments", payments.error);
  return { order, items: items.data ?? [], events: events.data ?? [], payments: payments.data ?? [] };
}

export async function loadPayments(supabase: AppSupabaseClient): Promise<PaymentRow[]> {
  const result = await supabase.from("payments").select("*").order("received_at", { ascending: false }).limit(500);
  if (result.error) fail("payments", result.error);
  return result.data ?? [];
}

export async function loadLoyalty(supabase: AppSupabaseClient): Promise<{ balance: LoyaltyBalanceRow | null; ledger: LoyaltyLedgerRow[] }> {
  const [balance, ledger] = await Promise.all([
    supabase.from("loyalty_balances").select("*").maybeSingle(),
    supabase.from("loyalty_ledger").select("*").order("created_at", { ascending: true }).limit(500),
  ]);
  if (balance.error) fail("loyalty balance", balance.error);
  if (ledger.error) fail("loyalty ledger", ledger.error);
  return { balance: balance.data, ledger: ledger.data ?? [] };
}
