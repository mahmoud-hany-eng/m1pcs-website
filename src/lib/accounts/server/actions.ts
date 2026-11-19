"use server";

/**
 * Server Actions for the customer account forms. Each one:
 *  - answers 404 when the feature flag is off, so an old form post cannot reach a disabled feature;
 *  - validates its input on the server, whatever the browser did;
 *  - reads the signed-in user from the verified session, never from the form (there is no customer-id field anywhere);
 *  - returns fixed messages that cannot be used to learn whether an address, a customer or a claim code exists.
 *
 * Server Actions are POST only and Next.js checks the request origin against the host, which is the CSRF defence.
 */
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  authFailureMessage,
  classifyAuthError,
  type AuthFailure,
} from "../shared/auth-errors";
import { CLAIM_FAILED_MESSAGE, normalizeClaimCode } from "../shared/claim-code";
import { customerAccountsGate } from "../shared/flag";
import type { FormState } from "../shared/form-state";
import { safeNextPath } from "../shared/redirect";
import { confirmUrl, resolveSiteOrigin } from "../shared/site-url";
import { parseEmailOnly, parseProfile, parseSignIn, parseSignUp } from "../shared/validation";
import { createSupabaseServerClient } from "./client";
import { requireCustomerContext, requireLinkedCustomer } from "./guard";

function assertEnabled(): void {
  if (!customerAccountsGate(process.env).enabled) notFound();
}

async function emailLinkTarget(next?: string): Promise<string | undefined> {
  const requestHeaders = await headers();
  const origin = resolveSiteOrigin(process.env, requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
  return origin ? confirmUrl(origin, next) : undefined;
}

function failureState(failure: AuthFailure): FormState {
  return { status: "error", message: authFailureMessage(failure) };
}

function logFailure(step: string, error: { code?: string | null; status?: number | null } | null): void {
  // The step and the error code only: never the address, the password or the response body.
  console.error(`[accounts] ${step} failed (${error?.code ?? error?.status ?? "no code"})`);
}

// ---------------------------------------------------------------------------------------------------------------
// Sign up, sign in, sign out
// ---------------------------------------------------------------------------------------------------------------

export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  assertEnabled();
  const parsed = parseSignUp(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failureState("unavailable");

  const redirectTo = await emailLinkTarget("/account");
  const { data, error } = await supabase.auth.signUp({
    email: parsed.value.email,
    password: parsed.value.password,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error && error.code !== "user_already_exists") {
    const failure = classifyAuthError(error);
    logFailure("sign-up", error);
    return failureState(["weak_password", "rate_limited", "signups_closed", "unavailable"].includes(failure) ? failure : "unknown");
  }
  // An address that already has an account is handled exactly like a new one: the same screen, no hint. (The project
  // must keep email confirmation switched on; that is what makes the service itself answer the same way.)
  if (data?.session) redirect("/account");
  redirect("/auth/check-email");
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  assertEnabled();
  const parsed = parseSignIn(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
  const next = safeNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failureState("unavailable");

  const { error } = await supabase.auth.signInWithPassword(parsed.value);
  if (error) {
    const failure = classifyAuthError(error);
    if (failure === "unknown") logFailure("sign-in", error);
    return failureState(["invalid_credentials", "email_not_confirmed", "rate_limited", "unavailable"].includes(failure) ? failure : "unknown");
  }
  redirect(next);
}

/** Sends a one-time sign-in link to an EXISTING account. The answer is the same whether or not the address has one. */
export async function emailLinkAction(_previous: FormState, formData: FormData): Promise<FormState> {
  assertEnabled();
  const parsed = parseEmailOnly(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
  const next = safeNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failureState("unavailable");

  const redirectTo = await emailLinkTarget(next);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.value.email,
    options: { shouldCreateUser: false, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) },
  });
  if (error) {
    const failure = classifyAuthError(error);
    // Only a rate limit or an outage is reported. Anything else, including "no such user", looks like success.
    if (failure === "rate_limited" || failure === "unavailable") return failureState(failure);
  }
  return { status: "success", message: "If that address has an account, we have sent a sign-in link. It works once and expires soon." };
}

/** Sends the confirmation email again. The answer is the same whether or not the address has an account. */
export async function resendConfirmationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  assertEnabled();
  const parsed = parseEmailOnly(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failureState("unavailable");

  const redirectTo = await emailLinkTarget("/account");
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.value.email,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error) {
    const failure = classifyAuthError(error);
    if (failure === "rate_limited" || failure === "unavailable") return failureState(failure);
  }
  return { status: "success", message: "If that address is waiting for confirmation, we have sent the link again." };
}

export async function signOutAction(): Promise<void> {
  assertEnabled();
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) logFailure("sign-out", error);
  }
  redirect("/auth/sign-in?reason=signed_out");
}

// ---------------------------------------------------------------------------------------------------------------
// Profile and claiming
// ---------------------------------------------------------------------------------------------------------------

/** Creates a NEW customer profile for this account. It never attaches the account to an existing customer. */
export async function createProfileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { user, supabase, customer } = await requireCustomerContext("/account");
  if (customer) return { status: "success", message: "Your profile is already set up. Taking you to your account…", then: "account" };
  const parsed = parseProfile(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };

  const { error } = await supabase.rpc("create_my_customer_profile", {
    p_full_name: parsed.value.full_name,
    p_phone: parsed.value.phone,
    // The contact email is the one the auth service verified, never a value typed into the form.
    p_email: user.email,
    p_preferred_language: parsed.value.preferred_language,
  });
  if (error) {
    if (error.code === "23505") return { status: "success", message: "Your profile is already set up. Taking you to your account…", then: "account" };
    logFailure("create profile", error);
    return failureState("unknown");
  }
  // Returned, not redirect()ed: the form follows it with one ordinary navigation. A server-action redirect between
  // two pages of the same layout sometimes failed to move the browser in Next 15.5 (see the architecture notes), which
  // left the old form on screen although the profile had been created.
  return { status: "success", message: "Your profile is ready. Taking you to your account…", then: "welcome" };
}

export async function updateProfileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, customer } = await requireLinkedCustomer("/account/profile");
  const parsed = parseProfile(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors };

  // The customer id comes from the verified session's own link, never from the form. The database also only lets a
  // customer change their own contact columns.
  const { data, error } = await supabase
    .from("customers")
    .update({
      full_name: parsed.value.full_name,
      phone: parsed.value.phone,
      preferred_language: parsed.value.preferred_language,
      delivery_address: parsed.value.delivery_address,
      marketing_consent: parsed.value.marketing_consent,
    })
    .eq("id", customer.id)
    .select("id");
  if (error || !data || data.length === 0) {
    logFailure("update profile", error);
    return failureState("unknown");
  }
  return { status: "success", message: "Your details have been saved." };
}

/**
 * Joins an existing customer record, for example a WhatsApp-managed one, to this account using a one-time code that
 * staff issued. The database does the work and the protection: the code is stored only as a hash, expires, works
 * once, and after five failures in an hour every attempt is refused. This action reports every failure with the same
 * sentence, so it reveals nothing about which customers or codes exist.
 */
export async function claimAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, customer } = await requireCustomerContext("/account/claim");
  if (customer) return { status: "error", message: "This account is already linked to a customer profile." };

  const code = normalizeClaimCode(formData.get("code"));
  if (!code) return { status: "error", message: CLAIM_FAILED_MESSAGE };

  const { data, error } = await supabase.rpc("claim_customer_profile", { p_code: code });
  if (error?.code === "23505") return { status: "error", message: "This account is already linked to a customer profile." };
  if (error) logFailure("claim", error);
  // One failure path and one sentence: an unexpected error looks the same as a wrong code.
  if (error || !data) return { status: "error", message: CLAIM_FAILED_MESSAGE };
  return { status: "success", message: "Your earlier orders are now linked. Taking you to your account…", then: "linked" };
}
