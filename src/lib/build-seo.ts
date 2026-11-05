import type { CompletedBuild } from "@/types";

/** "Ryzen 7 9850X3D / RTX 5080 Build" -> "Ryzen 7 9850X3D & RTX 5080". */
export function buildShortName(build: CompletedBuild): string {
  return build.name.replace(/ Build$/, "").replace(" / ", " & ");
}

/**
 * Page title for a completed build, e.g.
 * "Ryzen 7 9850X3D & RTX 5080 Custom Gaming PC | M1 Qatar". The brand suffix is
 * dropped when it would push the title past ~64 characters.
 */
export function buildPageTitle(build: CompletedBuild): string {
  const core = `${buildShortName(build)} Custom Gaming PC`;
  const full = `${core} | M1 Qatar`;
  return full.length <= 64 ? full : core;
}

export function buildPageDescription(build: CompletedBuild): string {
  return `Completed custom gaming PC by M1 in Qatar: ${build.cpu} and ${build.gpu} on a ${build.motherboard} board. See the full parts list and request a similar build.`;
}

/** The (up to) `count` builds closest to `slug` in the newest-first list. */
export function nearbyBuilds(all: CompletedBuild[], slug: string, count = 3): CompletedBuild[] {
  const index = all.findIndex((b) => b.slug === slug);
  return all
    .map((b, i) => ({ b, d: Math.abs(i - index) }))
    .filter(({ b }) => b.slug !== slug)
    .sort((x, y) => x.d - y.d || (all.indexOf(x.b) - all.indexOf(y.b)))
    .slice(0, count)
    .map(({ b }) => b);
}
