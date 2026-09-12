import type { GraphNode } from "./model";

// Color follows the first recorded industry stage, independent of market/filter order.
export const GRAPH_SECTORS = [
  { id: "semiconductors", color: "#c4a0ff", en: "Semiconductors", zh: "半导体制造", stages: ["materials", "equipment", "design", "foundry", "packaging"] },
  { id: "compute", color: "#65d9ff", en: "AI compute", zh: "AI 算力", stages: ["compute"] },
  { id: "memory", color: "#ffc57a", en: "Memory & storage", zh: "内存与存储", stages: ["memory"] },
  { id: "connectivity", color: "#67e6bc", en: "Connectivity", zh: "通信与互连", stages: ["interconnect", "optics", "boards", "networking"] },
  { id: "systems", color: "#8faaff", en: "Systems & devices", zh: "系统与终端", stages: ["servers", "edge"] },
  { id: "infrastructure", color: "#f4eb87", en: "Power & infrastructure", zh: "能源与基础设施", stages: ["power", "cooling", "energy", "datacenters"] },
  { id: "platforms", color: "#ff9eae", en: "Cloud & platforms", zh: "云与平台", stages: ["cloud"] },
  { id: "applications", color: "#e3a2ef", en: "AI applications", zh: "AI 应用", stages: ["applications"] },
];
export const OTHER_SECTOR = { id: "other", color: "#b6c3d2", en: "Other / unclassified", zh: "其他／待分类", stages: [] };
export function companySector(company: Pick<GraphNode, "stageIds">) {
  return GRAPH_SECTORS.find(sector => sector.stages.includes(company.stageIds?.[0] ?? "")) ?? OTHER_SECTOR;
}
