import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppFloatingButton } from "@/components/layout/WhatsAppFloatingButton";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteConfig } from "@/lib/site-config";
import { OG_SIZE, DEFAULT_OG_PATH, organizationJsonLd, websiteJsonLd } from "@/lib/seo";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const title = "Custom Gaming PCs & Components in Qatar | M1 Gaming PCs";
const description =
  "M1 Gaming PCs builds custom gaming PCs and sources computer components in Qatar. Tell us your budget and performance goals and request a current quotation.";

/**
 * Site-wide defaults. Every page overrides title/description/canonical/openGraph
 * through `pageMetadata()` (src/lib/seo.ts) so nothing here leaks a home-page
 * og:url or og:title onto other routes.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: title,
    template: `%s | ${siteConfig.brand.name}`,
  },
  description,
  applicationName: siteConfig.brand.name,
  authors: [{ name: siteConfig.legal.registeredName }],
  openGraph: {
    type: "website",
    locale: "en_QA",
    url: siteConfig.siteUrl,
    siteName: siteConfig.brand.name,
    title,
    description,
    images: [{ url: DEFAULT_OG_PATH, ...OG_SIZE, alt: "M1 Gaming PCs — custom gaming PCs in Qatar" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [DEFAULT_OG_PATH],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon-48.png",
    apple: "/apple-icon.png",
  },
  // Optional Search Console HTML-tag verification: only emitted when the
  // environment variable is set (never a made-up token). Domain-property DNS
  // verification needs no code at all and is the recommended route.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-background text-text-primary antialiased flex flex-col">
        {/* The dark glass showroom every page sits in (see .site-ambient). */}
        <div className="site-ambient" aria-hidden="true" />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <WhatsAppFloatingButton />
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      </body>
    </html>
  );
}
