import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { DailyScoresPage } from "@/components/daily-scores-page";
import { dailySectionMetadata } from "@/lib/daily-scores/page-metadata";

const pageMetadata: Metadata = dailySectionMetadata(null, "institutional");
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function DailyInstitutionalRoutePage() {
  return <DailyScoresPage section="institutional" />;
}
