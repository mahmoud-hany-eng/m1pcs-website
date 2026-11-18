/**
 * Dashboard sections. Server components that draw display text from the view models; they contain no price, status,
 * rule or customer data of their own.
 */
import Link from "next/link";
import type {
  LoyaltyView,
  OrderItemView,
  OrderSummaryView,
  PaymentView,
  TimelineEntryView,
} from "@/lib/accounts/shared/view-models";
import { ProgressSteps, StatusPill } from "./ui";

export function OrderCard({ order }: { order: OrderSummaryView }) {
  return (
    <article className="glass glass-flat glass-interactive flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-white">Order {order.ref}</h3>
          <p className="text-sm text-text-muted">Placed {order.placedOn}</p>
        </div>
        <StatusPill status={order.status} />
      </div>
      <ProgressSteps status={order.status} />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-text-muted">Total</dt>
          <dd className="font-semibold text-white">{order.total}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Paid</dt>
          <dd className="font-semibold text-white">{order.paid}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Balance</dt>
          <dd className={`font-semibold ${order.fullyPaid ? "text-success" : "text-white"}`}>{order.fullyPaid ? "Paid in full" : order.balanceDue}</dd>
        </div>
      </dl>
      {order.depositOutstanding ? <p className="text-sm text-warning">Deposit still to pay: {order.depositOutstanding}</p> : null}
      <Link href={order.href} className="btn-sheen btn-glass inline-flex items-center justify-center self-start rounded-full px-5 py-2.5 text-sm font-semibold">
        View order and tracking
      </Link>
    </article>
  );
}

export function MoneySummary({ order }: { order: OrderSummaryView }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-text-muted">Order total</dt>
        <dd className="mt-0.5 font-display text-lg font-semibold text-white">{order.total}</dd>
      </div>
      <div>
        <dt className="text-text-muted">Deposit required</dt>
        <dd className="mt-0.5 font-display text-lg font-semibold text-white">{order.depositRequired}</dd>
      </div>
      <div>
        <dt className="text-text-muted">Paid so far</dt>
        <dd className="mt-0.5 font-display text-lg font-semibold text-white">{order.paid}</dd>
      </div>
      <div>
        <dt className="text-text-muted">Remaining balance</dt>
        <dd className={`mt-0.5 font-display text-lg font-semibold ${order.fullyPaid ? "text-success" : "text-accent"}`}>{order.fullyPaid ? "Paid in full" : order.balanceDue}</dd>
      </div>
    </dl>
  );
}

export function ItemsTable({ items }: { items: OrderItemView[] }) {
  if (items.length === 0) return <p className="text-sm text-text-secondary">The items on this order have not been listed yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.14em] text-text-muted">
          <tr>
            <th className="pb-2 font-semibold">Item</th>
            <th className="pb-2 text-right font-semibold">Qty</th>
            <th className="pb-2 text-right font-semibold">Unit price</th>
            <th className="pb-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.description}-${index}`} className="border-t border-border align-top">
              <td className="py-3 pr-3 text-white">{item.description}</td>
              <td className="py-3 text-right text-text-secondary">{item.quantity}</td>
              <td className="py-3 text-right text-text-secondary">{item.unitPrice}</td>
              <td className="py-3 text-right font-semibold text-white">{item.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The story of an order, oldest first, with the latest update marked. Updates are written by M1 staff by hand. */
export function Timeline({ entries }: { entries: TimelineEntryView[] }) {
  return (
    <ol className="relative flex flex-col gap-6 border-l border-border-strong pl-6">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[1.95rem] top-1.5 h-3 w-3 rounded-full border-2 border-background ${
              entry.isLatest ? "bg-primary shadow-[0_0_12px_rgb(231_50_37/0.85)]" : "bg-border-strong"
            }`}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 className="font-display text-base font-semibold text-white">{entry.title}</h3>
            <time className="text-xs text-text-muted">{entry.when}</time>
          </div>
          {entry.message ? <p className="mt-1 text-sm text-text-secondary">{entry.message}</p> : null}
          {entry.statusLabel ? <p className="mt-1 text-xs text-accent">Stage: {entry.statusLabel}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function PaymentList({ payments }: { payments: PaymentView[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {payments.map((payment) => (
        <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
          <div>
            <p className="font-semibold capitalize text-white">{payment.title}</p>
            <p className="text-text-muted">
              {payment.when} · {payment.method}
              {payment.receipt ? ` · Receipt ${payment.receipt}` : ""}
            </p>
          </div>
          <p className={`font-display text-base font-semibold ${payment.reducesPaid ? "text-error" : "text-white"}`}>{payment.amount}</p>
        </li>
      ))}
    </ul>
  );
}

export function LoyaltyHistory({ loyalty }: { loyalty: LoyaltyView }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {loyalty.entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
          <div>
            <p className="font-semibold text-white">{entry.label}</p>
            <p className="text-text-muted">
              {entry.when} · {entry.description}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-display text-base font-semibold ${entry.points < 0 ? "text-error" : "text-success"}`}>{entry.pointsText}</p>
            <p className="text-xs text-text-muted">Balance {entry.runningBalance}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
