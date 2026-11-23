import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { DataTable, SearchBar, Section } from "@/components/admin/ui";
import { OrderForm } from "@/components/admin/forms";
import { StaffOperationError, StaffUnavailableError } from "@/lib/staff/gateway";
import { toContextView } from "@/lib/staff/pricing-form";
import { Notice } from "@/components/account/ui";
import { isUuid } from "@/lib/staff/validation";
import { requireStaff } from "@/lib/staff/session";

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string | string[]; q?: string | string[] }> }) {
  const { staff, api, can } = await requireStaff("/admin/orders/new");
  if (!can("orders.create") || !can("customers.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  const params = await searchParams;
  const customerId = first(params.customer);
  const shell = { active: "orders" as const, email: staff.email, can, previewLabel: process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null };

  if (isUuid(customerId)) {
    let customer;
    let pricing;
    try {
      customer = await api.getCustomer(customerId);
      // The Pricing & Rewards section needs this customer's points, the point value, the deposit schedule and what this staff member may do.
      pricing = await api.orderPricingContext(customerId);
    } catch (error) {
      if (error instanceof StaffOperationError) return <AdminMissing active="orders" email={staff.email} can={can} />;
      if (error instanceof StaffUnavailableError) {
        return (
          <AdminShell {...shell} title="New order" description="The pricing information for this customer could not be loaded.">
            <Notice tone="error">{error.message} Nothing was changed. Reload the page to try again.</Notice>
          </AdminShell>
        );
      }
      throw error;
    }
    return (
      <AdminShell {...shell} title="New order" description="Add the items with the prices you have verified. The total is worked out from them; then check the pricing summary.">
        <Section title="Order items" aside={<Link href="/admin/orders/new" className="text-sm font-semibold text-accent hover:underline">Change customer</Link>}>
          {/* keyed by the customer: a different customer is a different form, with that customer's points and no leftover choices */}
          <OrderForm key={customer.id} customerId={customer.id} customerName={customer.full_name} idempotencyKey={randomUUID()} pricing={toContextView(pricing)} />
        </Section>
      </AdminShell>
    );
  }

  const q = first(params.q).slice(0, 80);
  const rows = await api.searchCustomers(q, 25);
  return (
    <AdminShell {...shell} title="New order" description="First choose the customer. If they are not listed, create their record.">
      <Section title="Choose a customer" aside={can("customers.manage") ? <Link href="/admin/customers/new" className="text-sm font-semibold text-accent hover:underline">New customer</Link> : null}>
        <div className="mb-4">
          <SearchBar action="/admin/orders/new" value={q} placeholder="Search customers" />
        </div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/orders/new?customer=${r.id}`}
          empty="No customer matches. Create their record first."
          columns={[
            { key: "name", header: "Customer", cell: (r) => r.full_name, primary: true },
            { key: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.customer_code}</span> },
            { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—" },
            { key: "orders", header: "Orders", cell: (r) => r.order_count, align: "right" },
          ]}
        />
      </Section>
    </AdminShell>
  );
}
