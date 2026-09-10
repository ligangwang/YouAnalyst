import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminThirteenFOpsPage } from "@/components/admin-thirteen-f-ops-page";

const pageMetadata: Metadata = {
  title: "13F Operations | Admin | YouAnalyst",
  description: "Monitor SEC 13F discovery, queue processing, and backfills.",
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminThirteenFOpsRoutePage() {
  return <AdminThirteenFOpsPage />;
}
