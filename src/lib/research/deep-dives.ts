import * as amd from "./amd-ecosystem";
import * as nvidia from "./nvidia-ecosystem";
import { bi, type Bilingual } from "./amd-ecosystem";
import { companyPageUrl } from "../market-companies/routes";

export type DeepDive = { slug: string; path: string; reviewed: string; title: Bilingual; summary: Bilingual; companies: { id: string; symbol: string | null; name: Bilingual; role: Bilingual }[]; highlights: { id: string; url: string; label: Bilingual }[] };

// Newest review first. Each deep-dive keeps its own evidence module; this list only drives discovery surfaces.
export const deepDives: DeepDive[] = [
  { slug: "nvidia-ai-ecosystem", path: nvidia.RESEARCH_PATH, reviewed: nvidia.REVIEWED, title: bi("NVIDIA’s AI ecosystem", "英伟达 AI 生态"), summary: bi("Across chips, networking, systems, CUDA and cloud: separate shipped Blackwell capacity from announced Vera Rubin plans.", "覆盖芯片、网络、系统、CUDA 与云：区分已出货的 Blackwell 与已宣布的 Vera Rubin 计划。"), companies: nvidia.researchCompanies, highlights: nvidia.researchConnections.filter(c => ["tsm-wafers", "mu-hbm4", "crwv-rubin"].includes(c.id)) },
  { slug: "amd-ai-ecosystem", path: amd.RESEARCH_PATH, reviewed: amd.REVIEWED, title: bi("AMD’s AI ecosystem", "AMD AI 生态"), summary: bi("Separate CPU cloud adoption, GPU product integration and rack plans.", "区分 CPU 云端采用、GPU 产品集成与机架计划。"), companies: amd.researchCompanies.map(c => ({ ...c, id: `US:${c.symbol}` })), highlights: amd.researchConnections.filter(c => ["TSM", "MU", "AMZN"].includes(c.symbol)) },
];

/** Company page and map links, or null when the company is not yet in the YouAnalyst directory. */
export function companyLinks(id: string, prefix: string, relationship?: string | null) {
  if (!/^(US:[A-Z.]{1,6}|ORG:[A-Z0-9-]+)$/.test(id)) return null;
  const map = new URLSearchParams({ company: id });
  if (relationship) map.set("relationship", relationship);
  return { page: `${prefix}${companyPageUrl(id.startsWith("US:") ? id.slice(3) : id)}`, map: `${prefix}?${map}` };
}
