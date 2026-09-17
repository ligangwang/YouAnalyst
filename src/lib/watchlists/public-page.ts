import type { Metadata } from "next";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { noIndexRobots } from "@/lib/seo";
import { watchlistCanonicalPath, watchlistShareVersion } from "@/lib/watchlists/public-share";
import { getWatchlistDetail } from "@/lib/watchlists/service";

function sanitizeShareVersion(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.length > 160 || !/^[0-9A-Za-z._-]+$/.test(candidate)) {
    return null;
  }

  return candidate;
}

export async function generatePublicWatchlistMetadata(
  watchlistId: string,
  options: { share?: string | string[] } = {},
): Promise<Metadata> {
  const db = getAdminFirestore();

  try {
    const watchlistSnapshot = await db.collection("watchlists").doc(watchlistId).get();
    if (!watchlistSnapshot.exists) {
      return {
        title: "Watchlist not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const watchlist = watchlistSnapshot.data() as Record<string, unknown>;
    const ownerId = typeof watchlist.userId === "string" ? watchlist.userId.trim() : "";
    if (!ownerId || watchlist.isPublic === false) {
      return {
        title: "Watchlist not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const userSnapshot = await db.collection("users").doc(ownerId).get();
    if (!userSnapshot.exists) {
      return {
        title: "Watchlist not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const user = userSnapshot.data() as Record<string, unknown>;
    const settings =
      user.settings && typeof user.settings === "object"
        ? (user.settings as Record<string, unknown>)
        : null;

    if (settings?.isPublic === false) {
      return {
        title: "Watchlist not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const nickname = typeof user.nickname === "string" ? user.nickname.trim() : "";
    const displayName = typeof user.displayName === "string" ? user.displayName.trim() : "";
    const ownerLabel = nickname ? `@${nickname}` : displayName || "Analyst";
    const watchlistName = typeof watchlist.name === "string" ? watchlist.name.trim() : "Watchlist";
    const descriptionValue = typeof watchlist.description === "string" ? watchlist.description.trim() : "";
    const title = `${watchlistName} | ${ownerLabel} | YouAnalyst`;
    const description = descriptionValue || `${ownerLabel}'s public ${watchlistName} watchlist on YouAnalyst.`;
    const canonical = watchlistCanonicalPath(watchlistId);
    const detail = await getWatchlistDetail(watchlistId);
    const generatedShareVersion = watchlistShareVersion(watchlistId, {
      ...watchlist,
      metrics: detail?.metrics,
    });
    const shareVersion = sanitizeShareVersion(options.share) ?? generatedShareVersion;
    const socialUrl = `${canonical}?share=${encodeURIComponent(shareVersion)}`;
    const openGraphImage = `${canonical}/opengraph-image?v=${shareVersion}`;
    const twitterImage = `${canonical}/twitter-image?v=${shareVersion}`;

    return {
      title,
      description,
      alternates: {
        canonical,
      },
      openGraph: {
        title,
        description,
        url: socialUrl,
        images: [
          {
            url: openGraphImage,
            width: 1200,
            height: 630,
            alt: "YouAnalyst watchlist share card",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [twitterImage],
      },
    };
  } catch {
    return {
      title: "Watchlist | YouAnalyst",
      description: "Browse a public watchlist on YouAnalyst.",
      alternates: {
        canonical: watchlistCanonicalPath(watchlistId),
      },
    };
  }
}
