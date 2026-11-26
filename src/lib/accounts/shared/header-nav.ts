/**
 * Which account links the public website's header may offer, decided from the SAME switch that guards the routes themselves.
 *
 * The header shows a link only if the page it leads to exists in this deployment. The customer routes (/account, /auth/...) exist only when
 * the customer-account switch is on. On a production deployment that gate is closed whatever the variables say, so this returns nothing there,
 * the header draws no account button at all, and no visitor is ever offered a link that would answer 404. When customer accounts are approved for
 * production, the guard in flag.ts is the only thing that changes; this file and the header need not.
 *
 * This module is deliberately plain: it reads nothing but the environment it is handed (the root layout passes it), imports only the gate
 * function, and returns plain data. It is the one piece of the account code the public layout is allowed to import (a static test enforces
 * exactly that), and the header itself imports none of it: it receives the links as props.
 *
 * Whether the visitor is signed in cannot be known here, and cannot be known by the public pages at all without making every one of them
 * dynamic (the sign-in cookies are HttpOnly, by design). So the menu offers the whole set and hides only the entry that is plainly redundant on
 * the page being viewed (`hiddenOn`, applied by `linksForPath` in src/lib/account-nav.ts): "Log in" inside /account and /admin, where the person
 * is already signed in. "My account" and "Track my order" send a visitor who is not signed in to the sign-in page and back.
 */
import type { AccountNavLink } from "@/lib/account-nav";
import { customerAccountsGate, type EnvSource } from "./flag";

/**
 * The three entries, in this order and with these names, and nothing else: Log in, My account, Track my order. The staff dashboard is not offered
 * to the public (staff reach it from the sign-in they already use), and "Create Account" is on the sign-in page itself.
 *
 *   Log in          /auth/sign-in    left out inside /account and /admin (a person there is already signed in)
 *   My account      /account         a visitor who is not signed in is sent to sign in and back
 *   Track my order  /account/orders  the customer's orders and their live tracking; the same sign-in step applies
 */
export function headerAccountLinks(env: EnvSource): readonly AccountNavLink[] {
  if (!customerAccountsGate(env).enabled) return [];
  return [
    { href: "/auth/sign-in", label: "Log in", hiddenOn: ["/account", "/admin"] },
    { href: "/account", label: "My account", hiddenOn: [], exact: true },
    { href: "/account/orders", label: "Track my order", hiddenOn: [] },
  ];
}
