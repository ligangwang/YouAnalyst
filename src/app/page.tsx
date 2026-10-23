import {initialSnapshotWithinBudget} from '@/lib/intelligence/initial-snapshot';
import {loadThemeCatalog} from '@/lib/company-themes/catalog';
import type { Metadata } from "next";
import IntelligencePage from "@/app/intelligence/page";
import { localizedMetadata } from "@/lib/ui/i18n/server";
import { themeMetadata } from "@/lib/company-themes/metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: {searchParams: Promise<{theme?:string;company?:string;relationship?:string}>}): Promise<Metadata> {
  const p = await searchParams;
  const details=themeMetadata(p.theme,await initialSnapshotWithinBudget(loadThemeCatalog())??[]);
  const image = `/api/research-preview-image?${new URLSearchParams({theme:details.theme,company:typeof p.company === "string" ? p.company : "",relationship:typeof p.relationship === "string" ? p.relationship : ""})}`;
  const metadata = await localizedMetadata({ title:details.title,description:details.description, alternates: { canonical:details.canonical }, openGraph:{images:[{url:image,width:1200,height:630}]},twitter:{card:"summary_large_image",images:[image]} },{usePageCanonical:details.theme!=='ai'});
  const view = new URLSearchParams();
  if(typeof p.company === "string") view.set("company",p.company);
  if(typeof p.relationship === "string") view.set("relationship",p.relationship);
  if(metadata.openGraph && view.size) metadata.openGraph.url = `${metadata.alternates?.canonical ?? "/en"}${details.theme==='ai'?'?':'&'}${view}`;
  return metadata;
}
export default async function Home({ searchParams }: {
  searchParams: Promise<{ theme?: string; preview?: string; event?: string | string[]; relationship?: string | string[]; company?: string | string[]; market?: string | string[]; q?: string | string[]; view?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  return <IntelligencePage searchParams={Promise.resolve(params)}/>;
}
