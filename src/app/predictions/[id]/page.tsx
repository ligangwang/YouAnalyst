import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { PredictionDetailPage } from "@/components/prediction-detail-page";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTicker } from "@/lib/predictions/types";
import { noIndexRobots } from "@/lib/seo";

const PREDICTION_SHARE_CARD_VERSION = "v3";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function predictionMetadataTitle(ticker: string, thesisTitle: string, direction: string): string {
  const cleanTicker = ticker.replace(/^\$/, "");
  const trimmedTitle = thesisTitle.trim();
  const duplicateTickerPattern = new RegExp(`^\\$?${escapeRegExp(cleanTicker)}\\s*[:\\-–—]\\s*`, "i");
  const titleWithoutTickerPrefix = trimmedTitle.replace(duplicateTickerPattern, "").trim();

  if (titleWithoutTickerPrefix) {
    return `${ticker}: ${titleWithoutTickerPrefix} | YouAnalyst`;
  }

  return `${direction} call on ${ticker} | YouAnalyst`;
}

function predictionShareVersion(id: string, prediction: Record<string, unknown>): string {
  const updatedAt = typeof prediction.updatedAt === "string" ? prediction.updatedAt.trim() : "";
  const createdAt = typeof prediction.createdAt === "string" ? prediction.createdAt.trim() : "";
  const versionSource = updatedAt || createdAt || id;
  const compactVersion = versionSource.replace(/[^0-9A-Za-z]/g, "");
  return `${PREDICTION_SHARE_CARD_VERSION}-${compactVersion || id}`;
}

async function buildPageMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const db = getAdminFirestore();

  try {
    const snapshot = await db.collection("predictions").doc(id).get();
    if (!snapshot.exists) {
      return {
        title: "Prediction not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const prediction = snapshot.data() as Record<string, unknown>;
    const visibility = typeof prediction.visibility === "string" ? prediction.visibility : "";
    const status = typeof prediction.status === "string" ? prediction.status : "";
    if (visibility !== "PUBLIC" || status === "CANCELED") {
      return {
        title: "Prediction not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const ticker = normalizeTicker(typeof prediction.ticker === "string" ? prediction.ticker : "");
    const shareVersion = predictionShareVersion(id, prediction);
    const openGraphImage = `/predictions/${id}/opengraph-image?v=${shareVersion}`;
    const twitterImage = `/predictions/${id}/twitter-image?v=${shareVersion}`;
    const direction = prediction.direction === "DOWN" ? "Down" : "Up";
    const rawTitle = typeof prediction.thesisTitle === "string" ? prediction.thesisTitle.trim() : "";
    const predictionUserId = typeof prediction.userId === "string" ? prediction.userId.trim() : "";
    let authorLabel = "";
    if (predictionUserId) {
      const userSnapshot = await db.collection("users").doc(predictionUserId).get();
      const userData = userSnapshot.data() as Record<string, unknown> | undefined;
      const nickname = typeof userData?.nickname === "string" ? userData.nickname.trim() : "";
      authorLabel = nickname ? `@${nickname}` : "";
    }

    const title = predictionMetadataTitle(ticker, rawTitle, direction);
    const description = authorLabel
      ? `${authorLabel}'s ${direction.toLowerCase()} call on ${ticker}, with live performance and discussion on YouAnalyst.`
      : `${direction} call on ${ticker}, with live performance and discussion on YouAnalyst.`;

    return {
      title,
      description,
      alternates: {
        canonical: `/predictions/${id}`,
      },
      openGraph: {
        title,
        description,
        url: `/predictions/${id}`,
        images: [
          {
            url: openGraphImage,
            width: 1200,
            height: 630,
            alt: "YouAnalyst prediction share card",
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
      title: "Prediction | YouAnalyst",
      description: "View a public prediction, its live return, and discussion on YouAnalyst.",
      alternates: {
        canonical: `/predictions/${id}`,
      },
    };
  }
}

export default async function PredictionDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PredictionDetailPage predictionId={id} />;
}

export async function generateMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args));
}
