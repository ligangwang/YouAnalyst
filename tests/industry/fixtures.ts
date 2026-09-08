import { COMPANY_GRAPH_EXTRACTION_VERSION } from "../../src/lib/company-graph/types";
import { buildIndustryGraph as buildGraph } from "../../src/lib/industry-graph/model";
import { INDUSTRY_STARTERS } from "../../src/lib/industry-graph/catalog";
export const buildIndustryGraph = (runs: Record<string, unknown>) => buildGraph(runs, INDUSTRY_STARTERS);

// Synthetic quotations for local tests only. Never imported into production code.
export function runFixture(ticker: string, cik: string, name: string, targets: Array<Record<string, unknown>> = []) {
  const accession = `${cik}-26-000001`;
  return {
    status: "COMPLETED", extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, updatedAt: "2026-09-01T10:00:00Z",
    result: {
      ticker, cik, companyName: name, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, dryRun: false,
      filing: { accessionNumber: accession },
      edges: targets.map((target, index) => ({
        id: `${ticker}-edge-${index}`, sourceTicker: ticker, sourceCik: cik, accessionNumber: accession,
        filingDate: "2026-02-01", confidence: 0.9, targetType: "company", relationshipType: "SUPPLIER_OF",
        direction: "target_to_source", evidenceText: "Synthetic test evidence. This is not a real filing quotation.", ...target,
      })),
    },
  };
}
export const fixtureRuns = {
  NVDA: runFixture("NVDA", "0001045810", "NVIDIA Corporation", [
    { targetName: "Micron" },
    { targetName: "AMD", relationshipType: "COMPETES_WITH", direction: "bidirectional" },
    { targetName: "Unresolved Foundry" },
    { targetName: "semiconductor suppliers", targetType: "category" },
  ]),
  AMD: runFixture("AMD", "0000002488", "Advanced Micro Devices Inc.", [
    { targetName: "Example Packaging" },
  ]),
  MU: runFixture("MU", "0000723125", "Micron Technology Inc.", []),
};
export const fixtureGraph = buildIndustryGraph(fixtureRuns);
