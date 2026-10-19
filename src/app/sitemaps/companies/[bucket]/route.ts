import { localQuery } from '@/lib/local-cache/entities';
import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyBucketPrefix, companySitemapPath, companySitemapXml } from "@/lib/ui/i18n/company-sitemaps";

const loadPaths = async (prefix: string) => {
  const db=getAdminFirestore();
  const docs = await localQuery(db,`sitemap:${prefix}`,db.collection("companies")
    .orderBy(FieldPath.documentId()).startAt(prefix).endBefore(prefix + "\uf8ff"));
  return [...docs.values()].flatMap(doc => {
    const path = companySitemapPath(doc.id, doc.data()!);
    return path ? [path] : [];
  });
};

export async function GET(_request: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  const prefix = bucket.endsWith(".xml") ? companyBucketPrefix(bucket.slice(0, -4)) : null;
  if (!prefix) return new Response("Not found", { status: 404 });
  try {
    const paths=await loadPaths(prefix);
    return new Response(companySitemapXml(paths), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
