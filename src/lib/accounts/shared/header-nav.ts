/**
 * Whether the public website's header offers an account control at all, decided from the SAME switch that guards the routes themselves, and which
 * entries the SIGNED-OUT menu holds.
 *
 * The header shows the control only if the pages it leads to exist in this deployment. The customer routes (/auth/...) exist only when the
 * customer-account switch is on. On a production deployment that gate is closed, so this returns nothing there, the header draws no account button,
 * asks no question and no visitor is ever offered a link that would answer 404. When customer accounts are approved for production, the guard in
 * flag.ts is the only thing that changes; this file and the header need not.
 *
 * This module is deliberately plain: it reads nothing but the environment it is handed (the root layout passes it), imports only the gate
 * function, and returns plain data. It is the one piece of the account code the public layout is allowed to import (a static test enforces
 * exactly that), and the header itself imports none of it: it receives the links as props.
 *
 * Whether the visitor is signed in cannot be known here, and cannot be known by the public pages at all without making every one of them
 * dynamic (the sign-in cookies are HttpOnly, by design). So the public pages stay static and cached, and the header asks the uncached route
 * /auth/header-identity after the page loads. Signed out, it shows the two entries below; signed in, it shows the person's name and icon as one link
 * straight to their dashboard (so there is no menu to offer).
 */
import type { AccountNavLink } from "@/lib/account-nav";
import { customerAccountsGate, type EnvSource } from "./flag";

/**
 * EXACTLY these two, in this order and with these names, and nothing else: Log in, Create account. There is no staff or admin entry for the public
 * (staff use the same sign-in and are sent on to their dashboard), and no "My account" or "Track my order" (a signed-in person's name is the link to
 * their dashboard).
 *
 *   Log in          /auth/sign-in   the ONE sign-in page for customers and staff
 *   Create account  /auth/sign-up   a new customer account
 */
export function headerAccountLinks(env: EnvSource): readonly AccountNavLink[] {
  if (!customerAccountsGate(env).enabled) return [];
  return [
    { href: "/auth/sign-in", label: "Log in", hiddenOn: [] },
    { href: "/auth/sign-up", label: "Create account", hiddenOn: [] },
  ];
}
