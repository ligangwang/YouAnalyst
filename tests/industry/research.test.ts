import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRelationship, normalizeResearch, mergeResearchGraph, sourceUrl } from "../../src/lib/industry-research/model";
import { buildIndustryGraph, selectNeighborhood } from "../../src/lib/industry-graph/model";
import type { Firestore } from "firebase-admin/firestore";
import { RESEARCH_SECTORS, resolveResearchTopic, researchTopicLabel } from "../../src/lib/industry-research/taxonomy";
import { normalizeChinaCompany, normalizeChinaResearch, validChinaId, MARKET_COMPANIES } from "../../src/lib/industry-research/china";
import { seedChinaCompanies, listChinaCompanies } from "../../src/lib/industry-research/china-directory";
import { chinaSupplyChain } from "../../src/lib/industry-graph/china";
import { importCniDirectory } from "../../src/lib/industry-research/directory-sync";
import { normalizeChinaConnections } from "../../src/lib/industry-research/china-connections";

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
function directoryFixture() {
  const data = new Map<string, Record<string, unknown>>();
  function doc(path: string) {
    const get = async () => ({ exists: data.has(path), data: () => data.get(path) });
    const write = (value: Record<string, unknown>, merge = true) => {
      const next = { ...(merge ? data.get(path) : {}), ...value };
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
  return { db, data };
}

test("A-share seed is idempotent and preserves editorial changes and archived records", async () => {
  const f = directoryFixture();
  assert.deepEqual(await seedChinaCompanies(f.db, "admin"), { created: 5, preserved: 0 });
  const path = `${MARKET_COMPANIES}/${chinaSupplyChain[0].id}`;
  f.data.set(path, { ...f.data.get(path), name: "Edited name", status: "ARCHIVED" });
  assert.deepEqual(await seedChinaCompanies(f.db, "admin"), { created: 0, preserved: 5 });
  assert.equal(f.data.get(path)?.name, "Edited name");
  assert.equal(f.data.get(path)?.status, "ARCHIVED");
});

test("public A-share directory returns only published CN profiles and validates cursors", async () => {
  const calls: unknown[][] = [];
  const company = chinaSupplyChain[0];
  const documents = [
    { ...company, market: "CN_A", status: "PUBLISHED", reviewedBy: "private-admin" },
    { ...company, market: "CN_A", status: "DRAFT" },
    { ...company, market: "US", status: "PUBLISHED" },
    { ...company, market: "CN_A", status: "ARCHIVED" },
    { ...company, market: "CN_A", status: "PUBLISHED", source: "javascript:alert(1)" },
  ];
  const query = {
    orderBy() { return query; }, startAt(value: string) { calls.push(["start", value]); return query; },
    endBefore(value: string) { calls.push(["end", value]); return query; }, limit(value: number) { calls.push(["limit", value]); return query; },
    startAfter(value: string) { calls.push(["after", value]); return query; },
    async get() { return { size: documents.length, docs: documents.map(data => ({ id: data.id, data: () => data })) }; },
  };
  const db = { collection: () => query } as unknown as Firestore;
  const result = await listChinaCompanies(db, "XSHG:601138");
  assert.deepEqual(result.items, [{ ...normalizeChinaCompany(company), names: { en: "Hygon Information", "zh-CN": "海光信息" } }]);
  assert.equal(result.nextCursor, null);
  assert.ok(calls.some(c => c[0] === "after" && c[1] === "XSHG:601138"));
  await assert.rejects(listChinaCompanies(db, "US:AMD"), /Invalid company cursor/);
});

test("CNI import preserves profiles without enqueueing retired AI research, and replays safely", async () => {
  const f = directoryFixture();
  const companies = Array.from({ length: 4001 }, (_, i) => ({ id: `XSHG:${600000+i}`, name: `公司${i}`, legalName: `公司${i}`, classification: ['C08','C0803','C080301','C08030101'].map(code => ({code,name:code})) }));
  const payload = { source: "https://www.cnindex.com.cn/zh_information/data_resource/fljg/202605/test.xlsx", snapshot: "2026-6", sha256: "a".repeat(64), companies };
  f.data.set(`industry_research_candidates/XSHG:600000`, { id: "XSHG:600000", status: "DRAFT", attempts: 2, name: "Editorial" });
  f.data.set("companies/XSHG:600001", { name: "Published", status: "PUBLISHED" });
  assert.equal((await importCniDirectory(f.db, payload)).count,4001);
  assert.equal(f.data.get(`industry_research_candidates/XSHG:600000`)?.status,"DRAFT");
  assert.equal(f.data.has("industry_research_candidates/XSHG:600001"),false);
  assert.equal(f.data.has("industry_research_candidates/XSHG:604000"),false);
  assert.equal(f.data.get("companies/XSHG:600001")?.name,"Published");
  assert.equal((await importCniDirectory(f.db,payload)).unchanged,true);
  await assert.rejects(importCniDirectory(f.db,{...payload,snapshot:"2025-6",sha256:"b".repeat(64)}),/older/);
  await assert.rejects(importCniDirectory(f.db,{...payload,companies:companies.slice(0,5)}),/Invalid directory/);
});

test("connections support directory IDs beyond the first 30 and reject unsourced or unknown endpoints", () => {
  const candidates = Array.from({length:175},(_,i)=>({id:`XSHG:${600000+i}`,name:`公司${i}`}));
  const edge = {source:candidates[170].id,target:candidates[174].id,type:"CUSTOMER_OF",url,title:"公司公告",summary:"采购关系",sourceDate:null};
  const result=normalizeChinaConnections({relationships:[edge,{...edge,url:"https://unseen.example/report"},{...edge,target:"XSHE:399999"}]},[url],candidates);
  assert.equal(result.relationships.length,1); assert.equal(result.withheld,2);
  assert.equal(result.relationships[0].source,candidates[174].id);
  assert.equal(result.relationships[0].target,candidates[170].id);
});


test("retired US and A-share research APIs reject reads and launches without initializing a provider", async () => {
  for (const path of ["../../src/app/api/admin/company-research/route", "../../src/app/api/admin/industry-research/route"]) {
    const route = await import(path);
    for (const handle of [route.GET, route.POST]) {
      const response = await handle();
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match((await response.json()).error, /retired/);
    }
  }
});

test("A-share research requires exchange-qualified stock IDs, Chinese fields and searched evidence", () => {
  for (const id of ["688041", "AMD", "XSHG:900001", "XSHE:200001", "XHKG:00700", "XSHG:002837", "XSHE:688041"]) assert.equal(validChinaId(id), false);
  const company = chinaSupplyChain[0];
  const result = normalizeChinaResearch({ companies: [company, company, { ...company, id: "AMD" }, { ...chinaSupplyChain[1], description: "" }, chinaSupplyChain[2]] }, [company.source]);
  assert.equal(result.chinaCompanies.length, 1);
  assert.equal(result.withheld, 4);
  assert.equal(result.relationships.length, 0);
});
