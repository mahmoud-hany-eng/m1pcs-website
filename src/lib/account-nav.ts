/**
 * The shape of the account links the public header can show, and the one rule for which of them to leave out on the page being viewed.
 * Plain data and one pure function: nothing here reads the environment, a cookie or a session, so the public header may import it freely.
 * WHICH links exist at all (and none on a production deployment) is decided elsewhere, from the same switches that guard the routes, and
 * passed to the header as props.
 */
export interface AccountNavLink {
  href: string;
  label: string;
  /** Address prefixes on which this entry is redundant and therefore left out ("/account" covers "/account" and everything below it). */
  hiddenOn: readonly string[];
  /** Marks the entry as the current page only on its own address, not on the pages below it ("My account" is not current on "/account/orders"). */
  exact?: boolean;
}

/** The entries that are not redundant on the page being viewed. */
export function linksForPath(links: readonly AccountNavLink[], pathname: string): readonly AccountNavLink[] {
  return links.filter((link) => !link.hiddenOn.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** True when `pathname` is the entry's page or somewhere below it, so the entry can say it is the current page. */
export function isCurrentLink(link: Pick<AccountNavLink, "href" | "exact">, pathname: string): boolean {
  return pathname === link.href || (!link.exact && pathname.startsWith(`${link.href}/`));
}

// ---------------------------------------------------------------------------------------------------------------
// Who the header names. Plain data shared by the server answer (src/app/auth/header-identity) and the header that reads it.
// ---------------------------------------------------------------------------------------------------------------

/** Where the header asks who is signed in. Same origin only, never cached (see the route). */
export const HEADER_IDENTITY_PATH = "/auth/header-identity";

/**
 * The ONLY addresses a signed-in header may link to, so an answer can never send the visitor anywhere else:
 *   /admin          a staff member's dashboard (the dashboard itself still asks for the second step and the staff table)
 *   /account        a customer's dashboard
 *   /auth/continue  the sign-in router, used when the server could not tell which dashboard the person belongs to (it fails safe)
 */
export const HEADER_DASHBOARD_HREFS = ["/admin", "/account", "/auth/continue"] as const;
export type HeaderDashboardHref = (typeof HEADER_DASHBOARD_HREFS)[number];

export type HeaderIdentity =
  | { state: "signed_out" }
  | { state: "signed_in"; kind: "staff" | "customer" | "unknown"; label: string; href: HeaderDashboardHref };

/** What is shown when a person has no display name yet. Never an invented name and never an e-mail address. */
export const FALLBACK_LABEL = { staff: "Staff account", customer: "My account", unknown: "My account" } as const;
const MAX_LABEL = 60;

/** Control characters, zero-width and direction-changing characters, built from code point ranges so this file holds no invisible character itself. */
const range = (pairs: ReadonlyArray<readonly [number, number]>) => pairs.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join("");
const INVISIBLE = new RegExp(`[${range([[0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]])}]`, "g");
const LINE_BREAKS = new RegExp(`[${[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029].map((c) => String.fromCodePoint(c)).join("")}]`, "g");

/**
 * Makes a stored display name safe to show in one line: control and direction-changing characters removed, white space collapsed, at most 60
 * characters (with an ellipsis). An empty result is `null`, and the caller shows the neutral label instead.
 */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(LINE_BREAKS, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_LABEL ? `${chars.slice(0, MAX_LABEL - 1).join("").trimEnd()}…` : text;
}

/** The label for a signed-in person: their cleaned name, or the neutral label for their kind. */
export function headerLabel(kind: "staff" | "customer" | "unknown", rawName: unknown): string {
  return cleanDisplayName(rawName) ?? FALLBACK_LABEL[kind];
}

/** Reads the header's answer strictly: any shape or address that is not exactly one of the known ones is refused (the header then shows the signed-out state). */
export function parseHeaderIdentity(value: unknown): HeaderIdentity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.state === "signed_out") return { state: "signed_out" };
  if (v.state !== "signed_in") return null;
  if (v.kind !== "staff" && v.kind !== "customer" && v.kind !== "unknown") return null;
  if (typeof v.href !== "string" || !(HEADER_DASHBOARD_HREFS as readonly string[]).includes(v.href)) return null;
  const label = cleanDisplayName(v.label);
  if (!label) return null;
  return { state: "signed_in", kind: v.kind, label, href: v.href as HeaderDashboardHref };
}
