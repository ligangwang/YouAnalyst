import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Firestore } from "firebase-admin/firestore";
import { checkLinks, run, summaryMarkdown, validateVerification, type VerificationBatch } from "../scripts/publish-relationship-verification";
import { mergeEdge, type ComputeBatch } from "../src/lib/research/publisher";
import { graphFromMarket, type MarketCompany, type MarketRelationship } from "../src/lib/knowledge-graph/market-store";
import { relationshipTrust } from "../src/lib/knowledge-graph/relationship-status";
import { relationshipGroup } from "../src/lib/knowledge-graph/research-view";

const data = (name: string) => readFile(new URL(`../data/ai-supply-chain/${name}`, import.meta.url), "utf8").then(JSON.parse);
const batch = () => data("relationship-verification.json") as Promise<VerificationBatch>;

// Minimal Firestore double: `companies` and `company_relationships` documents keyed by path.
function database(records: Map<string, Record<string, unknown>>) {
  let writes = 0;
  const ref = (collection: string, id: string) => ({ path: `${collection}/${id}`, id });
  const collection = (name: string) => ({ name, select: () => ({ name }), doc: (id: string) => ref(name, id) });
  const docs = (name: string) => [...records].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.slice(name.length + 1), exists: true, data: () => structuredClone(v) }));
  const db = { collection, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending: [string, Record<string, unknown>, boolean][] = [];
    const result = await fn({
      get: async (q: { name: string }) => ({ docs: docs(q.name) }),
      getAll: async (...refs: (ReturnType<typeof ref> | { fieldMask: string[] })[]) => refs.filter((r): r is ReturnType<typeof ref> => "path" in r).map(r => ({ id: r.id, exists: records.has(r.path), data: () => structuredClone(records.get(r.path)) })),
      set: (r: ReturnType<typeof ref>, v: Record<string, unknown>, options?: { merge?: boolean }) => pending.push([r.path, structuredClone(v), !!options?.merge]),
    });
    for (const [path, value, merge] of pending) { records.set(path, merge ? { ...records.get(path), ...value } : value); writes++; }
    return result;
  } } as unknown as Firestore;
  return { db, writes: () => writes };
}
async function production() {
  const b = await batch(), compute = await data("compute-research.json") as ComputeBatch, seed = await data("ai-us.json");
  const records = new Map<string, Record<string, unknown>>();
  const proposed = new Set(b.companies.map(c => c.id));
  for (const id of new Set([...b.relationships, ...compute.relationships].flatMap(e => [e.source, e.target]))) if (!proposed.has(id)) records.set(`companies/${id}`, { id, name: id, status: "PUBLISHED", inGraph: { status: "PUBLISHED", stageIds: [], stages: [], memberships: [], sources: [], order: 1, asOf: "2026-06-01" } });
  // Production order: seed import, then the compute batch merged onto existing rows.
  for (const e of seed.relationships.filter((e: { type: string }) => e.type !== "PARTICIPATES_IN")) {
    const source = seed.sources.find((s: { id: string }) => s.id === e.sourceIds[0]);
    records.set(`company_relationships/${e.id}`, { ...e, status: "PUBLISHED", evidence: [{ ...source, id: `seed:${source.id}` }] });
  }
  for (const e of compute.relationships) { const row = mergeEdge(compute, e, null); const key = `company_relationships/${row.id}`; records.set(key, mergeEdge(compute, e, records.get(key) ?? null)); }
  return { b, records, ...database(records) };
}

test("reviewed batch obeys the verification rule", async () => {
  const b = await batch();
  validateVerification(b);
  const third = structuredClone(b); third.sources.find(s => s.id === "NV10K")!.publisher = "ORG:SOMEONE-ELSE";
  assert.throws(() => validateVerification(third), /published by one of the two companies/);
  const planned = structuredClone(b); planned.relationships[0].facts[0].state = "ANNOUNCED";
  assert.throws(() => validateVerification(planned), /cannot be verified/);
  const unsourced = structuredClone(b); unsourced.relationships[0].facts[0].sourceIds = [];
  assert.throws(() => validateVerification(unsourced));
});

test("dry run writes nothing and reports exactly what would change", async () => {
  const { b, db, writes } = await production();
  const preview = await run(db, b);
  assert.equal(writes(), 0);
  const row = (id: string) => preview.summary.find(s => s.id === id)!;
  assert.deepEqual([row("US:TSM__SUPPLIER_OF__US:NVDA").action, row("US:TSM__SUPPLIER_OF__US:NVDA").trustAfter], ["UPDATE", "VERIFIED"]);
  assert.equal(row("US:MU__SUPPLIER_OF__US:NVDA").commercialStatus, "ANNOUNCED → DOCUMENTED");
  const msftAmd = row("US:MSFT__INTEGRATES_TECHNOLOGY_FROM__US:AMD");
  assert.deepEqual([msftAmd.trustBefore, msftAmd.trustAfter, msftAmd.factsAdded.length, msftAmd.factsVerified.length], ["UNREVIEWED", "VERIFIED", 0, 1]);
  assert.equal(row("US:SKHY__SUPPLIER_OF__US:NVDA").action, "ADD");
  assert.equal(row("US:NVDA__SUPPLIER_OF__US:MSFT").action, "ADD");
  assert.equal(preview.summary.filter(s => s.action === "UNCHANGED").length, 0);
  assert.match(summaryMarkdown(preview.summary, preview.identities), /US:SKHY__SUPPLIER_OF__US:NVDA \| ADD \| NONE → VERIFIED/);
});

test("write applies the reviewed preview once; replay is unchanged; stale previews fail", async () => {
  const { b, db, records, writes } = await production();
  const preview = await run(db, b);
  const stale = structuredClone(preview); stale.plan.changes[0].beforeHash = "stale";
  await assert.rejects(run(db, b, stale), /stale/);
  const otherBatch = { ...structuredClone(preview), batchHash: "other" };
  await assert.rejects(run(db, b, otherBatch), /different batch/);
  await run(db, b, preview);
  assert.ok(writes() > 0);
  assert.ok((await run(db, b)).summary.every(s => s.action === "UNCHANGED"));

  const graph = graphFromMarket([...records].filter(([k]) => k.startsWith("companies/")).map(([k, v]) => ({ ...v, id: k.slice(10) }) as MarketCompany),
    [...records].filter(([k]) => k.startsWith("company_relationships/")).map(([k, v]) => ({ ...v, id: k.slice(22) }) as MarketRelationship));
  const nvda = graph.relationships.filter(e => e.source === "US:NVDA" || e.target === "US:NVDA");
  const group = (g: string) => nvda.filter(e => relationshipGroup(e, "US:NVDA") === g).map(e => e.source === "US:NVDA" ? e.target : e.source).sort();
  for (const id of ["US:SKHY", "ORG:SAMSUNG-ELECTRONICS", "ORG:HON-HAI", "ORG:WISTRON", "US:TSM", "US:MU"]) assert.ok(group("suppliers").includes(id), id);
  assert.deepEqual(group("customers"), ["US:AMZN", "US:CRWV", "US:GOOGL", "US:META", "US:MSFT", "US:ORCL"]);
  const tsmc = nvda.find(e => e.source === "US:TSM")!;
  assert.deepEqual(relationshipTrust(tsmc), { status: "VERIFIED", reviewedAt: b.asOf });
  assert.equal(relationshipTrust(nvda.find(e => e.source === "US:MSFT" && e.type === "PLANNED_ADOPTER_OF")!).status, "UNREVIEWED");
  const samsung = records.get("companies/ORG:SAMSUNG-ELECTRONICS")!;
  assert.deepEqual([samsung.status, samsung.country, (samsung.inGraph as { stageIds: string[] }).stageIds], ["DIRECTORY", "KR", ["memory", "foundry"]]);
});

test("link check blocks dead links and flags bot-blocked sources for manual review", async () => {
  const b = await batch();
  const statuses: Record<string, number> = { [b.sources[0].url]: 404, [b.sources[1].url]: 403 };
  const results = await checkLinks(b, (async (url: string) => new Response(null, { status: statuses[url] ?? 200 })) as typeof fetch);
  assert.equal(results.find(r => r.url === b.sources[0].url)!.outcome, "DEAD");
  assert.equal(results.find(r => r.url === b.sources[1].url)!.outcome, "BLOCKED");
  assert.equal(results.filter(r => r.outcome === "OK").length, results.length - 2);
});

test("display trust ignores unreviewed facts and uses the latest review", () => {
  const f = (verificationStatus: "CONFIRMED" | "PENDING" | "TERMINATED" | undefined, reviewedAt?: string) => ({ state: "DOCUMENTED", scope: "s", sourceIds: ["x"], verificationStatus, reviewedAt });
  assert.deepEqual(relationshipTrust({}), { status: "UNREVIEWED" });
  assert.deepEqual(relationshipTrust({ facts: [f(undefined, "2026-09-15")] }), { status: "UNREVIEWED" });
  assert.deepEqual(relationshipTrust({ facts: [f(undefined, "2026-09-30"), f("CONFIRMED", "2026-09-24")] }), { status: "VERIFIED", reviewedAt: "2026-09-24" });
  assert.equal(relationshipTrust({ facts: [f("CONFIRMED", "2026-09-24"), f("PENDING", "2026-09-24")] }).status, "NEEDS_VERIFICATION");
  assert.equal(relationshipTrust({ facts: [f("PENDING", "2026-09-01"), f("CONFIRMED", "2026-09-24")] }).status, "VERIFIED");
  assert.equal(relationshipTrust({ facts: [f("TERMINATED", "2026-09-24")] }).status, "TERMINATED");
});
