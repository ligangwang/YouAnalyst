// Editorial evidence snapshot. Review dates are not announcement or deployment dates.
export const REVIEWED = "2026-09-17";
export const RESEARCH_PATH = "/research/amd-ai-ecosystem";
export type Bilingual = { en: string; zh: string };
export const bi = (en: string, zh: string): Bilingual => ({ en, zh });
export const researchCompanies = [
  { symbol: "AMD", name: bi("AMD", "AMD"), role: bi("EPYC CPUs, Instinct GPUs and Helios rack architecture", "EPYC CPU、Instinct GPU 与 Helios 机架架构") },
  { symbol: "TSM", name: bi("TSMC", "台积电"), role: bi("Wafer manufacturing for AMD", "为 AMD 制造晶圆") },
  { symbol: "MU", name: bi("Micron", "美光科技"), role: bi("HBM3E memory designed into Instinct MI350", "HBM3E 内存集成于 Instinct MI350") },
  { symbol: "AMZN", name: bi("Amazon / AWS", "亚马逊 / AWS"), role: bi("Cloud instances using EPYC CPUs", "采用 EPYC CPU 的云实例") },
  { symbol: "DELL", name: bi("Dell", "戴尔"), role: bi("Servers integrating EPYC and Instinct", "集成 EPYC 与 Instinct 的服务器") },
  { symbol: "HPE", name: bi("HPE", "慧与"), role: bi("Announced Helios rack solution", "已宣布 Helios 机架方案") },
];
export const researchConnections = [
  { symbol: "TSM", product: "Manufacturing", kind: "supplier", id: "US:TSM__SUPPLIER_OF__US:AMD", label: bi("TSMC → AMD · Wafer supplier", "台积电 → AMD · 晶圆供应商"), status: bi("Disclosed in annual report", "年报披露"), summary: bi("AMD identifies TSMC as a wafer manufacturer for HPC, FPGA and adaptive SoC products.", "AMD 将台积电列为 HPC、FPGA 和自适应 SoC 产品的晶圆制造商。"), limit: bi("This establishes a manufacturing dependency, not a disclosed MI-series shipment volume or exclusive supply agreement.", "这证明制造依赖关系，并不代表已披露 MI 系列出货量或独家供货协议。"), date: "2026-02-04", source: "AMD 2025 Form 10-K", url: "https://ir.amd.com/financial-information/sec-filings/content/0000002488-26-000018/amd-20251227.htm" },
  { symbol: "MU", product: "Instinct", kind: "supplier", id: "US:MU__SUPPLIER_OF__US:AMD", label: bi("Micron → AMD · Memory integration", "美光 → AMD · 内存集成"), status: bi("Design integration documented", "已披露设计集成"), summary: bi("Micron identifies its 36GB 12-high HBM3E in AMD's Instinct MI350X platform.", "美光披露其 36GB 12 层 HBM3E 集成于 AMD Instinct MI350X 平台。"), limit: bi("The partner page does not establish supplier exclusivity, purchasing volume or a customer deployment date.", "合作页面未证明独家供应、采购量或客户部署日期。"), date: null, source: "Micron AMD partner page", url: "https://www.micron.com/partners/partner-networks/amd" },
  { symbol: "AMZN", product: "EPYC", kind: "integration", id: "US:AMZN__INTEGRATES_TECHNOLOGY_FROM__US:AMD", label: bi("AWS · EPYC cloud adoption", "AWS · EPYC 云端采用"), status: bi("Available at announcement", "公告时已可用"), summary: bi("AWS launched Hpc8a instances with fifth-generation EPYC processors in Ohio and Stockholm.", "AWS 在俄亥俄和斯德哥尔摩推出采用第五代 EPYC 处理器的 Hpc8a 实例。"), limit: bi("This is evidence of CPU adoption for high-performance computing. It does not establish AWS adoption of Instinct GPUs.", "这是高性能计算采用 CPU 的证据，不能据此认定 AWS 采用了 Instinct GPU。"), date: "2026-02-16", source: "AWS Hpc8a announcement", url: "https://aws.amazon.com/about-aws/whats-new/2026/02/announcing-amazon-ec2-hpc8a-instances/" },
  { symbol: "DELL", product: "Instinct", kind: "integration", id: "US:DELL__INTEGRATES_TECHNOLOGY_FROM__US:AMD", label: bi("Dell · EPYC + Instinct systems", "戴尔 · EPYC + Instinct 系统"), status: bi("Product specification", "产品规格"), summary: bi("Dell lists fifth-generation EPYC CPUs and eight Instinct MI355X accelerators for PowerEdge XE9785 configurations.", "戴尔 PowerEdge XE9785 配置列有第五代 EPYC CPU 和八颗 Instinct MI355X 加速器。"), limit: bi("A supported configuration confirms product integration; it does not reveal customer orders or delivered quantities.", "支持的配置证明产品集成，并未披露客户订单或交付数量。"), date: null, source: "Dell PowerEdge XE9785", url: "https://www.dell.com/en-us/shop/ipovw/poweredge-xe9785" },
  { symbol: "HPE", product: "Helios", kind: "planned", id: "US:HPE__PLANNED_ADOPTER_OF__US:AMD", label: bi("HPE · Helios rack plans", "慧与 · Helios 机架计划"), status: bi("Planned in cited announcement", "所引公告为计划"), summary: bi("HPE announced a Helios rack solution with scale-up Ethernet networking and planned worldwide availability in 2026.", "慧与宣布采用纵向扩展以太网的 Helios 机架方案，计划于 2026 年全球推出。"), limit: bi("This announcement alone does not confirm subsequent availability or deployments. The next checkpoint is a delivery or customer announcement.", "仅凭此公告不能确认后续上市或部署；下一验证节点是交付或客户公告。"), date: "2025-12-02", source: "HPE Helios announcement", url: "https://www.hpe.com/us/en/newsroom/press-release/2025/12/hpe-accelerates-ai-deployments-with-first-amd-helios-ai-rack-scale-architecture-with-open-scale-up-networking-built-with-broadcom.html" },
];
export function researchFilters(product?: string, kind?: string) {
  return { product: ["EPYC", "Instinct", "Helios", "Manufacturing"].includes(product ?? "") ? product! : "all", kind: ["supplier", "integration", "planned"].includes(kind ?? "") ? kind! : "all" };
}
export function selectedConnections(product: string, kind: string) {
  return researchConnections.filter(row => (product === "all" || row.product === product || (product === "EPYC" && row.symbol === "DELL")) && (kind === "all" || row.kind === kind));
}
