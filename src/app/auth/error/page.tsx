import Link from "next/link";
import { AuthCard } from "@/components/account/AccountShell";
import { ResendForm } from "@/components/account/forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where a confirmation link that did not work ends. There are only two messages and neither says why a link failed:
 * a link that was used, expired or never existed all look the same.
 */
export default async function AuthErrorPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const unavailable = reason === "unavailable";
  return (
    <AuthCard
      title={unavailable ? "We could not complete that" : "That link did not work"}
      description={
        unavailable
          ? "The sign-in service is not reachable right now. Please try again in a moment."
          : "The link may have expired or already been used. Request a new one below, or sign in with your password."
      }
      footer={
        <Link href="/auth/sign-in" className="font-semibold text-accent underline-offset-2 hover:underline">
          Go to sign in
        </Link>
      }
    >
      {unavailable ? null : <ResendForm />}
    </AuthCard>
  );
}
