/**
 * Safe redirect targets. A sign-in or confirmation link may carry a `next` address so a person lands where they were
 * going. An address taken from a request is never trusted: this module accepts only a path inside /account on this
 * same site and returns the fallback for everything else, so the sign-in flow cannot be used to send someone to
 * another site (an open redirect).
 */

export const DEFAULT_AFTER_SIGN_IN = "/account";
const PLACEHOLDER_ORIGIN = "http://m1.invalid";

/** Returns a same-site path that starts with /account, or the fallback. Only the path is kept, never a query string. */
export function safeAccountPath(input: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof input !== "string") return fallback;
  if (input.length === 0 || input.length > 200) return fallback;
  // Control characters, backslashes (some browsers treat them as slashes) and encoded slashes or dots are refused.
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return fallback;
  if (/%2f|%5c|%2e|%00|%0a|%0d/i.test(input)) return fallback;
  // Only an absolute path on this site: one slash, never two ("//host" is another site).
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(input, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  const path = url.pathname;
  if (path !== "/account" && !path.startsWith("/account/")) return fallback;
  return path;
}

/** The sign-in address for a person who must sign in first, with the page they were heading to. */
export function signInUrl(reason: "required" | "expired" | "signed_out", next?: string): string {
  const params = new URLSearchParams({ reason });
  if (next) params.set("next", safeAccountPath(next));
  return `/auth/sign-in?${params.toString()}`;
}
