import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { graphFromMarket, type MarketCompany, type MarketRelationship } from "../../src/lib/knowledge-graph/market-store";
import { loadNvidiaManufacturingProjection, projectNvidiaManufacturing } from "../../src/lib/knowledge-graph/nvidia-manufacturing-projection";
import { NVIDIA_EDITORIAL_COMPANIES, NVIDIA_MANUFACTURING_REVIEWED, NVIDIA_MANUFACTURING_SOURCE, nvidiaEditorialCompany } from "../../src/lib/research/nvidia-manufacturing";
import { companyResearchGraph } from "../../src/lib/knowledge-graph/company-research-projection";
import { buildCompanyResearch } from "../../src/lib/company-research";
import { relationshipBusiness, researchCompanyUrl } from "../../src/lib/knowledge-graph/research-view";
import { companyLinks } from "../../src/lib/research/deep-dives";

const id = "US:TSM__SUPPLIER_OF__US:NVDA";
const companies = (): MarketCompany[] => ["US:NVDA", "US:TSM", "US:MU"].map(id => ({
  id, name: id.slice(3), status: "PUBLISHED", inGraph: { status: "PUBLISHED", stageIds: [], stages: [], memberships: [], sources: [], order: 1, asOf: "2026-09-24" },
}));
const oldEdge = (): MarketRelationship => ({
  id, source: "US:TSM", target: "US:NVDA", type: "SUPPLIER_OF", status: "PUBLISHED", summary: "TSMC manufactures chips for NVIDIA.", commercialStatus: "DOCUMENTED",
  evidence: [{ id: "old", title: "Earlier manufacturing evidence", sourceDate: "2024-01-01", url: "https://example.com/old" }],
});

test("NVIDIA's company card and map get FY2026 manufacturing evidence without losing old data", () => {
  const inputCompanies = companies(), inputRecords = [oldEdge()], before = structuredClone([inputCompanies, inputRecords]);
  const projected = projectNvidiaManufacturing(inputCompanies, inputRecords);
  assert.deepEqual([inputCompanies, inputRecords], before);
  const graph = graphFromMarket(projected.companies, projected.records);
  const tsm = graph.relationships.find(edge => edge.id === id)!;
  assert.match(tsm.facts![0].scope, /TSMC.*wafer foundry/);
  assert.match(tsm.facts![0].scope, /Separately.*CoWoS/);
  assert.match(tsm.facts![0].limitation!, /does not allocate CoWoS/);
  assert.match(relationshipBusiness(tsm, false), /CoWoS/);
  assert(graph.sources.some(source => source.url === "https://example.com/old"));
  assert(graph.sources.some(source => source.url === NVIDIA_MANUFACTURING_SOURCE.url && source.sourceDate === "2026-02-25"));
  assert.equal(tsm.facts![0].editorialReviewedAt, NVIDIA_MANUFACTURING_REVIEWED);
  assert.equal(tsm.publishedAt, undefined, "reviewing old evidence must not manufacture a publication event");
  for (const supplier of ["US:MU", "US:SKHY", "ORG:SAMSUNG-ELECTRONICS"]) {
    const edge = graph.relationships.find(edge => edge.source === supplier && edge.target === "US:NVDA")!;
    assert.match(edge.facts![0].limitation!, /does not identify HBM generations, qualification/);
    assert.doesNotMatch(edge.facts![0].scope, /HBM4|Vera Rubin/);
  }
  assert.deepEqual(projectNvidiaManufacturing(projected.companies, projected.records), projected);
});

test("canonical SK hynix and Samsung profiles exist and use consistent directory and map links", () => {
  const projected = projectNvidiaManufacturing(companies(), []), graph = graphFromMarket(projected.companies, projected.records);
  const expected = { "US:SKHY": "/ticker/SKHY", "ORG:SAMSUNG-ELECTRONICS": "/company/ORG%3ASAMSUNG-ELECTRONICS" };
  for (const [id, page] of Object.entries(expected)) {
    const node = graph.nodes.find(node => node.id === id)!;
    assert(node);
    assert.equal(node.editorialReviewedAt, NVIDIA_MANUFACTURING_REVIEWED);
    assert.equal(researchCompanyUrl(node), page);
    assert.equal(companyLinks(id, "/en")?.page, `/en${page}`);
    assert.equal(nvidiaEditorialCompany(id, undefined)?.name, node.name);
    assert(node.sourceIds!.some(source => graph.sources.some(item => item.id === source && /listing/i.test(item.title))));
  }
  const sk = buildCompanyResearch("SKHY", [], companyResearchGraph(graph));
  assert.equal(sk.name, "SK hynix");
  assert.equal(sk.known, true);
  assert.equal(sk.connections.length, 1);
});

test("existing company records always win; hidden identities and graph memberships are never revived", () => {
  for (const status of ["WITHDRAWN", "ARCHIVED", "DRAFT"]) {
    const hidden = { ...NVIDIA_EDITORIAL_COMPANIES[0], status, description: "An editor withdrew this profile" };
    assert.equal(nvidiaEditorialCompany(hidden.id, hidden), hidden);
    const projected = projectNvidiaManufacturing([...companies(), hidden], []);
    assert.equal(projected.companies.find(company => company.id === hidden.id), hidden);
    assert(!projected.records.some(edge => edge.source === hidden.id));
    assert(!graphFromMarket(projected.companies, projected.records).nodes.some(node => node.id === hidden.id));
  }
  const publicRemote = { ...NVIDIA_EDITORIAL_COMPANIES[1], name: "Remote approved name", description: "Remote approved description", editorialReviewedAt: undefined };
  assert.equal(nvidiaEditorialCompany(publicRemote.id, publicRemote), publicRemote);
  assert.equal(nvidiaEditorialCompany(publicRemote.id, {} )?.name, undefined);
  assert.equal(nvidiaEditorialCompany("ORG:UNKNOWN", undefined), undefined);
  const hiddenMembership = { ...publicRemote, inGraph: { ...publicRemote.inGraph!, status: "WITHDRAWN" } } as unknown as MarketCompany;
  assert(!projectNvidiaManufacturing([...companies(), hiddenMembership], []).records.some(edge => edge.source === hiddenMembership.id));
  const noNvidia = companies().filter(company => company.id !== "US:NVDA");
  assert.deepEqual(projectNvidiaManufacturing(noNvidia, []), { companies: noNvidia, records: [] });
});

test("suppressed, conflicting, duplicated, pending, terminated and newer-reviewed remote relationships are untouched", () => {
  const skip = (records: MarketRelationship[]) => {
    const result = projectNvidiaManufacturing(companies(), records);
    for (const remote of records) assert.equal(result.records.find(item => item.id === remote.id), remote);
    assert.equal(result.records.filter(item => item.source === "US:TSM" && item.target === "US:NVDA").length, records.filter(item => item.source === "US:TSM" && item.target === "US:NVDA").length);
  };
  for (const status of ["DRAFT", "WITHDRAWN", "ARCHIVED"]) skip([{ ...oldEdge(), status }]);
  skip([{ ...oldEdge(), researchReviewedAt: "2026-10-02" }]);
  skip([{ ...oldEdge(), researchReviewedAt: NVIDIA_MANUFACTURING_REVIEWED }]);
  for (const verificationStatus of ["PENDING", "TERMINATED", "CONFIRMED"]) skip([{ ...oldEdge(), researchFacts: [{ scope: "Remote review", state: "DOCUMENTED", sourceIds: ["old"], verificationStatus, reviewedAt: verificationStatus === "CONFIRMED" ? "2026-10-02" : "2026-09-24" }] }]);
  skip([oldEdge(), { ...oldEdge(), id: "legacy-row" }]);
  const inverse: MarketRelationship = { ...oldEdge(), id: "inverse-withdrawn", type: "CUSTOMER_OF", source: "US:NVDA", target: "US:TSM", status: "WITHDRAWN" };
  assert(!projectNvidiaManufacturing(companies(), [inverse]).records.some(edge => edge.id === id));
  const conflict = { ...oldEdge(), target: "US:AMD" };
  assert.equal(projectNvidiaManufacturing(companies(), [conflict]).records.find(edge => edge.id === id), conflict);
});

test("malformed authoritative facts are preserved without crashing projection or replacing reviews", () => {
  for (const researchFacts of [[null], ["bad fact"], [7], [false], [[]], { verificationStatus: "TERMINATED" }]) {
    const remote = { ...oldEdge(), researchFacts };
    const projected = projectNvidiaManufacturing(companies(), [remote]);
    assert.equal(projected.records.find(edge => edge.id === id), remote);
    assert.doesNotThrow(() => graphFromMarket(projected.companies, projected.records));
  }
});

test("an older confirmed review is preserved alongside the separately labeled editorial fact", () => {
  const old = { ...oldEdge(), researchFacts: [{ id: "remote", scope: "Reviewed manufacturing", state: "DOCUMENTED", sourceIds: ["old"], reviewedAt: "2026-09-24", verificationStatus: "CONFIRMED" }], publishedAt: "2024-01-01T00:00:00Z" };
  const projected = projectNvidiaManufacturing(companies(), [old]);
  const edge = projected.records.find(edge => edge.id === id)!;
  assert.deepEqual((edge.researchFacts as unknown[])[0], old.researchFacts[0]);
  assert.equal(edge.publishedAt, old.publishedAt);
  assert.equal((edge.researchFacts as unknown[]).length, 2);
});

function database(fail = false) {
  const queries: string[] = [];
  const hidden = { ...NVIDIA_EDITORIAL_COMPANIES[0], status: "ARCHIVED" };
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ id }),
      where: (field: string, op: string, value: string) => ({ get: async () => {
        queries.push(`${name}:${field}:${op}:${value}`);
        if (fail) throw new Error("Firestore unavailable");
        return { docs: field === "target" ? [{ id, data: () => ({ ...oldEdge(), status: "WITHDRAWN" }) }] : [] };
      } }),
    }),
    getAll: async (...refs: { id: string }[]) => refs.map(ref => ({ id: ref.id, exists: ref.id === hidden.id, data: () => ref.id === hidden.id ? hidden : undefined })),
  } as unknown as Firestore;
  return { db, queries };
}

test("runtime reads exact company identities and all relationship statuses; unavailable reads never fall back", async () => {
  const { db, queries } = database();
  const projected = await loadNvidiaManufacturingProjection(db, companies(), [oldEdge()]);
  assert.equal(projected.companies.find(company => company.id === "US:SKHY")?.status, "ARCHIVED");
  assert.equal(projected.records.find(edge => edge.id === id)?.status, "WITHDRAWN");
  assert.deepEqual(queries.sort(), ["company_relationships:source:==:US:NVDA", "company_relationships:target:==:US:NVDA"]);
  await assert.rejects(loadNvidiaManufacturingProjection(database(true).db, companies(), []), /Firestore unavailable/);
});

test("runtime preserves a hidden exact canonical document even when its endpoints miss NVIDIA queries", async () => {
  const hidden = { status: "WITHDRAWN", source: "US:TSM", target: "US:AMD", type: "SUPPLIER_OF", summary: "Requires identity review" };
  const db = {
    collection: () => ({ doc: (id: string) => ({ id }), where: () => ({ get: async () => ({ docs: [] }) }) }),
    getAll: async (...refs: { id: string }[]) => refs.map(ref => ({ id: ref.id, exists: ref.id === id, data: () => ref.id === id ? hidden : undefined })),
  } as unknown as Firestore;
  const projected = await loadNvidiaManufacturingProjection(db, companies(), []);
  assert.deepEqual(projected.records.find(row => row.id === id), { ...hidden, id });
  const graph = graphFromMarket(projected.companies, projected.records);
  assert(!graph.relationships.some(edge => edge.source === "US:TSM" && edge.target === "US:NVDA"));
});

test("follow API accepts missing editorial profiles but rejects hidden/invalid remote profiles and failed reads", async () => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const records = new Map<string, Record<string, unknown>>();
  let failed = false, writes = 0;
  const fixture = { db: { collection: () => ({ doc: (id: string) => ({ get: async () => {
    if (failed) throw new Error("Unavailable");
    return { exists: records.has(id), data: () => records.get(id) };
  } }) }) }, update: async () => { writes++; return []; } };
  const result = await build({ entryPoints: ["src/app/api/map-follows/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "no-live-services", setup(builder) {
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: "export const getAdminFirestore = () => fixture.db; export const verifyIdToken = async () => ({uid:'test'});", loader: "js" }));
    builder.onLoad({ filter: /company-follows-store\.ts$/ }, () => ({ contents: "export const readCompanyFollows = async () => []; export const updateCompanyFollow = fixture.update;", loader: "js" }));
  } }] });
  const testModule = { exports: {} as { PATCH: (request: Request) => Promise<Response> } };
  new Function("fixture", "require", "module", result.outputFiles[0].text)(fixture, createRequire(import.meta.url), testModule);
  const request = (companyId: string) => new Request("https://example.com/api/map-follows", { method: "PATCH", headers: { authorization: "Bearer fake" }, body: JSON.stringify({ companyId, follow: true }) });
  for (const company of NVIDIA_EDITORIAL_COMPANIES) assert.equal((await testModule.exports.PATCH(request(company.id))).status, 200);
  assert.equal(writes, 2);
  for (const row of [{ status: "WITHDRAWN", name: "Hidden" }, { status: "DIRECTORY" }, {}]) {
    records.set("US:SKHY", row);
    assert.equal((await testModule.exports.PATCH(request("US:SKHY"))).status, 404);
  }
  assert.equal(writes, 2);
  failed = true;
  assert.equal((await testModule.exports.PATCH(request("ORG:SAMSUNG-ELECTRONICS"))).status, 503);
  assert.equal(writes, 2);
});
