import type { IndustryCompany } from "../../src/lib/industry-graph/catalog";

// One-time editorial metadata migration. Runtime classifications remain in Firestore.
export const MAP_ROLE_CORRECTIONS: Array<IndustryCompany & { sourceUrl: string }> = [
  { ticker: "AI", name: "C3.ai", segment: "applications", sourceUrl: "https://c3.ai/company" },
  { ticker: "TEM", name: "Tempus AI", segment: "applications", sourceUrl: "https://www.tempus.com/about-us/" },
  { ticker: "HIMS", name: "Hims & Hers Health", segment: "healthcare", sourceUrl: "https://www.hims.com/about/the-company" },
  { ticker: "LLY", name: "Eli Lilly", segment: "healthcare", sourceUrl: "https://www.lilly.com/about" },
];

export function roleCorrectionPatch(prior: Record<string, unknown> | undefined, company: typeof MAP_ROLE_CORRECTIONS[number]) {
  if (prior?.roleMigration === "applications-healthcare-v1" || (prior?.segment && prior.segment !== "other")) return null;
  return { ...(prior ? {} : { ticker: company.ticker, name: company.name, featured: false }),
    segment: company.segment, roleSourceUrl: company.sourceUrl, roleMigration: "applications-healthcare-v1" };
}
