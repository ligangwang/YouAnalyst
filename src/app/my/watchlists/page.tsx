import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "My watchlists | YouAnalyst",
  description: "Create and manage your watchlists on YouAnalyst.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function MyWatchlistsRoutePage() {
  redirect("/watchlists?tab=mine");
}
