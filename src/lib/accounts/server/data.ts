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
  OrderWorkflowStageRow,
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

/**
 * Every customer record linked to this account, oldest link first. An account normally has one; it can have several
 * when staff issued claim codes for older WhatsApp-managed records (the database allows up to five). Nothing here picks
 * a record from the browser: the links are read with the verified session and row level security.
 */
export async function loadCustomers(supabase: AppSupabaseClient, userId: string): Promise<CustomerRow[]> {
  const links = await supabase.from("customer_accounts").select("customer_id, linked_at").eq("user_id", userId).order("linked_at", { ascending: true });
  if (links.error) fail("customer links", links.error);
  if (!links.data || links.data.length === 0) return [];
  const customers = await supabase.from("customers").select("*").in("id", links.data.map((l) => l.customer_id));
  if (customers.error) fail("customer profiles", customers.error);
  const byId = new Map((customers.data ?? []).map((c) => [c.id, c]));
  return links.data.map((l) => byId.get(l.customer_id)).filter((c): c is CustomerRow => Boolean(c));
}

export async function loadStatuses(supabase: AppSupabaseClient): Promise<OrderStatusRow[]> {
  const result = await supabase.from("order_statuses").select("*").order("sort_order", { ascending: true });
  if (result.error) fail("order statuses", result.error);
  return result.data ?? [];
}

/**
 * The stages each workflow follows. Tolerant on purpose: a database that has not been given the stage table yet (an earlier
 * release) answers with an error here, and the customer pages then show the order the way they always did, from the status list.
 * Only the failing step is logged, never data.
 */
export async function loadWorkflowStages(supabase: AppSupabaseClient): Promise<OrderWorkflowStageRow[]> {
  const result = await supabase.from("order_workflow_stages").select("*").order("position", { ascending: true });
  if (result.error) {
    console.error(`[accounts] workflow stages unavailable${result.error.code ? ` (${result.error.code})` : ""}; using the status list`);
    return [];
  }
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

/** Loyalty across every linked record. With several records the balances are listed per record and added up for display. */
export async function loadLoyalty(supabase: AppSupabaseClient): Promise<{ balances: LoyaltyBalanceRow[]; ledger: LoyaltyLedgerRow[] }> {
  const [balance, ledger] = await Promise.all([
    supabase.from("loyalty_balances").select("*"),
    supabase.from("loyalty_ledger").select("*").order("created_at", { ascending: true }).limit(500),
  ]);
  if (balance.error) fail("loyalty balance", balance.error);
  if (ledger.error) fail("loyalty ledger", ledger.error);
  return { balances: balance.data ?? [], ledger: ledger.data ?? [] };
}
