import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // A PDF receipt (up to 4 MB) is uploaded through a server action. The default limit is 1 MB; 4.5 MB is the most the hosting platform accepts
    // in one request anyway, so this raises nothing beyond what the platform already allows.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  images: {
    // No external product photography yet (Version 1 uses local placeholders).
    // Add remotePatterns here when real hosted images are introduced.
    remotePatterns: [],
  },
  /**
   * Keep Vercel *Preview* deployments out of search results. Production is
   * untouched: the header is only emitted when VERCEL_ENV is exactly
   * "preview" (never when it is unset, e.g. local builds or Production).
   * Pairs with the Disallow-all robots.txt that app/robots.ts serves on
   * previews; Vercel also adds its own noindex header to previews.
   */
  async headers() {
    if (process.env.VERCEL_ENV !== "preview") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
