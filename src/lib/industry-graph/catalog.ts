// Industry layout taxonomy and directory record types.
export const INDUSTRY_SEGMENTS = [
  { id: "manufacturing", label: "Manufacturing", color: "#a78bfa" },
  { id: "compute", label: "Compute", color: "#38bdf8" },
  { id: "memory", label: "Memory & storage", color: "#2dd4bf" },
  { id: "networking", label: "Networking", color: "#fbbf24" },
  { id: "cloud", label: "Cloud & platforms", color: "#fb923c" },
  { id: "infrastructure", label: "Power & infrastructure", color: "#f472b6" },
  { id: "devices", label: "Devices & edge AI", color: "#a3e635" },
  { id: "applications", label: "AI applications", color: "#22c55e" },
  { id: "healthcare", label: "Healthcare & life sciences", color: "#fb7185" },
  { id: "other", label: "Related companies", color: "#94a3b8" },
] as const;
export type IndustrySegment = (typeof INDUSTRY_SEGMENTS)[number]["id"];
export type IndustryCompany = { ticker: string; name: string; segment: IndustrySegment; aliases?: string[]; filingForm?: "20-F"; expectedCik?: string };
