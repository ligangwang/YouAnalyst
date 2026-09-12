import type { Locale } from "../locale";

const PREFIX = /^\/(en|zh-cn)(?=\/|$)/;
export function pathLocale(path: string): Locale | null {
  const prefix = path.match(PREFIX)?.[1];
  return prefix ? prefix === "en" ? "en" : "zh-CN" : null;
}
export function unlocalizedPath(path: string): string {
  return path.replace(PREFIX, "") || "/";
}
// Keep authentication, administration, APIs and static assets at their existing URLs.
export function isLocalizedPage(path: string): boolean {
  return path === "/" || /^\/(map|companies|ticker|feed|daily|watchlists|institutions|how-it-works|feedback|analysts|predictions|leaderboard)(\/|$)/.test(path);
}
export function localizedPath(path: string, locale: Locale): string {
  const plain = unlocalizedPath(path);
  return `/${locale === "zh-CN" ? "zh-cn" : "en"}${plain === "/" ? "" : plain}`;
}
export function languageUrl(url: URL, locale: Locale): URL {
  const next = new URL(url);
  if (isLocalizedPage(unlocalizedPath(next.pathname))) {
    next.pathname = localizedPath(next.pathname, locale);
    next.searchParams.delete("lang");
  } else next.searchParams.set("lang", locale);
  return next;
}
