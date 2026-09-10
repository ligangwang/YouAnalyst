import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminAiAnalystPage } from "@/components/admin-ai-analyst-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "AI Analyst Drafts | Admin | YouAnalyst",
  description: "Review and publish AI analyst drafts.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminAiAnalystRoutePage() {
  return <AdminAiAnalystPage />;
}

