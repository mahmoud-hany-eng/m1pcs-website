import { AccountShell } from "@/components/account/AccountShell";
import { OrderCard } from "@/components/account/dashboard";
import { EmptyState } from "@/components/account/ui";
import { loadOrders, loadStatuses } from "@/lib/accounts/server/data";
import { requireLinkedCustomer } from "@/lib/accounts/server/guard";
import { buildOrderSummary } from "@/lib/accounts/shared/view-models";

export default async function OrdersPage() {
  const { user, supabase } = await requireLinkedCustomer("/account/orders");
  const [statuses, orders] = await Promise.all([loadStatuses(supabase), loadOrders(supabase)]);
  const cards = orders.map((order) => buildOrderSummary(order, statuses));

  return (
    <AccountShell active="orders" email={user.email} title="My orders" description="Every order M1 has placed for you, newest first.">
      {cards.length === 0 ? (
        <EmptyState title="No orders yet" action={{ href: "/build-my-pc", label: "Request a quote" }}>
          <p>
            You do not have any orders with M1 yet. Request a quote any time, no account needed. If your orders were placed through WhatsApp, use a claim code to link them to this account.
          </p>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cards.map((card) => (
            <OrderCard key={card.ref} order={card} />
          ))}
        </div>
      )}
    </AccountShell>
  );
}
