import { test } from "node:test";
import assert from "node:assert/strict";
import { companyFollowIntent, companyFollowSignIn } from "../../src/lib/company-follow-intent";
import { companyUpdates } from "../../src/lib/knowledge-graph/company-updates";
import { graphFromMarket, type MarketRelationship } from "../../src/lib/knowledge-graph/market-store";
import { mergeEdge, type ComputeBatch } from "../../src/lib/research/publisher";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { relationshipExplanation, relationshipGroup, relationshipBusiness, relationAnchor, researchCompanyUrl } from "../../src/lib/knowledge-graph/research-view";
import { updateReasons, type BusinessEvent } from "../../src/lib/knowledge-graph/business-events";
import { relationshipVerification } from "../../src/lib/knowledge-graph/relationship-status";
import { curatedEvents } from "../../src/lib/knowledge-graph/curated-events";
import { validateInput } from "../../src/lib/research/batches";

test("research API retains explicit verification and dates, refreshes without duplicating facts", () => {
  const input: ComputeBatch = {batchId:"verification-test",asOf:"2026-09-14",sources:[{id:"s",title:"Disclosure",url:"https://example.com",sourceDate:"2026-09-01",retrievedAt:"2026-09-14"}],relationships:[{source:"US:AMD",target:"ORG:OPENAI",type:"SUPPLIER_OF",facts:[{state:"DOCUMENTED",scope:"Deployment",limitation:"Specific scope only",sourceIds:["s"],verificationStatus:"CONFIRMED",eventDate:"2026-09-01"}]}]};
  const batch=validateInput(input), edge=mergeEdge(batch,batch.relationships[0],null);
  assert.equal(batch.relationships[0].facts[0].verificationStatus,"CONFIRMED");
  const later={...batch,batchId:"verification-later",asOf:"2026-09-15"};
  const refreshed=mergeEdge(later,later.relationships[0],edge);
  assert.equal(refreshed.researchFacts?.length,1);
  assert.equal(refreshed.researchFacts?.[0].reviewedAt,"2026-09-15");
  assert.equal(refreshed.researchFacts?.[0].eventDate,"2026-09-01");
  assert.deepEqual(mergeEdge(later,later.relationships[0],refreshed),refreshed);
  assert.throws(()=>validateInput({...input,relationships:[{...input.relationships[0],facts:[{...input.relationships[0].facts[0],eventDate:"2026-02-30"}]}]}));
});

test("one-hop events deduplicate multiple follows without inferring an event relationship", () => {
  const event: BusinessEvent = { id:"capacity", category:"CAPACITY", companyIds:["ORG:OPENAI"], eventDate:"2024-01-01", sourceDate:"2024-01-02", collectedAt:"2026-09-15", title:"Capacity", titleZh:"扩产", summary:"Company expansion", summaryZh:"公司扩产", sourceTitle:"Disclosure", sourceUrl:"https://example.com/source", planned:true };
  const updates = companyUpdates(graph, ["US:AMD", "ORG:OPENAI"], [event]).filter(i => i.kind === "BUSINESS");
  assert.equal(updates.length,1);
  assert.equal(updates[0].edgeId,undefined);
  assert.equal(updates[0].eventDate,"2024-01-01");
  assert.equal(updates[0].reasons?.length,2);
  assert.equal(updates[0].reasons?.[0].role,"customer");
  assert.match(updates[0].href,/event=capacity/);
  assert.doesNotMatch(updates[0].href,/relationship=/);
  assert.deepEqual(updateReasons({...graph,relationships:graph.relationships.map(e=>({...e,type:"PARTNER_OF"}))},["US:AMD"],["ORG:OPENAI"]),[]);
  const twoHop = {...graph,relationships:[...graph.relationships,{...graph.relationships[0],id:"next",source:"ORG:OPENAI",target:"US:NVDA"}]};
  assert.deepEqual(updateReasons(twoHop,["US:AMD"],["US:NVDA"]),[]);
});

test("legacy evidence is not automatically current; terminated links do not propagate events", () => {
  assert.equal(relationshipVerification(graph.relationships[0]),"PENDING");
  const terminated = {...graph.relationships[0],facts:[{...graph.relationships[0].facts![0],verificationStatus:"TERMINATED" as const}]};
  assert.equal(relationshipVerification(terminated),"TERMINATED");
  assert.deepEqual(updateReasons({...graph,relationships:[terminated]},["US:AMD"],["ORG:OPENAI"]),[]);
});

test("editorial starter events have distinct identities, primary sources and separate dates", () => {
  assert.equal(new Set(curatedEvents.map(e=>e.id)).size,curatedEvents.length);
  assert.deepEqual(new Set(curatedEvents.map(e=>e.category)),new Set(["ORDER","CAPACITY","PRODUCT","PARTNERSHIP"]));
  for(const e of curatedEvents) {
    assert.ok(e.sourceUrl.startsWith("https://"));
    assert.ok(e.sourceDate <= e.collectedAt);
    assert.ok(e.eventDate === null || e.eventDate <= e.collectedAt);
    assert.ok(e.titleZh && e.summaryZh);
  }
});

const graph: KnowledgeGraph = { asOf: "2026-09-15", nodes: ["US:AMD", "US:NVDA", "ORG:OPENAI"].map(id => ({ id, kind: "COMPANY", name: id, market: id.startsWith("US:") ? "US" : "GLOBAL", order: 1 })), sources: [{ id: "source", title: "Historic announcement", url: "https://example.com/announcement", sourceDate: "2024-01-01" }], relationships: [{ id: "edge", source: "US:AMD", target: "ORG:OPENAI", type: "SUPPLIER_OF", summary: "Planned GPU capacity", commercialStatus: "ANNOUNCED", publishedAt: "2026-09-15T12:00:00Z", sourceIds: ["source"], facts: [{ id: "fact", scope: "Planned GPU capacity", state: "ANNOUNCED", reviewedAt: "2026-09-15", sourceIds: ["source"] }] }] };

test("company follow intent preserves localized route, company, filters and anchor", () => {
  for (const id of ["US:AMD", "XSHG:600584", "ORG:OPENAI"]) {
    const destination = `/zh-cn/ticker/AMD?tab=research#${relationAnchor("edge:one")}`;
    const auth = new URL(companyFollowSignIn(id, destination), "https://test.invalid");
    assert.deepEqual(companyFollowIntent(auth.searchParams.get("next")), { companyId: id, destination });
  }
  for (const path of ["https://evil.test/?followCompany=US:AMD", "//evil.test/?followCompany=US:AMD", "/?followCompany=../bob"]) assert.equal(companyFollowIntent(path), null);
});
test("updates match either endpoint once and never turn collection date into event date", () => {
  assert.deepEqual(companyUpdates(graph, ["US:NVDA"]), []);
  const updates = companyUpdates(graph, ["US:AMD", "ORG:OPENAI"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].eventDate, null);
  assert.equal(updates[0].sourceDate, "2024-01-01");
  assert.equal(updates[0].collectedAt, "2026-09-15");
  assert.equal(updates[0].state, "ANNOUNCED");
  assert.equal(updates[0].href, `/ticker/AMD#${relationAnchor("edge")}`);
  const noSources = { ...graph, sources: [] };
  assert.deepEqual(companyUpdates(noSources, ["US:AMD"]), []);
});
test("relationship categories follow supply direction and explain it in Chinese", () => {
  const e = graph.relationships[0];
  assert.equal(relationshipGroup(e, "US:AMD"), "customers");
  assert.equal(relationshipGroup(e, "ORG:OPENAI"), "suppliers");
  assert.match(relationshipExplanation(e, graph, true), /提供产品或服务/);
  assert.match(relationshipExplanation(e, graph, true), /计划/);
  for (const type of ["CUSTOMER_OF", "INTEGRATES_TECHNOLOGY_FROM", "ECOSYSTEM_PARTNER_OF"] as const) {
    assert.match(relationshipExplanation({ ...e, type }, graph, true), /计划/);
  }
  assert.equal(relationshipBusiness({ ...e, facts: [{ ...e.facts![0], scope: "Instinct MI450 with liquid cooling" }] }, true), "Instinct MI450 / 散热与温控");
  assert.equal(researchCompanyUrl({ id: "XSHG:600584" }), "/ticker/XSHG:600584");
  assert.equal(researchCompanyUrl({ id: "ORG:OPENAI" }), "/company/ORG%3AOPENAI");
});
test("public graph exposes only sourced research facts, without arbitrary private fields", () => {
  const node = { id: "US:AMD", status: "PUBLISHED", name: "AMD", aiGraph: { status: "PUBLISHED" as const, stageIds: ["compute"], stages: [], memberships: [], sources: [], order: 1, asOf: "2026-09-15" } };
  const result = graphFromMarket([node, { id: "ORG:OPENAI", status: "DIRECTORY", name: "OpenAI" }], [{ ...graph.relationships[0], status: "PUBLISHED", evidence: graph.sources, researchFacts: [{ ...graph.relationships[0].facts![0], privateNote: "secret" }, { scope: "unsupported", state: "DOCUMENTED", sourceIds: ["missing"] }] }]);
  assert.equal(result.relationships[0].facts?.length, 1);
  assert.equal(JSON.stringify(result).includes("privateNote"), false);
  assert.equal(JSON.stringify(result).includes("unsupported"), false);
});

test("product summaries exclude negated products and business claims in source scopes", () => {
  const e = graph.relationships[0];
  const business = (scope: string) => relationshipBusiness({ ...e, facts: [{ ...e.facts![0], scope }] }, true);
  assert.equal(business("Google Cloud EPYC virtual machines; not TPU or GPU supply"), "EPYC / 云服务");
  assert.equal(business("EPYC, not TPU supply"), "EPYC");
  assert.equal(business("EPYC; TPU supply is not confirmed"), "EPYC");
  assert.equal(business("EPYC 虚拟机；不涉及 TPU 或 GPU 供货"), "EPYC");
  for (const scope of ["EPYC virtual machines without TPU supply", "EPYC rather than TPU", "Supplies EPYC but not GPUs", "EPYC 而非 TPU"]) assert.equal(business(scope), "EPYC");
  assert.equal(business("Plans to deploy 6 GW of AMD GPUs"), "GPUs");
  assert.equal(business("Unconfirmed GPU supply"), "相关产品或业务详见来源说明");
});

test("published research retains each fact's status, scope, limitation and original review date", () => {
  const batch: ComputeBatch = { batchId: "follow-test", asOf: "2026-09-14", sources: [{ ...graph.sources[0], retrievedAt: "2026-09-14" }], relationships: [{ source: "US:AMD", target: "ORG:OPENAI", type: "SUPPLIER_OF", facts: [{ state: "DOCUMENTED", scope: "Existing EPYC deployment", limitation: "CPU only", sourceIds: ["source"] }] }] };
  const previous = mergeEdge(batch, batch.relationships[0], null);
  const next = { ...batch, asOf: "2026-09-15", relationships: [{ ...batch.relationships[0], facts: [{ state: "ANNOUNCED" as const, scope: "Planned Instinct MI450 capacity", limitation: "No delivery confirmation", sourceIds: ["source"] }] }] };
  const record = mergeEdge(next, next.relationships[0], previous) as MarketRelationship;
  const projected = graphFromMarket([{ id: "US:AMD", name: "AMD", status: "PUBLISHED", aiGraph: { status: "PUBLISHED", stageIds: ["compute"], stages: [], memberships: [], sources: [], order: 1, asOf: next.asOf } }, { id: "ORG:OPENAI", name: "OpenAI", status: "DIRECTORY" }], [record]);
  assert.equal(projected.relationships[0].facts?.length, 2);
  assert.deepEqual(projected.relationships[0].facts?.map(f => [f.state, f.scope, f.limitation, f.reviewedAt]), [
    ["DOCUMENTED", "Existing EPYC deployment", "CPU only", "2026-09-14"],
    ["ANNOUNCED", "Planned Instinct MI450 capacity", "No delivery confirmation", "2026-09-15"],
  ]);
  const updates = companyUpdates(projected, ["US:AMD", "ORG:OPENAI"]);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates.map(i => [i.state, i.collectedAt, i.eventDate]), [["ANNOUNCED", "2026-09-15", null], ["DOCUMENTED", "2026-09-14", null]]);
  assert.equal(updates[0].sourceUrl, graph.sources[0].url);
});
