import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgeGraph } from "../src/lib/knowledge-graph/model";

const require = createRequire(import.meta.url);
const { RelationshipEvidence } = require("../src/components/company-research-panel") as typeof import("../src/components/company-research-panel");
const { LocaleProvider } = require("../src/components/providers/locale-provider") as typeof import("../src/components/providers/locale-provider");
const graph: KnowledgeGraph = { asOf: "2026-09-24", nodes: [], sources: [{ id: "s", title: "NVIDIA Form 10-K", url: "https://www.sec.gov/nvda.htm", sourceDate: "2026-02-25" }], relationships: [] };
const edge = (verificationStatus?: "CONFIRMED" | "PENDING") => ({ id: "US:TSM__SUPPLIER_OF__US:NVDA", source: "US:TSM", target: "US:NVDA", type: "SUPPLIER_OF", summary: "TSMC manufactures chips for NVIDIA.", sourceIds: ["s"], commercialStatus: "DOCUMENTED",
  facts: [{ state: "DOCUMENTED", scope: "Wafer foundry manufacturing", sourceIds: ["s"], ...(verificationStatus ? { verificationStatus, reviewedAt: "2026-09-24" } : {}) }] });
const render = (e: ReturnType<typeof edge>, locale: "en" | "zh-CN" = "en") => renderToStaticMarkup(<LocaleProvider locale={locale}><RelationshipEvidence edge={e} graph={graph} /></LocaleProvider>);

test("verified evidence shows a marker and its review date", () => {
  const html = render(edge("CONFIRMED"));
  assert.match(html, /✓ <\/span>Verified/);
  assert.match(html, /reviewed.*2026-09-24/);
  assert.match(render(edge("CONFIRMED"), "zh-CN"), /已核实/);
});
test("unreviewed evidence has no warning badge and never shows 'Not recorded'", () => {
  const html = render(edge());
  assert.doesNotMatch(html, /Needs verification|Not recorded|Verified/);
  assert.match(html, /Documented/);
  assert.match(render(edge("PENDING")), /Needs verification/);
});
