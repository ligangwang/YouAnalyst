import { COMPANY_SITEMAP_BUCKETS, xml } from "@/lib/i18n/company-sitemaps";
import { absoluteUrl } from "@/lib/seo";

export function GET() {
  const paths = ["/sitemaps/pages/sitemap.xml", ...COMPANY_SITEMAP_BUCKETS.map(bucket => `/sitemaps/companies/${bucket}.xml`)];
  const body = '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + paths.map(path => `<sitemap><loc>${xml(absoluteUrl(path))}</loc></sitemap>`).join("") + "</sitemapindex>";
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
