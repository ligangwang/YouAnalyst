import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MapPage from "@/app/map/page";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "Company graph | YouAnalyst", description: "Explore US-listed and A-share companies together across the AI supply chain, with documented relationships and original sources.", alternates: { canonical: "/" } });
}
export default async function Home({ searchParams }: {
  searchParams: Promise<{ company?: string | string[]; market?: string | string[]; view?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  // Preserve company campaign destinations and bookmarked feed filters.
  if (typeof params.company === "string" && params.company) {
    const query = new URLSearchParams({ company: params.company });
    for (const key of ["market", "view"] as const) {
      if (typeof params[key] === "string") query.set(key, params[key]);
    }
    redirect("/map?" + query);
  }
  if (typeof params.type === "string") redirect("/feed?type=" + encodeURIComponent(params.type));
  return <MapPage searchParams={Promise.resolve(params)} />;
}
