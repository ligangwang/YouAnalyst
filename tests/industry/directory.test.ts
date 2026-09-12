import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { buildIndustryGraph } from "../../src/lib/industry-graph/model";
import { createIndustryGraphLoader } from "../../src/lib/industry-graph/service";
import { readMapCompany, readMapOptions, MAP_PAGE_SIZE } from "../../src/lib/industry-graph/directory";
import { buildCompanyResearch } from "../../src/lib/company-research";
import { runFixture } from "./fixtures";

test("published companies enter without an editorial entry; empty data fabricates no starters", () => {
  assert.equal(buildIndustryGraph({}).nodes.length, 0);
  const run = runFixture("CRM", "0001108524", "Salesforce", [{ targetName: "Example Supplier" }]);
  const graph = buildIndustryGraph({ CRM: run });
  assert.deepEqual(graph.coveredTickers, ["CRM"]);
  assert.equal(graph.nodes[0].name, "Salesforce");
  assert.equal(graph.nodes[0].segment, "other");
  assert.equal(graph.edges.length, 1);
  assert.equal(buildCompanyResearch("CRM", [], graph).inMap, true);
  assert.equal(buildIndustryGraph({ CRM: { ...run, status: "FAILED" } }).nodes.length, 0);
  assert.equal(buildIndustryGraph({ CRM: { ...run, result: { ...run.result, dryRun: true } } }).nodes.length, 0);
});

test("database metadata controls names, aliases and grouping without inventing classifications", () => {
  const company = readMapCompany("CRM", { name: "Salesforce", aliases: ["Salesforce Inc", null], segment: "cloud" })!;
  const graph = buildIndustryGraph({}, [company]);
  assert.equal(graph.nodes[0].segment, "cloud");
  assert.deepEqual(graph.nodes[0].aliases, ["Salesforce Inc"]);
  assert.equal(readMapCompany("CRM", { name: "Salesforce", segment: "fiction" })?.segment, "other");
  assert.equal(readMapCompany("../BAD", { name: "Bad" }), null);
});

test("map query normalizes ticker input and rejects invalid cursors", () => {
  assert.deepEqual(readMapOptions(new URLSearchParams("company=%24crm&after=NVDA_latest_10k")), { ticker: "CRM", after: "NVDA_latest_10k" });
  for (const input of ["company=../bad", "after=../bad", `after=${"A".repeat(101)}`]) {
    assert.throws(() => readMapOptions(new URLSearchParams(input)));
  }
});

function databaseFixture() {
  const reads: number[] = [];
  let requests = 0;
  const records: Record<string, Record<string, Record<string, unknown>>> = {
    company_research_runs: Object.fromEntries(Array.from({ length: 25 }, (_, i) => {
      const ticker = `A${String(i).padStart(2, "0")}`;
      return [`${ticker}_latest_10k`, runFixture(ticker, String(i + 1).padStart(10, "0"), `Issuer ${i}`)];
    })),
    industry_map_companies: { TSM: { name: "TSMC", segment: "manufacturing", featured: true, filingForm: "20-F" } },
    tickers: {},
  };
  records.company_research_runs.CRM_latest_10k = runFixture("CRM", "0001108524", "Salesforce", [{ targetName: "Example Supplier" }]);
  function collection(name: string) {
    let items = Object.entries(records[name] ?? {}).sort(([a], [b]) => a.localeCompare(b));
    let limit = Infinity;
    const query = {
      where(field: string, _operator: string, value: unknown) { items = items.filter(([, data]) => data[field] === value); return query; },
      orderBy() { return query; },
      startAfter(id: string) { items = items.filter(([key]) => key > id); return query; },
      limit(value: number) { limit = value; return query; },
      async get() { requests++; reads.push(limit); return { docs: items.slice(0, limit).map(([id, data]) => ({ id, data: () => data })) }; },
      doc(id: string) { return { id, async get() { requests++; const data = records[name]?.[id]; return { id, exists: Boolean(data), data: () => data }; } }; },
    };
    return query;
  }
  const db = { collection, async getAll(...refs: Array<{ get: () => Promise<unknown> }>) { return Promise.all(refs.map((ref) => ref.get())); } } as unknown as Firestore;
  return { db, reads, requests: () => requests };
}

test("repository pages beyond the first batch, loads direct tickers and caches by request", async () => {
  const fixture = databaseFixture();
  const load = createIndustryGraphLoader(() => fixture.db);
  const first = await load();
  assert.equal(first.coveredTickers.length, MAP_PAGE_SIZE);
  assert.equal(first.nextCursor, "A19_latest_10k");
  assert.ok(!first.coveredTickers.includes("CRM"));
  const reads = fixture.requests();
  assert.strictEqual(await load(), first);
  assert.equal(fixture.requests(), reads);
  const second = await load({ after: first.nextCursor! });
  assert.ok(second.coveredTickers.includes("CRM"));
  assert.equal(second.nextCursor, null);
  assert.ok(!second.coveredTickers.includes("A00"));
  const direct = await load({ ticker: "CRM" });
  assert.ok(direct.coveredTickers.includes("CRM"));
  assert.equal(direct.requestedTicker, "CRM");
  assert.ok(fixture.reads.every(Number.isFinite));
});

test("repository failures do not become a cached empty success", async () => {
  const fixture = databaseFixture();
  let failed = true;
  const load = createIndustryGraphLoader(() => { if (failed) throw new Error("offline"); return fixture.db; });
  await assert.rejects(load(), /offline/);
  failed = false;
  assert.ok((await load()).coveredTickers.length > 0);
});
