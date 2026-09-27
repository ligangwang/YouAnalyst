import type { Metadata } from "next";
import { localizedMetadata } from "@/lib/i18n/server";
import { noIndexRobots } from "@/lib/seo";
import { AdminJobsPage } from "@/components/admin-jobs-page";
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "Tasks | Admin | YouAnalyst", robots: noIndexRobots() });
}
export default function Page() { return <AdminJobsPage />; }
