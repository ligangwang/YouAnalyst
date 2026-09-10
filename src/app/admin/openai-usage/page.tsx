import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminOpenAiUsagePage } from "@/components/admin-openai-usage-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "OpenAI Usage | Admin | YouAnalyst",
  description: "Review OpenAI token usage and estimated costs.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminOpenAiUsageRoutePage() {
  return <AdminOpenAiUsagePage />;
}
