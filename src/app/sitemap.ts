import type { MetadataRoute } from "next";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTicker } from "@/lib/predictions/types";
import { absoluteUrl } from "@/lib/seo";
import { isMapTicker } from "@/lib/industry-graph/directory";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "@/lib/company-graph/types";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: absoluteUrl("/feed"), changeFrequency: "hourly", priority: 0.8 },
  { url: absoluteUrl("/map"), changeFrequency: "daily", priority: 0.7 },
  {
    url: absoluteUrl("/"),
    changeFrequency: "hourly",
    priority: 1,
  },
  {
    url: absoluteUrl("/daily"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/watchlists"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/companies"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/institutions"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/how-it-works"),
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    url: absoluteUrl("/feedback"),
    changeFrequency: "monthly",
    priority: 0.3,
  },
];

function isPublicUser(data: Record<string, unknown> | undefined): boolean {
  const settings = data?.settings;
  if (!settings || typeof settings !== "object") {
    return true;
  }

  return (settings as Record<string, unknown>).isPublic !== false;
}

function toIsoDate(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const companyRoutes = new Map<string, MetadataRoute.Sitemap[number]>();
  try {
    const db = getAdminFirestore();
    const metadata = await db.collection("industry_map_companies").limit(500).get();
    const runs = await db.collection("company_graph_runs").where("status", "==", "COMPLETED")
      .select("extractionVersion", "result.ticker", "result.dryRun", "result.extractionVersion").limit(500).get();
    for (const ticker of [
      ...metadata.docs.map((doc) => doc.id),
      ...runs.docs.flatMap((doc) => {
        const data = doc.data();
        return data.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION && data.result?.dryRun === false &&
          data.result?.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION ? [data.result.ticker] : [];
      }),
    ]) if (isMapTicker(ticker)) companyRoutes.set(ticker, { url: absoluteUrl(`/ticker/${ticker}`), changeFrequency: "daily", priority: 0.7 });
    const [predictionSnapshot, userSnapshot, watchlistSnapshot] = await Promise.all([
      db.collection("predictions").where("visibility", "==", "PUBLIC").orderBy("createdAt", "desc").limit(500).get(),
      db.collection("users").orderBy("updatedAt", "desc").limit(500).get(),
      db.collection("watchlists").orderBy("updatedAt", "desc").limit(500).get(),
    ]);

    const publicUserEntries: Array<[string, Record<string, unknown>]> = userSnapshot.docs
      .map((doc): [string, Record<string, unknown>] => [doc.id, doc.data() as Record<string, unknown>])
      .filter((entry) => isPublicUser(entry[1]));
    const publicUsers = new Map<string, Record<string, unknown>>(publicUserEntries);

    const analystRoutes: MetadataRoute.Sitemap = Array.from(publicUsers.entries()).map(([userId, data]) => ({
      url: absoluteUrl(`/analysts/${userId}`),
      lastModified: toIsoDate(data.updatedAt),
      changeFrequency: "daily",
      priority: 0.7,
    }));

    const tickerRoutes = companyRoutes;
    const predictionRoutes: MetadataRoute.Sitemap = [];

    for (const doc of predictionSnapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (data.status === "CANCELED") {
        continue;
      }

      const ticker = typeof data.ticker === "string" ? normalizeTicker(data.ticker) : "";
      if (ticker && !tickerRoutes.has(ticker)) {
        tickerRoutes.set(ticker, {
          url: absoluteUrl(`/ticker/${ticker}`),
          lastModified: toIsoDate(data.updatedAt ?? data.createdAt),
          changeFrequency: "hourly",
          priority: 0.7,
        });
      }

      predictionRoutes.push({
        url: absoluteUrl(`/predictions/${doc.id}`),
        lastModified: toIsoDate(data.updatedAt ?? data.createdAt),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }

    const watchlistRoutes: MetadataRoute.Sitemap = watchlistSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
      .filter(({ data }) => {
        const userId = typeof data.userId === "string" ? data.userId : "";
        return !data.archivedAt && !!userId && publicUsers.has(userId);
      })
      .map(({ id, data }) => ({
        url: absoluteUrl(`/analysts/${data.userId as string}/watchlists/${id}`),
        lastModified: toIsoDate(data.updatedAt),
        changeFrequency: "daily",
        priority: 0.6,
      }));

    return [...STATIC_ROUTES, ...analystRoutes, ...watchlistRoutes, ...tickerRoutes.values(), ...predictionRoutes];
  } catch {
    return [...STATIC_ROUTES, ...companyRoutes.values()];
  }
}
