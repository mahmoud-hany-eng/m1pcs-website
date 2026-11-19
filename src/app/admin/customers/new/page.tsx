import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { Section } from "@/components/admin/ui";
import { CustomerForm } from "@/components/admin/forms";
import { requireStaff } from "@/lib/staff/session";

export default async function NewCustomerPage() {
  const { staff, can } = await requireStaff("/admin/customers/new");
  if (!can("customers.manage")) return <AdminMissing active="customers" email={staff.email} can={can} />;
  return (
    <AdminShell
      active="customers"
      email={staff.email}
      can={can}
      title="New customer"
      description="Record a customer who orders over WhatsApp, so their orders can be tracked and, later, claimed by them."
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
    >
      <Section title="Customer details">
        <CustomerForm />
      </Section>
    </AdminShell>
  );
}
