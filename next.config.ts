import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // LinkedIn profile pictures returned by the OIDC `picture` claim.
      { protocol: "https", hostname: "media.licdn.com" },
      { protocol: "https", hostname: "*.licdn.com" },
    ],
  },
  experimental: {
    // Server actions receive CSV text, which can exceed the 1MB default for a
    // large connections export (~30k rows).
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
