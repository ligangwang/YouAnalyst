import type { Metadata } from "next";
import { DailyScoresPage } from "@/components/daily-scores-page";
import { dailySectionMetadata } from "@/lib/daily-scores/page-metadata";

export const metadata: Metadata = dailySectionMetadata(null, "institutional");

export default function DailyInstitutionalRoutePage() {
  return <DailyScoresPage section="institutional" />;
}
