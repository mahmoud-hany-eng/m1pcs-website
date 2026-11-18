/**
 * Route guards. Every protected page calls one of these at the top, so a page never depends on a layout having
 * checked first (layouts are not re-rendered on every client navigation). Each guard re-verifies the session on the
 * server for that request.
 */
import { notFound, redirect } from "next/navigation";
import type { CustomerRow } from "@/lib/platform/database.types";
import { signInUrl } from "../shared/redirect";
import { customerAccountsGate } from "../shared/flag";
import type { AppSupabaseClient } from "./client";
import { loadCustomer } from "./data";
import { getSession, type SessionUser } from "./session";

/** With the feature flag off (or blocked in production) the account area does not exist: 404. */
export function assertAccountsEnabled(): void {
  if (!customerAccountsGate(process.env).enabled) notFound();
}

/** Thrown for a state the page cannot recover from; the error boundary shows a calm message. */
export class AccountsUnavailableError extends Error {
  constructor(reason: "unavailable" | "not_configured") {
    super(`customer accounts are unavailable (${reason})`);
    this.name = "AccountsUnavailableError";
  }
}

export interface SignedIn {
  user: SessionUser;
  supabase: AppSupabaseClient;
}

export async function requireSignedIn(nextPath: string): Promise<SignedIn> {
  assertAccountsEnabled();
  const session = await getSession();
  switch (session.state) {
    case "signed_in":
      return { user: session.user, supabase: session.supabase };
    case "signed_out":
      return redirect(signInUrl("required", nextPath));
    case "expired":
      return redirect(signInUrl("expired", nextPath));
    default:
      throw new AccountsUnavailableError(session.state);
  }
}

export interface SignedInCustomer extends SignedIn {
  /** Null while the account has no customer profile yet (it must create one or claim an existing one). */
  customer: CustomerRow | null;
}

export async function requireCustomerContext(nextPath: string): Promise<SignedInCustomer> {
  const base = await requireSignedIn(nextPath);
  const customer = await loadCustomer(base.supabase, base.user.id);
  return { ...base, customer };
}

/** For pages that only make sense once the account has a customer profile: it goes to the overview to set one up. */
export async function requireLinkedCustomer(nextPath: string): Promise<SignedInCustomer & { customer: CustomerRow }> {
  const context = await requireCustomerContext(nextPath);
  if (!context.customer) return redirect("/account");
  return { ...context, customer: context.customer };
}
