import { headers } from "next/headers";
import type { Metadata } from "next";
import { parseLocale } from "../locale";
import { translateUi } from "./translate";
import { localizedPath } from "./urls";

export async function localizedMetadata(metadata: Metadata): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = parseLocale(requestHeaders.get("x-ya-language")) ?? "en";
  function localize(value: unknown, key = ""): unknown {
    if (typeof value === "string") return ["title", "description", "alt", "default", "absolute"].includes(key) ? translateUi(value, locale) : value;
    if (Array.isArray(value)) return value.map(item => localize(item, key));
    if (value && typeof value === "object" && !(value instanceof URL)) return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, localize(item, field)]));
    return value;
  }
  const result = localize(metadata) as Metadata;
  const path = requestHeaders.get("x-ya-pathname");
  if (path) {
    const canonical = localizedPath(path, locale);
    result.alternates = { canonical, languages: { en: localizedPath(path, "en"), "zh-CN": localizedPath(path, "zh-CN"), "x-default": localizedPath(path, "en") } };
    result.openGraph = { ...result.openGraph, url: canonical, locale: locale === "zh-CN" ? "zh_CN" : "en_US", alternateLocale: locale === "zh-CN" ? "en_US" : "zh_CN", title: result.title ?? undefined, description: result.description ?? undefined };
    result.twitter = { ...result.twitter, card: result.twitter && "card" in result.twitter ? result.twitter.card : "summary", title: result.title ?? undefined, description: result.description ?? undefined };
  }
  return result;
}
