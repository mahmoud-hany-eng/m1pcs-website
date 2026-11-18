/**
 * The Supabase client for server code (Server Components, Server Actions, Route Handlers).
 *
 * Rules this file keeps:
 *  - A NEW client for every request. A client holds that request's session and is never shared.
 *  - It uses the public (anon) key only. The service-role key is not read anywhere in the customer-account code, and
 *    nothing here can run in a browser: authentication happens on the server, so the browser holds an HttpOnly
 *    cookie and no Supabase client of its own.
 *  - Session cookies are written with hardened attributes (see ../shared/cookies.ts).
 */
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabasePublicConfig } from "@/lib/platform/env";
import type { Database } from "@/lib/platform/supabase-database";
import { hardenCookieOptions, isSecureRequest } from "../shared/cookies";

export type AppSupabaseClient = SupabaseClient<Database>;

type CookieWrite = Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2];

/** Returns null when Supabase is not configured, so the caller can show "not available" instead of crashing. */
export async function createSupabaseServerClient(): Promise<AppSupabaseClient | null> {
  const config = readSupabasePublicConfig(process.env);
  if (!config.ok) return null;
  const cookieStore = await cookies();
  const secure = isSecureRequest(await headers());
  return createServerClient<Database>(config.config.url, config.config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hardenCookieOptions(options, secure) as CookieWrite);
          }
        } catch {
          // A Server Component cannot write cookies. That is expected: the middleware refreshes the session and
          // writes the cookies before the page renders, so nothing is lost.
        }
      },
    },
  });
}
