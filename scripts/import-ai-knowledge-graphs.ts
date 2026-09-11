import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import assert from "node:assert/strict";
import { companyFields } from "../src/lib/market-companies/model";

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

export function graphVersion(g: Graph) {
  const sha256 = createHash("sha256").update(JSON.stringify(g)).digest("hex");
  return { versionId: `${g.asOf}-${sha256.slice(0, 16)}`, sha256 };
}

export async function importGraphs(db: Firestore, graphs: Graph[]) {
  assert(graphs.length === 2 && new Set(graphs.map(g => g.id)).size === 2, "Both market versions are required");
  graphs.forEach(validateGraph);
  const reports: { id: string; versionId: string; sha256: string; companyCount: number; relationshipCount: number; sourceCount: number }[] = [];
  for (const g of graphs) {
    const identity = graphVersion(g), root = db.collection("knowledge_graphs").doc(g.id), version = root.collection("versions").doc(identity.versionId);
    const companies = g.nodes.filter(n => n.kind === "COMPANY");
    const masterDocs = await db.getAll(...companies.map(n => db.collection("market_companies").doc(n.id)));
    const masterBatch = db.batch();
    companies.forEach((n,i) => {
      const current = masterDocs[i].data() ?? {}, source = g.sources.find(s => n.sourceIds?.includes(s.id));
      const profile = {...n,description:(n as Node & {summary?:string}).summary ?? "",source:source?.url ?? "",sourceLabel:source?.title ?? "",...current};
      masterBatch.set(db.collection("market_companies").doc(n.id), {...profile,status:current.status ?? "DIRECTORY",...companyFields(n.id,profile)}, {merge:true});
    });
    await masterBatch.commit();
    // The June directory checks identity only; it is not a real-time listing-status assertion.
    if (g.market === "CN_A") {
      const listed = await db.getAll(...companies.map(n => db.collection("company_directory").doc(n.id)));
      assert(listed.every(d => d.exists && d.data()?.market === "CN_A"), "A-share identity missing from imported company directory");
    }
    const existing = await version.get();
    assert(!existing.exists || existing.data()?.sha256 === identity.sha256, "Version hash collision");
    const writes = [
      ...g.nodes.map(n => ({ ref: version.collection("nodes").doc(n.id), data: n })),
      ...g.relationships.map(e => ({ ref: version.collection("relationships").doc(e.id), data: e })),
      ...g.sources.map(s => ({ ref: version.collection("sources").doc(s.id), data: s })),
    ];
    if (existing.data()?.status !== "READY") {
      await version.set({ ...identity, status: "WRITING", asOf: g.asOf });
      for (let i = 0; i < writes.length; i += 200) {
        const batch = db.batch();
        for (const w of writes.slice(i, i + 200)) batch.set(w.ref, w.data);
        await batch.commit();
      }
    }
    for (const [collection, expected] of [["nodes", g.nodes.length], ["relationships", g.relationships.length], ["sources", g.sources.length]] as const) {
      assert((await version.collection(collection).count().get()).data().count === expected, `Incomplete ${g.id}/${collection}`);
    }
    const { nodes: _nodes, relationships: _edges, sources: _sources, ...metadata } = g;
    void _nodes; void _edges; void _sources;
    await version.set({ ...metadata, ...identity, status: "READY", sourceCount: g.sources.length, nodeCount: g.nodes.length, relationshipCount: g.relationships.length });
    reports.push({ id: g.id, ...identity, companyCount: companies.length, relationshipCount: g.relationships.length, sourceCount: g.sources.length });
  }
  // Switch both pointers only when both complete immutable datasets have been verified.
  await db.runTransaction(async tx => {
    const refs = graphs.map(g => db.collection("knowledge_graphs").doc(g.id));
    const previous = await tx.getAll(...refs);
    previous.forEach((p, i) => assert(!p.data()?.asOf || p.data()!.asOf <= graphs[i].asOf, "Refusing to replace a newer graph"));
    graphs.forEach((g, i) => tx.set(refs[i], { title: g.title, market: g.market, language: g.language, asOf: g.asOf, activeVersion: reports[i].versionId, sha256: reports[i].sha256, coverage: g.coverage, status: "READY", access: "SERVER_ONLY", updatedAt: new Date().toISOString() }));
  });
  return reports;
}

async function main() {
  const graphs = await Promise.all(["ai-us", "ai-cn-a"].map(async id => JSON.parse(await readFile(new URL(`../data/ai-supply-chain/${id}.json`, import.meta.url), "utf8"))));
  graphs.forEach(validateGraph);
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify(graphs.map(g => ({ id: g.id, ...graphVersion(g), ...g.coverage })), null, 2)); return; }
  assert(process.argv.includes("--write") && process.env.GCP_PROJECT_ID, "Use --write with GCP_PROJECT_ID, or --dry-run");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(JSON.stringify(await importGraphs(getFirestore(), graphs), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : "Graph import failed"); process.exitCode = 1; });
