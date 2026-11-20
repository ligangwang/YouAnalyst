import { BlockList, isIP } from 'node:net';
import { unlocalizedPath } from '../ui/i18n/urls';

const SOURCES = {
  google: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
  bing: 'https://www.bing.com/toolbox/bingbot.json',
};
type Engine = keyof typeof SOURCES;
// Production global external Application Load Balancer forwarding rules.
// Accept only its appended <client-ip>,<load-balancer-ip> suffix, never the
// caller-controlled leftmost XFF value. Direct run.app URLs cannot qualify.
const FRONTENDS = new Set(['136.68.216.55', '2600:1901:0:d134::']);
export function crawlerClientIp(headers: Headers): string | null {
  if (headers.get('host')?.toLowerCase() !== 'youanalyst.com') return null;
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map(value => value.trim());
  if (chain.length < 2 || !FRONTENDS.has(chain.at(-1)!)) return null;
  const ip = chain.at(-2)!;
  return isIP(ip) ? ip : null;
}
export function crawlerResearchPath(url: URL): boolean {
  const path = unlocalizedPath(url.pathname);
  return path === '/' || /^\/(?:company|ticker|research|industries|investment-themes|companies|intelligence|map|feed)(?:\/|$)/.test(path)
    || path === '/compare' || path === '/compare/embed' || path.startsWith('/sitemaps/')
    || /^\/api\/(?:intelligence(?:\/enrichment)?|company-(?:fundamentals|updates|timeline|relationships|peer-prices|peer-comparison)|knowledge-graph|industry-graph|investment-themes|market-companies|tickers\/search|compare(?:\/share-image)?)$/.test(path)
    || /^\/api\/company-graph\/[A-Z0-9.-]+$/.test(path);
}
export function crawlerEngine(agent: string): Engine | null {
  return /\bGooglebot(?:-Image|-Video)?\//i.test(agent) ? 'google' : /\bbingbot\//i.test(agent) ? 'bing' : null;
}
export function crawlerRanges(prefixes: Array<{ipv4Prefix?:string;ipv6Prefix?:string}>) {
  const ranges = new BlockList();
  if (!prefixes.length || prefixes.length > 10000) throw Error('Invalid crawler ranges');
  for (const entry of prefixes) {
    const [ip,bits] = (entry.ipv4Prefix ?? entry.ipv6Prefix ?? '').split('/');
    const family = isIP(ip);
    if (!family || !/^\d+$/.test(bits)) throw Error('Invalid crawler range');
    ranges.addSubnet(ip, Number(bits), family === 4 ? 'ipv4' : 'ipv6');
  }
  return ranges;
}
const cache = new Map<Engine,{expires:number; value:Promise<BlockList | null>}>();
async function rangesFor(engine: Engine): Promise<BlockList | null> {
  const previous = cache.get(engine);
  if (previous && previous.expires > Date.now()) return previous.value;
  const value = (async () => {
    try {
      const response = await fetch(SOURCES[engine], {signal:AbortSignal.timeout(2500),redirect:'error'});
      if (!response.ok) throw Error('Crawler ranges unavailable');
      return crawlerRanges((await response.json()).prefixes);
    } catch { return null; }
  })();
  const entry = {expires:Date.now()+3600000,value};
  cache.set(engine,entry);
  if (!await value) entry.expires=Date.now()+60000;
  return value;
}
export async function verifiedSearchCrawler(request: {method:string;headers:Headers;nextUrl:URL}): Promise<boolean> {
  if (!['GET','HEAD'].includes(request.method) || !crawlerResearchPath(request.nextUrl)) return false;
  const engine = crawlerEngine(request.headers.get('user-agent') ?? '');
  const ip = crawlerClientIp(request.headers);
  if (!engine || !ip) return false;
  const ranges = await rangesFor(engine);
  return ranges?.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6') ?? false;
}
