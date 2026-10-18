import type { Metadata } from "next";
import { localizedMetadata } from '@/lib/i18n/server';
import { StockComparePage } from "@/components/stock-compare-page";
import { comparePath, parseCompareConfig } from "@/lib/compare";

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({
  title: "YouAnalyst Animated Stock Performance Comparison",
  robots: { index: false, follow: true },
}); }

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const initial = parseCompareConfig(params);
  const theme = params.get("theme") === "light" ? "light" : "dark";
  return <StockComparePage key={comparePath(initial)} initial={initial} embedded embedTheme={theme}/>;
}
