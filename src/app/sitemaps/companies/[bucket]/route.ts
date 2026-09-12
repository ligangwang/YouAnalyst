import { unstable_cache } from "next/cache";
import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyBucketPrefix, companySitemapPath, companySitemapXml } from "@/lib/i18n/company-sitemaps";

const loadPaths = unstable_cache(async (prefix: string) => {
  const snapshot = await getAdminFirestore().collection("market_companies")
    .orderBy(FieldPath.documentId()).startAt(prefix).endBefore(prefix + "\uf8ff")
    .select("name", "market", "status", "description", "classification", "stage", "source", "sourceLabel").get();
  return snapshot.docs.flatMap(doc => {
    const path = companySitemapPath(doc.id, doc.data());
    return path ? [path] : [];
  });
}, ["company-sitemap-v1"], { revalidate: 3600 });

export async function GET(_request: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  const prefix = bucket.endsWith(".xml") ? companyBucketPrefix(bucket.slice(0, -4)) : null;
  if (!prefix) return new Response("Not found", { status: 404 });
  try {
    return new Response(companySitemapXml(await loadPaths(prefix)), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
