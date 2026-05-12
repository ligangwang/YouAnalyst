import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DailyScoresPage } from "@/components/daily-scores-page";
import { dailySectionMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyScoreDate } from "@/lib/daily-scores/service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  if (!isDailyScoreDate(date)) {
    notFound();
  }

  return dailySectionMetadata(date, "institutional");
}

export default async function DailyInstitutionalDateRoutePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isDailyScoreDate(date)) {
    notFound();
  }

  return <DailyScoresPage initialDate={date} section="institutional" />;
}
