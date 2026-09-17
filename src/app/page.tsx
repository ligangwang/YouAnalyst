import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MapPage from "@/app/map/page";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: {searchParams: Promise<{company?:string;relationship?:string}>}): Promise<Metadata> {
  const p = await searchParams;
  const image = `/api/research-preview-image?${new URLSearchParams({company:typeof p.company === "string" ? p.company : "",relationship:typeof p.relationship === "string" ? p.relationship : ""})}`;
  const metadata = await localizedMetadata({ title: "AI Industry Map: AI Stocks & Companies | YouAnalyst", description: "Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.", alternates: { canonical: "/" }, openGraph:{images:[{url:image,width:1200,height:630}]},twitter:{card:"summary_large_image",images:[image]} });
  const view = new URLSearchParams();
  if(typeof p.company === "string") view.set("company",p.company);
  if(typeof p.relationship === "string") view.set("relationship",p.relationship);
  if(metadata.openGraph && view.size) metadata.openGraph.url = `${metadata.alternates?.canonical ?? "/en"}?${view}`;
  return metadata;
}
export default async function Home({ searchParams }: {
  searchParams: Promise<{ event?: string | string[]; relationship?: string | string[]; company?: string | string[]; market?: string | string[]; q?: string | string[]; view?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  // Preserve company campaign destinations and bookmarked feed filters.
  if (typeof params.type === "string") redirect("/feed?type=" + encodeURIComponent(params.type));
  return <MapPage searchParams={Promise.resolve(params)} />;
}
