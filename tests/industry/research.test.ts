import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRelationship, normalizeResearch, mergeResearchGraph, sourceUrl } from "../../src/lib/industry-research/model";
import { researchRequest, readResearchResponse } from "../../src/lib/industry-research/openai";
import { buildIndustryGraph, selectNeighborhood } from "../../src/lib/industry-graph/model";
import { createIndustryResearchService } from "../../src/lib/industry-research/service";
import type { Firestore } from "firebase-admin/firestore";
import { RESEARCH_SECTORS, resolveResearchTopic, researchTopicLabel } from "../../src/lib/industry-research/taxonomy";
import { MAP_ROLE_CORRECTIONS, roleCorrectionPatch } from "../../scripts/data/map-role-corrections";

test("reference taxonomy has 11 sectors, 74 unique industries, and validated parent codes", () => {
  assert.equal(RESEARCH_SECTORS.length, 11);
  const codes = RESEARCH_SECTORS.flatMap(s => s.industries.map(i => i[0]));
  assert.equal(codes.length, 74);
  assert.equal(new Set(codes).size, 74);
  for (const sector of RESEARCH_SECTORS) for (const [code] of sector.industries) {
    assert.ok(code.startsWith(sector.code));
    assert.equal(resolveResearchTopic("", { sectorCode: sector.code, industryCode: code }).industryCode, code);
  }
  assert.throws(() => resolveResearchTopic("AI", { sectorCode: "35", industryCode: "453010" }));
  assert.throws(() => resolveResearchTopic("", null));
  assert.throws(() => resolveResearchTopic("x".repeat(121)));
  assert.equal(researchTopicLabel(resolveResearchTopic("Cross-industry AI")), "Cross-industry AI");
});

test("role migration is idempotent and preserves explicitly classified metadata", () => {
  for (const company of MAP_ROLE_CORRECTIONS) {
    const patch = roleCorrectionPatch(undefined, company)!;
    assert.equal(patch.segment, company.segment);
    assert.equal(roleCorrectionPatch(patch, company), null);
    assert.equal(roleCorrectionPatch({ segment: "cloud" }, company), null);
    assert.equal(roleCorrectionPatch({ name: "Editorial name", segment: "other" }, company)?.name, undefined);
  }
});

const url = "https://www.amd.com/en/newsroom/example.html";
const companies = [{ ticker: "TSM", name: "TSMC", segment: "manufacturing" }, { ticker: "AMD", name: "AMD", segment: "compute" }];
const relation = { source: "TSM", target: "AMD", type: "SUPPLIER_OF", url, title: "Manufacturing announcement", summary: "TSMC manufactures chips for AMD.", sourceDate: "2025-01-01" };
test("inverse supplier/customer relationships and symmetric partners deduplicate", () => {
  assert.deepEqual(canonicalRelationship("TSM", "AMD", "SUPPLIER_OF"), canonicalRelationship("AMD", "TSM", "CUSTOMER_OF"));
  assert.deepEqual(canonicalRelationship("TSM", "AMD", "PARTNER_OF"), canonicalRelationship("AMD", "TSM", "PARTNER_OF"));
  assert.equal(canonicalRelationship("AMD", "AMD", "SUPPLIER_OF"), null);
  const result = normalizeResearch({ companies, relationships: [relation, { ...relation, source: "AMD", target: "TSM", type: "CUSTOMER_OF" }] }, [url]);
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].evidence.length, 1);
});
test("unsupported URLs, dangling endpoints and unsearched sources are withheld", () => {
  const relationships = [relation, { ...relation, target: "FAKE" }, { ...relation, url: "https://invented.example/page" }, { ...relation, url: "javascript:alert(1)" }];
  const result = normalizeResearch({ companies, relationships }, [url]);
  assert.equal(result.withheld, 3);
  for (const value of ["http://example.com", "https://127.0.0.1", "https://localhost", "https://user:secret@example.com", "https://host.internal", "file:///etc/passwd"]) assert.equal(sourceUrl(value), "");
});
test("research nodes join existing tickers without claiming filing coverage", () => {
  const result = normalizeResearch({ companies, relationships: [relation] }, [url]);
  const original = buildIndustryGraph({}, [result.companies[0]]);
  const graph = mergeResearchGraph(original, result.companies, result.relationships);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes.find(n => n.ticker === "TSM")?.id, "coverage:TSM");
  assert.equal(graph.nodes.find(n => n.ticker === "TSM")?.kind, "research");
  assert.equal(original.nodes[0].kind, "coverage");
  assert.deepEqual(graph.coveredTickers, []);
  assert.equal(graph.edges[0].evidence[0].sourceKind, "web");
  assert.equal(selectNeighborhood(graph, [], "all", false, true).edges.length, 1);
  assert.equal(mergeResearchGraph(graph, result.companies, result.relationships).edges.length, 1);
  const unknown = buildIndustryGraph({}, [{ ...result.companies[0], segment: "other" }]);
  assert.equal(mergeResearchGraph(unknown, result.companies, result.relationships).nodes[0].segment, "manufacturing");
});
test("research has bounded tool use and output, background processing and structured JSON", () => {
  const request = researchRequest("Semiconductors", []);
  assert.equal(request.background, true);
  assert.equal(request.max_tool_calls, 8);
  assert.equal(request.max_output_tokens, 12000);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.format.strict, true);
  assert.match(JSON.stringify(request.text.format.schema), /sourceTicker/);
  assert.match(JSON.stringify(request.text.format.schema), /never a publication title/);
});
test("provider provenance comes from tool output, not model-invented source lists", () => {
  const output = [{ type: "web_search_call", action: { sources: [{ url }] } }, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ companies, relationships: [relation] }) }] }];
  const parsed = readResearchResponse({ output });
  assert.equal(parsed.searchCalls, 1);
  assert.equal(normalizeResearch(parsed.data, parsed.sources).relationships.length, 1);
  assert.throws(() => readResearchResponse({ output: [] }));
});

function serviceFixture() {
  const data = new Map<string, Record<string, unknown>>();
  let calls = 0, usageEvents = 0;
  let providerStatus = "completed";
  function doc(path: string) {
    const get = async () => ({ exists: data.has(path), data: () => data.get(path) });
    const write = (value: Record<string, unknown>, merge = true) => {
      const next = { ...(merge ? data.get(path) : {}), ...value };
      if (path.startsWith("industry_research_limits/") && typeof value.count === "object") next.count = Number(data.get(path)?.count ?? 0) + 1;
      data.set(path, next);
    };
    return { path, get, set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => write(value, options?.merge), update: async (value: Record<string, unknown>) => write(value), write };
  }
  function collection(name: string) {
    const filters: Array<[string, unknown]> = [];
    let limit = 100;
    const query = {
      doc: (id: string) => doc(`${name}/${id}`),
      where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
      limit(value: number) { limit = value; return query; },
      orderBy() { return query; },
      async get() { return { docs: [...data].filter(([key, value]) => key.startsWith(`${name}/`) && filters.every(([k, v]) => value[k] === v)).slice(0, limit).map(([key, value]) => ({ id: key.split("/")[1], data: () => value })) }; },
    };
    return query;
  }
  const db = { collection, runTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = [];
    const result = await work({ get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      getAll: (...refs: Array<{ get: () => Promise<unknown> }>) => Promise.all(refs.map(r => r.get())),
      set: (ref: ReturnType<typeof doc>, value: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => ref.write(value, options?.merge)),
      update: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) => writes.push(() => ref.write(value)),
    });
    writes.forEach(write => write()); return result;
  } } as unknown as Firestore;
  const service = createIndustryResearchService(() => db, async (_path, body) => {
    if (body) { calls++; return { id: "resp_test", model: "gpt-5.4" }; }
    return { status: providerStatus, incomplete_details: { reason: "max_output_tokens" }, model: "gpt-5.4", usage: {}, output: [
      { type: "web_search_call", action: { sources: [{ url }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ companies, relationships: [relation] }) }] },
    ] };
  }, async () => { usageEvents++; return null; });
  return { data, service, calls: () => calls, usageEvents: () => usageEvents, fail: () => { providerStatus = "incomplete"; } };
}
const runId = "00000000-0000-4000-8000-000000000001";
test("categorized batches persist canonical labels and reject invalid categories without spending", async () => {
  const f = serviceFixture();
  await assert.rejects(f.service.startResearch("", runId, "admin", { sectorCode: "35", industryCode: "453010" }));
  assert.equal(f.calls(), 0);
  const run = await f.service.startResearch("AI infrastructure", runId, "admin", { sectorCode: "45", industryCode: "453010", sectorName: "forged" });
  assert.deepEqual(run?.topic, resolveResearchTopic("AI infrastructure", { sectorCode: "45", industryCode: "453010" }));
  await assert.rejects(f.service.startResearch("Different scope", runId, "admin"), /another topic/);
  assert.equal(f.calls(), 1);
  await f.service.refreshResearch(runId);
  for (const symbol of ["TSM", "AMD"]) f.data.set(`tickers/${symbol}`, { symbol, active: true, predictionSupported: true });
  await f.service.publishResearch(runId, ["TSM__SUPPLIER_OF__AMD"], "admin");
  const saved = f.data.get("industry_research_relationships/TSM__SUPPLIER_OF__AMD");
  assert.ok(saved?.researchIndustryCodes);
  assert.ok(saved?.researchSectorCodes);
});
test("paid submissions are idempotent, industry-locked and globally bounded", async () => {
  const f = serviceFixture();
  await f.service.startResearch("Semiconductors", runId, "admin");
  await f.service.startResearch("Semiconductors", runId, "admin");
  assert.equal(f.calls(), 1);
  await assert.rejects(f.service.startResearch("Semiconductors", runId.replace(/1$/, "2"), "admin"), /already has/);
  for (const n of [2, 3]) await f.service.startResearch(`Industry ${n}`, runId.replace(/1$/, String(n)), "admin");
  await assert.rejects(f.service.startResearch("Industry 4", runId.replace(/1$/, "4"), "admin"), /Daily research limit/);
});
test("refresh stores a private draft once; publishing requires listed companies and explicit selection", async () => {
  const f = serviceFixture();
  await f.service.startResearch("Semiconductors", runId, "admin");
  const draft = await f.service.refreshResearch(runId);
  assert.equal(draft?.status, "DRAFT");
  await f.service.refreshResearch(runId);
  assert.equal(f.usageEvents(), 1);
  assert.equal([...f.data.keys()].filter(k => k.startsWith("industry_research_relationships/")).length, 0);
  const id = "TSM__SUPPLIER_OF__AMD";
  await assert.rejects(f.service.publishResearch(runId, [id], "admin"), /supported active listing/);
  await assert.rejects(f.service.publishResearch(runId, ["bogus"], "admin"), /Unknown relationship/);
  for (const symbol of ["TSM", "AMD"]) f.data.set(`tickers/${symbol}`, { symbol, active: true, predictionSupported: true });
  await f.service.publishResearch(runId, [id], "admin");
  await f.service.publishResearch(runId, [id], "admin");
  const published = f.data.get(`industry_research_relationships/${id}`)!;
  assert.equal(published.status, "PUBLISHED");
  assert.equal((published.evidence as unknown[]).length, 1);
});
test("incomplete provider output does not publish or remove existing data", async () => {
  const f = serviceFixture();
  f.data.set("industry_research_relationships/existing", { status: "PUBLISHED" });
  await f.service.startResearch("Semiconductors", runId, "admin");
  f.fail();
  const failed = await f.service.refreshResearch(runId);
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.searchCalls, 1);
  assert.match(failed?.error, /max_output_tokens/);
  await f.service.refreshResearch(runId);
  assert.equal(f.calls(), 1);
  assert.equal(f.data.get("industry_research_relationships/existing")?.status, "PUBLISHED");
});
