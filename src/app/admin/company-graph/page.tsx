import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminCompanyGraphRequestsPage } from "@/components/admin-company-graph-requests-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Company Graph Requests | Admin | YouAnalyst",
  description: "Generate queued company graph requests.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminCompanyGraphRoutePage() {
  return <AdminCompanyGraphRequestsPage />;
}
