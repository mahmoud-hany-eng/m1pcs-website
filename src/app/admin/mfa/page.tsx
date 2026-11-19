import { notFound, redirect } from "next/navigation";
import { MfaPanel } from "@/components/admin/forms";
import { Container } from "@/components/ui/Container";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { signInUrl } from "@/lib/accounts/shared/redirect";
import { getSession } from "@/lib/accounts/server/session";
import { staffAdminGate } from "@/lib/staff/flag";

/**
 * The second-factor page for staff. A signed-in person without the second level lands here from any admin page.
 * It does not say whether the person is staff: anyone signed in can set up a factor, and the staff area decides
 * separately whether they may enter.
 */
export default async function MfaPage() {
  if (!staffAdminGate(process.env).enabled || !customerAccountsGate(process.env).enabled) notFound();
  const session = await getSession();
  if (session.state === "signed_out") redirect(signInUrl("required", "/admin"));
  if (session.state === "expired") redirect(signInUrl("expired", "/admin"));
  if (session.state !== "signed_in") throw new Error("unavailable");
  const { supabase } = session;

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.data?.currentLevel === "aal2") redirect("/admin");
  const factors = await supabase.auth.mfa.listFactors();
  const verified = factors.data?.totp?.[0] ?? null;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
      <style>{`body > header, body > footer, body > a[aria-label="Chat with M1 on WhatsApp"] { display: none !important; }`}</style>
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
          <MfaPanel factorId={verified ? verified.id : null} />
        </div>
      </Container>
    </div>
  );
}
