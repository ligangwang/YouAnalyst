import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MapPage from "@/app/map/page";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "AI Industry Map: AI Stocks & Companies | YouAnalyst", description: "Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.", alternates: { canonical: "/" } });
}
export default async function Home({ searchParams }: {
  searchParams: Promise<{ company?: string | string[]; market?: string | string[]; q?: string | string[]; view?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  // Preserve company campaign destinations and bookmarked feed filters.
  if (typeof params.type === "string") redirect("/feed?type=" + encodeURIComponent(params.type));
  return <MapPage searchParams={Promise.resolve(params)} />;
}
