/**
 * The address that links in sign-in emails point back to. It comes from configuration, never from a request header
 * that a visitor could set, except for plain local development where the host is a local address.
 *
 *   CUSTOMER_ACCOUNTS_SITE_URL   the public origin of this deployment, for example the preview address
 *
 * The auth service also checks every redirect address against an allow-list that the owner sets in its dashboard, so
 * a wrong value here fails safe: the link falls back to the service's own Site URL.
 */
import type { EnvSource } from "./flag";

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The configured origin, or, for a local address only, the origin of the request. Otherwise null. */
export function resolveSiteOrigin(env: EnvSource, requestHost: string | null, requestProto: string | null): string | null {
  const configured = origin(env.CUSTOMER_ACCOUNTS_SITE_URL);
  if (configured) return configured;
  if (!requestHost) return null;
  const host = requestHost.split(":")[0].toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  return origin(`${requestProto === "https" ? "https" : "http"}://${requestHost}`);
}

const DEFAULT_CONFIRM_NEXT = "/account";

/**
 * The address a confirmation or password-reset link should open.
 *
 * It ALWAYS carries a query string. The email templates (supabase/templates) build the link as `{{ .RedirectTo }}&token_hash=...&type=...`, which is
 * a valid link only when this address already contains a "?". Without a `next` the address was `/auth/confirm` alone and the emailed link became
 * `/auth/confirm&token_hash=...` (a page that does not exist). "/account" is the usual landing place, not a request: the sign-in router
 * (shared/post-auth.ts) drops it and decides the destination from verified staff membership, so a default `next` never changes where anyone goes.
 */
export function confirmUrl(siteOrigin: string, next?: string): string {
  const url = new URL("/auth/confirm", siteOrigin);
  url.searchParams.set("next", next || DEFAULT_CONFIRM_NEXT);
  return url.toString();
}
