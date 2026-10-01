import { bi, type Bilingual } from "./amd-ecosystem";

export const RESEARCH_REVIEWED = "2026-10-01";
export const topicSources = {
  vertivBlueprint: { title: "Vertiv · GB200 NVL72 power and cooling reference architecture", published: "2024-10-15", url: "https://investors.vertiv.com/news/news-details/2024/Vertiv-Codevelops-with-NVIDIA-Complete-Power-and-Cooling-Blueprint-for-NVIDIA-GB200-NVL72-Platform/default.aspx" },
  schneiderCooling: { title: "Schneider Electric · GB300 power and liquid cooling designs", published: "2025-09-18", url: "https://www.se.com/ww/en/about-us/newsroom/news/press-releases/schneider-electric-announces-new-reference-designs-featuring-integrated-power-management-and-liquid-cooling-controls-supporting-nvidia-mission-control-and-nvidia-gb300-nvl72-68ca8fdd5e6c6f9d3a096133/" },
  micronHbm4: { title: "Micron · HBM4 volume production for Vera Rubin", published: "2026-03-16", url: "https://investors.micron.com/news/press-release/2026/Micron-in-High-Volume-Production-of-HBM4-Designed-for-NVIDIA-Vera-Rubin-PCIe-Gen6-SSD-and-SOCAMM2-03-16-2026/default.aspx" },
  samsungHbm4: { title: "Samsung · HBM4 at NVIDIA GTC 2026", published: "2026-03-17", url: "https://news.samsung.com/global/samsung-unveils-hbm4e-showcasing-comprehensive-ai-solutions-nvidia-partnership-and-vision-at-nvidia-gtc-2026" },
  samsungHbm4e: { title: "Samsung · HBM4E sample shipments", published: "2026-06-01", url: "https://news.samsung.com/uk/samsung-begins-shipment-of-industry-first-hbm4e-samples" },
  hynixPartnership: { title: "NVIDIA · SK hynix memory technology partnership", published: "2026-06-07", url: "https://nvidianews.nvidia.com/news/sk-hynix-ai-factory" },
  nvidia10k: { title: "NVIDIA · FY2026 Form 10-K", published: "2026-02-25", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm" },
} as const;
export type TopicSource = keyof typeof topicSources;
export type ResearchTopic = {
  slug: string; title: Bilingual; summary: Bilingual; framing: Bilingual;
  diagramTitle: Bilingual; diagramNote: Bilingual;
  steps: { title: Bilingual; detail: Bilingual }[];
  evidence: { id: string; title: Bilingual; status: Bilingual; finding: Bilingual; limit: Bilingual; next: Bilingual; source: TopicSource; companyId?: string; ticker?: string }[];
  nextSteps: Bilingual[];
};

export const infrastructureTopics: ResearchTopic[] = [
  {
    slug: "ai-infrastructure-bottlenecks",
    title: bi("AI infrastructure bottlenecks: follow memory, packaging and cooling", "AI 基础设施瓶颈：追踪内存、封装与散热"),
    summary: bi("Where could an AI deployment get delayed? Trace documented manufacturing and cooling dependencies, then ask what capacity is actually ready.", "AI 部署可能在哪些环节延迟？先核对制造与散热依赖，再追问哪些产能真正可用。"),
    framing: bi("These are dependencies to investigate, not a ranking of current shortages. Reference designs describe how a site can be built; they do not show a site's operating capacity, signed orders or supplier revenue.", "本页列出待研究的依赖环节，并非当前短缺程度排名。参考设计说明建设方法，不证明某个站点的运营产能、已签订单或供应商营收。"),
    diagramTitle: bi("From components to an operating site", "从组件到投入运行的站点"),
    diagramNote: bi("Conceptual deployment dependencies. Arrows do not assert supplier contracts or measured capacity constraints.", "部署依赖示意；箭头不代表供应合同或已测定的产能瓶颈。"),
    steps: [
      { title: bi("1. Wafers + packaging", "1. 晶圆与封装"), detail: bi("Check foundry disclosure and qualified packaging capacity", "核查代工披露与合格封装产能") },
      { title: bi("2. Memory + systems", "2. 内存与系统"), detail: bi("Separate component shipments from completed racks", "区分组件出货与完整机架交付") },
      { title: bi("3. Power + cooling", "3. 供电与散热"), detail: bi("Verify site readiness and commissioning", "核实站点就绪与调试投运") },
    ],
    evidence: [
      { id: "packaging", title: bi("NVIDIA / TSMC: manufacturing dependency", "英伟达／台积电：制造依赖"), status: bi("Annual-report disclosure", "年报披露"), finding: bi("NVIDIA names TSMC and Samsung as wafer foundries and discloses use of CoWoS packaging technology.", "英伟达将台积电与三星列为晶圆代工厂，并披露使用 CoWoS 封装技术。"), limit: bi("The filing does not allocate CoWoS volumes or establish a current shortage at a particular supplier.", "年报未分配 CoWoS 产量，也未证明某家供应商当前短缺。"), next: bi("Look for later capacity, qualification and delivery disclosures for the relevant product.", "继续核查相关产品后续的产能、认证与交付披露。"), source: "nvidia10k", companyId: "US:TSM", ticker: "TSM" },
      { id: "memory", title: bi("Micron: HBM4 reaches volume shipments", "美光：HBM4 进入批量出货"), status: bi("Shipment reported", "已披露出货"), finding: bi("Micron reported Q1 2026 volume shipments of 36GB 12-high HBM4 designed for NVIDIA Vera Rubin.", "美光披露面向英伟达 Vera Rubin 的 36GB 12 层 HBM4 于 2026 年第一季度开始批量出货。"), limit: bi("Component shipments do not establish complete-system availability or NVIDIA purchase shares.", "组件出货不能证明完整系统已可用，也未披露英伟达采购份额。"), next: bi("Compare memory shipment evidence with the system builder's delivery and operator's deployment evidence.", "将内存出货证据与系统厂商交付、运营方部署证据相互核对。"), source: "micronHbm4", companyId: "US:MU", ticker: "MU" },
      { id: "vertiv-cooling", title: bi("Vertiv: GB200 cooling and power blueprint", "维谛：GB200 散热与供电方案"), status: bi("Reference design", "参考设计"), finding: bi("Vertiv and NVIDIA released a 7MW GB200 NVL72 reference architecture, combining liquid and air cooling for racks up to 132kW.", "维谛与英伟达发布 7MW GB200 NVL72 参考架构，为最高 132kW 机架结合液冷与风冷。"), limit: bi("7MW describes the design, not installed customer capacity. It is not evidence of a purchase order.", "7MW 是设计规模，并非客户已安装产能；也不能作为采购订单证据。"), next: bi("Check the operator's named site, power availability, cooling installation and commissioning milestones.", "核查运营方具体站点、可用供电、散热安装与调试里程碑。"), source: "vertivBlueprint", companyId: "US:VRT", ticker: "VRT" },
      { id: "schneider-cooling", title: bi("Schneider Electric: power and liquid-cooling controls", "施耐德电气：供电与液冷控制"), status: bi("Reference designs announced", "已宣布参考设计"), finding: bi("Schneider and NVIDIA described GB300 NVL72 infrastructure and controls designs, including Motivair cooling technology and a design for up to 142kW per rack.", "施耐德与英伟达披露 GB300 NVL72 基础设施及控制设计，包含 Motivair 散热技术，设计支持最高 142kW 每机架。"), limit: bi("A reference design is not a completed deployment or a disclosed NVIDIA supply contract.", "参考设计不等于部署完成，也不等于已披露英伟达供应合同。"), next: bi("Seek a specific customer deployment announcement before assigning installed capacity or revenue to this design.", "在认定已安装产能或相关营收前，查找具体客户部署公告。"), source: "schneiderCooling" },
    ],
    nextSteps: [bi("Follow the companies you are researching, then read source-dated updates instead of treating collection dates as new events.", "关注正在研究的公司，并查看带来源日期的更新，避免把收录日期视为新事件。"), bi("Record what is still unknown: committed power, qualified memory, packaging availability, delivery dates and site commissioning.", "记录仍未知的事项：落实的供电、通过认证的内存、封装可用性、交付日期与站点投运。")],
  },
  {
    slug: "hbm-supply",
    title: bi("HBM suppliers: production, samples and plans", "HBM 供应商：量产、样品与计划"),
    summary: bi("Compare what Micron, Samsung and SK hynix sources actually establish about AI memory. Keep HBM4 production separate from HBM4E sampling and future partnerships.", "比较美光、三星与 SK 海力士的原始资料，区分 HBM4 量产、HBM4E 送样及未来合作。"),
    framing: bi("This is a dated evidence comparison, not a live capacity dashboard or market-share estimate. A supplier's production statement does not by itself establish a customer's qualification, purchase volume or completed system deployment.", "这是按来源日期整理的证据对照，不是实时产能看板或市占率估计。供应商量产声明本身不证明客户认证、采购量或完整系统部署。"),
    diagramTitle: bi("Read the milestone before comparing suppliers", "比较供应商前，先看里程碑性质"),
    diagramNote: bi("Different products can be at different milestones at the same company. A later generation's samples are not volume shipments.", "同一公司的不同产品可处于不同阶段；下一代样品不是批量出货。"),
    steps: [
      { title: bi("Samples", "样品"), detail: bi("Samsung HBM4E: sample shipments reported in June 2026", "三星 HBM4E：2026 年 6 月披露送样") },
      { title: bi("Volume production", "量产"), detail: bi("Micron and Samsung HBM4: reported in March 2026", "美光与三星 HBM4：2026 年 3 月披露量产") },
      { title: bi("Customer deployment", "客户部署"), detail: bi("Requires separate system and operator evidence", "需另核查系统与运营方证据") },
    ],
    evidence: [
      { id: "micron-hbm4", title: bi("Micron HBM4 for Vera Rubin", "美光面向 Vera Rubin 的 HBM4"), status: bi("Volume shipments reported", "已披露批量出货"), finding: bi("Micron said volume shipments of its 36GB 12-high HBM4 began in the first calendar quarter of 2026.", "美光称其 36GB 12 层 HBM4 于 2026 年第一季度开始批量出货。"), limit: bi("No NVIDIA purchase share or exclusive supply arrangement is established by this release.", "该公告未证明在英伟达采购中的份额或独家供应安排。"), next: bi("Check subsequent product shipments and customer deployment reports, keeping the HBM generation explicit.", "核查后续产品出货与客户部署披露，并明确 HBM 代际。"), source: "micronHbm4", companyId: "US:MU", ticker: "MU" },
      { id: "samsung-hbm4", title: bi("Samsung HBM4 for Vera Rubin", "三星面向 Vera Rubin 的 HBM4"), status: bi("Mass production reported", "已披露量产"), finding: bi("Samsung's March 17 GTC release describes HBM4 in mass production and designed for NVIDIA Vera Rubin.", "三星 3 月 17 日 GTC 公告称 HBM4 已量产，并面向英伟达 Vera Rubin 设计。"), limit: bi("This does not disclose NVIDIA's purchases or qualification details for every product.", "这未披露英伟达采购量或各款产品的具体认证状态。"), next: bi("Separate product production evidence from customer-specific procurement evidence.", "将产品量产证据与特定客户采购证据分开。"), source: "samsungHbm4", companyId: "ORG:SAMSUNG-ELECTRONICS" },
      { id: "samsung-hbm4e", title: bi("Samsung HBM4E is a separate milestone", "三星 HBM4E 属于另一里程碑"), status: bi("Sample shipments; production planned", "已送样；量产仍为计划"), finding: bi("Samsung's June 1 UK release reports 12-layer HBM4E samples shipped to customers, with mass production planned around customer schedules.", "三星英国 6 月 1 日公告披露已向客户提供 12 层 HBM4E 样品，并计划依客户进度安排量产。"), limit: bi("The cited release is sample evidence, not proof of HBM4E volume production or a named customer's deployment.", "所引公告证明送样，不证明 HBM4E 已批量生产或某个具名客户已部署。"), next: bi("Look for a later, explicit volume-production or customer-acceptance disclosure.", "继续查找后续明确的量产或客户验收披露。"), source: "samsungHbm4e", companyId: "ORG:SAMSUNG-ELECTRONICS" },
      { id: "hynix-partnership", title: bi("SK hynix: memory technology partnership", "SK 海力士：内存技术合作"), status: bi("Multiyear partnership announced", "已宣布多年合作"), finding: bi("NVIDIA and SK hynix announced memory codevelopment across Vera Rubin and other platforms.", "英伟达与 SK 海力士宣布围绕 Vera Rubin 及其他平台共同开发内存。"), limit: bi("The partnership does not disclose generation-by-generation shipment volumes, contract value or supplier rankings.", "合作公告未披露逐代出货量、合同金额或供应商排名。"), next: bi("Read the annual-report supplier disclosure alongside product-specific shipment evidence.", "结合年报供应商披露与具体产品的出货证据研究。"), source: "hynixPartnership", companyId: "US:SKHY", ticker: "SKHY" },
    ],
    nextSteps: [bi("Use NVIDIA's ecosystem research to connect memory evidence to systems, foundries and cloud operators.", "通过英伟达生态专题，把内存证据与系统、代工及云运营商连接起来。"), bi("Do not infer vendor market share from the order of names in a filing, a design win or a sample announcement.", "不要根据年报名称顺序、设计导入或送样公告推断供应商市占率。")],
  },
];
