/**
 * Middleware for the customer-account routes only.
 *
 * It runs for /account, /auth and /admin and for nothing else (see the matcher), so the public pages and the WhatsApp
 * quotation journey never pass through it. With the feature flags off it does nothing at all. The admin area has its
 * own switch (STAFF_ADMIN_ENABLED) and, because staff use the same sign-in pages, also needs the account switch.
 *
 * With the flag on it refreshes the session before the page renders, so an access token that has expired is renewed
 * and the new HttpOnly cookies are written to the response (a Server Component cannot write cookies). It also keeps
 * these pages out of search results and out of any shared cache, and sends a visitor with no session straight to the
 * sign-in page. The pages still verify the session themselves; this is a first line, not the only one.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { classifyAuthError } from "@/lib/accounts/shared/auth-errors";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { hardenCookieOptions, isSecureRequest } from "@/lib/accounts/shared/cookies";
import { signInUrl } from "@/lib/accounts/shared/redirect";
import { readSupabasePublicConfig } from "@/lib/platform/env";
import { staffAdminGate } from "@/lib/staff/flag";

const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export async function middleware(request: NextRequest) {
  // Staff sign in on the same pages as customers, so the admin area also needs the account switch.
  if (!customerAccountsGate(process.env).enabled) return NextResponse.next();
  const area = request.nextUrl.pathname;
  const inAdmin = area === "/admin" || area.startsWith("/admin/");
  const inAccount = area === "/account" || area.startsWith("/account/");
  // An admin area that is switched off answers its own 404; nothing is refreshed for it.
  if (inAdmin && !staffAdminGate(process.env).enabled) return NextResponse.next();

  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  const config = readSupabasePublicConfig(process.env);
  if (!config.ok) return response;
  const secure = isSecureRequest(request.headers);

  const supabase = createServerClient(config.config.url, config.config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, hardenCookieOptions(options, secure) as Parameters<typeof response.cookies.set>[2]);
        }
        for (const [key, headerValue] of Object.entries(cacheHeaders)) response.headers.set(key, headerValue);
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
      },
    },
  });

  // Refreshes an expired access token and verifies the signature. The result is only used to decide whether to turn
  // away a visitor who has no session at all.
  const { data, error } = await supabase.auth.getClaims();

  const path = request.nextUrl.pathname;
  if ((inAccount || inAdmin) && !data?.claims) {
    // An outage of the auth service is not a sign-out. Let the page through so it can show its own "could not load"
    // state, instead of sending a signed-in customer to the sign-in page because of a brief network problem.
    if (classifyAuthError(error) === "unavailable") return response;
    const hadCookie = request.cookies.getAll().some((cookie) => AUTH_COOKIE.test(cookie.name));
    const redirectResponse = NextResponse.redirect(new URL(signInUrl(hadCookie ? "expired" : "required", path), request.url));
    // Keep any cookie the refresh attempt wrote (for example one that cleared a dead session).
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    redirectResponse.headers.set("Cache-Control", "private, no-store");
    redirectResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
    return redirectResponse;
  }
  return response;
}

export const config = {
  matcher: ["/account/:path*", "/auth/:path*", "/admin/:path*"],
};
