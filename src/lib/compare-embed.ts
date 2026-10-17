import { comparePath, type CompareConfig } from "./compare";
import { localizedPath } from "./i18n/urls";
import type { Locale } from "./locale";

export type CompareEmbedTheme = "dark" | "light";

export function compareEmbedPath(config: CompareConfig, theme: CompareEmbedTheme): string {
  const params = new URLSearchParams(comparePath(config).split("?")[1]);
  params.set("theme", theme);
  return `/compare/embed?${params}`;
}

/** Reserve space for either animation style, including ten rows on narrow screens. */
export function comparisonEmbedHeight(stockCount: number): number {
  return Math.max(420, Math.min(10, stockCount) * 44 + 72) + 480;
}

export function comparisonEmbedCode(config: CompareConfig, theme: CompareEmbedTheme, locale: Locale, origin: string): string {
  const url = new URL(localizedPath(compareEmbedPath(config, theme), locale), origin);
  const src = url.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<iframe src="${src}" title="YouAnalyst stock return comparison" width="100%" height="${comparisonEmbedHeight(config.symbols.length)}" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
}
