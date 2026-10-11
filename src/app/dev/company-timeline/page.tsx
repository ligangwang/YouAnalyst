import { notFound } from "next/navigation";
import seed from "../../../../data/ai-supply-chain/ai-us.json";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { CompanyTimelinePreview } from "@/components/company-timeline-preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company timeline · Local preview", robots: { index: false, follow: false } };
export default function CompanyTimelinePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CompanyTimelinePreview graph={seed as unknown as KnowledgeGraph} />;
}
