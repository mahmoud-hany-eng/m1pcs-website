import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/account/AccountShell";
import { ResetPasswordForm } from "@/components/account/forms";
import { Notice } from "@/components/account/ui";
import { getSession } from "@/lib/accounts/server/session";
import { signInUrl } from "@/lib/accounts/shared/redirect";

/**
 * Where a recovery link ends. The person is signed in by the link; this page only asks for the new password. Without a
 * session (the link was used, expired or never opened) there is nothing to do here, so it sends the person to start again.
 */
export default async function ResetPasswordPage() {
  const session = await getSession();
  if (session.state === "signed_out" || session.state === "expired") redirect(signInUrl("reset_link"));
  return (
    <AuthCard
      title="Choose a new password"
      description="Pick a password you do not use anywhere else."
      footer={
        <p>
          Not you?{" "}
          <Link href="/auth/forgot-password" className="font-semibold text-accent underline-offset-2 hover:underline">
            Start again
          </Link>
          .
        </p>
      }
    >
      {session.state === "unavailable" ? <Notice tone="error">We could not reach the sign-in service just now. Please try again in a moment.</Notice> : null}
      <ResetPasswordForm />
    </AuthCard>
  );
}
