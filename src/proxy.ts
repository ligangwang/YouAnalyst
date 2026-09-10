import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseLocale } from "./lib/locale";

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
    const locale = explicit ?? parseLocale(request.cookies.get("ya-language")?.value) ?? "en";
    const headers = new Headers(request.headers);
    headers.set("x-ya-language", locale);
    const response = NextResponse.next({ request: { headers } });
    if (explicit && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/_next/")) {
      response.cookies.set("ya-language", explicit, { path: "/", maxAge: 31536000, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    }
    return response;
  }

  const url = request.nextUrl.clone();
  url.protocol = "https";
  url.hostname = CANONICAL_HOST;
  url.port = "";

  return NextResponse.redirect(url, 308);
}
