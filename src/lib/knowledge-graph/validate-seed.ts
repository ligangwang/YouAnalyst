import assert from "node:assert/strict";

type Source = { id: string; url: string; title: string; retrievedAt: string; sourceDate: string | null };
type Node = { id: string; kind: "STAGE" | "COMPANY"; market?: string; symbol?: string; name?: string; stageIds?: string[]; sourceIds?: string[] };
type Edge = { id: string; source: string; target: string; type: string; summary: string; sourceIds: string[]; commercialStatus: string };
export type Graph = { id: string; schemaVersion: number; market: string; language: string; title: string; asOf: string; coverage: { companyCount: number; stageCount: number; businessRelationshipCount: number; stageMembershipCount: number }; nodes: Node[]; relationships: Edge[]; sources: Source[] };
const edgeTypes = new Set(["PARTICIPATES_IN", "SUPPLIER_OF", "PARTNER_OF", "ECOSYSTEM_PARTNER_OF", "INTEGRATES_TECHNOLOGY_FROM", "PLANNED_ADOPTER_OF", "ENERGY_AGREEMENT_WITH"]);
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;

export function validateGraph(input: unknown): asserts input is Graph {
  assert(input && typeof input === "object", "Graph must be an object");
  const g = input as Graph;
  assert(g.schemaVersion === 1 && ["ai-us", "ai-cn-a"].includes(g.id), "Unknown graph/schema");
  assert(g.market === (g.id === "ai-us" ? "US" : "CN_A") && g.language === (g.id === "ai-us" ? "en" : "zh-CN"), "Market/language mismatch");
  assert(validDate(g.asOf) && g.asOf <= new Date().toISOString().slice(0, 10), "Invalid/future snapshot date");
  assert(Array.isArray(g.nodes) && Array.isArray(g.relationships) && Array.isArray(g.sources), "Missing graph arrays");
  const unique = (rows: { id: string }[]) => rows.every(r => typeof r.id === "string" && r.id.length > 0 && !r.id.includes("/")) && new Set(rows.map(r => r.id)).size === rows.length;
  assert(unique(g.nodes) && unique(g.relationships) && unique(g.sources), "Duplicate or invalid IDs");
  const sources = new Set(g.sources.map(s => s.id));
  for (const s of g.sources) {
    const u = new URL(s.url);
    assert(u.protocol === "https:" && !u.username && !u.password && s.title.trim(), "Invalid evidence URL/title");
    assert(validDate(s.retrievedAt) && s.retrievedAt <= g.asOf && (s.sourceDate === null || validDate(s.sourceDate) && s.sourceDate <= g.asOf), "Invalid evidence date");
  }
  const hasSources = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length > 0 && ids.every(id => sources.has(id));
  const nodes = new Map(g.nodes.map(n => [n.id, n]));
  for (const n of g.nodes) {
    assert(["STAGE", "COMPANY"].includes(n.kind), "Invalid node kind");
    if (n.kind === "STAGE") { assert(/^stage:[a-z]+$/.test(n.id), "Invalid stage ID"); continue; }
    assert(n.market === g.market && n.name?.trim() && hasSources(n.sourceIds), "Unsourced company or market mismatch");
    assert(g.market === "US" ? /^US:[A-Z][A-Z0-9.-]*$/.test(n.id) && n.id === `US:${n.symbol}` : /^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(n.id) && n.id.endsWith(`:${n.symbol}`), "Invalid security ID");
    assert(n.stageIds?.length && new Set(n.stageIds).size === n.stageIds.length && n.stageIds.every(id => nodes.get(`stage:${id}`)?.kind === "STAGE"), "Missing/invalid company stage");
  }
  for (const e of g.relationships) {
    const from = nodes.get(e.source), to = nodes.get(e.target);
    assert(from && to && e.source !== e.target && edgeTypes.has(e.type) && e.summary.trim() && hasSources(e.sourceIds), "Invalid/unsourced relationship");
    assert(from.kind === "COMPANY", "Edges must start at companies");
    if (e.type === "PARTICIPATES_IN") assert(to.kind === "STAGE" && from.stageIds?.includes(e.target.slice(6)) && e.commercialStatus === "NOT_A_COMMERCIAL_RELATIONSHIP", "Stage membership is not a commercial relationship");
    else assert(to.kind === "COMPANY" && ["DOCUMENTED", "ANNOUNCED"].includes(e.commercialStatus), "Invalid business relationship");
    if (e.type === "PLANNED_ADOPTER_OF") assert(e.commercialStatus === "ANNOUNCED", "Planned adoption must remain announced");
  }
  for (const n of g.nodes.filter(n => n.kind === "COMPANY")) for (const stage of n.stageIds!) assert(g.relationships.filter(e => e.type === "PARTICIPATES_IN" && e.source === n.id && e.target === `stage:${stage}`).length === 1, "Missing/duplicate membership edge");
  const members = g.relationships.filter(e => e.type === "PARTICIPATES_IN").length;
  assert(g.coverage.companyCount === g.nodes.filter(n => n.kind === "COMPANY").length && g.coverage.stageCount === g.nodes.filter(n => n.kind === "STAGE").length && g.coverage.stageMembershipCount === members && g.coverage.businessRelationshipCount === g.relationships.length - members, "Incorrect coverage counts");
}

