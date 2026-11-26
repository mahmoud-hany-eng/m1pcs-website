/**
 * Who is acting in the admin area, decided on the server.
 *
 * A staff request is accepted only when ALL of these hold:
 *   - the admin area is enabled (a server variable, never on in production);
 *   - the auth service itself confirms the sign-in (`getUser`, not the cookie);
 *   - the verified token says the second factor was completed (`aal2`) and names a session;
 *   - the staff table names this person as active, which the database decides (through the gateway, which the
 *     database in turn checks against the auth service's own session record).
 * Anything else is a redirect to sign in or to the second-factor page, or an ordinary 404 (a customer must not be
 * able to tell that an admin area exists).
 */
import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { AccountsUnavailableError } from "@/lib/accounts/server/guard";
import type { AppSupabaseClient } from "@/lib/accounts/server/client";
import { getSession, type Session } from "@/lib/accounts/server/session";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { signInUrl } from "@/lib/accounts/shared/redirect";
import { staffAdminGate } from "./flag";
import { isGatewayConfigured, StaffUnavailableError, type VerifiedStaff } from "./gateway";
import { staffApi, type StaffApi } from "./api";
import { logStaffDiagnostic } from "./diagnostics";

export type StaffState =
  | { state: "disabled" }
  | { state: "signed_out" }
  | { state: "expired" }
  | { state: "unavailable" }
  | { state: "needs_mfa"; userId: string }
  | { state: "not_staff" }
  | { state: "ok"; staff: VerifiedStaff; permissions: ReadonlySet<string>; api: StaffApi };

/** What the verified session and token say about the person, shared by the staff state and the second-step page. */
type Identity =
  | { ok: true; supabase: AppSupabaseClient; staff: VerifiedStaff; aal: string }
  | { ok: false; state: "disabled" | "signed_out" | "expired" | "unavailable" };

const adminEnabled = () => staffAdminGate(process.env).enabled && customerAccountsGate(process.env).enabled;

/** The identity for a session that has ALREADY been verified by getSession (so a caller that holds one does not ask the auth service twice). */
async function identityFromSession(session: Session): Promise<Identity> {
  if (session.state === "signed_out") return { ok: false, state: "signed_out" };
  if (session.state === "expired") return { ok: false, state: "expired" };
  if (session.state !== "signed_in") {
    logStaffDiagnostic({ stage: "auth", reason: session.state });
    return { ok: false, state: "unavailable" };
  }

  // The claims of the verified token: the assurance level and the session id. getClaims verifies the signature.
  const { data, error } = await session.supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; aal?: string; session_id?: string } | undefined;
  if (error || !claims || claims.sub !== session.user.id || !claims.session_id) return { ok: false, state: "expired" };
  if (!isGatewayConfigured()) {
    logStaffDiagnostic({ stage: "config", reason: "env_missing" });
    return { ok: false, state: "unavailable" };
  }
  return {
    ok: true,
    supabase: session.supabase,
    staff: { userId: session.user.id, sessionId: claims.session_id, email: session.user.email },
    aal: claims.aal ?? "aal1",
  };
}

async function readIdentity(): Promise<Identity> {
  // Staff sign in on the customer sign-in pages, so both switches must be on.
  if (!adminEnabled()) return { ok: false, state: "disabled" };
  return identityFromSession(await getSession());
}

export const getStaffState = cache(async (): Promise<StaffState> => {
  const identity = await readIdentity();
  if (!identity.ok) return { state: identity.state };
  const api = staffApi(identity.staff);
  try {
    // First: is this person active staff at all? A customer must get the same "not found" as for any other address,
    // so this is asked before anything about the second factor is said.
    if (!(await api.isStaffMember())) return { state: "not_staff" };
    if (identity.aal !== "aal2") return { state: "needs_mfa", userId: identity.staff.userId };
    const permissions = new Set(await api.permissions());
    if (permissions.size === 0) return { state: "not_staff" };
    return { state: "ok", staff: identity.staff, permissions, api };
  } catch (error) {
    if (error instanceof StaffUnavailableError) return { state: "unavailable" };
    // A permission refusal here means the database did not accept this session as an active, second-factor staff
    // session. It is the same answer as "not staff".
    logStaffDiagnostic({ stage: "authz", reason: "permission_refused" });
    return { state: "not_staff" };
  }
});

/**
 * For the second-step page and its actions: a signed-in person who is active staff but may not have completed the
 * second factor yet. Anyone else gets the ordinary 404, so the page cannot be used to find out that an admin area exists.
 */
export async function requireStaffCandidate(nextPath: string): Promise<{ supabase: AppSupabaseClient; staff: VerifiedStaff; aal: string }> {
  const identity = await readIdentity();
  if (!identity.ok) {
    switch (identity.state) {
      case "disabled":
        return notFound();
      case "signed_out":
        return redirect(signInUrl("required", nextPath));
      case "expired":
        return redirect(signInUrl("expired", nextPath));
      default:
        throw new AccountsUnavailableError("unavailable");
    }
  }
  let isStaff = false;
  try {
    isStaff = await staffApi(identity.staff).isStaffMember();
  } catch (error) {
    if (error instanceof StaffUnavailableError) throw new AccountsUnavailableError("unavailable");
    logStaffDiagnostic({ stage: "authz", reason: "permission_refused" });
  }
  if (!isStaff) return notFound();
  return identity;
}

export interface StaffContext {
  staff: VerifiedStaff;
  permissions: ReadonlySet<string>;
  api: StaffApi;
  can: (permission: string) => boolean;
}

/** For pages and actions: returns the acting person or leaves the request. */
export async function requireStaff(nextPath: string): Promise<StaffContext> {
  const state = await getStaffState();
  switch (state.state) {
    case "disabled":
    case "not_staff":
      return notFound();
    case "signed_out":
      return redirect(signInUrl("required", nextPath));
    case "expired":
      return redirect(signInUrl("expired", nextPath));
    case "needs_mfa":
      return redirect("/admin/mfa");
    case "unavailable":
      throw new AccountsUnavailableError("unavailable");
    case "ok":
      return { staff: state.staff, permissions: state.permissions, api: state.api, can: (p) => state.permissions.has(p) };
  }
}

/**
 * What the public header may say about a signed-in person who might be staff: their own display name from the staff table, or that they are not
 * staff, or that this could not be established right now. The answer comes from the same verified identity and the same gateway as everything
 * else here, and the database function returns nothing but the caller's own name (no role, no permission, nobody else). The header never
 * learns more than this, and a failed lookup is reported as `unavailable`, never as "not staff".
 */
export type StaffProfileState =
  | { state: "not_staff" }
  | { state: "staff"; displayName: string | null }
  | { state: "unavailable" };

/** For a session the caller has already verified. Not cached by React (the caller holds the session and asks once). */
export async function getStaffProfileFor(session: Session): Promise<StaffProfileState> {
  // No admin area in this deployment: nobody is staff here, so the header names a customer.
  if (!adminEnabled()) return { state: "not_staff" };
  const identity = await identityFromSession(session);
  if (!identity.ok) return { state: "unavailable" };
  try {
    const profile = await staffApi(identity.staff).myStaffProfile();
    return profile ? { state: "staff", displayName: profile.display_name ?? null } : { state: "not_staff" };
  } catch (error) {
    if (!(error instanceof StaffUnavailableError)) logStaffDiagnostic({ stage: "other", code: "PROFILE_LOOKUP" });
    return { state: "unavailable" };
  }
}
