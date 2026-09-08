import type { Metadata } from "next";
import { IndustryGraphHome } from "@/components/industry-graph-home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI industry map | YouAnalyst",
  description: "Explore companies across the AI industry and inspect filing evidence for their suppliers, customers and competitors.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AI industry map | YouAnalyst",
    description: "Explore the companies behind AI, from silicon to infrastructure, through SEC filing evidence.",
    url: "/",
  },
  twitter: {
    title: "AI industry map | YouAnalyst",
    description: "Explore the companies behind AI through SEC filing evidence.",
  },
};

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  const { company } = await searchParams;
  return <IndustryGraphHome initialTicker={typeof company === "string" ? company : ""} />;
}
