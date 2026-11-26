/**
 * Who the public header should name, decided on the server for ONE request and never stored or shared.
 *
 * The header is part of every public page, and those pages are built once and cached, so the page itself can never carry a person's name. Instead
 * the browser asks the route src/app/auth/header-identity (uncached, per visitor) after the page has loaded. This module answers that question
 * from the verified session only:
 *
 *   no sign-in cookie at all                 signed out, with no network call and no database query
 *   a cookie the auth service does not accept signed out (expired or revoked)
 *   the auth service cannot be reached       the answer is "unknown", never "signed out": a brief outage must not look like a logout
 *   a verified user who is active staff      the staff table's display name, linking to /admin
 *   a verified user who is not staff         the linked customer profile's name, linking to /account
 *   the staff check could not be completed   a neutral label linking to /auth/continue (which fails safe); NEVER classified as a customer
 *
 * Nothing here takes a name, a role or an address from the request. The answer contains a label, a kind and one of three fixed addresses: no
 * permission, no e-mail address, no customer id, no staff data.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { getStaffProfileFor } from "@/lib/staff/session";
import { headerLabel, type HeaderIdentity } from "@/lib/account-nav";
import { loadCustomerDisplayName } from "@/lib/accounts/server/data";
import { getSession } from "@/lib/accounts/server/session";

const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export type HeaderIdentityAnswer = HeaderIdentity | { state: "unknown" };

export const readHeaderIdentity = cache(async (): Promise<HeaderIdentityAnswer> => {
  const hasCookie = (await cookies()).getAll().some((cookie) => AUTH_COOKIE.test(cookie.name));
  if (!hasCookie) return { state: "signed_out" };

  const session = await getSession();
  if (session.state === "unavailable") return { state: "unknown" };
  if (session.state !== "signed_in") return { state: "signed_out" };

  const staff = await getStaffProfileFor(session);
  if (staff.state === "staff") return { state: "signed_in", kind: "staff", label: headerLabel("staff", staff.displayName), href: "/admin" };
  if (staff.state === "unavailable") return { state: "signed_in", kind: "unknown", label: headerLabel("unknown", null), href: "/auth/continue" };

  try {
    const name = await loadCustomerDisplayName(session.supabase, session.user.id);
    return { state: "signed_in", kind: "customer", label: headerLabel("customer", name), href: "/account" };
  } catch {
    // The profile could not be read: still a signed-in customer (the staff check said so), just without a name for now.
    return { state: "signed_in", kind: "customer", label: headerLabel("customer", null), href: "/account" };
  }
});
