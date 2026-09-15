"use client";

import { lazy, Suspense, useState } from "react";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";

const DirectoryContent = lazy(() => import("./ai-map-directory-content"));

export function AiMapDirectory({ graph, status, onRetry, initiallyExpanded = false }: {
  graph: KnowledgeGraph;
  status: string;
  onRetry: () => void;
  initiallyExpanded?: boolean;
}) {
  const { text } = useLocale();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const loading = <p className="my-5" role="status">{text("Loading company directory…", "正在加载公司目录…")}</p>;
  return <section className="mx-auto w-full max-w-6xl px-4 pb-8 text-sm text-slate-400" aria-label={text("AI companies and supply chain", "AI 公司与产业链")}>
    <details open={expanded} className="rounded-2xl border border-white/10 p-5" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-cyan-200">{text("Explore AI stocks, companies and the supply chain", "探索 AI 公司与产业链")}</summary>
      {expanded && (status === "error" ? <p className="my-5" role="alert">{text("The company directory could not be loaded.", "暂时无法加载公司目录。")} <button className="text-cyan-200 underline" onClick={onRetry}>{text("Try again", "重试")}</button></p> : status !== "ready" ? loading : <Suspense fallback={loading}><DirectoryContent graph={graph} /></Suspense>)}
    </details>
  </section>;
}
