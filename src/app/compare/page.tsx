import type { Metadata } from "next";
import { StockComparePage } from "@/components/stock-compare-page";
import { comparePath, parseCompareConfig } from "@/lib/compare";
import { localizedMetadata } from "@/lib/i18n/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
async function configFrom(props: Props) {
  const query = await props.searchParams;
  return parseCompareConfig(new URLSearchParams(Object.entries(query).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])));
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const config = await configFrom(props);
  const title = `${config.symbols.join(" vs ")} | YouAnalyst Animated Stock Performance Comparison`;
  const description = `Replay stock price returns from ${config.start} to ${config.end}. Choose a line race or bar race and share your comparison.`;
  const image = `/api/compare/share-image?${comparePath(config).split("?")[1]}`;
  return localizedMetadata({ title, description, alternates: { canonical: "/compare" }, openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } });
}
export default async function Page(props: Props) {
  const initial = await configFrom(props);
  return <StockComparePage key={comparePath(initial)} initial={initial}/>;
}
