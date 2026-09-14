import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { matchCompany, type CompanyIdentity } from "../src/lib/market-companies/identity";
import { companyFields } from "../src/lib/market-companies/model";
import { relationshipId } from "../src/lib/knowledge-graph/market-store";

type Evidence = { id: string; url: string; title: string; sourceDate: string | null; retrievedAt: string; excerpt: string };
type Company = CompanyIdentity & { description: string; stageIds: string[]; sourceIds: string[] };
type Relationship = { source: string; target: string; type: "PARTNER_OF" | "SUPPLIER_OF" | "INTEGRATES_TECHNOLOGY_FROM"; summary: string; sourceIds: string[]; commercialStatus: "DOCUMENTED" | "ANNOUNCED" };
export type ResearchBatch = { asOf: string; companies: Company[]; relationships: Relationship[]; sources: Evidence[] };
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export function validateResearch(batch: ResearchBatch) {
  assert(date(batch.asOf) && batch.asOf <= new Date().toISOString().slice(0, 10), "Invalid research date");
  assert(batch.companies.length > 0 && batch.companies.length <= 100 && batch.relationships.length <= 200, "Batch size invalid");
  assert(new Set(batch.companies.map(c => c.id)).size === batch.companies.length, "Duplicate company IDs");
  const sources = new Set(batch.sources.map(s => s.id));
  assert(sources.size === batch.sources.length, "Duplicate source IDs");
  for (const s of batch.sources) {
    const u = new URL(s.url);
    assert(u.protocol === "https:" && !u.username && !u.password && s.title.trim() && s.excerpt.trim(), "Source requires original evidence");
    assert(date(s.retrievedAt) && s.retrievedAt <= batch.asOf && (s.sourceDate === null || date(s.sourceDate) && s.sourceDate <= batch.asOf), "Invalid source date");
  }
  const sourced = (ids: string[]) => ids.length > 0 && ids.every(id => sources.has(id));
  const validId = (id: string) => /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id);
  for (const c of batch.companies) {
    assert(validId(c.id) && c.name.trim() && c.description.trim() && sourced(c.sourceIds), "Invalid company/evidence");
    assert(c.country && /^[A-Z]{2}$/.test(c.country) && ["PUBLIC", "PRIVATE", "UNKNOWN"].includes(c.listingStatus ?? ""), "Explicit geography/status required");
    assert(Array.isArray(c.listings) && c.listings.every(l => /^[A-Z0-9]{4}$/.test(l.exchange) && l.symbol.trim() && l.market.trim()), "Invalid listings");
    assert(c.listingStatus !== "PRIVATE" || c.listings.length === 0, "Private company cannot have public listings");
    assert(c.stageIds.length > 0 && c.stageIds.every(s => /^[a-z]+$/.test(s)), "Invalid stages");
  }
  const edges = new Set<string>();
  for (const e of batch.relationships) {
    assert(validId(e.source) && validId(e.target) && e.source !== e.target && ["PARTNER_OF", "SUPPLIER_OF", "INTEGRATES_TECHNOLOGY_FROM"].includes(e.type) && ["DOCUMENTED", "ANNOUNCED"].includes(e.commercialStatus) && e.summary.trim() && sourced(e.sourceIds), "Invalid relationship/evidence");
    const id = relationshipId(e.source, e.target, e.type);
    assert(!edges.has(id), "Duplicate relationship"); edges.add(id);
  }
}
export async function publishResearch(db: Firestore, batch: ResearchBatch, write = false) {
  validateResearch(batch);
  const seed = JSON.parse(await readFile(new URL("../data/ai-supply-chain/ai-us.json", import.meta.url), "utf8"));
  const cn = JSON.parse(await readFile(new URL("../data/ai-supply-chain/ai-cn-a.json", import.meta.url), "utf8"));
  const stages = seed.nodes.filter((s: { kind: string }) => s.kind === "STAGE");
  for (const c of batch.companies) assert(c.stageIds.every(id => stages.some((s: { id: string }) => s.id === `stage:${id}`)), "Unknown AI stage");
  // Read identity fields again inside the transaction: stale preview results cannot authorize writes.
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(db.collection("companies").select("name", "legalName", "aliases", "website", "country", "identifiers", "listings", "symbol", "micCode", "cik"));
    const directory = snapshot.docs.map(d => {
      const v = d.data();
      return { ...v, id: d.id, name: String(v.name ?? ""), identifiers: [...(v.identifiers ?? []), ...(v.cik ? [{ scheme: "CIK", value: String(v.cik) }] : [])], listings: [...(v.listings ?? []), ...(v.micCode && v.symbol ? [{ exchange: v.micCode, symbol: v.symbol, market: "" }] : [])] } as CompanyIdentity;
    });
    const matches = batch.companies.map(c => ({ company: c, match: matchCompany(c, directory) }));
    for (const { company, match } of matches) {
      assert(match.status !== "REVIEW", `${company.id}: identity review required (${match.ids.join(", ")})`);
      assert(matchCompany(company, batch.companies.filter(c => c !== company)).status === "NEW", "Overlapping proposals require review");
    }
    const resolved = new Map(matches.map(({ company, match }) => [company.id, match.status === "EXISTING" ? match.ids[0] : company.id]));
    assert(new Set(resolved.values()).size === resolved.size, "Multiple proposals resolve to one company");
    const resolve = (id: string) => resolved.get(id) ?? id;
    const edges = batch.relationships.map(e => ({ ...e, source: resolve(e.source), target: resolve(e.target) }));
    const companyIds = [...new Set([...resolved.values(), ...edges.flatMap(e => [e.source, e.target])])];
    const companyRefs = companyIds.map(id => db.collection("companies").doc(id));
    const edgeRefs = edges.map(e => db.collection("company_relationships").doc(relationshipId(e.source, e.target, e.type)));
    assert(new Set(edgeRefs.map(r => r.id)).size === edgeRefs.length && edges.every(e => e.source !== e.target), "Identity resolution collapses relationships");
    const docs = await tx.getAll(...companyRefs, ...edgeRefs);
    const current = new Map(companyIds.map((id, i) => [id, docs[i].data()]));
    for (const id of companyIds) {
      const old = current.get(id);
      assert(old || [...resolved.values()].includes(id), `Missing endpoint ${id}`);
      assert(!old || ["DIRECTORY", "PUBLISHED"].includes(String(old.status)), `Non-public endpoint ${id}`);
    }
    if (!write) return { write: false, companies: [...resolved], relationships: edgeRefs.map(r => r.id) };
    for (const { company: c } of matches) {
      const id = resolve(c.id), old = current.get(id) ?? {};
      const sources = batch.sources.filter(s => c.sourceIds.includes(s.id));
      const memberships = c.stageIds.map(stage => ({ id: `${id}__PARTICIPATES_IN__${stage}`, source: id, target: `stage:${stage}`, type: "PARTICIPATES_IN", commercialStatus: "NOT_A_COMMERCIAL_RELATIONSHIP", summary: c.description, sourceIds: c.sourceIds }));
      const aiGraph = { status: "PUBLISHED", asOf: batch.asOf, order: 1000, stageIds: c.stageIds, sources, memberships, stages: stages.filter((s: { id: string }) => c.stageIds.includes(s.id.slice(6))).map((s: { id: string; label: string }) => ({ ...s, labels: { en: s.label, "zh-CN": cn.nodes.find((n: { id: string }) => n.id === s.id)?.label ?? s.label } })) };
      const profile = { ...c, status: "DIRECTORY", identityReviewedAt: batch.asOf, ...old };
      tx.set(db.collection("companies").doc(id), { ...profile, ...companyFields(id, profile), aiGraph: old.aiGraph ?? aiGraph }, { merge: true });
    }
    edges.forEach((e, i) => {
      const old = docs[companyRefs.length + i].data();
      const evidence = batch.sources.filter(s => e.sourceIds.includes(s.id));
      // Existing editorial decisions (including WITHDRAWN) win; append only new evidence.
      const combined = [...(old?.evidence ?? []), ...evidence];
      tx.set(edgeRefs[i], { ...e, id: edgeRefs[i].id, status: "PUBLISHED", ...(!old ? { publishedAt: new Date().toISOString() } : {}), topic: "AI", asOf: batch.asOf, ...old, evidence: combined.filter((s, j) => combined.findIndex(other => other.url === s.url && other.title === s.title) === j) });
    });
    return { write: true, companies: [...resolved], relationships: edgeRefs.map(r => r.id) };
  }, write ? { readOnly: false } : { readOnly: true });
}
async function main() {
  const batch = JSON.parse(await readFile(new URL("../data/ai-supply-chain/global-research.json", import.meta.url), "utf8"));
  validateResearch(batch);
  if (process.argv.includes("--validate")) { console.log("Research evidence schema valid"); return; }
  assert(process.env.GCP_PROJECT_ID && (process.argv.includes("--preview") || process.argv.includes("--write")), "Use --validate, --preview or --write with GCP_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(JSON.stringify(await publishResearch(getFirestore(), batch, process.argv.includes("--write"))));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : "Research publication failed"); process.exitCode = 1; });
