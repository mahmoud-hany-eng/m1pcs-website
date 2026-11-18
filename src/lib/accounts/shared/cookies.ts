/**
 * Session cookie attributes.
 *
 * The Supabase server library sets its session cookies for use by a browser client: not HttpOnly, no Secure flag and
 * a lifetime of 400 days. This site never runs a Supabase client in the browser (all authentication happens in server
 * actions and route handlers), so the session cookies are tightened:
 *
 *   HttpOnly   script on the page can never read the session, so cross-site scripting cannot steal it
 *   Secure     sent only over HTTPS (on plain http://localhost, for local preview, it is left off)
 *   SameSite   Lax: sent on ordinary navigation, withheld from cross-site sub-requests
 *   Path=/     one cookie for the whole site, never scoped to a domain wider than the host
 *   Max-Age    capped, so a forgotten browser does not keep a session for more than a month
 *
 * A cookie that is being DELETED (Max-Age 0) keeps Max-Age 0, so signing out still clears it.
 */

export interface CookieOptionsLike {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  [key: string]: unknown;
}

export const MAX_SESSION_COOKIE_SECONDS = 30 * 24 * 60 * 60;

export function hardenCookieOptions(options: CookieOptionsLike | undefined, secure: boolean): CookieOptionsLike {
  const incoming = options ?? {};
  const deleting = incoming.maxAge === 0 || (incoming.expires instanceof Date && incoming.expires.getTime() <= 0);
  const hardened: CookieOptionsLike = {
    ...incoming,
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
  };
  // Never widen to a parent domain: the cookie belongs to the exact host that set it.
  delete hardened.domain;
  if (deleting) {
    hardened.maxAge = 0;
  } else {
    const wanted = typeof incoming.maxAge === "number" && incoming.maxAge > 0 ? incoming.maxAge : MAX_SESSION_COOKIE_SECONDS;
    hardened.maxAge = Math.min(wanted, MAX_SESSION_COOKIE_SECONDS);
  }
  return hardened;
}

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Whether the request reached us over HTTPS. A proxy such as Vercel's reports it in x-forwarded-proto. Without that
 * header, only a local address counts as insecure; anything else is treated as HTTPS so the Secure flag errs on.
 */
export function isSecureRequest(headers: HeaderReader): boolean {
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase() === "https";
  const host = (headers.get("host") ?? "").split(":")[0].toLowerCase();
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}
