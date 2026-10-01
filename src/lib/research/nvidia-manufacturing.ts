import type { GraphFact, GraphSource } from "../knowledge-graph/model";
import type { MarketCompany } from "../knowledge-graph/market-store";

// A bounded, source-controlled editorial snapshot, not a directory sync or live supply feed.
export const NVIDIA_MANUFACTURING_REVIEWED = "2026-10-01";
export const NVIDIA_MANUFACTURING_SOURCE: GraphSource = {
  id: "editorial:nvidia-manufacturing:fy2026-10k",
  title: "NVIDIA FY2026 Form 10-K · Manufacturing",
  url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm",
  sourceDate: "2026-02-25",
};

const identitySources: Record<string, GraphSource> = {
  "US:SKHY": {
    id: "editorial:nvidia-manufacturing:skhynix-listing",
    title: "SK hynix · KRX disclosure of Nasdaq listing",
    url: "https://kind.krx.co.kr/external/2026/07/13/000494/20260713001138/11315.htm",
    sourceDate: "2026-07-13",
  },
  "ORG:SAMSUNG-ELECTRONICS": {
    id: "editorial:nvidia-manufacturing:samsung-listing",
    title: "Samsung Electronics · Listing information",
    url: "https://www.samsung.com/global/ir/stock-information/listing-Info/",
    sourceDate: null,
  },
};

export const NVIDIA_EDITORIAL_COMPANIES: MarketCompany[] = [
  {
    id: "US:SKHY", name: "SK hynix", names: { en: "SK hynix", "zh-CN": "SK 海力士" },
    legalName: "SK hynix Inc.", symbol: "SKHY", country: "KR", listingStatus: "PUBLIC", status: "DIRECTORY",
    listings: [{ market: "US", exchange: "XNAS", symbol: "SKHY" }, { market: "KR", exchange: "XKRX", symbol: "000660" }],
    description: "Korean memory manufacturer named as a memory supplier in NVIDIA's FY2026 Form 10-K. The filing does not identify HBM generations or purchase shares.",
  },
  {
    id: "ORG:SAMSUNG-ELECTRONICS", name: "Samsung Electronics", names: { en: "Samsung Electronics", "zh-CN": "三星电子" },
    legalName: "Samsung Electronics Co., Ltd.", symbol: "", country: "KR", listingStatus: "PUBLIC", status: "DIRECTORY",
    listings: [{ market: "KR", exchange: "XKRX", symbol: "005930" }],
    description: "Korean electronics and semiconductor manufacturer named as a wafer foundry and memory supplier in NVIDIA's FY2026 Form 10-K. General memory supply does not establish qualification for a particular HBM product.",
  },
].map(company => ({
  ...company, editorialReviewedAt: NVIDIA_MANUFACTURING_REVIEWED,
  inGraph: {
    status: "PUBLISHED", stageIds: ["memory"], order: 1000, asOf: NVIDIA_MANUFACTURING_REVIEWED,
    stages: [{ id: "stage:memory", kind: "STAGE", order: 4, labels: { en: "Memory", "zh-CN": "内存" } }],
    memberships: [], sources: [identitySources[company.id], NVIDIA_MANUFACTURING_SOURCE],
  },
}));

/** Only an explicitly absent document may use the editorial identity. An existing hidden/invalid row wins. */
export function nvidiaEditorialCompany(id: string, remote: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return remote !== undefined ? remote : NVIDIA_EDITORIAL_COMPANIES.find(company => company.id === id);
}

export const NVIDIA_MANUFACTURING_FACTS: { source: string; fact: GraphFact }[] = [
  {
    source: "US:TSM",
    fact: {
      state: "DOCUMENTED",
      scope: "NVIDIA's FY2026 Form 10-K names TSMC as a semiconductor wafer foundry. Separately, the filing discloses NVIDIA's use of CoWoS technology for semiconductor packaging.",
      limitation: "The filing does not allocate CoWoS work among suppliers or disclose wafer volumes, packaging capacity shares, exclusivity or contract terms.",
      sourceIds: [NVIDIA_MANUFACTURING_SOURCE.id],
    },
  },
  ...["US:MU", "US:SKHY", "ORG:SAMSUNG-ELECTRONICS"].map(source => ({
    source,
    fact: {
      state: "DOCUMENTED",
      scope: source === "ORG:SAMSUNG-ELECTRONICS"
        ? "NVIDIA's FY2026 Form 10-K names Samsung as a semiconductor wafer foundry and memory supplier."
        : `NVIDIA's FY2026 Form 10-K names ${source === "US:MU" ? "Micron" : "SK hynix"} as a memory supplier.`,
      limitation: "The filing does not identify HBM generations, qualification of a specific product, volumes, supplier shares or exclusivity. Product production and future partnership announcements are separate evidence.",
      sourceIds: [NVIDIA_MANUFACTURING_SOURCE.id],
    },
  })),
].map(({ source, fact }) => ({ source, fact: {
  ...fact, id: `editorial:nvidia-manufacturing:${source}`, reviewedAt: NVIDIA_MANUFACTURING_REVIEWED,
  verificationStatus: "CONFIRMED", editorialReviewedAt: NVIDIA_MANUFACTURING_REVIEWED,
} }));
