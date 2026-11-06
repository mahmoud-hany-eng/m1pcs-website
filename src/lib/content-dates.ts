/**
 * Real "last meaningfully changed" dates (ISO, UTC) used for sitemap
 * `lastModified` and Article `dateModified`.
 *
 * These are deliberately hand-maintained constants, NOT `new Date()`:
 * stamping every URL with the build time tells search engines that nothing and
 * everything changed on every deploy, which makes the signal worthless. Update
 * an entry only when that page's visible content really changes (a typo or
 * styling tweak does not count). A page with no entry gets no <lastmod> at all
 * — omitting it is better than guessing.
 */
export const contentDates = {
  home: "2026-11-05",
  buildMyPc: "2026-11-05",
  products: "2026-11-05",
  completedBuilds: "2026-11-05",
  howItWorks: "2026-11-05",
  /** Contact + policies copy was last edited on this date. */
  contact: "2026-09-30",
  policies: "2026-09-30",
  guides: "2026-11-05",
} as const;

/** Date the completed-builds data (src/lib/builds.ts) last changed. */
export const BUILDS_DATA_UPDATED = "2026-11-05";

/** Date the component-category pages' content last changed. */
export const CATEGORY_PAGES_UPDATED = "2026-11-05";
