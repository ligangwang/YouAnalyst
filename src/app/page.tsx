import type { Metadata } from "next";
import { IndustryGraphHome } from "@/components/industry-graph-home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company relationship map | YouAnalyst",
  description: "Explore published company relationships and inspect filing evidence for suppliers, customers and competitors.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Company relationship map | YouAnalyst",
    description: "Explore company connections through SEC filing evidence.",
    url: "/",
  },
  twitter: {
    title: "Company relationship map | YouAnalyst",
    description: "Explore company connections through SEC filing evidence.",
  },
};

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  const { company } = await searchParams;
  const ticker = typeof company === "string" ? company : "";
  return <IndustryGraphHome key={ticker} initialTicker={ticker} />;
}
