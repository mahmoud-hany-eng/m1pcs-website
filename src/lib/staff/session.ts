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
import { getSession } from "@/lib/accounts/server/session";
import { customerAccountsGate } from "@/lib/accounts/shared/flag";
import { signInUrl } from "@/lib/accounts/shared/redirect";
import { staffAdminGate } from "./flag";
import { isGatewayConfigured, StaffUnavailableError, type VerifiedStaff } from "./gateway";
import { staffApi, type StaffApi } from "./api";

export type StaffState =
  | { state: "disabled" }
  | { state: "signed_out" }
  | { state: "expired" }
  | { state: "unavailable" }
  | { state: "needs_mfa"; userId: string }
  | { state: "not_staff" }
  | { state: "ok"; staff: VerifiedStaff; permissions: ReadonlySet<string>; api: StaffApi };

export const getStaffState = cache(async (): Promise<StaffState> => {
  // Staff sign in on the customer sign-in pages, so both switches must be on.
  if (!staffAdminGate(process.env).enabled || !customerAccountsGate(process.env).enabled) return { state: "disabled" };
  const session = await getSession();
  if (session.state === "signed_out") return { state: "signed_out" };
  if (session.state === "expired") return { state: "expired" };
  if (session.state !== "signed_in") return { state: "unavailable" };

  // The claims of the verified token: the assurance level and the session id. getClaims verifies the signature.
  const { data, error } = await session.supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; aal?: string; session_id?: string } | undefined;
  if (error || !claims || claims.sub !== session.user.id) return { state: "expired" };
  if (claims.aal !== "aal2" || !claims.session_id) return { state: "needs_mfa", userId: session.user.id };

  if (!isGatewayConfigured()) return { state: "unavailable" };
  const staff: VerifiedStaff = { userId: session.user.id, sessionId: claims.session_id, email: session.user.email };
  const api = staffApi(staff);
  try {
    const permissions = new Set(await api.permissions());
    if (permissions.size === 0) return { state: "not_staff" };
    return { state: "ok", staff, permissions, api };
  } catch (error) {
    if (error instanceof StaffUnavailableError) return { state: "unavailable" };
    // A permission refusal here means the database did not accept this session as an active, second-factor staff
    // session. It is the same answer as "not staff".
    return { state: "not_staff" };
  }
});

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
