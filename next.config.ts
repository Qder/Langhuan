import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Box browser / computerUse hit 127.0.0.1 while Next advertises localhost — allow both for HMR/_next.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/manifest.webmanifest",
      headers: [{ key: "Content-Type", value: "application/manifest+json" }],
    },
  ],
};

export default nextConfig;
