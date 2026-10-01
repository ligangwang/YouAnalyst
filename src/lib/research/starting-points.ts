import { bi, researchConnections as amdConnections, type Bilingual } from "./amd-ecosystem";
import { researchConnections as nvidiaConnections, type Evidence } from "./nvidia-ecosystem";
import { topicSources } from "./infrastructure-topics";

export type ResearchStartingPoint = {
  id: string;
  href: string;
  question: Bilingual;
  shortLabel: Bilingual;
  summary: Bilingual;
  sources: (Evidence & { label: Bilingual })[];
};

function source(rows: Evidence[], id: string, label: Bilingual) {
  const row = rows.find(row => "id" in row && row.id === id);
  if (!row) throw new Error(`Missing homepage research evidence: ${id}`);
  return { source: row.source, url: row.url, date: row.date, label };
}

// Resolve citations from the same editorial evidence used by the destination pages.
// Only these small, serializable cards cross the homepage's client boundary.
export const researchStartingPoints: ResearchStartingPoint[] = [
  {
    id: "nvidia-suppliers",
    href: "/research/nvidia-ai-ecosystem?relation=supplier#connections",
    question: bi("Who supplies NVIDIA?", "谁在为英伟达供货？"),
    shortLabel: bi("Who supplies NVIDIA?", "谁在为英伟达供货？"),
    summary: bi("NVIDIA’s filing names TSMC and Samsung for wafers, and SK hynix, Micron and Samsung for memory. Supplier names alone do not reveal purchase volumes.", "英伟达年报列出台积电和三星的晶圆供应，以及 SK 海力士、美光和三星的内存供应。供应商名单并未披露采购量。"),
    sources: [source(nvidiaConnections, "tsm-wafers", bi("NVIDIA FY2026 10-K", "英伟达 FY2026 年报"))],
  },
  {
    id: "amd-live-deployments",
    href: "/research/amd-ai-ecosystem?product=EPYC&relation=integration#AMZN",
    question: bi("Which AMD deployments are live?", "AMD 的哪些部署已落地？"),
    shortLabel: bi("AMD deployment progress", "AMD 部署进展"),
    summary: bi("AWS announced Hpc8a CPU instances as available in Ohio and Stockholm. This evidence does not establish Instinct GPU deployments.", "AWS 公告称采用 EPYC CPU 的 Hpc8a 实例已在俄亥俄和斯德哥尔摩可用。这并不能证明 Instinct GPU 已部署。"),
    sources: [source(amdConnections, "US:AMZN__INTEGRATES_TECHNOLOGY_FROM__US:AMD", bi("AWS Hpc8a launch", "AWS Hpc8a 发布公告"))],
  },
  {
    id: "ai-infrastructure-bottlenecks",
    href: "/research/ai-infrastructure-bottlenecks",
    question: bi("Where are AI infrastructure bottlenecks?", "AI 基础设施的瓶颈在哪里？"),
    shortLabel: bi("AI infrastructure bottlenecks", "AI 基础设施瓶颈"),
    summary: bi("Micron reports HBM4 production; Vertiv’s GB200 blueprint combines power and cooling. These milestones do not establish a measured shortage or a completed deployment.", "美光披露 HBM4 量产；维谛的 GB200 参考设计整合供电与散热。这些里程碑并不能证明已测定的短缺或部署完成。"),
    sources: [
      source(nvidiaConnections, "mu-hbm4", bi("Micron HBM4 release", "美光 HBM4 公告")),
      { source: topicSources.vertivBlueprint.title, url: topicSources.vertivBlueprint.url, date: topicSources.vertivBlueprint.published, label: bi("Vertiv GB200 blueprint", "维谛 GB200 参考设计") },
    ],
  },
];
