import type { Metadata } from "next";
import { InstitutionsDiscoveryPage } from "@/components/institutions-discovery-page";
import { getInstitutionalDiscoverySummary } from "@/lib/securities/institutional-data";

export const dynamic = "force-dynamic";

const title = "Institutional activity | YouAnalyst";
const description = "Browse tracked 13F institutions and recent institutional buying and selling activity.";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/institutions",
  },
  openGraph: {
    title,
    description,
    url: "/institutions",
  },
  twitter: {
    title,
    description,
  },
};

export default async function InstitutionsPage() {
  const summary = await getInstitutionalDiscoverySummary();

  return <InstitutionsDiscoveryPage initialSummary={summary} />;
}
