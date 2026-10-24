import type { NextConfig } from "next";

const allowedDevOrigins = [
  "127.0.0.1",
  "0.0.0.0",
  "*.app.github.dev",
  "*.github.dev",
  "github.dev",
  ...(process.env.NEXT_ALLOWED_DEV_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  output: "standalone",
  // Loading every API/page entry after readiness competes with the first
  // visitors on Cloud Run. Load only the entries those visitors actually use.
  experimental: { preloadEntriesOnStart: false },
  // Preserve the original origin for internal locale rewrites, including loopback hosts.
  skipProxyUrlNormalize: true,
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
