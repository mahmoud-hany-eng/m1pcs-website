import Link from "next/link";
import { AuthCard } from "@/components/account/AccountShell";
import { ResendForm } from "@/components/account/forms";

export default function CheckEmailPage() {
  return (
    <AuthCard
      title="Check your email"
      description="If that address can be used for an account, we have sent a link to confirm it. Open the link on this device or any other."
      footer={
        <p>
          Wrong address?{" "}
          <Link href="/auth/sign-up" className="font-semibold text-accent underline-offset-2 hover:underline">
            Start again
          </Link>
          . Already confirmed?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
          .
        </p>
      }
    >
      <p className="text-sm text-text-secondary">It can take a minute to arrive. Look in your spam folder too. The link works once.</p>
      <ResendForm />
    </AuthCard>
  );
}
