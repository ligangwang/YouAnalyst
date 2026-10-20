import { loadSitemapPaths } from '@/lib/local-cache/sitemaps';
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyBucketPrefix, companySitemapXml } from "@/lib/ui/i18n/company-sitemaps";

export async function GET(_request: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  const prefix = bucket.endsWith(".xml") ? companyBucketPrefix(bucket.slice(0, -4)) : null;
  if (!prefix) return new Response("Not found", { status: 404 });
  try {
    const paths=await loadSitemapPaths(getAdminFirestore(), prefix);
    return new Response(companySitemapXml(paths), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
