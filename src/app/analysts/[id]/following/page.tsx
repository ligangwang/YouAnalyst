import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { FollowListPage } from "@/components/follow-list-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Following | YouAnalyst",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function AnalystFollowingRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FollowListPage userId={id} kind="following" />;
}
