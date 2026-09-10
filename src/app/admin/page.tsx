import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminDashboardPage } from "@/components/admin-dashboard-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Admin | YouAnalyst",
  description: "Review admin tools for YouAnalyst.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminPage() {
  return <AdminDashboardPage />;
}
