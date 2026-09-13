import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Firestore } from "firebase-admin/firestore";
import { publishResearch, validateResearch, type ResearchBatch } from "../scripts/publish-global-ai-research";
import { graphFromMarket, type MarketCompany, type MarketRelationship } from "../src/lib/knowledge-graph/market-store";

const fixture = async () => JSON.parse(await readFile(new URL("../data/ai-supply-chain/global-research.json", import.meta.url), "utf8")) as ResearchBatch;
function database(batch: ResearchBatch) {
  const records = new Map<string, Record<string, unknown>>();
  const transactionModes: boolean[] = [];
  for (const id of new Set(batch.relationships.map(e => e.target))) records.set("companies/" + id, { id, name: id, status: "DIRECTORY" });
  const ref = (path: string) => ({ path, id: path.split("/")[1] });
  const db = {
    collection: (name: string) => ({ select: () => name, doc: (id: string) => ref(name + "/" + id) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>, options: { readOnly: boolean }) => {
      transactionModes.push(options.readOnly);
      const pending: [string, Record<string, unknown>][] = [];
      const tx = {
        get: async () => ({ docs: [...records].filter(([key]) => key.startsWith("companies/")).map(([key, v]) => ({ id: ref(key).id, data: () => structuredClone(v) })) }),
        getAll: async (...refs: ReturnType<typeof ref>[]) => refs.map(r => ({ data: () => structuredClone(records.get(r.path)) })),
        set: (r: ReturnType<typeof ref>, v: Record<string, unknown>) => pending.push([r.path, structuredClone(v)]),
      };
      const result = await fn(tx);
      pending.forEach(([key, value]) => records.set(key, value));
      return result;
    },
  } as unknown as Firestore;
  return { db, records, transactionModes };
}
test("preview writes nothing; publication renders global nodes and evidence; replay preserves edits", async () => {
  const batch = await fixture(), { db, records, transactionModes } = database(batch), before = structuredClone(records);
  await publishResearch(db, batch);
  assert.deepEqual(records, before);
  assert.deepEqual(transactionModes, [true]);
  await publishResearch(db, batch, true);
  assert.deepEqual(transactionModes, [true, false]);
  const companies = [...records].filter(([k]) => k.startsWith("companies/")).map(([, v]) => v) as MarketCompany[];
  const edges = [...records].filter(([k]) => k.startsWith("company_relationships/")).map(([, v]) => v) as MarketRelationship[];
  const graph = graphFromMarket(companies, edges);
  assert.equal(graph.relationships.filter(e => e.type !== "PARTICIPATES_IN").length, 5);
  assert.equal(graph.nodes.find(n => n.id === "ORG:MISTRAL-AI")?.country, "FR");
  assert.equal(graph.nodes.find(n => n.id === "ORG:OPENAI")?.market, "GLOBAL");
  const edgeKey = [...records.keys()].find(k => k.startsWith("company_relationships/"))!;
  records.get(edgeKey)!.status = "WITHDRAWN";
  records.get("companies/ORG:OPENAI")!.description = "Edited by admin";
  const count = records.size;
  await publishResearch(db, batch, true);
  assert.equal(records.size, count);
  assert.equal(records.get(edgeKey)!.status, "WITHDRAWN");
  assert.equal((records.get(edgeKey)!.evidence as unknown[]).length, 1);
  assert.equal(records.get("companies/ORG:OPENAI")!.description, "Edited by admin");
});
test("identity conflicts and missing endpoints abort the whole batch", async () => {
  const batch = await fixture(), { db, records } = database(batch);
  records.set("companies/ORG:OPENAI", { name: "Unrelated business", status: "DIRECTORY" });
  const before = structuredClone(records);
  await assert.rejects(publishResearch(db, batch, true), /identity review/);
  assert.deepEqual(records, before);
  records.delete("companies/ORG:OPENAI");
  records.delete("companies/" + batch.relationships[0].target);
  await assert.rejects(publishResearch(db, batch, true), /Missing endpoint/);
  assert.equal([...records.keys()].some(k => k.startsWith("company_relationships/")), false);
});
test("matching registered company reuses existing ID in both company and relationship writes", async () => {
  const batch = await fixture(), { db, records } = database(batch);
  const mistral = batch.companies.find(c => c.id === "ORG:MISTRAL-AI")!;
  records.set("companies/ORG:MISTRAL", { ...mistral, id: "ORG:MISTRAL", status: "DIRECTORY" });
  await publishResearch(db, batch, true);
  assert.equal(records.has("companies/ORG:MISTRAL-AI"), false);
  assert([...records.keys()].some(k => k.startsWith("company_relationships/") && k.includes("ORG:MISTRAL__")));
});
test("rejects unsourced claims, impossible dates and contradictory listing status", async () => {
  const batch = await fixture();
  validateResearch(batch);
  const bad = structuredClone(batch);
  bad.relationships[0].sourceIds = ["missing"];
  assert.throws(() => validateResearch(bad), /relationship/);
  bad.relationships = batch.relationships;
  bad.sources[0].sourceDate = "2026-02-30";
  assert.throws(() => validateResearch(bad), /date/);
  bad.sources = batch.sources;
  bad.companies[0].listings = [{ market: "US", exchange: "XNAS", symbol: "FAKE" }];
  assert.throws(() => validateResearch(bad), /Private company/);
});
