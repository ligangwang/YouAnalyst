import { isMapTicker } from "../industry-graph/directory";
import { publicChinaCompany } from "../industry-research/china-directory";
import { localizedPath } from "./urls";
import { absoluteUrl } from "../seo";

// Disjoint ID ranges keep each response small without imposing a company limit.
export const COMPANY_SITEMAP_BUCKETS = [
  ..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(letter => `US-${letter}`),
  "XSHG-6", "XSHE-0", "XSHE-3",
];
export function companyBucketPrefix(bucket: string): string | null {
  return COMPANY_SITEMAP_BUCKETS.includes(bucket) ? bucket.replace("-", ":") : null;
}
export function companySitemapPath(id: string, data: Record<string, unknown>): string | null {
  const symbol = id.startsWith("US:") ? id.slice(3) : id;
  if (id.startsWith("US:") ? !data.name || !isMapTicker(symbol) : !publicChinaCompany(id, data)) return null;
  return `/ticker/${encodeURIComponent(symbol)}`;
}
export function xml(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
export function companySitemapXml(paths: string[]): string {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' + paths.map(path => {
    const en = absoluteUrl(localizedPath(path, "en")), zh = absoluteUrl(localizedPath(path, "zh-CN"));
    const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${xml(en)}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${xml(zh)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${xml(en)}"/>`;
    return [en, zh].map(url => `<url><loc>${xml(url)}</loc>${alternates}<changefreq>weekly</changefreq></url>`).join("");
  }).join("") + "</urlset>";
}
