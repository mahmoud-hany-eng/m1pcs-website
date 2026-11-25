/**
 * Which account links the public website's header may offer, decided from the SAME two switches that guard the routes themselves.
 *
 * The header shows a link only if the page it leads to exists in this deployment. The customer routes (/account, /auth/...) exist only when
 * the customer-account switch is on, and the staff dashboard (/admin) only when the staff switch is ALSO on (the admin layout needs both). On a
 * production deployment both gates are closed whatever the variables say, so this returns nothing there, the header draws no account button at
 * all, and no visitor is ever offered a link that would answer 404. When customer accounts are approved for production, the guard in flag.ts is
 * the only thing that changes; this file and the header need not.
 *
 * This module is deliberately plain: it reads nothing but the environment it is handed (the root layout passes it), imports only the two
 * gate functions, and returns plain data. It is the one piece of the account code the public layout is allowed to import (a static test
 * enforces exactly that), and the header itself imports none of it: it receives the links as props.
 *
 * Whether the visitor is signed in cannot be known here, and cannot be known by the public pages at all without making every one of them
 * dynamic (the sign-in cookies are HttpOnly, by design). So the menu offers the whole set and hides only the entries that are plainly
 * redundant on the page being viewed (`hiddenOn`, applied by `linksForPath` in src/lib/account-nav.ts): the sign-in links inside /account and /admin (a person there is already signed in), the
 * sign-in link on the sign-in page itself, and so on. "My Account" sends a visitor who is not signed in to the sign-in page and back.
 */
import type { AccountNavLink } from "@/lib/account-nav";
import { staffAdminGate } from "@/lib/staff/flag";
import { customerAccountsGate, type EnvSource } from "./flag";

export function headerAccountLinks(env: EnvSource): readonly AccountNavLink[] {
  if (!customerAccountsGate(env).enabled) return [];
  const links: AccountNavLink[] = [
    { href: "/account", label: "My Account", hiddenOn: [], group: "customer" },
    { href: "/auth/sign-in", label: "Customer Sign In", hiddenOn: ["/account", "/admin", "/auth/sign-in"], group: "customer" },
    { href: "/auth/sign-up", label: "Create Account", hiddenOn: ["/account", "/admin", "/auth/sign-up"], group: "customer" },
  ];
  // The staff dashboard needs the staff switch AND the account switch (its layout answers 404 unless both are on).
  if (staffAdminGate(env).enabled) links.push({ href: "/admin", label: "Staff Dashboard", hiddenOn: ["/admin"], group: "staff" });
  return links;
}
