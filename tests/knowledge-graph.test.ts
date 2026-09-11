import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Firestore } from "firebase-admin/firestore";
import { validateGraph, graphVersion, importGraphs, type Graph } from "../scripts/import-ai-knowledge-graphs";

const graphs: Graph[] = ["ai-us", "ai-cn-a"].map(id => JSON.parse(readFileSync(new URL(`../data/ai-supply-chain/${id}.json`, import.meta.url), "utf8")));
test("both datasets have unique sourced companies, valid topology and honest coverage counts", () => {
  graphs.forEach(validateGraph);
  assert.equal(graphs[0].coverage.companyCount, 67);
  assert.equal(graphs[1].coverage.companyCount, 62);
  assert(graphs[0].nodes.some(n => n.id === "US:P"));
  assert(!graphs[0].nodes.some(n => n.id === "US:PSTG"));
});
test("rejects broken evidence, cross-market endpoints, and commercial stage edges", () => {
  for (const mutation of [
    (g: Graph) => { g.relationships[0].sourceIds = ["missing"]; },
    (g: Graph) => { g.relationships[0].source = "XSHG:688041"; },
    (g: Graph) => { g.relationships[0].type = "SUPPLIER_OF"; },
    (g: Graph) => { g.relationships.push(g.relationships[0]); },
    (g: Graph) => { g.sources[0].url = "https://username:password@example.com"; },
    (g: Graph) => { g.coverage.companyCount++; },
    (g: Graph) => { g.relationships.find(e => e.type === "PLANNED_ADOPTER_OF")!.commercialStatus = "DOCUMENTED"; },
  ]) { const copy = structuredClone(graphs[0]); mutation(copy); assert.throws(() => validateGraph(copy)); }
});
test("version hash is reproducible and changes with research content", () => {
  assert.deepEqual(graphVersion(graphs[0]), graphVersion(structuredClone(graphs[0])));
  const copy = structuredClone(graphs[0]); copy.title += " revised";
  assert.notEqual(graphVersion(copy).versionId, graphVersion(graphs[0]).versionId);
});

function fakeDb() {
  const records = new Map<string, Record<string, unknown>>(); let failChina = true;
  type Ref = ReturnType<typeof doc>;
  function snapshot(path: string) { return { exists: records.has(path), data: () => records.get(path) }; }
  function collection(path: string) { return { doc: (id: string) => doc(`${path}/${id}`), count: () => ({ get: async () => ({ data: () => ({ count: [...records.keys()].filter(k => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).length }) }) }) }; }
  function doc(path: string) { return { path, get: async () => snapshot(path), set: async (data: Record<string, unknown>) => { records.set(path, data); }, collection: (name: string) => collection(`${path}/${name}`) }; }
  function batch() { const writes: [Ref, Record<string, unknown>][] = []; return { set(ref: Ref, data: Record<string, unknown>) { writes.push([ref, data]); }, async commit() { if (failChina && writes.some(([r]) => r.path.startsWith("knowledge_graphs/ai-cn-a/"))) throw Error("Simulated connection interruption"); writes.forEach(([r, d]) => records.set(r.path, d)); } }; }
  for (const n of graphs[1].nodes.filter(n => n.kind === "COMPANY")) records.set(`company_directory/${n.id}`, { market: "CN_A" });
  const db = { collection, getAll: async (...refs: Ref[]) => refs.map(r => snapshot(r.path)), batch, runTransaction: async (callback: (tx: unknown) => Promise<void>) => { const b = batch(); await callback({ getAll: async (...refs: Ref[]) => refs.map(r => snapshot(r.path)), set: b.set }); await b.commit(); } } as unknown as Firestore;
  return { db, records, resume: () => { failChina = false; } };
}
test("interrupted import cannot publish partial pointers; replay completes both and stays idempotent", async () => {
  const f = fakeDb();
  await assert.rejects(importGraphs(f.db, graphs), /Simulated/);
  assert(!f.records.has("knowledge_graphs/ai-us"));
  assert(!f.records.has("knowledge_graphs/ai-cn-a"));
  f.resume();
  const result = await importGraphs(f.db, graphs);
  assert.equal(result.length, 2);
  assert.equal([...f.records.keys()].filter(k=>k.startsWith("market_companies/")).length,129);
  assert.equal(f.records.get("market_companies/XSHG:688041")?.name,"海光信息");
  assert.equal(f.records.get("knowledge_graphs/ai-us")?.status, "READY");
  assert.equal(f.records.get("knowledge_graphs/ai-cn-a")?.status, "READY");
  const count = f.records.size;
  assert.deepEqual(await importGraphs(f.db, graphs), result);
  assert.equal(f.records.size, count);
});
