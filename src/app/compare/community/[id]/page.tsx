import { CommunityComparisonDetail } from "@/components/compare-community";
import { validCommunityId } from "@/lib/compare-community";
import { notFound } from "next/navigation";
import { localizedMetadata } from "@/lib/ui/i18n/server";

export async function generateMetadata() { return localizedMetadata({ title: "Community comparison & discussion | YouAnalyst", description: "Replay a community stock comparison and join the discussion.", robots: { index: false, follow: true } }); }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validCommunityId(id)) notFound();
  return <CommunityComparisonDetail id={id}/>;
}
