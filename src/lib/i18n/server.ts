import { headers } from "next/headers";
import type { Metadata } from "next";
import { parseLocale } from "../locale";
import { translateUi } from "./translate";
import { localizedPath } from "./urls";
import type { Locale } from "../locale";

type LocalizationOptions = { usePageCanonical?: boolean };

// Most pages use their request path. Alias routes can explicitly preserve the
// canonical chosen by their page without changing layout-level defaults.
export function localizeMetadata(metadata: Metadata, locale: Locale, path: string | null, options: LocalizationOptions = {}): Metadata {
  function localize(value: unknown, key = ""): unknown {
    if (typeof value === "string") return ["title", "description", "alt", "default", "absolute"].includes(key) ? translateUi(value, locale) : value;
    if (Array.isArray(value)) return value.map(item => localize(item, key));
    if (value && typeof value === "object" && !(value instanceof URL)) return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, localize(item, field)]));
    return value;
  }
  const result = localize(metadata) as Metadata;
  if (path) {
    const pageCanonical = metadata.alternates?.canonical;
    const canonicalPath = options.usePageCanonical && typeof pageCanonical === "string" && pageCanonical.startsWith("/") && !pageCanonical.startsWith("//") ? pageCanonical : path;
    const canonical = localizedPath(canonicalPath, locale);
    result.alternates = { ...result.alternates, canonical, languages: { en: localizedPath(canonicalPath, "en"), "zh-CN": localizedPath(canonicalPath, "zh-CN"), "x-default": localizedPath(canonicalPath, "en") } };
    result.openGraph = { ...result.openGraph, url: canonical, locale: locale === "zh-CN" ? "zh_CN" : "en_US", alternateLocale: locale === "zh-CN" ? "en_US" : "zh_CN", title: result.title ?? undefined, description: result.description ?? undefined };
    result.twitter = { ...result.twitter, card: result.twitter && "card" in result.twitter ? result.twitter.card : "summary", title: result.title ?? undefined, description: result.description ?? undefined };
  }
  return result;
}

export async function localizedMetadata(metadata: Metadata, options: LocalizationOptions = {}): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = parseLocale(requestHeaders.get("x-ya-language")) ?? "en";
  return localizeMetadata(metadata, locale, requestHeaders.get("x-ya-pathname"), options);
}
