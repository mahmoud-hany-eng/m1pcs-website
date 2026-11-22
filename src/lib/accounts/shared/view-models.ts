/**
 * View models: what the dashboard shows, derived from database rows. Every function here is pure. It receives rows
 * that row level security has already limited to the signed-in customer, and turns them into display text. Nothing in
 * this file contains a price, a status, a deposit rule or a point value: all of that is read from the rows, so the
 * business rules stay in the database where the owner can change them.
 */
import { formatQar } from "@/lib/platform/money";
import { stagesForOrder, type StageRowInput } from "@/lib/workflow/timeline";
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

/** Statuses at or above this sort order are off the normal path (on hold, cancelled) by the migration's convention. */
export const OFF_PATH_SORT_ORDER = 900;

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", day: "numeric", month: "short", year: "numeric" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Qatar",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : DATE_FORMAT.format(time);
}
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : `${DATE_TIME_FORMAT.format(time)} (Qatar time)`;
}

// ----- order status ---------------------------------------------------------------------------------------------

export type StatusTone = "progress" | "done" | "paused" | "cancelled";

export interface StatusView {
  code: string;
  label: string;
  description: string;
  tone: StatusTone;
  /** 1-based position on the normal path, or null when the status is off the path (on hold, cancelled). */
  step: number | null;
  /** How many steps the normal path has. */
  steps: number;
}

/**
 * `pathCodes` is the list of stages THIS order's workflow follows, in order (from the stage table). Without it the path is every
 * status below the off-path threshold: what an earlier database (one with no stage table) always meant.
 */
export function buildStatusView(code: string, statuses: readonly OrderStatusRow[], pathCodes?: readonly string[]): StatusView {
  const sorted = [...statuses].sort((a, b) => a.sort_order - b.sort_order);
  const byCode = new Map(sorted.map((s) => [s.code, s] as const));
  const path = pathCodes && pathCodes.length > 0
    ? pathCodes.flatMap((c) => (byCode.has(c) ? [byCode.get(c) as OrderStatusRow] : []))
    : sorted.filter((s) => s.sort_order < OFF_PATH_SORT_ORDER);
  const status = sorted.find((s) => s.code === code);
  if (!status) {
    // An unknown code is shown as it is rather than hidden, so a vocabulary change never blanks the page.
    return { code, label: code.replace(/_/g, " "), description: "", tone: "progress", step: null, steps: path.length };
  }
  const index = path.findIndex((s) => s.code === code);
  const off = status.sort_order >= OFF_PATH_SORT_ORDER;
  const tone: StatusTone = off ? (status.is_terminal ? "cancelled" : "paused") : status.is_terminal ? "done" : "progress";
  return {
    code,
    label: status.customer_label,
    description: status.customer_description,
    tone,
    step: index >= 0 ? index + 1 : null,
    steps: path.length,
  };
}

// ----- orders ---------------------------------------------------------------------------------------------------

export interface OrderSummaryView {
  ref: string;
  placedOn: string;
  status: StatusView;
  total: string;
  depositRequired: string;
  paid: string;
  balanceDue: string;
  /** What is still needed to reach the required deposit, or null when no deposit is outstanding. */
  depositOutstanding: string | null;
  fullyPaid: boolean;
  href: string;
}

export function buildOrderSummary(order: OrderRow, statuses: readonly OrderStatusRow[], stageRows: readonly StageRowInput[] = []): OrderSummaryView {
  const outstanding = order.deposit_required_minor - order.amount_paid_minor;
  const pathCodes = stagesForOrder(order, stageRows, statuses).map((stage) => stage.code);
  return {
    ref: order.order_ref,
    placedOn: formatDate(order.created_at),
    status: buildStatusView(order.status, statuses, pathCodes),
    total: formatQar(order.total_minor),
    depositRequired: formatQar(order.deposit_required_minor),
    paid: formatQar(order.amount_paid_minor),
    balanceDue: formatQar(order.balance_due_minor),
    depositOutstanding: outstanding > 0 && order.total_minor > 0 ? formatQar(outstanding) : null,
    fullyPaid: order.total_minor > 0 && order.balance_due_minor === 0,
    href: `/account/orders/${encodeURIComponent(order.order_ref)}`,
  };
}

export interface OrderItemView {
  description: string;
  kind: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export function buildItems(items: readonly OrderItemRow[]): OrderItemView[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      description: item.description,
      kind: item.kind,
      quantity: item.quantity,
      unitPrice: formatQar(item.unit_price_minor),
      lineTotal: formatQar(item.line_total_minor),
    }));
}

// ----- tracking timeline ----------------------------------------------------------------------------------------

export interface TimelineEntryView {
  id: string;
  title: string;
  message: string | null;
  statusLabel: string | null;
  when: string;
  isLatest: boolean;
}

/** Oldest first, with the newest marked, so the page can show the story in the order it happened. */
export function buildTimeline(events: readonly OrderTrackingEventRow[], statuses: readonly OrderStatusRow[]): TimelineEntryView[] {
  const labels = new Map(statuses.map((s) => [s.code, s.customer_label] as const));
  const rank = new Map(statuses.map((s) => [s.code, s.sort_order] as const));
  // A total order, so the timeline never depends on the order rows happened to arrive in: by time first. Updates that
  // were published at the very same instant (for example several recorded in one go) follow the order of the stages
  // they belong to, which the database defines; an update with no stage comes after them, and the id settles the rest.
  const stageOf = (event: OrderTrackingEventRow) => (event.status_code ? (rank.get(event.status_code) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || stageOf(a) - stageOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return sorted.map((event, index) => ({
    id: event.id,
    title: event.title,
    message: event.message,
    statusLabel: event.status_code ? (labels.get(event.status_code) ?? null) : null,
    when: formatDateTime(event.published_at),
    isLatest: index === sorted.length - 1,
  }));
}

// ----- payments -------------------------------------------------------------------------------------------------

const PAYMENT_PURPOSE: Record<string, string> = { deposit: "Deposit", balance: "Balance", other: "Payment" };
const PAYMENT_METHOD: Record<string, string> = { cash: "Cash", fawran: "Fawran", bank_transfer: "Bank transfer", card: "Card", other: "Other method" };
const ENTRY_TYPE: Record<string, string> = { payment: "Received", reversal: "Reversed", refund: "Refunded" };

export interface PaymentView {
  id: string;
  title: string;
  method: string;
  receipt: string | null;
  amount: string;
  /** Reversals and refunds reduce what has been paid. */
  reducesPaid: boolean;
  when: string;
}

export function buildPayments(payments: readonly PaymentRow[]): PaymentView[] {
  return [...payments]
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at))
    .map((payment) => ({
      id: payment.id,
      title: `${PAYMENT_PURPOSE[payment.purpose] ?? "Payment"} ${ENTRY_TYPE[payment.entry_type]?.toLowerCase() ?? ""}`.trim(),
      method: PAYMENT_METHOD[payment.method] ?? "Other method",
      receipt: payment.receipt_number,
      amount: formatQar(payment.amount_minor),
      reducesPaid: payment.amount_minor < 0,
      when: formatDate(payment.received_at),
    }));
}

/** True when the ledger entries add up to the amount the order says has been paid (a consistency check). */
export function ledgerMatchesOrder(order: OrderRow, payments: readonly PaymentRow[]): boolean {
  return payments.reduce((sum, p) => sum + p.amount_minor, 0) === order.amount_paid_minor;
}

// ----- loyalty --------------------------------------------------------------------------------------------------

const LOYALTY_TYPE: Record<string, string> = { award: "Points earned", reversal: "Points reversed", adjustment: "Adjustment" };

export interface LoyaltyEntryView {
  id: string;
  label: string;
  description: string;
  points: number;
  pointsText: string;
  runningBalance: number;
  when: string;
}

export interface LoyaltyView {
  balance: number;
  entryCount: number;
  entries: LoyaltyEntryView[];
}

/**
 * The balance shown is the one the database derived (the view over the ledger), never one added up here. The running
 * balance beside each entry is computed from the ledger in date order, for reading only.
 */
export function buildLoyalty(balances: readonly LoyaltyBalanceRow[], ledger: readonly LoyaltyLedgerRow[]): LoyaltyView {
  const ascending = [...ledger].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let running = 0;
  const entries = ascending.map((entry) => {
    running += entry.points;
    return {
      id: entry.id,
      label: LOYALTY_TYPE[entry.entry_type] ?? "Entry",
      description: entry.description,
      points: entry.points,
      pointsText: `${entry.points > 0 ? "+" : ""}${entry.points}`,
      runningBalance: running,
      when: formatDate(entry.created_at),
    };
  });
  // One balance per linked record, added together. Each is an exact whole number, so the sum is exact.
  const balance = balances.reduce((sum, row) => sum + (row.balance_points ?? 0), 0);
  return { balance, entryCount: entries.length, entries: entries.reverse() };
}

// ----- the overview ---------------------------------------------------------------------------------------------

export interface OverviewView {
  greeting: string;
  orderCount: number;
  openOrderCount: number;
  latestOrder: OrderSummaryView | null;
  totalBalanceDue: string;
  hasBalanceDue: boolean;
  loyaltyBalance: number;
}

export function buildOverview(
  customer: Pick<CustomerRow, "full_name">,
  orders: readonly OrderRow[],
  statuses: readonly OrderStatusRow[],
  loyalty: readonly LoyaltyBalanceRow[],
  stageRows: readonly StageRowInput[] = [],
): OverviewView {
  const newestFirst = [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const terminal = new Set(statuses.filter((s) => s.is_terminal).map((s) => s.code));
  // A cancelled order owes nothing, so its balance is left out of what the customer sees as outstanding. A delivered
  // order can still owe a balance (the public policy says the balance is paid on delivery), so it stays in.
  const owing = orders.filter((o) => buildStatusView(o.status, statuses).tone !== "cancelled");
  const due = owing.reduce((sum, o) => sum + o.balance_due_minor, 0);
  const first = customer.full_name.trim().split(/\s+/)[0] ?? "";
  return {
    greeting: first ? `Welcome back, ${first}` : "Welcome back",
    orderCount: orders.length,
    openOrderCount: orders.filter((o) => !terminal.has(o.status)).length,
    latestOrder: newestFirst[0] ? buildOrderSummary(newestFirst[0], statuses, stageRows) : null,
    totalBalanceDue: formatQar(due),
    hasBalanceDue: due > 0,
    loyaltyBalance: loyalty.reduce((sum, row) => sum + (row.balance_points ?? 0), 0),
  };
}

/** Order refs are shown to people and used in addresses, so only the expected shape is accepted. */
export function isOrderRef(value: unknown): value is string {
  return typeof value === "string" && /^O-[0-9]{4}-[0-9]{5}$/.test(value);
}
