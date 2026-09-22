import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // No external product photography yet (Version 1 uses local placeholders).
    // Add remotePatterns here when real hosted images are introduced.
    remotePatterns: [],
  },
};

export default nextConfig;
