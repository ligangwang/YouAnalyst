import type { Metadata } from "next";
import { StockComparePage } from "@/components/stock-compare-page";
import { comparePath, parseCompareConfig } from "@/lib/compare";

export const metadata: Metadata = {
  title: "YouAnalyst Compare",
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const initial = parseCompareConfig(params);
  const theme = params.get("theme") === "light" ? "light" : "dark";
  return <StockComparePage key={comparePath(initial)} initial={initial} embedded embedTheme={theme}/>;
}
