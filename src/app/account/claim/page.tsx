import { AccountShell } from "@/components/account/AccountShell";
import { ClaimForm } from "@/components/account/forms";
import { Panel } from "@/components/account/ui";
import { requireCustomerContext } from "@/lib/accounts/server/guard";

export default async function ClaimPage() {
  const { user, customers } = await requireCustomerContext("/account/claim");
  const linked = customers.length > 0;

  return (
    <AccountShell
      active="claim"
      email={user.email}
      title={linked ? "Link another earlier record" : "Link your earlier orders"}
      description="Use the one-time code from M1 to bring orders placed through WhatsApp into this account."
      minimal={!linked}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Enter your claim code">
          <ClaimForm />
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="How this works">
            <ul className="flex flex-col gap-3 text-sm text-text-secondary">
              <li>M1 creates a one-time code for you and sends it by WhatsApp. Each earlier record has its own code.</li>
              <li>The code works once and expires after a few days. M1 can cancel a code at any time.</li>
              <li>We never connect an account to earlier orders because an email address or phone number matches. Only the code does that, and every link is recorded.</li>
              <li>Linking adds the earlier record to this account. It does not merge or change either record.</li>
              <li>After five wrong tries in an hour, further tries are paused for a while. Ask M1 for a new code if you are stuck.</li>
            </ul>
          </Panel>
          {linked ? (
            <Panel title="Records linked to this account">
              <ul className="flex flex-col gap-2 text-sm">
                {customers.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-glass-sm border border-border bg-white/[0.025] px-3.5 py-2.5">
                    <span className="text-white">{c.full_name}</span>
                    <span className="font-mono text-xs text-text-muted">{c.customer_code}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-text-muted">An account can hold up to five records. If a code is refused and you have not made many tries, you may already be at the limit: message M1 on WhatsApp.</p>
            </Panel>
          ) : null}
        </div>
      </div>
    </AccountShell>
  );
}
