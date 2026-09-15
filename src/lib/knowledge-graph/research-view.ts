import { companyName, type GraphEdge, type GraphNode, type KnowledgeGraph } from "./model";
import { companyPageUrl } from "../market-companies/routes";
import { companySector } from "./sectors";

export function researchCompanyUrl(node: Pick<GraphNode, "id"> & Partial<Pick<GraphNode, "market">>) {
  const market = node.market ?? (/^(XSHG|XSHE):/.test(node.id) ? "CN_A" : node.id.startsWith("ORG:") ? "GLOBAL" : "US");
  return companyPageUrl(node.id.startsWith("US:") ? node.id.slice(3) : node.id, market);
}
export const relationAnchor = (id: string) => `relationship-${Array.from(id).map(c => c.charCodeAt(0).toString(16)).join("-")}`;
const roles: Record<string, [string, string]> = {
  compute: ["Designs or supplies processors and accelerators for AI computing.", "设计或提供 AI 计算所需的处理器与加速器。"],
  manufacturing: ["Provides semiconductor manufacturing or the equipment used to make chips.", "提供半导体制造服务，或用于芯片制造的设备。"],
  packaging: ["Provides chip packaging and testing for semiconductor systems.", "为半导体系统提供芯片封装与测试。"],
  memory: ["Provides memory, storage or data infrastructure for AI workloads.", "为 AI 工作负载提供内存、存储或数据基础设施。"],
  cloud: ["Operates cloud, computing or platform services used in the AI ecosystem.", "在 AI 产业中提供云计算、算力或平台服务。"],
  applications: ["Builds AI models, software or applications for end users and enterprises.", "面向个人和企业开发 AI 模型、软件或应用。"],
  edge: ["Brings computing, sensing or AI capabilities to devices at the edge.", "将计算、感知或 AI 能力带到终端设备。"],
};
export function companyRole(node: GraphNode, zh: boolean) {
  const stage = node.stageIds?.[0] ?? "";
  return roles[stage]?.[zh ? 1 : 0] ?? (zh ? `参与 AI 产业链的${companySector(node).zh}环节。` : `Participates in the ${companySector(node).en.toLowerCase()} part of the AI supply chain.`);
}
export function relationshipBusiness(edge: GraphEdge, zh: boolean) {
  const raw = edge.facts?.map(f => f.scope).join("; ") || edge.summary;
  // Extract only affirmative clauses. A limitation such as "not TPU supply"
  // must never become a product badge; the complete source scope stays visible.
  const scope = raw.split(/[;,\n。；，]|\.(?=\s)/)
    .map(clause => clause.split(/\b(?:without|rather\s+than|but\s+not|excluding)\b|但不|而非|而不是/i)[0])
    .filter(clause => !/\b(?:not|no|excluded|unconfirmed|unverified)\b|不包括|不涉及|不代表|不等于|并非|不是|未证实|未确认|不推断/i.test(clause)).join(" ");
  const products = [...new Set(scope.match(/\b(?:HBM[234]E?|SOCAMM2?|EPYC(?:\s+Turin)?|Instinct\s+MI\d+[A-Z]*|Instinct|MI\d+[A-Z]*|Helios|Blackwell(?:\s+Ultra)?|Vera\s+Rubin|CoWoS|Trainium[234]?|Graviton|TPUs?|GPUs?|CPUs?|x86|ROCm|Pensando|CXL(?:\s*[\d.]+)?|CUDA|NVLink|Claude|ChatGPT|Qianfan|YonBIP|Cortex\s+AI|Holoscan|Snapdragon(?:\s+X2)?|DRIVE(?:\s+AGX)?\s+Hyperion|Data\s+Stream|AI\s+Data\s+Engine|Xeon(?:\s+\d)?|GPUDirect|Paddle|AI\s+cloud|UPS|HBM4E)\b/gi) ?? [])];
  const business: [RegExp, string, string][] = [
    [/nuclear|power.purchase|PPA|Clinton|Crane|electricity/i, "Power supply", "电力供应"],
    [/liquid.cool|cooling|thermal/i, "Cooling and thermal management", "散热与温控"],
    [/data.center|datacenter|GPU.*capacity|compute.capacity/i, "Data-center / compute capacity", "数据中心／算力容量"],
    [/optical|optics|transceiver|photonics/i, "Optical interconnect", "光通信与互连"],
    [/packaging|assembly|testing.services/i, "Chip packaging and testing", "芯片封装与测试"],
    [/EDA|design.automation|design.tools|certification/i, "Design tools / technical qualification", "设计工具／技术认证"],
    [/wafer|foundry|fabrication/i, "Semiconductor manufacturing", "半导体制造"],
    [/gas|target.material|sputtering/i, "Semiconductor materials", "半导体材料"],
    [/lithography|High.NA|EUV/i, "Lithography equipment", "光刻设备"],
    [/memory|storage|SSD|DDR/i, "Memory and storage", "内存与存储"],
    [/network|switch|RDMA|Ethernet/i, "Networking", "网络互连"],
    [/cloud/i, "Cloud services", "云服务"],
  ];
  const category = business.find(([pattern]) => pattern.test(scope));
  if (category) products.push(category[zh ? 2 : 1]);
  return products.slice(0, 4).join(" / ") || (zh ? "相关产品或业务详见来源说明" : "See the source description for the specific product or business");
}
export function relationshipExplanation(edge: GraphEdge, graph: KnowledgeGraph, zh: boolean) {
  const name = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n ? companyName(n, zh ? "zh-CN" : "en") : id; };
  const a = name(edge.source), b = name(edge.target);
  const planned = edge.type === "PLANNED_ADOPTER_OF" || (edge.facts?.length ? edge.facts.every(f => f.state === "ANNOUNCED") : edge.commercialStatus === "ANNOUNCED");
  const labels: Record<string, [string, string]> = {
    SUPPLIER_OF: [planned ? `${a} has announced plans to supply ${b}.` : `${a} supplies ${b}.`, planned ? `${a}已宣布计划向${b}提供产品或服务。` : `${a}向${b}提供产品或服务。`],
    CUSTOMER_OF: [planned ? `${a} plans to buy products or services from ${b}.` : `${a} buys products or services from ${b}.`, planned ? `${a}计划从${b}采购产品或服务。` : `${a}从${b}采购产品或服务。`],
    INTEGRATES_TECHNOLOGY_FROM: [planned ? `${a} plans to integrate technology from ${b}.` : `${a} integrates technology from ${b}.`, planned ? `${a}计划在产品或服务中集成${b}的技术。` : `${a}的产品或服务集成了${b}的技术。`],
    PLANNED_ADOPTER_OF: [`${a} plans to adopt technology from ${b}.`, `${a}计划采用${b}的技术。`],
    PARTNER_OF: [planned ? `${a} and ${b} announced a collaboration plan.` : `${a} and ${b} collaborate on the business described in the sources.`, planned ? `${a}与${b}已宣布合作计划。` : `${a}与${b}在来源所述的业务上开展合作。`],
    ECOSYSTEM_PARTNER_OF: [planned ? `${a} and ${b} announced plans for ecosystem integration or collaboration.` : `${a} and ${b} have a documented ecosystem integration or collaboration.`, planned ? `${a}与${b}已宣布生态适配或合作计划。` : `${a}与${b}存在有来源记录的生态适配或合作。`],
  };
  return labels[edge.type]?.[zh ? 1 : 0] ?? (zh ? `${a}与${b}的关系见来源记录。` : `Sources document the relationship between ${a} and ${b}.`);
}
export function relationshipGroup(edge: GraphEdge, companyId: string): "suppliers" | "customers" | "partners" {
  if (edge.type === "SUPPLIER_OF") return edge.target === companyId ? "suppliers" : "customers";
  if (edge.type === "CUSTOMER_OF") return edge.source === companyId ? "suppliers" : "customers";
  return "partners";
}
