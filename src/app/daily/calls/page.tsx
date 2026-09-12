import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { DailyScoresPage } from "@/components/daily-scores-page";
import { dailyScoresMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyScoreDate } from "@/lib/daily-scores/service";

function dateSearchParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDailyScoreDate(candidate ?? null) ? candidate ?? null : null;
}

async function buildPageMetadata({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}): Promise<Metadata> {
  const { date } = await searchParams;
  return dailyScoresMetadata(dateSearchParam(date));
}

export default function DailyCallsRoutePage() {
  return <DailyScoresPage section="calls" />;
}

export async function generateMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args));
}
