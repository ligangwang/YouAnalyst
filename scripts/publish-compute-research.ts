import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type Source = { id: string; url: string; title: string; sourceDate: string | null; retrievedAt: string };
type Fact = { state: "DOCUMENTED" | "ANNOUNCED"; scope: string; sourceIds: string[]; limitation: string };
type Edge = { source: string; target: string; type: string; facts: Fact[] };
export type ComputeBatch = { batchId: string; asOf: string; sources: Source[]; relationships: Edge[] };
type StoredFact = Fact & { id: string; reviewedAt: string };
type Row = Record<string, unknown> & { source?: string; target?: string; type?: string; evidence?: Source[]; researchFacts?: StoredFact[] };
const allowed = new Set(["PARTNER_OF", "SUPPLIER_OF", "INTEGRATES_TECHNOLOGY_FROM", "PLANNED_ADOPTER_OF", "ECOSYSTEM_PARTNER_OF"]);
const validId = (id: string) => /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id);
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const hash = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function canonical(source: string, target: string, type: string) {
  if (type === "CUSTOMER_OF") { [source, target] = [target, source]; type = "SUPPLIER_OF"; }
  if (["PARTNER_OF", "ECOSYSTEM_PARTNER_OF", "COMPETES_WITH"].includes(type)) [source, target] = [source, target].sort();
  return { source, target, type, id: `${source}__${type}__${target}` };
}
export function validateBatch(b: ComputeBatch) {
  assert(/^[a-z0-9-]+$/.test(b.batchId) && date(b.asOf) && b.asOf <= new Date().toISOString().slice(0, 10));
  assert(b.relationships.length > 0 && b.relationships.length <= 100);
  const sources = new Set<string>();
  for (const s of b.sources) {
    assert(!sources.has(s.id) && s.id && s.title.trim()); sources.add(s.id);
    const url = new URL(s.url); assert(url.protocol === "https:" && !url.username && !url.password);
    assert(date(s.retrievedAt) && s.retrievedAt <= b.asOf && (s.sourceDate === null || date(s.sourceDate) && s.sourceDate <= s.retrievedAt));
  }
  const keys = new Set<string>();
  for (const e of b.relationships) {
    const n = canonical(e.source, e.target, e.type);
    assert(validId(e.source) && validId(e.target) && e.source !== e.target && allowed.has(n.type), "Invalid endpoint/type; competition excluded");
    assert(!keys.has(n.id), `Duplicate relationship: ${n.id}`); keys.add(n.id);
    assert(e.facts.length > 0 && e.facts.length <= 20);
    for (const f of e.facts) {
      assert(["DOCUMENTED", "ANNOUNCED"].includes(f.state) && f.scope.trim() && f.limitation.trim());
      assert(f.sourceIds.length > 0 && f.sourceIds.every(id => sources.has(id)), "Missing fact evidence");
      assert(n.type !== "PLANNED_ADOPTER_OF" || f.state === "ANNOUNCED", "Planned adoption cannot imply delivery");
    }
  }
}
export function mergeEdge(b: ComputeBatch, edge: Edge, old: Row | null): Row {
  assert(!old || old.status === "PUBLISHED", "Existing editorial status must be reviewed, not overwritten");
  const n = canonical(edge.source, edge.target, edge.type);
  const evidence = (old?.evidence ?? []).map(s => ({ ...s, id: s.id || `research:${hash(s.url).slice(0, 24)}` }));
  const facts = [...(old?.researchFacts ?? [])];
  const added: StoredFact[] = [];
  for (const f of edge.facts) {
    const resolved = f.sourceIds.map(id => {
      const s = b.sources.find(s => s.id === id)!;
      const present = evidence.find(e => e.url === s.url);
      if (present) return present.id;
      const item = { ...s, id: `research:${hash(s.url).slice(0, 24)}` };
      evidence.push(item); return item.id;
    });
    // Identity uses source URLs, not batch-local aliases or changing retrieval dates.
    const id = hash([f.state, f.scope.trim(), f.limitation.trim(), f.sourceIds.map(id => b.sources.find(s => s.id === id)!.url).sort()]);
    if (!facts.some(f => f.id === id)) {
      const fact = { ...f, sourceIds: [...new Set(resolved)], id, reviewedAt: b.asOf };
      facts.push(fact); added.push(fact);
    }
  }
  if (old && !added.length && evidence.length === (old.evidence ?? []).length) return old;
  const summary = [String(old?.summary ?? "").trim(), ...added.map(f => {
    const dates = [...new Set(f.sourceIds.map(id => evidence.find(s => s.id === id)?.sourceDate).filter(Boolean))];
    return `${f.state === "ANNOUNCED" ? "Announced/planned" : "Documented"}${dates.length ? ` (${dates.join(", ")})` : " (undated source)"}: ${f.scope}.`;
  })].filter(Boolean).join(" ");
  return { ...old, ...n, status: "PUBLISHED", topic: old?.topic ?? "AI", summary,
    commercialStatus: old?.commercialStatus ?? (facts.some(f => f.state === "DOCUMENTED") ? "DOCUMENTED" : "ANNOUNCED"),
    evidence, sourceIds: [...new Set(evidence.map(s => s.id))], researchFacts: facts,
    researchBatchIds: [...new Set([...(Array.isArray(old?.researchBatchIds) ? old.researchBatchIds : []), b.batchId])],
    researchReviewedAt: b.asOf, ...(old ? {} : { asOf: b.asOf, publishedAt: new Date().toISOString() }) };
}
type Change = { id: string; before: Row | null; beforeHash: string; after: Row; changed: boolean };
type Plan = { batchHash: string; changes: Change[] };
export async function processBatch(db: Firestore, b: ComputeBatch, approved?: Plan): Promise<Plan> {
  validateBatch(b);
  return db.runTransaction(async tx => {
    // Query all statuses to detect reversed/legacy keys and avoid reviving rejected evidence.
    const all = await tx.get(db.collection("company_relationships"));
    const ids = [...new Set(b.relationships.flatMap(e => [e.source, e.target]))];
    const companies = await tx.getAll(...ids.map(id => db.collection("companies").doc(id)));
    for (const d of companies) assert(d.exists && ["DIRECTORY", "PUBLISHED"].includes(String(d.data()?.status)), `Missing/non-public company ${d.id}`);
    const plan: Plan = { batchHash: hash(b), changes: [] };
    for (const edge of b.relationships) {
      const n = canonical(edge.source, edge.target, edge.type);
      const matches = all.docs.filter(d => { const v = d.data(); return canonical(v.source, v.target, v.type).id === n.id; });
      assert(matches.length <= 1, `Existing duplicate requires review: ${n.id}`);
      // Use existing document identity even when its old key wasn't canonical.
      const doc = matches[0]; const before = doc ? doc.data() as Row : null;
      const id = doc?.id ?? n.id;
      assert(doc || !all.docs.some(d => d.id === id), `Conflicting document key: ${id}`);
      const after = { ...mergeEdge(b, edge, before), id };
      const change = { id, before, beforeHash: hash(before), after, changed: hash(before) !== hash(after) };
      if (approved) {
        const expected = approved.changes.find(c => c.id === id);
        assert(approved.batchHash === plan.batchHash && expected?.beforeHash === change.beforeHash, `Preview stale: ${id}`);
      }
      plan.changes.push(change);
    }
    // All validation and reads precede the first mutation. Entire batch commits atomically.
    if (approved) for (const c of plan.changes) if (c.changed) tx.set(db.collection("company_relationships").doc(c.id), c.after);
    return plan;
  }, approved ? { readOnly: false } : { readOnly: true });
}
async function main() {
  const b = JSON.parse(await readFile(new URL("../data/ai-supply-chain/compute-research.json", import.meta.url), "utf8")) as ComputeBatch;
  validateBatch(b);
  if (process.argv.includes("--validate")) { console.log(`Validated ${b.relationships.length} relationships`); return; }
  assert(process.env.GCP_PROJECT_ID && ["--preview", "--write", "--verify"].some(f => process.argv.includes(f)));
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const approved = process.argv.includes("--write") ? JSON.parse(await readFile("compute-preview.json", "utf8")) as Plan : undefined;
  const plan = await processBatch(getFirestore(), b, approved);
  if (process.argv.includes("--verify")) assert(plan.changes.every(c => !c.changed), "Publication incomplete or not idempotent");
  const file = approved ? "compute-written.json" : process.argv.includes("--verify") ? "compute-verified.json" : "compute-preview.json";
  await writeFile(file, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ operation: approved ? "write" : process.argv.includes("--verify") ? "verify" : "preview", relationships: plan.changes.length, additions: plan.changes.filter(c => !c.before).length, updates: plan.changes.filter(c => c.before && c.changed).length, unchanged: plan.changes.filter(c => !c.changed).length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e instanceof Error ? e.message : "Publication failed"); process.exitCode = 1; });
