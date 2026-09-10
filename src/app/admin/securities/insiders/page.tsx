import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminInsiderOpsPage } from "@/components/admin-insider-ops-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Insider Transactions | Admin | YouAnalyst",
  description: "Monitor SEC Form 4 insider transaction ingestion.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminInsiderOpsRoutePage() {
  return <AdminInsiderOpsPage />;
}
