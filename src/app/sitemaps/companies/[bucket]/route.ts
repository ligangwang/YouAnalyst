import { centralRequest } from '@/lib/central-cache/client';
import { decode } from '@/lib/central-cache/codec';
import { changeCached } from '@/lib/change-cache';
import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyBucketPrefix, companySitemapPath, companySitemapXml } from "@/lib/ui/i18n/company-sitemaps";

const loadPaths = async (prefix: string) => {
  const db=getAdminFirestore();
  return changeCached(db,`company-sitemap:${prefix}`,['companies'],async()=>{
  const snapshot = await db.collection("companies")
    .orderBy(FieldPath.documentId()).startAt(prefix).endBefore(prefix + "\uf8ff")
    .select("name", "slug", "market", "status", "description", "classification", "stage", "source", "sourceLabel").get();
  return snapshot.docs.flatMap(doc => {
    const path = companySitemapPath(doc.id, doc.data());
    return path ? [path] : [];
  });
  });
};

export async function GET(_request: Request, { params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  const prefix = bucket.endsWith(".xml") ? companyBucketPrefix(bucket.slice(0, -4)) : null;
  if (!prefix) return new Response("Not found", { status: 404 });
  try {
    const central=await centralRequest('/sitemap',{bucket:bucket.slice(0,-4)});
    const paths=central===undefined?await loadPaths(prefix):decode(central) as string[];
    return new Response(companySitemapXml(paths), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
