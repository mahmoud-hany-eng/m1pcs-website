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
  /** The staff group is drawn after a divider. */
  group: "customer" | "staff";
}

/** The entries that are not redundant on the page being viewed. */
export function linksForPath(links: readonly AccountNavLink[], pathname: string): readonly AccountNavLink[] {
  return links.filter((link) => !link.hiddenOn.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** True when `pathname` is the entry's page or somewhere below it, so the entry can say it is the current page. */
export function isCurrentLink(link: Pick<AccountNavLink, "href">, pathname: string): boolean {
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}
