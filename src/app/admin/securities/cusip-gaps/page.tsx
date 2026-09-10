import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminCusipGapsPage } from "@/components/admin-cusip-gaps-page";

const pageMetadata: Metadata = {
  title: "CUSIP Mapping Gaps | Admin | YouAnalyst",
  description: "Review unmapped CUSIP holdings from institutional 13F data.",
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminCusipGapsRoutePage() {
  return <AdminCusipGapsPage />;
}
