import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseLocale } from "./lib/locale";
import { parseMarket } from "./lib/preferences";
import { isLocalizedPage, localizedPath, pathLocale, unlocalizedPath } from "./lib/ui/i18n/urls";
import { publicCompanyPath } from "./lib/market-companies/slugs";
import { inventoryCompanyPath } from './lib/market-companies/slug-inventory';

const REDIRECT_HOSTS = new Set([
  "www.youanalyst.com",
  "younalyst.com",
  "www.younalyst.com",
  "ifindata.com",
  "www.ifindata.com",
]);
const CANONICAL_HOST = "youanalyst.com";

export function proxy(request: NextRequest) {
  const hostHeader = request.headers.get("host");
  const requestHost = hostHeader?.split(":")[0]?.toLowerCase() ?? "";

  if (!REDIRECT_HOSTS.has(requestHost)) {
    const explicit = parseLocale(request.nextUrl.searchParams.get("lang"));
    const prefix = pathLocale(request.nextUrl.pathname);
    const locale = explicit ?? prefix ?? parseLocale(request.cookies.get("ya-language")?.value) ?? "en";
    const plain = unlocalizedPath(request.nextUrl.pathname);
    const oldTicker = /^\/ticker\/([A-Za-z0-9][A-Za-z0-9.-]{0,15})$/.exec(plain);
    const oldTickerPath=oldTicker ? inventoryCompanyPath(`US:${oldTicker[1].toUpperCase()}`) ?? publicCompanyPath(oldTicker[1]) : null;
    // A-shares retain their exchange-qualified routes; migrate US company pages.
    if (oldTicker && oldTickerPath?.startsWith('/company/') && !/^[036]\d{5}$/.test(oldTicker[1])) {
      const destination = new URL(request.url);
      destination.pathname = localizedPath(oldTickerPath, locale);
      destination.searchParams.delete("lang");
      return NextResponse.redirect(destination, 308);
    }
    if (/^(?:\/institutions(?:\/|$)|\/daily\/(?:insider|insiders|institutional)(?:\/|$)|\/api\/(?:institutions|institutional-holdings|insider-transactions)(?:\/|$)|\/api\/daily-scores\/institutional-share-image$)/.test(plain)) {
      return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" } });
    }
    const localizable = isLocalizedPage(plain);
    const target = new URL(request.url);
    const retiredResearch = (plain === "/" || plain === "/map") && target.searchParams.get("view") === "filings";
    const feedAlias = plain === "/feed";
    const graphAlias = plain === "/map" || plain === "/intelligence";
    if (localizable) {
      target.pathname = localizedPath(retiredResearch || graphAlias || feedAlias ? "/" : plain, locale);
      target.searchParams.delete("lang");
      if (retiredResearch || (feedAlias && target.searchParams.get("view") === "filings")) target.searchParams.set("view", "graph");
      if (feedAlias) {
        const supported = new Set(["theme", "company", "q", "event", "relationship", "market", "view"]);
        for (const key of [...target.searchParams.keys()]) if (!supported.has(key)) target.searchParams.delete(key);
      }
      if ((plain === "/" || graphAlias || feedAlias) && target.searchParams.get("market") === "ALL") target.searchParams.delete("market");
      if (target.pathname !== request.nextUrl.pathname || target.search !== request.nextUrl.search) {
        const response = NextResponse.redirect(target, prefix || explicit ? 308 : 307);
        response.headers.set("Cache-Control", "private, no-store");
        response.cookies.set("ya-language", locale, { path: "/", maxAge: 31536000, sameSite: "lax", secure: target.protocol === "https:" });
        const selectedMarket = parseMarket(request.nextUrl.searchParams.get("market"));
        if (selectedMarket) response.cookies.set("ya-market", selectedMarket, { path: "/", maxAge: 31536000, sameSite: "lax", secure: target.protocol === "https:" });
        return response;
      }
    }
    const headers = new Headers(request.headers);
    headers.set("x-ya-language", locale);
    headers.set("x-ya-pathname", localizable ? plain : "");
    const explicitMarket = parseMarket(request.nextUrl.searchParams.get("market"));
    const market = explicitMarket ?? parseMarket(request.cookies.get("ya-market")?.value) ?? "US";
    headers.set("x-ya-market", market);
    const rewrite = new URL(request.url);
    rewrite.pathname = plain;
    const response = prefix && localizable ? NextResponse.rewrite(rewrite, { request: { headers } }) : NextResponse.next({ request: { headers } });
    if ((explicit || prefix) && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/_next/")) {
      response.cookies.set("ya-language", locale, { path: "/", maxAge: 31536000, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    }
    if (explicitMarket && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/_next/")) response.cookies.set("ya-market", explicitMarket, { path: "/", maxAge: 31536000, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    return response;
  }

  const url = new URL(request.url);
  url.protocol = "https";
  url.hostname = CANONICAL_HOST;
  url.port = "";

  return NextResponse.redirect(url, 308);
}
