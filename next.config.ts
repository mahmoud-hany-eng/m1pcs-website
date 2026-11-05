import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
