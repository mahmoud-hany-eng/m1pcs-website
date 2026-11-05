import type { Metadata } from "next";
import { siteConfig } from "@/lib/site-config";

/**
 * Central SEO helpers: canonical URLs, per-page Metadata, and schema.org
 * JSON-LD builders. Everything is derived from `siteConfig` (single source of
 * truth for the domain, brand, legal name, social profiles and contact
 * details) so nothing is hard-coded twice.
 *
 * Accuracy rules baked in here (see the SEO brief): no Offer / price /
 * availability, no Product markup for quotation-only items, no ratings or
 * reviews, no street address, no opening hours, no partnership claims. Contact
 * details are only emitted when the real value is configured.
 */

export const SITE_NAME = siteConfig.brand.name;

/** Absolute URL for a site-relative path ("/" -> origin, "/x" -> origin/x). */
export function absoluteUrl(path = "/"): string {
  if (path === "/" || path === "") return siteConfig.siteUrl;
  return `${siteConfig.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Social/OG image size (1.91:1, the size every major platform handles). */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export const DEFAULT_OG_PATH = "/og/default";
export const buildOgPath = (slug: string) => `/og/builds/${slug}`;

interface PageMetaInput {
  /** Page title. Brand suffix is added automatically unless `absoluteTitle`. */
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. "/products". */
  path: string;
  /** Use the title exactly as given (no " | M1 Gaming PCs" suffix). */
  absoluteTitle?: boolean;
  /** Site-relative OG image path. Defaults to the brand card. */
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  /** ISO date; only for articles. */
  publishedTime?: string;
  modifiedTime?: string;
}

/**
 * Builds a complete, self-consistent Metadata object for a page.
 *
 * Why every page builds its own `openGraph`: Next shallow-merges metadata, so a
 * page that sets only `title`/`description` inherits the *layout's* openGraph
 * wholesale — og:url and og:title would then point at the home page on every
 * route. Building the full object per page keeps og:url === canonical.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  image = DEFAULT_OG_PATH,
  imageAlt = "M1 Gaming PCs — custom gaming PCs and computer components in Qatar",
  type = "website",
  publishedTime,
  modifiedTime,
}: PageMetaInput): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const url = absoluteUrl(path);
  const images = [{ url: image, ...OG_SIZE, alt: imageAlt }];

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      locale: "en_QA",
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      images,
      ...(type === "article" && publishedTime ? { publishedTime } : {}),
      ...(type === "article" && modifiedTime ? { modifiedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [image],
    },
  };
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

export const ORG_ID = `${siteConfig.siteUrl}/#organization`;
export const WEBSITE_ID = `${siteConfig.siteUrl}/#website`;

/**
 * The business as an OnlineStore (an Organization subtype that is valid with
 * no street address — M1 sells online and delivers; there is no public
 * showroom). Only facts already published on the site are included.
 */
export function organizationJsonLd(): Json {
  const { contact, social, legal, brand } = siteConfig;
  const contactPoint: Json | null =
    contact.email || contact.phoneDisplay
      ? {
          "@type": "ContactPoint",
          contactType: "customer service",
          areaServed: "QA",
          availableLanguage: ["English"],
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.phoneDisplay ? { telephone: contact.phoneDisplay } : {}),
        }
      : null;

  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": ORG_ID,
    name: brand.name,
    legalName: legal.registeredName,
    url: siteConfig.siteUrl,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/logo.png"),
      width: 4500,
      height: 5625,
    },
    image: absoluteUrl(DEFAULT_OG_PATH),
    description:
      "M1 Gaming PCs designs custom gaming PCs and sources computer components for customers in Qatar. Every order starts with a quotation based on current pricing and availability.",
    areaServed: { "@type": "Country", name: "Qatar" },
    sameAs: [social.instagram.url],
    ...(contactPoint ? { contactPoint } : {}),
  };
}

export function websiteJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: siteConfig.siteUrl,
    name: siteConfig.brand.name,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

interface WebPageInput {
  path: string;
  name: string;
  description: string;
  /** schema.org WebPage subtype. */
  type?: "WebPage" | "CollectionPage" | "ContactPage" | "AboutPage";
  /** Site-relative path of the page's main image (must be shown on the page). */
  primaryImage?: string;
  dateModified?: string;
}

export function webPageJsonLd({
  path,
  name,
  description,
  type = "WebPage",
  primaryImage,
  dateModified,
}: WebPageInput): Json {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}${path === "/" ? "/" : ""}#webpage`,
    url,
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    ...(primaryImage ? { primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(primaryImage) } } : {}),
    ...(dateModified ? { dateModified } : {}),
  };
}

export function itemListJsonLd(name: string, items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

/** Custom PC building service. Deliberately has no `offers` / price. */
export function serviceJsonLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${siteConfig.siteUrl}/#service-custom-pc`,
    name: "Custom gaming PC building and component sourcing",
    serviceType: "Custom PC building",
    description:
      "M1 configures a gaming PC around your budget and performance goals, sources the components, builds and sets up the system, and delivers it across Qatar. Pricing and availability are confirmed in a quotation.",
    provider: { "@id": ORG_ID },
    areaServed: { "@type": "Country", name: "Qatar" },
    url: absoluteUrl("/build-my-pc"),
  };
}

interface ArticleInput {
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
}

export function articleJsonLd({ path, headline, description, datePublished, dateModified }: ArticleInput): Json {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline,
    description,
    image: absoluteUrl(DEFAULT_OG_PATH),
    datePublished,
    dateModified,
    inLanguage: "en",
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

interface BuildPageInput {
  path: string;
  name: string;
  description: string;
  imagePath: string;
  imageAlt: string;
  dateModified?: string;
}

/** A completed (sold) build's page: a WebPage with its photo — never a Product/Offer. */
export function buildPageJsonLd({ path, name, description, imagePath, imageAlt, dateModified }: BuildPageInput): Json {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    primaryImageOfPage: { "@id": `${url}#photo` },
    mainEntity: {
      "@type": "ImageObject",
      "@id": `${url}#photo`,
      contentUrl: absoluteUrl(imagePath),
      caption: imageAlt,
    },
    ...(dateModified ? { dateModified } : {}),
  };
}
