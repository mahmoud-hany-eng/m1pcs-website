import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppFloatingButton } from "@/components/layout/WhatsAppFloatingButton";
import { siteConfig } from "@/lib/site-config";

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

const title = "M1 Gaming PCs Qatar | Custom Gaming PCs & Computer Components";
const description =
  "Custom gaming PCs and computer components in Qatar. Tell M1 your budget and performance goals and request a current custom quotation.";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: title,
    template: `%s | ${siteConfig.brand.name}`,
  },
  description,
  keywords: [
    "custom gaming PC Qatar",
    "gaming PC Qatar",
    "PC components Qatar",
    "M1 Gaming PCs",
    "build a PC Qatar",
  ],
  authors: [{ name: siteConfig.legal.registeredName }],
  openGraph: {
    type: "website",
    locale: "en_QA",
    url: siteConfig.siteUrl,
    siteName: siteConfig.brand.name,
    title,
    description,
    images: [
      {
        url: "/logo.png",
        width: 4500,
        height: 5625,
        alt: "M1 Gaming PCs logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/logo.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-background text-text-primary antialiased flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <WhatsAppFloatingButton />
      </body>
    </html>
  );
}
