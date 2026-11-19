import Link from "next/link";
import { AuthCard } from "@/components/account/AccountShell";
import { ForgotPasswordForm } from "@/components/account/forms";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email address you signed up with and we will send you a link to choose a new password."
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
          .
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
