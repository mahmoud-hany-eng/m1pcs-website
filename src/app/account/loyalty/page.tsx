import { AccountShell } from "@/components/account/AccountShell";
import { LoyaltyHistory } from "@/components/account/dashboard";
import { EmptyState, Panel, StatCard } from "@/components/account/ui";
import { loadLoyalty } from "@/lib/accounts/server/data";
import { requireLinkedCustomer } from "@/lib/accounts/server/guard";
import { buildLoyalty } from "@/lib/accounts/shared/view-models";

export default async function LoyaltyPage() {
  const { user, supabase } = await requireLinkedCustomer("/account/loyalty");
  const { balance, ledger } = await loadLoyalty(supabase);
  const loyalty = buildLoyalty(balance, ledger);

  return (
    <AccountShell active="loyalty" email={user.email} title="Loyalty points" description="Points you have earned with M1. Every change is recorded below.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Your points" value={String(loyalty.balance)} hint={`${loyalty.entryCount} entr${loyalty.entryCount === 1 ? "y" : "ies"} in your history`} tone="gold" />
        <div className="glass glass-flat flex flex-col justify-center gap-2 p-5 text-sm text-text-secondary">
          <p className="font-semibold text-white">How points work</p>
          <p>Points are added once, after an order is complete. Spending points is not available yet, and M1 will tell you before it is.</p>
        </div>
      </div>

      {loyalty.entries.length === 0 ? (
        <EmptyState title="No points yet">
          <p>Your first points appear here after your first completed order.</p>
        </EmptyState>
      ) : (
        <Panel title="History">
          <LoyaltyHistory loyalty={loyalty} />
        </Panel>
      )}
    </AccountShell>
  );
}
