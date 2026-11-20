import { unlocalizedPath } from '../ui/i18n/urls';

export const MEMBER_COOKIE = 'ya-member';
export function requiresMembership(url: URL): boolean {
  const path = unlocalizedPath(decodeURI(url.pathname)).replace(/\/$/, '') || '/';
  if (path === '/') return ['theme','preview','event','relationship','company','market','q','view','type'].some(key => url.searchParams.getAll(key).some(Boolean));
  if (['/auth','/about','/how-it-works','/robots.txt','/sitemap.xml','/sitemaps/pages/sitemap.xml','/favicon.ico','/api/health','/api/auth/session','/api/public/companies'].includes(path)) return false;
  // These handlers retain their existing service/admin authentication.
  if (/^\/api\/(?:internal|admin|firebase-auth)(?:\/|$)/.test(path) || path === '/api/eod/completed') return false;
  if (/^\/(?:_next\/static|flags|audio)\//.test(path) || /^\/[\w-]+\.(?:svg|txt)$/.test(path)) return false;
  return true;
}
