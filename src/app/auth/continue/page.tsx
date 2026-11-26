import { redirect } from "next/navigation";
import { AuthCard, SignOutForm } from "@/components/account/AccountShell";
import { Notice } from "@/components/account/ui";
import { getSession } from "@/lib/accounts/server/session";
import { resolveAfterSignIn } from "@/lib/accounts/server/post-auth";
import { continueUrl } from "@/lib/accounts/shared/post-auth";
import { signInUrl } from "@/lib/accounts/shared/redirect";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The one place every sign-in ends. The password form, the e-mail link, the confirmation link and the password-recovery page all send the
 * person here, and this page asks the server who they are (staff or customer) and sends them to the right dashboard. It shows nothing of its
 * own unless the check could not be completed: then it says so, and offers to try again or to sign out. It never guesses "customer".
 */
export default async function ContinuePage({ searchParams }: { searchParams: SearchParams }) {
  const next = first((await searchParams).next);
  const session = await getSession();
  if (session.state === "signed_out") redirect(signInUrl("required", next));
  if (session.state === "expired") redirect(signInUrl("expired", next));

  if (session.state === "signed_in") {
    const route = await resolveAfterSignIn(next);
    if (route.kind === "go") redirect(route.to);
    if (route.kind === "sign_in") redirect(signInUrl(route.reason, next));
  }

  return (
    <AuthCard title="We could not finish signing you in" description="You are signed in, but we could not check where to take you just now. Nothing was changed.">
      <Notice tone="error">The check did not complete. Please try again in a moment.</Notice>
      <a href={continueUrl(next)} className="btn-sheen btn-red inline-flex items-center justify-center self-start rounded-full px-6 py-3 text-sm font-semibold">
        Try again
      </a>
      <SignOutForm />
    </AuthCard>
  );
}
