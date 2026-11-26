/**
 * Where a person goes once they are signed in, decided in ONE place for every way of signing in (password, e-mail link, e-mail confirmation,
 * password recovery, a visit to the sign-in page while already signed in, coming back from the second step).
 *
 * The inputs are facts the SERVER verified (what the staff check said about the verified session) and an optional `next` address that passed the
 * same-site rules in redirect.ts. Nothing a browser claims about a role, a name, a phone number or an e-mail domain is an input.
 *
 *   staff, second step done      /admin (or the admin or account page they were heading to)
 *   staff, second step missing   /admin/mfa (and back to the page they were heading to afterwards)
 *   not staff (or no admin area) /account (or the account page they were heading to); a new customer with no profile sees the usual set-up there
 *   the staff check failed       NOTHING: the person is told it could not be completed. A failed lookup is never read as "customer"
 *
 * A customer is never sent to an admin address (it would only answer 404), and a staff member is never sent to the customer set-up screen merely
 * because they have no customer profile.
 */
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "./redirect";

/** What the staff check can say (see getStaffState in src/lib/staff/session.ts). */
export type StaffCheck = "ok" | "needs_mfa" | "not_staff" | "disabled" | "unavailable" | "signed_out" | "expired";

export type PostAuthRoute =
  | { kind: "go"; to: string }
  | { kind: "sign_in"; reason: "required" | "expired" }
  | { kind: "unavailable" };

/** The address to follow after signing in, or "" when there is none. "/account" alone is the usual landing place, not a request. */
export function explicitNext(raw: unknown): string {
  const next = safeNextPath(raw, "");
  return next === DEFAULT_AFTER_SIGN_IN ? "" : next;
}

export function routeAfterSignIn(check: StaffCheck, rawNext: unknown): PostAuthRoute {
  const next = explicitNext(rawNext);
  switch (check) {
    case "signed_out":
      return { kind: "sign_in", reason: "required" };
    case "expired":
      return { kind: "sign_in", reason: "expired" };
    case "unavailable":
      return { kind: "unavailable" };
    case "ok":
      return { kind: "go", to: next || "/admin" };
    case "needs_mfa":
      return { kind: "go", to: next.startsWith("/admin") ? `/admin/mfa?next=${encodeURIComponent(next)}` : "/admin/mfa" };
    case "not_staff":
    case "disabled":
      return { kind: "go", to: next.startsWith("/account") ? next : DEFAULT_AFTER_SIGN_IN };
  }
}

/** The address of the router itself, with the page the person was heading to (only when there is one). */
export function continueUrl(rawNext?: unknown): string {
  const next = explicitNext(rawNext);
  return next ? `/auth/continue?next=${encodeURIComponent(next)}` : "/auth/continue";
}
