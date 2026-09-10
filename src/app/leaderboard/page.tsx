import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { LeaderboardPage } from "@/components/leaderboard-page";

const pageMetadata: Metadata = {
  title: "Leaderboard | YouAnalyst",
  description: "Compare public analyst track records and top-performing stock calls on YouAnalyst.",
  alternates: {
    canonical: "/leaderboard",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function LeaderboardRoutePage() {
  return <LeaderboardPage />;
}
