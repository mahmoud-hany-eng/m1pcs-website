import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/account/AccountShell";
import { EmailLinkForm, SignInForm } from "@/components/account/forms";
import { Notice } from "@/components/account/ui";
import { signInNotice } from "@/lib/accounts/shared/auth-errors";
import { safeNextPath } from "@/lib/accounts/shared/redirect";
import { SignOutForm } from "@/components/account/AccountShell";
import { resolveAfterSignIn } from "@/lib/accounts/server/post-auth";
import { getSession } from "@/lib/accounts/server/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // `next` is checked here and again when the form is submitted: only a path inside /account or /admin is ever followed. An empty `next` means
  // "no particular page": the router then chooses the dashboard that belongs to the person.
  const next = safeNextPath(first(params.next), "");
  const session = await getSession();
  let routerUnavailable = false;
  if (session.state === "signed_in") {
    // Already signed in: the same router as after a password or an e-mail link. A failed staff check is shown, never read as "customer".
    const route = await resolveAfterSignIn(next);
    if (route.kind === "go") redirect(route.to);
    routerUnavailable = route.kind === "unavailable";
  }
  const notice = signInNotice(first(params.reason));

  return (
    <AuthCard
      title="Sign in"
      description="See your orders, tracking updates, payments and loyalty points."
      footer={
        <p>
          New here?{" "}
          <Link href="/auth/sign-up" className="font-semibold text-accent underline-offset-2 hover:underline">
            Create an account
          </Link>
          . You do not need an account to request a quote: that stays open to everyone.
        </p>
      }
    >
      {notice ? <Notice tone={first(params.reason) === "expired" ? "error" : "info"}>{notice}</Notice> : null}
      {session.state === "unavailable" ? <Notice tone="error">We could not reach the sign-in service just now. Please try again in a moment.</Notice> : null}
      {routerUnavailable ? (
        <>
          <Notice tone="error">You are signed in, but we could not check where to take you just now. Nothing was changed. Please try again in a moment.</Notice>
          <SignOutForm />
        </>
      ) : null}
      <SignInForm next={next} />
      <p className="-mt-2 text-center text-sm">
        <Link href="/auth/forgot-password" className="text-text-secondary underline-offset-2 hover:text-white hover:underline">
          Forgot your password?
        </Link>
      </p>
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <EmailLinkForm next={next} />
    </AuthCard>
  );
}
