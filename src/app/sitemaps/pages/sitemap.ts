import type { MetadataRoute } from "next";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { absoluteUrl } from "@/lib/seo";
import { infrastructureTopics, RESEARCH_REVIEWED } from "@/lib/research/infrastructure-topics";
import { localizedPath } from "@/lib/ui/i18n/urls";
import {changeCached} from '@/lib/change-cache';

function bilingual(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  return entries.filter(entry => new URL(entry.url).pathname !== "/map").flatMap(entry => {
    const path = new URL(entry.url).pathname;
    const languages = { en: absoluteUrl(localizedPath(path, "en")), "zh-CN": absoluteUrl(localizedPath(path, "zh-CN")), "x-default": absoluteUrl(localizedPath(path, "en")) };
    return ["en", "zh-CN"].map(locale => ({ ...entry, url: languages[locale as "en" | "zh-CN"], alternates: { languages } }));
  });
}

export const dynamic = "force-dynamic";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.6 },
  ...infrastructureTopics.map(topic => ({ url: absoluteUrl(`/research/${topic.slug}`), lastModified: RESEARCH_REVIEWED, changeFrequency: "weekly" as const, priority: 0.8 })),
  { url: absoluteUrl("/research/nvidia-ai-ecosystem"), lastModified: "2026-09-24", changeFrequency: "weekly", priority: 0.8 },
  { url: absoluteUrl("/research/amd-ai-ecosystem"), lastModified: "2026-09-17", changeFrequency: "weekly", priority: 0.8 },
  { url: absoluteUrl("/compare"), changeFrequency: "weekly", priority: 0.8 },
  { url: absoluteUrl("/map"), changeFrequency: "daily", priority: 0.7 },
  {
    url: absoluteUrl("/"),
    changeFrequency: "hourly",
    priority: 1,
  },
  {
    url: absoluteUrl("/daily/calls"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/calendar"),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: absoluteUrl("/companies"),
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
  try {
    const db = getAdminFirestore();
    return await changeCached(db,'pages-sitemap',['users','predictions','watchlists'],async()=>{
    // Company URLs belong exclusively to the uncapped company bucket sitemaps.
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

    const predictionRoutes: MetadataRoute.Sitemap = [];

    for (const doc of predictionSnapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (data.status === "CANCELED") {
        continue;
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
        // Comparison groups redirect to /compare/analyst-views instead of serving a watchlist page.
        return data.kind !== "COMPARISON" && !data.archivedAt && !!userId && publicUsers.has(userId);
      })
      .map(({ id, data }) => ({
        url: absoluteUrl(`/analysts/${data.userId as string}/watchlists/${id}`),
        lastModified: toIsoDate(data.updatedAt),
        changeFrequency: "daily",
        priority: 0.6,
      }));

    return bilingual([...STATIC_ROUTES, ...analystRoutes, ...watchlistRoutes, ...predictionRoutes]);
    });
  } catch {
    return bilingual(STATIC_ROUTES);
  }
}
