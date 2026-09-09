// Research topics, not official company-level GICS assignments.
// Reference: MSCI GICS methodology, April 2026, section 1.2.
export const TAXONOMY_VERSION = "gics-2026-04";
export const TAXONOMY_SOURCE = "https://www.msci.com/indexes/index-resources/gics";
export const RESEARCH_SECTORS = [
  { code: "10", name: "Energy", industries: [
    ["101010", "Energy Equipment & Services"], ["101020", "Oil, Gas & Consumable Fuels"],
  ] },
  { code: "15", name: "Materials", industries: [
    ["151010", "Chemicals"], ["151020", "Construction Materials"], ["151030", "Containers & Packaging"],
    ["151040", "Metals & Mining"], ["151050", "Paper & Forest Products"],
  ] },
  { code: "20", name: "Industrials", industries: [
    ["201010", "Aerospace & Defense"], ["201020", "Building Products"], ["201030", "Construction & Engineering"],
    ["201040", "Electrical Equipment"], ["201050", "Industrial Conglomerates"], ["201060", "Machinery"],
    ["201070", "Trading Companies & Distributors"], ["202010", "Commercial Services & Supplies"],
    ["202020", "Professional Services"], ["203010", "Air Freight & Logistics"], ["203020", "Passenger Airlines"],
    ["203030", "Marine Transportation"], ["203040", "Ground Transportation"], ["203050", "Transportation Infrastructure"],
  ] },
  { code: "25", name: "Consumer Discretionary", industries: [
    ["251010", "Automobile Components"], ["251020", "Automobiles"], ["252010", "Household Durables"],
    ["252020", "Leisure Products"], ["252030", "Textiles, Apparel & Luxury Goods"],
    ["253010", "Hotels, Restaurants & Leisure"], ["253020", "Diversified Consumer Services"],
    ["255010", "Distributors"], ["255030", "Broadline Retail"], ["255040", "Specialty Retail"],
  ] },
  { code: "30", name: "Consumer Staples", industries: [
    ["301010", "Consumer Staples Distribution & Retail"], ["302010", "Beverages"], ["302020", "Food Products"],
    ["302030", "Tobacco"], ["303010", "Household Products"], ["303020", "Personal Care Products"],
  ] },
  { code: "35", name: "Health Care", industries: [
    ["351010", "Health Care Equipment & Supplies"], ["351020", "Health Care Providers & Services"],
    ["351030", "Health Care Technology"], ["352010", "Biotechnology"], ["352020", "Pharmaceuticals"],
    ["352030", "Life Sciences Tools & Services"],
  ] },
  { code: "40", name: "Financials", industries: [
    ["401010", "Banks"], ["402010", "Financial Services"], ["402020", "Consumer Finance"],
    ["402030", "Capital Markets"], ["402040", "Mortgage Real Estate Investment Trusts (REITs)"], ["403010", "Insurance"],
  ] },
  { code: "45", name: "Information Technology", industries: [
    ["451020", "IT Services"], ["451030", "Software"], ["452010", "Communications Equipment"],
    ["452020", "Technology Hardware, Storage & Peripherals"], ["452030", "Electronic Equipment, Instruments & Components"],
    ["453010", "Semiconductors & Semiconductor Equipment"],
  ] },
  { code: "50", name: "Communication Services", industries: [
    ["501010", "Diversified Telecommunication Services"], ["501020", "Wireless Telecommunication Services"],
    ["502010", "Media"], ["502020", "Entertainment"], ["502030", "Interactive Media & Services"],
  ] },
  { code: "55", name: "Utilities", industries: [
    ["551010", "Electric Utilities"], ["551020", "Gas Utilities"], ["551030", "Multi-Utilities"],
    ["551040", "Water Utilities"], ["551050", "Independent Power and Renewable Electricity Producers"],
  ] },
  { code: "60", name: "Real Estate", industries: [
    ["601010", "Diversified REITs"], ["601025", "Industrial REITs"], ["601030", "Hotel & Resort REITs"],
    ["601040", "Office REITs"], ["601050", "Health Care REITs"], ["601060", "Residential REITs"],
    ["601070", "Retail REITs"], ["601080", "Specialized REITs"], ["602010", "Real Estate Management & Development"],
  ] },
] as const;

export type ResearchTopic = {
  taxonomy: string; sectorCode: string | null; sectorName: string | null;
  industryCode: string | null; industryName: string | null; scope: string;
};

export function resolveResearchTopic(scope: string, category?: unknown): ResearchTopic {
  if (typeof scope !== "string" || scope.length > 120 || /[\u0000-\u001f]/.test(scope)) throw new Error("Research scope must be at most 120 characters.");
  scope = scope.trim();
  if (category === undefined || category === null) {
    if (scope.length < 3) throw new Error("Enter a custom research topic (3-120 characters).");
    return { taxonomy: "custom", sectorCode: null, sectorName: null, industryCode: null, industryName: null, scope };
  }
  if (typeof category !== "object" || Array.isArray(category)) throw new Error("Invalid research category.");
  const value = category as Record<string, unknown>;
  const sector = RESEARCH_SECTORS.find(s => s.code === value.sectorCode);
  const industry = sector?.industries.find(i => i[0] === value.industryCode);
  if (!sector || !industry) throw new Error("Select an industry within its sector.");
  return { taxonomy: TAXONOMY_VERSION, sectorCode: sector.code, sectorName: sector.name,
    industryCode: industry[0], industryName: industry[1], scope };
}

export function researchTopicLabel(topic: ResearchTopic) {
  return [topic.industryName, topic.scope].filter(Boolean).join(": ");
}
