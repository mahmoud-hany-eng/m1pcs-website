import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

/**
 * Production: everything public is crawlable (CSS/JS/images included — they
 * must stay fetchable so Google can render the page) and the sitemap is
 * advertised. Vercel Preview deployments get a blanket Disallow and no
 * sitemap so test builds can never compete with the live site.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV === "preview") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteConfig.siteUrl}/sitemap.xml`,
  };
}
