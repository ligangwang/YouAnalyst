import { NextRequest, NextResponse } from 'next/server';
import { routeRequest } from './lib/access/routing';
import { MEMBER_COOKIE, requiresMembership } from './lib/access/policy';
import { pathLocale, unlocalizedPath } from './lib/ui/i18n/urls';
import { verifiedSearchCrawler } from './lib/access/crawlers';
import { verifiedReleaseProbe } from './lib/access/release-probe';

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host && ['www.youanalyst.com','younalyst.com','www.younalyst.com','ifindata.com','www.ifindata.com'].includes(host)) return routeRequest(request);
  if (!requiresMembership(request.nextUrl)) return routeRequest(request);
  const service = verifiedReleaseProbe(request);
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
