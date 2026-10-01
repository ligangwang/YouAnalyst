import { headers } from "next/headers";
import { localizedMetadata } from "@/lib/i18n/server";
import { infrastructureTopics } from "@/lib/research/infrastructure-topics";
import { InfrastructureResearchPage } from "@/components/infrastructure-research-page";

export const dynamic = "force-dynamic";
const topic = infrastructureTopics.find(item => item.slug === "hbm-supply")!;
export async function generateMetadata() {
  const lang = (await headers()).get("x-ya-language") === "zh-CN" ? "zh" : "en";
  return localizedMetadata({ title: `${topic.title[lang]} | YouAnalyst`, description: topic.summary[lang] });
}
export default async function ResearchPage() {
  return <InfrastructureResearchPage topic={topic} chinese={(await headers()).get("x-ya-language") === "zh-CN"} />;
}
