import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { PredictionsFeed } from "@/components/predictions-feed";

const pageMetadata: Metadata = {
  title: "Analyst views | YouAnalyst",
  description: "Evidence-backed analyst views on AI, Robotics and Space companies, each with a public track record.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Analyst views | YouAnalyst",
    description: "Evidence-backed analyst views on AI, Robotics and Space companies, each with a public track record.",
    url: "/",
  },
  twitter: {
    title: "Analyst views | YouAnalyst",
    description: "Evidence-backed analyst views on AI, Robotics and Space companies, each with a public track record.",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function PredictionsRoutePage() {
  return <PredictionsFeed />;
}
