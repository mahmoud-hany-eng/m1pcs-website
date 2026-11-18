import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { OrderCard } from "@/components/account/dashboard";
import { ProfileForm } from "@/components/account/forms";
import { EmptyState, Notice, Panel, StatCard } from "@/components/account/ui";
import { loadLoyalty, loadOrders, loadStatuses } from "@/lib/accounts/server/data";
import { requireCustomerContext } from "@/lib/accounts/server/guard";
import { buildOverview } from "@/lib/accounts/shared/view-models";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AccountOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, supabase, customer } = await requireCustomerContext("/account");
  const params = await searchParams;

  // A new account has no customer profile yet. It must choose: link an earlier (WhatsApp) customer record with a code,
  // or start a new profile. The choice is shown first because an account with a profile cannot be linked later.
  if (!customer) {
    return (
      <AccountShell active="overview" email={user.email} title="Welcome to M1" description="One quick step to set up your account." minimal>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Already ordered through WhatsApp?">
            <div className="flex flex-col gap-4 text-sm text-text-secondary">
              <p>
                If M1 has handled your orders by WhatsApp, link them to this account with the one-time code we send you. Your earlier orders, payments and
                loyalty points then appear here.
              </p>
              <p className="text-text-muted">We never link by email address or phone number alone, so a code is always needed.</p>
              <Link href="/account/claim" className="btn-sheen btn-red inline-flex items-center justify-center self-start rounded-full px-6 py-3 text-sm font-semibold">
                I have a claim code
              </Link>
            </div>
          </Panel>
          <Panel title="New to M1?">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">
                Start a new profile. Choose this only if you do not have orders with M1 yet: an account that starts with a new profile cannot be linked to an older one later.
              </p>
              <ProfileForm mode="create" />
            </div>
          </Panel>
        </div>
      </AccountShell>
    );
  }

  const [statuses, orders, loyalty] = await Promise.all([loadStatuses(supabase), loadOrders(supabase), loadLoyalty(supabase)]);
  const overview = buildOverview(customer, orders, statuses, loyalty.balance);

  return (
    <AccountShell active="overview" email={user.email} title={overview.greeting} description="Your orders, payments and rewards at M1 Gaming PCs.">
      {first(params.linked) === "1" ? <Notice tone="success">Your earlier orders are now linked to this account.</Notice> : null}
      {first(params.welcome) === "1" ? <Notice tone="success">Your profile is ready. Your orders will appear here as soon as M1 creates one for you.</Notice> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open orders" value={String(overview.openOrderCount)} hint={`${overview.orderCount} order${overview.orderCount === 1 ? "" : "s"} in total`} />
        <StatCard
          label="Balance to pay"
          value={overview.hasBalanceDue ? overview.totalBalanceDue : "Nothing due"}
          hint={overview.hasBalanceDue ? "Across your current orders" : "You are up to date"}
          tone={overview.hasBalanceDue ? "gold" : "default"}
        />
        <StatCard label="Loyalty points" value={String(overview.loyaltyBalance)} hint="Added after a completed order" tone="red" />
      </div>

      {overview.latestOrder ? (
        <Panel
          title="Your latest order"
          aside={
            <Link href="/account/orders" className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
              All orders
            </Link>
          }
        >
          <OrderCard order={overview.latestOrder} />
        </Panel>
      ) : (
        <EmptyState title="No orders yet" action={{ href: "/build-my-pc", label: "Request a quote" }}>
          <p>
            When M1 confirms an order for you, it appears here with live updates, payments and your balance. Ordered through WhatsApp before? Ask us for a claim code and link
            your earlier orders from the{" "}
            <Link href="/account/claim" className="text-accent underline-offset-2 hover:underline">
              claim page
            </Link>
            .
          </p>
        </EmptyState>
      )}
    </AccountShell>
  );
}
