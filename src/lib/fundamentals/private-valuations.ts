// Reviewed financing disclosures. These are private post-money valuations,
// never exchange market caps. New discoveries require review before publication.
export type PrivateValuation = {
  value: number; currency: "USD" | "EUR"; qualifier: "exact" | "greater_than";
  valuationDate: string; basis: "post_money"; sourceUrl: string; reviewedAt: string;
};
type Source = { name: string; newsUrl: string; valuation: PrivateValuation; evidence: string; earlierRounds?: string[] };
export const privateValuationSources: Record<string, Source> = {
  "ORG:ANTHROPIC": {
    name: "Anthropic", newsUrl: "https://www.anthropic.com/news",
    valuation: { value: 965e9, currency: "USD", qualifier: "exact", valuationDate: "2026-05-28", basis: "post_money", sourceUrl: "https://www.anthropic.com/news/series-h", reviewedAt: "2026-09-25" },
    evidence: "valuing the company at $965 billion post-money.",
  },
  "ORG:OPENAI": {
    name: "OpenAI", newsUrl: "https://openai.com/news/rss.xml",
    valuation: { value: 852e9, currency: "USD", qualifier: "exact", valuationDate: "2026-03-31", basis: "post_money", sourceUrl: "https://openai.com/index/accelerating-the-next-phase-ai/", reviewedAt: "2026-09-25" },
    evidence: "closed our latest funding round with $122 billion in committed capital at a post money valuation of $852 billion.",
  },
  "ORG:MISTRAL-AI": {
    name: "Mistral AI", newsUrl: "https://mistral.ai/news",
    earlierRounds: ["https://mistral.ai/news/mistral-ai-raises-1-7-b-to-accelerate-technological-progress-with-ai/"],
    valuation: { value: 21e9, currency: "EUR", qualifier: "greater_than", valuationDate: "2026-09-08", basis: "post_money", sourceUrl: "https://mistral.ai/news/mistral-makes-sovereign-open-weight-ai-to-frontier/", reviewedAt: "2026-09-25" },
    evidence: "has raised €3 billion in a Series D funding round at a post-money valuation of more than €21 billion",
  },
};

export function privateValuationFresh(value: PrivateValuation, now = Date.now()) {
  const date = Date.parse(value.valuationDate + "T00:00:00Z");
  return Number.isFinite(date) && date <= now && now - date <= 365 * 86_400_000;
}

export function plainSource(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&euro;/g, "€")
    .replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

// URLs come only from our reviewed configuration or same-origin news links.
// No credentials, cross-origin redirects, arbitrary company URLs, or model-generated URLs.
export async function fetchPrivateSource(url: string, origin: string, redirects = 0): Promise<string> {
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.protocol !== "https:" || parsed.username || parsed.password) throw Error("Untrusted source URL");
  const response = await fetch(parsed, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "YouAnalyst valuation source checker", Accept: "text/html,application/xhtml+xml,application/rss+xml" } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects >= 3) throw Error("Source redirect limit exceeded");
    return fetchPrivateSource(new URL(location, parsed).href, origin, redirects + 1);
  }
  if (!response.ok) throw Error(`Official source returned HTTP ${response.status}`);
  if (!/text\/html|application\/(?:xhtml\+xml|rss\+xml|xml)|text\/xml/i.test(response.headers.get("content-type") ?? "")) throw Error("Expected an official HTML announcement or RSS feed");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty source response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 4_000_000) throw Error("Source response exceeds size limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}

export function discoverFundingLinks(html: string, newsUrl: string, knownUrl: string, after = "") {
  const links = new Set<string>(); const origin = new URL(newsUrl).origin;
  // RSS gives reliable publication dates; ignore disclosures predating the
  // reviewed round. For HTML cards, retain uncertain dates for human review.
  if (/<rss\b/i.test(html)) {
    html = [...html.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
      const date = Date.parse(item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? "");
      if (Number.isFinite(date) && date <= Date.parse(after + "T23:59:59Z")) return [];
      const url = item.match(/<link>(.*?)<\/link>/i)?.[1];
      const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "");
      const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? "";
      return url && title ? [`<a href="${url}">${title} ${plainSource(description)}</a>`] : [];
    }).join(" ");
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), newsUrl);
      url.hash = ""; url.search = "";
      if (url.origin !== origin || !/^\/(news|index)\/.+/.test(url.pathname) || url.username || url.password) continue;
      if (url.href.replace(/\/$/, "") === knownUrl.replace(/\/$/, "")) continue;
      if (/\bfunding[-\s]+round\b|\bfundrais|\bvaluation\b|\bseries[-\s][a-z]\b|\braises?\b|\bfinancing\b|\brecapitaliz/i.test(plainSource(match[2]) + " " + url.pathname)) links.add(url.href);
    } catch { /* Invalid links are not source evidence. */ }
  }
  return [...links].sort().slice(0, 30);
}

export type PrivateCheck = { status: "verified" | "review_required" | "stale" | "unsupported"; checkedAt: string; valuation?: PrivateValuation; verification?: "source_checked" | "reviewed"; candidates: string[]; reason?: string };
export async function checkPrivateValuation(id: string, now = Date.now(), get = fetchPrivateSource): Promise<PrivateCheck> {
  const source = privateValuationSources[id]; const checkedAt = new Date(now).toISOString();
  if (!source) return { status: "unsupported", checkedAt, candidates: [], reason: "No reviewed official source configured for this company" };
  const origin = new URL(source.newsUrl).origin;
  const news = await get(source.newsUrl, origin);
  if (!/<a\b[^>]*href=["'][^"']*(?:\/news\/|\/index\/)/i.test(news) && !/<rss\b[\s\S]*<item>/i.test(news)) throw Error("Official news index has no readable announcement links");
  const candidates = discoverFundingLinks(news, source.newsUrl, source.valuation.sourceUrl, source.valuation.valuationDate)
    .filter(url => !source.earlierRounds?.some(older => older.replace(/\/$/, "") === url.replace(/\/$/, "")));
  let article: string;
  try { article = await get(source.valuation.sourceUrl, origin); }
  catch (error) {
    if (!source.newsUrl.endsWith("/rss.xml")) throw error;
    // The amount was independently reviewed from the official announcement on
    // reviewedAt. RSS only corroborates the identity/date of that announcement;
    // it does not verify its valuation amount or renew the financing date.
    const reviewedEntry = [...news.matchAll(/<item>([\s\S]*?)<\/item>/gi)].some(([, item]) => {
      const link = item.match(/<link>(.*?)<\/link>/i)?.[1]?.trim().replace(/\/$/, "");
      const date = Date.parse(item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? "");
      return link === source.valuation.sourceUrl.replace(/\/$/, "") && Number.isFinite(date)
        && new Date(date).toISOString().slice(0, 10) === source.valuation.valuationDate;
    });
    return { status: privateValuationFresh(source.valuation, now) ? "review_required" : "stale", checkedAt,
      ...(reviewedEntry ? { valuation: source.valuation, verification: "reviewed" as const } : {}),
      candidates: [source.valuation.sourceUrl, ...candidates], reason: "Official RSS checked; article unavailable. Any displayed amount is the previously reviewed financing valuation, not newly verified by this check." };
  }
  if (!plainSource(article).includes(plainSource(source.evidence))) return { status: "review_required", checkedAt, candidates: [source.valuation.sourceUrl], reason: "Reviewed valuation passage changed or could not be verified" };
  return { status: !privateValuationFresh(source.valuation, now) ? "stale" : candidates.length ? "review_required" : "verified", checkedAt, valuation: source.valuation, verification: "source_checked", candidates,
    ...(candidates.length ? { reason: "Funding links found on official news index; review dates and terms before replacing the reviewed valuation" } : {}) };
}
