import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { Badge, DataTable, Empty, KeyValues, LinkButton, Money, Section, StatusBadge } from "@/components/admin/ui";
import { IssueClaimCodeForm, RevokeClaimCodeForm } from "@/components/admin/forms";
import { formatDay, formatWhen, sourceLabel } from "@/lib/staff/format";
import { StaffOperationError } from "@/lib/staff/gateway";
import { isUuid } from "@/lib/staff/validation";
import { requireStaff } from "@/lib/staff/session";
import type { ClaimCodeRow, CustomerDetail } from "@/lib/staff/types";

const CODE_TONE = { active: "progress", used: "done", revoked: "cancelled", expired: "neutral" } as const;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff, api, can } = await requireStaff(`/admin/customers/${isUuid(id) ? id : ""}`);
  if (!isUuid(id) || !can("customers.read")) return <AdminMissing active="customers" email={staff.email} can={can} />;
  let customer: CustomerDetail;
  try {
    customer = await api.getCustomer(id);
  } catch (error) {
    if (error instanceof StaffOperationError) return <AdminMissing active="customers" email={staff.email} can={can} />;
    throw error;
  }
  const manage = can("customers.manage");
  const codes: ClaimCodeRow[] = manage ? await api.claimCodes(id) : [];
  const orders = customer.orders ?? [];
  return (
    <AdminShell
      active="customers"
      email={staff.email}
      can={can}
      title={customer.full_name}
      description={`Customer ${customer.customer_code}`}
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={can("orders.create") ? <LinkButton href={`/admin/orders/new?customer=${customer.id}`} variant="red">New order</LinkButton> : undefined}
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Section title="Profile">
          <KeyValues
            items={[
              { label: "Phone", value: customer.phone ?? "—" },
              { label: "Email", value: customer.email ?? "—" },
              { label: "Source", value: sourceLabel(customer.source) },
              { label: "Language", value: customer.preferred_language === "ar" ? "Arabic" : "English" },
              { label: "Delivery address", value: customer.delivery_address ?? "—" },
              { label: "Customer since", value: formatDay(customer.created_at) },
              { label: "Website account", value: customer.linked_accounts > 0 ? <Badge tone="done">Linked ({customer.linked_accounts})</Badge> : <Badge>Not linked</Badge> },
              { label: "Loyalty points", value: customer.loyalty_points ?? "—" },
            ]}
          />
        </Section>

        {manage ? (
          <Section title="Claim code">
            <p className="mb-4 text-sm text-text-secondary">
              To link this customer&apos;s earlier orders to their website account, give them a claim code. They enter it after signing in. A code works once, expires, and can be revoked. Nothing is ever linked by matching an email address or a phone number.
            </p>
            <IssueClaimCodeForm customerId={customer.id} />
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Codes issued</h3>
              {codes.length === 0 ? (
                <Empty>No codes have been issued for this customer.</Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {codes.map((code) => (
                    <li key={code.id} className="rounded-glass-sm border border-border bg-white/[0.025] px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-text-secondary">Issued {formatWhen(code.created_at)}</span>
                        <Badge tone={CODE_TONE[code.status]}>{code.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        {code.status === "active" ? `Expires ${formatWhen(code.expires_at)}` : code.used_at ? `Used ${formatWhen(code.used_at)}` : code.revoked_at ? `Revoked ${formatWhen(code.revoked_at)}` : `Expired ${formatWhen(code.expires_at)}`}
                      </p>
                      {code.status === "active" ? (
                        <div className="mt-2">
                          <RevokeClaimCodeForm customerId={customer.id} codeId={code.id} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : null}
      </div>

      <Section title="Order history">
        <DataTable
          rows={orders}
          rowKey={(o) => o.id}
          rowHref={(o) => `/admin/orders/${o.id}`}
          empty="This customer has no orders yet."
          columns={[
            { key: "ref", header: "Order", cell: (o) => o.order_ref, primary: true },
            { key: "status", header: "Status", cell: (o) => <StatusBadge code={o.status} label={o.status_label} /> },
            { key: "total", header: "Order value", cell: (o) => <Money minor={o.total_minor} />, align: "right" },
            { key: "paid", header: "Paid", cell: (o) => <Money minor={o.amount_paid_minor} />, align: "right" },
            { key: "balance", header: "Balance due", cell: (o) => <Money minor={o.balance_due_minor} />, align: "right" },
            { key: "date", header: "Placed", cell: (o) => formatDay(o.created_at), hideOnCard: true },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
