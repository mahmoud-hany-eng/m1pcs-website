import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/account/AccountShell";
import { SignUpForm } from "@/components/account/forms";
import { getSession } from "@/lib/accounts/server/session";

export default async function SignUpPage() {
  const session = await getSession();
  if (session.state === "signed_in") redirect("/account");
  return (
    <AuthCard
      title="Create your account"
      description="Track your orders, see your payments and collect loyalty points. We will email you a link to confirm your address."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
          . Ordered through WhatsApp before? Create your account first, then use the code M1 sends you to link your earlier orders.
        </p>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
