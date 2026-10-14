import { COMPANY_GRAPH_EXTRACTION_VERSION } from "../../src/lib/company-graph/types";
import { buildIndustryGraph as buildGraph } from "../../src/lib/industry-graph/model";
import type { IndustryCompany } from "../../src/lib/industry-graph/catalog";
// Test-only directory records for identity, alias, and bounded-preview cases.
export const fixtureCompanies: IndustryCompany[] = [
  { ticker: "TSM", name: "TSMC", segment: "manufacturing", filingForm: "20-F", aliases: ["Taiwan Semiconductor Manufacturing", "Taiwan Semiconductor Manufacturing Company Limited"] },
  { ticker: "NVDA", name: "NVIDIA", segment: "compute" },
  { ticker: "INTC", name: "Intel", segment: "compute" },
  { ticker: "AMD", name: "AMD", segment: "compute", aliases: ["Advanced Micro Devices"] },
  { ticker: "MU", name: "Micron", segment: "memory", aliases: ["Micron Technology"] },
  { ticker: "SNDK", name: "Sandisk", segment: "memory", aliases: ["Sandisk Corporation"], expectedCik: "0002023554" },
  { ticker: "WDC", name: "Western Digital", segment: "memory" },
  { ticker: "AAPL", name: "Apple", segment: "devices" },
  { ticker: "QCOM", name: "Qualcomm", segment: "devices" },
];
export const buildIndustryGraph = (runs: Record<string, unknown>) => buildGraph(runs, fixtureCompanies);

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
