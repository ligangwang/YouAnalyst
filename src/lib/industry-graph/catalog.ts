// Editorial starting points, not asserted business relationships or company master IDs.
export const INDUSTRY_SEGMENTS = [
  { id: "manufacturing", label: "Manufacturing", color: "#a78bfa" },
  { id: "compute", label: "Compute", color: "#38bdf8" },
  { id: "memory", label: "Memory & storage", color: "#2dd4bf" },
  { id: "networking", label: "Networking", color: "#fbbf24" },
  { id: "cloud", label: "Cloud & platforms", color: "#fb923c" },
  { id: "infrastructure", label: "Power & infrastructure", color: "#f472b6" },
  { id: "devices", label: "Devices & edge AI", color: "#a3e635" },
  { id: "other", label: "Related companies", color: "#94a3b8" },
] as const;
export type IndustrySegment = (typeof INDUSTRY_SEGMENTS)[number]["id"];
export const INDUSTRY_STARTERS: { ticker: string; name: string; segment: IndustrySegment; aliases?: string[]; filingForm?: "20-F"; expectedCik?: string }[] = [
  { ticker: "TSM", name: "TSMC", segment: "manufacturing", filingForm: "20-F", aliases: ["Taiwan Semiconductor Manufacturing", "Taiwan Semiconductor Manufacturing Company", "Taiwan Semiconductor Manufacturing Company Limited", "Taiwan Semiconductor Manufacturing Co Ltd"] },
  { ticker: "AMAT", name: "Applied Materials", segment: "manufacturing" },
  { ticker: "LRCX", name: "Lam Research", segment: "manufacturing" },
  { ticker: "INTC", name: "Intel", segment: "compute" },
  { ticker: "NVDA", name: "NVIDIA", segment: "compute" },
  { ticker: "AMD", name: "AMD", segment: "compute", aliases: ["Advanced Micro Devices"] },
  { ticker: "MU", name: "Micron", segment: "memory", aliases: ["Micron Technology", "Micron Technology Inc"] },
  // The post-2025 standalone company, not the legacy issuer that also traded as SNDK.
  { ticker: "SNDK", name: "Sandisk", segment: "memory", aliases: ["Sandisk Corporation"], expectedCik: "0002023554" },
  { ticker: "WDC", name: "Western Digital", segment: "memory" },
  { ticker: "AVGO", name: "Broadcom", segment: "networking" },
  { ticker: "ANET", name: "Arista Networks", segment: "networking" },
  { ticker: "MSFT", name: "Microsoft", segment: "cloud" },
  { ticker: "AMZN", name: "Amazon", segment: "cloud" },
  { ticker: "GOOGL", name: "Alphabet", segment: "cloud" },
  { ticker: "META", name: "Meta", segment: "cloud" },
  { ticker: "VRT", name: "Vertiv", segment: "infrastructure" },
  { ticker: "EQIX", name: "Equinix", segment: "infrastructure" },
  { ticker: "CEG", name: "Constellation Energy", segment: "infrastructure" },
  { ticker: "AAPL", name: "Apple", segment: "devices" },
  { ticker: "QCOM", name: "Qualcomm", segment: "devices" },
];
