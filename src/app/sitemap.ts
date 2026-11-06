import type { MetadataRoute } from "next";
import { completedBuilds } from "@/lib/builds";
import { categoryPages } from "@/lib/category-pages";
import { BUILDS_DATA_UPDATED, CATEGORY_PAGES_UPDATED, contentDates } from "@/lib/content-dates";
import { guides } from "@/lib/guides";
import { absoluteUrl } from "@/lib/seo";

/**
 * Every public, indexable page — and nothing else (no previews, no /og image
 * routes, no 404). `lastModified` comes from real, hand-maintained content
 * dates (src/lib/content-dates.ts), never from `new Date()`. Google ignores
 * `changeFrequency` and `priority`, so they are omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entry = (path: string, lastModified: string): MetadataRoute.Sitemap[number] => ({
    url: absoluteUrl(path),
    lastModified: new Date(`${lastModified}T00:00:00Z`),
  });

  return [
    entry("/", contentDates.home),
    entry("/build-my-pc", contentDates.buildMyPc),
    entry("/products", contentDates.products),
    ...categoryPages.map((c) => entry(`/products/${c.slug}`, CATEGORY_PAGES_UPDATED)),
    entry("/completed-builds", contentDates.completedBuilds),
    ...completedBuilds.map((b) => entry(`/completed-builds/${b.slug}`, BUILDS_DATA_UPDATED)),
    entry("/how-it-works", contentDates.howItWorks),
    entry("/guides", contentDates.guides),
    ...guides.map((g) => entry(`/guides/${g.slug}`, g.modified)),
    entry("/contact", contentDates.contact),
    entry("/policies", contentDates.policies),
  ];
}
