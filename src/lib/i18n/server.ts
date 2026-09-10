import { headers } from "next/headers";
import type { Metadata } from "next";
import { parseLocale } from "../locale";
import { translateUi } from "./translate";

export async function localizedMetadata(metadata: Metadata): Promise<Metadata> {
  const locale = parseLocale((await headers()).get("x-ya-language")) ?? "en";
  function localize(value: unknown, key = ""): unknown {
    if (typeof value === "string") return ["title", "description", "alt", "default", "absolute"].includes(key) ? translateUi(value, locale) : value;
    if (Array.isArray(value)) return value.map(item => localize(item, key));
    if (value && typeof value === "object" && !(value instanceof URL)) return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, localize(item, field)]));
    return value;
  }
  return localize(metadata) as Metadata;
}
