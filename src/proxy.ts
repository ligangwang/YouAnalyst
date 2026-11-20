import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { routeRequest } from './lib/access/routing';
import { MEMBER_COOKIE, requiresMembership } from './lib/access/policy';
import { pathLocale, unlocalizedPath } from './lib/ui/i18n/urls';
import { verifiedSearchCrawler } from './lib/access/crawlers';

export async function proxy(request: NextRequest) {
  if (!requiresMembership(request.nextUrl)) return routeRequest(request);
  const supplied = request.headers.get('x-ya-internal-token') ?? '';
  const expected = process.env.INTERNAL_API_TOKEN ?? '';
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  const service = !!expected && a.length === b.length && timingSafeEqual(a, b);
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const cookie = request.cookies.get(MEMBER_COOKIE)?.value;
  const member = service || !!(cookie && await (await import('./lib/access/member')).verifyMember(cookie)) || !!(bearer && await (await import('./lib/access/member')).verifyMember(bearer));
  const crawler = !member && await verifiedSearchCrawler(request);
  if (!member && !crawler) {
    const headers = {'Cache-Control':'private, no-store', 'X-Robots-Tag':'noindex'};
    if (unlocalizedPath(request.nextUrl.pathname).startsWith('/api/')) return NextResponse.json({error:'Sign in to access member content.'}, {status:401, headers});
    const destination = new URL('/auth', request.url);
    destination.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    destination.searchParams.set('lang', pathLocale(request.nextUrl.pathname) ?? 'en');
    return NextResponse.redirect(destination, {status:307, headers});
  }
  const response = routeRequest(request);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
