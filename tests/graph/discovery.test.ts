import { test } from "node:test";
import assert from "node:assert/strict";
import { recentConnections, connectionJourney } from "../../src/lib/knowledge-graph/discovery";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
const graph: KnowledgeGraph = { nodes: ["A", "B", "C"].map(id => ({ id, kind: "COMPANY", order: 0 })), sources: [], asOf: "", relationships: [
  { id: "ab", source: "A", target: "B", type: "SUPPLIER_OF", sourceIds: ["proof"], summary: "", commercialStatus: "DOCUMENTED", publishedAt: "2026-09-12T00:00:00Z" },
  { id: "bc", source: "B", target: "C", type: "CUSTOMER_OF", sourceIds: ["proof"], summary: "", commercialStatus: "DOCUMENTED" },
  { id: "ca", source: "C", target: "A", type: "PARTNER_OF", sourceIds: ["proof"], summary: "", commercialStatus: "DOCUMENTED" }
] };
test("journeys traverse sourced edges without cycles or made-up connections", () => {
 assert.deepEqual(connectionJourney(graph,"A").map(e=>e.id),["ab","bc"]);
 assert.deepEqual(connectionJourney(graph,"missing"),[]);
 assert.equal(connectionJourney(graph,"A",1).length,1);
 assert.deepEqual(connectionJourney({...graph,relationships:graph.relationships.map(e=>({...e,sourceIds:[]}))},"A"),[]);
});
test("recent connections require an actual publication date, not a graph date",()=>{
 assert.deepEqual(recentConnections(graph,Date.parse("2026-09-13T00:00:00Z")).map(e=>e.id),["ab"]);
 assert.deepEqual(recentConnections(graph,Date.parse("2026-09-11T00:00:00Z")),[]);
 assert.deepEqual(recentConnections(graph,Date.parse("2026-09-20T00:00:00Z")),[]);
});
