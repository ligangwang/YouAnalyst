"use client";
import { useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { trackEvent } from "@/lib/analytics";
import { AiKnowledgeGraph } from "./ai-knowledge-graph";
export { ShareResearchView } from "./share-research-view";
export function EvidenceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={()=>trackEvent("company_evidence_view", {entry_point:"amd_ecosystem", ticker:"AMD"})}>{children} ↗</a>;
}
export function ResearchMap({ ids, company, edge = "" }: { ids: string[]; company: string; edge?: string }) {
  const [open, setOpen] = useState(false);
  const { text } = useLocale();
  return <section><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{text("Explore these connections in 3D", "在 3D 图谱中探索这些关系")}</button>{open && <AiKnowledgeGraph initialCompany={company} initialEdge={ids.includes(edge)?edge:""} allowedRelationshipIds={ids} />}</section>;
}
