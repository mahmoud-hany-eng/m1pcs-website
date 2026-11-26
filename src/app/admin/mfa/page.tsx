import { redirect } from "next/navigation";
import { MfaPanel } from "@/components/admin/forms";
import { Container } from "@/components/ui/Container";
import { safeNextPath } from "@/lib/accounts/shared/redirect";
import { safeAdminHref } from "@/lib/staff/form-state";
import { requireStaffCandidate } from "@/lib/staff/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The second-factor page for staff. A signed-in person without the second level lands here from any admin page.
 * Only an active staff member sees it: anyone else gets the ordinary 404, so it cannot be used to find out that an
 * admin area exists. It sits inside the ordinary site (the M1 header stays at the top); it is not a full-screen overlay.
 */
export default async function MfaPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireStaffCandidate("/admin/mfa");
  const raw = (await searchParams).next;
  // The admin page the person was heading to, if any: only an address inside /admin, never the second-step page itself.
  const candidate = safeAdminHref(safeNextPath(Array.isArray(raw) ? raw[0] : raw, ""));
  const back = candidate && candidate !== "/admin/mfa" ? candidate : "";

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.data?.currentLevel === "aal2") redirect(back || "/admin");
  const factors = await supabase.auth.mfa.listFactors();
  const verified = factors.data?.totp?.[0] ?? null;

  return (
    <Container className="flex justify-center pb-20 pt-12 sm:pt-20">
      <div className="glass glass-strong w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">M1 staff</span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{verified ? "Enter your code" : "Set up your second step"}</h1>
          <p className="text-sm text-text-secondary">
            {verified
              ? "Open your authenticator app and enter the current 6-digit code to open the staff dashboard."
              : "Staff sign-in needs a second step. Use an authenticator app on your phone. You will do this once."}
          </p>
        </div>
        <MfaPanel factorId={verified ? verified.id : null} next={back} />
      </div>
    </Container>
  );
}
