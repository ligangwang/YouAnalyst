import type { Metadata } from "next";

const DEFAULT_PRODUCTION_URL = "https://youanalyst.com";
const DEFAULT_DEVELOPMENT_URL = "http://localhost:3000";

function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getSiteUrl(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate?.trim()) {
      continue;
    }

    try {
      return new URL(normalizeSiteUrl(candidate));
    } catch {
      continue;
    }
  }

  return new URL(process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_URL : DEFAULT_DEVELOPMENT_URL);
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, getSiteUrl()).toString();
}

export function isProductionAppEnvironment(): boolean {
  const raw = (
    process.env.APP_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT ??
    process.env.NODE_ENV ??
    ""
  ).trim().toLowerCase();

  return raw === "production";
}

export function noIndexRobots(): NonNullable<Metadata["robots"]> {
  return {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  };
}

export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
