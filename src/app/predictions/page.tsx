import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { PredictionsFeed } from "@/components/predictions-feed";

const pageMetadata: Metadata = {
  title: "Top ideas | YouAnalyst",
  description: "Browse top-performing public stock ideas and analyst calls from the YouAnalyst community.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Top ideas | YouAnalyst",
    description: "Browse top-performing public stock ideas and analyst calls from the YouAnalyst community.",
    url: "/",
  },
  twitter: {
    title: "Top ideas | YouAnalyst",
    description: "Browse top-performing public stock ideas and analyst calls from the YouAnalyst community.",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function PredictionsRoutePage() {
  return <PredictionsFeed />;
}
