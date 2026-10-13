import type { NextConfig } from "next";
import { companyDirectory } from "./src/lib/companies";

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
  async redirects() {
    return [
      ...companyDirectory.map((company) => ({
        source: `/ticker/${company.symbol}`,
        destination: `/company/${company.slug}`,
        permanent: true,
      })),
      { source: "/ticker/:symbol", destination: "/company/ticker-:symbol", permanent: true },
    ];
  },
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
