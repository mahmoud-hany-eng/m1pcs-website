import { AdminShell, type AdminSection } from "./AdminShell";
import { LinkButton } from "./ui";

/**
 * What a signed-in staff member sees for a record that does not exist or a page their role does not include. It is drawn
 * inside the admin frame, after the person has been verified as staff. A person who is NOT staff never reaches it: they
 * get the website's ordinary not-found page for every admin address, so nothing says that an admin area exists.
 */
export function AdminMissing({
  active,
  email,
  can,
  message = "That record was not found, or your role does not include it.",
}: {
  active: AdminSection;
  email: string | null;
  can: (permission: string) => boolean;
  message?: string;
}) {
  return (
    <AdminShell active={active} email={email} can={can} title="Not available" description={message} previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}>
      <div>
        <LinkButton href="/admin">Back to the overview</LinkButton>
      </div>
    </AdminShell>
  );
}
