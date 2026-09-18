import type { Metadata } from "next";
import {
  dailyCanonicalPath,
  dailyShareImageDate,
  dailyShareVersion,
} from "@/lib/daily-scores/public-share";
import { getDailyScores } from "@/lib/daily-scores/service";

function buildDailyScoresMetadata(date: string | null, hasCallOfTheDay: boolean): Metadata {
  const title = date ? `Best Calls Today - ${date} | YouAnalyst` : "Daily score moves | YouAnalyst";
  const description = hasCallOfTheDay
    ? "See today's top public stock calls and daily performance moves on YouAnalyst."
    : "Track daily score changes and recent analyst performance moves on YouAnalyst.";
  const canonical = dailyCanonicalPath(date);
  const imageDate = dailyShareImageDate(date);
  const version = dailyShareVersion(date);
  const openGraphImage = `/daily/share/${imageDate}/opengraph-image?v=${version}`;
  const twitterImage = `/daily/share/${imageDate}/twitter-image?v=${version}`;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [
        {
          url: openGraphImage,
          width: 1200,
          height: 630,
          alt: "YouAnalyst daily top call share card",
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
}

export async function dailyScoresMetadata(date: string | null): Promise<Metadata> {
  try {
    const result = await getDailyScores(date);
    return buildDailyScoresMetadata(result.date, Boolean(result.callOfTheDay));
  } catch {
    return buildDailyScoresMetadata(date, false);
  }
}
