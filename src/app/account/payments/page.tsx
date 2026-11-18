import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { PaymentList } from "@/components/account/dashboard";
import { EmptyState, Panel } from "@/components/account/ui";
import { loadOrders, loadPayments, loadStatuses } from "@/lib/accounts/server/data";
import { requireLinkedCustomer } from "@/lib/accounts/server/guard";
import { buildOrderSummary, buildPayments } from "@/lib/accounts/shared/view-models";

export default async function PaymentsPage() {
  const { user, supabase } = await requireLinkedCustomer("/account/payments");
  const [statuses, orders, payments] = await Promise.all([loadStatuses(supabase), loadOrders(supabase), loadPayments(supabase)]);

  const summaries = orders.map((order) => ({ order, view: buildOrderSummary(order, statuses) }));
  // An order is owed on when it is priced, has a balance, and has not been cancelled.
  const owing = summaries.filter(({ order, view }) => order.total_minor > 0 && order.balance_due_minor > 0 && view.status.tone !== "cancelled");

  // Payments grouped by order, each group in date order, so the customer reads one order's money together.
  const groups = orders
    .map((order) => ({ ref: order.order_ref, payments: buildPayments(payments.filter((payment) => payment.order_id === order.id)) }))
    .filter((group) => group.payments.length > 0);

  return (
    <AccountShell active="payments" email={user.email} title="Payments" description="What you owe, and every payment M1 has recorded. A payment appears only after M1 confirms it was received.">
      {owing.length > 0 ? (
        <Panel title="Still to pay">
          <ul className="flex flex-col divide-y divide-border">
            {owing.map(({ view }) => (
              <li key={view.ref} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                <div>
                  <Link href={view.href} className="font-semibold text-white underline-offset-2 hover:underline">
                    Order {view.ref}
                  </Link>
                  <p className="text-text-muted">
                    {view.status.label} · Total {view.total} · Paid {view.paid}
                  </p>
                  {view.depositOutstanding ? <p className="text-warning">Deposit still to pay: {view.depositOutstanding}</p> : null}
                </div>
                <p className="font-display text-lg font-semibold text-accent">{view.balanceDue}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState title="No payments recorded yet" action={orders.length === 0 ? { href: "/build-my-pc", label: "Request a quote" } : undefined}>
          <p>
            {orders.length === 0
              ? "You do not have any orders yet, so there are no payments to show."
              : "When M1 confirms a deposit or payment on one of your orders, it is listed here with its receipt number."}
          </p>
        </EmptyState>
      ) : (
        groups.map((group) => (
          <Panel key={group.ref} title={`Order ${group.ref}`}>
            <PaymentList payments={group.payments} />
          </Panel>
        ))
      )}
    </AccountShell>
  );
}
