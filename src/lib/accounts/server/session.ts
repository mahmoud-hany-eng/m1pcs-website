/**
 * Who is signed in, decided on the server.
 *
 * The answer comes from the auth service (`getUser`), which validates the token; the cookie alone is never trusted,
 * and neither is anything the browser sends about who the customer is or which customer record is theirs. A request
 * is classified as one of five states so each can be shown properly:
 *
 *   signed_in       a verified user
 *   signed_out      no session cookie at all
 *   expired         a session cookie is present but no longer valid (expired, revoked, or the user is gone)
 *   unavailable     the auth service could not be reached: NOT treated as expiry, so a brief outage does not look
 *                   like a logout
 *   not_configured  no Supabase configuration on this deployment
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { classifyAuthError } from "../shared/auth-errors";
import { createSupabaseServerClient, type AppSupabaseClient } from "./client";

export interface SessionUser {
  id: string;
  email: string | null;
}

export type Session =
  | { state: "signed_in"; user: SessionUser; supabase: AppSupabaseClient }
  | { state: "signed_out" }
  | { state: "expired" }
  | { state: "unavailable" }
  | { state: "not_configured" };

const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/** Cached for the length of one request, so several components share a single check. */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "not_configured" };
  const hadCookie = (await cookies()).getAll().some((cookie) => AUTH_COOKIE.test(cookie.name));
  const { data, error } = await supabase.auth.getUser();
  if (data.user && !error) {
    return { state: "signed_in", user: { id: data.user.id, email: data.user.email ?? null }, supabase };
  }
  if (!hadCookie) return { state: "signed_out" };
  return classifyAuthError(error) === "unavailable" ? { state: "unavailable" } : { state: "expired" };
});
