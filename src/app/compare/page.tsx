import type { Metadata } from "next";
import { cache } from "react";
import { StockComparePage } from "@/components/stock-compare-page";
import { comparePath } from "@/lib/compare";
import { localizedMetadata } from "@/lib/ui/i18n/server";
import { resolveCompareLanding } from "@/lib/compare-community-service";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const configFrom = cache((query: string) => resolveCompareLanding(new URLSearchParams(query)));
async function landingFrom(props: Props) {
  const query = await props.searchParams;
  return configFrom(new URLSearchParams(Object.entries(query).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : Array.isArray(value) ? value.map(item => [key, item]) : [])).toString());
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { config } = await landingFrom(props);
  const title = `${config.symbols.join(" vs ")} | YouAnalyst Animated Stock Performance Comparison`;
  const description = `Replay stock price returns from ${config.start} to ${config.end}. Choose a line race or bar race and share your comparison.`;
  const image = `/api/compare/share-image?${comparePath(config).split("?")[1]}`;
  return localizedMetadata({ title, description, alternates: { canonical: "/compare" }, openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } });
}
export default async function Page(props: Props) {
  const { config: initial, featured, initialPage } = await landingFrom(props);
  return <StockComparePage key={comparePath(initial)} initial={initial} featured={featured} initialCommunityPage={initialPage}/>;
}
