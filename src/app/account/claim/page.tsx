import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { ClaimForm } from "@/components/account/forms";
import { Panel } from "@/components/account/ui";
import { requireCustomerContext } from "@/lib/accounts/server/guard";

export default async function ClaimPage() {
  const { user, customer } = await requireCustomerContext("/account/claim");

  return (
    <AccountShell active="claim" email={user.email} title="Link your earlier orders" description="Use the one-time code from M1 to bring orders placed through WhatsApp into this account." minimal={!customer}>
      {customer ? (
        <Panel title="This account is already linked">
          <div className="flex flex-col gap-4 text-sm text-text-secondary">
            <p>Your account already has a customer profile, so a claim code cannot be used on it. If you believe orders are missing, message M1 on WhatsApp and we will check.</p>
            <Link href="/account/orders" className="btn-sheen btn-glass inline-flex items-center justify-center self-start rounded-full px-5 py-2.5 text-sm font-semibold">
              Go to my orders
            </Link>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Enter your claim code">
            <ClaimForm />
          </Panel>
          <Panel title="How this works">
            <ul className="flex flex-col gap-3 text-sm text-text-secondary">
              <li>M1 creates a one-time code for you and sends it by WhatsApp.</li>
              <li>The code works once and expires after a few days.</li>
              <li>We never connect an account to earlier orders because an email address or phone number matches. Only the code does that.</li>
              <li>After five wrong tries in an hour, further tries are paused for a while. Ask M1 for a new code if you are stuck.</li>
            </ul>
          </Panel>
        </div>
      )}
    </AccountShell>
  );
}
