import type { BusinessEvent } from "./business-events";

// Editorially reviewed primary-source events. Dates describe the announcement,
// not completion of the plans. No relationship is inferred from co-mentions.
export const curatedEvents: BusinessEvent[] = [
  {
    id: "coreweave-meta-order-20260409", category: "ORDER", companyIds: ["US:CRWV", "US:META"], relationshipId: "US:CRWV__SUPPLIER_OF__US:META",
    eventDate: "2026-04-09", sourceDate: "2026-04-09", collectedAt: "2026-09-16", planned: true,
    title: "CoreWeave announces expanded $21 billion Meta agreement", titleZh: "CoreWeave 宣布与 Meta 扩大约 210 亿美元协议",
    summary: "The announcement describes an agreement to provide AI cloud capacity through December 2032. Contract value is not recognized revenue, and planned capacity does not establish completed delivery.",
    summaryZh: "公告披露向 Meta 提供 AI 云算力的扩展协议，服务期限至 2032 年 12 月。合同金额不等于已确认营收，计划提供的算力不代表已完成交付。",
    sourceTitle: "CoreWeave · Meta infrastructure agreement",
    sourceUrl: "https://investors.coreweave.com/news/news-details/2026/CoreWeave-and-Meta-Announce-21-Billion-Expanded-AI-Infrastructure-Agreement/default.aspx",
  },
  {
    id: "amd-cisco-humain-live-20260831", category: "PRODUCT", companyIds: ["US:AMD", "US:CSCO"], relationshipId: "US:AMD__PARTNER_OF__US:CSCO",
    eventDate: "2026-08-31", sourceDate: "2026-08-31", collectedAt: "2026-09-16", planned: false,
    title: "AMD and Cisco report HUMAIN systems are live", titleZh: "AMD 与思科宣布 HUMAIN 系统已上线",
    summary: "The companies announced live MI355X and EPYC infrastructure using Cisco networking in Saudi Arabia. A separate 250 MW expansion is planned to begin in 2027; it is not delivered capacity.",
    summaryZh: "公告称，采用 MI355X、EPYC 和思科网络的沙特基础设施已上线。另有计划从 2027 年开始部署的 250 MW 扩建，不能计作已交付产能。",
    sourceTitle: "AMD · HUMAIN production deployment",
    sourceUrl: "https://ir.amd.com/news-events/press-releases/detail/1298/amd-cisco-and-humain-expand-saudi-arabias-ai-infrastructure-as-amd-instinct-systems-go-live",
  },
  {
    id: "coreweave-rubin-validation-20260811", category: "PRODUCT", companyIds: ["US:CRWV", "US:NVDA"],
    eventDate: null, sourceDate: "2026-08-11", collectedAt: "2026-09-16", planned: false,
    title: "CoreWeave reports Rubin NVL72 validation", titleZh: "CoreWeave 披露 Rubin NVL72 验证进展",
    summary: "Its second-quarter release reports bring-up and validation of NVIDIA Vera Rubin NVL72. The release does not specify the milestone date or establish broad commercial availability.",
    summaryZh: "二季度公告披露已完成 NVIDIA Vera Rubin NVL72 的启动与验证。资料未明确这一进展的发生日期，也不等同于已全面商业交付。",
    sourceTitle: "CoreWeave · Q2 2026 results",
    sourceUrl: "https://investors.coreweave.com/news/news-details/2026/CoreWeave-Reports-Strong-Second-Quarter-2026-Results/default.aspx",
  },
  {
    id: "amd-anthropic-mi450-20260722", category: "PARTNERSHIP", companyIds: ["US:AMD", "ORG:ANTHROPIC"],
    eventDate: "2026-07-22", sourceDate: "2026-07-22", collectedAt: "2026-09-16", planned: true,
    title: "AMD and Anthropic announce MI450 partnership", titleZh: "AMD 与 Anthropic 宣布 MI450 合作计划",
    summary: "The companies announced a strategic partnership to deploy up to 2 GW of MI450-series GPUs. This is an announced deployment plan, not confirmation of completed deliveries.",
    summaryZh: "双方宣布战略合作，计划部署最高 2 GW 的 MI450 系列 GPU。这是部署计划，不代表已经完成交付。",
    sourceTitle: "AMD · Anthropic strategic partnership",
    sourceUrl: "https://ir.amd.com/news-events/press-releases/detail/1292/amd-and-anthropic-announce-strategic-partnership-to-deploy-up-to-2-gigawatts-of-amd-instinct-mi450-series-gpus",
  },
  {
    id: "tsmc-us-expansion-20250304", category: "CAPACITY", companyIds: ["US:TSM"],
    eventDate: "2025-03-04", sourceDate: "2025-03-04", collectedAt: "2026-09-16", planned: true,
    title: "TSMC announced an additional US expansion plan", titleZh: "台积电宣布追加美国扩建计划",
    summary: "TSMC announced plans for an additional $100 billion of US investment, including three fabs and two advanced packaging facilities. This historical announcement does not establish current completion or customer-specific capacity allocation.",
    summaryZh: "台积电宣布计划追加 1,000 亿美元美国投资，包括三座晶圆厂和两座先进封装设施。这是历史公告，不能据此认定目前已完工或已为特定客户分配产能。",
    sourceTitle: "TSMC · US investment announcement",
    sourceUrl: "https://pr.tsmc.com/schinese/news/3210",
  },
];
