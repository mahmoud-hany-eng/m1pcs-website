import { AccountShell } from "@/components/account/AccountShell";
import { ProfileForm } from "@/components/account/forms";
import { Panel } from "@/components/account/ui";
import { requireLinkedCustomer } from "@/lib/accounts/server/guard";
import { formatDate } from "@/lib/accounts/shared/view-models";

export default async function ProfilePage() {
  const { user, customer } = await requireLinkedCustomer("/account/profile");
  return (
    <AccountShell active="profile" email={user.email} title="My profile" description="The details M1 uses to contact you and deliver your orders.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Your details">
            <ProfileForm
              mode="update"
              defaults={{
                full_name: customer.full_name,
                phone: customer.phone,
                preferred_language: customer.preferred_language,
                delivery_address: customer.delivery_address,
                marketing_consent: customer.marketing_consent,
              }}
            />
          </Panel>
        </div>
        <Panel title="Your account">
          <dl className="flex flex-col gap-4 text-sm">
            <div>
              <dt className="text-text-muted">Sign-in email</dt>
              <dd className="mt-0.5 break-all text-white">{user.email ?? "Not available"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Customer number</dt>
              <dd className="mt-0.5 font-mono text-white">{customer.customer_code}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Customer since</dt>
              <dd className="mt-0.5 text-white">{formatDate(customer.created_at)}</dd>
            </div>
          </dl>
          <p className="mt-5 text-xs text-text-muted">Quote the customer number if you message M1 about an order. Your sign-in email is changed by contacting M1.</p>
        </Panel>
      </div>
    </AccountShell>
  );
}
