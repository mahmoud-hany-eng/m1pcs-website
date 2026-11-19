/**
 * Turns an error from the auth service into a message that is safe to show. The raw error text is never shown: it can
 * name internal details, and for some errors it would reveal whether an address has an account. Each message below is
 * fixed, and the unknown case is deliberately vague.
 */

export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  name?: string | null;
}

export type AuthFailure =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "same_password"
  | "signups_closed"
  | "session_expired"
  | "unavailable"
  | "unknown";

export function classifyAuthError(error: AuthErrorLike | null | undefined): AuthFailure {
  if (!error) return "unknown";
  const code = (error.code ?? "").toLowerCase();
  const status = error.status ?? 0;
  const name = error.name ?? "";
  if (code === "invalid_credentials") return "invalid_credentials";
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || code === "over_sms_send_rate_limit" || status === 429) return "rate_limited";
  if (code === "weak_password") return "weak_password";
  if (code === "same_password") return "same_password";
  if (code === "signup_disabled" || code === "email_provider_disabled") return "signups_closed";
  if (["bad_jwt", "session_expired", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "user_not_found"].includes(code)) return "session_expired";
  if (name === "AuthSessionMissingError") return "session_expired";
  if (name === "AuthRetryableFetchError" || status >= 500 || (status === 0 && name.includes("Fetch"))) return "unavailable";
  if (status === 401 || status === 403) return "session_expired";
  return "unknown";
}

const MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: "The email or password is not correct.",
  email_not_confirmed: "Please confirm your email address first. Use the link we sent, or request a new one below.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  weak_password: "That password is too easy to guess. Choose a longer or less common one.",
  same_password: "Choose a different password from the one you have now.",
  signups_closed: "Accounts are not open yet.",
  session_expired: "Your session has ended. Please sign in again.",
  unavailable: "We could not reach the sign-in service. Please try again in a moment.",
  unknown: "Something went wrong. Please try again.",
};

export function authFailureMessage(failure: AuthFailure): string {
  return MESSAGES[failure];
}

/** Why a person arrived at the sign-in page, as a short notice. Unknown reasons show nothing. */
export function signInNotice(reason: unknown): string | null {
  switch (reason) {
    case "expired":
      return "Your session has ended. Please sign in again.";
    case "required":
      return "Please sign in to see your account.";
    case "signed_out":
      return "You have been signed out.";
    case "reset_link":
      return "That reset link has been used or has expired. Request a new one.";
    case "confirmed":
      return "Your email is confirmed. You can sign in.";
    default:
      return null;
  }
}
