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
export const INDUSTRY_STARTERS: { ticker: string; name: string; segment: IndustrySegment; aliases?: string[] }[] = [
  { ticker: "AMAT", name: "Applied Materials", segment: "manufacturing" },
  { ticker: "LRCX", name: "Lam Research", segment: "manufacturing" },
  { ticker: "INTC", name: "Intel", segment: "manufacturing" },
  { ticker: "NVDA", name: "NVIDIA", segment: "compute" },
  { ticker: "AMD", name: "AMD", segment: "compute", aliases: ["Advanced Micro Devices"] },
  { ticker: "MU", name: "Micron", segment: "memory", aliases: ["Micron Technology", "Micron Technology Inc"] },
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
