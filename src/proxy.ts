import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseLocale } from "./lib/locale";
import { parseMarket } from "./lib/preferences";
import { isLocalizedPage, localizedPath, pathLocale, unlocalizedPath } from "./lib/i18n/urls";

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
    const localizable = isLocalizedPage(plain);
    const target = request.nextUrl.clone();
    const graphAlias = plain === "/map" && target.searchParams.get("view") !== "filings";
    if (localizable) {
      target.pathname = localizedPath(graphAlias ? "/" : plain, locale);
      target.searchParams.delete("lang");
      if ((plain === "/" || graphAlias) && target.searchParams.get("market") === "ALL") target.searchParams.delete("market");
      if (target.pathname !== request.nextUrl.pathname || target.search !== request.nextUrl.search) {
        const response = NextResponse.redirect(target, prefix || explicit ? 308 : 307);
        response.headers.set("Cache-Control", "private, no-store");
        response.cookies.set("ya-language", locale, { path: "/", maxAge: 31536000, sameSite: "lax", secure: target.protocol === "https:" });
        return response;
      }
    }
    const headers = new Headers(request.headers);
    headers.set("x-ya-language", locale);
    headers.set("x-ya-pathname", localizable ? plain : "");
    const explicitMarket = parseMarket(request.nextUrl.searchParams.get("market"));
    const market = explicitMarket ?? parseMarket(request.cookies.get("ya-market")?.value) ?? "US";
    headers.set("x-ya-market", market);
    const rewrite = request.nextUrl.clone();
    rewrite.pathname = plain;
    const response = prefix && localizable ? NextResponse.rewrite(rewrite, { request: { headers } }) : NextResponse.next({ request: { headers } });
    if ((explicit || prefix) && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/_next/")) {
      response.cookies.set("ya-language", locale, { path: "/", maxAge: 31536000, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    }
    if (explicitMarket && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/_next/")) response.cookies.set("ya-market", explicitMarket, { path: "/", maxAge: 31536000, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    return response;
  }

  const url = request.nextUrl.clone();
  url.protocol = "https";
  url.hostname = CANONICAL_HOST;
  url.port = "";

  return NextResponse.redirect(url, 308);
}
